using System.Text.Json;
using ClaimsPlatform.Api.Domain;
using ClaimsPlatform.Api.Infrastructure;
using Xunit;

namespace ClaimsPlatform.Tests;

/// <summary>
/// The event payload is the contract between the API (producer) and every consumer (notifications, the exposure
/// projection, and anything a future team adds on the Kafka topic). These tests pin its wire format.
/// </summary>
public class EventContractTests
{
    private static ClaimEvent Sample(
        string type = ClaimEventTypes.Assessed, ClaimStatus? from = ClaimStatus.UnderReview, decimal? amount = 12345.67m,
        string? detail = "Repair estimate verified") =>
        new(
            EventId: Guid.Parse("11111111-2222-3333-4444-555555555555"),
            Type: type, ClaimId: 42, ClaimNumber: "CLM-2026-000042", Market: Market.SG, ClaimType: ClaimType.Motor,
            FromStatus: from, ToStatus: ClaimStatus.Assessed, ClaimantId: 1, AssignedOfficerId: 5,
            ActorName: "Priya Sharma", Amount: amount, Detail: detail,
            OccurredAt: new DateTime(2026, 10, 28, 8, 30, 15, DateTimeKind.Utc));

    // ───────────── event type names ─────────────

    [Fact]
    public void There_are_ten_event_types_with_unique_wire_names()
    {
        var names = new[]
        {
            ClaimEventTypes.Submitted, ClaimEventTypes.Assigned, ClaimEventTypes.InfoRequested, ClaimEventTypes.InfoProvided,
            ClaimEventTypes.Assessed, ClaimEventTypes.Reopened, ClaimEventTypes.Approved, ClaimEventTypes.Rejected,
            ClaimEventTypes.Settled, ClaimEventTypes.Withdrawn,
        };
        Assert.Equal(10, names.Distinct().Count());
    }

    [Fact]
    public void Event_type_strings_are_the_documented_names()
    {
        Assert.Equal("ClaimSubmitted", ClaimEventTypes.Submitted);
        Assert.Equal("ClaimAssigned", ClaimEventTypes.Assigned);
        Assert.Equal("InfoRequested", ClaimEventTypes.InfoRequested);
        Assert.Equal("InfoProvided", ClaimEventTypes.InfoProvided);
        Assert.Equal("ClaimAssessed", ClaimEventTypes.Assessed);
        Assert.Equal("ClaimReopened", ClaimEventTypes.Reopened);
        Assert.Equal("ClaimApproved", ClaimEventTypes.Approved);
        Assert.Equal("ClaimRejected", ClaimEventTypes.Rejected);
        Assert.Equal("ClaimSettled", ClaimEventTypes.Settled);
        Assert.Equal("ClaimWithdrawn", ClaimEventTypes.Withdrawn);
    }

    // ───────────── JSON wire format ─────────────

    [Fact]
    public void Properties_are_camelCase_and_enums_are_strings()
    {
        var json = EventJson.Serialize(Sample());
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("ClaimAssessed", root.GetProperty("type").GetString());
        Assert.Equal(42, root.GetProperty("claimId").GetInt32());
        Assert.Equal("CLM-2026-000042", root.GetProperty("claimNumber").GetString());
        Assert.Equal("SG", root.GetProperty("market").GetString());
        Assert.Equal("Motor", root.GetProperty("claimType").GetString());
        Assert.Equal("UnderReview", root.GetProperty("fromStatus").GetString());
        Assert.Equal("Assessed", root.GetProperty("toStatus").GetString());
        Assert.Equal("Priya Sharma", root.GetProperty("actorName").GetString());
        Assert.Equal(12345.67m, root.GetProperty("amount").GetDecimal());
    }

    [Fact]
    public void Nullable_fields_are_written_as_null_not_omitted()
    {
        var json = EventJson.Serialize(Sample(from: null, amount: null, detail: null));
        using var doc = JsonDocument.Parse(json);
        foreach (var name in new[] { "fromStatus", "amount", "detail" })
            Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty(name).ValueKind);
    }

    [Fact]
    public void Timestamps_are_ISO_8601_in_UTC()
    {
        var json = EventJson.Serialize(Sample());
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("2026-10-28T08:30:15Z", doc.RootElement.GetProperty("occurredAt").GetString());
    }

    [Fact]
    public void An_event_survives_a_round_trip()
    {
        var original = Sample();
        var copy = EventJson.Deserialize(EventJson.Serialize(original));
        Assert.Equal(original, copy);
    }

    [Fact]
    public void Round_trip_works_for_every_event_type_and_status_combination()
    {
        foreach (var type in new[] { ClaimEventTypes.Submitted, ClaimEventTypes.Approved, ClaimEventTypes.Withdrawn })
            foreach (var from in new ClaimStatus?[] { null, ClaimStatus.Submitted, ClaimStatus.Assessed })
            {
                var e = Sample(type, from);
                Assert.Equal(e, EventJson.Deserialize(EventJson.Serialize(e)));
            }
    }

    [Fact]
    public void Money_keeps_its_exact_decimal_value()
    {
        var copy = EventJson.Deserialize(EventJson.Serialize(Sample(amount: 99999.99m)));
        Assert.Equal(99999.99m, copy!.Amount);
    }

    [Fact]
    public void Consumers_ignore_fields_they_do_not_know_yet()
    {
        // forward compatibility: the producer can add a field without breaking older consumers
        var json = EventJson.Serialize(Sample()).TrimEnd('}') + ",\"someFutureField\":{\"nested\":true}}";
        var copy = EventJson.Deserialize(json);
        Assert.Equal(42, copy!.ClaimId);
    }

    [Fact]
    public void Property_names_are_matched_case_insensitively()
    {
        var json = EventJson.Serialize(Sample()).Replace("\"claimId\"", "\"ClaimId\"");
        Assert.Equal(42, EventJson.Deserialize(json)!.ClaimId);
    }

    [Fact]
    public void A_literal_null_payload_deserializes_to_null_which_the_dispatcher_skips()
    {
        Assert.Null(EventJson.Deserialize("null"));
    }

    [Fact]
    public void Garbage_is_reported_as_a_JsonException()
    {
        Assert.ThrowsAny<JsonException>(() => EventJson.Deserialize("this is not json"));
    }

    [Fact]
    public void An_unknown_enum_value_is_rejected_rather_than_silently_mapped()
    {
        var json = EventJson.Serialize(Sample()).Replace("\"SG\"", "\"MARS\"");
        Assert.ThrowsAny<JsonException>(() => EventJson.Deserialize(json));
    }

    [Fact]
    public void The_serializer_options_are_shared_and_use_web_defaults()
    {
        Assert.True(EventJson.Options.PropertyNameCaseInsensitive);
        Assert.Equal(JsonNamingPolicy.CamelCase, EventJson.Options.PropertyNamingPolicy);
    }

    // ───────────── envelope ─────────────

    [Fact]
    public void The_transport_envelope_is_the_same_for_every_provider()
    {
        var id = Guid.NewGuid();
        var env = new EventEnvelope(id, ClaimEventTypes.Settled, "42", "{}");
        Assert.Equal(id, env.EventId);
        Assert.Equal("ClaimSettled", env.Type);
        Assert.Equal("42", env.Key);      // keyed by claim id => per-claim ordering on a Kafka partition
        Assert.Equal("{}", env.Payload);
        Assert.Equal(env, new EventEnvelope(id, ClaimEventTypes.Settled, "42", "{}"));
    }

    // ───────────── messaging options (the "with or without Kafka" switch) ─────────────

    [Fact]
    public void Messaging_defaults_work_with_zero_infrastructure()
    {
        var o = new MessagingOptions();
        Assert.Equal("InMemory", o.Provider);
        Assert.False(o.IsKafka);
        Assert.Equal("localhost:9092", o.BootstrapServers);
        Assert.Equal("claims.events", o.Topic);
        Assert.Equal("claims-platform-projections", o.GroupId);
        Assert.Equal("Messaging", MessagingOptions.Section);
    }

    [Theory]
    [InlineData("Kafka", true)]
    [InlineData("kafka", true)]
    [InlineData("KAFKA", true)]
    [InlineData("InMemory", false)]
    [InlineData("inmemory", false)]
    [InlineData("", false)]
    [InlineData("Kafkaesque", false)]
    [InlineData("RabbitMQ", false)]
    public void Provider_switch_is_case_insensitive_and_defaults_to_in_memory(string provider, bool expectedKafka)
    {
        Assert.Equal(expectedKafka, new MessagingOptions { Provider = provider }.IsKafka);
    }
}
