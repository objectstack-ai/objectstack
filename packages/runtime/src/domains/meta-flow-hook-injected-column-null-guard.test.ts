// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33246] The flow and hook publish doors judge an unguarded ordering over an
 * injected system column by what a stored row holds in it.
 *
 * The business case: an administrator publishes, in Studio, a record-triggered
 * flow that runs only for accounts created this year
 * (`record.created_at > timestamp('2025-01-01T00:00:00Z')`), or a hook gated
 * on `record.updated_at > record.created_at`. The registry serves the account
 * with the system columns it injects declared as `required: false` fields, so
 * the door's null-guard gate refused both, while `os build` of the same items
 * accepts them. The platform stamps `created_at` and `updated_at` on every
 * stored row; the door now leaves those two unjudged under an ordering
 * comparison, except on a `beforeInsert` hook, which can run before the stamp.
 * The injected columns a stored row can hold `null` in (`owner_id`,
 * `created_by`, …) stay judged.
 *
 * ## The rig
 *
 * The rig of `meta-object-extension-item.test.ts`: better-sqlite3 `:memory:`
 * behind the real `ObjectQL` engine, the real `sys_metadata*` objects and a
 * real `ObjectStackProtocolImplementation` over its `SchemaRegistry`. The base
 * is a code package registered through `registerApp`, so the door reads the
 * account exactly as the registry serves it. Each item is saved as a draft in
 * a writable package and published through `publishMetaItem`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { runAuthoringRules } from '@objectstack/lint';
// The protocol's package door reaches `import('@objectstack/metadata')`; pay
// that load during collection, never inside a clocked case
// (check:test-source-alias).
import '@objectstack/metadata';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-injected-column-null-guard-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const TARGET = 'crm_account';

/** The account as authored: no system column declared. */
const account = {
    name: TARGET,
    label: 'Account',
    sharingModel: 'private',
    fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
        amount: { name: 'amount', label: 'Amount', type: 'number' },
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
    engine.registerApp({ id: BASE, name: 'crm', version: '3.4.1', type: 'app', namespace: 'crm', objects: [account] });
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any, () => new Map()) as any;
    await protocol.installPackage({
        manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies: { [BASE]: '^3' } },
    });
    /** Save as a draft in the writable package, then publish; the refusal, or `undefined` when it published. */
    const publish = async (type: 'flow' | 'hook', item: Record<string, unknown>) => {
        await protocol.saveMetaItem({ type, name: item.name, item, mode: 'draft', packageId: PAIR });
        return protocol.publishMetaItem({ type, name: item.name, packageId: PAIR }).then(() => undefined, (e: any) => e);
    };
    const state = async (type: string, name: unknown) =>
        ((await engine.find('sys_metadata', { where: { type, name }, context: { isSystem: true } })) ?? [])
            .map((r: any) => r.state);
    return { engine, publish, state };
}

/** A record-triggered flow on the account whose start node carries the condition. */
const flowOn = (name: string, condition: string) => ({
    name,
    label: 'Probe',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: TARGET, triggerType: 'record-after-update', condition } },
        { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'done' }],
});
const hookOn = (name: string, condition: string) => ({
    name, object: TARGET, events: ['beforeUpdate'], condition, body: { language: 'js', source: 'return;' },
});

/** `os build`'s expression findings on the item, over the account as authored. */
const atBuild = (collection: 'flows' | 'hooks', item: unknown) => {
    const stack = { objects: [account], [collection]: [item] };
    return runAuthoringRules('build', { normalized: stack, parsed: stack } as any)
        .filter((f) => f.rule === 'expression-invalid');
};

const SINCE = "record.created_at > timestamp('2025-01-01T00:00:00Z')";
const ORDER = 'record.updated_at > record.created_at';

describe('[#33246] the flow and hook publish doors judge an injected column by what a stored row holds', () => {
    it('a stored row holds the two stamped timestamps and can hold null in the other injected columns', async () => {
        const rig = await boot();
        const served = rig.engine.registry.getObject(TARGET) as any;
        // The door reads this definition: every injected column declared, none required.
        for (const column of ['created_at', 'updated_at', 'owner_id', 'created_by']) {
            expect(served?.fields?.[column]?.required, column).toBe(false);
        }
        const created: any = await rig.engine.insert(TARGET, { name: 'Acme', organization_id: 'org_1' }, { context: { isSystem: true } });
        const row: any = await rig.engine.findOne(TARGET, { where: { id: created.id }, context: { isSystem: true } });
        expect(row?.created_at).toBeTruthy();
        expect(row?.updated_at).toBeTruthy();
        expect(row?.owner_id ?? null).toBeNull();
        expect(row?.created_by ?? null).toBeNull();
    }, 60_000);

    for (const [type, collection, build] of [
        ['flow', 'flows', flowOn],
        ['hook', 'hooks', hookOn],
    ] as const) {
        it(`⭐ LIT — a ${type} whose condition orders \`created_at\` / \`updated_at\` with no guard publishes, as \`os build\` accepts it`, async () => {
            const rig = await boot();
            for (const [name, condition] of [[`${type}_since`, SINCE], [`${type}_order`, ORDER]] as const) {
                const item = build(name, condition);
                expect(atBuild(collection, item), condition).toEqual([]);
                const err = await rig.publish(type, item);
                expect(err?.issues ?? err, `${condition}: the door refused`).toBeUndefined();
                expect(await rig.state(type, name)).toEqual(['active']);
            }
        }, 60_000);

        it(`⭐ LIT — a ${type} whose condition orders \`owner_id\` with no guard is still refused: a stored row can hold null there`, async () => {
            const rig = await boot();
            const item = build(`${type}_owner`, "record.owner_id > 'a'");
            const err: any = await rig.publish(type, item);
            expect(err, 'the publish was admitted').toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = (err.issues ?? []).filter((i: any) => i.rule === 'expression-invalid');
            expect(issues, JSON.stringify(err.issues)).toHaveLength(1);
            expect(issues[0].message).toContain('`record.owner_id`');
            expect(await rig.state(type, item.name)).toEqual(['draft']);
        }, 60_000);
    }

    it('⭐ LIT — a `beforeInsert` hook whose condition orders `created_at` with no guard is still refused: it can run before the stamp', async () => {
        const rig = await boot();
        const item = { ...hookOn('hook_before_insert', SINCE), events: ['beforeInsert'] };
        const err: any = await rig.publish('hook', item);
        expect(err, 'the publish was admitted').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = (err.issues ?? []).filter((i: any) => i.rule === 'expression-invalid');
        expect(issues, JSON.stringify(err.issues)).toHaveLength(1);
        expect(issues[0].message).toContain('`record.created_at`');
        expect(await rig.state('hook', item.name)).toEqual(['draft']);
    }, 60_000);
});
