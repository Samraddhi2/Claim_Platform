using ClaimsPlatform.Api.Application;
using ClaimsPlatform.Api.Domain;
using ClaimsPlatform.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ClaimsPlatform.Api.Endpoints;

public static class ApiEndpoints
{
    private const string UserKey = "current-user";

    public static AppUser Actor(this HttpContext ctx) => (AppUser)ctx.Items[UserKey]!;

    /// <summary>Demo authentication: the SPA sends X-User-Id. A real deployment would validate a JWT from the corporate IdP.</summary>
    public static IApplicationBuilder UseDemoUser(this IApplicationBuilder app) =>
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Headers.TryGetValue("X-User-Id", out var header) && int.TryParse(header, out var id))
            {
                var db = ctx.RequestServices.GetRequiredService<ClaimsDbContext>();
                ctx.Items[UserKey] = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
            }
            await next();
        });

    /// <summary>Maps DomainException (400/403/404/409) to a clean JSON error instead of a 500.</summary>
    public static IApplicationBuilder UseDomainErrors(this IApplicationBuilder app) =>
        app.Use(async (ctx, next) =>
        {
            try { await next(); }
            catch (DomainException ex)
            {
                ctx.Response.StatusCode = ex.StatusCode;
                await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
            }
        });

    private static RouteHandlerBuilder RequireRole(this RouteHandlerBuilder b, params UserRole[] roles) =>
        b.AddEndpointFilter(async (EndpointFilterInvocationContext ctx, EndpointFilterDelegate next) =>
        {
            var user = ctx.HttpContext.Items[UserKey] as AppUser;
            if (user is null)
                return (object?)Results.Json(new { error = "Please sign in first." }, statusCode: 401);
            if (roles.Length > 0 && !roles.Contains(user.Role))
                return (object?)Results.Json(new { error = "You don't have permission to do that." }, statusCode: 403);
            return await next(ctx);
        });

    public static void MapClaimsApi(this WebApplication app)
    {
        var staff = new[] { UserRole.Officer, UserRole.Manager };
        var claimant = new[] { UserRole.Claimant };

        // ───────── public / session ─────────
        app.MapGet("/api/users", async (ClaimQueries q, CancellationToken ct) => Results.Ok(await q.UsersAsync(ct)));

        app.MapPost("/api/auth/login", async (LoginRequest r, ClaimsDbContext db, CancellationToken ct) =>
        {
            var email = (r.Email ?? "").Trim().ToLowerInvariant();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == email, ct);
            if (user is null)
                return Results.Json(new { error = "No account found for that email." }, statusCode: 401);
            return Results.Ok(ClaimQueries.ToDto(user));
        });

        app.MapGet("/api/system/info", async (ClaimQueries q, CancellationToken ct) => Results.Ok(await q.SystemInfoAsync(ct)));

        app.MapGet("/api/me", (HttpContext http) => Results.Ok(ClaimQueries.ToDto(http.Actor()))).RequireRole();

        // ───────── claim reads ─────────
        app.MapGet("/api/claims", async ([AsParameters] ClaimQuery query, ClaimQueries q, HttpContext http, CancellationToken ct) =>
            Results.Ok(await q.ListAsync(query, http.Actor(), false, ct))).RequireRole(staff);

        app.MapGet("/api/claims/mine", async ([AsParameters] ClaimQuery query, ClaimQueries q, HttpContext http, CancellationToken ct) =>
            Results.Ok(await q.ListAsync(query, http.Actor(), true, ct))).RequireRole(claimant);

        app.MapGet("/api/claims/{id:int}", async (int id, ClaimQueries q, HttpContext http, CancellationToken ct) =>
            Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct))).RequireRole();

        app.MapGet("/api/officers", async (ClaimQueries q, CancellationToken ct) =>
            Results.Ok(await q.OfficersAsync(ct))).RequireRole(staff);

        // ───────── claim documents ─────────
        app.MapPost("/api/claims/{id:int}/documents", async (int id, IFormFile file, ClaimsDbContext db, HttpContext http, IConfiguration config, CancellationToken ct) =>
        {
            const long maxBytes = 10 * 1024 * 1024;
            if (file is null || file.Length == 0)
                return (IResult)Results.BadRequest(new { error = "Choose a non-empty PDF, JPEG, or Word document." });
            if (file.Length > maxBytes)
                return (IResult)Results.BadRequest(new { error = "Files must be 10 MB or smaller." });

            var actor = http.Actor();
            var claim = await db.Claims.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (claim is null || (actor.Role == UserRole.Claimant && claim.ClaimantId != actor.Id))
                return (IResult)Results.NotFound(new { error = "Claim not found." });
            if (actor.Role == UserRole.Claimant && claim.Status is not (ClaimStatus.Submitted or ClaimStatus.InfoRequested))
                return (IResult)Results.BadRequest(new { error = "Documents can only be submitted with a new claim or when staff have requested more information." });

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            var allowed = new Dictionary<string, string[]>
            {
                [".pdf"] = new[] { "application/pdf" },
                [".jpg"] = new[] { "image/jpeg" }, [".jpeg"] = new[] { "image/jpeg" },
                [".doc"] = new[] { "application/msword", "application/octet-stream" },
                [".docx"] = new[] { "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream" }
            };
            if (!allowed.TryGetValue(extension, out var types) || (!types.Contains(file.ContentType, StringComparer.OrdinalIgnoreCase) && file.ContentType != "application/octet-stream"))
                return (IResult)Results.BadRequest(new { error = "Only PDF, JPEG, DOC, and DOCX files are supported." });

            var root = config["DocumentStorage:Path"];
            if (string.IsNullOrWhiteSpace(root)) root = Path.Combine(app.Environment.ContentRootPath, "uploads");
            Directory.CreateDirectory(root);
            var storedName = $"{Guid.NewGuid():N}{extension}";
            var fullPath = Path.Combine(root, storedName);
            await using (var stream = File.Create(fullPath)) await file.CopyToAsync(stream, ct);
            var doc = new ClaimDocument
            {
                ClaimId = id, UploadedById = actor.Id, UploadedByName = actor.Name,
                OriginalFileName = Path.GetFileName(file.FileName), StoredFileName = storedName,
                ContentType = extension is ".jpg" or ".jpeg" ? "image/jpeg" : extension == ".pdf" ? "application/pdf" : extension == ".doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                SizeBytes = file.Length, UploadedAt = DateTime.UtcNow
            };
            db.ClaimDocuments.Add(doc);
            await db.SaveChangesAsync(ct);
            return (IResult)Results.Created($"/api/claims/{id}/documents/{doc.Id}", new ClaimDocumentDto(doc.Id, doc.OriginalFileName, doc.ContentType, doc.SizeBytes, doc.UploadedByName, doc.UploadedAt));
        }).DisableAntiforgery().RequireRole(claimant);

        app.MapGet("/api/claims/{id:int}/documents/{documentId:int}", async (int id, int documentId, ClaimsDbContext db, HttpContext http, IConfiguration config, CancellationToken ct) =>
        {
            var actor = http.Actor();
            var claim = await db.Claims.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
            if (claim is null || (actor.Role == UserRole.Claimant && claim.ClaimantId != actor.Id))
                return (IResult)Results.NotFound(new { error = "Document not found." });
            var doc = await db.ClaimDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == documentId && d.ClaimId == id, ct);
            if (doc is null) return (IResult)Results.NotFound(new { error = "Document not found." });
            var root = config["DocumentStorage:Path"];
            if (string.IsNullOrWhiteSpace(root)) root = Path.Combine(app.Environment.ContentRootPath, "uploads");
            var path = Path.Combine(root, doc.StoredFileName);
            if (!File.Exists(path)) return (IResult)Results.NotFound(new { error = "The stored document could not be found." });
            return (IResult)Results.File(path, doc.ContentType, doc.OriginalFileName, enableRangeProcessing: true);
        }).RequireRole();

        // ───────── claimant commands ─────────
        app.MapPost("/api/claims", async (CreateClaimRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            var id = await cmd.CreateAsync(r, http.Actor(), ct);
            return Results.Created($"/api/claims/{id}", await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(claimant);

        app.MapPost("/api/claims/{id:int}/provide-info", async (int id, ProvideInfoRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.ProvideInfoAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(claimant);

        app.MapPost("/api/claims/{id:int}/withdraw", async (int id, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.WithdrawAsync(id, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(claimant);

        // ───────── staff commands ─────────
        app.MapPost("/api/claims/{id:int}/assign", async (int id, AssignRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.AssignAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/request-info", async (int id, RequestInfoRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.RequestInfoAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/assess", async (int id, AssessRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.AssessAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/approve", async (int id, ApproveRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.ApproveAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/reject", async (int id, RejectRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.RejectAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/reopen", async (int id, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.ReopenAsync(id, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/settle", async (int id, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.SettleAsync(id, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        app.MapPost("/api/claims/{id:int}/notes", async (int id, NoteRequest r, ClaimCommands cmd, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await cmd.AddNoteAsync(id, r, http.Actor(), ct);
            return Results.Ok(await q.GetDetailAsync(id, http.Actor(), ct));
        }).RequireRole(staff);

        // ───────── notifications ─────────
        app.MapGet("/api/notifications", async (ClaimQueries q, HttpContext http, CancellationToken ct) =>
            Results.Ok(await q.NotificationsAsync(http.Actor(), ct))).RequireRole();

        app.MapPost("/api/notifications/{id:int}/read", async (int id, ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await q.MarkReadAsync(id, http.Actor(), ct);
            return Results.NoContent();
        }).RequireRole();

        app.MapPost("/api/notifications/read-all", async (ClaimQueries q, HttpContext http, CancellationToken ct) =>
        {
            await q.MarkAllReadAsync(http.Actor(), ct);
            return Results.NoContent();
        }).RequireRole();

        // ───────── workload & dashboard ─────────
        app.MapGet("/api/workload", async (ClaimQueries q, HttpContext http, CancellationToken ct) =>
            Results.Ok(await q.WorkloadAsync(http.Actor(), ct))).RequireRole(staff);

        app.MapGet("/api/dashboard", async (ClaimQueries q, CancellationToken ct) =>
            Results.Ok(await q.DashboardAsync(ct))).RequireRole(UserRole.Manager);
    }
}
