// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28149, ADR-0146 D4] `POST /automation/:name/clone` is "new similar": the
 * copy lands in a writable PACKAGE — by default the source's paired
 * customization package `<base>.custom`, ensured through the protocol's ensure
 * door — and is written switched off, so it never runs beside its original.
 *
 * ## What was measured before this card
 *
 * The copy was saved naming no package (a package-less row, the scope ADR-0070
 * D5/D6 retired) with `status: 'draft'`, which the automation engine arms like
 * `active`: on showcase at `d6c0a75f1a`, `showcase_urgent_task_alert` and its
 * `_copy` both ran on one record change. The first describe block below is
 * that measurement as a test: it reds on the base tree (no `packageId` on the
 * answer, a package-less row, `status: 'draft'`).
 *
 * ## The rig
 *
 * A REAL store and protocol: better-sqlite3 `:memory:`, the real `ObjectQL`
 * engine with the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` over its `SchemaRegistry`, so the ensure
 * door, the package binding of the saved row and every save-door refusal are
 * production's. The base is an installed app of a platform scope (read-only),
 * and its flow is registered as the loader registers a package's flow, so
 * `packagedArtifactOwner` — the loader's set — names the base. The automation
 * engine is a map, as in the sibling door suites (its validation is not the
 * subject); "switched off" is read where the engine reads it, the copy's
 * `status`, and `engine.ts` disables on `obsolete` (its own suite pins that).
 * `OS_HOME` is redirected because the ensure door really installs the pair.
 *
 * Only the envelope (`code` + `status`), the package bindings read back from
 * the store, and the named package are asserted — never a refusal's sentence.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { CloneFlowResponseSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
import { FLOW_CLONE_NOTICE, FLOW_CLONE_STATUS } from '../flow-clone.js';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-flow-clone-custom-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
/** The base: an installed app the customer cannot author into (a platform scope). */
const BASE = { id: 'com.acme.crm', name: 'CRM', version: '3.4.1', type: 'app', namespace: 'crm', scope: 'system' };
const PAIR = 'com.acme.crm.custom';
/** A writable package that depends on the base: a legal explicit target. */
const EXT = { id: 'com.acme.ext', name: 'Ext', version: '1.0.0', type: 'module', namespace: 'ext', dependencies: { [BASE.id]: '^3' } };
/** A writable package with no dependency on the base: outside the closure. */
const OTHER = { id: 'com.acme.other', name: 'Other', version: '1.0.0', type: 'app', namespace: 'other' };
/** A read-only package that depends on the base. */
const SEALED = { id: 'com.acme.sealed', name: 'Sealed', version: '1.0.0', type: 'module', namespace: 'sealed', scope: 'system', dependencies: { [BASE.id]: '^3' } };

/** The base's flow, as the loader registered it. */
const SOURCE = 'crm_lead_followup';
/** A flow authored in the deployment: no package ships it. */
const LOCAL = 'local_digest';

const AUTHOR = { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata'] };

const flowOf = (name: string, extra: Record<string, unknown> = {}) => ({
    name, label: `Flow ${name}`, type: 'autolaunched', status: 'active', nodes: [], edges: [], ...extra,
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

interface Answer {
    status: number | undefined;
    code: unknown;
    data: any;
    body: any;
}

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registry.installPackage(BASE as any, 'marketplace');
    engine.registry.installPackage(EXT as any, 'code');
    engine.registry.installPackage(OTHER as any, 'code');
    engine.registry.installPackage(SEALED as any, 'marketplace');
    // The base's flow, registered as the loader registers a package's flow.
    const shipped = { ...flowOf(SOURCE), _packageId: BASE.id, _packageVersion: BASE.version, _provenance: 'package' };
    engine.registry.registerItem('flow', shipped as any, 'name' as any, BASE.id);

    const published: unknown[] = [];
    const services = new Map<string, unknown>([
        ['package', { publish: async ({ manifest }: { manifest: unknown }) => { published.push(manifest); return { success: true }; } }],
    ]);
    const protocol = new ObjectStackProtocolImplementation(engine as any, () => services);

    const flows = new Map<string, any>([[SOURCE, shipped], [LOCAL, flowOf(LOCAL)]]);
    const registerFlow = vi.fn((name: string, definition: unknown) => { flows.set(name, definition); return definition; });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const named: Record<string, unknown> = {
        protocol,
        objectql: engine,
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow },
    };
    const get = (name: string) => named[name] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });

    /**
     * The door's answer. A body refusal is THROWN as a located validation
     * failure (the transport renders it 400), as every body refusal on this
     * door is; it is read back here as the status and code it carries.
     */
    const clone = async (source: string, body: Record<string, unknown>): Promise<Answer> => {
        try {
            const res = await dispatcher.dispatch('POST', `/automation/${source}/clone`, body, {}, { request: { headers: {} } } as any);
            const json = res.response?.body;
            return { status: res.response?.status, code: json?.error?.code, data: json?.data, body: json };
        } catch (e: any) {
            const fields = validationFailureDetails(e)?.fields;
            if (!fields) throw e;
            return { status: VALIDATION_FAILED_STATUS, code: e.code, data: undefined, body: { error: { code: e.code, fields } } };
        }
    };

    /** Every stored row of a flow, read back from the store, by package binding. */
    const rows = async (name: string): Promise<Array<{ package_id: string | null; state: unknown; item: any }>> => {
        const found = (await engine.find('sys_metadata', { where: { type: 'flow', name }, context: { isSystem: true } })) ?? [];
        return [...found].map((row: any) => ({
            package_id: row.package_id ?? null,
            state: row.state,
            item: JSON.parse(String(row.metadata)),
        }));
    };
    const installed = () => engine.registry.getAllPackages().map((p: any) => p.manifest?.id ?? p.id).sort();

    return { engine, protocol, clone, rows, installed, flows, registerFlow, published };
}

describe('[#28149] the default target: the copy lands in <base>.custom, switched off', () => {
    it('precondition — the loader\'s set names the base as the source\'s package', async () => {
        const rig = await boot();
        expect(rig.protocol.packagedArtifactOwner({ type: 'flow', name: SOURCE })).toBe(BASE.id);
        expect(rig.installed()).not.toContain(PAIR);
    }, 60_000);

    it('ensures the pair through the ensure door and lands the copy there, naming it on the answer', async () => {
        const rig = await boot();

        const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(PAIR);
        expect(rig.installed()).toContain(PAIR);
        // ⛔ Never package-less: exactly one stored row, bound to the pair.
        expect((await rig.rows('acme_lead_followup')).map((r) => r.package_id)).toEqual([PAIR]);
        // The answer is the declared one.
        expect(CloneFlowResponseSchema.safeParse(answer.body).success).toBe(true);
    }, 60_000);

    it('writes the copy switched off, stored and registered, and says so in the server\'s words', async () => {
        const rig = await boot();

        const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(FLOW_CLONE_STATUS).toBe('obsolete');
        expect(answer.data.flow.status).toBe('obsolete');
        const [row] = await rig.rows('acme_lead_followup');
        expect(row.item.status).toBe('obsolete');
        expect(rig.flows.get('acme_lead_followup')?.status).toBe('obsolete');
        expect(answer.data.notice).toBe(FLOW_CLONE_NOTICE);
        // …and the original keeps running, untouched.
        expect(rig.flows.get(SOURCE)?.status).toBe('active');
        expect(await rig.rows(SOURCE)).toEqual([]);
    }, 60_000);

    it('carries no base envelope onto the copy: the row is the pair\'s own item', async () => {
        const rig = await boot();

        const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        for (const key of ['_packageId', '_packageVersion', '_provenance', '_lock']) {
            expect(answer.data.flow, `answer carries '${key}'`).not.toHaveProperty(key);
        }
        const [row] = await rig.rows('acme_lead_followup');
        expect(row.item._packageId).not.toBe(BASE.id);
        expect(row.item._provenance).not.toBe('package');
    }, 60_000);

    it('a second clone reuses the pair the first one created (the ensure door is idempotent)', async () => {
        const rig = await boot();

        const first = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'First copy' });
        const pairsAfterFirst = rig.published.length;
        const second = await rig.clone(SOURCE, { name: 'acme_lead_followup_two', label: 'Second copy' });

        expect(first.status, JSON.stringify(first.body)).toBe(200);
        expect(second.status, JSON.stringify(second.body)).toBe(200);
        expect(second.data.packageId).toBe(PAIR);
        expect(rig.installed().filter((id) => id === PAIR)).toHaveLength(1);
        expect(rig.published.length, 'the second clone persisted another package').toBe(pairsAfterFirst);
        expect((await rig.rows('acme_lead_followup_two')).map((r) => r.package_id)).toEqual([PAIR]);
    }, 60_000);
});

describe('[#28149] an explicit target: `package`', () => {
    it('a writable package that depends on the base takes the copy', async () => {
        const rig = await boot();

        const answer = await rig.clone(SOURCE, { name: 'ext_lead_followup', label: 'Lead follow-up (ext)', package: EXT.id });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(EXT.id);
        expect((await rig.rows('ext_lead_followup')).map((r) => r.package_id)).toEqual([EXT.id]);
        expect(answer.data.flow.status).toBe('obsolete');
        // No pair is minted for an explicit target.
        expect(rig.installed()).not.toContain(PAIR);
    }, 60_000);

    const refused: Array<[string, string, number, string]> = [
        ['a read-only package', SEALED.id, 422, 'WRITABLE_PACKAGE_REQUIRED'],
        ['a package that is not installed', 'com.acme.nowhere', 422, 'WRITABLE_PACKAGE_REQUIRED'],
        ['a writable package outside the source\'s closure', OTHER.id, 409, 'RESOURCE_CONFLICT'],
        ['the read-only base itself', BASE.id, 422, 'WRITABLE_PACKAGE_REQUIRED'],
    ];
    for (const [what, target, status, code] of refused) {
        it(`${what} is refused ${status} ${code}, and nothing is registered, stored or minted`, async () => {
            const rig = await boot();

            const answer = await rig.clone(SOURCE, { name: 'refused_copy', label: 'Refused copy', package: target });

            expect(answer.status, JSON.stringify(answer.body)).toBe(status);
            expect(answer.code).toBe(code);
            expect(answer.body.error.details?.packageId).toBe(target);
            expect(rig.registerFlow).not.toHaveBeenCalled();
            expect(await rig.rows('refused_copy')).toEqual([]);
            expect(rig.installed()).not.toContain(PAIR);
        }, 60_000);
    }

    it('a blank `package` is refused 400 on the field, never read as omitted', async () => {
        const rig = await boot();

        const answer = await rig.clone(SOURCE, { name: 'blank_target', label: 'Blank target', package: '  ' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(400);
        expect(answer.body.error.fields).toMatchObject([{ field: 'package', code: 'invalid_type' }]);
        expect(rig.registerFlow).not.toHaveBeenCalled();
        expect(rig.installed()).not.toContain(PAIR);
    }, 60_000);
});

describe('[#28149] a source no package ships has no pair', () => {
    it('omitting `package` is refused 400 VALIDATION_FAILED on `package` — never a package-less copy', async () => {
        const rig = await boot();

        const answer = await rig.clone(LOCAL, { name: 'local_digest_copy', label: 'Digest copy' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(400);
        expect(answer.code).toBe('VALIDATION_FAILED');
        expect(answer.body.error.fields).toMatchObject([{ field: 'package', code: 'required' }]);
        expect(rig.registerFlow).not.toHaveBeenCalled();
        expect(await rig.rows('local_digest_copy')).toEqual([]);
    }, 60_000);

    it('naming a writable package lands it there, switched off', async () => {
        const rig = await boot();

        const answer = await rig.clone(LOCAL, { name: 'local_digest_copy', label: 'Digest copy', package: OTHER.id });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(OTHER.id);
        expect((await rig.rows('local_digest_copy')).map((r) => r.package_id)).toEqual([OTHER.id]);
        expect(answer.data.flow.status).toBe('obsolete');
    }, 60_000);
});
