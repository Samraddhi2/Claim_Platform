using ClaimsPlatform.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace ClaimsPlatform.Api.Infrastructure;

/// <summary>
/// Turns claim events into in-app notifications. Idempotent: (EventId, UserId) is unique,
/// so a redelivered event never produces a second notification.
/// </summary>
public class NotificationHandler : IClaimEventHandler
{
    public string Name => "notifications";

    public async Task HandleAsync(ClaimEvent e, ClaimsDbContext db, CancellationToken ct)
    {
        var targets = new List<(int UserId, string Message)>();

        switch (e.Type)
        {
            case ClaimEventTypes.Submitted:
                targets.Add((e.ClaimantId, $"We received your claim {e.ClaimNumber}. An officer will pick it up shortly."));
                var officers = await db.Users
                    .Where(u => u.Role == UserRole.Officer)
                    .ToListAsync(ct);
                foreach (var o in officers.Where(o => o.Market == null || o.Market == e.Market))
                    targets.Add((o.Id, $"New {e.ClaimType} claim {e.ClaimNumber} in the {e.Market} queue."));
                break;

            case ClaimEventTypes.Assigned:
                targets.Add((e.ClaimantId, $"{e.Detail ?? "An officer"} is now reviewing claim {e.ClaimNumber}."));
                if (e.AssignedOfficerId is int assignee)
                    targets.Add((assignee, $"Claim {e.ClaimNumber} was assigned to you."));
                break;

            case ClaimEventTypes.InfoRequested:
                targets.Add((e.ClaimantId, $"We need more information on claim {e.ClaimNumber}: {e.Detail}"));
                break;

            case ClaimEventTypes.InfoProvided:
                if (e.AssignedOfficerId is int handler)
                    targets.Add((handler, $"The claimant replied on claim {e.ClaimNumber}. It's back in your review list."));
                break;

            case ClaimEventTypes.Assessed:
                if (e.Amount > ClaimStateMachine.ManagerApprovalThreshold)
                {
                    var managers = await db.Users.Where(u => u.Role == UserRole.Manager).ToListAsync(ct);
                    foreach (var m in managers)
                        targets.Add((m.Id, $"High-value claim {e.ClaimNumber} assessed at {e.Amount:N0} - manager approval will be required."));
                }
                break;

            case ClaimEventTypes.Approved:
                targets.Add((e.ClaimantId, $"Good news - claim {e.ClaimNumber} was approved for {e.Amount:N0}."));
                break;

            case ClaimEventTypes.Rejected:
                targets.Add((e.ClaimantId, $"Claim {e.ClaimNumber} was not approved. Reason: {e.Detail}"));
                break;

            case ClaimEventTypes.Settled:
                targets.Add((e.ClaimantId, $"Payment of {e.Amount:N0} for claim {e.ClaimNumber} has been settled."));
                break;

            case ClaimEventTypes.Withdrawn:
                if (e.AssignedOfficerId is int owner)
                    targets.Add((owner, $"Claim {e.ClaimNumber} was withdrawn by the claimant."));
                break;
        }

        if (targets.Count == 0) return;

        var userIds = targets.Select(t => t.UserId).Distinct().ToList();
        var already = await db.Notifications
            .Where(n => n.EventId == e.EventId && userIds.Contains(n.UserId))
            .Select(n => n.UserId)
            .ToListAsync(ct);

        foreach (var (userId, message) in targets.DistinctBy(t => t.UserId))
        {
            if (already.Contains(userId)) continue;
            db.Notifications.Add(new Notification
            {
                UserId = userId,
                ClaimId = e.ClaimId,
                ClaimNumber = e.ClaimNumber,
                Message = message,
                CreatedAt = DateTime.UtcNow,
                EventId = e.EventId
            });
        }
        await db.SaveChangesAsync(ct);
    }
}

/// <summary>
/// Maintains the outstanding-liability read model. It recomputes the affected (market, type) bucket from
/// source-of-truth claims instead of applying deltas, which makes it idempotent and self-healing.
/// </summary>
public class ExposureProjectionHandler : IClaimEventHandler
{
    public string Name => "exposure-projection";

    public Task HandleAsync(ClaimEvent e, ClaimsDbContext db, CancellationToken ct) =>
        ExposureProjector.RecomputeAsync(db, e.Market, e.ClaimType, ct);
}

public static class ExposureProjector
{
    public static async Task RecomputeAsync(ClaimsDbContext db, Market market, ClaimType type, CancellationToken ct)
    {
        // Money columns are decimals; SQLite can't aggregate them in SQL, so aggregate in memory.
        var claims = await db.Claims
            .AsNoTracking()
            .Where(c => c.Market == market && c.Type == type)
            .ToListAsync(ct);

        var open = claims.Where(c => ClaimStateMachine.IsOpen(c.Status)).ToList();

        var row = await db.ExposureProjections.FirstOrDefaultAsync(p => p.Market == market && p.Type == type, ct);
        if (row is null)
        {
            row = new ExposureProjection { Market = market, Type = type };
            db.ExposureProjections.Add(row);
        }
        row.OpenClaims = open.Count;
        row.OutstandingAmount = open.Sum(c => c.ExposureAmount);
        row.ClaimedAmount = open.Sum(c => c.ClaimedAmount);
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public static async Task RecomputeAllAsync(ClaimsDbContext db, CancellationToken ct)
    {
        foreach (var market in Enum.GetValues<Market>())
            foreach (var type in Enum.GetValues<ClaimType>())
                await RecomputeAsync(db, market, type, ct);
    }
}
