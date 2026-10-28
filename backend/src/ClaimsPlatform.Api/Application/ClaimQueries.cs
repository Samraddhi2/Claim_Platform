using ClaimsPlatform.Api.Domain;
using ClaimsPlatform.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ClaimsPlatform.Api.Application;

/// <summary>Read side. Never mutates state; AsNoTracking everywhere.</summary>
public class ClaimQueries
{
    private readonly ClaimsDbContext _db;
    private readonly MessagingOptions _messaging;

    public ClaimQueries(ClaimsDbContext db, IOptions<MessagingOptions> messaging)
    {
        _db = db;
        _messaging = messaging.Value;
    }

    // ───────────── mapping ─────────────

    public static UserDto ToDto(AppUser u) => new(u.Id, u.Name, u.Email, u.Role, u.Market);

    private static ClaimSummaryDto ToSummary(Claim c) => new(
        c.Id, c.ClaimNumber, c.Type, c.Market, c.Status, c.PolicyNumber,
        c.ClaimedAmount, c.AssessedAmount, c.ApprovedAmount,
        c.ClaimantId, c.Claimant?.Name ?? "", c.AssignedOfficerId, c.AssignedOfficer?.Name,
        c.IncidentDate, c.CreatedAt, c.UpdatedAt);

    // ───────────── claims ─────────────

    public async Task<ClaimDetailDto> GetDetailAsync(int id, AppUser actor, CancellationToken ct)
    {
        var c = await _db.Claims.AsNoTracking()
            .Include(x => x.Claimant).Include(x => x.AssignedOfficer)
            .Include(x => x.History).Include(x => x.InfoRequests).Include(x => x.Notes)
            .FirstOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new DomainException("Claim not found.", 404);

        var isStaff = actor.Role != UserRole.Claimant;
        if (!isStaff && c.ClaimantId != actor.Id)
            throw new DomainException("Claim not found.", 404); // don't reveal existence

        return new ClaimDetailDto(
            ToSummary(c), c.Location, c.Description, c.DecisionReason, c.Version,
            c.History.OrderBy(h => h.At).ThenBy(h => h.Id)
                .Select(h => new HistoryDto(h.FromStatus, h.ToStatus, h.Action, h.Comment, h.ActorName, h.At)).ToList(),
            c.InfoRequests.OrderBy(i => i.RequestedAt)
                .Select(i => new InfoRequestDto(i.Id, i.Message, i.RequestedByName, i.RequestedAt, i.Response, i.RespondedAt)).ToList(),
            isStaff
                ? c.Notes.OrderByDescending(n => n.At).Select(n => new NoteDto(n.Id, n.Text, n.AuthorName, n.At)).ToList()
                : new List<NoteDto>(),
            ClaimStateMachine.AvailableActions(c, actor),
            (await _db.ClaimDocuments.AsNoTracking().Where(d => d.ClaimId == id).OrderByDescending(d => d.UploadedAt).ToListAsync(ct))
                .Select(d => new ClaimDocumentDto(d.Id, d.OriginalFileName, d.ContentType, d.SizeBytes, d.UploadedByName, d.UploadedAt)).ToList());
    }

    public async Task<PagedResult<ClaimSummaryDto>> ListAsync(ClaimQuery q, AppUser actor, bool mineOnly, CancellationToken ct)
    {
        IQueryable<Claim> qry = _db.Claims.AsNoTracking()
            .Include(c => c.Claimant).Include(c => c.AssignedOfficer);

        if (mineOnly || actor.Role == UserRole.Claimant)
            qry = qry.Where(c => c.ClaimantId == actor.Id);

        if (q.Status is ClaimStatus status) qry = qry.Where(c => c.Status == status);
        if (q.Type is ClaimType type) qry = qry.Where(c => c.Type == type);
        if (q.Market is Market market) qry = qry.Where(c => c.Market == market);
        if (q.AssignedTo is int officerId) qry = qry.Where(c => c.AssignedOfficerId == officerId);
        if (q.Unassigned == true) qry = qry.Where(c => c.AssignedOfficerId == null && c.Status == ClaimStatus.Submitted);
        if (q.OpenOnly == true)
            qry = qry.Where(c => c.Status != ClaimStatus.Rejected && c.Status != ClaimStatus.Settled && c.Status != ClaimStatus.Withdrawn);

        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var s = q.Search.Trim();
            qry = qry.Where(c => c.ClaimNumber.Contains(s) || c.PolicyNumber.Contains(s) || c.Claimant!.Name.Contains(s));
        }

        qry = q.Sort == "oldest" ? qry.OrderBy(c => c.CreatedAt) : qry.OrderByDescending(c => c.UpdatedAt);

        var pageSize = Math.Clamp(q.PageSize ?? 10, 1, 50);
        var page = Math.Max(1, q.Page ?? 1);
        var total = await qry.CountAsync(ct);
        var items = await qry.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new PagedResult<ClaimSummaryDto>(items.Select(ToSummary).ToList(), total, page, pageSize);
    }

    // ───────────── people ─────────────

    public async Task<List<UserDto>> UsersAsync(CancellationToken ct) =>
        (await _db.Users.AsNoTracking().OrderBy(u => u.Role).ThenBy(u => u.Name).ToListAsync(ct)).Select(ToDto).ToList();

    public async Task<List<UserDto>> OfficersAsync(CancellationToken ct) =>
        (await _db.Users.AsNoTracking().Where(u => u.Role == UserRole.Officer).OrderBy(u => u.Name).ToListAsync(ct)).Select(ToDto).ToList();

    // ───────────── notifications ─────────────

    public async Task<List<NotificationDto>> NotificationsAsync(AppUser actor, CancellationToken ct) =>
        (await _db.Notifications.AsNoTracking().Where(n => n.UserId == actor.Id)
            .OrderByDescending(n => n.CreatedAt).Take(30).ToListAsync(ct))
        .Select(n => new NotificationDto(n.Id, n.ClaimId, n.ClaimNumber, n.Message, n.IsRead, n.CreatedAt)).ToList();

    public async Task MarkReadAsync(int notificationId, AppUser actor, CancellationToken ct)
    {
        var n = await _db.Notifications.FirstOrDefaultAsync(x => x.Id == notificationId && x.UserId == actor.Id, ct)
                ?? throw new DomainException("Notification not found.", 404);
        n.IsRead = true;
        await _db.SaveChangesAsync(ct);
    }

    public async Task MarkAllReadAsync(AppUser actor, CancellationToken ct)
    {
        var unread = await _db.Notifications.Where(n => n.UserId == actor.Id && !n.IsRead).ToListAsync(ct);
        foreach (var n in unread) n.IsRead = true;
        await _db.SaveChangesAsync(ct);
    }

    // ───────────── officer workload ─────────────

    public async Task<WorkloadDto> WorkloadAsync(AppUser actor, CancellationToken ct)
    {
        var mine = await _db.Claims.AsNoTracking().Where(c => c.AssignedOfficerId == actor.Id).ToListAsync(ct);
        var queue = await _db.Claims.AsNoTracking().Where(c => c.Status == ClaimStatus.Submitted).ToListAsync(ct);
        var now = DateTime.UtcNow;

        var open = mine.Where(c => ClaimStateMachine.IsOpen(c.Status)).ToList();
        var decided = mine.Where(c => c.DecidedAt != null && c.Status != ClaimStatus.Withdrawn).ToList();
        var recent = decided.Where(c => c.DecidedAt >= now.AddDays(-30)).ToList();

        return new WorkloadDto(
            OpenClaims: open.Count,
            AwaitingMyAction: open.Count(c => c.Status is ClaimStatus.UnderReview or ClaimStatus.Assessed or ClaimStatus.Approved),
            AwaitingClaimant: open.Count(c => c.Status == ClaimStatus.InfoRequested),
            MyExposure: open.Sum(c => c.ExposureAmount),
            DecidedLast30Days: recent.Count,
            AvgDaysToDecision: decided.Count == 0 ? 0 : Math.Round(decided.Average(c => (c.DecidedAt!.Value - c.CreatedAt).TotalDays), 1),
            QueueSize: queue.Count,
            OldestQueueDays: queue.Count == 0 ? null : Math.Round((now - queue.Min(c => c.CreatedAt)).TotalDays, 1),
            ByStatus: mine.GroupBy(c => c.Status).ToDictionary(g => g.Key.ToString(), g => g.Count()));
    }

    // ───────────── manager dashboard ─────────────

    public async Task<DashboardDto> DashboardAsync(CancellationToken ct)
    {
        var claims = await _db.Claims.AsNoTracking()
            .Include(c => c.Claimant).Include(c => c.AssignedOfficer).ToListAsync(ct);
        var officers = await _db.Users.AsNoTracking().Where(u => u.Role == UserRole.Officer).OrderBy(u => u.Name).ToListAsync(ct);
        var projection = await _db.ExposureProjections.AsNoTracking().ToListAsync(ct);
        var now = DateTime.UtcNow;

        var open = claims.Where(c => ClaimStateMachine.IsOpen(c.Status)).ToList();
        var decisions = claims.Where(c => c.Status is ClaimStatus.Approved or ClaimStatus.Settled or ClaimStatus.Rejected).ToList();
        var paid = decisions.Count(c => c.Status != ClaimStatus.Rejected);
        var withDecisionDate = claims.Where(c => c.DecidedAt != null && c.Status != ClaimStatus.Withdrawn).ToList();

        var byMarket = Enum.GetValues<Market>().Select(m => new ExposureRowDto(
            m.ToString(),
            projection.Where(p => p.Market == m).Sum(p => p.OpenClaims),
            projection.Where(p => p.Market == m).Sum(p => p.OutstandingAmount))).ToList();

        var byType = Enum.GetValues<ClaimType>().Select(t => new ExposureRowDto(
            t.ToString(),
            projection.Where(p => p.Type == t).Sum(p => p.OpenClaims),
            projection.Where(p => p.Type == t).Sum(p => p.OutstandingAmount))).ToList();

        var team = officers.Select(o =>
        {
            var theirs = claims.Where(c => c.AssignedOfficerId == o.Id).ToList();
            var theirOpen = theirs.Where(c => ClaimStateMachine.IsOpen(c.Status)).ToList();
            var theirDecided = theirs.Where(c => c.DecidedAt != null && c.Status != ClaimStatus.Withdrawn).ToList();
            return new TeamMemberDto(
                o.Id, o.Name, theirOpen.Count, theirOpen.Sum(c => c.ExposureAmount),
                theirDecided.Count(c => c.DecidedAt >= now.AddDays(-30)),
                theirDecided.Count == 0 ? 0 : Math.Round(theirDecided.Average(c => (c.DecidedAt!.Value - c.CreatedAt).TotalDays), 1));
        }).ToList();

        var highValue = open.Where(c => c.ExposureAmount > ClaimStateMachine.ManagerApprovalThreshold)
            .OrderByDescending(c => c.ExposureAmount).Take(5).Select(ToSummary).ToList();

        return new DashboardDto(
            TotalClaims: claims.Count,
            OpenClaims: open.Count,
            QueueSize: claims.Count(c => c.Status == ClaimStatus.Submitted),
            ApprovalRatePct: decisions.Count == 0 ? 0 : Math.Round(100.0 * paid / decisions.Count, 1),
            AvgDaysToDecision: withDecisionDate.Count == 0 ? 0 : Math.Round(withDecisionDate.Average(c => (c.DecidedAt!.Value - c.CreatedAt).TotalDays), 1),
            TotalOutstanding: byMarket.Sum(r => r.OutstandingAmount),
            ExposureUpdatedAt: projection.Count == 0 ? null : projection.Max(p => p.UpdatedAt),
            ExposureByMarket: byMarket,
            ExposureByType: byType,
            ByStatus: claims.GroupBy(c => c.Status).ToDictionary(g => g.Key.ToString(), g => g.Count()),
            Team: team,
            HighValueOpen: highValue);
    }

    public async Task<SystemInfoDto> SystemInfoAsync(CancellationToken ct)
    {
        var pending = await _db.Outbox.CountAsync(m => m.DispatchedAt == null, ct);
        return new SystemInfoDto(_messaging.IsKafka ? "Kafka" : "In-Memory", _messaging.Topic, pending, ClaimStateMachine.ManagerApprovalThreshold);
    }
}
