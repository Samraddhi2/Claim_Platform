using System.Text.Json.Serialization;
using ClaimsPlatform.Api.Application;
using ClaimsPlatform.Api.Endpoints;
using ClaimsPlatform.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<ClaimsDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=claims.db"));

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddScoped<ClaimCommands>();
builder.Services.AddScoped<ClaimQueries>();

// Event pipeline: Messaging:Provider = InMemory (default) | Kafka
builder.Services.AddClaimEventing(builder.Configuration);

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:4200", "http://127.0.0.1:4200")
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ClaimsDbContext>();
    db.Database.EnsureCreated();
    // EnsureCreated does not evolve an existing SQLite database, so add the document table safely for existing demo databases too.
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS ClaimDocuments (Id INTEGER NOT NULL CONSTRAINT PK_ClaimDocuments PRIMARY KEY AUTOINCREMENT, ClaimId INTEGER NOT NULL, UploadedById INTEGER NOT NULL, UploadedByName TEXT NOT NULL, OriginalFileName TEXT NOT NULL, StoredFileName TEXT NOT NULL, ContentType TEXT NOT NULL, SizeBytes INTEGER NOT NULL, UploadedAt TEXT NOT NULL, CONSTRAINT FK_ClaimDocuments_Claims_ClaimId FOREIGN KEY (ClaimId) REFERENCES Claims (Id) ON DELETE CASCADE);");
    db.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_ClaimDocuments_ClaimId ON ClaimDocuments (ClaimId);");
    try { db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;"); } catch { /* best effort */ }
    await Seeder.SeedAsync(db);
}

var messaging = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<MessagingOptions>>().Value;
app.Logger.LogInformation("Messaging provider: {Provider}{Extra}", messaging.IsKafka ? "Kafka" : "In-Memory",
    messaging.IsKafka ? $" ({messaging.BootstrapServers}, topic '{messaging.Topic}')" : "");

app.UseDomainErrors();
app.UseCors();
app.UseDemoUser();
app.UseSwagger();
app.UseSwaggerUI();

app.MapClaimsApi();
app.MapGet("/", () => Results.Redirect("/swagger"));

app.Run();

public partial class Program { }
