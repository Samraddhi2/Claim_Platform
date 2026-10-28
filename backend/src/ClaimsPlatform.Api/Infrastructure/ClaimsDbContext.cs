using ClaimsPlatform.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ClaimsPlatform.Api.Infrastructure;

public class ClaimsDbContext : DbContext
{
    public ClaimsDbContext(DbContextOptions<ClaimsDbContext> options) : base(options) { }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Claim> Claims => Set<Claim>();
    public DbSet<ClaimHistory> ClaimHistory => Set<ClaimHistory>();
    public DbSet<InfoRequest> InfoRequests => Set<InfoRequest>();
    public DbSet<ClaimNote> ClaimNotes => Set<ClaimNote>();
    public DbSet<ClaimDocument> ClaimDocuments => Set<ClaimDocument>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ExposureProjection> ExposureProjections => Set<ExposureProjection>();
    public DbSet<OutboxMessage> Outbox => Set<OutboxMessage>();

    // SQLite hands DateTimes back with Kind=Unspecified; mark them UTC so the API serialises them with a 'Z'.
    protected override void ConfigureConventions(ModelConfigurationBuilder cb)
    {
        cb.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        cb.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppUser>(e =>
        {
            e.Property(x => x.Role).HasConversion<string>();
            e.Property(x => x.Market).HasConversion<string>();
            e.HasIndex(x => x.Email).IsUnique();
        });

        b.Entity<Claim>(e =>
        {
            e.Property(x => x.Type).HasConversion<string>();
            e.Property(x => x.Market).HasConversion<string>();
            e.Property(x => x.Status).HasConversion<string>();
            e.Property(x => x.Version).IsConcurrencyToken();
            e.Ignore(x => x.ExposureAmount);
            e.HasIndex(x => x.ClaimNumber).IsUnique();
            // The queries a claims officer runs all day: "my open claims" and "what's waiting in the queue".
            e.HasIndex(x => new { x.AssignedOfficerId, x.Status });
            e.HasIndex(x => new { x.Status, x.CreatedAt });
            e.HasIndex(x => x.ClaimantId);
            e.HasOne(x => x.Claimant).WithMany().HasForeignKey(x => x.ClaimantId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.AssignedOfficer).WithMany().HasForeignKey(x => x.AssignedOfficerId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.History).WithOne().HasForeignKey(x => x.ClaimId);
            e.HasMany(x => x.InfoRequests).WithOne().HasForeignKey(x => x.ClaimId);
            e.HasMany(x => x.Notes).WithOne().HasForeignKey(x => x.ClaimId);
        });

        b.Entity<ClaimHistory>(e =>
        {
            e.Property(x => x.FromStatus).HasConversion<string>();
            e.Property(x => x.ToStatus).HasConversion<string>();
        });

        b.Entity<ClaimDocument>(e =>
        {
            e.HasIndex(x => x.ClaimId);
            e.HasOne<Claim>().WithMany().HasForeignKey(x => x.ClaimId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Notification>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.IsRead });
            e.HasIndex(x => new { x.EventId, x.UserId }).IsUnique();
        });

        b.Entity<ExposureProjection>(e =>
        {
            e.Property(x => x.Market).HasConversion<string>();
            e.Property(x => x.Type).HasConversion<string>();
            e.HasIndex(x => new { x.Market, x.Type }).IsUnique();
        });

        b.Entity<OutboxMessage>(e => e.HasIndex(x => x.DispatchedAt));
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        // Bump the concurrency token on every claim update.
        foreach (var entry in ChangeTracker.Entries<Claim>().Where(x => x.State == EntityState.Modified))
            entry.Entity.Version++;
        return base.SaveChangesAsync(ct);
    }
}

public class UtcDateTimeConverter : ValueConverter<DateTime, DateTime>
{
    public UtcDateTimeConverter() : base(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc)) { }
}

public class NullableUtcDateTimeConverter : ValueConverter<DateTime?, DateTime?>
{
    public NullableUtcDateTimeConverter()
        : base(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v) { }
}
