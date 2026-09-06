import { describe, it, expect } from 'vitest';
import {
  OTOperationType,
  OTComponentSchema,
  OTOperationSchema,
  OTTransformResultSchema,
  CRDTType,
  VectorClockSchema,
  LWWRegisterSchema,
  CounterOperationSchema,
  GCounterSchema,
  PNCounterSchema,
  ORSetElementSchema,
  ORSetSchema,
  TextCRDTOperationSchema,
  TextCRDTStateSchema,
  CRDTStateSchema,
  CRDTMergeResultSchema,
  CursorColorPreset,
  CursorStyleSchema,
  CursorSelectionSchema,
  CollaborativeCursorSchema,
  CursorUpdateSchema,
  UserActivityStatus,
  AwarenessUserStateSchema,
  AwarenessSessionSchema,
  AwarenessUpdateSchema,
  AwarenessEventSchema,
  CollaborationMode,
  CollaborationSessionConfigSchema,
  CollaborationSessionSchema,
  type OTOperation,
  type LWWRegister,
  type GCounter,
  type PNCounter,
  type ORSet,
  type TextCRDTState,
  type CollaborativeCursor,
  type AwarenessUserState,
  type CollaborationSession,
} from './collaboration.zod';

describe('OTOperationType', () => {
  it('should accept valid OT operation types', () => {
    const types = ['insert', 'delete', 'retain'];
    
    types.forEach(type => {
      expect(() => OTOperationType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid operation types', () => {
    expect(() => OTOperationType.parse('replace')).toThrow();
    expect(() => OTOperationType.parse('update')).toThrow();
  });
});

describe('OTComponentSchema', () => {
  it('should accept insert component', () => {
    const component = {
      type: 'insert',
      text: 'Hello, World!',
    };

    expect(() => OTComponentSchema.parse(component)).not.toThrow();
  });

  it('should accept insert with attributes', () => {
    const component = {
      type: 'insert',
      text: 'Bold text',
      attributes: { bold: true, fontSize: 14 },
    };

    const parsed = OTComponentSchema.parse(component);
    expect(parsed.attributes).toBeDefined();
  });

  it('should accept delete component', () => {
    const component = {
      type: 'delete',
      count: 10,
    };

    expect(() => OTComponentSchema.parse(component)).not.toThrow();
  });

  it('should accept retain component', () => {
    const component = {
      type: 'retain',
      count: 15,
    };

    expect(() => OTComponentSchema.parse(component)).not.toThrow();
  });

  it('should accept retain with attributes', () => {
    const component = {
      type: 'retain',
      count: 20,
      attributes: { italic: true },
    };

    const parsed = OTComponentSchema.parse(component);
    expect(parsed.attributes).toBeDefined();
  });

  it('should reject negative count', () => {
    expect(() => OTComponentSchema.parse({
      type: 'delete',
      count: -5,
    })).toThrow();

    expect(() => OTComponentSchema.parse({
      type: 'retain',
      count: 0,
    })).toThrow();
  });
});

describe('OTOperationSchema', () => {
  it('should accept valid OT operation', () => {
    const operation: OTOperation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      components: [
        { type: 'retain', count: 10 },
        { type: 'insert', text: 'New text' },
        { type: 'retain', count: 5 },
      ],
      baseVersion: 42,
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => OTOperationSchema.parse(operation)).not.toThrow();
  });

  it('should accept operation with metadata', () => {
    const operation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      components: [{ type: 'insert', text: 'Text' }],
      baseVersion: 10,
      timestamp: '2024-01-15T10:30:00Z',
      metadata: { source: 'keyboard', device: 'desktop' },
    };

    const parsed = OTOperationSchema.parse(operation);
    expect(parsed.metadata).toBeDefined();
  });

  it('should reject negative baseVersion', () => {
    expect(() => OTOperationSchema.parse({
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      userId: 'user-456',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      components: [{ type: 'insert', text: 'Text' }],
      baseVersion: -1,
      timestamp: '2024-01-15T10:30:00Z',
    })).toThrow();
  });
});

describe('OTTransformResultSchema', () => {
  it('should accept valid transform result', () => {
    const result = {
      operation: {
        operationId: '550e8400-e29b-41d4-a716-446655440000',
        documentId: 'doc-123',
        userId: 'user-456',
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        components: [{ type: 'insert', text: 'Transformed' }],
        baseVersion: 43,
        timestamp: '2024-01-15T10:30:00Z',
      },
      transformed: true,
    };

    expect(() => OTTransformResultSchema.parse(result)).not.toThrow();
  });

  it('should accept result with conflicts', () => {
    const result = {
      operation: {
        operationId: '550e8400-e29b-41d4-a716-446655440000',
        documentId: 'doc-123',
        userId: 'user-456',
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        components: [{ type: 'insert', text: 'Text' }],
        baseVersion: 42,
        timestamp: '2024-01-15T10:30:00Z',
      },
      transformed: true,
      conflicts: ['Overlapping edits detected', 'Position adjusted'],
    };

    const parsed = OTTransformResultSchema.parse(result);
    expect(parsed.conflicts).toHaveLength(2);
  });
});

describe('CRDTType', () => {
  it('should accept valid CRDT types', () => {
    const types = [
      'lww-register', 'g-counter', 'pn-counter', 'g-set', 
      'or-set', 'lww-map', 'text', 'tree', 'json',
    ];
    
    types.forEach(type => {
      expect(() => CRDTType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid CRDT types', () => {
    expect(() => CRDTType.parse('list')).toThrow();
    expect(() => CRDTType.parse('vector')).toThrow();
  });
});

describe('VectorClockSchema', () => {
  it('should accept valid vector clock', () => {
    const clock = {
      clock: {
        'replica-1': 5,
        'replica-2': 3,
        'replica-3': 7,
      },
    };

    expect(() => VectorClockSchema.parse(clock)).not.toThrow();
  });

  it('should reject negative timestamps', () => {
    expect(() => VectorClockSchema.parse({
      clock: { 'replica-1': -1 },
    })).toThrow();
  });
});

describe('LWWRegisterSchema', () => {
  it('should accept valid LWW register', () => {
    const register: LWWRegister = {
      type: 'lww-register',
      value: 'Current value',
      timestamp: '2024-01-15T10:30:00Z',
      replicaId: 'replica-1',
    };

    expect(() => LWWRegisterSchema.parse(register)).not.toThrow();
  });

  it('should accept register with vector clock', () => {
    const register = {
      type: 'lww-register',
      value: { data: 'object value' },
      timestamp: '2024-01-15T10:30:00Z',
      replicaId: 'replica-2',
      vectorClock: {
        clock: { 'replica-1': 3, 'replica-2': 5 },
      },
    };

    const parsed = LWWRegisterSchema.parse(register);
    expect(parsed.vectorClock).toBeDefined();
  });
});

describe('CounterOperationSchema', () => {
  it('should accept increment operation', () => {
    const operation = {
      replicaId: 'replica-1',
      delta: 5,
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => CounterOperationSchema.parse(operation)).not.toThrow();
  });

  it('should accept decrement operation', () => {
    const operation = {
      replicaId: 'replica-1',
      delta: -3,
      timestamp: '2024-01-15T10:30:00Z',
    };

    expect(() => CounterOperationSchema.parse(operation)).not.toThrow();
  });
});

describe('GCounterSchema', () => {
  it('should accept valid G-Counter', () => {
    const counter: GCounter = {
      type: 'g-counter',
      counts: {
        'replica-1': 10,
        'replica-2': 5,
        'replica-3': 3,
      },
    };

    expect(() => GCounterSchema.parse(counter)).not.toThrow();
  });

  it('should reject negative counts', () => {
    expect(() => GCounterSchema.parse({
      type: 'g-counter',
      counts: { 'replica-1': -5 },
    })).toThrow();
  });
});

describe('PNCounterSchema', () => {
  it('should accept valid PN-Counter', () => {
    const counter: PNCounter = {
      type: 'pn-counter',
      positive: { 'replica-1': 10, 'replica-2': 5 },
      negative: { 'replica-1': 3, 'replica-2': 2 },
    };

    expect(() => PNCounterSchema.parse(counter)).not.toThrow();
  });

  it('should reject negative values in positive counts', () => {
    expect(() => PNCounterSchema.parse({
      type: 'pn-counter',
      positive: { 'replica-1': -10 },
      negative: { 'replica-1': 0 },
    })).toThrow();
  });
});

describe('ORSetElementSchema', () => {
  it('should accept valid OR-Set element', () => {
    const element = {
      value: 'item-1',
      timestamp: '2024-01-15T10:30:00Z',
      replicaId: 'replica-1',
      uid: '550e8400-e29b-41d4-a716-446655440000',
    };

    expect(() => ORSetElementSchema.parse(element)).not.toThrow();
  });

  it('should accept removed element', () => {
    const element = {
      value: 'item-2',
      timestamp: '2024-01-15T10:30:00Z',
      replicaId: 'replica-1',
      uid: '550e8400-e29b-41d4-a716-446655440000',
      removed: true,
    };

    const parsed = ORSetElementSchema.parse(element);
    expect(parsed.removed).toBe(true);
  });

  it('should use default false for removed', () => {
    const element = {
      value: 'item-3',
      timestamp: '2024-01-15T10:30:00Z',
      replicaId: 'replica-1',
      uid: '550e8400-e29b-41d4-a716-446655440000',
    };

    const parsed = ORSetElementSchema.parse(element);
    expect(parsed.removed).toBe(false);
  });
});

describe('ORSetSchema', () => {
  it('should accept valid OR-Set', () => {
    const set: ORSet = {
      type: 'or-set',
      elements: [
        {
          value: 'item-1',
          timestamp: '2024-01-15T10:30:00Z',
          replicaId: 'replica-1',
          uid: '550e8400-e29b-41d4-a716-446655440000',
        },
        {
          value: 'item-2',
          timestamp: '2024-01-15T10:31:00Z',
          replicaId: 'replica-2',
          uid: '550e8400-e29b-41d4-a716-446655440001',
        },
      ],
    };

    expect(() => ORSetSchema.parse(set)).not.toThrow();
  });
});

describe('TextCRDTOperationSchema', () => {
  it('should accept insert operation', () => {
    const operation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      replicaId: 'replica-1',
      position: 10,
      insert: 'New text',
      timestamp: '2024-01-15T10:30:00Z',
      lamportTimestamp: 42,
    };

    expect(() => TextCRDTOperationSchema.parse(operation)).not.toThrow();
  });

  it('should accept delete operation', () => {
    const operation = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      replicaId: 'replica-1',
      position: 5,
      delete: 10,
      timestamp: '2024-01-15T10:30:00Z',
      lamportTimestamp: 43,
    };

    expect(() => TextCRDTOperationSchema.parse(operation)).not.toThrow();
  });

  it('should reject negative position', () => {
    expect(() => TextCRDTOperationSchema.parse({
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      replicaId: 'replica-1',
      position: -1,
      insert: 'Text',
      timestamp: '2024-01-15T10:30:00Z',
      lamportTimestamp: 42,
    })).toThrow();
  });
});

describe('TextCRDTStateSchema', () => {
  it('should accept valid text CRDT state', () => {
    const state: TextCRDTState = {
      type: 'text',
      documentId: 'doc-123',
      content: 'Current document content',
      operations: [
        {
          operationId: '550e8400-e29b-41d4-a716-446655440000',
          replicaId: 'replica-1',
          position: 0,
          insert: 'Initial text',
          timestamp: '2024-01-15T10:30:00Z',
          lamportTimestamp: 1,
        },
      ],
      lamportClock: 1,
      vectorClock: {
        clock: { 'replica-1': 1 },
      },
    };

    expect(() => TextCRDTStateSchema.parse(state)).not.toThrow();
  });
});

describe('CRDTStateSchema', () => {
  it('should accept all CRDT types', () => {
    const states = [
      {
        type: 'lww-register',
        value: 'test',
        timestamp: '2024-01-15T10:30:00Z',
        replicaId: 'replica-1',
      },
      {
        type: 'g-counter',
        counts: { 'replica-1': 5 },
      },
      {
        type: 'pn-counter',
        positive: { 'replica-1': 10 },
        negative: { 'replica-1': 3 },
      },
      {
        type: 'or-set',
        elements: [],
      },
      {
        type: 'text',
        documentId: 'doc-123',
        content: 'Text',
        operations: [],
        lamportClock: 0,
        vectorClock: { clock: {} },
      },
    ];

    states.forEach(state => {
      expect(() => CRDTStateSchema.parse(state)).not.toThrow();
    });
  });

  it('should use discriminated union on type field', () => {
    const state = {
      type: 'g-counter',
      counts: { 'replica-1': 5 },
    };

    const parsed = CRDTStateSchema.parse(state);
    expect(parsed.type).toBe('g-counter');
  });
});

describe('CRDTMergeResultSchema', () => {
  it('should accept merge result without conflicts', () => {
    const result = {
      state: {
        type: 'lww-register',
        value: 'merged value',
        timestamp: '2024-01-15T10:30:00Z',
        replicaId: 'replica-1',
      },
    };

    expect(() => CRDTMergeResultSchema.parse(result)).not.toThrow();
  });

  it('should accept merge result with conflicts', () => {
    const result = {
      state: {
        type: 'g-counter',
        counts: { 'replica-1': 10 },
      },
      conflicts: [
        {
          type: 'concurrent-update',
          description: 'Concurrent updates detected',
          resolved: true,
        },
      ],
    };

    const parsed = CRDTMergeResultSchema.parse(result);
    expect(parsed.conflicts).toHaveLength(1);
  });
});

describe('CursorColorPreset', () => {
  it('should accept valid color presets', () => {
    const colors = [
      'blue', 'green', 'red', 'yellow', 'purple', 
      'orange', 'pink', 'teal', 'indigo', 'cyan',
    ];
    
    colors.forEach(color => {
      expect(() => CursorColorPreset.parse(color)).not.toThrow();
    });
  });

  it('should reject invalid presets', () => {
    expect(() => CursorColorPreset.parse('black')).toThrow();
    expect(() => CursorColorPreset.parse('white')).toThrow();
  });
});

describe('CursorStyleSchema', () => {
  it('should accept cursor style with preset color', () => {
    const style = {
      color: 'blue',
    };

    expect(() => CursorStyleSchema.parse(style)).not.toThrow();
  });

  it('should accept cursor style with custom hex color', () => {
    const style = {
      color: '#FF5733',
    };

    expect(() => CursorStyleSchema.parse(style)).not.toThrow();
  });

  it('should accept cursor style with all options', () => {
    const style = {
      color: 'green',
      opacity: 0.8,
      label: 'John Doe',
      showLabel: true,
      pulseOnUpdate: false,
    };

    const parsed = CursorStyleSchema.parse(style);
    expect(parsed.opacity).toBe(0.8);
    expect(parsed.showLabel).toBe(true);
    expect(parsed.pulseOnUpdate).toBe(false);
  });

  it('should use default values', () => {
    const style = { color: 'red' };
    
    const parsed = CursorStyleSchema.parse(style);
    expect(parsed.opacity).toBe(1);
    expect(parsed.showLabel).toBe(true);
    expect(parsed.pulseOnUpdate).toBe(true);
  });

  it('should reject opacity outside range', () => {
    expect(() => CursorStyleSchema.parse({
      color: 'blue',
      opacity: 1.5,
    })).toThrow();

    expect(() => CursorStyleSchema.parse({
      color: 'blue',
      opacity: -0.1,
    })).toThrow();
  });
});

describe('CursorSelectionSchema', () => {
  it('should accept valid cursor selection', () => {
    const selection = {
      anchor: { line: 5, column: 10 },
      focus: { line: 8, column: 20 },
    };

    expect(() => CursorSelectionSchema.parse(selection)).not.toThrow();
  });

  it('should accept selection with direction', () => {
    const selection = {
      anchor: { line: 5, column: 10 },
      focus: { line: 8, column: 20 },
      direction: 'forward',
    };

    const parsed = CursorSelectionSchema.parse(selection);
    expect(parsed.direction).toBe('forward');
  });

  it('should reject negative positions', () => {
    expect(() => CursorSelectionSchema.parse({
      anchor: { line: -1, column: 0 },
      focus: { line: 5, column: 10 },
    })).toThrow();
  });
});

describe('CollaborativeCursorSchema', () => {
  it('should accept valid collaborative cursor', () => {
    const cursor: CollaborativeCursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      userName: 'John Doe',
      position: { line: 10, column: 5 },
      style: { color: 'blue' },
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    expect(() => CollaborativeCursorSchema.parse(cursor)).not.toThrow();
  });

  it('should accept cursor with selection', () => {
    const cursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      userName: 'Jane Doe',
      position: { line: 5, column: 0 },
      selection: {
        anchor: { line: 5, column: 0 },
        focus: { line: 10, column: 20 },
      },
      style: { color: 'green' },
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    const parsed = CollaborativeCursorSchema.parse(cursor);
    expect(parsed.selection).toBeDefined();
  });

  it('should accept cursor with isTyping flag', () => {
    const cursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      userName: 'Bob Smith',
      position: { line: 15, column: 30 },
      style: { color: 'red' },
      isTyping: true,
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    const parsed = CollaborativeCursorSchema.parse(cursor);
    expect(parsed.isTyping).toBe(true);
  });

  it('should use default false for isTyping', () => {
    const cursor = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-456',
      userName: 'Alice',
      position: { line: 0, column: 0 },
      style: { color: 'purple' },
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    const parsed = CollaborativeCursorSchema.parse(cursor);
    expect(parsed.isTyping).toBe(false);
  });
});

describe('CursorUpdateSchema', () => {
  it('should accept position update', () => {
    const update = {
      position: { line: 20, column: 15 },
    };

    expect(() => CursorUpdateSchema.parse(update)).not.toThrow();
  });

  it('should accept multiple field updates', () => {
    const update = {
      position: { line: 10, column: 5 },
      isTyping: true,
      metadata: { tool: 'keyboard' },
    };

    expect(() => CursorUpdateSchema.parse(update)).not.toThrow();
  });
});

describe('UserActivityStatus', () => {
  it('should accept valid activity statuses', () => {
    const statuses = ['active', 'idle', 'viewing', 'disconnected'];
    
    statuses.forEach(status => {
      expect(() => UserActivityStatus.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid statuses', () => {
    expect(() => UserActivityStatus.parse('offline')).toThrow();
    expect(() => UserActivityStatus.parse('away')).toThrow();
  });
});

describe('AwarenessUserStateSchema', () => {
  it('should accept valid user state', () => {
    const userState: AwarenessUserState = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      userName: 'John Doe',
      status: 'active',
      lastActivity: '2024-01-15T10:30:00Z',
      joinedAt: '2024-01-15T10:00:00Z',
    };

    expect(() => AwarenessUserStateSchema.parse(userState)).not.toThrow();
  });

  it('should accept user state with all optional fields', () => {
    const userState = {
      userId: 'user-123',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      userName: 'Jane Doe',
      userAvatar: 'https://example.com/avatar.jpg',
      status: 'viewing',
      currentDocument: 'doc-456',
      currentView: '/editor',
      lastActivity: '2024-01-15T10:30:00Z',
      joinedAt: '2024-01-15T10:00:00Z',
      permissions: ['read', 'write', 'comment'],
      metadata: { role: 'editor', team: 'engineering' },
    };

    const parsed = AwarenessUserStateSchema.parse(userState);
    expect(parsed.currentDocument).toBe('doc-456');
    expect(parsed.permissions).toEqual(['read', 'write', 'comment']);
  });
});

describe('AwarenessSessionSchema', () => {
  it('should accept valid awareness session', () => {
    const session = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      users: [
        {
          userId: 'user-123',
          sessionId: '550e8400-e29b-41d4-a716-446655440001',
          userName: 'User 1',
          status: 'active',
          lastActivity: '2024-01-15T10:30:00Z',
          joinedAt: '2024-01-15T10:00:00Z',
        },
      ],
      startedAt: '2024-01-15T10:00:00Z',
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    expect(() => AwarenessSessionSchema.parse(session)).not.toThrow();
  });

  it('should accept session with documentId', () => {
    const session = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      users: [],
      startedAt: '2024-01-15T10:00:00Z',
      lastUpdate: '2024-01-15T10:30:00Z',
    };

    const parsed = AwarenessSessionSchema.parse(session);
    expect(parsed.documentId).toBe('doc-123');
  });
});

describe('AwarenessUpdateSchema', () => {
  it('should accept status update', () => {
    const update = {
      status: 'idle',
    };

    expect(() => AwarenessUpdateSchema.parse(update)).not.toThrow();
  });

  it('should accept multiple field updates', () => {
    const update = {
      status: 'active',
      currentDocument: 'doc-789',
      currentView: '/dashboard',
      metadata: { activity: 'editing' },
    };

    expect(() => AwarenessUpdateSchema.parse(update)).not.toThrow();
  });
});

describe('AwarenessEventSchema', () => {
  it('should accept user joined event', () => {
    const event = {
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      eventType: 'user.joined',
      userId: 'user-123',
      timestamp: '2024-01-15T10:30:00Z',
      payload: { userName: 'John Doe' },
    };

    expect(() => AwarenessEventSchema.parse(event)).not.toThrow();
  });

  it('should accept all event types', () => {
    const eventTypes = [
      'user.joined',
      'user.left',
      'user.updated',
      'session.created',
      'session.ended',
    ];

    eventTypes.forEach(eventType => {
      const event = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        eventType,
        timestamp: '2024-01-15T10:30:00Z',
        payload: {},
      };

      expect(() => AwarenessEventSchema.parse(event)).not.toThrow();
    });
  });
});

describe('CollaborationMode', () => {
  it('should accept valid collaboration modes', () => {
    const modes = ['ot', 'crdt', 'lock', 'hybrid'];
    
    modes.forEach(mode => {
      expect(() => CollaborationMode.parse(mode)).not.toThrow();
    });
  });

  it('should reject invalid modes', () => {
    expect(() => CollaborationMode.parse('p2p')).toThrow();
    expect(() => CollaborationMode.parse('centralized')).toThrow();
  });
});

describe('CollaborationSessionConfigSchema', () => {
  it('should accept minimal config', () => {
    const config = {
      mode: 'ot',
    };

    expect(() => CollaborationSessionConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept config with all options', () => {
    const config = {
      mode: 'crdt',
      enableCursorSharing: true,
      enablePresence: true,
      enableAwareness: false,
      maxUsers: 50,
      idleTimeoutMs: 600000,
      conflictResolution: 'crdt',
      persistence: true,
      snapshot: {
        enabled: true,
        intervalMs: 60000,
      },
    };

    const parsed = CollaborationSessionConfigSchema.parse(config);
    expect(parsed.maxUsers).toBe(50);
    expect(parsed.snapshot?.enabled).toBe(true);
  });

  it('should use default values', () => {
    const config = { mode: 'ot' };
    
    const parsed = CollaborationSessionConfigSchema.parse(config);
    expect(parsed.enableCursorSharing).toBe(true);
    expect(parsed.enablePresence).toBe(true);
    expect(parsed.enableAwareness).toBe(true);
    expect(parsed.idleTimeoutMs).toBe(300000);
    expect(parsed.conflictResolution).toBe('ot');
    expect(parsed.persistence).toBe(true);
  });
});

describe('CollaborationSessionSchema', () => {
  it('should accept valid collaboration session', () => {
    const session: CollaborationSession = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      config: { mode: 'ot' },
      users: [],
      cursors: [],
      version: 42,
      createdAt: '2024-01-15T10:00:00Z',
      lastActivity: '2024-01-15T10:30:00Z',
      status: 'active',
    };

    expect(() => CollaborationSessionSchema.parse(session)).not.toThrow();
  });

  it('should accept session with operations', () => {
    const session = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      documentId: 'doc-123',
      config: { mode: 'ot' },
      users: [],
      cursors: [],
      version: 5,
      operations: [
        {
          operationId: '550e8400-e29b-41d4-a716-446655440001',
          documentId: 'doc-123',
          userId: 'user-456',
          sessionId: '550e8400-e29b-41d4-a716-446655440002',
          components: [{ type: 'insert', text: 'Hello' }],
          baseVersion: 4,
          timestamp: '2024-01-15T10:30:00Z',
        },
      ],
      createdAt: '2024-01-15T10:00:00Z',
      lastActivity: '2024-01-15T10:30:00Z',
      status: 'active',
    };

    const parsed = CollaborationSessionSchema.parse(session);
    expect(parsed.operations).toHaveLength(1);
  });

  it('should accept all status values', () => {
    const statuses = ['active', 'idle', 'ended'];

    statuses.forEach(status => {
      const session = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        documentId: 'doc-123',
        config: { mode: 'ot' },
        users: [],
        cursors: [],
        version: 0,
        createdAt: '2024-01-15T10:00:00Z',
        lastActivity: '2024-01-15T10:30:00Z',
        status,
      };

      const parsed = CollaborationSessionSchema.parse(session);
      expect(parsed.status).toBe(status);
    });
  });
});

// #15679 (stack card 4/6 of #14478) — ruling B. `idleTimeout` was the live 1000x
// collision that got this population ruled: milliseconds here, seconds on the
// tenant surface. Both old spellings are `retiredKey()` tombstones; asserted on
// the issue CODE and the prescription, never on a bare `toThrow()`.
describe('collaboration session durations carry their unit (#15679)', () => {
  it('REFUSES the retired `idleTimeout` with the rename in the message', () => {
    const result = CollaborationSessionConfigSchema.safeParse({ mode: 'ot', idleTimeout: 600000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'idleTimeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`CollaborationSessionConfig.idleTimeout` was renamed to `idleTimeoutMs`',
    );
  });

  it('REFUSES the retired `snapshot.interval` with the rename in the message', () => {
    const result = CollaborationSessionConfigSchema.safeParse({
      mode: 'ot',
      snapshot: { enabled: true, interval: 60000 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'snapshot.interval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`CollaborationSessionConfig.snapshot.interval` was renamed to `intervalMs`',
    );
  });

  it('accepts the renamed keys at the same magnitude and keeps the 300000 default', () => {
    const parsed = CollaborationSessionConfigSchema.parse({
      mode: 'crdt',
      idleTimeoutMs: 600000,
      snapshot: { enabled: true, intervalMs: 60000 },
    });
    expect(parsed.idleTimeoutMs).toBe(600000);
    expect(parsed.snapshot?.intervalMs).toBe(60000);
    expect(CollaborationSessionConfigSchema.parse({ mode: 'ot' }).idleTimeoutMs).toBe(300000);
  });
});
