// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20679, ADR-0126 §2] Write-door parity on a PACKAGED flow: `PUT` and
 * `DELETE /automation/:name` refuse the same packaged artifact the metadata
 * door refuses — the public checklist item
 * `access-security.packaged-flow-write-door-parity`, clauses 2 and 3 — and so
 * does `POST /automation` onto its name, which would otherwise overwrite it.
 *
 * ## What this pins, at door level
 *
 * ADR-0126 §2 puts a packaged flow in Regime C: "the packaged base is locked —
 * in-place edit refused loudly at the write door". `PUT /meta/flow/:name`
 * refused a flow a code package ships; the two `/automation` definition doors
 * went straight to the engine behind the `manage_metadata` authoring gate
 * alone. The fix ASKS the metadata protocol's own verdict
 * (`packagedBaseRefusal`, the predicate and emitter `saveMetaItem` /
 * `deleteMetaItem` use) before the engine is called.
 *
 * ## Why the harness is REAL where it matters
 *
 * Every "is this locked?" answer below comes from a real
 * `ObjectStackProtocolImplementation` over a real `SchemaRegistry`, with the
 * packaged flow registered the way an artifact loader registers it (a package
 * id, which `applyProtection` stamps). A protocol DOUBLE would pin only that
 * this domain calls a method — it could not show that the two doors agree,
 * which is the whole claim. The automation service is a spy, because the point
 * of every refusal is that the engine was never entered: "change first, refuse
 * second" would satisfy a status-only assertion and still be the defect.
 *
 * `HttpDispatcher.handleAutomation` is the handler the dispatcher plugin mounts
 * for `PUT` / `DELETE ${prefix}/automation/:name` (`dispatcher-plugin.ts`), so
 * this drives the live route body; what it does not drive is the Hono glue in
 * front of it, which carries no logic for these two routes.
 *
 * ## Both topologies
 *
 * The `/meta` door refuses a packaged flow on a host-config kernel
 * (`environmentId` undefined — the showcase's shape) at the repository, and on
 * an environment kernel in the protocol itself. The verdict asked here is
 * topology-independent, so each refusal case runs on both.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

/** A flow a code package ships — registered with a package id, as an artifact loader does. */
const PACKAGED = 'pkg_alert_flow';
const PACKAGE_ID = 'com.example.pkg';
/** The customer's own flow — lives in the engine only (authored through `POST /automation`). */
const CUSTOMER = 'customer_flow';
/** A runtime-authored registry item with no package provenance. */
const RUNTIME_ROW = 'runtime_row_flow';
/** A tenant-authored item bound to a package — `_provenance: 'org'`, never an artifact. */
const TENANT_BOUND = 'tenant_bound_flow';

const definitionOf = (name: string, label = 'Original') =>
    ({ name, label, type: 'autolaunched', nodes: [], edges: [] });

/** An author holding the capability the doors demand, so every refusal below is the LOCK. */
const AUTHOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);

type Topology = { label: string; environmentId: string | undefined };
const TOPOLOGIES: Topology[] = [
    { label: 'host-config kernel (no environmentId)', environmentId: undefined },
    { label: 'environment kernel', environmentId: 'env_1' },
];

function makeRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.registerItem('flow', definitionOf(PACKAGED), 'name', PACKAGE_ID);
    registry.registerItem('flow', definitionOf(RUNTIME_ROW), 'name');
    registry.registerItem('flow', { ...definitionOf(TENANT_BOUND), _provenance: 'org' }, 'name', 'app.customer');
    return registry;
}

interface Harness {
    dispatcher: HttpDispatcher;
    protocol: ObjectStackProtocolImplementation;
    registerFlow: ReturnType<typeof vi.fn>;
    unregisterFlow: ReturnType<typeof vi.fn>;
    toggleFlow: ReturnType<typeof vi.fn>;
    /** The definition the ENGINE holds — read from the store, never a response. */
    held: (name: string) => unknown;
    /**
     * [#20862] Stand in the store behind the protocol's save and delete. The
     * definition doors now save through this protocol (and the removal door
     * deletes through it), and this harness's engine has no store; what the
     * store does is pinned in `automation-authoring-doors-durable.test.ts`, so
     * a case that reaches it here stands it in, as the clone case below does.
     */
    standInStore: () => void;
}

/**
 * @param protocol `'real'` (default), `'absent'` (a composition with no metadata
 *        protocol), or `'broken'` (the slot is wired and its resolution FAILS).
 */
function boot(
    { environmentId, protocol: mode = 'real' }: { environmentId?: string; protocol?: 'real' | 'absent' | 'broken' } = {},
): Harness {
    const flows = new Map<string, unknown>(
        [PACKAGED, CUSTOMER, RUNTIME_ROW, TENANT_BOUND].map((n) => [n, definitionOf(n)]),
    );
    const registerFlow = vi.fn((name: string, definition: unknown) => {
        flows.set(name, definition);
        return definition;
    });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const toggleFlow = vi.fn(async () => undefined);
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);

    // [#20761] `findOne` answers the one store read the authoring rule makes —
    // "is a stored row of this name bound to the package a body's stamp
    // names?" — with "no row", the state of a deployment whose customer flows
    // live in the engine only.
    const protocol = new ObjectStackProtocolImplementation(
        { registry: makeRegistry(), findOne: async () => null } as never,
        () => new Map(),
        environmentId,
    );

    const services: Record<string, unknown> = {
        automation: { handlerReady: true, registerFlow, unregisterFlow, toggleFlow, getFlow },
    };
    if (mode === 'real') services.protocol = protocol;
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => {
            if (name === 'protocol' && mode === 'broken') throw new Error('protocol factory failed');
            return resolve(name);
        },
        context: { getService: resolve },
    };

    return {
        dispatcher: new HttpDispatcher(kernel as never),
        protocol,
        registerFlow, unregisterFlow, toggleFlow,
        held: (name: string) => flows.get(name),
        standInStore: () => {
            vi.spyOn(protocol, 'saveMetaItem').mockResolvedValue({ success: true } as never);
            vi.spyOn(protocol, 'deleteMetaItem').mockResolvedValue({ success: true } as never);
        },
    };
}

const statusOf = (response: any): unknown => response?.status;
const errorOf = (response: any): { code?: unknown; message?: unknown } => response?.body?.error ?? {};

afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
});

describe('a PACKAGED flow — the base is locked at both /automation definition doors', () => {
    for (const topology of TOPOLOGIES) {
        describe(topology.label, () => {
            it('PUT /automation/:name answers 403 NOT_OVERRIDABLE and registers nothing', async () => {
                const h = boot({ environmentId: topology.environmentId });
                const before = h.held(PACKAGED);

                const { response } = await h.dispatcher.handleAutomation(
                    `/${PACKAGED}`, 'PUT', definitionOf(PACKAGED, 'Changed in place'), AUTHOR(), undefined,
                );

                expect(statusOf(response)).toBe(403);
                expect(errorOf(response).code).toBe('NOT_OVERRIDABLE');
                // Refuse first, mutate never: the engine was not entered, and
                // the live definition is the one that was there before.
                expect(h.registerFlow).not.toHaveBeenCalled();
                expect(h.held(PACKAGED)).toBe(before);

                const read = await h.dispatcher.handleAutomation(`/${PACKAGED}`, 'GET', undefined, AUTHOR(), undefined);
                expect(statusOf(read.response)).toBe(200);
                expect((read.response as any).body.data.label).toBe('Original');
            });

            it('DELETE /automation/:name answers 403 NOT_OVERRIDABLE and the flow still serves', async () => {
                const h = boot({ environmentId: topology.environmentId });

                const { response } = await h.dispatcher.handleAutomation(
                    `/${PACKAGED}`, 'DELETE', undefined, AUTHOR(), undefined,
                );

                expect(statusOf(response)).toBe(403);
                expect(errorOf(response).code).toBe('NOT_OVERRIDABLE');
                expect(h.unregisterFlow).not.toHaveBeenCalled();

                const read = await h.dispatcher.handleAutomation(`/${PACKAGED}`, 'GET', undefined, AUTHOR(), undefined);
                expect(statusOf(read.response)).toBe(200);
            });
        });
    }

    it('ONE emitter: each door answers exactly the refusal the metadata door raises for the same artifact', async () => {
        // On an environment kernel `saveMetaItem` / `deleteMetaItem` refuse in
        // the protocol itself, before any store is touched — so the metadata
        // door's own refusal can be compared with this door's answer directly.
        // Same code, same status, same SENTENCE: one verdict, relayed, not a
        // second refusal that agrees today.
        const h = boot({ environmentId: 'env_1' });

        const save = await h.protocol
            .saveMetaItem({ type: 'flow', name: PACKAGED, item: definitionOf(PACKAGED, 'Changed in place') })
            .then(() => undefined, (e: any) => e);
        const put = await h.dispatcher.handleAutomation(
            `/${PACKAGED}`, 'PUT', definitionOf(PACKAGED, 'Changed in place'), AUTHOR(), undefined,
        );
        expect(save).toBeDefined();
        expect({ code: save.code, status: save.status, message: save.message }).toEqual({
            code: errorOf(put.response).code,
            status: statusOf(put.response),
            message: errorOf(put.response).message,
        });

        const del = await h.protocol
            .deleteMetaItem({ type: 'flow', name: PACKAGED })
            .then(() => undefined, (e: any) => e);
        const remove = await h.dispatcher.handleAutomation(`/${PACKAGED}`, 'DELETE', undefined, AUTHOR(), undefined);
        expect(del).toBeDefined();
        expect({ code: del.code, status: del.status, message: del.message }).toEqual({
            code: errorOf(remove.response).code,
            status: statusOf(remove.response),
            message: errorOf(remove.response).message,
        });
    });

    it('POST / onto a packaged flow\'s name — a create that would overwrite — is refused as a locked base; a new name is created', async () => {
        const h = boot();
        const before = h.held(PACKAGED);

        const overwrite = await h.dispatcher.handleAutomation(
            '', 'POST', definitionOf(PACKAGED, 'Overwritten via create'), AUTHOR(), undefined,
        );
        expect(statusOf(overwrite.response)).toBe(403);
        expect(errorOf(overwrite.response).code).toBe('NOT_OVERRIDABLE');
        expect(h.registerFlow).not.toHaveBeenCalled();
        expect(h.held(PACKAGED)).toBe(before);

        // Control: a name no code package ships is created exactly as before.
        h.standInStore();
        const created = await h.dispatcher.handleAutomation(
            '', 'POST', definitionOf('brand_new_flow', 'New'), AUTHOR(), undefined,
        );
        expect(statusOf(created.response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledWith('brand_new_flow', expect.objectContaining({ label: 'New' }));
    });

    it('keys on the NAME the artifact loader registered — provenance stamps in the request body decide nothing', async () => {
        // The verdict is asked with `{ type, name, operation }` only: whether a
        // code package ships the name is read from the registry's loader-made
        // entry, never from what the caller sends. So a body claiming tenant
        // provenance cannot walk a packaged flow past the lock…
        const h = boot({ environmentId: 'env_1' });
        const disguised = await h.dispatcher.handleAutomation(
            `/${PACKAGED}`, 'PUT',
            { ...definitionOf(PACKAGED, 'Disguised'), _provenance: 'org', _packageId: 'sys_metadata' },
            AUTHOR(), undefined,
        );
        expect(statusOf(disguised.response)).toBe(403);
        expect(errorOf(disguised.response).code).toBe('NOT_OVERRIDABLE');
        expect(h.registerFlow).not.toHaveBeenCalled();

        // …and a body claiming a package cannot lock the customer's own flow.
        // [#20761] Nor is it written with that claim: every flow written
        // through an authoring door is tenant-authored, so the claim is
        // refused loudly and the engine is never entered — the one authoring
        // rule, pinned in `automation-tenant-authored-write.test.ts`.
        const claimed = await h.dispatcher.handleAutomation(
            `/${CUSTOMER}`, 'PUT',
            { ...definitionOf(CUSTOMER, 'Claimed'), _packageId: PACKAGE_ID, _provenance: 'package' },
            AUTHOR(), undefined,
        );
        expect(statusOf(claimed.response)).toBe(422);
        expect(errorOf(claimed.response).code).toBe('INVALID_METADATA');
        expect(h.registerFlow).not.toHaveBeenCalled();
        expect(h.held(CUSTOMER)).toEqual(definitionOf(CUSTOMER));
    });

    it('the envelope check still answers first — a body that is not a definition is VALIDATION_FAILED, as on /meta', async () => {
        // `/meta` refuses a null item before its lock; this door's twin is the
        // "expected a flow definition object" check, and it keeps its place.
        const h = boot();
        await expect(
            h.dispatcher.handleAutomation(`/${PACKAGED}`, 'PUT', ['not', 'a', 'definition'], AUTHOR(), undefined),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(h.registerFlow).not.toHaveBeenCalled();
    });
});

describe('what the lock leaves open', () => {
    it('the customer\'s own flow (no code package ships it) is updated and removed as before', async () => {
        const h = boot();
        h.standInStore();

        const put = await h.dispatcher.handleAutomation(
            `/${CUSTOMER}`, 'PUT', definitionOf(CUSTOMER, 'Edited'), AUTHOR(), undefined,
        );
        expect(statusOf(put.response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledWith(CUSTOMER, expect.objectContaining({ label: 'Edited' }));

        const del = await h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'DELETE', undefined, AUTHOR(), undefined);
        expect(statusOf(del.response)).toBe(200);
        expect(h.unregisterFlow).toHaveBeenCalledWith(CUSTOMER);
    });

    it('a registry item with no package provenance, and a tenant-authored one bound to a package, are not locked', async () => {
        const h = boot({ environmentId: 'env_1' });
        h.standInStore();
        for (const name of [RUNTIME_ROW, TENANT_BOUND]) {
            const put = await h.dispatcher.handleAutomation(
                `/${name}`, 'PUT', definitionOf(name, 'Edited'), AUTHOR(), undefined,
            );
            expect(statusOf(put.response), name).toBe(200);
        }
        expect(h.registerFlow).toHaveBeenCalledTimes(2);
    });

    it('POST /:name/clone — the sanctioned customization path (ADR-0126 §7.1) — still authors a sibling', async () => {
        const h = boot();
        // [#20761] The clone is also SAVED as a tenant row, through the
        // protocol's own save — pinned in
        // `automation-tenant-authored-write.test.ts`; stood in for here, where
        // the store is not this file's subject.
        vi.spyOn(h.protocol, 'saveMetaItem').mockResolvedValue({ success: true } as never);
        const { response } = await h.dispatcher.handleAutomation(
            `/${PACKAGED}/clone`, 'POST', { name: 'my_alert_copy', label: 'My Alert' }, AUTHOR(), undefined,
        );
        expect(statusOf(response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledWith('my_alert_copy', expect.objectContaining({ name: 'my_alert_copy' }));
        expect(h.held(PACKAGED)).toEqual(definitionOf(PACKAGED));
    });

    it('POST /:name/toggle — the activation switch, not a definition write — is not this lock', async () => {
        const h = boot();
        const { response } = await h.dispatcher.handleAutomation(
            `/${PACKAGED}/toggle`, 'POST', { enabled: false }, AUTHOR(), undefined,
        );
        expect(statusOf(response)).toBe(200);
        expect(h.toggleFlow).toHaveBeenCalledWith(PACKAGED, false);
    });

    it('the operator hatch the refusal names (OS_METADATA_WRITABLE) opens this door exactly as it opens /meta', async () => {
        // The refusal prescribes the hatch, so the prescription must be TRUE at
        // this door: the verdict reads the same `isOverlayAllowed` the metadata
        // door reads, hatch included — never a copy that forgets it.
        process.env.OS_METADATA_WRITABLE = 'flow';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const h = boot();
        h.standInStore();

        const { response } = await h.dispatcher.handleAutomation(
            `/${PACKAGED}`, 'PUT', definitionOf(PACKAGED, 'Operator edit'), AUTHOR(), undefined,
        );
        expect(statusOf(response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledTimes(1);
    });
});

describe('composition edges', () => {
    it('no metadata protocol in the composition: nothing to be at parity with, behaviour unchanged', async () => {
        const h = boot({ protocol: 'absent' });
        const { response } = await h.dispatcher.handleAutomation(
            `/${PACKAGED}`, 'PUT', definitionOf(PACKAGED, 'Edited'), AUTHOR(), undefined,
        );
        expect(statusOf(response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledTimes(1);
    });

    it('a protocol slot that is wired and fails to resolve does NOT fail open — nothing is written', async () => {
        const h = boot({ protocol: 'broken' });
        await expect(
            h.dispatcher.handleAutomation(`/${PACKAGED}`, 'PUT', definitionOf(PACKAGED, 'Edited'), AUTHOR(), undefined),
        ).rejects.toThrow('protocol factory failed');
        await expect(
            h.dispatcher.handleAutomation(`/${PACKAGED}`, 'DELETE', undefined, AUTHOR(), undefined),
        ).rejects.toThrow('protocol factory failed');
        expect(h.registerFlow).not.toHaveBeenCalled();
        expect(h.unregisterFlow).not.toHaveBeenCalled();
    });
});
