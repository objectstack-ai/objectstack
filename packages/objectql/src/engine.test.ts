import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

// Mock the SchemaRegistry to avoid side effects between tests.
// SchemaRegistry is now a per-instance class (one per ObjectQL engine), so the
// mock has to satisfy both use-sites:
//   1. engine.ts does `new SchemaRegistry()` — the constructor must return a
//      mocked instance whose methods are the same vi.fn() references the
//      tests configure via `vi.mocked(SchemaRegistry.X)`.
//   2. Existing tests reach for `SchemaRegistry.getObject` as if it were a
//      static — we preserve that by also attaching the same mocks to the
//      class itself.
vi.mock('./registry', () => {
  const mockObjects = new Map();
  const mockContributors = new Map();
  const instance: any = {
    getObject: vi.fn((name) => mockObjects.get(name)),
    resolveObject: vi.fn((name) => mockObjects.get(name)),
    registerObject: vi.fn((obj, packageId, namespace, ownership, priority) => {
      const fqn = namespace ? `${namespace}__${obj.name}` : obj.name;
      mockObjects.set(fqn, { ...obj, name: fqn });
      if (!mockContributors.has(fqn)) {
        mockContributors.set(fqn, []);
      }
      const contributors = mockContributors.get(fqn);
      contributors.push({ packageId, namespace, ownership, priority, definition: obj });
      return fqn;
    }),
    getObjectOwner: vi.fn((fqn) => {
      const contributors = mockContributors.get(fqn);
      return contributors?.find((c: any) => c.ownership === 'own');
    }),
    registerNamespace: vi.fn(),
    registerKind: vi.fn(),
    registerItem: vi.fn(),
    registerApp: vi.fn(),
    installPackage: vi.fn((manifest) => ({
      manifest,
      status: 'installed',
      enabled: true,
      installedAt: new Date().toISOString(),
    })),
    reset: vi.fn(() => {
      mockObjects.clear();
      mockContributors.clear();
    }),
    metadata: {
      get: vi.fn(() => mockObjects),
    },
  };
  function SchemaRegistry() {
    return instance;
  }
  Object.assign(SchemaRegistry, instance);
  return {
    SchemaRegistry,
    computeFQN: (ns: string | undefined, name: string) =>
      (ns && ns !== 'base' && ns !== 'system') ? `${ns}__${name}` : name,
    parseFQN: (fqn: string) => {
      const idx = fqn.indexOf('__');
      if (idx < 0) return { namespace: undefined, shortName: fqn };
      return { namespace: fqn.slice(0, idx), shortName: fqn.slice(idx + 2) };
    },
    RESERVED_NAMESPACES: new Set(['base', 'system']),
  };
});

describe('ObjectQL Engine', () => {
    let engine: ObjectQL;
    let mockDriver: IDataDriver;
    let mockDriver2: IDataDriver;

    beforeEach(() => {
        // Clear Registry Mocks
        vi.clearAllMocks();
        
        // Setup Drivers
        mockDriver = {
            name: 'default-driver',
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            find: vi.fn().mockResolvedValue([{ id: '1', name: 'Test Record' }]),
            findOne: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: '1', success: true }),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn(),
            capabilities: {} as any // Simplified
        } as unknown as IDataDriver;

        mockDriver2 = {
            name: 'mongo',
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            find: vi.fn().mockResolvedValue([{ id: '2', name: 'Mongo Record' }]),
            findOne: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: '2', success: true }),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn(),
            capabilities: {} as any
        } as unknown as IDataDriver;

        engine = new ObjectQL();
    });

    describe('Initialization', () => {
        it('should initialize with default logger', () => {
            expect(engine).toBeDefined();
            expect(engine.getStatus().status).toBe('running');
        });

        it('should register and connect drivers on init', async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            expect(mockDriver.connect).toHaveBeenCalled();
        });
    });

    describe('Metadata Registration', () => {
        it('should register objects from app manifest with namespace', () => {
            const manifest = {
                id: 'com.example.app',
                namespace: 'example',
                objects: [
                    { name: 'task', fields: {} }
                ]
            };
            
            engine.registerApp(manifest);
            expect(SchemaRegistry.registerObject).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'task' }), 
                'com.example.app',
                'example',
                'own'
            );
        });

        it('should register objects without namespace (legacy)', () => {
            const manifest = {
                id: 'com.legacy.app',
                objects: [
                    { name: 'item', fields: {} }
                ]
            };
            
            engine.registerApp(manifest);
            expect(SchemaRegistry.registerObject).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'item' }), 
                'com.legacy.app',
                undefined,
                'own'
            );
        });

        it('should register object extensions', () => {
            const manifest = {
                id: 'com.extender.app',
                namespace: 'ext',
                objectExtensions: [
                    { extend: 'contact', fields: { custom_field: { type: 'text' } }, priority: 250 }
                ]
            };
            
            engine.registerApp(manifest);
            expect(SchemaRegistry.registerObject).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'contact' }),
                'com.extender.app',
                undefined,
                'extend',
                250
            );
        });

        it('should register kinds from app manifest', () => {
            const manifest = {
                id: 'com.example.app',
                contributes: {
                    kinds: [{ id: 'test.kind', description: 'Test Kind' }]
                }
            };
            
            engine.registerApp(manifest);
            expect(SchemaRegistry.registerKind).toHaveBeenCalledWith(expect.objectContaining({ id: 'test.kind' }));
        });
    });

    describe('Driver Routing', () => {
        beforeEach(async () => {
            // Setup:
            // - Default Driver: mockDriver
            // - Specific Driver: mockDriver2 (named 'mongo')
            engine.registerDriver(mockDriver, true);
            engine.registerDriver(mockDriver2);
            await engine.init();
        });

        it('should route to default driver when no datasource is specified', async () => {
            // Mock Schema: Object uses default datasource
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', datasource: 'default', fields: {} });

            await engine.find('task', { filters: [] });
            
            expect(mockDriver.find).toHaveBeenCalled();
            expect(mockDriver2.find).not.toHaveBeenCalled();
        });

        it('should route to specific driver when datasource is specified', async () => {
            // Mock Schema: Object uses 'mongo' datasource
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'log', datasource: 'mongo', fields: {} });

            await engine.find('log', { filters: [] });
            
            expect(mockDriver.find).not.toHaveBeenCalled();
            expect(mockDriver2.find).toHaveBeenCalled();
        });

        it('should throw error if datasource is not found', async () => {
             // Mock Schema: Object uses unknown datasource
             vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'old_data', datasource: 'legacy_sql', fields: {} });

             await expect(engine.find('old_data', {})).rejects.toThrow("Datasource 'legacy_sql' configured for object 'old_data' is not registered");
        });
    });

    describe('$search expansion (ADR-0061)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
        });

        it('expands $search into a cross-field $or pushed to the driver', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'account',
                fields: {
                    name: { type: 'text' },
                    industry: { type: 'select', options: [{ label: 'Retail', value: 'retail' }] },
                },
            } as any);

            await engine.find('account', { search: 'retail' });

            const ast = (mockDriver.find as any).mock.calls.at(-1)[1];
            expect(ast.where).toEqual({ $or: [
                { name: { $contains: 'retail' } },
                { industry: { $in: ['retail'] } },
            ] });
            expect(ast.search).toBeUndefined();
        });

        it('ANDs $search with an existing filter and honours declared searchableFields', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'account',
                fields: { name: { type: 'text' }, code: { type: 'text' } },
                searchableFields: ['name'],
            } as any);

            await engine.find('account', { search: 'acme', filter: { status: 'active' } });

            const ast = (mockDriver.find as any).mock.calls.at(-1)[1];
            expect(ast.where.$and).toContainEqual({ status: 'active' });
            expect(ast.where.$and).toContainEqual({ $or: [{ name: { $contains: 'acme' } }] });
        });
    });

    describe('CRUD Operations', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} });
        });

        it('should execute insert operation', async () => {
            const result = await engine.insert('task', { title: 'New Task' });
            expect(mockDriver.create).toHaveBeenCalledWith('task', { title: 'New Task' }, undefined);
            expect(result).toEqual({ id: '1', success: true });
        });

        it('should execute find operation', async () => {
            const result = await engine.find('task', {});
            expect(mockDriver.find).toHaveBeenCalled();
            expect(result).toHaveLength(1);
        });
    });

    describe('execution context via the trailing options arg (read methods)', () => {
        // Regression: reads took context inside the query while writes took it in
        // a trailing options arg — so `find(obj, q, { context })` silently dropped
        // the context (e.g. an intended isSystem bypass), a real source of
        // "empty result once scoping was added" bugs. Reads now ALSO accept the
        // trailing options.context, aligning with insert/update. `tenantId` is a
        // convenient observable: buildDriverOptions forwards it to the driver.
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} });
        });

        const lastFindOpts = () => (mockDriver.find as any).mock.calls.at(-1)?.[2];

        it('find: context from the trailing options arg reaches the driver', async () => {
            await engine.find('task', { filters: [] }, { context: { tenantId: 't-opts' } as any });
            expect(lastFindOpts()).toMatchObject({ tenantId: 't-opts' });
        });

        it('find: context inside the query still works (legacy form)', async () => {
            await engine.find('task', { filters: [], context: { tenantId: 't-query' } as any });
            expect(lastFindOpts()).toMatchObject({ tenantId: 't-query' });
        });

        it('find: when both are given, the trailing options.context wins', async () => {
            await engine.find(
                'task',
                { context: { tenantId: 't-query' } as any },
                { context: { tenantId: 't-opts' } as any },
            );
            expect(lastFindOpts()).toMatchObject({ tenantId: 't-opts' });
        });

        it('findOne accepts context via the trailing options arg', async () => {
            (mockDriver.findOne as any).mockResolvedValue({ id: '1' });
            await engine.findOne('task', { filters: [] }, { context: { tenantId: 't-fo' } as any });
            expect((mockDriver.findOne as any).mock.calls.at(-1)?.[2]).toMatchObject({ tenantId: 't-fo' });
        });

        it('count accepts context via the trailing options arg', async () => {
            (mockDriver.count as any).mockResolvedValue(0);
            await engine.count('task', {}, { context: { tenantId: 't-cnt' } as any });
            expect((mockDriver.count as any).mock.calls.at(-1)?.[2]).toMatchObject({ tenantId: 't-cnt' });
        });
    });

    describe('Update hooks — previous-record snapshot', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
        });

        it('attaches the pre-update record to afterUpdate ctx.previous when an afterUpdate hook is registered', async () => {
            // Regression: record-change flow triggers read `previous.*` in their
            // start condition (e.g. `status == "done" && previous.status != "done"`).
            // The engine must expose the pre-update row on the hook context.
            vi.mocked(mockDriver.findOne).mockResolvedValue({ id: 't1', status: 'in_review', assignee: 'sam@example.com' });
            vi.mocked(mockDriver.update).mockResolvedValue({ id: 't1', status: 'done', assignee: 'sam@example.com' } as any);

            let captured: any = 'UNSET';
            engine.registerHook('afterUpdate', async (ctx: any) => { captured = ctx.previous; }, { packageId: 'test' } as any);

            await engine.update('task', { id: 't1', status: 'done' });

            expect(mockDriver.findOne).toHaveBeenCalled();
            expect(captured).toEqual({ id: 't1', status: 'in_review', assignee: 'sam@example.com' });
        });

        it('does not fetch the prior record when no afterUpdate hook is registered and no rule needs it', async () => {
            vi.mocked(mockDriver.update).mockResolvedValue({ id: 't1' } as any);
            await engine.update('task', { id: 't1', status: 'done' });
            expect(mockDriver.findOne).not.toHaveBeenCalled();
        });
    });

    describe('Update routing — where.id operator objects', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
            (mockDriver as any).updateMany = vi.fn().mockResolvedValue(2);
        });

        it('routes where:{id:{$in:[...]}} + multi to updateMany, not single update', async () => {
            // Regression: a multi-row predicate on `id` ({ $in: [...] }) was
            // mis-extracted as a scalar id and bound literally by the driver
            // (`WHERE id = {"$in":[...]}`), which SQLite rejects. It must route
            // to updateMany so the operator is compiled to `WHERE id IN (...)`.
            await engine.update(
                'task',
                { status: 'in_flight' },
                { where: { id: { $in: ['a', 'b'] }, status: 'pending' }, multi: true } as any,
            );

            expect((mockDriver as any).updateMany).toHaveBeenCalledTimes(1);
            const [obj, ast] = (mockDriver as any).updateMany.mock.calls[0];
            expect(obj).toBe('task');
            expect(ast.where).toEqual({ id: { $in: ['a', 'b'] }, status: 'pending' });
            // The single-row update path must NOT have been taken.
            expect(mockDriver.update).not.toHaveBeenCalled();
        });

        it('still treats a scalar where.id as a single-row update', async () => {
            vi.mocked(mockDriver.update).mockResolvedValue({ id: 't1' } as any);
            await engine.update('task', { status: 'done' }, { where: { id: 't1' } } as any);
            expect(mockDriver.update).toHaveBeenCalledTimes(1);
            const [obj, id, data] = vi.mocked(mockDriver.update).mock.calls[0];
            expect(obj).toBe('task');
            expect(id).toBe('t1');
            expect(data).toEqual({ status: 'done' });
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
        });
    });

    describe('Expand Related Records', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
        });

        it('should expand lookup fields by replacing IDs with full objects', async () => {
            // Setup: task has a lookup field "assignee" → user object
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                        title: { type: 'text' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {
                        name: { type: 'text' },
                    },
                } as any;
                return undefined;
            });

            // Primary find returns tasks with assignee IDs
            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', title: 'Task 1', assignee: 'u1' },
                    { id: 't2', title: 'Task 2', assignee: 'u2' },
                ])
                // Second call (expand): returns user records
                .mockResolvedValueOnce([
                    { id: 'u1', name: 'Alice' },
                    { id: 'u2', name: 'Bob' },
                ]);

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });

            expect(result).toHaveLength(2);
            expect(result[0].assignee).toEqual({ id: 'u1', name: 'Alice' });
            expect(result[1].assignee).toEqual({ id: 'u2', name: 'Bob' });

            // Verify the expand query used $in
            expect(mockDriver.find).toHaveBeenCalledTimes(2);
            expect(mockDriver.find).toHaveBeenLastCalledWith(
                'user',
                expect.objectContaining({
                    object: 'user',
                    where: { id: { $in: ['u1', 'u2'] } },
                }),
                undefined,
            );
        });

        it('should expand master_detail fields', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'order_item') return {
                    name: 'order_item',
                    fields: {
                        order: { type: 'master_detail', reference: 'order' },
                    },
                } as any;
                if (name === 'order') return {
                    name: 'order',
                    fields: { total: { type: 'number' } },
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 'oi1', order: 'o1' },
                ])
                .mockResolvedValueOnce([
                    { id: 'o1', total: 100 },
                ]);

            const result = await engine.find('order_item', { expand: { order: { object: 'order' } } });
            expect(result[0].order).toEqual({ id: 'o1', total: 100 });
        });

        it('should skip expand for fields without reference definition', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'task',
                fields: {
                    title: { type: 'text' }, // Not a lookup
                },
            } as any);

            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 't1', title: 'Task 1' },
            ]);

            const result = await engine.find('task', { expand: { title: { object: 'title' } } });
            expect(result[0].title).toBe('Task 1'); // Unchanged
            expect(mockDriver.find).toHaveBeenCalledTimes(1); // No expand query
        });

        it('should skip expand if schema is not registered', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(undefined);

            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 't1', assignee: 'u1' },
            ]);

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });
            expect(result[0].assignee).toBe('u1'); // Unchanged — raw ID
            expect(mockDriver.find).toHaveBeenCalledTimes(1);
        });

        it('should drop formula fields from driver projection and evaluate them after fetch', async () => {
            // Regression: planFormulaProjection used to add ALL schema fields
            // (including the formula fields themselves) back to projected,
            // which caused the SQL driver to emit `SELECT response_rate ...`
            // and fail silently with [] (no such column).
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'campaign',
                fields: {
                    id: { type: 'text' },
                    name: { type: 'text' },
                    budgeted_cost: { type: 'number' },
                    actual_cost: { type: 'number' },
                    response_rate: {
                        type: 'formula',
                        expression: { dialect: 'cel', source: 'record.budgeted_cost - record.actual_cost' },
                    },
                },
            } as any);

            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 'c1', name: 'Campaign A', budgeted_cost: 100, actual_cost: 30 },
            ]);

            const result = await engine.find('campaign', {
                fields: ['id', 'name', 'response_rate'],
            } as any);

            // Driver should NOT receive the formula field in its projection
            const driverCall = vi.mocked(mockDriver.find).mock.calls[0]?.[1] as any;
            expect(driverCall.fields).toContain('id');
            expect(driverCall.fields).toContain('name');
            expect(driverCall.fields).toContain('budgeted_cost');
            expect(driverCall.fields).toContain('actual_cost');
            expect(driverCall.fields).not.toContain('response_rate');

            // But the result still carries the computed formula value
            expect(result[0].response_rate).toBe(70);
        });

        it('evaluates read-time formula fields with execution-context user/org (#1979)', async () => {
            // Regression: applyFormulaPlan used to pass only `{ record }`, so a
            // computed field referencing the caller (`os.user.id` / `os.org.id`)
            // faulted and fell back to null. The context now threads through.
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'memo',
                fields: {
                    id: { type: 'text' },
                    body: { type: 'text' },
                    author_ref: {
                        type: 'formula',
                        expression: { dialect: 'cel', source: 'os.user.id' },
                    },
                    org_ref: {
                        type: 'formula',
                        expression: { dialect: 'cel', source: 'os.org.id' },
                    },
                },
            } as any);

            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 'm1', body: 'hello' },
                { id: 'm2', body: 'world' },
            ]);

            const result = await engine.find(
                'memo',
                { fields: ['id', 'author_ref', 'org_ref'] } as any,
                { context: { userId: 'u-42', tenantId: 'org-7', roles: ['admin'] } as any },
            );

            expect(result.map((r: any) => r.author_ref)).toEqual(['u-42', 'u-42']);
            expect(result.map((r: any) => r.org_ref)).toEqual(['org-7', 'org-7']);
        });

        it('pins `now` once per find so every row sees the same instant (#1979)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'ping',
                fields: {
                    id: { type: 'text' },
                    ts: {
                        type: 'formula',
                        expression: { dialect: 'cel', source: 'now()' },
                    },
                },
            } as any);

            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 'a' }, { id: 'b' }, { id: 'c' },
            ]);

            const result = await engine.find('ping', { fields: ['id', 'ts'] } as any);

            // Determinism: a single operation snapshots one `now`, shared across
            // every row — not a fresh wall-clock read per evaluation.
            expect(result[0].ts).toEqual(result[1].ts);
            expect(result[1].ts).toEqual(result[2].ts);
        });

        it('should handle null values gracefully during expand', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', assignee: null },
                    { id: 't2', assignee: 'u1' },
                ])
                .mockResolvedValueOnce([
                    { id: 'u1', name: 'Alice' },
                ]);

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });
            expect(result[0].assignee).toBeNull();
            expect(result[1].assignee).toEqual({ id: 'u1', name: 'Alice' });
        });

        it('should de-duplicate foreign key IDs in batch query', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', assignee: 'u1' },
                    { id: 't2', assignee: 'u1' }, // Same user
                    { id: 't3', assignee: 'u2' },
                ])
                .mockResolvedValueOnce([
                    { id: 'u1', name: 'Alice' },
                    { id: 'u2', name: 'Bob' },
                ]);

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });

            // Verify only 2 unique IDs queried
            expect(mockDriver.find).toHaveBeenLastCalledWith(
                'user',
                expect.objectContaining({
                    where: { id: { $in: ['u1', 'u2'] } },
                }),
                undefined,
            );
            expect(result[0].assignee).toEqual({ id: 'u1', name: 'Alice' });
            expect(result[1].assignee).toEqual({ id: 'u1', name: 'Alice' });
        });

        it('should keep raw ID when referenced record not found', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', assignee: 'u_deleted' },
                ])
                .mockResolvedValueOnce([]); // No records found

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });
            expect(result[0].assignee).toBe('u_deleted'); // Fallback to raw ID
        });

        it('should expand multiple fields in a single query', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                        project: { type: 'lookup', reference: 'project' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                if (name === 'project') return {
                    name: 'project',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', assignee: 'u1', project: 'p1' },
                ])
                .mockResolvedValueOnce([{ id: 'u1', name: 'Alice' }])
                .mockResolvedValueOnce([{ id: 'p1', name: 'Project X' }]);

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' }, project: { object: 'project' } } });

            expect(result[0].assignee).toEqual({ id: 'u1', name: 'Alice' });
            expect(result[0].project).toEqual({ id: 'p1', name: 'Project X' });
            expect(mockDriver.find).toHaveBeenCalledTimes(3);
        });

        it('should work with findOne and expand', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.findOne as any).mockResolvedValueOnce(
                { id: 't1', title: 'Task 1', assignee: 'u1' },
            );
            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 'u1', name: 'Alice' },
            ]);

            const result = await engine.findOne('task', { expand: { assignee: { object: 'assignee' } } });

            expect(result.assignee).toEqual({ id: 'u1', name: 'Alice' });
        });

        it('should handle already-expanded objects (skip re-expansion)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            // Driver returns an already-expanded object
            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 't1', assignee: { id: 'u1', name: 'Alice' } },
            ]);

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });

            // No expand query should have been made — the value was already an object
            expect(mockDriver.find).toHaveBeenCalledTimes(1);
            expect(result[0].assignee).toEqual({ id: 'u1', name: 'Alice' });
        });

        it('should gracefully handle expand errors and keep raw IDs', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        assignee: { type: 'lookup', reference: 'user' },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', assignee: 'u1' },
                ])
                .mockRejectedValueOnce(new Error('Driver connection failed'));

            const result = await engine.find('task', { expand: { assignee: { object: 'assignee' } } });
            expect(result[0].assignee).toBe('u1'); // Kept raw ID
        });

        it('should handle multi-value lookup fields (arrays)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: {
                        watchers: { type: 'lookup', reference: 'user', multiple: true },
                    },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: {},
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', watchers: ['u1', 'u2'] },
                ])
                .mockResolvedValueOnce([
                    { id: 'u1', name: 'Alice' },
                    { id: 'u2', name: 'Bob' },
                ]);

            const result = await engine.find('task', { expand: { watchers: { object: 'watchers' } } });
            expect(result[0].watchers).toEqual([
                { id: 'u1', name: 'Alice' },
                { id: 'u2', name: 'Bob' },
            ]);
        });

        it('should expand only fields specified in the expand map (populate creates flat expand)', async () => {
            // populate: ['project'] creates expand: { project: { object: 'project' } } (1 level only)
            // Nested fields like project.org should NOT be expanded unless explicitly nested in the AST
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                const schemas: Record<string, any> = {
                    task: { name: 'task', fields: { project: { type: 'lookup', reference: 'project' } } },
                    project: { name: 'project', fields: { org: { type: 'lookup', reference: 'org' } } },
                };
                return schemas[name] as any;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([{ id: 't1', project: 'p1' }])  // find task
                .mockResolvedValueOnce([{ id: 'p1', org: 'o1' }]);     // expand project (depth 0)
                // org should NOT be expanded further — flat populate doesn't create nested expand

            const result = await engine.find('task', { expand: { project: { object: 'project' } } });

            // Project expanded, but org inside project remains as raw ID
            expect(result[0].project).toEqual({ id: 'p1', org: 'o1' });
            expect(mockDriver.find).toHaveBeenCalledTimes(2); // Only primary + 1 expand query
        });

        it('should return records unchanged when expand map is empty', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'task',
                fields: {},
            } as any);

            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 't1', title: 'Task 1' },
            ]);

            const result = await engine.find('task', {});
            expect(result).toEqual([{ id: 't1', title: 'Task 1' }]);
            expect(mockDriver.find).toHaveBeenCalledTimes(1);
        });
    });
});
