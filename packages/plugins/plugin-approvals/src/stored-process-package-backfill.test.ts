// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R7; epic #31527 child S3] An open approval request gains
 * the package that holds its flow, measured on a REAL `ObjectQL` engine over a
 * real SQL driver (better-sqlite3 `:memory:`) and a REAL `SchemaRegistry`,
 * asked through the automation engine's `durableFlowHolder` (the one D3 rule,
 * asked with no caller over every holder, #32183) — the reader the plugin
 * hands the backfill.
 *
 * Only open requests are asked: `pending` and `returned` (seat ruling Q5). An
 * environment override of P's flow is P's item overlaid, so its open request
 * binds to P (seat ruling Q3).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL, SchemaRegistry, resolvePackageScopedName } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine } from '@objectstack/service-automation';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { OPEN_REQUEST_STATUSES, backfillProcessPackages } from './stored-process-package-backfill.js';

const ORG = 'org_a';
const SYS_ORG = { isSystem: true, tenantId: ORG } as const;
const SYSTEM_CTX = { isSystem: true } as const;

const P = 'com.acme.p';
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! }) as never;

let flows: AutomationEngine;
let registry: SchemaRegistry;

beforeEach(() => {
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    for (const id of [P, A, B]) registry.installPackage(manifest(id), 'code');
    const flow = (name: string) => ({ name, label: name, type: 'autolaunched', nodes: [], edges: [] });
    const ship = (packageId: string, name: string) =>
        registry.registerItem('flow', { ...flow(name), _packageId: packageId }, 'name' as never, packageId);
    ship(A, 'expense_approval');
    ship(P, 'discount_approval');
    registry.registerItem('flow', { ...flow('discount_approval'), _provenance: 'org' }, 'name' as never); // the override
    ship(A, 'shared_approval');
    ship(B, 'shared_approval');
    registry.registerItem('flow', { ...flow('my_approval'), _provenance: 'org' }, 'name' as never);

    flows = new AutomationEngine({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => undefined } as any);
    // The automation plugin's `flowNameResolver`, over this registry.
    flows.setFlowNameResolver((name, callerPackageId, options) => resolvePackageScopedName(registry, {
        type: 'flow', name, callerPackageId,
        ...(options?.includeDisabledPackages === true ? { includeDisabledPackages: true } : {}),
    }));
});

const engines: ObjectQL[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (engines.length) {
        try { await engines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot(): Promise<ObjectQL> {
    const engine = new ObjectQL();
    engine.registerDriver(
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
        true,
    );
    await engine.init();
    engine.registerApp({
        id: 'com.objectstack.qa.approval-process-package',
        name: 'Approval process package column',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysApprovalRequest],
    } as any);
    await engine.syncSchemas();
    engines.push(engine);
    return engine;
}

const request = (id: string, processName: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, process_name: processName, object_name: 'expense', record_id: `rec_${id}`, status, ...extra,
});

async function seed(engine: ObjectQL): Promise<void> {
    for (const row of [
        request('q1', 'flow:expense_approval', 'pending'),
        request('q2', 'flow:expense_approval', 'returned'),
        request('q3', 'flow:discount_approval', 'pending'),
        request('q4', 'flow:shared_approval', 'pending'),
        request('q5', 'flow:my_approval', 'pending'),
        request('q6', 'flow:retired_approval', 'pending'),
        // A request opened with no flow name carries the node id: never a flow name.
        request('q7', 'node_42', 'pending'),
        // Decided requests stay as written (seat ruling Q5).
        request('q8', 'flow:expense_approval', 'approved'),
        request('q9', 'flow:expense_approval', 'rejected'),
        request('q10', 'flow:expense_approval', 'recalled'),
        request('q11', 'flow:expense_approval', 'cancelled'),
        // Already names a package: never a candidate, never moved.
        request('q12', 'flow:expense_approval', 'pending', { process_package: 'com.acme.elsewhere' }),
    ]) {
        await engine.insert('sys_approval_request', row, { context: SYS_ORG });
    }
}

async function packages(engine: ObjectQL): Promise<Record<string, unknown>> {
    const rows = (await engine.find('sys_approval_request', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    return Object.fromEntries(rows.map((r) => [String(r.id), r.process_package ?? null]));
}

describe('R7 — an open approval request gains the package that holds its flow', () => {
    it('the open statuses are pending and returned', () => {
        expect([...OPEN_REQUEST_STATUSES]).toEqual(['pending', 'returned']);
    });

    it('binds open requests of a flow one package holds; decided rows and every refusal stay null', async () => {
        const engine = await boot();
        await seed(engine);

        const report = await backfillProcessPackages(engine, flows);

        expect(await packages(engine)).toEqual({
            q1: A, q2: A,
            q3: P,
            q4: null, q5: null, q6: null, q7: null,
            q8: null, q9: null, q10: null, q11: null,
            q12: 'com.acme.elsewhere',
        });
        expect(report.bound).toEqual([
            { name: 'expense_approval', rows: 2, packageId: A },
            { name: 'discount_approval', rows: 1, packageId: P },
        ]);
        expect(report.ambiguous).toEqual([
            { name: 'shared_approval', rows: 1, candidates: [`package "${A}"`, `package "${B}"`] },
        ]);
        expect(report.unpackaged).toEqual([{ name: 'my_approval', rows: 1, holder: 'environment' }]);
        expect(report.unheld).toEqual([{ name: 'retired_approval', rows: 1 }]);
    });

    it('an open request of an overridden P flow is bound to P (seat ruling Q3)', async () => {
        const engine = await boot();
        await engine.insert('sys_approval_request', request('ov', 'flow:discount_approval', 'pending'), { context: SYS_ORG });
        await backfillProcessPackages(engine, flows);
        expect(await packages(engine)).toEqual({ ov: P });
    });

    it('a second run writes 0 rows and reports the same refusals', async () => {
        const engine = await boot();
        await seed(engine);
        await backfillProcessPackages(engine, flows);
        const update = vi.spyOn(engine, 'update');

        const again = await backfillProcessPackages(engine, flows);

        expect(update).not.toHaveBeenCalled();
        expect(again.bound).toEqual([]);
        expect(again.ambiguous.map((a) => a.name)).toEqual(['shared_approval']);
    });

    it('no key moves: the request indexes stay byte for byte, and the column is nullable and read-only', () => {
        expect(JSON.stringify(SysApprovalRequest.indexes)).toBe(JSON.stringify([
            { fields: ['object_name', 'record_id'], unique: false },
            { fields: ['status', 'object_name'], unique: false },
            { fields: ['status', 'updated_at'], unique: false },
            { fields: ['submitter_id', 'status'], unique: false },
        ]));
        expect((SysApprovalRequest.fields as Record<string, any>).process_package).toMatchObject({
            type: 'text', required: false, readonly: true,
        });
    });
});

/**
 * [#32183, contract review M2] A disable is reversible, so it moves no
 * binding: the backfill asks every holder, a disabled package's included,
 * while the execute read (`flowHolder`) keeps judging the served holders.
 * Both registration orders of a clash.
 *
 * BASE (branch head 340f7cbc, measured): a request of a flow only a disabled
 * package held was left null and reported as held by nothing; a clash with one
 * holder disabled was bound to the enabled holder, for good. On main (de141e32)
 * each answered as pinned here.
 */
describe('#32183 — a disable moves no binding: R7 asks every holder', () => {
    const D = 'com.acme.parked';
    beforeEach(() => {
        registry.installPackage(manifest(D), 'code');
        const flow = (name: string, packageId: string) => ({ name, label: name, type: 'autolaunched', nodes: [], edges: [], _packageId: packageId });
        registry.registerItem('flow', flow('parked_approval', D), 'name' as never, D);
        registry.registerItem('flow', flow('reversed_approval', B), 'name' as never, B);
        registry.registerItem('flow', flow('reversed_approval', A), 'name' as never, A);
        registry.disablePackage(D);
        registry.disablePackage(B);
    });

    it('the execute read judges the served holders; the backfill binds as every holder answers', async () => {
        expect(flows.flowHolder('parked_approval')?.status).toBe('not-found');
        expect(flows.flowHolder('shared_approval')).toMatchObject({ status: 'resolved', holder: { kind: 'package', packageId: A } });
        const engine = await boot();
        for (const [id, name] of [['p1', 'parked_approval'], ['p2', 'shared_approval'], ['p3', 'reversed_approval']] as const) {
            await engine.insert('sys_approval_request', request(id, `flow:${name}`, 'pending'), { context: SYS_ORG });
        }

        const report = await backfillProcessPackages(engine, flows);

        expect(await packages(engine)).toEqual({ p1: D, p2: null, p3: null });
        expect(report.bound).toEqual([{ name: 'parked_approval', rows: 1, packageId: D }]);
        expect(report.ambiguous).toEqual([
            { name: 'shared_approval', rows: 1, candidates: [`package "${A}"`, `package "${B}"`] },
            // Named in registration order.
            { name: 'reversed_approval', rows: 1, candidates: [`package "${B}"`, `package "${A}"`] },
        ]);
        expect(report.unheld).toEqual([]);
    });

    it('an engine of an earlier release, with no durableFlowHolder: the backfill asks its flowHolder', async () => {
        const engine = await boot();
        await engine.insert('sys_approval_request', request('e1', 'flow:expense_approval', 'pending'), { context: SYS_ORG });
        const flowHolder = vi.fn((name: string) => flows.durableFlowHolder(name));
        await backfillProcessPackages(engine, { flowHolder });
        expect(flowHolder).toHaveBeenCalledWith('expense_approval');
        expect(await packages(engine)).toEqual({ e1: A });
    });
});
