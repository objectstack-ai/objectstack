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

        it('stamps a `current_user` defaultValue with the acting user id on insert', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'ticket') return {
                    name: 'ticket',
                    fields: {
                        title: { type: 'text' },
                        owner: { type: 'user', reference: 'sys_user', defaultValue: 'current_user' },
                    },
                } as any;
                if (name === 'sys_user') return { name: 'sys_user', fields: { name: { type: 'text' } } } as any;
                return undefined;
            });

            await engine.insert('ticket', { title: 'T1' }, { context: { userId: 'u-42' } as any });

            expect(mockDriver.create).toHaveBeenCalledWith(
                'ticket',
                expect.objectContaining({ title: 'T1', owner: 'u-42' }),
                expect.anything(),
            );
        });

        it('leaves a `current_user` default unset when there is no authenticated user', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'ticket') return {
                    name: 'ticket',
                    fields: {
                        title: { type: 'text' },
                        owner: { type: 'user', reference: 'sys_user', defaultValue: 'current_user' },
                    },
                } as any;
                if (name === 'sys_user') return { name: 'sys_user', fields: { name: { type: 'text' } } } as any;
                return undefined;
            });

            await engine.insert('ticket', { title: 'T2' });

            const arg = (mockDriver.create as any).mock.calls.at(-1)[1];
            expect(arg.owner).toBeUndefined();
        });

        it('backfills a default when the field is EXPLICITLY null, not just omitted (#2706)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'ticket') return {
                    name: 'ticket',
                    fields: {
                        title: { type: 'text' },
                        owner: { type: 'user', reference: 'sys_user', defaultValue: 'current_user' },
                        status: { type: 'text', defaultValue: 'planned' },
                    },
                } as any;
                if (name === 'sys_user') return { name: 'sys_user', fields: { name: { type: 'text' } } } as any;
                return undefined;
            });

            // A form serializes an unpicked control as explicit `null` (not
            // omission) — both the dynamic `current_user` token and a static
            // default must still fill in.
            await engine.insert('ticket', { title: 'T1', owner: null, status: null }, { context: { userId: 'u-42' } as any });

            expect(mockDriver.create).toHaveBeenCalledWith(
                'ticket',
                expect.objectContaining({ title: 'T1', owner: 'u-42', status: 'planned' }),
                expect.anything(),
            );
        });

        it('respects an explicit empty-string value and does not overwrite it with the default (#2706)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'ticket') return {
                    name: 'ticket',
                    fields: {
                        title: { type: 'text' },
                        status: { type: 'text', defaultValue: 'planned' },
                    },
                } as any;
                return undefined;
            });

            await engine.insert('ticket', { title: 'T1', status: '' });

            const arg = (mockDriver.create as any).mock.calls.at(-1)[1];
            expect(arg.status).toBe('');
        });

        it('resolves field defaults BEFORE beforeInsert so a hook can derive from them (#2703)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'ticket') return {
                    name: 'ticket',
                    fields: {
                        title: { type: 'text' },
                        owner: { type: 'user', reference: 'sys_user', defaultValue: 'current_user' },
                        current_status: { type: 'text' },
                    },
                } as any;
                if (name === 'sys_user') return { name: 'sys_user', fields: { name: { type: 'text' } } } as any;
                return undefined;
            });

            // A beforeInsert hook that DERIVES `current_status` from the defaulted
            // `owner` field — the exact os-tianshun-mtc#29 scenario.
            engine.registerHook('beforeInsert', async (ctx: any) => {
                const data = ctx.input.data;
                data.current_status = data.owner ? 'assigned' : 'unassigned';
            }, { object: 'ticket' });

            await engine.insert('ticket', { title: 'T1' }, { context: { userId: 'u-42' } as any });

            expect(mockDriver.create).toHaveBeenCalledWith(
                'ticket',
                expect.objectContaining({ title: 'T1', owner: 'u-42', current_status: 'assigned' }),
                expect.anything(),
            );
        });

        it('should execute find operation', async () => {
            const result = await engine.find('task', {});
            expect(mockDriver.find).toHaveBeenCalled();
            expect(result).toHaveLength(1);
        });
    });

    describe('batch insert triggers hooks per row (#2922)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: { title: { type: 'text' } } } as any);
        });

        it('fires beforeInsert/afterInsert once per row with the single-record context shape', async () => {
            const beforeRows: any[] = [];
            const afterResults: any[] = [];
            engine.registerHook('beforeInsert', async (ctx: any) => {
                beforeRows.push(ctx.input.data);
                // Same mutation contract as single insert: write one row's field.
                ctx.input.data.stamped = ctx.input.data.title.toUpperCase();
            }, { object: 'task' });
            engine.registerHook('afterInsert', async (ctx: any) => {
                afterResults.push(ctx.result);
            }, { object: 'task' });
            (mockDriver.create as any).mockImplementation(async (_o: string, row: any) => ({ id: `id-${row.title}`, ...row }));

            const result = await engine.insert('task', [{ title: 'a' }, { title: 'b' }]);

            expect(beforeRows).toHaveLength(2);
            expect(Array.isArray(beforeRows[0])).toBe(false);
            expect(beforeRows[0]).toMatchObject({ title: 'a' });
            expect(beforeRows[1]).toMatchObject({ title: 'b' });
            // The per-row mutation reached the driver for each row.
            expect((mockDriver.create as any).mock.calls[0][1]).toMatchObject({ title: 'a', stamped: 'A' });
            expect((mockDriver.create as any).mock.calls[1][1]).toMatchObject({ title: 'b', stamped: 'B' });
            // afterInsert sees one record per row, never the whole array.
            expect(afterResults).toHaveLength(2);
            expect(Array.isArray(afterResults[0])).toBe(false);
            expect(afterResults[0]).toMatchObject({ id: 'id-a' });
            expect(afterResults[1]).toMatchObject({ id: 'id-b' });
            expect(result).toHaveLength(2);
        });

        it('pairs each afterInsert result with its own row when the driver bulk-creates', async () => {
            (mockDriver as any).bulkCreate = vi.fn(async (_o: string, rows: any[]) =>
                rows.map((r: any) => ({ id: `id-${r.title}`, ...r })));
            const afterResults: any[] = [];
            engine.registerHook('afterInsert', async (ctx: any) => { afterResults.push(ctx.result); }, { object: 'task' });

            await engine.insert('task', [{ title: 'a' }, { title: 'b' }]);

            expect((mockDriver as any).bulkCreate).toHaveBeenCalledTimes(1);
            expect(afterResults.map((r) => r.id)).toEqual(['id-a', 'id-b']);
        });
    });

    describe('skipAutomations suppresses metadata-bound hooks (#2922)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
        });

        it('skips hooks bound from metadata but still runs code-registered system hooks', async () => {
            const calls: string[] = [];
            // Metadata-bound automation hook: `meta` present (bindHooksToEngine shape).
            engine.registerHook('beforeInsert', async () => { calls.push('automation'); },
                { object: 'task', meta: { name: 'auto_hook', events: ['beforeInsert'] } });
            // Code-registered system hook (audit/security shape): no `meta`.
            engine.registerHook('beforeInsert', async () => { calls.push('system'); }, { object: 'task' });

            await engine.insert('task', { title: 'x' }, { context: { skipAutomations: true } as any });
            expect(calls).toEqual(['system']);

            calls.length = 0;
            await engine.insert('task', { title: 'y' });
            expect(calls.sort()).toEqual(['automation', 'system']);
        });

        it('implies skipTriggers on the hook session so flow dispatch is suppressed too', async () => {
            let session: any;
            engine.registerHook('afterInsert', async (ctx: any) => { session = ctx.session; }, { object: 'task' });

            await engine.insert('task', { title: 'x' }, { context: { userId: 'u1', skipAutomations: true } as any });

            expect(session).toMatchObject({ skipAutomations: true, skipTriggers: true });
        });
    });

    describe('organizationId exposed to hooks as the blessed org name (#3280)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
        });

        it('populates session.organizationId + user.organizationId, both equal to the resolved org', async () => {
            let session: any, user: any;
            engine.registerHook('beforeInsert', async (ctx: any) => { session = ctx.session; user = ctx.user; }, { object: 'task' });

            await engine.insert('task', { title: 'x' }, { context: { userId: 'u1', tenantId: 'org_1' } as any });

            // Blessed name carries the org; the deprecated `tenantId` alias was
            // removed in v11 (#3290) and must no longer be emitted.
            expect(session.organizationId).toBe('org_1');
            expect(session.tenantId).toBeUndefined();
            // `ctx.user` shortcut carries the same org for zero-relearning filtering.
            expect(user).toMatchObject({ id: 'u1', organizationId: 'org_1' });
        });

        it('unscoped (no org) call: session present, org fields undefined, user has no organizationId', async () => {
            let session: any, user: any;
            engine.registerHook('beforeInsert', async (ctx: any) => { session = ctx.session; user = ctx.user; }, { object: 'task' });

            await engine.insert('task', { title: 'y' }, { context: { userId: 'u1' } as any });

            expect(session).toBeDefined();
            expect(session.organizationId).toBeUndefined();
            expect(session.tenantId).toBeUndefined();
            expect(user).toMatchObject({ id: 'u1' });
            expect(user.organizationId).toBeUndefined();
        });

        it('system / no acting user: user shortcut is undefined (org read via session)', async () => {
            let userSeen: any = 'unset';
            engine.registerHook('beforeInsert', async (ctx: any) => { userSeen = ctx.user; }, { object: 'task' });

            await engine.insert('task', { title: 'z' }, { context: { isSystem: true, tenantId: 'org_1' } as any });

            expect(userSeen).toBeUndefined();
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

    describe('tenancy.enabled:false objects are platform-global (#3249, ADR-0066)', () => {
        // Regression: buildDriverOptions stamped execCtx.tenantId into driver
        // options unconditionally, so a platform-global object (sys_license)
        // got org-scoped at the driver and its NULL-org rows vanished for an
        // authenticated org-context read while anonymous reads saw them.
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
        });

        const lastFindOpts = () => (mockDriver.find as any).mock.calls.at(-1)?.[2];

        it('does not stamp execCtx.tenantId into driver options for a tenancy-disabled object', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'sys_license', tenancy: { enabled: false }, fields: {},
            } as any);
            await engine.find('sys_license', { filters: [] }, { context: { tenantId: 'org_admin' } as any });
            expect(lastFindOpts()?.tenantId).toBeUndefined();
        });

        it('still stamps tenantId for objects without a tenancy declaration', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
            await engine.find('task', { filters: [] }, { context: { tenantId: 'org_a' } as any });
            expect(lastFindOpts()).toMatchObject({ tenantId: 'org_a' });
        });

        it('still stamps tenantId for an explicit tenancy.enabled:true object', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'task', tenancy: { enabled: true }, fields: {},
            } as any);
            await engine.find('task', { filters: [] }, { context: { tenantId: 'org_a' } as any });
            expect(lastFindOpts()).toMatchObject({ tenantId: 'org_a' });
        });

        it('still threads timezone (and the rest of the context) while withholding tenantId', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'sys_license', tenancy: { enabled: false }, fields: {},
            } as any);
            await engine.find('sys_license', { filters: [] }, {
                context: { tenantId: 'org_admin', timezone: 'Asia/Shanghai' } as any,
            });
            expect(lastFindOpts()).toMatchObject({ timezone: 'Asia/Shanghai' });
            expect(lastFindOpts()?.tenantId).toBeUndefined();
        });

        it('an explicitly-passed base tenantId still reaches the driver (caller intent wins)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'sys_license', tenancy: { enabled: false }, fields: {},
            } as any);
            // buildDriverOptions merges over the caller-supplied base options
            // (for find: the query object) and never overwrites an explicit
            // tenantId — deliberate cross-checks stay possible.
            await engine.find(
                'sys_license',
                { filters: [], tenantId: 'org_explicit' } as any,
                { context: { timezone: 'UTC' } as any },
            );
            expect(lastFindOpts()).toMatchObject({ tenantId: 'org_explicit' });
        });

        it('write path: insert on a tenancy-disabled object carries no tenantId to the driver', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'sys_license', tenancy: { enabled: false }, fields: {},
            } as any);
            await engine.insert('sys_license', { customer: 'ACME' }, { context: { tenantId: 'org_admin' } as any });
            const createOpts = (mockDriver.create as any).mock.calls.at(-1)?.[2];
            expect(createOpts?.tenantId).toBeUndefined();
        });
    });

    describe('Read hooks on findOne + registration guard (#3195)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
        });

        it('findOne fires beforeFind and afterFind (one read event covers find and findOne)', async () => {
            (mockDriver.findOne as any).mockResolvedValue({ id: 't1', name: 'raw' });
            const events: string[] = [];
            engine.registerHook('beforeFind', async () => { events.push('beforeFind'); }, { object: 'task' });
            engine.registerHook('afterFind', async () => { events.push('afterFind'); }, { object: 'task' });

            await engine.findOne('task', { where: { id: 't1' } } as any);

            expect(events).toEqual(['beforeFind', 'afterFind']);
        });

        it('afterFind hook can transform the findOne result', async () => {
            (mockDriver.findOne as any).mockResolvedValue({ id: 't1', name: 'raw' });
            engine.registerHook('afterFind', async (ctx: any) => {
                if (ctx.result) ctx.result.name = 'masked';
            }, { object: 'task' });

            const out = await engine.findOne('task', { where: { id: 't1' } } as any);

            expect(out).toMatchObject({ id: 't1', name: 'masked' });
        });

        it('warns when a hook subscribes to an event the engine never dispatches', () => {
            const warn = vi.spyOn((engine as any).logger, 'warn');
            engine.registerHook('beforeFindOne', async () => {}, { object: 'task' });
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining("'beforeFindOne'"),
                expect.objectContaining({ event: 'beforeFindOne' }),
            );
        });

        it('does not warn for a dispatchable event', () => {
            const warn = vi.spyOn((engine as any).logger, 'warn');
            engine.registerHook('beforeUpdate', async () => {}, { object: 'task' });
            const warnedForUpdate = warn.mock.calls.some((c) => String(c[0]).includes("'beforeUpdate'"));
            expect(warnedForUpdate).toBe(false);
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

    describe('Bulk write row-scoping — middleware-injected ast (#2982)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);
            (mockDriver as any).updateMany = vi.fn().mockResolvedValue(2);
            (mockDriver as any).deleteMany = vi.fn().mockResolvedValue(2);
        });

        it('seeds opCtx.ast with the caller predicate and hands the middleware-composed where to updateMany', async () => {
            // Regression: the multi branch used to REBUILD the AST from
            // `options.where` after the middleware chain ran, so a row-scoping
            // filter AND-composed onto opCtx.ast (RLS write policies, the
            // sharing plugin's editable-rows filter) never bound the driver
            // operation — a member's bulk write touched every matching row.
            engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
                if (opCtx.operation === 'update' && opCtx.ast) {
                    opCtx.ast.where = { $and: [opCtx.ast.where, { owner_id: 'u1' }] };
                }
                await next();
            });

            await engine.update(
                'task',
                { status: 'done' },
                { where: { status: 'pending' }, multi: true } as any,
            );

            expect((mockDriver as any).updateMany).toHaveBeenCalledTimes(1);
            const [, ast] = (mockDriver as any).updateMany.mock.calls[0];
            expect(ast.where).toEqual({ $and: [{ status: 'pending' }, { owner_id: 'u1' }] });
        });

        it('seeds opCtx.ast for multi delete and hands the composed where to deleteMany', async () => {
            engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
                if (opCtx.operation === 'delete' && opCtx.ast) {
                    opCtx.ast.where = { $and: [opCtx.ast.where, { owner_id: 'u1' }] };
                }
                await next();
            });

            await engine.delete('task', { where: { status: 'stale' }, multi: true } as any);

            expect((mockDriver as any).deleteMany).toHaveBeenCalledTimes(1);
            const [, ast] = (mockDriver as any).deleteMany.mock.calls[0];
            expect(ast.where).toEqual({ $and: [{ status: 'stale' }, { owner_id: 'u1' }] });
        });

        it('does not seed opCtx.ast for a single-id update (pre-image checks own that path)', async () => {
            let seenAst: unknown = 'unset';
            engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
                if (opCtx.operation === 'update') seenAst = opCtx.ast;
                await next();
            });
            vi.mocked(mockDriver.update).mockResolvedValue({ id: 't1' } as any);

            await engine.update('task', { status: 'done' }, { where: { id: 't1' } } as any);

            expect(seenAst).toBeUndefined();
            expect(mockDriver.update).toHaveBeenCalledTimes(1);
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
        });

        it('seeds opCtx.ast for an id-LIST bulk delete ({id:{$in}}) so it routes to a scoped deleteMany (#2982 parity)', async () => {
            // Regression: delete() lacked update()'s scalar-id guard, so an
            // operator-object where.id was mistaken for a single id — skipping
            // the seed and routing to driver.delete with a garbage id, never
            // reaching the owner-scoped deleteMany path.
            engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
                if (opCtx.operation === 'delete' && opCtx.ast) {
                    opCtx.ast.where = { $and: [opCtx.ast.where, { owner_id: 'u1' }] };
                }
                await next();
            });

            await engine.delete('task', { where: { id: { $in: ['a', 'b'] } }, multi: true } as any);

            expect((mockDriver as any).deleteMany).toHaveBeenCalledTimes(1);
            expect(mockDriver.delete).not.toHaveBeenCalled();
            const [, ast] = (mockDriver as any).deleteMany.mock.calls[0];
            expect(ast.where).toEqual({ $and: [{ id: { $in: ['a', 'b'] } }, { owner_id: 'u1' }] });
        });

        it('fails CLOSED (throws) if a hook clears the target id so the multi branch runs without a seeded ast', async () => {
            // The only way to reach the multi branch with no seeded ast is a
            // beforeUpdate hook clearing input.id after a truthy-id seed skip.
            // The old `?? { object, where }` fallback would have silently
            // rebuilt an UNSCOPED predicate; we now refuse it.
            engine.registerHook('beforeUpdate', async (ctx: any) => {
                ctx.input.id = undefined; // force the multi branch, no seeded ast
            });

            await expect(
                engine.update('task', { id: 't1', status: 'done' }, { multi: true } as any),
            ).rejects.toThrow(/row-scoping AST was not seeded/);
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
        });
    });

    describe('seed writes bypass state_machine validation (#3433)', () => {
        // A curated seed row can be born mid-lifecycle (a project already
        // `completed`, an opportunity `closed_won`). The engine skips the
        // `state_machine` rule for writes whose context carries `seedReplay`
        // (set by SeedLoaderService) — otherwise a declared `initialStates`
        // silently rejects every such row on INSERT and cascades its children.
        const approvalObject = {
            name: 'seed_approval',
            fields: {
                status: {
                    type: 'select',
                    options: [
                        { value: 'draft', label: 'Draft' },
                        { value: 'pending', label: 'Pending' },
                        { value: 'approved', label: 'Approved' },
                    ],
                },
            },
            validations: [
                {
                    type: 'state_machine',
                    name: 'approval_flow',
                    field: 'status',
                    message: 'A request must start as draft.',
                    initialStates: ['draft'],
                    transitions: { draft: ['pending'], pending: ['approved'] },
                },
            ],
        };

        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
        });

        it('rejects a mid-lifecycle INSERT under a normal context (control)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(approvalObject as any);
            await expect(
                engine.insert('seed_approval', { status: 'approved' }),
            ).rejects.toThrow(/must start as draft/i);
            expect(mockDriver.create).not.toHaveBeenCalled();
        });

        it('admits the same INSERT when the context carries seedReplay', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(approvalObject as any);
            await engine.insert('seed_approval', { status: 'approved' }, { context: { seedReplay: true } as any });
            expect(mockDriver.create).toHaveBeenCalledTimes(1);
        });

        it('still enforces non-state_machine rules under seedReplay (scoped exemption)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                ...approvalObject,
                fields: { ...approvalObject.fields, email: { type: 'text' } },
                validations: [
                    approvalObject.validations[0],
                    { type: 'format', name: 'email_format', message: 'email must be a valid email', field: 'email', format: 'email' },
                ],
            } as any);
            await expect(
                engine.insert('seed_approval', { status: 'approved', email: 'not-an-email' }, { context: { seedReplay: true } as any }),
            ).rejects.toThrow(/valid email/);
            expect(mockDriver.create).not.toHaveBeenCalled();
        });
    });

    describe('Bulk update validation enforcement (#3106)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            (mockDriver as any).updateMany = vi.fn().mockResolvedValue(2);
        });

        it('enforces a prior-free format rule on multi without fetching rows', async () => {
            // format / json_schema need nothing from the prior record, so the
            // bulk path must evaluate them against the payload with NO fetch.
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'acct',
                fields: { email: { type: 'text' } },
                validations: [{ type: 'format', name: 'email_format', message: 'email must be a valid email', field: 'email', format: 'email' }],
            } as any);

            await expect(
                engine.update('acct', { email: 'not-an-email' }, { where: { status: 'active' }, multi: true } as any),
            ).rejects.toThrow(/valid email/);
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
            expect(mockDriver.find).not.toHaveBeenCalled();
        });

        it('lets a valid payload through the same format rule', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'acct',
                fields: { email: { type: 'text' } },
                validations: [{ type: 'format', name: 'email_format', message: 'email must be a valid email', field: 'email', format: 'email' }],
            } as any);

            await engine.update('acct', { email: 'a@example.com' }, { where: { status: 'active' }, multi: true } as any);
            expect((mockDriver as any).updateMany).toHaveBeenCalledTimes(1);
        });

        it('evaluates a state_machine rule per matched row and rejects the whole batch when one row violates', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'task',
                fields: { status: { type: 'select' } },
                validations: [{ type: 'state_machine', name: 'status_flow', message: 'illegal status transition', field: 'status', transitions: { pending: ['in_flight'], done: ['archived'] } }],
            } as any);
            // Rows are fetched with the SAME row-scoped ast the write binds.
            vi.mocked(mockDriver.find).mockResolvedValue([
                { id: 'a', status: 'pending' }, // pending → in_flight is legal
                { id: 'b', status: 'done' },    // done → in_flight is not
            ] as any);

            await expect(
                engine.update('task', { status: 'in_flight' }, { where: { status: { $in: ['pending', 'done'] } }, multi: true } as any),
            ).rejects.toThrow(/illegal status transition \(record b\)/);
            expect(mockDriver.find).toHaveBeenCalledTimes(1);
            const [obj, ast] = vi.mocked(mockDriver.find).mock.calls[0];
            expect(obj).toBe('task');
            expect((ast as any).where).toEqual({ status: { $in: ['pending', 'done'] } });
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
        });

        it('proceeds when every matched row passes the state_machine rule', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'task',
                fields: { status: { type: 'select' } },
                validations: [{ type: 'state_machine', name: 'status_flow', message: 'illegal status transition', field: 'status', transitions: { pending: ['in_flight'], done: ['archived'] } }],
            } as any);
            vi.mocked(mockDriver.find).mockResolvedValue([
                { id: 'a', status: 'pending' },
                { id: 'b', status: 'pending' },
            ] as any);

            await engine.update('task', { status: 'in_flight' }, { where: { status: 'pending' }, multi: true } as any);
            expect((mockDriver as any).updateMany).toHaveBeenCalledTimes(1);
        });

        it('does not fetch rows for a rule-free schema (outbox/settings bulk writes stay zero-cost)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({ name: 'task', fields: {} } as any);

            await engine.update('task', { status: 'done' }, { where: { status: 'pending' }, multi: true } as any);
            expect(mockDriver.find).not.toHaveBeenCalled();
            expect((mockDriver as any).updateMany).toHaveBeenCalledTimes(1);
        });

        it('enforces requiredWhen against each matched row\'s merged record', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'ticket',
                fields: {
                    status: { type: 'select' },
                    resolution: { type: 'text', requiredWhen: "record.status == 'closed'" },
                },
            } as any);
            vi.mocked(mockDriver.find).mockResolvedValue([
                { id: 'a', status: 'open', resolution: 'fixed' }, // merged has a resolution
                { id: 'b', status: 'open', resolution: null },    // merged is missing it
            ] as any);

            await expect(
                engine.update('ticket', { status: 'closed' }, { where: { status: 'open' }, multi: true } as any),
            ).rejects.toThrow(/resolution is required \(record b\)/);
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
        });

        it('enforces per-option visibleWhen against each matched row (cascade gating)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'case',
                fields: {
                    tier: { type: 'select' },
                    priority: {
                        type: 'select',
                        options: [
                            { value: 'urgent', visibleWhen: "record.tier == 'gold'" },
                            { value: 'normal' },
                        ],
                    },
                },
            } as any);
            vi.mocked(mockDriver.find).mockResolvedValue([
                { id: 'a', tier: 'gold' },   // 'urgent' is available here
                { id: 'b', tier: 'silver' }, // hidden option submitted for this row
            ] as any);

            await expect(
                engine.update('case', { priority: 'urgent' }, { where: { status: 'open' }, multi: true } as any),
            ).rejects.toThrow(/option 'urgent' is not available \(record b\)/);
            expect((mockDriver as any).updateMany).not.toHaveBeenCalled();
        });

        it('shares ONE row fetch between the readonlyWhen strip and rule evaluation', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'invoice',
                fields: {
                    amount: { type: 'number', readonlyWhen: 'record.locked == true' },
                },
                validations: [{ type: 'cross_field', name: 'amount_cap', message: 'amount exceeds limit', condition: 'record.amount > record.limit', fields: ['amount'] }],
            } as any);
            vi.mocked(mockDriver.find).mockResolvedValue([
                { id: 'a', locked: false, amount: 10, limit: 100 },
            ] as any);

            await engine.update('invoice', { amount: 50 }, { where: { status: 'draft' }, multi: true } as any);
            expect(mockDriver.find).toHaveBeenCalledTimes(1);
            expect((mockDriver as any).updateMany).toHaveBeenCalledTimes(1);
            // The unlocked conditional field survives the strip.
            const [, , data] = (mockDriver as any).updateMany.mock.calls[0];
            expect(data).toHaveProperty('amount', 50);
        });
    });

    /**
     * #3407 — the readonly/readonlyWhen strips are legal semantics, but they
     * must not be SILENT to the caller: `options.onFieldsDropped` reports each
     * strip pass's dropped keys + reason so callers (flow `update_record`
     * steps) can surface a warning on an otherwise-successful write.
     */
    describe('Dropped-field write observability (#3407)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
            (mockDriver as any).updateMany = vi.fn().mockResolvedValue(1);
        });

        const docSchema = {
            name: 'doc',
            fields: {
                title: { type: 'text' },
                created_by: { type: 'text', readonly: true },
            },
        } as any;

        it('reports caller-supplied static-readonly fields stripped on a single-id update', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(docSchema);
            const events: any[] = [];
            await engine.update('doc', { id: '1', title: 'x', created_by: 'attacker' }, {
                onFieldsDropped: (e: any) => events.push(e),
            } as any);

            expect(events).toEqual([{ object: 'doc', fields: ['created_by'], reason: 'readonly' }]);
            // The strip behavior itself is unchanged: the write proceeded without the field.
            const [, , data] = vi.mocked(mockDriver.update).mock.calls[0];
            expect(data).not.toHaveProperty('created_by');
            expect(data).toHaveProperty('title', 'x');
        });

        it('reports a readonlyWhen-locked field on a single-id update (reason readonly_when)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'invoice',
                fields: { amount: { type: 'number', readonlyWhen: 'record.locked == true' } },
            } as any);
            vi.mocked(mockDriver.findOne).mockResolvedValue({ id: '1', locked: true, amount: 100 } as any);

            const events: any[] = [];
            await engine.update('invoice', { id: '1', amount: 999 }, {
                onFieldsDropped: (e: any) => events.push(e),
            } as any);

            expect(events).toEqual([{ object: 'invoice', fields: ['amount'], reason: 'readonly_when' }]);
            const [, , data] = vi.mocked(mockDriver.update).mock.calls[0];
            expect(data).not.toHaveProperty('amount');
        });

        it('reports bulk-path strips too (multi update — locked in ≥1 matched row)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'invoice',
                fields: { amount: { type: 'number', readonlyWhen: 'record.locked == true' } },
            } as any);
            vi.mocked(mockDriver.find).mockResolvedValue([
                { id: 'a', locked: false, amount: 10 },
                { id: 'b', locked: true, amount: 20 },
            ] as any);

            const events: any[] = [];
            await engine.update('invoice', { amount: 999 }, {
                where: { status: 'draft' }, multi: true,
                onFieldsDropped: (e: any) => events.push(e),
            } as any);

            expect(events).toEqual([{ object: 'invoice', fields: ['amount'], reason: 'readonly_when' }]);
            const [, , data] = (mockDriver as any).updateMany.mock.calls[0];
            expect(data).not.toHaveProperty('amount');
        });

        it('does NOT report for a system-context update (the readonly strip is skipped)', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(docSchema);
            const events: any[] = [];
            await engine.update('doc', { id: '1', created_by: 'importer' }, {
                context: { isSystem: true },
                onFieldsDropped: (e: any) => events.push(e),
            } as any);
            expect(events).toEqual([]);
            // System writes legitimately set read-only columns — kept, not stripped.
            const [, , data] = vi.mocked(mockDriver.update).mock.calls[0];
            expect(data).toHaveProperty('created_by', 'importer');
        });

        it('does NOT report when nothing was stripped', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(docSchema);
            const events: any[] = [];
            await engine.update('doc', { id: '1', title: 'clean' }, {
                onFieldsDropped: (e: any) => events.push(e),
            } as any);
            expect(events).toEqual([]);
        });

        it('a throwing listener never breaks the write', async () => {
            vi.mocked(SchemaRegistry.getObject).mockReturnValue(docSchema);
            await expect(
                engine.update('doc', { id: '1', created_by: 'x' }, {
                    onFieldsDropped: () => { throw new Error('listener bug'); },
                } as any),
            ).resolves.not.toThrow();
            expect(vi.mocked(mockDriver.update)).toHaveBeenCalledTimes(1);
        });
    });

    describe('Resolve File References (ADR-0104 D3)', () => {
        beforeEach(async () => {
            engine.registerDriver(mockDriver, true);
            await engine.init();
        });

        const withSchema = () => {
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'doc') return {
                    name: 'doc',
                    fields: {
                        title: { type: 'text' },
                        cover: { type: 'image' },
                        attachments: { type: 'file', multiple: true },
                    },
                } as any;
                if (name === 'sys_file') return {
                    name: 'sys_file',
                    fields: {
                        name: { type: 'text' }, size: { type: 'number' },
                        mime_type: { type: 'text' }, status: { type: 'text' },
                    },
                } as any;
                return undefined;
            });
        };

        it('resolves a stored fileId to the expanded FileValueSchema (url derived), in ONE batched query', async () => {
            withSchema();
            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 'd1', title: 'Doc 1', cover: 'file_a' },
                    { id: 'd2', title: 'Doc 2', cover: 'file_b' },
                ])
                .mockResolvedValueOnce([
                    { id: 'file_a', name: 'a.png', size: 10, mime_type: 'image/png', status: 'committed' },
                    { id: 'file_b', name: 'b.png', size: 20, mime_type: 'image/png', status: 'committed' },
                ]);

            const result = await engine.find('doc', {});

            expect(result[0].cover).toEqual({ id: 'file_a', name: 'a.png', size: 10, mimeType: 'image/png', url: '/api/v1/storage/files/file_a' });
            expect(result[1].cover).toEqual({ id: 'file_b', name: 'b.png', size: 20, mimeType: 'image/png', url: '/api/v1/storage/files/file_b' });

            // No N+1: exactly one sys_file read, batched via id $in over both ids.
            expect(mockDriver.find).toHaveBeenCalledTimes(2);
            expect(mockDriver.find).toHaveBeenLastCalledWith(
                'sys_file',
                expect.objectContaining({ where: { id: { $in: ['file_a', 'file_b'] } } }),
                expect.objectContaining({ context: { __expandRead: true } }),
            );
        });

        it('leaves inline-blob values and non-matching strings untouched (dual-mode)', async () => {
            withSchema();
            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 'd1', cover: { url: 'https://cdn/x.png', alt: 'x' }, attachments: ['file_a', 'https://cdn/ext.pdf'] },
                ])
                .mockResolvedValueOnce([
                    { id: 'file_a', name: 'a.pdf', status: 'committed' },
                ]);

            const result = await engine.find('doc', {});

            expect(result[0].cover).toEqual({ url: 'https://cdn/x.png', alt: 'x' }); // inline blob → untouched
            expect(result[0].attachments[0]).toEqual({ id: 'file_a', name: 'a.pdf', url: '/api/v1/storage/files/file_a' });
            expect(result[0].attachments[1]).toBe('https://cdn/ext.pdf'); // external url → passthrough
        });

        it('does NOT query sys_file when no file field holds a string (blob-only → zero cost)', async () => {
            withSchema();
            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 'd1', cover: { url: 'https://cdn/x.png' } },
            ]);
            await engine.find('doc', {});
            expect(mockDriver.find).toHaveBeenCalledTimes(1); // primary read only
        });

        it('does NOT fire a sys_file query for url-shaped values (external url, /api path, data: URI)', async () => {
            // Regression: a file field legitimately holds a URL string in the
            // legacy/dual-mode world; only an opaque id token is a reference.
            withSchema();
            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 'd1', cover: 'https://cdn/a.png', attachments: ['/api/v1/storage/files/x', 'data:image/svg+xml,%3Csvg%3E'] },
            ]);
            const result = await engine.find('doc', {});
            // Primary read only — no sys_file lookup for url-shaped strings.
            expect(mockDriver.find).toHaveBeenCalledTimes(1);
            expect(result[0].cover).toBe('https://cdn/a.png');
            expect(result[0].attachments).toEqual(['/api/v1/storage/files/x', 'data:image/svg+xml,%3Csvg%3E']);
        });

        it('does not resolve a non-committed (pending/deleted) sys_file row', async () => {
            withSchema();
            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([{ id: 'd1', cover: 'file_p' }])
                .mockResolvedValueOnce([{ id: 'file_p', name: 'p.png', status: 'pending' }]);
            const result = await engine.find('doc', {});
            expect(result[0].cover).toBe('file_p'); // left as an opaque id
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

            // Verify the expand query used $in. The expand sub-read now routes
            // through the secured `find` path ([#2850]), so the referenced
            // read carries the `__expandRead` marker in its context.
            expect(mockDriver.find).toHaveBeenCalledTimes(2);
            expect(mockDriver.find).toHaveBeenLastCalledWith(
                'user',
                expect.objectContaining({
                    object: 'user',
                    where: { id: { $in: ['u1', 'u2'] } },
                }),
                expect.objectContaining({ context: { __expandRead: true } }),
            );
        });

        it('should expand a `user` field (lookup specialized to sys_user) through the same path', async () => {
            // Regression: $expand was gated on type lookup/master_detail only; the
            // `user` type carries the same `reference` + id storage and must resolve.
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'ticket') return {
                    name: 'ticket',
                    fields: {
                        owner: { type: 'user', reference: 'sys_user' },
                        title: { type: 'text' },
                    },
                } as any;
                if (name === 'sys_user') return {
                    name: 'sys_user',
                    fields: { name: { type: 'text' } },
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 'k1', title: 'Ticket 1', owner: 'u1' },
                ])
                .mockResolvedValueOnce([
                    { id: 'u1', name: 'Alice' },
                ]);

            const result = await engine.find('ticket', { expand: { owner: { object: 'owner' } } });

            expect(result[0].owner).toEqual({ id: 'u1', name: 'Alice' });
            expect(mockDriver.find).toHaveBeenLastCalledWith(
                'sys_user',
                expect.objectContaining({ where: { id: { $in: ['u1'] } } }),
                expect.objectContaining({ context: { __expandRead: true } }),
            );
        });

        it('should apply a nested expand where-filter to the related $in query', async () => {
            // Regression: query-syntax.mdx documents `expand: { rel: { where: {...} } }`
            // and the QueryAST schema accepts it, but the engine used to drop
            // nestedAST.where — silently returning *all* related records.
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
                    fields: { name: { type: 'text' }, active: { type: 'boolean' } },
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', title: 'Task 1', assignee: 'u1' },
                    { id: 't2', title: 'Task 2', assignee: 'u2' },
                ])
                // Driver does the filtering; only the active user comes back.
                .mockResolvedValueOnce([{ id: 'u1', name: 'Alice', active: true }]);

            const result = await engine.find('task', {
                expand: {
                    assignee: { object: 'user', where: { active: { $eq: true } } },
                },
            });

            // The nested filter is AND-merged with the batch $in (not clobbered).
            expect(mockDriver.find).toHaveBeenCalledTimes(2);
            const expandCall = vi.mocked(mockDriver.find).mock.calls[1];
            expect(expandCall[1]).toEqual(
                expect.objectContaining({
                    object: 'user',
                    where: {
                        $and: [
                            { id: { $in: ['u1', 'u2'] } },
                            { active: { $eq: true } },
                        ],
                    },
                }),
            );

            // Records the driver filtered out keep their raw FK id (unresolved).
            expect(result[0].assignee).toEqual({ id: 'u1', name: 'Alice', active: true });
            expect(result[1].assignee).toBe('u2');
        });

        it('should preserve $or logical groups in a nested expand where (no shallow clobber)', async () => {
            // A shallow `{ ...nestedAST.where }` spread would be unsafe if the
            // nested filter itself keyed `id` or used a top-level logical group.
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: { assignee: { type: 'lookup', reference: 'user' } },
                } as any;
                if (name === 'user') return {
                    name: 'user',
                    fields: { role: { type: 'text' }, active: { type: 'boolean' } },
                } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([{ id: 't1', assignee: 'u1' }])
                .mockResolvedValueOnce([{ id: 'u1', role: 'admin' }]);

            const nestedWhere = {
                $or: [{ role: { $eq: 'admin' } }, { active: { $eq: true } }],
            };
            await engine.find('task', {
                expand: { assignee: { object: 'user', where: nestedWhere } },
            });

            const expandCall = vi.mocked(mockDriver.find).mock.calls[1];
            expect(expandCall[1]).toEqual(
                expect.objectContaining({
                    where: { $and: [{ id: { $in: ['u1'] } }, nestedWhere] },
                }),
            );
        });

        it('should not push nested expand limit/offset into the batched $in query', async () => {
            // The expand path batch-loads every parent's related records in one
            // $in query, so a *per-parent* limit/offset can't be expressed here.
            // Propagating them would globally cap the batch and silently drop
            // records some parents need — so they are intentionally not forwarded.
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: { assignee: { type: 'lookup', reference: 'user' } },
                } as any;
                if (name === 'user') return { name: 'user', fields: { name: { type: 'text' } } } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([
                    { id: 't1', assignee: 'u1' },
                    { id: 't2', assignee: 'u2' },
                ])
                .mockResolvedValueOnce([
                    { id: 'u1', name: 'Alice' },
                    { id: 'u2', name: 'Bob' },
                ]);

            await engine.find('task', {
                expand: { assignee: { object: 'user', limit: 1, offset: 2 } },
            });

            const expandCall = vi.mocked(mockDriver.find).mock.calls[1];
            expect(expandCall[1]).not.toHaveProperty('limit');
            expect(expandCall[1]).not.toHaveProperty('offset');
            expect(expandCall[1]).not.toHaveProperty('top');
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

        it('[#2850] routes the expand sub-read through the middleware for the referenced object (RLS/FLS can apply), tagged __expandRead', async () => {
            // Regression: expand used to call the driver directly for the
            // referenced object, so the REFERENCED object's security middleware
            // (RLS/FLS/CRUD) never ran — a caller could read masked/owner-hidden
            // related records via `?expand=`. The sub-read now re-enters
            // `this.find`, so any registered middleware sees it.
            vi.mocked(SchemaRegistry.getObject).mockImplementation((name) => {
                if (name === 'task') return {
                    name: 'task',
                    fields: { assignee: { type: 'lookup', reference: 'user' }, title: { type: 'text' } },
                } as any;
                if (name === 'user') return { name: 'user', fields: { name: { type: 'text' } } } as any;
                return undefined;
            });

            vi.mocked(mockDriver.find)
                .mockResolvedValueOnce([{ id: 't1', title: 'Task 1', assignee: 'u1' }])
                .mockResolvedValueOnce([{ id: 'u1', name: 'Alice' }]);

            const seen: Array<{ object: string; operation: string; expandRead: boolean }> = [];
            engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
                seen.push({
                    object: opCtx.object,
                    operation: opCtx.operation,
                    expandRead: opCtx.context?.__expandRead === true,
                });
                await next();
            });

            await engine.find('task', { expand: { assignee: { object: 'user' } } });

            // The base read runs through the middleware WITHOUT the marker…
            expect(seen).toContainEqual({ object: 'task', operation: 'find', expandRead: false });
            // …and the referenced object's expand sub-read runs through it WITH
            // the __expandRead marker set — this is the hook the security plugin
            // uses to apply the referenced object's RLS + FLS.
            expect(seen).toContainEqual({ object: 'user', operation: 'find', expandRead: true });
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

        it('a read-time date formula `record.d == today()` matches a YYYY-MM-DD string field (#3183)', async () => {
            // The driver returns a `Field.date` as a "YYYY-MM-DD" string (ADR-0053
            // Phase 1). cel-js equality never matches a string against the Timestamp
            // from today(), so this silently returned false until the engine's AST
            // temporal-comparison rewrite (#3183). End-to-end proof through find().
            vi.mocked(SchemaRegistry.getObject).mockReturnValue({
                name: 'todo',
                fields: {
                    id: { type: 'text' },
                    due_date: { type: 'date' },
                    is_due_today: {
                        type: 'formula',
                        expression: { dialect: 'cel', source: 'record.due_date == today()' },
                    },
                },
            } as any);

            // UTC calendar day — matches today()'s default (UTC) resolution.
            const todayStr = new Date().toISOString().slice(0, 10);
            vi.mocked(mockDriver.find).mockResolvedValueOnce([
                { id: 't1', due_date: todayStr },      // due today  → true
                { id: 't2', due_date: '2020-01-01' },  // long past  → false
            ]);

            const result = await engine.find('todo', { fields: ['id', 'due_date', 'is_due_today'] } as any);

            expect(result.map((r: any) => r.is_due_today)).toEqual([true, false]);
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
                expect.objectContaining({ context: { __expandRead: true } }),
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
