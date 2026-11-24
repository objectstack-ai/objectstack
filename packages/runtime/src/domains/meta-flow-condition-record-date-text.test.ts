// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34662] The flow publish door refuses `timestamp()` over a date field read
 * through `record.` / `previous.` in a flow condition, as it refuses the bare
 * name.
 *
 * The business case: an administrator publishes, in Studio or through an MCP
 * agent, a record-triggered flow on a library loan that runs only once the
 * loan's borrow day is past (`timestamp(record.borrow_date) < now()`). A
 * `date` field reaches the run as its `YYYY-MM-DD` text, which `timestamp()`
 * does not parse, so the condition faults and the flow fails on every run.
 * The door refused the bare spelling (`timestamp(borrow_date) < now()`) and
 * published the `record.` one; both are refused now, in the same finding.
 * A `datetime` field holds an ISO-8601 instant, which `timestamp()` parses: it
 * still publishes.
 *
 * ## The rig
 *
 * The rig of `meta-flow-hook-injected-column-null-guard.test.ts`:
 * better-sqlite3 `:memory:` behind the real `ObjectQL` engine, the real
 * `sys_metadata*` objects and a real `ObjectStackProtocolImplementation`. The
 * loan object comes from a code package registered through `registerApp`;
 * each flow is saved as a draft in a writable package and published through
 * `publishMetaItem`, the door Studio, REST and MCP authors use.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
// The protocol's package door reaches `import('@objectstack/metadata')`; pay
// that load during collection, never inside a clocked case
// (check:test-source-alias).
import '@objectstack/metadata';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-flow-record-date-text-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const BASE = 'com.acme.library';
const PAIR = 'com.acme.library.custom';
const TARGET = 'library_loan';

const loan = {
    name: TARGET,
    label: 'Loan',
    sharingModel: 'private',
    fields: {
        title: { name: 'title', label: 'Title', type: 'text' },
        borrow_date: { name: 'borrow_date', label: 'Borrowed', type: 'date' },
        // [#34946] Required, so the null-guard gate draws no second finding on a comparison of it.
        due_date: { name: 'due_date', label: 'Due', type: 'date', required: true },
        picked_up_at: { name: 'picked_up_at', label: 'Picked up', type: 'datetime' },
    },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, 'objectstack-test');
    engine.registry.registerObject(SysMetadataHistoryObject as any, 'objectstack-test');
    engine.registry.registerObject(SysMetadataAuditObject as any, 'objectstack-test');
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registerApp({ id: BASE, name: 'library', version: '1.0.0', type: 'app', namespace: 'library', objects: [loan] });
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any, () => new Map()) as any;
    await protocol.installPackage({
        manifest: { id: PAIR, name: 'library-custom', version: '0.1.0', type: 'app', namespace: 'library_custom', dependencies: { [BASE]: '^1' } },
    });
    /** Save as a draft in the writable package, then publish; the refusal, or `undefined` when it published. */
    const publish = async (item: Record<string, unknown>) => {
        await protocol.saveMetaItem({ type: 'flow', name: item.name, item, mode: 'draft', packageId: PAIR });
        return protocol.publishMetaItem({ type: 'flow', name: item.name, packageId: PAIR }).then(() => undefined, (e: any) => e);
    };
    const state = async (name: unknown) =>
        ((await engine.find('sys_metadata', { where: { type: 'flow', name }, context: { isSystem: true } })) ?? [])
            .map((r: any) => r.state);
    return { publish, state };
}

/** A record-triggered flow on the loan whose start node carries the condition. */
const flowOn = (name: string, condition: string) => ({
    name,
    label: 'Overdue loan',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: TARGET, triggerType: 'record-after-update', condition } },
        { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'done' }],
});

/** The door's date-text findings on a refused publish. */
const dateTextIssues = (err: any) =>
    (err?.issues ?? []).filter((i: any) => i.rule === 'expression-invalid' && /is a date field, and the runtime holds/.test(i.message));

describe('[#34662] the flow publish door refuses timestamp() over a date field read through record. / previous.', () => {
    it('⭐ LIT — refuses the bare name, `record.` and `previous.` alike, with INVALID_METADATA / 422, leaving the draft', async () => {
        const rig = await boot();
        for (const [name, read] of [
            ['loan_overdue_bare', 'borrow_date'],
            ['loan_overdue_record', 'record.borrow_date'],
            ['loan_overdue_previous', 'previous.borrow_date'],
        ] as const) {
            const err: any = await rig.publish(flowOn(name, `timestamp(${read}) < now()`));
            expect(err, `${read}: the publish was admitted`).toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }, read).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = dateTextIssues(err);
            expect(issues, `${read}: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0].message).toContain(`\`timestamp(${read})\` — \`${read}\` is a date field`);
            expect(issues[0].message).toContain(`\`isoDate(addDays(${read}, N))\``);
            expect(await rig.state(name), read).toEqual(['draft']);
        }
    }, 60_000);

    it('⭐ CONTROL — a datetime field under timestamp(), through either root, publishes', async () => {
        const rig = await boot();
        for (const [name, read] of [
            ['loan_picked_up_record', 'record.picked_up_at'],
            ['loan_picked_up_previous', 'previous.picked_up_at'],
        ] as const) {
            const err = await rig.publish(flowOn(name, `timestamp(${read}) < now()`));
            expect(err?.issues ?? err, `${read}: the door refused`).toBeUndefined();
            expect(await rig.state(name), read).toEqual(['active']);
        }
    }, 60_000);
});

/** [#34946] The door's date-arithmetic findings on a refused publish. */
const dateArithmeticIssues = (err: any) =>
    (err?.issues ?? []).filter((i: any) => i.rule === 'expression-invalid' && /^date arithmetic/.test(i.message));

/**
 * [#34946] The flow publish door refuses date arithmetic on a date field read
 * through `record.` / `previous.` in a flow condition, as it refuses the bare
 * name. The business case: an administrator publishes a record-triggered flow
 * on a loan that runs once the loan is a day past due (`record.due_date + 1 > 5`
 * written as if the date were a number). The run holds the field as its
 * `YYYY-MM-DD` text, the evaluator cannot add a number to it, and the flow
 * failed on every run while the door published it; the bare spelling was
 * refused. A `datetime` field takes exactly the bare name's verdict too, and an
 * ordering against `today()` still publishes.
 */
describe('[#34946] the flow publish door refuses date arithmetic on a date field read through record. / previous.', () => {
    it('⭐ LIT — refuses the bare name, `record.` and `previous.` alike, with INVALID_METADATA / 422, leaving the draft', async () => {
        const rig = await boot();
        for (const [name, read] of [
            ['loan_due_bare', 'due_date'],
            ['loan_due_record', 'record.due_date'],
            ['loan_due_previous', 'previous.due_date'],
        ] as const) {
            const err: any = await rig.publish(flowOn(name, `${read} + 1 > 5`));
            expect(err, `${read}: the publish was admitted`).toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }, read).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = dateArithmeticIssues(err);
            expect(issues, `${read}: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0].message).toContain(`date arithmetic \`google.protobuf.Timestamp + int\` — \`${read}\` is a date`);
            expect(await rig.state(name), read).toEqual(['draft']);
        }
    }, 60_000);

    it('⭐ CONTROL — a datetime field\'s root reads take the bare name\'s refusal, and an ordering against today() publishes', async () => {
        const rig = await boot();
        for (const [name, read] of [
            ['loan_picked_bare', 'picked_up_at'],
            ['loan_picked_record', 'record.picked_up_at'],
            ['loan_picked_previous', 'previous.picked_up_at'],
        ] as const) {
            const err: any = await rig.publish(flowOn(name, `${read} + 1 > 5`));
            expect({ code: err?.code, status: err?.status }, read).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = dateArithmeticIssues(err);
            expect(issues, `${read}: ${JSON.stringify(err?.issues)}`).toHaveLength(1);
            expect(issues[0].message).toContain(`date arithmetic \`google.protobuf.Timestamp + int\` — \`${read}\` is a date`);
            expect(await rig.state(name), read).toEqual(['draft']);
        }
        const err = await rig.publish(flowOn('loan_due_ordering', 'record.due_date < today()'));
        expect(err?.issues ?? err, 'record.due_date < today(): the door refused').toBeUndefined();
        expect(await rig.state('loan_due_ordering')).toEqual(['active']);
    }, 60_000);
});
