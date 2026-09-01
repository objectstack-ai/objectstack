import { describe, it, expect } from 'vitest';
import {
  EventPriority,
  EVENT_PRIORITY_VALUES,
  EventMetadataSchema,
  EventSchema,
  EventHandlerSchema,
  EventRouteSchema,
  EventPersistenceSchema,
  EventTypeDefinitionSchema,
  EventQueueConfigSchema,
  EventReplayConfigSchema,
  EventSourcingConfigSchema,
  DeadLetterQueueEntrySchema,
  EventLogEntrySchema,
  EventWebhookConfigSchema,
  EventMessageQueueConfigSchema,
  RealTimeNotificationConfigSchema,
  EventBusConfigSchema,
  type Event,
  type EventHandler,
  type EventRoute,
  type EventPersistence,
  type EventTypeDefinition,
  type EventBusConfig,
} from './events.zod';

describe('EventPriority', () => {
  it('should accept valid event priorities', () => {
    expect(() => EventPriority.parse('critical')).not.toThrow();
    expect(() => EventPriority.parse('high')).not.toThrow();
    expect(() => EventPriority.parse('normal')).not.toThrow();
    expect(() => EventPriority.parse('low')).not.toThrow();
    expect(() => EventPriority.parse('background')).not.toThrow();
  });

  it('should have correct priority values', () => {
    expect(EVENT_PRIORITY_VALUES.critical).toBe(0);
    expect(EVENT_PRIORITY_VALUES.high).toBe(1);
    expect(EVENT_PRIORITY_VALUES.normal).toBe(2);
    expect(EVENT_PRIORITY_VALUES.low).toBe(3);
    expect(EVENT_PRIORITY_VALUES.background).toBe(4);
  });
});

describe('EventMetadataSchema', () => {
  it('should accept valid metadata', () => {
    const metadata = {
      source: 'user.plugin',
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => EventMetadataSchema.parse(metadata)).not.toThrow();
  });

  it('should accept metadata with optional fields', () => {
    const metadata = {
      source: 'system.core',
      timestamp: '2024-01-15T10:30:00Z',
      userId: 'user-123',
      tenantId: 'tenant-456',
      correlationId: 'corr-789',
      causationId: 'cause-456',
    };

    const parsed = EventMetadataSchema.parse(metadata);
    expect(parsed.userId).toBe('user-123');
    expect(parsed.tenantId).toBe('tenant-456');
    expect(parsed.correlationId).toBe('corr-789');
    expect(parsed.causationId).toBe('cause-456');
  });

  it('should apply default priority', () => {
    const metadata = EventMetadataSchema.parse({
      source: 'plugin',
      timestamp: '2024-01-15T10:30:00Z',
    });

    expect(metadata.priority).toBe('normal');
  });

  it('should accept different priorities', () => {
    const priorities: Array<Event['metadata']['priority']> = ['critical', 'high', 'normal', 'low', 'background'];
    priorities.forEach(priority => {
      const metadata = EventMetadataSchema.parse({
        source: 'plugin',
        timestamp: '2024-01-15T10:30:00Z',
        priority,
      });
      expect(metadata.priority).toBe(priority);
    });
  });

  it('should validate datetime format', () => {
    expect(() => EventMetadataSchema.parse({
      source: 'plugin',
      timestamp: 'not-a-datetime',
    })).toThrow();

    expect(() => EventMetadataSchema.parse({
      source: 'plugin',
      timestamp: '2024-01-15T10:30:00Z',
    })).not.toThrow();
  });

  it('should reject metadata without required fields', () => {
    expect(() => EventMetadataSchema.parse({
      timestamp: '2024-01-15T10:30:00Z',
    })).toThrow();

    expect(() => EventMetadataSchema.parse({
      source: 'plugin',
    })).toThrow();
  });
});

describe('EventSchema', () => {
  it('should accept valid minimal event', () => {
    const event: Event = {
      name: 'user.created',
      payload: { id: '123', email: 'user@example.com' },
      metadata: {
        source: 'auth.plugin',
        timestamp: '2024-01-15T10:30:00Z',
      },
    };

    expect(() => EventSchema.parse(event)).not.toThrow();
  });

  // [#13613] `name` carried `EventNameSchema`'s dot-notation grammar until
  // ADR-0049 enforce-or-remove retired it: no runtime consumer ever parsed
  // through this schema, and the platform-checked event vocabulary is the
  // closed `DataEventType` / `BulkDataEventType` enums (api/events.zod.ts).
  // This pin holds the WIDENING: spellings the retired grammar refused
  // (PascalCase, kebab-case, leading digit/dot) now parse — a regression to a
  // schema-level grammar here should be a deliberate ruling, not drift.
  it('accepts event names as plain strings — the dot-notation grammar is retired (#13613)', () => {
    const names = [
      // conventional dot-notation spellings (valid before and after)
      'user.created',
      'account.updated',
      'opportunity.stage.changed',
      'payment.webhook.received',
      'data_import.completed',
      // spellings the retired EventNameSchema grammar refused
      'User.Created', // PascalCase
      'user-created', // kebab-case
      'userCreated',  // camelCase
      '123.invalid',  // starts with number
      '.invalid',     // starts with dot
    ];

    names.forEach(name => {
      const event = {
        name,
        payload: {},
        metadata: {
          source: 'system',
          timestamp: '2024-01-15T10:30:00Z',
        },
      };
      expect(() => EventSchema.parse(event)).not.toThrow();
    });
  });

  it('should accept various payload types', () => {
    const payloads = [
      { id: '123', name: 'Test' },
      [1, 2, 3],
      'string payload',
      123,
      true,
      null,
    ];

    payloads.forEach(payload => {
      const event = {
        name: 'test.event',
        payload,
        metadata: { source: 'test', timestamp: '2024-01-15T10:30:00Z' },
      };
      expect(() => EventSchema.parse(event)).not.toThrow();
    });
  });

  it('should accept event with complete metadata', () => {
    const event = {
      name: 'order.completed',
      payload: { orderId: '789', total: 99.99 },
      metadata: {
        source: 'ecommerce.plugin',
        timestamp: '2024-01-15T10:30:00Z',
        userId: 'user-123',
        tenantId: 'tenant-456',
      },
    };

    const parsed = EventSchema.parse(event);
    expect(parsed.metadata.userId).toBe('user-123');
    expect(parsed.metadata.tenantId).toBe('tenant-456');
  });
});

describe('EventHandlerSchema', () => {
  it('should accept valid minimal event handler', () => {
    const handler: EventHandler = {
      eventName: 'user.created',
      handler: async () => {},
    };

    expect(() => EventHandlerSchema.parse(handler)).not.toThrow();
  });

  it('should apply default values', () => {
    const handler = EventHandlerSchema.parse({
      eventName: 'user.updated',
      handler: async () => {},
    });

    expect(handler.priority).toBe(0);
    expect(handler.async).toBe(true);
  });

  it('should accept handler with all fields', () => {
    const handler = {
      eventName: 'order.created',
      handler: async (event: Event) => {
        console.log(event.name);
      },
      priority: 10,
      async: false,
    };

    const parsed = EventHandlerSchema.parse(handler);
    expect(parsed.priority).toBe(10);
    expect(parsed.async).toBe(false);
  });

  it('should accept wildcard event patterns', () => {
    const patterns = [
      'user.*',
      '*.created',
      'account.*.*',
      '*',
    ];

    patterns.forEach(eventName => {
      const handler = {
        eventName,
        handler: async () => {},
      };
      expect(() => EventHandlerSchema.parse(handler)).not.toThrow();
    });
  });

  it('should accept different priority values', () => {
    const priorities = [-10, -1, 0, 1, 10, 100];

    priorities.forEach(priority => {
      const handler = {
        eventName: 'test.event',
        handler: async () => {},
        priority,
      };
      const parsed = EventHandlerSchema.parse(handler);
      expect(parsed.priority).toBe(priority);
    });
  });

  it('should accept async and sync handlers', () => {
    const asyncHandler = {
      eventName: 'async.event',
      handler: async () => {},
      async: true,
    };

    const syncHandler = {
      eventName: 'sync.event',
      handler: async () => {},
      async: false,
    };

    expect(() => EventHandlerSchema.parse(asyncHandler)).not.toThrow();
    expect(() => EventHandlerSchema.parse(syncHandler)).not.toThrow();
  });
});

describe('EventRouteSchema', () => {
  it('should accept valid minimal event route', () => {
    const route: EventRoute = {
      from: 'user.created',
      to: ['notification.send', 'analytics.track'],
    };

    expect(() => EventRouteSchema.parse(route)).not.toThrow();
  });

  it('should accept route with wildcard source', () => {
    const routes = [
      { from: 'user.*', to: ['audit.log'] },
      { from: '*.created', to: ['analytics.track'] },
      { from: '*', to: ['logger.log'] },
    ];

    routes.forEach(route => {
      expect(() => EventRouteSchema.parse(route)).not.toThrow();
    });
  });

  it('should accept route with transform function', () => {
    const route = {
      from: 'user.created',
      to: ['notification.send'],
      transform: (payload: any) => ({ ...payload, transformed: true }),
    };

    expect(() => EventRouteSchema.parse(route)).not.toThrow();
  });

  it('should accept multiple target events', () => {
    const route = {
      from: 'order.completed',
      to: [
        'email.send',
        'sms.send',
        'analytics.track',
        'inventory.update',
        'accounting.record',
      ],
    };

    const parsed = EventRouteSchema.parse(route);
    expect(parsed.to).toHaveLength(5);
  });

  it('should accept single target event', () => {
    const route = {
      from: 'payment.received',
      to: ['invoice.mark_paid'],
    };

    expect(() => EventRouteSchema.parse(route)).not.toThrow();
  });

  it('should reject route without required fields', () => {
    expect(() => EventRouteSchema.parse({
      to: ['target.event'],
    })).toThrow();

    expect(() => EventRouteSchema.parse({
      from: 'source.event',
    })).toThrow();
  });
});

describe('EventPersistenceSchema', () => {
  it('should accept valid minimal persistence config', () => {
    const config: EventPersistence = {
      enabled: true,
      retention: 30,
    };

    expect(() => EventPersistenceSchema.parse(config)).not.toThrow();
  });

  it('should apply default values', () => {
    const config = EventPersistenceSchema.parse({
      retention: 30,
    });

    expect(config.enabled).toBe(false);
  });

  it('should accept config with all fields', () => {
    const config = {
      enabled: true,
      retention: 90,
      filter: (event: Event) => event.name.startsWith('audit.'),
    };

    const parsed = EventPersistenceSchema.parse(config);
    expect(parsed.enabled).toBe(true);
    expect(parsed.retention).toBe(90);
    expect(parsed.filter).toBeDefined();
  });

  it('should accept different retention periods', () => {
    const retentions = [1, 7, 30, 90, 365];

    retentions.forEach(retention => {
      const config = { enabled: true, retention };
      const parsed = EventPersistenceSchema.parse(config);
      expect(parsed.retention).toBe(retention);
    });
  });

  it('should reject negative retention', () => {
    expect(() => EventPersistenceSchema.parse({
      enabled: true,
      retention: -1,
    })).toThrow();

    expect(() => EventPersistenceSchema.parse({
      enabled: true,
      retention: 0,
    })).toThrow();
  });

  it('should accept filter function', () => {
    const config = {
      enabled: true,
      retention: 60,
      filter: (event: Event) => {
        return event.name.startsWith('critical.') || 
               event.metadata.source === 'security.plugin';
      },
    };

    expect(() => EventPersistenceSchema.parse(config)).not.toThrow();
  });

  it('should handle disabled persistence', () => {
    const config = {
      enabled: false,
      retention: 30,
    };

    const parsed = EventPersistenceSchema.parse(config);
    expect(parsed.enabled).toBe(false);
  });
});

describe('Event System Integration', () => {
  it('should handle complete event lifecycle', () => {
    // Create an event
    const event: Event = {
      name: 'user.registered',
      payload: {
        userId: 'user-123',
        email: 'user@example.com',
        timestamp: Date.now(),
      },
      metadata: {
        source: 'auth.service',
        timestamp: '2024-01-15T10:30:00Z',
        userId: 'system',
      },
    };

    expect(() => EventSchema.parse(event)).not.toThrow();

    // Create handlers for the event
    const handlers: EventHandler[] = [
      {
        eventName: 'user.registered',
        handler: async () => { /* send welcome email */ },
        priority: 1,
      },
      {
        eventName: 'user.*',
        handler: async () => { /* track analytics */ },
        priority: 2,
      },
    ];

    handlers.forEach(handler => {
      expect(() => EventHandlerSchema.parse(handler)).not.toThrow();
    });

    // Create routes
    const route: EventRoute = {
      from: 'user.registered',
      to: ['email.welcome', 'analytics.track'],
    };

    expect(() => EventRouteSchema.parse(route)).not.toThrow();

    // Configure persistence
    const persistence: EventPersistence = {
      enabled: true,
      retention: 90,
      filter: (e: Event) => e.name.startsWith('user.'),
    };

    expect(() => EventPersistenceSchema.parse(persistence)).not.toThrow();
  });
});

describe('EventTypeDefinitionSchema', () => {
  it('should accept valid event type definition', () => {
    const eventType: EventTypeDefinition = {
      name: 'order.created',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          customerId: { type: 'string' },
          total: { type: 'number' },
        },
      },
    };

    expect(() => EventTypeDefinitionSchema.parse(eventType)).not.toThrow();
  });

  it('should apply default values', () => {
    const eventType = EventTypeDefinitionSchema.parse({
      name: 'user.created',
    });

    expect(eventType.version).toBe('1.0.0');
    expect(eventType.deprecated).toBe(false);
  });
});

describe('EventQueueConfigSchema', () => {
  it('should accept queue config', () => {
    const config = {
      name: 'events',
      concurrency: 20,
      retryPolicy: {
        maxRetries: 5,
        backoffStrategy: 'exponential',
      },
      deadLetterQueue: 'failed_events',
    };

    const parsed = EventQueueConfigSchema.parse(config);
    expect(parsed.concurrency).toBe(20);
  });

  it('should apply default values', () => {
    const config = EventQueueConfigSchema.parse({});
    expect(config.name).toBe('events');
    expect(config.concurrency).toBe(10);
    expect(config.priorityEnabled).toBe(true);
  });
});

describe('EventReplayConfigSchema', () => {
  it('should accept replay config', () => {
    const config = {
      fromTimestamp: '2024-01-01T00:00:00Z',
      toTimestamp: '2024-01-31T23:59:59Z',
      eventTypes: ['order.created', 'order.updated'],
      speed: 10,
    };

    const parsed = EventReplayConfigSchema.parse(config);
    expect(parsed.speed).toBe(10);
    expect(parsed.eventTypes).toHaveLength(2);
  });

  it('should apply default speed', () => {
    const config = EventReplayConfigSchema.parse({
      fromTimestamp: '2024-01-01T00:00:00Z',
    });

    expect(config.speed).toBe(1);
  });
});

describe('EventSourcingConfigSchema', () => {
  it('should accept event sourcing config', () => {
    const config = {
      enabled: true,
      snapshotInterval: 100,
      retention: 365,
      aggregateTypes: ['order', 'customer'],
    };

    const parsed = EventSourcingConfigSchema.parse(config);
    expect(parsed.snapshotInterval).toBe(100);
  });

  it('should apply defaults', () => {
    const config = EventSourcingConfigSchema.parse({});
    expect(config.enabled).toBe(false);
    expect(config.snapshotInterval).toBe(100);
    expect(config.snapshotRetention).toBe(10);
    expect(config.retention).toBe(365);
  });
});

describe('DeadLetterQueueEntrySchema', () => {
  it('should accept dead letter queue entry', () => {
    const entry = {
      id: 'dlq-123',
      event: {
        name: 'user.created',
        payload: { userId: '123' },
        metadata: {
          source: 'system',
          timestamp: '2024-01-15T10:00:00Z',
        },
      },
      error: {
        message: 'Handler timeout',
        code: 'TIMEOUT',
      },
      retries: 3,
      firstFailedAt: '2024-01-15T10:00:00Z',
      lastFailedAt: '2024-01-15T10:30:00Z',
      failedHandler: 'email_handler',
    };

    expect(() => DeadLetterQueueEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('EventLogEntrySchema', () => {
  it('should accept event log entry', () => {
    const log = {
      id: 'log-123',
      event: {
        name: 'order.created',
        payload: { orderId: '789' },
        metadata: {
          source: 'ecommerce',
          timestamp: '2024-01-15T10:00:00Z',
        },
      },
      status: 'completed',
      handlersExecuted: [
        {
          handlerId: 'email_handler',
          status: 'success',
          durationMs: 150,
        },
        {
          handlerId: 'analytics_handler',
          status: 'success',
          durationMs: 80,
        },
      ],
      receivedAt: '2024-01-15T10:00:00Z',
      processedAt: '2024-01-15T10:00:01Z',
      totalDurationMs: 1000,
    };

    const parsed = EventLogEntrySchema.parse(log);
    expect(parsed.handlersExecuted).toHaveLength(2);
  });
});

describe('EventWebhookConfigSchema', () => {
  it('should accept webhook config', () => {
    const webhook = {
      eventPattern: 'order.*',
      url: 'https://api.example.com/webhooks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authentication: {
        type: 'bearer',
        credentials: { token: 'secret' },
      },
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
      },
      timeoutMs: 30000,
    };

    const parsed = EventWebhookConfigSchema.parse(webhook);
    expect(parsed.method).toBe('POST');
    expect(parsed.timeoutMs).toBe(30000);
  });

  it('should apply defaults', () => {
    const webhook = EventWebhookConfigSchema.parse({
      eventPattern: 'test.*',
      url: 'https://example.com/hook',
    });

    expect(webhook.method).toBe('POST');
    expect(webhook.timeoutMs).toBe(30000);
    expect(webhook.enabled).toBe(true);
  });
});

describe('EventMessageQueueConfigSchema', () => {
  it('should accept message queue config', () => {
    const config = {
      provider: 'kafka',
      topic: 'events',
      eventPattern: 'order.*',
      partitionKey: 'metadata.tenantId',
      format: 'json',
      compression: 'gzip',
      batchSize: 100,
    };

    const parsed = EventMessageQueueConfigSchema.parse(config);
    expect(parsed.provider).toBe('kafka');
    expect(parsed.batchSize).toBe(100);
  });

  it('should apply defaults', () => {
    const config = EventMessageQueueConfigSchema.parse({
      provider: 'rabbitmq',
      topic: 'events',
    });

    expect(config.eventPattern).toBe('*');
    expect(config.format).toBe('json');
    expect(config.compression).toBe('none');
    expect(config.batchSize).toBe(1);
  });
});

describe('RealTimeNotificationConfigSchema', () => {
  it('should accept realtime config', () => {
    const config = {
      enabled: true,
      protocol: 'websocket',
      eventPattern: 'notification.*',
      userFilter: true,
      tenantFilter: true,
      channels: [
        {
          name: 'notifications',
          eventPattern: 'notification.*',
        },
      ],
      rateLimit: {
        maxEventsPerSecond: 100,
        windowMs: 1000,
      },
    };

    const parsed = RealTimeNotificationConfigSchema.parse(config);
    expect(parsed.protocol).toBe('websocket');
    expect(parsed.channels).toHaveLength(1);
  });

  it('should apply defaults', () => {
    const config = RealTimeNotificationConfigSchema.parse({});

    expect(config.enabled).toBe(true);
    expect(config.protocol).toBe('websocket');
    expect(config.eventPattern).toBe('*');
    expect(config.userFilter).toBe(true);
    expect(config.tenantFilter).toBe(true);
  });
});

describe('EventBusConfigSchema', () => {
  it('should accept complete event bus config', () => {
    const config: EventBusConfig = {
      persistence: {
        enabled: true,
        retention: 365,
      },
      queue: {
        concurrency: 20,
        priorityEnabled: true,
      },
      eventSourcing: {
        enabled: true,
        snapshotInterval: 100,
      },
      webhooks: [
        {
          eventPattern: 'order.*',
          url: 'https://example.com/webhook',
        },
      ],
      messageQueue: {
        provider: 'kafka',
        topic: 'events',
      },
      realtime: {
        enabled: true,
        protocol: 'websocket',
      },
    };

    expect(() => EventBusConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept minimal config', () => {
    const config = EventBusConfigSchema.parse({});
    expect(config).toBeDefined();
  });
});

describe('Enhanced Event Handler', () => {
  it('should accept handler with retry and timeout', () => {
    const handler = {
      eventName: 'user.created',
      handler: async () => {},
      priority: 1,
      async: true,
      retry: {
        maxRetries: 5,
        backoffMs: 2000,
        backoffMultiplier: 3,
      },
      timeoutMs: 30000,
    };

    const parsed = EventHandlerSchema.parse(handler);
    expect(parsed.retry?.maxRetries).toBe(5);
    expect(parsed.timeoutMs).toBe(30000);
  });

  it('should accept handler with filter function', () => {
    const handler = {
      eventName: 'order.*',
      handler: async () => {},
      filter: (event: Event) => event.metadata.priority === 'critical',
    };

    expect(() => EventHandlerSchema.parse(handler)).not.toThrow();
  });
});
