using ClaimsPlatform.Api.Domain;
using ClaimsPlatform.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ClaimsPlatform.Api.Application;

/// <summary>
/// Write side. Every method: load -> check rules -> change state -> write history + outbox event
/// -> ONE SaveChanges (so state change and event are atomic).
/// Anything slow or non-essential (notifications, exposure read model) happens later, off the request path.
/// </summary>
public class ClaimCommands
{
    private readonly ClaimsDbContext _db;
    public ClaimCommands(ClaimsDbContext db) => _db = db;

    // ───────────── helpers ─────────────

    private static void Require(bool ok, string message)
    {
        if (!ok) throw new DomainException(message, 400);
    }

    private async Task<Claim> LoadAsync(int id, CancellationToken ct)
    {
        var c = await _db.Claims
            .Include(x => x.Claimant)
            .Include(x => x.AssignedOfficer)
            .Include(x => x.InfoRequests)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return c ?? throw new DomainException("Claim not found.", 404);
    }

    private static void EnsureHandler(Claim c, AppUser actor)
    {
        if (actor.Role == UserRole.Manager) return;
        if (actor.Role == UserRole.Officer && c.AssignedOfficerId == actor.Id) return;
        throw new DomainException("Only the assigned officer or a manager can do this.", 403);
    }

    private void Move(Claim c, ClaimStatus to, AppUser actor, string action, string? comment = null)
    {
        ClaimStateMachine.EnsureTransition(c.Status, to);
        _db.ClaimHistory.Add(new ClaimHistory
        {
            ClaimId = c.Id, FromStatus = c.Status, ToStatus = to, Action = action, Comment = comment,
            ActorId = actor.Id, ActorName = actor.Name, At = DateTime.UtcNow
        });
        c.Status = to;
        c.UpdatedAt = DateTime.UtcNow;
    }

    private void Emit(Claim c, string type, AppUser actor, ClaimStatus? before, decimal? amount = null, string? detail = null)
    {
        var evt = new ClaimEvent(Guid.NewGuid(), type, c.Id, c.ClaimNumber, c.Market, c.Type, before, c.Status,
            c.ClaimantId, c.AssignedOfficerId, actor.Name, amount, detail, DateTime.UtcNow);
        _db.Outbox.Add(new OutboxMessage
        {
            EventId = evt.EventId,
            Type = type,
            Key = c.Id.ToString(),
            Payload = EventJson.Serialize(evt),
            CreatedAt = DateTime.UtcNow
        });
    }

    private async Task SaveAsync(CancellationToken ct)
    {
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            throw new DomainException("Someone else just updated this claim. Refresh and try again.", 409);
        }
    }

    // ───────────── commands ─────────────

    public async Task<int> CreateAsync(CreateClaimRequest r, AppUser actor, CancellationToken ct)
    {
        Require(!string.IsNullOrWhiteSpace(r.PolicyNumber), "Policy number is required.");
        Require(!string.IsNullOrWhiteSpace(r.Location), "Incident location is required.");
        Require(!string.IsNullOrWhiteSpace(r.Description) && r.Description.Trim().Length >= 10,
            "Please describe what happened (at least 10 characters).");
        Require(r.ClaimedAmount > 0, "Claimed amount must be greater than zero.");
        Require(r.ClaimedAmount <= 5_000_000m, "Claimed amount is unrealistically large.");
        Require(r.IncidentDate.Date <= DateTime.UtcNow.Date, "Incident date cannot be in the future.");

        var now = DateTime.UtcNow;
        var claim = new Claim
        {
            ClaimNumber = "PENDING-" + Guid.NewGuid().ToString("N"),
            Type = r.Type,
            Market = r.Market,
            Status = ClaimStatus.Submitted,
            PolicyNumber = r.PolicyNumber.Trim(),
            IncidentDate = r.IncidentDate.Date,
            Location = r.Location.Trim(),
            Description = r.Description.Trim(),
            ClaimedAmount = r.ClaimedAmount,
            ClaimantId = actor.Id,
            CreatedAt = now,
            UpdatedAt = now
        };

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        _db.Claims.Add(claim);
        await _db.SaveChangesAsync(ct); // gets us the id for the human-friendly claim number

        claim.ClaimNumber = $"CLM-{now.Year}-{claim.Id:D6}";
        _db.ClaimHistory.Add(new ClaimHistory
        {
            ClaimId = claim.Id, FromStatus = null, ToStatus = ClaimStatus.Submitted, Action = "Claim submitted",
            ActorId = actor.Id, ActorName = actor.Name, At = now
        });
        Emit(claim, ClaimEventTypes.Submitted, actor, null);
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return claim.Id;
    }

    public async Task<int> AssignAsync(int id, AssignRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        var targetId = r.OfficerId ?? actor.Id;
        if (targetId != actor.Id && actor.Role != UserRole.Manager)
            throw new DomainException("Only a manager can assign claims to someone else.", 403);

        var target = await _db.Users.FirstOrDefaultAsync(u => u.Id == targetId, ct)
                     ?? throw new DomainException("Officer not found.", 404);
        Require(target.Role != UserRole.Claimant, "Claims can only be assigned to claims staff.");

        var before = c.Status;
        if (c.Status == ClaimStatus.Submitted)
        {
            Move(c, ClaimStatus.UnderReview, actor,
                target.Id == actor.Id ? "Picked up for review" : $"Assigned to {target.Name}");
        }
        else if (actor.Role == UserRole.Manager &&
                 c.Status is ClaimStatus.UnderReview or ClaimStatus.InfoRequested or ClaimStatus.Assessed)
        {
            _db.ClaimHistory.Add(new ClaimHistory
            {
                ClaimId = c.Id, FromStatus = c.Status, ToStatus = c.Status, Action = $"Reassigned to {target.Name}",
                ActorId = actor.Id, ActorName = actor.Name, At = DateTime.UtcNow
            });
            c.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            throw new DomainException($"A claim in '{c.Status}' cannot be assigned.", 409);
        }

        c.AssignedOfficerId = target.Id;
        c.AssignedOfficer = target;
        Emit(c, ClaimEventTypes.Assigned, actor, before, null, target.Name);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> RequestInfoAsync(int id, RequestInfoRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        EnsureHandler(c, actor);
        Require(!string.IsNullOrWhiteSpace(r.Message) && r.Message.Trim().Length >= 5, "Tell the claimant what you need (at least 5 characters).");

        var before = c.Status;
        Move(c, ClaimStatus.InfoRequested, actor, "Information requested", r.Message.Trim());
        _db.InfoRequests.Add(new InfoRequest
        {
            ClaimId = c.Id, Message = r.Message.Trim(), RequestedById = actor.Id,
            RequestedByName = actor.Name, RequestedAt = DateTime.UtcNow
        });
        Emit(c, ClaimEventTypes.InfoRequested, actor, before, null, r.Message.Trim());
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> ProvideInfoAsync(int id, ProvideInfoRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        if (c.ClaimantId != actor.Id) throw new DomainException("This is not your claim.", 403);
        if (c.Status != ClaimStatus.InfoRequested) throw new DomainException("No information is being requested on this claim.", 409);
        Require(!string.IsNullOrWhiteSpace(r.Response) && r.Response.Trim().Length >= 3, "Please enter your response.");

        var pending = c.InfoRequests.Where(i => i.Response == null).OrderByDescending(i => i.RequestedAt).FirstOrDefault();
        if (pending is not null)
        {
            pending.Response = r.Response.Trim();
            pending.RespondedAt = DateTime.UtcNow;
        }
        var before = c.Status;
        Move(c, ClaimStatus.UnderReview, actor, "Information provided", r.Response.Trim());
        Emit(c, ClaimEventTypes.InfoProvided, actor, before);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> AssessAsync(int id, AssessRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        EnsureHandler(c, actor);
        Require(r.AssessedAmount > 0, "Assessed amount must be greater than zero.");

        var before = c.Status;
        Move(c, ClaimStatus.Assessed, actor, "Assessed", string.IsNullOrWhiteSpace(r.Comment) ? $"Assessed at {r.AssessedAmount:N0}" : r.Comment!.Trim());
        c.AssessedAmount = r.AssessedAmount;
        Emit(c, ClaimEventTypes.Assessed, actor, before, r.AssessedAmount);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> ApproveAsync(int id, ApproveRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        EnsureHandler(c, actor);
        ClaimStateMachine.EnsureTransition(c.Status, ClaimStatus.Approved);

        var amount = r.ApprovedAmount ?? c.AssessedAmount ?? 0m;
        Require(amount > 0, "Approved amount must be greater than zero.");
        Require(c.AssessedAmount is null || amount <= c.AssessedAmount, "Approved amount cannot exceed the assessed amount.");
        if (amount > ClaimStateMachine.ManagerApprovalThreshold && actor.Role != UserRole.Manager)
            throw new DomainException($"Approvals above {ClaimStateMachine.ManagerApprovalThreshold:N0} need a manager.", 403);

        var before = c.Status;
        Move(c, ClaimStatus.Approved, actor, "Claim approved", string.IsNullOrWhiteSpace(r.Comment) ? $"Approved for {amount:N0}" : r.Comment!.Trim());
        c.ApprovedAmount = amount;
        c.DecidedAt = DateTime.UtcNow;
        Emit(c, ClaimEventTypes.Approved, actor, before, amount);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> RejectAsync(int id, RejectRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        EnsureHandler(c, actor);
        Require(!string.IsNullOrWhiteSpace(r.Reason) && r.Reason.Trim().Length >= 10, "Give the claimant a clear reason (at least 10 characters).");

        var before = c.Status;
        Move(c, ClaimStatus.Rejected, actor, "Claim rejected", r.Reason.Trim());
        c.DecisionReason = r.Reason.Trim();
        c.DecidedAt = DateTime.UtcNow;
        Emit(c, ClaimEventTypes.Rejected, actor, before, null, r.Reason.Trim());
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> ReopenAsync(int id, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        EnsureHandler(c, actor);
        var before = c.Status;
        Move(c, ClaimStatus.UnderReview, actor, "Sent back for review");
        Emit(c, ClaimEventTypes.Reopened, actor, before);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> SettleAsync(int id, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        EnsureHandler(c, actor);
        var before = c.Status;
        Move(c, ClaimStatus.Settled, actor, "Payment settled");
        Emit(c, ClaimEventTypes.Settled, actor, before, c.ApprovedAmount);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> WithdrawAsync(int id, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        if (c.ClaimantId != actor.Id) throw new DomainException("This is not your claim.", 403);
        var before = c.Status;
        Move(c, ClaimStatus.Withdrawn, actor, "Withdrawn by claimant");
        c.DecidedAt = DateTime.UtcNow;
        Emit(c, ClaimEventTypes.Withdrawn, actor, before);
        await SaveAsync(ct);
        return c.Id;
    }

    public async Task<int> AddNoteAsync(int id, NoteRequest r, AppUser actor, CancellationToken ct)
    {
        var c = await LoadAsync(id, ct);
        Require(!string.IsNullOrWhiteSpace(r.Text), "Note cannot be empty.");
        Require(ClaimStateMachine.IsOpen(c.Status), "Notes can only be added to open claims.");
        _db.ClaimNotes.Add(new ClaimNote
        {
            ClaimId = c.Id, Text = r.Text.Trim(), AuthorId = actor.Id, AuthorName = actor.Name, At = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
        return c.Id;
    }
}
