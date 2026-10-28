using System.Text;
using System.Threading.Channels;
using ClaimsPlatform.Api.Domain;
using Confluent.Kafka;
using Confluent.Kafka.Admin;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ClaimsPlatform.Api.Infrastructure;

public static class MessagingExtensions
{
    /// <summary>
    /// Wires up the event pipeline. The rest of the app only knows IEventPublisher + IClaimEventHandler,
    /// so switching Messaging:Provider between "InMemory" and "Kafka" changes nothing else.
    /// </summary>
    public static IServiceCollection AddClaimEventing(this IServiceCollection services, IConfiguration config)
    {
        var opts = new MessagingOptions();
        config.GetSection(MessagingOptions.Section).Bind(opts);
        services.Configure<MessagingOptions>(config.GetSection(MessagingOptions.Section));

        services.AddScoped<IClaimEventHandler, NotificationHandler>();
        services.AddScoped<IClaimEventHandler, ExposureProjectionHandler>();
        services.AddSingleton<EventDispatcher>();
        services.AddHostedService<OutboxDispatcher>();

        if (opts.IsKafka)
        {
            services.AddSingleton<IEventPublisher, KafkaEventPublisher>();
            services.AddHostedService<KafkaEventConsumer>();
        }
        else
        {
            services.AddSingleton<InMemoryEventBus>();
            services.AddSingleton<IEventPublisher>(sp => sp.GetRequiredService<InMemoryEventBus>());
            services.AddHostedService<InMemoryEventConsumer>();
        }
        return services;
    }
}

/// <summary>Resolves handlers in a fresh scope and runs them. Shared by both consumers.</summary>
public class EventDispatcher
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<EventDispatcher> _log;

    public EventDispatcher(IServiceScopeFactory scopes, ILogger<EventDispatcher> log)
    {
        _scopes = scopes;
        _log = log;
    }

    /// <summary>Handles one event with a small retry budget. Returns true when processed.</summary>
    public async Task<bool> DispatchWithRetryAsync(string payload, CancellationToken ct)
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                var evt = EventJson.Deserialize(payload);
                if (evt is null) return true; // unreadable - nothing we can do, don't block the stream

                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ClaimsDbContext>();
                foreach (var handler in scope.ServiceProvider.GetServices<IClaimEventHandler>())
                    await handler.HandleAsync(evt, db, ct);

                _log.LogInformation("Processed {Type} for {Claim}", evt.Type, evt.ClaimNumber);
                return true;
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Event handling failed (attempt {Attempt}/3)", attempt);
                await Task.Delay(TimeSpan.FromMilliseconds(250 * attempt), ct);
            }
        }
        _log.LogError("Giving up on event after 3 attempts (a real system would route this to a dead-letter topic): {Payload}", payload);
        return false;
    }
}

/// <summary>
/// Transactional outbox relay. Business changes and their events are committed atomically by the
/// ClaimService; this service then ships committed events to the broker (at-least-once, ordered by id).
/// </summary>
public class OutboxDispatcher : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IEventPublisher _publisher;
    private readonly ILogger<OutboxDispatcher> _log;

    public OutboxDispatcher(IServiceScopeFactory scopes, IEventPublisher publisher, ILogger<OutboxDispatcher> log)
    {
        _scopes = scopes;
        _publisher = publisher;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // let the app finish migrating / seeding the database first
        try { await Task.Delay(1000, ct); } catch (OperationCanceledException) { return; }

        while (!ct.IsCancellationRequested)
        {
            var sent = 0;
            try
            {
                sent = await DispatchBatchAsync(ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Outbox dispatch failed - will retry. Events stay safely in the outbox.");
                try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { break; }
            }

            if (sent == 0)
            {
                try { await Task.Delay(300, ct); } catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task<int> DispatchBatchAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClaimsDbContext>();

        var batch = await db.Outbox
            .Where(m => m.DispatchedAt == null)
            .OrderBy(m => m.Id)
            .Take(50)
            .ToListAsync(ct);

        var count = 0;
        foreach (var msg in batch)
        {
            await _publisher.PublishAsync(new EventEnvelope(msg.EventId, msg.Type, msg.Key, msg.Payload), ct);
            msg.DispatchedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            count++;
        }
        return count;
    }
}

// ───────────────────────── In-memory provider (no infrastructure needed) ─────────────────────────

public class InMemoryEventBus : IEventPublisher
{
    private readonly Channel<EventEnvelope> _channel = Channel.CreateUnbounded<EventEnvelope>();
    public ChannelReader<EventEnvelope> Reader => _channel.Reader;

    public async Task PublishAsync(EventEnvelope envelope, CancellationToken ct) =>
        await _channel.Writer.WriteAsync(envelope, ct);
}

public class InMemoryEventConsumer : BackgroundService
{
    private readonly InMemoryEventBus _bus;
    private readonly EventDispatcher _dispatcher;

    public InMemoryEventConsumer(InMemoryEventBus bus, EventDispatcher dispatcher)
    {
        _bus = bus;
        _dispatcher = dispatcher;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var env in _bus.Reader.ReadAllAsync(ct))
                await _dispatcher.DispatchWithRetryAsync(env.Payload, ct);
        }
        catch (OperationCanceledException) { /* shutting down */ }
    }
}

// ───────────────────────── Kafka provider ─────────────────────────

public sealed class KafkaEventPublisher : IEventPublisher, IDisposable
{
    private readonly IProducer<string, string> _producer;
    private readonly string _topic;

    public KafkaEventPublisher(IOptions<MessagingOptions> options)
    {
        var o = options.Value;
        _topic = o.Topic;
        _producer = new ProducerBuilder<string, string>(new ProducerConfig
        {
            BootstrapServers = o.BootstrapServers,
            Acks = Acks.All,
            EnableIdempotence = true,
            MessageTimeoutMs = 8000
        }).Build();
    }

    public async Task PublishAsync(EventEnvelope envelope, CancellationToken ct)
    {
        var message = new Message<string, string>
        {
            // Keyed by claim id => all events of one claim land on one partition => per-claim ordering.
            Key = envelope.Key,
            Value = envelope.Payload,
            Headers = new Headers
            {
                { "event-type", Encoding.UTF8.GetBytes(envelope.Type) },
                { "event-id", Encoding.UTF8.GetBytes(envelope.EventId.ToString()) }
            }
        };
        await _producer.ProduceAsync(_topic, message, ct);
    }

    public void Dispose()
    {
        _producer.Flush(TimeSpan.FromSeconds(3));
        _producer.Dispose();
    }
}

public sealed class KafkaEventConsumer : BackgroundService
{
    private readonly MessagingOptions _o;
    private readonly EventDispatcher _dispatcher;
    private readonly ILogger<KafkaEventConsumer> _log;

    public KafkaEventConsumer(IOptions<MessagingOptions> options, EventDispatcher dispatcher, ILogger<KafkaEventConsumer> log)
    {
        _o = options.Value;
        _dispatcher = dispatcher;
        _log = log;
    }

    // Consume() blocks, so run on a dedicated pool thread instead of blocking host start-up.
    protected override Task ExecuteAsync(CancellationToken ct) => Task.Run(() => RunAsync(ct), ct);

    private async Task RunAsync(CancellationToken ct)
    {
        try
        {
            await EnsureTopicAsync(ct);

            var config = new ConsumerConfig
            {
                BootstrapServers = _o.BootstrapServers,
                GroupId = _o.GroupId,
                AutoOffsetReset = AutoOffsetReset.Earliest,
                EnableAutoCommit = false // we commit only after the handlers succeeded => at-least-once
            };

            using var consumer = new ConsumerBuilder<string, string>(config)
                .SetErrorHandler((_, e) => _log.LogWarning("Kafka: {Reason}", e.Reason))
                .Build();
            consumer.Subscribe(_o.Topic);
            _log.LogInformation("Kafka consumer subscribed to '{Topic}' as group '{Group}'", _o.Topic, _o.GroupId);

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var result = consumer.Consume(TimeSpan.FromSeconds(1));
                    if (result?.Message is null) continue;

                    await _dispatcher.DispatchWithRetryAsync(result.Message.Value, ct);
                    consumer.Commit(result);
                }
                catch (ConsumeException ex)
                {
                    _log.LogWarning("Kafka consume error: {Reason}", ex.Error.Reason);
                    await Task.Delay(2000, ct);
                }
            }
            consumer.Close();
        }
        catch (OperationCanceledException) { /* shutting down */ }
        catch (Exception ex)
        {
            _log.LogError(ex, "Kafka consumer stopped unexpectedly");
        }
    }

    private async Task EnsureTopicAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var admin = new AdminClientBuilder(new AdminClientConfig { BootstrapServers = _o.BootstrapServers }).Build();
                await admin.CreateTopicsAsync(new[]
                {
                    new TopicSpecification { Name = _o.Topic, NumPartitions = 3, ReplicationFactor = 1 }
                });
                _log.LogInformation("Created Kafka topic '{Topic}'", _o.Topic);
                return;
            }
            catch (CreateTopicsException ex) when (ex.Results.All(r => r.Error.Code == ErrorCode.TopicAlreadyExists))
            {
                return; // already there - good
            }
            catch (Exception ex)
            {
                _log.LogWarning("Kafka not reachable at {Servers} ({Msg}). Retrying in 3s...", _o.BootstrapServers, ex.Message);
                await Task.Delay(3000, ct);
            }
        }
    }
}
