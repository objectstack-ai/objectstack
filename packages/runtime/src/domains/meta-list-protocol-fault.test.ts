// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20590 position 2 — the dispatcher's `/meta/:type` list answers a protocol
 * FAULT as that fault. It never falls through to the metadata service's raw
 * list, which applies no per-type read-path redaction.
 *
 * ## What the protocol's throw means, measured
 *
 * `ObjectStackProtocolImplementation.getMetaItems` (the one implementation in
 * this repository) answers a type it holds nothing for with `{ items: [] }`:
 * it merges the metadata service's runtime-registered items (agents, tools)
 * into its own answer, so no type is "unknown" to it in a way it signals by
 * throwing. What it throws is a fault or a refusal: the store read failed
 * (`503 SERVICE_UNAVAILABLE`, or a metadata app's marked refusal), a
 * registered redactor threw (fail-closed by design, `redactMetadataItem`), or
 * the segment is an unrecognised spelling of a declared type
 * (`400 INVALID_REQUEST`). The branch used to swallow all of them and serve
 * `metadataService.list(type)` instead — the stored bodies, so a flow's hook
 * secret and a datasource's password went out to a member-level caller on
 * any protocol fault. `RestServer`'s list route has no such fallback and
 * answers the same throw as itself.
 *
 * The fallback itself stays, for the host shape it exists for: a protocol
 * slot with no list verb at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const HOOK_SECRET = 'stored-hook-secret-20590';
const DB_PASSWORD = 'stored-db-password-20590';

const STORED: Record<string, any[]> = {
    flow: [{
        name: 'inbound_hook',
        label: 'Inbound hook',
        type: 'api',
        nodes: [{ id: 'begin', type: 'start', label: 'Start', config: { triggerType: 'api', secret: HOOK_SECRET } }],
        edges: [],
    }],
    datasource: [{ name: 'warehouse', label: 'Warehouse', driver: 'postgres', config: { host: 'db', password: DB_PASSWORD } }],
    agent: [{ name: 'triage_agent', label: 'Triage agent' }],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

/** A member-level caller: authenticated, and nothing else. */
const MEMBER = { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] };

/** The store fault the protocol raises when its `sys_metadata` read fails (`metadataStoreUnavailableError`). */
function storeFault(): Error {
    return Object.assign(new Error('The metadata store could not be read, so whether this item exists is unknown.'), {
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
    });
}

function boot(protocol: Record<string, unknown>) {
    const metadata = { list: vi.fn(async (type: string) => clone(STORED[singular(type)] ?? [])) };
    const services: Record<string, unknown> = {
        protocol,
        metadata,
        security: { resolvePermissionSetNames: async () => [], getMetadataReadableFields: async () => [] },
    };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => clone(MEMBER);
    const list = async (type: string) => {
        const res = await dispatcher.dispatch('GET', `/meta/${type}`, undefined, {}, { request: { headers: {} } } as any);
        return { status: res.response?.status ?? 0, body: res.response?.body };
    };
    return { list, metadata };
}

const text = (v: unknown) => JSON.stringify(v ?? null);

describe('#20590 — a protocol fault on the list read is answered as itself', () => {
    for (const [type, credential] of [['flow', HOOK_SECRET], ['datasource', DB_PASSWORD]] as const) {
        it(`${type}: a store fault answers 503 SERVICE_UNAVAILABLE and never the stored bodies`, async () => {
            const protocol = {
                getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORED) })),
                getMetaItems: vi.fn(async () => { throw storeFault(); }),
            };
            const { list, metadata } = boot(protocol);
            const res = await list(type);
            expect(text(res.body)).not.toContain(credential);
            expect({ status: res.status, code: res.body?.error?.code }).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
            expect(metadata.list).not.toHaveBeenCalled();
        });
    }

    it('a protocol refusal keeps its own status and code (400 INVALID_REQUEST)', async () => {
        const protocol = {
            getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORED) })),
            getMetaItems: vi.fn(async () => {
                throw Object.assign(new Error('not a recognised spelling of a declared metadata type'), { code: 'INVALID_REQUEST', status: 400 });
            }),
        };
        const { list, metadata } = boot(protocol);
        const res = await list('flow');
        expect({ status: res.status, code: res.body?.error?.code }).toEqual({ status: 400, code: 'INVALID_REQUEST' });
        expect(text(res.body)).not.toContain(HOOK_SECRET);
        expect(metadata.list).not.toHaveBeenCalled();
    });

    it('an undeclared throw (a redactor failing closed) is a 500, never the unredacted list', async () => {
        const protocol = {
            getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORED) })),
            getMetaItems: vi.fn(async () => { throw new Error('redactor for flow threw'); }),
        };
        const { list, metadata } = boot(protocol);
        const res = await list('flow');
        expect(res.status).toBe(500);
        expect(text(res.body)).not.toContain(HOOK_SECRET);
        expect(metadata.list).not.toHaveBeenCalled();
    });
});

describe('#20590 — what still reaches the metadata service fallback', () => {
    it('a type the protocol holds nothing for is answered with its empty list — the protocol’s own "unknown" answer', async () => {
        const protocol = {
            getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORED) })),
            getMetaItems: vi.fn(async () => ({ items: [] })),
        };
        const { list, metadata } = boot(protocol);
        const res = await list('agent');
        expect(res.status).toBe(200);
        expect(res.body?.data?.items ?? res.body?.data).toEqual([]);
        expect(metadata.list).not.toHaveBeenCalled();
    });

    it('a protocol slot with no list verb still lists the metadata service’s runtime-registered items', async () => {
        const protocol = { getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORED) })) };
        const { list, metadata } = boot(protocol);
        const res = await list('agent');
        expect(res.status).toBe(200);
        expect(metadata.list).toHaveBeenCalledWith('agent');
        expect(text(res.body)).toContain('triage_agent');
    });
});
