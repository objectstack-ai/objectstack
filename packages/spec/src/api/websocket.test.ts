import { describe, it, expect } from 'vitest';
import {
  WebSocketMessageType,
  EventSubscriptionSchema,
  UnsubscribeRequestSchema,
  WebSocketPresenceStatus,
  PresenceStateSchema,
  PresenceUpdateSchema,
  CursorPositionSchema,
  EditOperationType,
  EditOperationSchema,
  DocumentStateSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  EventMessageSchema,
  PresenceMessageSchema,
  CursorMessageSchema,
  EditMessageSchema,
  AckMessageSchema,
  ErrorMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
  WebSocketMessageSchema,
  WebSocketConfigSchema,
  type EventSubscription,
  type PresenceState,
  type CursorPosition,
  type EditOperation,
  type WebSocketMessage,
} from './websocket.zod';

describe('WebSocketMessageType', () => {
  it('should accept valid message types', () => {
    const validTypes = [
      'subscribe', 'unsubscribe', 'event', 'ping', 'pong',
      'ack', 'error', 'presence', 'cursor', 'edit',
    ];

    validTypes.forEach(type => {
      expect(() => WebSocketMessageType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid message types', () => {
    expect(() => WebSocketMessageType.parse('invalid')).toThrow();
    expect(() => WebSocketMessageType.parse('')).toThrow();
  });
});

describe('EventSubscriptionSchema', () => {
  it('should accept valid minimal subscription', () => {
    const subscription: EventSubscription = {
      subscriptionId: '550e8400-e29b-41d4-a716-446655440000',
      events: ['record.created'],
    };

    expect(() => EventSubscriptionSchema.parse(subscription)).not.toThrow();
  });

  it('should accept subscription with wildcard events', () => {
    const subscription = {
      subscriptionId: '550e8400-e29b-41d4-a716-446655440000',
      events: ['record.*', 'user.created', '*.deleted'],
    };

    expect(() => EventSubscriptionSchema.parse(subscription)).not.toThrow();
  });

  it('should accept subscription with objects filter', () => {
    const subscription = {
      subscriptionId: '550e8400-e29b-41d4-a716-446655440000',
      events: ['record.updated'],
      objects: ['account', 'contact'],
    };

    const parsed = EventSubscriptionSchema.parse(subscription);
    expect(parsed.objects).toEqual(['account', 'contact']);
  });

  it('should accept subscription with channels', () => {
    const subscription = {
      subscriptionId: '550e8400-e29b-41d4-a716-446655440000',
      events: ['notification.*'],
      channels: ['user-123', 'team-456'],
    };

    const parsed = EventSubscriptionSchema.parse(subscription);
    expect(parsed.channels).toEqual(['user-123', 'team-456']);
  });

  it('should validate UUID format', () => {
    expect(() => EventSubscriptionSchema.parse({
      subscriptionId: 'not-a-uuid',
      events: ['record.created'],
    })).toThrow();
  });
});

describe('UnsubscribeRequestSchema', () => {
  it('should accept valid unsubscribe request', () => {
    const request = {
      subscriptionId: '550e8400-e29b-41d4-a716-446655440000',
    };

    expect(() => UnsubscribeRequestSchema.parse(request)).not.toThrow();
  });

  it('should validate UUID format', () => {
    expect(() => UnsubscribeRequestSchema.parse({
      subscriptionId: 'invalid-uuid',
    })).toThrow();
  });
});

describe('WebSocketPresenceStatus', () => {
  it('should accept valid presence statuses', () => {
    const statuses = ['online', 'away', 'busy', 'offline'];
    
    statuses.forEach(status => {
      expect(() => WebSocketPresenceStatus.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid statuses', () => {
    expect(() => WebSocketPresenceStatus.parse('idle')).toThrow();
    expect(() => WebSocketPresenceStatus.parse('dnd')).toThrow();
  });
});

describe('PresenceStateSchema', () => {
  it('should accept valid minimal presence state', () => {
    const presence: PresenceState = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'online',
      lastSeen: '2024-01-15T10:30:00Z',
    };

    expect(() => PresenceStateSchema.parse(presence)).not.toThrow();
  });

  it('should accept presence with all optional fields', () => {
    const presence = {
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'busy',
      lastSeen: '2024-01-15T10:30:00Z',
      currentLocation: '/dashboard/analytics',
      device: 'desktop',
      customStatus: 'In a meeting',
      metadata: { team: 'engineering', role: 'developer' },
    };

    const parsed = PresenceStateSchema.parse(presence);
    expect(parsed.currentLocation).toBe('/dashboard/analytics');
    expect(parsed.device).toBe('desktop');
    expect(parsed.customStatus).toBe('In a meeting');
  });

  it('should validate device type', () => {
    expect(() => PresenceStateSchema.parse({
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'online',
      lastSeen: '2024-01-15T10:30:00Z',
      device: 'invalid-device',
    })).toThrow();
  });
});

describe('PresenceUpdateSchema', () => {
  it('should accept partial presence updates', () => {
    const update = {
      status: 'away',
    };

    expect(() => PresenceUpdateSchema.parse(update)).not.toThrow();
  });

  it('should accept multiple fields update', () => {
    const update = {
      status: 'online',
      currentLocation: '/projects/123',
      customStatus: 'Working on feature X',
    };

    expect(() => PresenceUpdateSchema.parse(update)).not.toThrow();
  });
});

describe('CursorPositionSchema', () => {
  it('should accept valid minimal cursor position', () => {
    const cursor: CursorPosition = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    expect(() => CursorPositionSchema.parse(cursor)).not.toThrow();
  });

  it('should accept cursor with position', () => {
    const cursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      position: { line: 10, column: 25 },
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    const parsed = CursorPositionSchema.parse(cursor);
    expect(parsed.position?.line).toBe(10);
    expect(parsed.position?.column).toBe(25);
  });

  it('should accept cursor with selection', () => {
    const cursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      position: { line: 10, column: 0 },
      selection: {
        start: { line: 10, column: 0 },
        end: { line: 15, column: 20 },
      },
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    expect(() => CursorPositionSchema.parse(cursor)).not.toThrow();
  });

  it('should accept cursor with color and userName', () => {
    const cursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      color: '#FF5733',
      userName: 'John Doe',
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    const parsed = CursorPositionSchema.parse(cursor);
    expect(parsed.color).toBe('#FF5733');
    expect(parsed.userName).toBe('John Doe');
  });

  it('should reject negative position values', () => {
    expect(() => CursorPositionSchema.parse({
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      position: { line: -1, column: 0 },
      lastUpdate: '2024-01-15T10:30:00Z',
    })).toThrow();
  });
});

describe('EditOperationType', () => {
  it('should accept valid operation types', () => {
    const types = ['insert', 'delete', 'replace'];
    
    types.forEach(type => {
      expect(() => EditOperationType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid operation types', () => {
    expect(() => EditOperationType.parse('update')).toThrow();
  });
});

describe('EditOperationSchema', () => {
  it('should accept valid insert operation', () => {
    const operation: EditOperation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'insert',
      position: { line: 5, column: 10 },
      content: 'Hello, World!',
      version: 42,
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => EditOperationSchema.parse(operation)).not.toThrow();
  });

  it('should accept delete operation', () => {
    const operation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'delete',
      position: { line: 5, column: 10 },
      endPosition: { line: 5, column: 25 },
      version: 42,
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => EditOperationSchema.parse(operation)).not.toThrow();
  });

  it('should accept replace operation', () => {
    const operation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'replace',
      position: { line: 5, column: 10 },
      endPosition: { line: 5, column: 25 },
      content: 'New content',
      version: 42,
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => EditOperationSchema.parse(operation)).not.toThrow();
  });

  it('should accept operation with baseOperationId', () => {
    const operation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'insert',
      position: { line: 5, column: 10 },
      content: 'Text',
      version: 42,
      timestamp: '2024-01-15T10:30:00Z',
      baseOperationId: '550e8400-e29b-41d4-a716-446655440002',
    };

    const parsed = EditOperationSchema.parse(operation);
    expect(parsed.baseOperationId).toBe('550e8400-e29b-41d4-a716-446655440002');
  });

  it('should reject negative version', () => {
    expect(() => EditOperationSchema.parse({
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'insert',
      position: { line: 0, column: 0 },
      content: 'Text',
      version: -1,
      timestamp: '2024-01-15T10:30:00Z',
    })).toThrow();
  });
});

describe('DocumentStateSchema', () => {
  it('should accept valid document state', () => {
    const state = {
      documentId: 'doc-123',
      version: 42,
      content: 'Document content here',
      lastModified: '2024-01-15T10:30:00Z',
      activeSessions: [
        '550e8400-e29b-41d4-a716-446655440000',
        '550e8400-e29b-41d4-a716-446655440001',
      ],
    };

    expect(() => DocumentStateSchema.parse(state)).not.toThrow();
  });

  it('should accept document state with checksum', () => {
    const state = {
      documentId: 'doc-123',
      version: 42,
      content: 'Document content',
      lastModified: '2024-01-15T10:30:00Z',
      activeSessions: [],
      checksum: 'sha256:abcdef1234567890',
    };

    const parsed = DocumentStateSchema.parse(state);
    expect(parsed.checksum).toBe('sha256:abcdef1234567890');
  });
});

describe('WebSocket Message Schemas', () => {
  describe('SubscribeMessageSchema', () => {
    it('should accept valid subscribe message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'subscribe',
        timestamp: '2024-01-15T10:30:00Z',
        subscription: {
          subscriptionId: '550e8400-e29b-41d4-a716-446655440001',
          events: ['record.created'],
        },
      };

      expect(() => SubscribeMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('UnsubscribeMessageSchema', () => {
    it('should accept valid unsubscribe message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'unsubscribe',
        timestamp: '2024-01-15T10:30:00Z',
        request: {
          subscriptionId: '550e8400-e29b-41d4-a716-446655440001',
        },
      };

      expect(() => UnsubscribeMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('EventMessageSchema', () => {
    it('should accept valid event message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'event',
        timestamp: '2024-01-15T10:30:00Z',
        subscriptionId: '550e8400-e29b-41d4-a716-446655440001',
        eventName: 'record.created',
        payload: { id: '123', name: 'Test' },
      };

      expect(() => EventMessageSchema.parse(message)).not.toThrow();
    });

    it('should accept event message with object and userId', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'event',
        timestamp: '2024-01-15T10:30:00Z',
        subscriptionId: '550e8400-e29b-41d4-a716-446655440001',
        eventName: 'record.updated',
        object: 'account',
        payload: { id: '123', status: 'active' },
        userId: 'user-456',
      };

      const parsed = EventMessageSchema.parse(message);
      expect(parsed.object).toBe('account');
      expect(parsed.userId).toBe('user-456');
    });
  });

  describe('PresenceMessageSchema', () => {
    it('should accept valid presence message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'presence',
        timestamp: '2024-01-15T10:30:00Z',
        presence: {
          userId: 'user-123',
          sessionId: '550e8400-e29b-41d4-a716-446655440001',
          status: 'online',
          lastSeen: '2024-01-15T10:30:00Z',
        },
      };

      expect(() => PresenceMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('CursorMessageSchema', () => {
    it('should accept valid cursor message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'cursor',
        timestamp: '2024-01-15T10:30:00Z',
        cursor: {
          userId: 'user-123',
          sessionId: '550e8400-e29b-41d4-a716-446655440001',
          documentId: 'doc-456',
          position: { line: 10, column: 5 },
          lastUpdate: '2024-01-15T10:30:00Z',
        },
      };

      expect(() => CursorMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('EditMessageSchema', () => {
    it('should accept valid edit message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'edit',
        timestamp: '2024-01-15T10:30:00Z',
        operation: {
          operationId: '550e8400-e29b-41d4-a716-446655440001',
          documentId: 'doc-123',
          userId: 'user-456',
          sessionId: '550e8400-e29b-41d4-a716-446655440002',
          type: 'insert',
          position: { line: 5, column: 10 },
          content: 'Text',
          version: 42,
          timestamp: '2024-01-15T10:30:00Z',
        },
      };

      expect(() => EditMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('AckMessageSchema', () => {
    it('should accept valid acknowledgment message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'ack',
        timestamp: '2024-01-15T10:30:00Z',
        ackMessageId: '550e8400-e29b-41d4-a716-446655440001',
        success: true,
      };

      expect(() => AckMessageSchema.parse(message)).not.toThrow();
    });

    it('should accept acknowledgment with error', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'ack',
        timestamp: '2024-01-15T10:30:00Z',
        ackMessageId: '550e8400-e29b-41d4-a716-446655440001',
        success: false,
        error: 'Invalid subscription configuration',
      };

      const parsed = AckMessageSchema.parse(message);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Invalid subscription configuration');
    });
  });

  describe('ErrorMessageSchema', () => {
    it('should accept valid error message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'error',
        timestamp: '2024-01-15T10:30:00Z',
        code: 'INVALID_SUBSCRIPTION',
        message: 'Subscription configuration is invalid',
      };

      expect(() => ErrorMessageSchema.parse(message)).not.toThrow();
    });

    it('should accept error message with details', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'error',
        timestamp: '2024-01-15T10:30:00Z',
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { field: 'events', reason: 'Array cannot be empty' },
      };

      const parsed = ErrorMessageSchema.parse(message);
      expect(parsed.details).toBeDefined();
    });
  });

  describe('PingMessageSchema', () => {
    it('should accept valid ping message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'ping',
        timestamp: '2024-01-15T10:30:00Z',
      };

      expect(() => PingMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('PongMessageSchema', () => {
    it('should accept valid pong message', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'pong',
        timestamp: '2024-01-15T10:30:00Z',
      };

      expect(() => PongMessageSchema.parse(message)).not.toThrow();
    });

    it('should accept pong with pingMessageId', () => {
      const message = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'pong',
        timestamp: '2024-01-15T10:30:00Z',
        pingMessageId: '550e8400-e29b-41d4-a716-446655440001',
      };

      const parsed = PongMessageSchema.parse(message);
      expect(parsed.pingMessageId).toBe('550e8400-e29b-41d4-a716-446655440001');
    });
  });

  describe('WebSocketMessageSchema (Union)', () => {
    it('should accept all valid message types', () => {
      const messages = [
        {
          messageId: '550e8400-e29b-41d4-a716-446655440000',
          type: 'ping',
          timestamp: '2024-01-15T10:30:00Z',
        },
        {
          messageId: '550e8400-e29b-41d4-a716-446655440001',
          type: 'error',
          timestamp: '2024-01-15T10:30:00Z',
          code: 'TEST_ERROR',
          message: 'Test error message',
        },
      ];

      messages.forEach(msg => {
        expect(() => WebSocketMessageSchema.parse(msg)).not.toThrow();
      });
    });

    it('should use discriminated union on type field', () => {
      const message: WebSocketMessage = {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'ping',
        timestamp: '2024-01-15T10:30:00Z',
      };

      const parsed = WebSocketMessageSchema.parse(message);
      expect(parsed.type).toBe('ping');
    });
  });
});

describe('WebSocketConfigSchema', () => {
  it('should accept valid minimal config', () => {
    const config = {
      url: 'wss://example.com/ws',
    };

    expect(() => WebSocketConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept config with all options', () => {
    const config = {
      url: 'wss://example.com/ws',
      protocols: ['objectstack-v1', 'json'],
      reconnect: true,
      reconnectInterval: 2000,
      maxReconnectAttempts: 10,
      pingInterval: 60000,
      timeout: 10000,
      headers: {
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'value',
      },
    };

    const parsed = WebSocketConfigSchema.parse(config);
    expect(parsed.reconnect).toBe(true);
    expect(parsed.reconnectInterval).toBe(2000);
    expect(parsed.maxReconnectAttempts).toBe(10);
  });

  it('should use default values for optional fields', () => {
    const config = {
      url: 'wss://example.com/ws',
    };

    const parsed = WebSocketConfigSchema.parse(config);
    expect(parsed.reconnect).toBe(true);
    expect(parsed.reconnectInterval).toBe(1000);
    expect(parsed.maxReconnectAttempts).toBe(5);
    expect(parsed.pingInterval).toBe(30000);
    expect(parsed.timeout).toBe(5000);
  });

  it('should validate URL format', () => {
    expect(() => WebSocketConfigSchema.parse({
      url: 'not-a-url',
    })).toThrow();

    expect(() => WebSocketConfigSchema.parse({
      url: 'wss://example.com/ws',
    })).not.toThrow();
  });

  it('should reject negative intervals', () => {
    expect(() => WebSocketConfigSchema.parse({
      url: 'wss://example.com/ws',
      reconnectInterval: -1000,
    })).toThrow();

    expect(() => WebSocketConfigSchema.parse({
      url: 'wss://example.com/ws',
      pingInterval: 0,
    })).toThrow();
  });
});
