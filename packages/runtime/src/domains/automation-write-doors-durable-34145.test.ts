// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3; seat ruling 6884403301, amendment 7; seat ruling 6911640332,
 * M1 = B] The `/automation` write doors ask a DURABLE question of a flow
 * name. For a name ONE package holds they read it over every holder (the
 * engine's engine-local `getHeldFlow`), not on the served read (`getFlow`),
 * whose answer moves with that package's enable state. A name two packages
 * hold is read on its served holder, as on `main`:
 *
 *  - the clone door's taken-name probe on the copy's new name;
 *  - the definition writes' put-back copy, after a write the engine accepted
 *    is refused (here: the store's save refuses);
 *  - the carried-forward credential of `PUT /:name` (`keepStoredFlowCredentials`);
 *  - the `DELETE /:name` existence probe.
 *
 * The flow under test is one a single package holds while that package is
 * disabled and the engine still holds its slot (the disable's re-sync did not
 * run, or failed). For it the engine's served read answers `null` (pinned in
 * service-automation's `flow-slots-per-package.test.ts`, `[#33905]`), and its
 * read over every holder answers the body. The automation service here
 * answers both reads as the engine does for such a flow.
 *
 * A name two packages hold is modelled in the engine's measured states
 * (service-automation's `flow-slots-per-package.test.ts`, `[#33893]`): the
 * read over every holder refuses it `409` in each. `kept`, the disabled
 * co-holder's slot still held: the served read serves the enabled holder and
 * a package-less registration is refused. `withdrawn`, that slot withdrawn by
 * the disable's re-sync: the served read and a package-less registration both
 * reach the enabled holder's slot. `served`, both holders enabled: every bare
 * read refuses it.
 *
 * CONTROLs: an enabled holder answers as before at all four doors; a name the
 * engine does not hold is still admitted by the clone door and answered `404`
 * by `DELETE`; the bare served doors of such a flow still answer `404`
 * (`automation-addressed-route.test.ts`, `[#33905]`); a service without the
 * engine-local read is asked its `getFlow`.
 *
 * Driven through the real `HttpDispatcher`. The protocol double carries no
 * locked-base or authoring verdict, so the doors' earlier guards admit each
 * request (a composition whose metadata door leaves the `flow` type writable).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The dispatcher's reach loads this dependency in a function body; paid here,
// at collection, not inside the first case's clocked window.
import '@objectstack/metadata';
import { ObjectKernel, PackageScopedNameRefusedError, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { registerMetadataTypeRedactor } from '@objectstack/spec/kernel';

import { HttpDispatcher } from '../http-dispatcher.js';

const SOLO = 'solo';
const SHARED = 'shared_flow';
const SOURCE = 'source_flow';
const BASE_PACKAGE = 'crm';
const PAIR_PACKAGE = 'crm.custom';
const ADMIN = { userId: 'u_admin', systemPermissions: ['manage_metadata'] };

const withSecret = (name: string, secret: string) => ({
    name,
    label: name,
    type: 'api',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'api', secret } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});
/** The same definition as the read serves it: the hook secret withheld (the `flow` redactor's projection). */
const projected = (name: string) => {
    const definition = withSecret(name, 'x') as { nodes: Array<{ config?: Record<string, unknown> }> };
    delete definition.nodes[0].config!.secret;
    return definition;
};

/**
 * The `flow` redactor the automation plugin registers, standing in: the start
 * node's hook `secret` is withheld (`automation-flow-credential-projection.test.ts`'s).
 */
const flowRedactorStandIn = (item: Record<string, unknown>) => {
    const nodes = item.nodes;
    if (!Array.isArray(nodes)) return { item, redactedKeys: [] as string[] };
    const redactedKeys: string[] = [];
    const withheld = nodes.map((node: any, index: number) => {
        if (node?.type !== 'start' || !node.config || !('secret' in node.config)) return node;
        const { secret: _s, ...rest } = node.config;
        void _s;
        redactedKeys.push(`nodes.${index}.config.secret`);
        return { ...node, config: rest };
    });
    return redactedKeys.length === 0 ? { item, redactedKeys } : { item: { ...item, nodes: withheld }, redactedKeys };
};

beforeEach(() => registerMetadataTypeRedactor('flow', flowRedactorStandIn));
// The registry is module-global; leave no identity overlay behind for a later block.
afterEach(() => registerMetadataTypeRedactor('flow', flowRedactorStandIn));

/** The refusal the engine's read over every holder raises for a name two packages hold. */
const sharedRefusal = (name: string) => new PackageScopedNameRefusedError({
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type: 'flow',
    name,
    callerPackageId: null,
    candidates: [{ kind: 'package', packageId: 'com.a.pkg' }, { kind: 'package', packageId: 'com.b.pkg' }],
    message: `Flow '${name}' is held by packages 'com.a.pkg' and 'com.b.pkg'.`,
} as never);

interface Rig {
    /** `disabled`: SOLO's one holder's package is disabled (served read `null`); `enabled`: served. */
    readonly holder: 'disabled' | 'enabled';
    /** Whether the service offers the engine-local read over every holder. */
    readonly heldRead?: boolean;
    /** The store's save refuses (an ADR-0112 envelope the door relays). */
    readonly saveRefuses?: boolean;
    /** The store holds a row for each of these names. */
    readonly stored?: readonly string[];
    /** SHARED's state in the engine (see the file header). */
    readonly shared?: 'kept' | 'withdrawn' | 'served';
    /** Whether the composition has a metadata store (the `protocol` service). */
    readonly store?: boolean;
}

function rig({ holder, heldRead = true, saveRefuses = false, stored = [], shared = 'kept', store = true }: Rig) {
    const flows = new Map<string, unknown>([
        [SOLO, withSecret(SOLO, 'stored-secret')],
        [SOURCE, { name: SOURCE, label: 'Source', type: 'autolaunched', nodes: [], edges: [] }],
        [SHARED, { ...withSecret(SHARED, 'served-secret'), label: 'Shared, the served holder' }],
    ]);
    const servedBy = (name: string) => !(holder === 'disabled' && name === SOLO);
    const automation: Record<string, unknown> = {
        handlerReady: true,
        // The served read: a disabled sole holder's flow is no flow; a name two
        // packages hold, one of them disabled, is its served holder's.
        getFlow: vi.fn(async (name: string) => {
            if (name === SHARED && shared === 'served') throw sharedRefusal(name);
            return servedBy(name) ? flows.get(name) ?? null : null;
        }),
        registerFlow: vi.fn((name: string, definition: unknown) => {
            if (name === SHARED && (shared === 'kept' || shared === 'served')) throw sharedRefusal(name);
            flows.set(name, definition);
            return definition;
        }),
        unregisterFlow: vi.fn((name: string) => {
            if (name === SHARED) throw sharedRefusal(name);
            flows.delete(name);
        }),
        execute: vi.fn(async () => ({ success: true, output: {} })),
    };
    if (heldRead) {
        // The read over every holder: the slot's body whatever its package's
        // enable state; a name two packages hold refused, naming every holder.
        automation.getHeldFlow = vi.fn((name: string) => {
            if (name === SHARED) throw sharedRefusal(name);
            return flows.get(name) ?? null;
        });
    }
    const rows = new Set(stored);
    const protocol = {
        packagedArtifactOwner: vi.fn(() => BASE_PACKAGE),
        ensureCustomizationPackage: vi.fn(async ({ basePackageId }: { basePackageId: string }) => ({
            basePackageId, packageId: `${basePackageId}.custom`, namespace: 'crm_custom', dependencyRange: '^3', created: false, writable: true,
        })),
        saveMetaItem: vi.fn(async () => {
            if (saveRefuses) throw Object.assign(new Error('flow failed spec validation'), { code: 'INVALID_METADATA', status: 422 });
            return { success: true };
        }),
        deleteMetaItem: vi.fn(async ({ name }: { name: string }) => {
            if (!rows.has(name)) return { success: true, reset: false };
            rows.delete(name);
            return { success: true, reset: true };
        }),
        getMetaItems: vi.fn(async () => ({ items: [] })),
    };
    const manifests: Record<string, { id: string; dependencies?: Record<string, string> }> = {
        [BASE_PACKAGE]: { id: BASE_PACKAGE },
        [PAIR_PACKAGE]: { id: PAIR_PACKAGE, dependencies: { [BASE_PACKAGE]: '^3' } },
    };
    const objectql = { registry: { getPackage: (id: string) => (manifests[id] ? { manifest: manifests[id] } : undefined) } };
    const services: Record<string, unknown> = store ? { automation, protocol, objectql } : { automation, objectql };
    const resolve = (name: string) => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);
    const call = async (path: string, method: string, body: unknown = {}) => {
        const answered = await dispatcher.handleAutomation(path, method, body, { request: {}, executionContext: ADMIN } as any, {});
        return { status: answered.response?.status ?? 200, body: answered.response?.body as any };
    };
    return { call, automation: automation as Record<string, ReturnType<typeof vi.fn>>, flows, protocol };
}

const codeOf = (a: { body?: any }) => a.body?.error?.code;
const cloneOnto = (target: string) => ['/' + SOURCE + '/clone', 'POST', { name: target, label: 'Copy' }] as const;

describe('[#34145] the clone door judges the new name taken over every holder', () => {
    it('a name whose one holder\'s package is disabled is taken: 409, the door\'s name-taken answer, nothing registered (FROM: admitted)', async () => {
        const disabled = rig({ holder: 'disabled' });
        const enabled = rig({ holder: 'enabled' });
        const viaDisabled = await disabled.call(...cloneOnto(SOLO));
        const viaEnabled = await enabled.call(...cloneOnto(SOLO));
        expect([viaDisabled.status, codeOf(viaDisabled), viaDisabled.body?.error?.message])
            .toEqual([409, codeOf(viaEnabled), viaEnabled.body?.error?.message]);
        expect(viaEnabled.status).toBe(409);
        expect(disabled.automation.registerFlow).not.toHaveBeenCalled();
        expect(disabled.protocol.saveMetaItem).not.toHaveBeenCalled();
        expect(disabled.automation.getHeldFlow).toHaveBeenCalledWith(SOLO);
    });

    it.each(['kept', 'withdrawn', 'served'] as const)('a name two packages hold (co-holder %s) is taken: the door\'s own 409 name-taken answer, returned, nothing registered (FROM, both served: the engine\'s refusal thrown)', async (shared) => {
        const { call, automation } = rig({ holder: 'enabled', shared });
        const taken = await rig({ holder: 'enabled' }).call(...cloneOnto(SOLO));
        const answer = await call(...cloneOnto(SHARED));
        expect([answer.status, codeOf(answer)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(codeOf(answer)).toBe(codeOf(taken));
        expect(answer.body?.error?.message).toMatch(new RegExp(`^Flow '${SHARED}' already exists`));
        expect(automation.registerFlow).not.toHaveBeenCalled();
    });

    it('CONTROL — a name the engine does not hold is admitted as before: the copy is registered and saved', async () => {
        const { call, automation, protocol } = rig({ holder: 'disabled' });
        const answer = await call(...cloneOnto('fresh_copy'));
        expect(answer.status).toBe(200);
        expect(automation.registerFlow).toHaveBeenCalledWith('fresh_copy', expect.objectContaining({ name: 'fresh_copy' }));
        expect(protocol.saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'fresh_copy', packageId: PAIR_PACKAGE }));
    });
});

describe('[#34145] a refused definition write puts back what the engine held over every holder', () => {
    for (const [door, method, path] of [['PUT /:name', 'PUT', '/' + SOLO], ['POST / onto the name', 'POST', '/']] as const) {
        it(`${door}: the held body is registered again (FROM: the name was withdrawn)`, async () => {
            const { call, automation, flows } = rig({ holder: 'disabled', saveRefuses: true });
            const held = flows.get(SOLO);
            const answer = await call(path, method, withSecret(SOLO, 'new-secret'));
            expect(answer.status).toBe(422);
            expect(automation.registerFlow).toHaveBeenLastCalledWith(SOLO, held);
            expect(automation.unregisterFlow).not.toHaveBeenCalled();
            expect(flows.get(SOLO)).toBe(held);
        });
    }

    it('CONTROL — the holder enabled: the held body is put back, as before', async () => {
        const { call, automation, flows } = rig({ holder: 'enabled', saveRefuses: true });
        const held = flows.get(SOLO);
        const answer = await call('/' + SOLO, 'PUT', withSecret(SOLO, 'new-secret'));
        expect(answer.status).toBe(422);
        expect(automation.registerFlow).toHaveBeenLastCalledWith(SOLO, held);
        expect(automation.unregisterFlow).not.toHaveBeenCalled();
    });
});

describe('[#34145] PUT /:name keeps the credential the engine holds over every holder', () => {
    it('a body in the served form keeps the stored secret (FROM: nothing carried forward)', async () => {
        const { call, automation } = rig({ holder: 'disabled' });
        const answer = await call('/' + SOLO, 'PUT', projected(SOLO));
        expect(answer.status).toBe(200);
        const [, registered] = automation.registerFlow.mock.calls[0] as [string, any];
        expect(registered.nodes[0].config.secret).toBe('stored-secret');
    });

    it('CONTROL — the holder enabled: the stored secret is kept, as before; an explicit one replaces it', async () => {
        const kept = rig({ holder: 'enabled' });
        await kept.call('/' + SOLO, 'PUT', projected(SOLO));
        expect((kept.automation.registerFlow.mock.calls[0] as [string, any])[1].nodes[0].config.secret).toBe('stored-secret');
        const replaced = rig({ holder: 'disabled' });
        await replaced.call('/' + SOLO, 'PUT', withSecret(SOLO, 'explicit'));
        expect((replaced.automation.registerFlow.mock.calls[0] as [string, any])[1].nodes[0].config.secret).toBe('explicit');
    });
});

describe('[#34145] DELETE /:name finds a flow the engine holds over every holder', () => {
    it('a flow whose one holder\'s package is disabled, with no stored row, is removed and answered as a deletion (FROM: 404 after removing it)', async () => {
        const { call, automation, flows } = rig({ holder: 'disabled' });
        const answer = await call('/' + SOLO, 'DELETE');
        expect([answer.status, answer.body?.data ?? answer.body]).toEqual([200, expect.objectContaining({ name: SOLO, deleted: true })]);
        expect(automation.unregisterFlow).toHaveBeenCalledWith(SOLO);
        expect(flows.has(SOLO)).toBe(false);
    });

    it('CONTROL — a name two packages hold is refused 409 naming every holder, the refusal the removal raised before; nothing is removed', async () => {
        const { call, protocol } = rig({ holder: 'enabled' });
        await expect(call('/' + SHARED, 'DELETE')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(protocol.deleteMetaItem).not.toHaveBeenCalled();
    });

    it('CONTROL — the holder enabled: removed, 200 deleted, as before', async () => {
        const { call } = rig({ holder: 'enabled' });
        expect((await call('/' + SOLO, 'DELETE')).status).toBe(200);
    });

    it('CONTROL — a name the engine does not hold and the store has no row for is 404, as before; a stored row alone is still deleted', async () => {
        const none = rig({ holder: 'disabled' });
        const unknown = await none.call('/no_such_flow', 'DELETE');
        expect([unknown.status, codeOf(unknown)]).toEqual([404, 'RESOURCE_NOT_FOUND']);
        const rowOnly = rig({ holder: 'disabled', stored: ['row_only'] });
        expect((await rowOnly.call('/row_only', 'DELETE')).status).toBe(200);
    });
});

/**
 * [seat ruling 6911640332, M1 = B] A name two packages hold, one of them
 * disabled, the disabled co-holder's slot withdrawn: the definition writes
 * read it on the served holder, as on `main`. The engine's read over every
 * holder refuses the name; the doors fall back to the served read, so the
 * credential carried forward is the served holder's and a package-less write
 * is admitted into the served holder, with or without a metadata store (the
 * store's address: the booted-kernel describe below).
 */
describe('[#34145] a name two packages hold is read on its served holder at the definition writes', () => {
    const doors = [['PUT /:name', 'PUT', '/' + SHARED], ['POST /', 'POST', '/']] as const;

    it.each(doors)('%s, no metadata store: admitted, 200, registered into the served holder (as on main)', async (_door, method, path) => {
        const { call, automation, flows } = rig({ holder: 'enabled', shared: 'withdrawn', store: false });
        const answer = await call(path, method, withSecret(SHARED, 'new-secret'));
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(automation.registerFlow).toHaveBeenCalledWith(SHARED, expect.objectContaining({ name: SHARED }));
        expect(automation.getHeldFlow).toHaveBeenCalledWith(SHARED);
        expect(automation.getFlow).toHaveBeenCalledWith(SHARED);
        expect((flows.get(SHARED) as any).nodes[0].config.secret).toBe('new-secret');
    });

    it('PUT /:name in the served form keeps the served holder\'s stored secret (as on main)', async () => {
        const { call, automation } = rig({ holder: 'enabled', shared: 'withdrawn', store: false });
        expect((await call('/' + SHARED, 'PUT', projected(SHARED))).status).toBe(200);
        expect((automation.registerFlow.mock.calls[0] as [string, any])[1].nodes[0].config.secret).toBe('served-secret');
    });

    it.each(doors)('CONTROL — %s, both holders enabled: refused 409 RESOURCE_CONFLICT naming every holder, nothing registered, as before', async (_door, method, path) => {
        const { call, automation } = rig({ holder: 'enabled', shared: 'served', store: false });
        await expect(call(path, method, withSecret(SHARED, 'new-secret'))).rejects.toMatchObject({
            code: 'RESOURCE_CONFLICT',
            status: 409,
            refusal: { candidates: [{ kind: 'package', packageId: 'com.a.pkg' }, { kind: 'package', packageId: 'com.b.pkg' }] },
        });
        expect(automation.registerFlow).not.toHaveBeenCalled();
    });
});

/**
 * [seat ruling 6911640332, M1 = B; contract review 6911286488 S1] The same
 * write with a metadata store, through the REAL metadata protocol's save on a
 * booted kernel (`MetadataPlugin`, `ObjectQLPlugin`, `sys_metadata` on
 * SQLite): two authored packages hold the flow as stored rows, the second one
 * disabled. The save naming no package is addressed to the enabled holder's
 * row (`servedPackagelessSaveAddress`, #32605), so the write is admitted
 * there and the disabled holder's row is byte-unchanged, as on `main`. The
 * automation service is the double, answering as the engine does once the
 * disabled co-holder's slot is withdrawn (`[#33893]`): the served read and a
 * package-less registration reach the enabled holder; the read over every
 * holder refuses the name.
 */
describe('[#34145] booted kernel: a package-less write onto a flow name an enabled and a disabled authored package hold is saved into the enabled holder\'s row', () => {
    const ENABLED = 'com.qa.flow_alpha';
    const DISABLED = 'com.qa.flow_beta';
    const NAME = 'shared_t';
    const CALLER = { userId: 'u_34145', tenantId: 'org_qa', isSystem: true, positions: [], permissions: [], systemPermissions: ['manage_metadata'] };
    const body = (label: string) => ({ ...withSecret(NAME, 'x'), label });
    let kernel: ObjectKernel | undefined;
    let engine: ObjectQL;
    let root = '';
    const served = new Map<string, unknown>();
    const automation = {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => served.get(name) ?? null),
        getHeldFlow: vi.fn((name: string) => {
            if (name === NAME) throw sharedRefusal(name);
            return served.get(name) ?? null;
        }),
        registerFlow: vi.fn((name: string, definition: unknown) => { served.set(name, definition); return definition; }),
        unregisterFlow: vi.fn((name: string) => { served.delete(name); }),
        execute: vi.fn(async () => ({ success: true, output: {} })),
    };
    const rows = async (): Promise<Record<string, { label: string; bytes: string }>> => {
        const found = await engine.find('sys_metadata', { where: { type: 'flow', name: NAME, state: 'active' } }, { context: { isSystem: true } });
        return Object.fromEntries(found.map((row) => [String(row.package_id ?? null), {
            label: JSON.parse(String(row.metadata)).label,
            bytes: JSON.stringify([row.metadata, row.version, row.checksum ?? null]),
        }]));
    };
    const write = async (method: 'PUT' | 'POST', label: string) => {
        const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
        const path = method === 'PUT' ? '/' + NAME : '/';
        const answered = await dispatcher.handleAutomation(path, method, body(label), { request: {}, executionContext: { ...CALLER } } as any, {});
        return { status: answered.response?.status ?? 200, body: answered.response?.body as any };
    };

    beforeAll(async () => {
        kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        root = mkdtempSync(join(tmpdir(), 'os-34145-served-flow-save-'));
        engine = new ObjectQL();
        engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        const host: Plugin = {
            name: 'qa.34145-automation-double',
            dependencies: ['com.objectstack.engine.objectql'],
            init: async (ctx: PluginContext) => { ctx.registerService('automation', automation); },
        };
        await kernel.use(host);
        await kernel.bootstrap();
        await engine.syncSchemas();
        for (const id of [ENABLED, DISABLED]) {
            engine.registry.installPackage({ id, name: id, version: '1.0.0', type: 'app' } as any, 'authored');
            await engine.insert('sys_metadata', {
                type: 'flow', name: NAME, namespace: 'default', package_id: id, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
                metadata: JSON.stringify(body(`${id} row`)),
            }, { context: { isSystem: true } } as any);
        }
        served.set(NAME, body(`${ENABLED} row`));
    }, 120_000);

    afterAll(async () => {
        if (kernel?.getState() === 'running') await kernel.shutdown();
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it.each(['PUT', 'POST'] as const)('%s: 200, the enabled holder\'s row carries the edit, the disabled holder\'s row is byte-unchanged (as on main)', async (method) => {
        const before = await rows();
        expect(Object.keys(before).sort()).toEqual([DISABLED, ENABLED].sort());
        engine.registry.disablePackage(DISABLED);
        try {
            const answer = await write(method, `edited by ${method}`);
            expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            const after = await rows();
            expect(Object.keys(after).sort()).toEqual([DISABLED, ENABLED].sort());
            expect(after[ENABLED]?.label).toBe(`edited by ${method}`);
            expect(after[DISABLED]?.bytes).toBe(before[DISABLED]?.bytes);
        } finally {
            engine.registry.enablePackage(DISABLED);
        }
    });
});

describe('[#34145] a service without the engine-local read is asked its getFlow', () => {
    it('CONTROL — the four doors answer on getFlow, as before', async () => {
        const { call, automation } = rig({ holder: 'enabled', heldRead: false });
        expect((await call(...cloneOnto(SOLO))).status).toBe(409);
        expect((await call('/no_such_flow', 'DELETE')).status).toBe(404);
        await call('/' + SOLO, 'PUT', projected(SOLO));
        expect((automation.registerFlow.mock.calls[0] as [string, any])[1].nodes[0].config.secret).toBe('stored-secret');
        expect(automation.getFlow).toHaveBeenCalledWith(SOLO);
    });
});
