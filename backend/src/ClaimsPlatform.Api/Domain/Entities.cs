namespace ClaimsPlatform.Api.Domain;

public class AppUser
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public UserRole Role { get; set; }
    public Market? Market { get; set; }
}

public class Claim
{
    public int Id { get; set; }
    public string ClaimNumber { get; set; } = "";
    public ClaimType Type { get; set; }
    public Market Market { get; set; }
    public ClaimStatus Status { get; set; } = ClaimStatus.Submitted;

    public string PolicyNumber { get; set; } = "";
    public DateTime IncidentDate { get; set; }
    public string Location { get; set; } = "";
    public string Description { get; set; } = "";

    /// <summary>All money is held in a single reporting currency (USD) - a deliberate simplification.</summary>
    public decimal ClaimedAmount { get; set; }
    public decimal? AssessedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public string? DecisionReason { get; set; }

    public int ClaimantId { get; set; }
    public AppUser? Claimant { get; set; }
    public int? AssignedOfficerId { get; set; }
    public AppUser? AssignedOfficer { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DecidedAt { get; set; }

    /// <summary>Optimistic concurrency token - two officers can't silently overwrite each other.</summary>
    public int Version { get; set; }

    public List<ClaimHistory> History { get; set; } = new();
    public List<InfoRequest> InfoRequests { get; set; } = new();
    public List<ClaimNote> Notes { get; set; } = new();

    /// <summary>The amount we currently believe we may have to pay. Drives exposure reporting.</summary>
    public decimal ExposureAmount => ApprovedAmount ?? AssessedAmount ?? ClaimedAmount;
}

public class ClaimHistory
{
    public int Id { get; set; }
    public int ClaimId { get; set; }
    public ClaimStatus? FromStatus { get; set; }
    public ClaimStatus ToStatus { get; set; }
    public string Action { get; set; } = "";
    public string? Comment { get; set; }
    public int ActorId { get; set; }
    public string ActorName { get; set; } = "";
    public DateTime At { get; set; }
}

public class InfoRequest
{
    public int Id { get; set; }
    public int ClaimId { get; set; }
    public string Message { get; set; } = "";
    public int RequestedById { get; set; }
    public string RequestedByName { get; set; } = "";
    public DateTime RequestedAt { get; set; }
    public string? Response { get; set; }
    public DateTime? RespondedAt { get; set; }
}

/// <summary>Internal note - visible to staff only.</summary>
public class ClaimNote
{
    public int Id { get; set; }
    public int ClaimId { get; set; }
    public string Text { get; set; } = "";
    public int AuthorId { get; set; }
    public string AuthorName { get; set; } = "";
    public DateTime At { get; set; }
}

public class Notification
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int? ClaimId { get; set; }
    public string ClaimNumber { get; set; } = "";
    public string Message { get; set; } = "";
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>Source event - (EventId, UserId) is unique so redelivery can't create duplicates.</summary>
    public Guid EventId { get; set; }
}

/// <summary>Read model maintained asynchronously from claim events.</summary>
public class ExposureProjection
{
    public int Id { get; set; }
    public Market Market { get; set; }
    public ClaimType Type { get; set; }
    public int OpenClaims { get; set; }
    public decimal OutstandingAmount { get; set; }
    public decimal ClaimedAmount { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Transactional outbox: written in the same DB transaction as the state change.</summary>
public class OutboxMessage
{
    public long Id { get; set; }
    public Guid EventId { get; set; }
    public string Type { get; set; } = "";
    public string Key { get; set; } = "";
    public string Payload { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? DispatchedAt { get; set; }
}


/// <summary>Uploaded evidence associated with a claim. File bytes are stored outside the database.</summary>
public class ClaimDocument
{
    public int Id { get; set; }
    public int ClaimId { get; set; }
    public int UploadedById { get; set; }
    public string UploadedByName { get; set; } = "";
    public string OriginalFileName { get; set; } = "";
    public string StoredFileName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public long SizeBytes { get; set; }
    public DateTime UploadedAt { get; set; }
}
