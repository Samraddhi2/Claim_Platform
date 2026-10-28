using ClaimsPlatform.Api.Domain;

namespace ClaimsPlatform.Api.Application;

// ───── requests ─────
public record LoginRequest(string Email);
public record CreateClaimRequest(ClaimType Type, Market Market, string PolicyNumber, DateTime IncidentDate,
    string Location, string Description, decimal ClaimedAmount);
public record AssignRequest(int? OfficerId);
public record RequestInfoRequest(string Message);
public record ProvideInfoRequest(string Response);
public record AssessRequest(decimal AssessedAmount, string? Comment);
public record ApproveRequest(decimal? ApprovedAmount, string? Comment);
public record RejectRequest(string Reason);
public record NoteRequest(string Text);

public class ClaimQuery
{
    public ClaimStatus? Status { get; set; }
    public ClaimType? Type { get; set; }
    public Market? Market { get; set; }
    public int? AssignedTo { get; set; }
    public bool? Unassigned { get; set; }
    public bool? OpenOnly { get; set; }
    public string? Search { get; set; }
    public string? Sort { get; set; }          // "oldest" | "newest"
    public int? Page { get; set; } = 1;
    public int? PageSize { get; set; } = 10;
}

// ───── responses ─────
public record UserDto(int Id, string Name, string Email, UserRole Role, Market? Market);

public record ClaimSummaryDto(
    int Id, string ClaimNumber, ClaimType Type, Market Market, ClaimStatus Status, string PolicyNumber,
    decimal ClaimedAmount, decimal? AssessedAmount, decimal? ApprovedAmount,
    int ClaimantId, string ClaimantName, int? AssignedOfficerId, string? AssignedOfficerName,
    DateTime IncidentDate, DateTime CreatedAt, DateTime UpdatedAt);

public record HistoryDto(ClaimStatus? FromStatus, ClaimStatus ToStatus, string Action, string? Comment, string ActorName, DateTime At);
public record InfoRequestDto(int Id, string Message, string RequestedByName, DateTime RequestedAt, string? Response, DateTime? RespondedAt);
public record NoteDto(int Id, string Text, string AuthorName, DateTime At);
public record ClaimDocumentDto(int Id, string FileName, string ContentType, long SizeBytes, string UploadedByName, DateTime UploadedAt);

public record ClaimDetailDto(
    ClaimSummaryDto Summary, string Location, string Description, string? DecisionReason, int Version,
    List<HistoryDto> History, List<InfoRequestDto> InfoRequests, List<NoteDto> Notes, List<string> AvailableActions, List<ClaimDocumentDto> Documents);

public record PagedResult<T>(List<T> Items, int Total, int Page, int PageSize);

public record NotificationDto(int Id, int? ClaimId, string ClaimNumber, string Message, bool IsRead, DateTime CreatedAt);

public record WorkloadDto(
    int OpenClaims, int AwaitingMyAction, int AwaitingClaimant, decimal MyExposure,
    int DecidedLast30Days, double AvgDaysToDecision, int QueueSize, double? OldestQueueDays,
    Dictionary<string, int> ByStatus);

public record ExposureRowDto(string Key, int OpenClaims, decimal OutstandingAmount);
public record TeamMemberDto(int OfficerId, string Name, int OpenClaims, decimal Exposure, int DecidedLast30Days, double AvgDaysToDecision);

public record DashboardDto(
    int TotalClaims, int OpenClaims, int QueueSize, double ApprovalRatePct, double AvgDaysToDecision,
    decimal TotalOutstanding, DateTime? ExposureUpdatedAt,
    List<ExposureRowDto> ExposureByMarket, List<ExposureRowDto> ExposureByType,
    Dictionary<string, int> ByStatus, List<TeamMemberDto> Team, List<ClaimSummaryDto> HighValueOpen);

public record SystemInfoDto(string MessagingProvider, string Topic, int PendingOutbox, decimal ApprovalThreshold);
