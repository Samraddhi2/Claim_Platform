namespace ClaimsPlatform.Api.Domain;

public class DomainException : Exception
{
    public int StatusCode { get; }
    public DomainException(string message, int statusCode = 400) : base(message) => StatusCode = statusCode;
}

/// <summary>
/// The single source of truth for what may happen to a claim, and who may do it.
/// Pure and dependency-free so it is trivially unit-testable.
/// </summary>
public static class ClaimStateMachine
{
    /// <summary>Approvals above this value need a Manager (four-eyes rule).</summary>
    public const decimal ManagerApprovalThreshold = 50_000m;

    public static readonly ClaimStatus[] OpenStatuses =
    {
        ClaimStatus.Submitted, ClaimStatus.UnderReview, ClaimStatus.InfoRequested,
        ClaimStatus.Assessed, ClaimStatus.Approved
    };

    public static bool IsOpen(ClaimStatus s) => Array.IndexOf(OpenStatuses, s) >= 0;

    private static readonly Dictionary<ClaimStatus, ClaimStatus[]> Allowed = new()
    {
        [ClaimStatus.Submitted]     = new[] { ClaimStatus.UnderReview, ClaimStatus.Withdrawn },
        [ClaimStatus.UnderReview]   = new[] { ClaimStatus.InfoRequested, ClaimStatus.Assessed, ClaimStatus.Rejected, ClaimStatus.Withdrawn },
        [ClaimStatus.InfoRequested] = new[] { ClaimStatus.UnderReview, ClaimStatus.Withdrawn },
        [ClaimStatus.Assessed]      = new[] { ClaimStatus.Approved, ClaimStatus.Rejected, ClaimStatus.UnderReview },
        [ClaimStatus.Approved]      = new[] { ClaimStatus.Settled },
        [ClaimStatus.Rejected]      = Array.Empty<ClaimStatus>(),
        [ClaimStatus.Settled]       = Array.Empty<ClaimStatus>(),
        [ClaimStatus.Withdrawn]     = Array.Empty<ClaimStatus>(),
    };

    public static bool CanTransition(ClaimStatus from, ClaimStatus to) =>
        Allowed.TryGetValue(from, out var next) && Array.IndexOf(next, to) >= 0;

    public static void EnsureTransition(ClaimStatus from, ClaimStatus to)
    {
        if (!CanTransition(from, to))
            throw new DomainException($"A claim in '{from}' cannot move to '{to}'.", 409);
    }

    /// <summary>Which actions the given user may take right now - the UI uses this to show/hide buttons.</summary>
    public static List<string> AvailableActions(Claim c, AppUser user)
    {
        var actions = new List<string>();

        if (user.Role == UserRole.Claimant)
        {
            if (c.ClaimantId != user.Id) return actions;
            if (CanTransition(c.Status, ClaimStatus.Withdrawn)) actions.Add("withdraw");
            if (c.Status == ClaimStatus.InfoRequested) actions.Add("provideInfo");
            return actions;
        }

        var isManager = user.Role == UserRole.Manager;
        var isAssignee = c.AssignedOfficerId == user.Id;

        if (c.Status == ClaimStatus.Submitted) actions.Add("assignToMe");
        if (isManager && IsOpen(c.Status) && c.Status != ClaimStatus.Approved) actions.Add("assign");
        if (IsOpen(c.Status)) actions.Add("addNote");

        if (isAssignee || isManager)
        {
            if (c.Status == ClaimStatus.UnderReview)
            {
                actions.Add("requestInfo");
                actions.Add("assess");
                actions.Add("reject");
            }
            if (c.Status == ClaimStatus.Assessed)
            {
                actions.Add("approve");
                actions.Add("reject");
                actions.Add("reopen");
            }
            if (c.Status == ClaimStatus.Approved) actions.Add("settle");
        }
        return actions;
    }
}
