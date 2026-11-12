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

// Pays `@objectstack/metadata`'s first load at collection, never inside a clocked case.
import '@objectstack/metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { MULTI_REPLICA_PACKAGE_CHANGE_REFUSED } from '@objectstack/service-cluster';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { CloneFlowRequestSchema, CloneFlowResponseSchema } from '@objectstack/spec/api';
import { FlowSchema } from '@objectstack/spec/automation';
import { ROUTE_LEDGER } from '../route-ledger.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
import { FLOW_CLONE_NOTICE, FLOW_CLONE_NOTICE_CODE, FLOW_CLONE_STATUS } from '../flow-clone.js';

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
/**
 * The base: an installed app the customer cannot author into — held as code,
 * the way an installed app's packages are. Not a `system` scope: that is the
 * kernel's, which has no pair in this version (ruling record 6691217245).
 */
const BASE = { id: 'com.acme.crm', name: 'CRM', version: '3.4.1', type: 'app', namespace: 'crm' };
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
    name, label: `Flow ${name}`, type: 'autolaunched', status: 'active', nodes: [{ id: 'start', type: 'start', label: 'Start' }], edges: [], ...extra,
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

/**
 * `parse`: the engine's registration as a strict `FlowSchema` parse — the
 * check `registerFlow` runs first (`canonicalizeFlow`), so a definition the
 * protocol refuses (an illegal machine name among it) throws the way the real
 * engine throws. The default rig's engine is a map that accepts anything.
 */
/**
 * [cloud#3814 D1] An installed App and a read-only member of it shipping
 * {@link SUITE_FLOW}: the member's pair is its App's, `com.acme.suite.custom`
 * (ruling 6691022506). `legacyMemberPair` also installs the per-package pair
 * an earlier version created for the member.
 */
const SUITE_APP = { id: 'com.acme.suite', name: 'Suite', version: '2.0.0', type: 'app', namespace: 'suite' };
const SUITE_MEMBER = { id: 'com.acme.suite-crm', name: 'Suite CRM', version: '2.0.0', type: 'module', namespace: 'suitecrm', dependencies: { [SUITE_APP.id]: '^2' } };
const SUITE_PAIR = 'com.acme.suite.custom';
const SUITE_FLOW = 'suite_lead_route';
/**
 * A writable package that declares the App but not the member: not the
 * member's pair, and outside its closure (the App does not declare its
 * members) — an explicit target that stays refused.
 */
const SUITE_EXT = { id: 'com.acme.suite-ext', name: 'Suite Ext', version: '1.0.0', type: 'module', namespace: 'suiteext', dependencies: { [SUITE_APP.id]: '^2' } };
/** A read-only package that belongs to no App (its own unit), shipping {@link SOLO_FLOW}. */
const SOLO = { id: 'com.acme.solo', name: 'Solo', version: '1.0.0', type: 'module', namespace: 'solo' };
const SOLO_FLOW = 'solo_digest';
/**
 * A read-only package the member declares (`memberDep`), neither the App nor
 * a member of it (its own unit), shipping {@link SUITE_DEP_FLOW}: inside the
 * App's pair's save-gate closure through the member's declared dependencies.
 */
const SUITE_DEP = { id: 'com.acme.geo', name: 'Geo', version: '1.0.0', type: 'module', namespace: 'geo' };
const SUITE_DEP_FLOW = 'geo_region_sync';

async function boot(options: {
    parse?: boolean; baseScope?: 'system' | 'cloud'; clusterDriver?: string; appMember?: boolean; legacyMemberPair?: boolean;
    /** Installs {@link SUITE_EXT} (needs `appMember`). */
    suiteExt?: boolean;
    /** Installs the App's pair with a manifest that dropped its dependency on the App (needs `appMember`). */
    pairWithoutApp?: boolean;
    /** Installs {@link SOLO}, shipping {@link SOLO_FLOW}. */
    solo?: boolean;
    /** Installs {@link SUITE_DEP}, shipping {@link SUITE_DEP_FLOW}, and has the member declare it (needs `appMember`). */
    memberDep?: boolean;
} = {}) {
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
    const base = options.baseScope === undefined ? BASE : { ...BASE, scope: options.baseScope };
    engine.registry.installPackage(base as any, 'code');
    (engine as unknown as { manifests: Map<string, unknown> }).manifests.set(BASE.id, base);
    engine.registry.installPackage(EXT as any, 'code');
    engine.registry.installPackage(OTHER as any, 'code');
    engine.registry.installPackage(SEALED as any, 'marketplace');
    // The base's flow, registered as the loader registers a package's flow.
    const shipped = { ...flowOf(SOURCE), _packageId: BASE.id, _packageVersion: BASE.version, _provenance: 'package' };
    engine.registry.registerItem('flow', shipped as any, 'name' as any, BASE.id);
    const suiteShipped = { ...flowOf(SUITE_FLOW), _packageId: SUITE_MEMBER.id, _packageVersion: SUITE_MEMBER.version, _provenance: 'package' };
    const depShipped = { ...flowOf(SUITE_DEP_FLOW), _packageId: SUITE_DEP.id, _packageVersion: SUITE_DEP.version, _provenance: 'package' };
    if (options.appMember) {
        const member = options.memberDep ? { ...SUITE_MEMBER, dependencies: { ...SUITE_MEMBER.dependencies, [SUITE_DEP.id]: '^1' } } : SUITE_MEMBER;
        if (options.memberDep) {
            engine.registry.installPackage(SUITE_DEP as any, 'code');
            (engine as unknown as { manifests: Map<string, unknown> }).manifests.set(SUITE_DEP.id, SUITE_DEP);
            engine.registry.registerItem('flow', depShipped as any, 'name' as any, SUITE_DEP.id);
        }
        for (const m of [SUITE_APP, member]) {
            engine.registry.installPackage(m as any, 'code');
            (engine as unknown as { manifests: Map<string, unknown> }).manifests.set(m.id, m);
        }
        if (options.legacyMemberPair) {
            engine.registry.installPackage({ id: `${SUITE_MEMBER.id}.custom`, name: 'Legacy pair', version: '2.0.0', type: 'module', namespace: 'suitecrm_custom', dependencies: { [SUITE_MEMBER.id]: '^2' } } as any, 'authored');
        }
        engine.registry.registerItem('flow', suiteShipped as any, 'name' as any, SUITE_MEMBER.id);
        if (options.suiteExt) engine.registry.installPackage(SUITE_EXT as any, 'code');
        if (options.pairWithoutApp) {
            engine.registry.installPackage({ id: SUITE_PAIR, name: 'Suite customizations', version: '2.0.0', type: 'module', namespace: 'suite_custom' } as any, 'authored');
        }
    }
    const soloShipped = { ...flowOf(SOLO_FLOW), _packageId: SOLO.id, _packageVersion: SOLO.version, _provenance: 'package' };
    if (options.solo) {
        engine.registry.installPackage(SOLO as any, 'code');
        (engine as unknown as { manifests: Map<string, unknown> }).manifests.set(SOLO.id, SOLO);
        engine.registry.registerItem('flow', soloShipped as any, 'name' as any, SOLO.id);
    }

    const published: unknown[] = [];
    const services = new Map<string, unknown>([
        ['package', { publish: async ({ manifest }: { manifest: unknown }) => { published.push(manifest); return { success: true }; } }],
    ]);
    const protocol = new ObjectStackProtocolImplementation(engine as any, () => services);

    const flows = new Map<string, any>([[SOURCE, shipped], [LOCAL, flowOf(LOCAL)], ...(options.appMember ? [[SUITE_FLOW, suiteShipped] as [string, any]] : []), ...(options.solo ? [[SOLO_FLOW, soloShipped] as [string, any]] : []), ...(options.memberDep ? [[SUITE_DEP_FLOW, depShipped] as [string, any]] : [])]);
    const registerFlow = vi.fn((name: string, definition: unknown) => {
        if (options.parse) FlowSchema.parse(definition);
        flows.set(name, definition);
        return definition;
    });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const named: Record<string, unknown> = {
        protocol,
        objectql: engine,
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow },
    };
    if (options.clusterDriver !== undefined) named.cluster = { driver: options.clusterDriver };
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
        // [#29727] …named by its code, which the declared answer carries.
        expect(answer.data.noticeCode).toBe(FLOW_CLONE_NOTICE_CODE);
        expect(CloneFlowResponseSchema.parse(answer.body).data.noticeCode).toBe(FLOW_CLONE_NOTICE_CODE);
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

/**
 * [#29594, ruling record 6691217245] A kernel package (scope `system` /
 * `cloud`) has no pair in this version: the ensure door refuses it 409. The
 * flow door's default landing IS the ensure door, so a copy of a kernel-shipped
 * flow with no `package` named answers that refusal as relayed, and the
 * registration made before the landing is undone (`restoreFlowRegistration`):
 * the engine holds no copy, nothing is stored, and no pair is created.
 */
describe('[#29594] a kernel-shipped flow: no pair to land the copy in', () => {
    for (const baseScope of ['system', 'cloud'] as const) {
        it(`scope '${baseScope}', no \`package\` named: 409 with the ensure door's sentence, and the engine holds no copy`, async () => {
            const rig = await boot({ baseScope });
            const before = [...rig.flows.keys()].sort();

            const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

            expect(answer.status, JSON.stringify(answer.body)).toBe(409);
            expect(answer.code).toBe('RESOURCE_CONFLICT');
            expect(JSON.stringify(answer.body)).toContain(`Package '${BASE.id}' is a kernel package (scope '${baseScope}')`);
            expect(rig.flows.has('acme_lead_followup')).toBe(false);
            expect([...rig.flows.keys()].sort()).toEqual(before);
            expect(await rig.rows('acme_lead_followup')).toEqual([]);
            expect(rig.installed()).not.toContain(PAIR);
            // The original keeps running, untouched.
            expect(rig.flows.get(SOURCE)?.status).toBe('active');
        }, 60_000);
    }
});

describe('[#29650, ADR-0146 D2/D4] New similar while the source\'s override is live', () => {
    /**
     * Customize the base's flow the way Studio does: ensure the pair, save the
     * pair's item under the base's name DECLARING the override, and arm it in
     * place of the base (ADR-0146 D9 item 1), so the engine's map holds the
     * override's body for the name, which is what `getFlow` answers the door.
     */
    async function customize(rig: Awaited<ReturnType<typeof boot>>) {
        const override = {
            ...flowOf(SOURCE),
            label: 'Lead follow-up (customized)',
            description: 'Edited in Studio after Customize.',
            overrides: { package: BASE.id, basedOn: BASE.version },
        };
        await rig.protocol.ensureCustomizationPackage({ basePackageId: BASE.id });
        await rig.protocol.saveMetaItem({ type: 'flow', name: SOURCE, item: override, packageId: PAIR } as any);
        rig.flows.set(SOURCE, override);
        return override;
    }

    it('the copy is the pair\'s own item: 200, no `overrides` block, stored in the pair', async () => {
        const rig = await boot();
        const override = await customize(rig);
        // The override really is live and stored, so this measures a strip, not an absence.
        expect((await rig.rows(SOURCE)).map((r) => [r.package_id, r.item.overrides])).toEqual([[PAIR, override.overrides]]);

        const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(PAIR);
        expect(answer.data.flow).not.toHaveProperty('overrides');
        const copyRows = await rig.rows('acme_lead_followup');
        expect(copyRows.map((r) => r.package_id)).toEqual([PAIR]);
        expect(copyRows[0].item).not.toHaveProperty('overrides');
        expect(rig.flows.get('acme_lead_followup')).not.toHaveProperty('overrides');
        expect(answer.data.flow.status).toBe(FLOW_CLONE_STATUS);
    }, 60_000);

    it('copies what the source serves: the override\'s definition, and the override stays as it was', async () => {
        const rig = await boot();
        const override = await customize(rig);

        const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.flow.description).toBe(override.description);
        // The override is untouched: still the one row in the pair, still declaring.
        expect((await rig.rows(SOURCE)).map((r) => [r.package_id, r.item.overrides])).toEqual([[PAIR, override.overrides]]);
        expect(rig.flows.get(SOURCE)).toEqual(override);
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

describe('[#29016] a clone the engine refuses installs no pair', () => {
    it('control — with the parsing engine, a legal name still lands in the ensured pair', async () => {
        const rig = await boot({ parse: true });

        const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(PAIR);
        expect(rig.installed()).toContain(PAIR);
    }, 60_000);

    it('an illegal machine name is refused 400 and the package list is unchanged', async () => {
        const rig = await boot({ parse: true });
        const before = rig.installed();
        const publishedBefore = rig.published.length;

        const answer = await rig.clone(SOURCE, { name: 'Bad-Name!', label: 'Illegal' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(400);
        expect(answer.code).toBe('VALIDATION_FAILED');
        expect(answer.body.error.details.fields).toMatchObject([{ field: 'name' }]);
        // A refused clone changes nothing: no pair installed or persisted…
        expect(rig.installed()).toEqual(before);
        expect(rig.installed()).not.toContain(PAIR);
        expect(rig.published.length).toBe(publishedBefore);
        // …and no copy registered or stored.
        expect(rig.flows.has('Bad-Name!')).toBe(false);
        expect(await rig.rows('Bad-Name!')).toEqual([]);
    }, 60_000);
});

describe('[#28149] the contract: the ledger row names the schemas this suite parses with', () => {
    it('the clone row is SDK surface and names CloneFlowRequestSchema / CloneFlowResponseSchema', () => {
        const row = ROUTE_LEDGER.find((e) => e.route === 'POST /automation/:name/clone');
        expect(row, 'the clone row must exist in ROUTE_LEDGER').toBeDefined();
        expect(row!.disposition).toBe('sdk');
        expect(row!.client).toBe('automation.clone');
        expect(row!.requestSchema).toBe('CloneFlowRequestSchema');
        expect(row!.responseSchema).toBe('CloneFlowResponseSchema');
    });

    it('each declared member reaches the door as sent, and an undeclared one is refused on its key', async () => {
        expect(Object.keys(CloneFlowRequestSchema.shape).sort()).toEqual(['label', 'name', 'package']);
        const rig = await boot();

        const sent = { name: 'ext_sent', label: 'Sent as is', package: EXT.id };
        expect(CloneFlowRequestSchema.safeParse(sent).success).toBe(true);
        const landed = await rig.clone(SOURCE, sent);
        expect(landed.status, JSON.stringify(landed.body)).toBe(200);
        expect(landed.data.flow).toMatchObject({ name: sent.name, label: sent.label });
        expect(landed.data.packageId).toBe(sent.package);

        const undeclared = { name: 'ext_status', label: 'Chooses its status', status: 'active' };
        expect(CloneFlowRequestSchema.safeParse(undeclared).success).toBe(false);
        const refused = await rig.clone(SOURCE, undeclared);
        expect(refused.status).toBe(400);
        expect(refused.body.error.fields).toMatchObject([{ field: 'status', code: 'unknown_field' }]);
        expect(await rig.rows('ext_status')).toEqual([]);
    }, 60_000);
});

describe('[cloud#3814 D1] declared replicas on the Redis driver: a clone that would create the pair is refused', () => {
    const ENV = ['OS_CLUSTER_REPLICAS', 'OS_EXPECT_MULTI_NODE'] as const;
    const prior: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
    beforeEach(() => { for (const k of ENV) { prior[k] = process.env[k]; delete process.env[k]; } });
    afterEach(() => {
        for (const k of ENV) {
            if (prior[k] === undefined) delete process.env[k];
            else process.env[k] = prior[k];
        }
    });

    for (const [label, key, value] of [['OS_CLUSTER_REPLICAS=3', 'OS_CLUSTER_REPLICAS', '3'], ['OS_EXPECT_MULTI_NODE=true', 'OS_EXPECT_MULTI_NODE', 'true']] as const) {
        it(`${label}: the default landing needs a pair this replica lacks — 409 ${MULTI_REPLICA_PACKAGE_CHANGE_REFUSED}, no package, no row, no registered copy`, async () => {
            const rig = await boot({ clusterDriver: 'redis' });
            process.env[key] = value;

            const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

            expect(answer.status, JSON.stringify(answer.body)).toBe(409);
            expect(answer.code).toBe(MULTI_REPLICA_PACKAGE_CHANGE_REFUSED);
            expect(String(answer.body?.error?.message)).toContain(`'${PAIR}'`);
            expect(String(answer.body?.error?.message)).toContain('restart every replica');
            expect(rig.installed()).not.toContain(PAIR);
            expect(rig.published).toEqual([]);
            expect(await rig.rows('acme_lead_followup')).toEqual([]);
            // The engine accepted the copy before the landing was asked; the
            // refused landing withdrew it (the door's own undo).
            expect(rig.flows.has('acme_lead_followup')).toBe(false);
        }, 60_000);
    }

    it('a pair this replica already serves is reused: 200, the copy lands there and no package is created', async () => {
        const rig = await boot({ clusterDriver: 'redis' });
        const first = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'First copy' });
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        const pairsBefore = rig.published.length;
        process.env.OS_CLUSTER_REPLICAS = '3';

        const second = await rig.clone(SOURCE, { name: 'acme_lead_followup_two', label: 'Second copy' });

        expect(second.status, JSON.stringify(second.body)).toBe(200);
        expect(second.data.packageId).toBe(PAIR);
        expect(rig.published.length).toBe(pairsBefore);
        expect((await rig.rows('acme_lead_followup_two')).map((r) => r.package_id)).toEqual([PAIR]);
    }, 60_000);

    it('an explicit writable target creates no package and is not refused', async () => {
        const rig = await boot({ clusterDriver: 'redis' });
        process.env.OS_CLUSTER_REPLICAS = '3';

        const answer = await rig.clone(SOURCE, { name: 'ext_lead_followup', label: 'Lead follow-up (ext)', package: EXT.id });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(EXT.id);
        expect(rig.installed()).not.toContain(PAIR);
    }, 60_000);

    for (const [label, env, driver] of [
        ['a single node on redis', {}, 'redis'],
        ['declared replicas on the in-process driver', { OS_CLUSTER_REPLICAS: '3' }, 'memory'],
    ] as const) {
        it(`CONTROL — ${label}: the default landing ensures the pair, as before`, async () => {
            const rig = await boot({ clusterDriver: driver });
            Object.assign(process.env, env);

            const answer = await rig.clone(SOURCE, { name: 'acme_lead_followup', label: 'Lead follow-up (ACME)' });

            expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            expect(answer.data.packageId).toBe(PAIR);
            expect(rig.installed()).toContain(PAIR);
        }, 60_000);
    }
});

describe('[cloud#3814 D1] declared replicas on the Redis driver: the pair probed is the App\'s pair (pairOf), as the ensure derives it', () => {
    const prior = process.env.OS_CLUSTER_REPLICAS;
    afterEach(() => {
        if (prior === undefined) delete process.env.OS_CLUSTER_REPLICAS;
        else process.env.OS_CLUSTER_REPLICAS = prior;
    });

    it('precondition — the ensure door pairs the member with its App\'s pair, not a per-member one', async () => {
        const rig = await boot({ clusterDriver: 'redis', appMember: true });
        const ensured = await rig.protocol.ensureCustomizationPackage({ basePackageId: SUITE_MEMBER.id });
        expect(ensured.packageId).toBe(SUITE_PAIR);
    }, 60_000);

    it('a member of an installed App whose pair is absent: 409 naming the App\'s pair, nothing created', async () => {
        const rig = await boot({ clusterDriver: 'redis', appMember: true });
        process.env.OS_CLUSTER_REPLICAS = '3';

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(answer.code).toBe(MULTI_REPLICA_PACKAGE_CHANGE_REFUSED);
        expect(String(answer.body?.error?.message)).toContain(`'${SUITE_PAIR}'`);
        expect(rig.installed()).not.toContain(SUITE_PAIR);
        expect(rig.published).toEqual([]);
        expect(await rig.rows('acme_suite_route')).toEqual([]);
    }, 60_000);

    it('…refused too while only the member\'s legacy per-package pair is installed: the ensure would still create the App\'s', async () => {
        const rig = await boot({ clusterDriver: 'redis', appMember: true, legacyMemberPair: true });
        process.env.OS_CLUSTER_REPLICAS = '3';

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(answer.code).toBe(MULTI_REPLICA_PACKAGE_CHANGE_REFUSED);
        expect(rig.installed()).not.toContain(SUITE_PAIR);
        expect(rig.published).toEqual([]);
    }, 60_000);

    it('a member whose App\'s pair this replica already serves is not refused: 200 into the App\'s pair, as on a single node, and nothing is created', async () => {
        // The App's pair, ensured on a single node.
        const single = await boot({ clusterDriver: 'redis', appMember: true });
        await single.protocol.ensureCustomizationPackage({ basePackageId: SUITE_MEMBER.id });
        const singleAnswer = await single.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        const rig = await boot({ clusterDriver: 'redis', appMember: true });
        await rig.protocol.ensureCustomizationPackage({ basePackageId: SUITE_MEMBER.id });
        const pairsBefore = rig.published.length;
        process.env.OS_CLUSTER_REPLICAS = '3';

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        // The App's pair is the member's pair, and the target rule reads the
        // save gate's closure, which holds the member: the copy lands, on
        // both topologies.
        expect(singleAnswer.status, JSON.stringify(singleAnswer.body)).toBe(200);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(SUITE_PAIR);
        expect(rig.published.length).toBe(pairsBefore);
        expect(rig.installed().filter((id) => id === SUITE_PAIR)).toHaveLength(1);
    }, 60_000);
});

describe('an App member\'s flow lands in its App\'s pair — the target rule reads the save gate\'s closure', () => {
    it('default landing, single node, no pair yet: 200 into the App\'s pair, created by the ensure, the row bound there', async () => {
        const rig = await boot({ appMember: true });
        expect(rig.installed()).not.toContain(SUITE_PAIR);

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(SUITE_PAIR);
        expect(rig.installed()).toContain(SUITE_PAIR);
        expect((await rig.rows('acme_suite_route')).map((r) => r.package_id)).toEqual([SUITE_PAIR]);
    }, 60_000);

    it('default landing, the App\'s pair already installed: 200 into it, and no package is created', async () => {
        const rig = await boot({ appMember: true });
        await rig.protocol.ensureCustomizationPackage({ basePackageId: SUITE_MEMBER.id });
        const before = rig.installed();

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(SUITE_PAIR);
        expect(rig.installed()).toEqual(before);
    }, 60_000);

    it('default landing while the member\'s legacy per-package pair is installed: the copy lands in the App\'s pair (where the ensure lands it)', async () => {
        const rig = await boot({ appMember: true, legacyMemberPair: true });

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(SUITE_PAIR);
        expect((await rig.rows('acme_suite_route')).map((r) => r.package_id)).toEqual([SUITE_PAIR]);
    }, 60_000);

    it('an explicit `package` naming the App\'s pair lands there', async () => {
        const rig = await boot({ appMember: true });
        await rig.protocol.ensureCustomizationPackage({ basePackageId: SUITE_MEMBER.id });

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)', package: SUITE_PAIR });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(SUITE_PAIR);
        expect((await rig.rows('acme_suite_route')).map((r) => r.package_id)).toEqual([SUITE_PAIR]);
    }, 60_000);

    it('the save gate\'s closure, not only the pair\'s members: a flow of a package a member declares (neither the App nor a member) lands in an explicitly named App pair', async () => {
        const rig = await boot({ appMember: true, memberDep: true });
        await rig.protocol.ensureCustomizationPackage({ basePackageId: SUITE_MEMBER.id });
        // Not that package's own pair: the copy lands there only because it is named.
        expect(rig.protocol.packagedArtifactOwner({ type: 'flow', name: SUITE_DEP_FLOW })).toBe(SUITE_DEP.id);

        const answer = await rig.clone(SUITE_DEP_FLOW, { name: 'acme_region_sync', label: 'Region sync (ACME)', package: SUITE_PAIR });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(SUITE_PAIR);
        expect((await rig.rows('acme_region_sync')).map((r) => r.package_id)).toEqual([SUITE_PAIR]);
    }, 60_000);

    it('CONTROL — an explicit writable package that declares the App but is not the member\'s pair stays refused 409 outside the closure, and nothing is created', async () => {
        const rig = await boot({ appMember: true, suiteExt: true });
        const before = rig.installed();

        const answer = await rig.clone(SUITE_FLOW, { name: 'ext_suite_route', label: 'Suite route (ext)', package: SUITE_EXT.id });

        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(answer.code).toBe('RESOURCE_CONFLICT');
        expect(String(answer.body?.error?.message)).toContain('[new_similar_target_outside_closure]');
        expect(answer.body.error.details?.packageId).toBe(SUITE_EXT.id);
        expect(rig.registerFlow).not.toHaveBeenCalled();
        expect(await rig.rows('ext_suite_route')).toEqual([]);
        expect(rig.installed()).toEqual(before);
    }, 60_000);

    it('judged before created — an installed App pair that dropped its App dependency is refused 409 outside the closure before the ensure is asked, and nothing is created', async () => {
        const rig = await boot({ appMember: true, pairWithoutApp: true });
        const before = rig.installed();
        const ensure = vi.spyOn(rig.protocol, 'ensureCustomizationPackage');

        const answer = await rig.clone(SUITE_FLOW, { name: 'acme_suite_route', label: 'Suite route (ACME)' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(answer.code).toBe('RESOURCE_CONFLICT');
        expect(String(answer.body?.error?.message)).toContain('[new_similar_target_outside_closure]');
        expect(ensure).not.toHaveBeenCalled();
        expect(rig.published).toEqual([]);
        expect(await rig.rows('acme_suite_route')).toEqual([]);
        expect(rig.flows.has('acme_suite_route')).toBe(false);
        expect(rig.installed()).toEqual(before);
    }, 60_000);

    it('CONTROL — a standalone package\'s flow (no App) lands in its own pair, as before', async () => {
        const rig = await boot({ solo: true });

        const answer = await rig.clone(SOLO_FLOW, { name: 'solo_digest_copy', label: 'Digest copy' });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.data.packageId).toBe(`${SOLO.id}.custom`);
        expect((await rig.rows('solo_digest_copy')).map((r) => r.package_id)).toEqual([`${SOLO.id}.custom`]);
    }, 60_000);
});
