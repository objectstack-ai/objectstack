// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

// Mock driver for testing
const createMockDriver = (name: string) => ({
  name,
  version: '1.0.0',
  supports: {},
  connect: async () => {},
  disconnect: async () => {},
  checkHealth: async () => true,
  find: async () => [],
  findOne: async () => null,
  create: async (obj: string, data: any) => ({ id: '1', ...data }),
  update: async (obj: string, id: string, data: any) => ({ id, ...data }),
  delete: async () => true,
  count: async () => 0,
  bulkCreate: async () => [],
  bulkUpdate: async () => [],
  bulkDelete: async () => {},
  execute: async () => ({}),
  findStream: async function* () {},
  upsert: async (obj: string, data: any) => ({ id: '1', ...data }),
  beginTransaction: async () => ({}),
  commit: async () => {},
  rollback: async () => {},
  syncSchema: async () => {},
});

describe('DatasourceMapping', () => {
  let engine: ObjectQL;

  beforeEach(() => {
    engine = new ObjectQL();
    // registry is owned by engine
  });

  it('should route objects by namespace', async () => {
    const memoryDriver = createMockDriver('memory');
    const tursoDriver = createMockDriver('turso');

    engine.registerDriver(memoryDriver);
    engine.registerDriver(tursoDriver, true); // default

    // Configure mapping: crm namespace → memory
    engine.setDatasourceMapping([
      { namespace: 'crm', datasource: 'memory' },
    ]);

    // Register an object in crm namespace
    engine.registry.registerObject(
      {
        name: 'account',
        fields: { name: { type: 'text' } },
      },
      'com.example.crm',
      'crm',
      'own'
    );

    // Test that it uses memory driver
    const result = await engine.insert('account', { name: 'Test Account' });
    expect(result).toBeDefined();
    expect(result.name).toBe('Test Account');
  });

  it('should route objects by pattern', async () => {
    const memoryDriver = createMockDriver('memory');
    const tursoDriver = createMockDriver('turso');

    engine.registerDriver(memoryDriver);
    engine.registerDriver(tursoDriver, true);

    // Configure mapping: sys_* pattern → turso
    engine.setDatasourceMapping([
      { objectPattern: 'sys_*', datasource: 'turso' },
      { default: true, datasource: 'memory' },
    ]);

    // Register system objects
    engine.registry.registerObject(
      {
        name: 'sys_user',
        fields: { username: { type: 'text' } },
      },
      'com.objectstack.system',
      'system',
      'own'
    );

    const result = await engine.insert('sys_user', { username: 'admin' });
    expect(result).toBeDefined();
  });

  it('should respect priority order', async () => {
    const memoryDriver = createMockDriver('memory');
    const tursoDriver = createMockDriver('turso');

    engine.registerDriver(memoryDriver);
    engine.registerDriver(tursoDriver);

    // Higher priority rule should win
    engine.setDatasourceMapping([
      { namespace: 'crm', datasource: 'memory', priority: 100 },
      { namespace: 'crm', datasource: 'turso', priority: 50 }, // Lower number = higher priority
    ]);

    engine.registry.registerObject(
      {
        name: 'account',
        fields: { name: { type: 'text' } },
      },
      'com.example.crm',
      'crm',
      'own'
    );

    // Should use turso (priority 50) not memory (priority 100)
    const result = await engine.insert('account', { name: 'Test' });
    expect(result).toBeDefined();
  });

  it('should fallback to default rule', async () => {
    const memoryDriver = createMockDriver('memory');
    const tursoDriver = createMockDriver('turso');

    engine.registerDriver(memoryDriver);
    engine.registerDriver(tursoDriver);

    engine.setDatasourceMapping([
      { namespace: 'auth', datasource: 'turso' },
      { default: true, datasource: 'memory' },
    ]);

    // Register object in different namespace
    engine.registry.registerObject(
      {
        name: 'task',
        fields: { title: { type: 'text' } },
      },
      'com.example.todo',
      'todo',
      'own'
    );

    // Should use memory (default)
    const result = await engine.insert('task', { title: 'Do something' });
    expect(result).toBeDefined();
  });

  it('should prefer object explicit datasource over mapping', async () => {
    const memoryDriver = createMockDriver('memory');
    const tursoDriver = createMockDriver('turso');

    engine.registerDriver(memoryDriver);
    engine.registerDriver(tursoDriver);

    engine.setDatasourceMapping([
      { namespace: 'crm', datasource: 'memory' },
    ]);

    // Object explicitly sets datasource
    engine.registry.registerObject(
      {
        name: 'account',
        datasource: 'turso', // Explicit override
        fields: { name: { type: 'text' } },
      },
      'com.example.crm',
      'crm',
      'own'
    );

    // Should use turso (explicit) not memory (mapping)
    const result = await engine.insert('account', { name: 'Test' });
    expect(result).toBeDefined();
  });

  // ── #4462: a matched mapping rule is routing, not a hint ──────────────

  describe('a mapped datasource with no live driver never falls through (#4462)', () => {
    /**
     * The defect this pins: `getDriver` step 2 read
     * `mapped && this.drivers.has(mapped)`, so a mapping rule naming a
     * datasource that failed to connect (or was never connected at all) fell
     * silently to step 5 and the object's rows went to the DEFAULT store.
     * Boot succeeded, `/ready` answered 200, the datasource name appeared in
     * zero log lines, and the write returned 201 — the operator found out by
     * looking in the database they declared and finding it empty.
     */
    const registerTask = () =>
      engine.registry.registerObject(
        { name: 'rc1_audit', fields: { title: { type: 'text' } } },
        'com.example.probe',
        'probe',
        'own',
      );

    it('a write to a mapped-but-unconnected datasource fails loudly instead of hitting default', async () => {
      const defaultDriver = createMockDriver('sqlite');
      engine.registerDriver(defaultDriver, true);
      engine.setDatasourceMapping([{ objectPattern: 'rc1_audit', datasource: 'broken' }]);
      registerTask();

      await expect(engine.insert('rc1_audit', { title: 'ds-probe' })).rejects.toThrow(
        /Datasource 'broken' mapped for object 'rc1_audit' is not registered/,
      );
      await expect(engine.find('rc1_audit', {})).rejects.toThrow(/'broken'/);
    });

    it('when the connect verdict is known, the error says WHY rather than "not registered"', async () => {
      engine.registerDriver(createMockDriver('sqlite'), true);
      engine.setDatasourceMapping([{ objectPattern: 'rc1_*', datasource: 'broken' }]);
      registerTask();
      // What `DatasourceConnectionService.recordState` reports after a failed
      // boot connect under OS_ALLOW_DRIVER_CONNECT_FAILURE.
      engine.markDatasourceUnavailable({
        name: 'broken',
        kind: 'failed',
        publicDetail: 'analytics database unreachable',
      });

      await expect(engine.insert('rc1_audit', { title: 'x' })).rejects.toThrow(
        /analytics database unreachable|ERR_DATASOURCE_UNAVAILABLE|broken/,
      );
    });

    it('a mapping to `default` still resolves — the default driver keeps its natural name', async () => {
      // #3826: the default is registered under `sqlite`/`memory`, never under
      // the literal `default`, so `drivers.has('default')` is false by
      // construction and step 5 is how routing to it works. Turning the
      // fall-through into a throw must not break that.
      engine.registerDriver(createMockDriver('sqlite'), true);
      engine.setDatasourceMapping([{ default: true, datasource: 'default' }]);
      registerTask();

      await expect(engine.insert('rc1_audit', { title: 'ok' })).resolves.toBeDefined();
    });

    it('an unmatched mapping leaves an object on the default store', async () => {
      // The rule set is not a claim about EVERY object — only the ones it
      // matches. An object no rule names keeps its old resolution.
      engine.registerDriver(createMockDriver('sqlite'), true);
      engine.setDatasourceMapping([{ objectPattern: 'other_*', datasource: 'broken' }]);
      registerTask();

      await expect(engine.insert('rc1_audit', { title: 'ok' })).resolves.toBeDefined();
    });

    it('resolveMappedDatasource is the one matcher the boot path may ask', async () => {
      // The boot gate (`isDatasourceAddressed` (d)) must learn which objects a
      // rule routes from the SAME resolver routing uses. Two matchers drifting
      // by one clause is how you get a datasource connected that routing never
      // uses, or routed to and never connected — the defect itself.
      engine.setDatasourceMapping([
        { objectPattern: 'rc1_*', datasource: 'broken' },
        { default: true, datasource: 'default' },
      ]);
      registerTask();

      expect(engine.resolveMappedDatasource('rc1_audit')).toBe('broken');
      expect(engine.resolveMappedDatasource('unrelated_object')).toBe('default');
    });
  });
});
