using System.Text.Json;
using System.Text.Json.Serialization;
using ClaimsPlatform.Api.Domain;

namespace ClaimsPlatform.Api.Infrastructure;

public static class ClaimEventTypes
{
    public const string Submitted = "ClaimSubmitted";
    public const string Assigned = "ClaimAssigned";
    public const string InfoRequested = "InfoRequested";
    public const string InfoProvided = "InfoProvided";
    public const string Assessed = "ClaimAssessed";
    public const string Reopened = "ClaimReopened";
    public const string Approved = "ClaimApproved";
    public const string Rejected = "ClaimRejected";
    public const string Settled = "ClaimSettled";
    public const string Withdrawn = "ClaimWithdrawn";
}

/// <summary>Domain event payload (what happened to a claim). Carries enough context that consumers never call back.</summary>
public record ClaimEvent(
    Guid EventId,
    string Type,
    int ClaimId,
    string ClaimNumber,
    Market Market,
    ClaimType ClaimType,
    ClaimStatus? FromStatus,
    ClaimStatus ToStatus,
    int ClaimantId,
    int? AssignedOfficerId,
    string ActorName,
    decimal? Amount,
    string? Detail,
    DateTime OccurredAt);

/// <summary>Transport envelope - identical for in-memory and Kafka.</summary>
public record EventEnvelope(Guid EventId, string Type, string Key, string Payload);

public static class EventJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    public static string Serialize(ClaimEvent e) => JsonSerializer.Serialize(e, Options);
    public static ClaimEvent? Deserialize(string json) => JsonSerializer.Deserialize<ClaimEvent>(json, Options);
}

public class MessagingOptions
{
    public const string Section = "Messaging";
    /// <summary>"InMemory" (default - no infrastructure needed) or "Kafka".</summary>
    public string Provider { get; set; } = "InMemory";
    public string BootstrapServers { get; set; } = "localhost:9092";
    public string Topic { get; set; } = "claims.events";
    public string GroupId { get; set; } = "claims-platform-projections";
    public bool IsKafka => string.Equals(Provider, "Kafka", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Publishing side. Implementations: <see cref="InMemoryEventBus"/> and <see cref="KafkaEventPublisher"/>.</summary>
public interface IEventPublisher
{
    Task PublishAsync(EventEnvelope envelope, CancellationToken ct);
}

/// <summary>Something that reacts to a claim event. Handlers must be idempotent (delivery is at-least-once).</summary>
public interface IClaimEventHandler
{
    string Name { get; }
    Task HandleAsync(ClaimEvent e, ClaimsDbContext db, CancellationToken ct);
}
