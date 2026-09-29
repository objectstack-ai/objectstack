import { describe, it, expect } from 'vitest';
import {
  TransportProtocol,
  RealtimeEventType,
  SubscriptionEventSchema,
  SubscriptionSchema,
  RealtimePresenceSchema,
  RealtimeEventSchema,
  type Subscription,
  type RealtimePresence,
  type RealtimeEvent,
} from './realtime.zod';
import { PresenceStatus, RealtimeRecordAction } from './realtime-shared.zod';
import { BulkDataEventType, DataEventType } from './events.zod';

describe('TransportProtocol', () => {
  it('should accept valid transport protocols', () => {
    expect(() => TransportProtocol.parse('websocket')).not.toThrow();
    expect(() => TransportProtocol.parse('sse')).not.toThrow();
    expect(() => TransportProtocol.parse('polling')).not.toThrow();
  });

  it('should reject invalid transport protocols', () => {
    expect(() => TransportProtocol.parse('http')).toThrow();
    expect(() => TransportProtocol.parse('grpc')).toThrow();
    expect(() => TransportProtocol.parse('')).toThrow();
  });
});

describe('RealtimeEventType', () => {
  it('names exactly the record-change events the runtime emits (DataEventType + BulkDataEventType)', () => {
    // The ObjectQL engine parses every data event it publishes through
    // DataEventSchema / BulkDataEventSchema, so these two enums ARE the emitted
    // set. A name added to or dropped from either one turns this red here.
    expect([...RealtimeEventType.options].sort()).toEqual(
      [...DataEventType.options, ...BulkDataEventType.options].sort(),
    );
    for (const emitted of [...DataEventType.options, ...BulkDataEventType.options]) {
      expect(RealtimeEventType.safeParse(emitted).success, emitted).toBe(true);
    }
  });

  it('should reject invalid event types', () => {
    expect(() => RealtimeEventType.parse('record.inserted')).toThrow();
    expect(() => RealtimeEventType.parse('object.modified')).toThrow();
    expect(() => RealtimeEventType.parse('')).toThrow();
  });

  // The four values the enum used to accept. None was ever emitted, so each is
  // refused with a prescription naming the emitted name to write instead.
  const RETIRED: ReadonlyArray<readonly [string, string]> = [
    ['record.created', 'data.record.created'],
    ['record.updated', 'data.record.updated'],
    ['record.deleted', 'data.record.deleted'],
    ['field.changed', 'data.record.updated'],
  ];

  it.each(RETIRED)('refuses the retired value %s at the authoring door with its prescription', (retired, write) => {
    const result = SubscriptionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [{ type: retired, object: 'account' }],
      transport: 'websocket',
    });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_value');
    expect(issues[0].path).toEqual(['events', 0, 'type']);
    const firstSentence = issues[0].message.split(' — ')[0];
    expect(firstSentence).toBe(
      `\`${retired}\` was removed from \`RealtimeEventType\` in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove)`,
    );
    expect(issues[0].message).toContain(`Write \`${write}\``);
  });

  it('keeps zod\'s own message for a value that was never legal', () => {
    const result = RealtimeEventType.safeParse('data.record.create');
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe('invalid_value');
    expect(result.error!.issues[0].message).not.toContain('was removed');
  });
});

describe('SubscriptionEventSchema', () => {
  it('should accept valid subscription event', () => {
    const event = {
      type: 'data.record.created',
      object: 'account',
      filters: { status: 'active' },
    };

    expect(() => SubscriptionEventSchema.parse(event)).not.toThrow();
  });

  it('should accept event without object', () => {
    const event = {
      type: 'data.record.created',
    };

    const parsed = SubscriptionEventSchema.parse(event);
    expect(parsed.object).toBeUndefined();
  });

  it('should accept event without filters', () => {
    const event = {
      type: 'data.record.updated',
      object: 'contact',
    };

    const parsed = SubscriptionEventSchema.parse(event);
    expect(parsed.filters).toBeUndefined();
  });

  it('should accept various filter types', () => {
    const events = [
      { type: 'data.record.created', filters: { status: 'active' } },
      { type: 'data.record.updated', filters: ['field1', 'field2'] },
      { type: 'data.records.deleted', filters: 'name' },
    ];

    events.forEach(event => {
      expect(() => SubscriptionEventSchema.parse(event)).not.toThrow();
    });
  });
});

describe('SubscriptionSchema', () => {
  it('should accept valid minimal subscription', () => {
    const subscription: Subscription = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [
        { type: 'data.record.created', object: 'account' },
      ],
      transport: 'websocket',
    };

    expect(() => SubscriptionSchema.parse(subscription)).not.toThrow();
  });

  it('should accept subscription with channel', () => {
    const subscription = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [
        { type: 'data.record.updated', object: 'contact' },
      ],
      transport: 'sse',
      channel: 'user-notifications',
    };

    const parsed = SubscriptionSchema.parse(subscription);
    expect(parsed.channel).toBe('user-notifications');
  });

  it('should accept multiple events', () => {
    const subscription = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [
        { type: 'data.record.created', object: 'account' },
        { type: 'data.record.updated', object: 'account' },
        { type: 'data.record.deleted', object: 'account' },
      ],
      transport: 'websocket',
    };

    const parsed = SubscriptionSchema.parse(subscription);
    expect(parsed.events).toHaveLength(3);
  });

  it('should accept different transport protocols', () => {
    const transports: Array<Subscription['transport']> = ['websocket', 'sse', 'polling'];

    transports.forEach(transport => {
      const subscription = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        events: [{ type: 'data.record.created' }],
        transport,
      };

      const parsed = SubscriptionSchema.parse(subscription);
      expect(parsed.transport).toBe(transport);
    });
  });

  it('should validate UUID format', () => {
    expect(() => SubscriptionSchema.parse({
      id: 'not-a-uuid',
      events: [{ type: 'data.record.created' }],
      transport: 'websocket',
    })).toThrow();

    expect(() => SubscriptionSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [{ type: 'data.record.created' }],
      transport: 'websocket',
    })).not.toThrow();
  });

  it('should accept events with filters', () => {
    const subscription = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [
        {
          type: 'data.record.updated',
          object: 'opportunity',
          filters: { stage: 'closed_won', amount: { $gt: 10000 } },
        },
      ],
      transport: 'websocket',
    };

    expect(() => SubscriptionSchema.parse(subscription)).not.toThrow();
  });

  it('should reject subscription without required fields', () => {
    expect(() => SubscriptionSchema.parse({
      events: [{ type: 'data.record.created' }],
      transport: 'websocket',
    })).toThrow();

    expect(() => SubscriptionSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      transport: 'websocket',
    })).toThrow();

    expect(() => SubscriptionSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      events: [{ type: 'data.record.created' }],
    })).toThrow();
  });
});

describe('PresenceStatus', () => {
  it('should accept valid presence statuses', () => {
    expect(() => PresenceStatus.parse('online')).not.toThrow();
    expect(() => PresenceStatus.parse('away')).not.toThrow();
    expect(() => PresenceStatus.parse('offline')).not.toThrow();
  });

  it('should reject invalid presence statuses', () => {
    expect(() => PresenceStatus.parse('idle')).toThrow();
    expect(() => PresenceStatus.parse('')).toThrow();
  });

  it('should accept busy status', () => {
    expect(() => PresenceStatus.parse('busy')).not.toThrow();
  });
});

describe('RealtimePresenceSchema', () => {
  it('should accept valid minimal presence', () => {
    const presence: RealtimePresence = {
      userId: 'user-123',
      status: 'online',
      lastSeen: '2024-01-15T10:30:00Z',
    };

    expect(() => RealtimePresenceSchema.parse(presence)).not.toThrow();
  });

  it('should accept presence with metadata', () => {
    const presence = {
      userId: 'user-456',
      status: 'away',
      lastSeen: '2024-01-15T10:30:00Z',
      metadata: {
        currentPage: '/dashboard',
        customStatus: 'In a meeting',
        device: 'mobile',
      },
    };

    const parsed = RealtimePresenceSchema.parse(presence);
    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata?.currentPage).toBe('/dashboard');
  });

  it('should accept all presence statuses', () => {
    const statuses: Array<RealtimePresence['status']> = ['online', 'away', 'offline'];

    statuses.forEach(status => {
      const presence = {
        userId: 'user-789',
        status,
        lastSeen: '2024-01-15T10:30:00Z',
      };

      const parsed = RealtimePresenceSchema.parse(presence);
      expect(parsed.status).toBe(status);
    });
  });

  it('should validate datetime format', () => {
    expect(() => RealtimePresenceSchema.parse({
      userId: 'user-123',
      status: 'online',
      lastSeen: 'not-a-datetime',
    })).toThrow();

    expect(() => RealtimePresenceSchema.parse({
      userId: 'user-123',
      status: 'online',
      lastSeen: '2024-01-15T10:30:00Z',
    })).not.toThrow();
  });

  it('should reject presence without required fields', () => {
    expect(() => RealtimePresenceSchema.parse({
      status: 'online',
      lastSeen: '2024-01-15T10:30:00Z',
    })).toThrow();

    expect(() => RealtimePresenceSchema.parse({
      userId: 'user-123',
      lastSeen: '2024-01-15T10:30:00Z',
    })).toThrow();

    expect(() => RealtimePresenceSchema.parse({
      userId: 'user-123',
      status: 'online',
    })).toThrow();
  });
});

describe('RealtimeRecordAction', () => {
  it('should accept valid actions', () => {
    expect(() => RealtimeRecordAction.parse('created')).not.toThrow();
    expect(() => RealtimeRecordAction.parse('updated')).not.toThrow();
    expect(() => RealtimeRecordAction.parse('deleted')).not.toThrow();
  });

  it('should reject invalid actions', () => {
    expect(() => RealtimeRecordAction.parse('inserted')).toThrow();
    expect(() => RealtimeRecordAction.parse('modified')).toThrow();
    expect(() => RealtimeRecordAction.parse('')).toThrow();
  });
});

describe('RealtimeEventSchema', () => {
  it('should accept valid minimal realtime event', () => {
    const event: RealtimeEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'record.created',
      payload: { id: '123', name: 'Test Account' },
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => RealtimeEventSchema.parse(event)).not.toThrow();
  });

  it('should accept event with all fields', () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'record.updated',
      object: 'account',
      action: 'updated',
      payload: { id: '123', name: 'Updated Account', status: 'active' },
      timestamp: '2024-01-15T10:30:00Z',
      userId: 'user-456',
    };

    const parsed = RealtimeEventSchema.parse(event);
    expect(parsed.object).toBe('account');
    expect(parsed.action).toBe('updated');
    expect(parsed.userId).toBe('user-456');
  });

  it('should accept different actions', () => {
    const actions: Array<RealtimeEvent['action']> = ['created', 'updated', 'deleted'];

    actions.forEach(action => {
      const event = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'record.created',
        action,
        payload: {},
        timestamp: '2024-01-15T10:30:00Z',
      };

      const parsed = RealtimeEventSchema.parse(event);
      expect(parsed.action).toBe(action);
    });
  });

  it('should validate UUID format', () => {
    expect(() => RealtimeEventSchema.parse({
      id: 'not-a-uuid',
      type: 'record.created',
      payload: {},
      timestamp: '2024-01-15T10:30:00Z',
    })).toThrow();

    expect(() => RealtimeEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'record.created',
      payload: {},
      timestamp: '2024-01-15T10:30:00Z',
    })).not.toThrow();
  });

  it('should validate datetime format', () => {
    expect(() => RealtimeEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'record.created',
      payload: {},
      timestamp: 'not-a-datetime',
    })).toThrow();

    expect(() => RealtimeEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'record.created',
      payload: {},
      timestamp: '2024-01-15T10:30:00Z',
    })).not.toThrow();
  });

  it('should accept object payload', () => {
    const payloads = [
      { id: '123', name: 'Account' },
      { list: [1, 2, 3] },
      { value: 'string payload' },
      { count: 123 },
    ];

    payloads.forEach(payload => {
      const event = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'custom.event',
        payload,
        timestamp: '2024-01-15T10:30:00Z',
      };

      expect(() => RealtimeEventSchema.parse(event)).not.toThrow();
    });
  });

  it('should reject event without required fields', () => {
    expect(() => RealtimeEventSchema.parse({
      type: 'record.created',
      payload: {},
      timestamp: '2024-01-15T10:30:00Z',
    })).toThrow();

    expect(() => RealtimeEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      payload: {},
      timestamp: '2024-01-15T10:30:00Z',
    })).toThrow();

    expect(() => RealtimeEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'record.created',
    })).toThrow();
  });

  it('should handle field change event', () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'field.changed',
      object: 'contact',
      action: 'updated',
      payload: {
        recordId: 'contact-123',
        field: 'email',
        oldValue: 'old@example.com',
        newValue: 'new@example.com',
      },
      timestamp: '2024-01-15T10:30:00Z',
      userId: 'user-789',
    };

    const parsed = RealtimeEventSchema.parse(event);
    expect(parsed.type).toBe('field.changed');
    expect(parsed.payload.field).toBe('email');
  });
});
