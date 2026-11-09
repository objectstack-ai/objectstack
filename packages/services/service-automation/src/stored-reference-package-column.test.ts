// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R8, R9, R10, R11; epic #31527 child S3] The automation
 * service's stored references gain the package that holds the item they name,
 * measured on a REAL `ObjectQL` engine over a real SQL driver (better-sqlite3
 * `:memory:`) — the null filter, the keyset walk, the single-column write and
 * the copy under the scoped key are the driver's own answers — and a REAL
 * `SchemaRegistry` asked through the resolver the plugin attaches
 * (`flowNameResolver`, `connectorNameResolver`): packages installed through
 * `installPackage`, their items in each package's composite slot, an
 * environment item in the package-less bare slot.
 *
 * The holder is D8's: the item's ONE holder in this environment (the D3 rule
 * asked with no caller, `AutomationEngine.flowHolder`). An environment
 * override of P's flow is P's item overlaid, never a second item, so a paused
 * run of it — and its dispatch key — binds to P (seat ruling Q3).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL, SchemaRegistry } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { flowNameResolver } from './plugin.js';
import { connectorNameResolver } from './connector-package-scope.js';
import { SysAutomationRun } from './sys-automation-run.object.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';
import { SysConnectorConnection } from './sys-connector-connection.object.js';
import { SysFlowDispatch } from './sys-flow-dispatch.object.js';
import {
    STORED_AUTOMATION_REFERENCES,
    backfillStoredReferencePackages,
    backfillStoredReferencePackagesAtBoot,
    storedReferenceHolderOf,
    type StoredReferenceType,
} from './stored-reference-package-backfill.js';
import {
    FLOW_DISPATCH_RETENTION_MS,
    bareDispatchKeyFlow,
    rekeyFlowDispatchesByPackage,
    scopedDispatchKey,
} from './flow-dispatch-key-package-backfill.js';
import { InMemoryFlowDispatchStore, ObjectStoreFlowDispatchStore } from './flow-dispatch-store.js';

const ORG = 'org_a';
const SYS_ORG = { isSystem: true, tenantId: ORG } as const;
const SYSTEM_CTX = { isSystem: true } as const;

const [RUNS, CREDENTIALS, CONNECTIONS] = STORED_AUTOMATION_REFERENCES;

/** Packages. */
const P = 'com.acme.p';
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

/** Flow names. */
const ONE_HOLDER = 'invoice_reminder'; // shipped by A alone
const OVERRIDDEN = 'nightly_digest'; // shipped by P, overridden by the environment
const TWO_HOLDERS = 'shared_sync'; // shipped by A and by B (a pre-phase-1 clash)
const ENV_FLOW = 'my_flow'; // authored in the environment
const NOBODY = 'retired_flow'; // nothing declares it any more

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! }) as never;

function silentLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

let registry: SchemaRegistry;
let automation: AutomationEngine;
let holderOf: (type: StoredReferenceType, name: string) => ReturnType<typeof storedReferenceHolderOf>;

beforeEach(() => {
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    for (const id of [P, A, B]) registry.installPackage(manifest(id), 'code');
    const flow = (name: string) => ({ name, label: name, type: 'autolaunched', nodes: [], edges: [] });
    const ship = (packageId: string, name: string) =>
        registry.registerItem('flow', { ...flow(name), _packageId: packageId }, 'name' as never, packageId);
    ship(A, ONE_HOLDER);
    ship(P, OVERRIDDEN);
    // The environment's override of P's flow: a package-less row in the bare slot.
    registry.registerItem('flow', { ...flow(OVERRIDDEN), _provenance: 'org' }, 'name' as never);
    ship(A, TWO_HOLDERS);
    ship(B, TWO_HOLDERS);
    registry.registerItem('flow', { ...flow(ENV_FLOW), _provenance: 'org' }, 'name' as never);

    const connector = (name: string) => ({ name, label: name, type: 'api', authentication: { type: 'none' }, actions: [] });
    registry.registerItem('connector', { ...connector('billing'), _packageId: A }, 'name' as never, A);
    registry.registerItem('connector', { ...connector('mailer'), _packageId: A }, 'name' as never, A);
    registry.registerItem('connector', { ...connector('mailer'), _packageId: B }, 'name' as never, B);
    registry.registerItem('connector', { ...connector('my_api'), _provenance: 'org' }, 'name' as never);

    const ctx = { getService(name: string) { if (name === 'objectql') return { registry }; throw new Error(`no ${name}`); } } as any;
    automation = new AutomationEngine(silentLogger());
    automation.setFlowNameResolver(flowNameResolver(ctx));
    const connectorHolder = connectorNameResolver(ctx);
    // The plugin's holderOf, verbatim (`registerStoredReferenceBackfill`).
    holderOf = (type, name) =>
        storedReferenceHolderOf(type === 'flow' ? automation.flowHolder(name) : connectorHolder(name, null));
});

const engines: ObjectQL[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (engines.length) {
        try { await engines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** A reversible stand-in KMS: `sys_flow_credential.value` is a secret, and the engine refuses cleartext. */
function fakeCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string): Promise<CryptoHandle> {
            n += 1;
            return { id: `sec_${n}`, kmsKeyId: 'test', alg: 'test-rev', version: 1, ciphertext: [...plain].reverse().join('') };
        },
        async decrypt(handle: CryptoHandle): Promise<string> {
            return [...handle.ciphertext].reverse().join('');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
            return { ...handle, version: handle.version + 1 };
        },
        digest: (plain: string) => `d:${plain.length}`,
        keyedDigest: async (plain: string) => `k:${plain.length}`,
    } as ICryptoProvider;
}

async function boot(): Promise<ObjectQL> {
    const engine = new ObjectQL();
    engine.registerDriver(
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
        true,
    );
    await engine.init();
    engine.registerApp({
        id: 'com.objectstack.qa.automation-stored-reference-package',
        name: 'Automation stored-reference package column',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysSecret, SysAutomationRun, SysFlowCredential, SysConnectorConnection, SysFlowDispatch],
    } as any);
    await engine.syncSchemas();
    engine.setCryptoProvider(fakeCrypto());
    engines.push(engine);
    return engine;
}

async function column(engine: ObjectQL, object: string, packageColumn: string): Promise<Record<string, unknown>> {
    const rows = (await engine.find(object, { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    return Object.fromEntries(rows.map((r) => [String(r.id), r[packageColumn] ?? null]));
}

const NOW = '2026-11-09T00:00:00.000Z';
const run = (id: string, flowName: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, flow_name: flowName, status, started_at: NOW, created_at: NOW, ...extra,
});

describe('the holder is the item\'s one holder in this environment (D8, seat ruling Q3)', () => {
    it('reads each flow shape as D3 answers a caller with no package', () => {
        expect(holderOf('flow', ONE_HOLDER)).toEqual({ kind: 'package', packageId: A });
        expect(holderOf('flow', OVERRIDDEN)).toEqual({ kind: 'package', packageId: P });
        expect(holderOf('flow', TWO_HOLDERS)).toEqual({
            kind: 'ambiguous', candidates: [`package "${A}"`, `package "${B}"`],
        });
        expect(holderOf('flow', ENV_FLOW)).toEqual({ kind: 'environment' });
        expect(holderOf('flow', NOBODY)).toEqual({ kind: 'unheld' });
        // ⛔ Not the caller's answer: nothing is armed here, so armedFlowPackage knows nothing.
        expect(automation.armedFlowPackage(OVERRIDDEN)).toBeUndefined();
    });
});

describe('R8 — a paused run gains the package that holds its flow', () => {
    async function seed(engine: ObjectQL): Promise<void> {
        for (const row of [
            run('r1', ONE_HOLDER, 'paused'),
            run('r2', ONE_HOLDER, 'paused'),
            run('r3', OVERRIDDEN, 'paused'),
            run('r4', TWO_HOLDERS, 'paused'),
            run('r5', ENV_FLOW, 'paused'),
            run('r6', NOBODY, 'paused'),
            // Terminal and running rows are not asked (seat ruling Q4).
            run('r7', ONE_HOLDER, 'completed'),
            run('r8', ONE_HOLDER, 'failed'),
            run('r9', ONE_HOLDER, 'running'),
            // Already names a package: never a candidate, never moved.
            run('r10', ONE_HOLDER, 'paused', { flow_package: 'com.acme.elsewhere' }),
        ]) {
            await engine.insert(RUNS.object, row, { context: SYS_ORG });
        }
    }

    it('binds a paused run of a flow one package holds; leaves every other row naming no package', async () => {
        const engine = await boot();
        await seed(engine);

        const report = await backfillStoredReferencePackages(engine, RUNS, holderOf);

        expect(await column(engine, RUNS.object, 'flow_package')).toEqual({
            r1: A, r2: A,
            r3: P,
            r4: null, r5: null, r6: null,
            r7: null, r8: null, r9: null,
            r10: 'com.acme.elsewhere',
        });
        expect(report.bound).toEqual([
            { name: ONE_HOLDER, rows: 2, packageId: A },
            { name: OVERRIDDEN, rows: 1, packageId: P },
        ]);
        expect(report.ambiguous).toEqual([
            { name: TWO_HOLDERS, rows: 1, candidates: [`package "${A}"`, `package "${B}"`] },
        ]);
        expect(report.unpackaged).toEqual([{ name: ENV_FLOW, rows: 1, holder: 'environment' }]);
        expect(report.unheld).toEqual([{ name: NOBODY, rows: 1 }]);
    });

    it('a paused run of an overridden P flow is bound to P (seat ruling Q3)', async () => {
        const engine = await boot();
        await engine.insert(RUNS.object, run('ov', OVERRIDDEN, 'paused'), { context: SYS_ORG });
        await backfillStoredReferencePackages(engine, RUNS, holderOf);
        expect(await column(engine, RUNS.object, 'flow_package')).toEqual({ ov: P });
    });

    it('a second run writes 0 rows and reports the same refusals', async () => {
        const engine = await boot();
        await seed(engine);
        await backfillStoredReferencePackages(engine, RUNS, holderOf);
        const update = vi.spyOn(engine, 'update');

        const again = await backfillStoredReferencePackages(engine, RUNS, holderOf);

        expect(update).not.toHaveBeenCalled();
        expect(again.bound).toEqual([]);
        expect(again.ambiguous.map((a) => a.name)).toEqual([TWO_HOLDERS]);
        expect(again.unheld.map((u) => u.name)).toEqual([NOBODY]);
    });

    it('a dry run reports what it would bind and writes nothing', async () => {
        const engine = await boot();
        await seed(engine);
        const report = await backfillStoredReferencePackages(engine, RUNS, holderOf, { dryRun: true });
        expect(report.bound.map((b) => b.name)).toEqual([ONE_HOLDER, OVERRIDDEN]);
        expect(Object.values(await column(engine, RUNS.object, 'flow_package')).filter(Boolean)).toEqual(['com.acme.elsewhere']);
    });
});

describe('R9 — a flow credential gains the package that holds its flow', () => {
    it('binds by the flow\'s one holder; ambiguity and no holder stay null, every candidate named', async () => {
        const engine = await boot();
        const credential = (id: string, flowName: string) => ({
            id, flow_name: flowName, state: 'active', node_id: 'n1', credential_key: 'token', position: 'pos_a',
            value: 'secret-value', created_at: NOW,
        });
        for (const row of [
            credential('c1', ONE_HOLDER), credential('c2', OVERRIDDEN), credential('c3', TWO_HOLDERS),
            credential('c4', ENV_FLOW), credential('c5', NOBODY),
        ]) {
            await engine.insert(CREDENTIALS.object, row, { context: SYS_ORG });
        }

        const report = await backfillStoredReferencePackages(engine, CREDENTIALS, holderOf);

        expect(await column(engine, CREDENTIALS.object, 'flow_package')).toEqual({ c1: A, c2: P, c3: null, c4: null, c5: null });
        expect(report.ambiguous).toEqual([{ name: TWO_HOLDERS, rows: 1, candidates: [`package "${A}"`, `package "${B}"`] }]);
        expect((await backfillStoredReferencePackages(engine, CREDENTIALS, holderOf)).bound).toEqual([]);
    });
});

describe('R11 — a connector connection gains the package that holds its connector instance', () => {
    it('binds by the instance\'s one holder; ambiguity and the environment\'s own instance stay null', async () => {
        const engine = await boot();
        const connection = (id: string, name: string) => ({
            id, organization_id: ORG, connector_name: name, grant: 'authorization_code', status: 'connected', revision: 1,
        });
        for (const row of [connection('k1', 'billing'), connection('k2', 'mailer'), connection('k3', 'my_api'), connection('k4', 'gone')]) {
            await engine.insert(CONNECTIONS.object, row, { context: SYS_ORG });
        }

        const report = await backfillStoredReferencePackages(engine, CONNECTIONS, holderOf);

        expect(await column(engine, CONNECTIONS.object, 'connector_package')).toEqual({ k1: A, k2: null, k3: null, k4: null });
        expect(report.ambiguous).toEqual([{ name: 'mailer', rows: 1, candidates: [`package "${A}"`, `package "${B}"`] }]);
        expect(report.unpackaged).toEqual([{ name: 'my_api', rows: 1, holder: 'environment' }]);
        expect(report.unheld).toEqual([{ name: 'gone', rows: 1 }]);
    });
});

describe('the boot pass', () => {
    it('runs only the references whose table the composition carries, and a failing table is never fatal', async () => {
        const engine = await boot();
        await engine.insert(RUNS.object, run('r1', ONE_HOLDER, 'paused'), { context: SYS_ORG });
        const logger = silentLogger();
        const reports = await backfillStoredReferencePackagesAtBoot(
            engine, (object) => object !== CONNECTIONS.object, holderOf, logger,
        );
        expect(reports.map((r) => r.row)).toEqual(['R8', 'R9']);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`'${ONE_HOLDER}' → ${A} (1 row)`));

        vi.spyOn(engine, 'find').mockRejectedValueOnce(new Error('table gone'));
        const after = await backfillStoredReferencePackagesAtBoot(engine, () => true, holderOf, logger);
        expect(after.map((r) => r.row)).toEqual(['R9', 'R11']);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sys_automation_run.flow_package backfill did not finish'), { error: 'table gone' });
    });
});

// ── R10: the dispatch key gains the flow's package ──────────────────────────

describe('R10 — the bare and scoped key shapes', () => {
    it('tells a bare key from a scoped one, for both prefixes', () => {
        expect(bareDispatchKeyFlow(`schedule:${ONE_HOLDER}:2026-11-09T00:00:00.000Z`)).toEqual({
            prefix: 'schedule:', flow: ONE_HOLDER, rest: '2026-11-09T00:00:00.000Z',
        });
        expect(bareDispatchKeyFlow(`time-relative:${ONE_HOLDER}:2026-11-09T00:00:00.000Z|P1D:rec_1`)).toEqual({
            prefix: 'time-relative:', flow: ONE_HOLDER, rest: '2026-11-09T00:00:00.000Z|P1D:rec_1',
        });
        // A scoped key is not bare: a package id is dotted, so it is never read as a flow name.
        expect(bareDispatchKeyFlow(`schedule:${A}:${ONE_HOLDER}:2026-11-09T00:00:00.000Z`)).toBeUndefined();
        expect(bareDispatchKeyFlow('connector:x:y')).toBeUndefined();
        const bare = bareDispatchKeyFlow(`schedule:${ONE_HOLDER}:2026-11-09T00:00:00.000Z`)!;
        expect(scopedDispatchKey(bare, A)).toBe(`schedule:${A}:${ONE_HOLDER}:2026-11-09T00:00:00.000Z`);
    });
});

describe('R10 — the boot re-key copies in-retention bare keys to the scoped key', () => {
    const at = new Date('2026-11-09T12:00:00.000Z');
    const inside = new Date(at.getTime() - 24 * 3600_000).toISOString();
    const outside = new Date(at.getTime() - FLOW_DISPATCH_RETENTION_MS - 3600_000).toISOString();
    const W = '2026-11-08T12:00:00.000Z';
    const key = (flow: string, window = W) => `schedule:${flow}:${window}`;

    async function seed(engine: ObjectQL): Promise<void> {
        const row = (id: string, created: string, extra: Record<string, unknown> = {}) => ({ id, dispatched_at: created, created_at: created, ...extra });
        for (const r of [
            row(key(ONE_HOLDER), inside, { outcome: 'succeeded', settled_at: inside }),
            row(key(OVERRIDDEN), inside),
            row(`time-relative:${ONE_HOLDER}:${W}|P1D:rec_1`, inside, { outcome: 'failed', settled_at: inside }),
            row(key(TWO_HOLDERS), inside),
            row(key(ENV_FLOW), inside),
            row(key(NOBODY), inside),
            // Outside retention: the Reaper's, never copied.
            row(key(ONE_HOLDER, '2026-10-01T00:00:00.000Z'), outside),
        ]) {
            await engine.insert('sys_flow_dispatch', r, { context: SYSTEM_CTX });
        }
    }

    const flowHolder = (flow: string) => holderOf('flow', flow);

    it('copies each in-retention bare key whose flow one package holds; leaves every bare row where it was', async () => {
        const engine = await boot();
        await seed(engine);

        const report = await rekeyFlowDispatchesByPackage(engine, flowHolder, at);

        const rows = (await engine.find('sys_flow_dispatch', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
        const byId = Object.fromEntries(rows.map((r) => [String(r.id), r]));
        // The scoped copies, with the claim's own dispatched_at, outcome and settled_at.
        expect(byId[`schedule:${A}:${ONE_HOLDER}:${W}`]).toMatchObject({ outcome: 'succeeded' });
        expect(byId[`schedule:${A}:${ONE_HOLDER}:${W}`].dispatched_at).toEqual(byId[key(ONE_HOLDER)].dispatched_at);
        expect(byId[`time-relative:${A}:${ONE_HOLDER}:${W}|P1D:rec_1`]).toMatchObject({ outcome: 'failed' });
        // An overridden P flow's key is P's (seat ruling Q3).
        expect(byId[`schedule:${P}:${OVERRIDDEN}:${W}`]).toBeDefined();
        // Nothing else was written: 7 seeded + 3 copies, and every bare row is still there.
        expect(rows).toHaveLength(10);
        for (const flow of [ONE_HOLDER, OVERRIDDEN, TWO_HOLDERS, ENV_FLOW, NOBODY]) expect(byId[key(flow)]).toBeDefined();
        expect(Object.keys(byId).some((id) => id.includes(':2026-10-01T') && id.includes(A))).toBe(false);

        expect(report.rekeyed).toEqual([
            { flow: ONE_HOLDER, rows: 2, packageId: A },
            { flow: OVERRIDDEN, rows: 1, packageId: P },
        ]);
        expect(report.ambiguous).toEqual([{ flow: TWO_HOLDERS, rows: 1, candidates: [`package "${A}"`, `package "${B}"`] }]);
        expect(report.unpackaged).toEqual([{ flow: ENV_FLOW, rows: 1 }, { flow: NOBODY, rows: 1 }]);
    });

    it('a second run writes 0 rows', async () => {
        const engine = await boot();
        await seed(engine);
        await rekeyFlowDispatchesByPackage(engine, flowHolder, at);
        const insert = vi.spyOn(engine, 'insert');

        const again = await rekeyFlowDispatchesByPackage(engine, flowHolder, at);

        expect(insert).not.toHaveBeenCalled();
        expect(again.rekeyed).toEqual([]);
        expect(again.present).toEqual([
            { flow: ONE_HOLDER, rows: 2, packageId: A },
            { flow: OVERRIDDEN, rows: 1, packageId: P },
        ]);
    });

    it('a scoped key a claim took first is the copy: reported present, never overwritten', async () => {
        const engine = await boot();
        await seed(engine);
        await engine.insert('sys_flow_dispatch', { id: `schedule:${A}:${ONE_HOLDER}:${W}`, dispatched_at: at.toISOString(), created_at: at.toISOString() }, { context: SYSTEM_CTX });

        const report = await rekeyFlowDispatchesByPackage(engine, flowHolder, at);

        expect(report.present).toEqual([{ flow: ONE_HOLDER, rows: 1, packageId: A }]);
        const [row] = (await engine.find('sys_flow_dispatch', { where: { id: `schedule:${A}:${ONE_HOLDER}:${W}` }, context: SYSTEM_CTX })) as any[];
        expect(row.outcome ?? null).toBeNull();
    });
});

describe('R10 — the ledger is held until the boot re-key has finished (seat condition 1)', () => {
    it('a claim, a settle and a read made while held answer only once the re-key settles, and see its rows', async () => {
        const engine = await boot();
        const W = '2026-11-08T12:00:00.000Z';
        const now = new Date();
        await engine.insert('sys_flow_dispatch', { id: `schedule:${ONE_HOLDER}:${W}`, dispatched_at: now.toISOString(), created_at: now.toISOString() }, { context: SYSTEM_CTX });
        const store = new ObjectStoreFlowDispatchStore(engine as never);
        let release!: () => void;
        const rekey = new Promise<void>((resolve) => { release = resolve; });
        store.holdUntil(rekey, 60_000);

        const order: string[] = [];
        const claim = store.claim(`schedule:${A}:${ONE_HOLDER}:${W}`).then((v) => { order.push('claim'); return v; });
        const read = store.read(`schedule:${A}:${ONE_HOLDER}:${W}`).then((v) => { order.push('read'); return v; });
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual([]);

        await rekeyFlowDispatchesByPackage(engine, (flow) => holderOf('flow', flow), now);
        order.push('rekey');
        release();

        // The claim reads the re-keyed copy: the window is already claimed, never fired twice.
        expect(await claim).toBe(false);
        expect(await read).not.toBeNull();
        expect(order[0]).toBe('rekey');
    });

    it('a re-key that never finishes releases the ledger at the bound, and says so', async () => {
        vi.useFakeTimers();
        try {
            const calls: string[] = [];
            const fake = {
                find: async () => { calls.push('find'); return []; },
                insert: async () => undefined,
            };
            const store = new ObjectStoreFlowDispatchStore(fake as never);
            const onTimeout = vi.fn();
            store.holdUntil(new Promise(() => {}), 120_000, onTimeout);
            const read = store.read('schedule:x:2026');
            await vi.advanceTimersByTimeAsync(119_999);
            expect(calls).toEqual([]);
            await vi.advanceTimersByTimeAsync(1);
            expect(await read).toBeNull();
            expect(onTimeout).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('CONTROL: a store nothing holds answers at once', async () => {
        const engine = await boot();
        const store = new ObjectStoreFlowDispatchStore(engine as never);
        expect(await store.claim(`schedule:${A}:${ONE_HOLDER}:2026-11-08T12:00:00.000Z`)).toBe(true);
    });
});

describe('R10 — the missed-run check reads the window\'s bare key too (the transition read)', () => {
    it('a window claimed under its bare key by a node of the previous release is dispatched, not missed', async () => {
        const store = new InMemoryFlowDispatchStore();
        automation.setFlowDispatchStore(store);
        const W = '2026-11-08T12:00:00.000Z';
        await store.claim(`schedule:${ONE_HOLDER}:${W}`);
        const missed = {
            flowName: ONE_HOLDER, dueAt: W, detectedAt: '2026-11-08T13:00:00.000Z',
            dispatchKey: `schedule:${A}:${ONE_HOLDER}:${W}`, legacyDispatchKey: `schedule:${ONE_HOLDER}:${W}`,
        };
        await expect(automation.recordMissedRun(missed)).resolves.toBe('dispatched');
        // CONTROL: the scoped key alone reads the window as missed.
        await expect(automation.recordMissedRun({ ...missed, legacyDispatchKey: undefined })).resolves.toBe('recorded');
    });
});

// ── Keys that do not move: byte-identical pins (seat rulings Q2, R14) ────────

describe('no key moves: each table keeps its indexes byte for byte (ADR-0150 D8, seat ruling Q2)', () => {
    it('sys_automation_run', () => {
        expect(JSON.stringify(SysAutomationRun.indexes)).toBe(JSON.stringify([
            { fields: ['flow_name', 'status'], unique: false },
            { fields: ['status', 'updated_at'], unique: false },
            { fields: ['flow_name', 'started_at'], unique: false },
            { fields: ['status', 'created_at'], unique: false },
            { fields: ['correlation'], unique: false },
            { fields: ['trigger_object', 'trigger_record_id'], unique: false },
        ]));
    });

    it('sys_flow_credential (R9: the channel\'s upsert key stays (flow_name, state, position))', () => {
        expect(JSON.stringify(SysFlowCredential.indexes)).toBe(JSON.stringify([
            { fields: ['flow_name', 'state', 'position'], unique: 'global' },
        ]));
    });

    it('sys_connector_connection (R11: one connection per instance name in an organization)', () => {
        expect(JSON.stringify(SysConnectorConnection.indexes)).toBe(JSON.stringify([
            { fields: ['connector_name'], unique: 'organization' },
        ]));
    });

    it('sys_flow_dispatch (R10: the key is the primary id; no new index)', () => {
        expect(JSON.stringify(SysFlowDispatch.indexes)).toBe(JSON.stringify([{ fields: ['created_at'], unique: false }]));
    });

    it('the new columns are nullable and read-only', () => {
        for (const [object, field] of [
            [SysAutomationRun, 'flow_package'],
            [SysFlowCredential, 'flow_package'],
            [SysConnectorConnection, 'connector_package'],
        ] as const) {
            const def = (object.fields as Record<string, any>)[field];
            expect(def, `${object.name}.${field}`).toMatchObject({ type: 'text', required: false, readonly: true });
        }
    });
});
