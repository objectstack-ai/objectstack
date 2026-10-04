// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20761, ADR-0126 §2 / §7.1, ADR-0131 D6] The `/automation` definition-write
 * doors apply the ONE authoring rule — the metadata protocol's
 * `tenantAuthoredWriteRefusal`, the function `/meta`'s flow write asks too — and
 * the clone door saves its copy as a tenant row.
 *
 * ## What this pins, at door level
 *
 *  - `POST /` and `PUT /:name` refuse a definition claiming a package's
 *    provenance for a name no package ships, relaying the rule's envelope, and
 *    the engine is never entered;
 *  - a round trip of a SHIPPED flow is refused as a locked base;
 *  - a customer flow's own round trip — no stamps, tenant provenance, the
 *    stored-row sentinel — is accepted unchanged;
 *  - `POST /:name/clone` asks the same rule of the copy, registers it, and saves
 *    it through the protocol's own save as a tenant row: no provenance on the
 *    saved body, env-wide; a save that fails withdraws the registration and
 *    relays the failure, so no clone is reported that would not survive.
 *
 * Harness as in `automation-packaged-base-lock.test.ts`: a REAL protocol over a
 * REAL `SchemaRegistry` answers every verdict, with the packaged flow
 * registered the way an artifact loader registers it; the automation service
 * is a spy, because every refusal's point is that the engine was never entered.
 * The store behind the protocol's save is not this file's subject — the
 * showcase pin (`flow-provenance-server-held.dogfood.test.ts`) reads the saved
 * row back over HTTP and across a cold boot — so the save is spied here.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { isCodeArtifactBody } from '@objectstack/metadata-core';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const PACKAGED = 'pkg_alert_flow';
const PACKAGE_ID = 'com.example.pkg';
const CUSTOMER = 'customer_flow';

/** The stamps a caller would send to claim the real package's provenance. */
const ASSERTED = { _packageId: PACKAGE_ID, _provenance: 'package' };

const definitionOf = (name: string, label = 'Original') =>
    ({ name, label, type: 'autolaunched', nodes: [], edges: [] });

const AUTHOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);

function boot() {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    // As an artifact loader registers it: under a package id, which
    // `applyProtection` stamps.
    registry.registerItem('flow', definitionOf(PACKAGED), 'name', PACKAGE_ID);

    const flows = new Map<string, unknown>([
        [PACKAGED, { ...definitionOf(PACKAGED), ...ASSERTED }],
        [CUSTOMER, definitionOf(CUSTOMER)],
    ]);
    const registerFlow = vi.fn((name: string, definition: unknown) => {
        flows.set(name, definition);
        return definition;
    });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);

    const protocol = new ObjectStackProtocolImplementation(
        { registry, findOne: async () => null } as never,
        () => new Map(),
        undefined,
    );
    const saveMetaItem = vi.spyOn(protocol, 'saveMetaItem').mockResolvedValue({ success: true } as never);
    const rule = vi.spyOn(protocol, 'tenantAuthoredWriteRefusal');

    const services: Record<string, unknown> = {
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow },
        protocol,
    };
    const resolve = (name: string): unknown => services[name];
    const kernel = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };

    return {
        dispatcher: new HttpDispatcher(kernel as never),
        registerFlow, unregisterFlow, saveMetaItem, rule,
        held: (name: string) => flows.get(name),
    };
}

const statusOf = (response: any): unknown => response?.status;
const errorOf = (response: any): { code?: unknown } => response?.body?.error ?? {};
const dataOf = (response: any): any => response?.body?.data;

describe('[#20761] the /automation definition-write doors apply the one authoring rule', () => {
    it('POST / refuses a definition claiming a package for a name no package ships, and registers nothing', async () => {
        const h = boot();
        const { response } = await h.dispatcher.handleAutomation(
            '', 'POST', { ...definitionOf('new_flow'), ...ASSERTED }, AUTHOR(), undefined,
        );

        expect(statusOf(response)).toBe(422);
        expect(errorOf(response).code).toBe('INVALID_METADATA');
        expect(h.registerFlow).not.toHaveBeenCalled();
        expect(h.held('new_flow')).toBeUndefined();
        expect(h.rule).toHaveBeenCalledWith(expect.objectContaining({ type: 'flow', name: 'new_flow' }));
    });

    it('PUT /:name refuses the same claim on a customer flow, and the engine still holds its definition', async () => {
        const h = boot();
        const { response } = await h.dispatcher.handleAutomation(
            `/${CUSTOMER}`, 'PUT', { ...definitionOf(CUSTOMER, 'Claimed'), ...ASSERTED }, AUTHOR(), undefined,
        );

        expect(statusOf(response)).toBe(422);
        expect(errorOf(response).code).toBe('INVALID_METADATA');
        expect(h.registerFlow).not.toHaveBeenCalled();
        expect(h.held(CUSTOMER)).toEqual(definitionOf(CUSTOMER));
    });

    it('a round trip of a shipped flow is refused as a locked base, on both definition doors', async () => {
        const h = boot();
        const served = h.held(PACKAGED) as Record<string, unknown>;
        for (const [path, method] of [[`/${PACKAGED}`, 'PUT'], ['', 'POST']] as const) {
            const { response } = await h.dispatcher.handleAutomation(path, method, served, AUTHOR(), undefined);
            expect(statusOf(response), `${method} ${path}`).toBe(403);
            expect(errorOf(response).code).toBe('NOT_OVERRIDABLE');
        }
        expect(h.registerFlow).not.toHaveBeenCalled();
    });

    it('a customer flow\'s own round trip is accepted unchanged — no stamps, tenant provenance, or the stored-row sentinel', async () => {
        for (const stamps of [{}, { _packageId: 'app.customer', _provenance: 'org' }, { _packageId: 'sys_metadata' }]) {
            const h = boot();
            const body = { ...definitionOf(CUSTOMER, 'Echoed'), ...stamps };
            const { response } = await h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'PUT', body, AUTHOR(), undefined);

            expect(statusOf(response), JSON.stringify(stamps)).toBe(200);
            expect(h.registerFlow).toHaveBeenCalledWith(CUSTOMER, body);
        }
    });
});

describe('[#20761, ADR-0126 §7.1] the clone door saves its copy as a tenant row', () => {
    it('a clone of a shipped flow is registered AND saved through the protocol, env-wide, with no provenance', async () => {
        const h = boot();
        const { response } = await h.dispatcher.handleAutomation(
            `/${PACKAGED}/clone`, 'POST', { name: 'my_alert_copy', label: 'My Alert' }, AUTHOR(), undefined,
        );

        expect(statusOf(response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledWith('my_alert_copy', expect.objectContaining({ name: 'my_alert_copy' }));
        expect(h.saveMetaItem).toHaveBeenCalledTimes(1);
        const saved = h.saveMetaItem.mock.calls[0]![0] as { type: string; name: string; item: Record<string, unknown>; organizationId?: unknown; packageId?: unknown };
        expect(saved).toMatchObject({ type: 'flow', name: 'my_alert_copy' });
        expect(saved.organizationId).toBeUndefined();
        expect(saved.packageId).toBeUndefined();
        expect(isCodeArtifactBody(saved.item)).toBe(false);
        expect(Object.keys(saved.item).filter((k) => k === '_packageId' || k === '_provenance')).toEqual([]);
        // The copy was judged by the one rule, and admitted.
        expect(h.rule).toHaveBeenCalledWith(expect.objectContaining({ type: 'flow', name: 'my_alert_copy' }));
        expect(dataOf(response)?.flow?.name).toBe('my_alert_copy');
    });

    it('a save that fails withdraws the registration and relays the failure — no clone is reported that would not survive', async () => {
        const h = boot();
        h.saveMetaItem.mockRejectedValueOnce(Object.assign(new Error('refused by the store'), { code: 'NOT_OVERRIDABLE', status: 403 }));

        const { response } = await h.dispatcher.handleAutomation(
            `/${PACKAGED}/clone`, 'POST', { name: 'my_alert_copy', label: 'My Alert' }, AUTHOR(), undefined,
        );

        expect(statusOf(response)).toBe(403);
        expect(errorOf(response).code).toBe('NOT_OVERRIDABLE');
        expect(h.unregisterFlow).toHaveBeenCalledWith('my_alert_copy');
        expect(h.held('my_alert_copy')).toBeUndefined();
    });
});
