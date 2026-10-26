// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25783] The dispatcher's `/meta/app` judges each object nav entry on the
 * protocol's EXECUTION list face, as `RestServer`'s does.
 *
 * The nav-servability gate reads every object's `enable` to prune the entries
 * whose object refuses `list` (#24031). It read them through the SERVED list,
 * `getMetaItems`, which stamps `_diagnostics` on every object — a full schema
 * parse per object per `/meta/app` read, 63 of 73 ms CPU over 108 objects.
 * `metaItemReadGateSources.listMetaItems` now asks `getMetaItemsForExecution`
 * for `object` where the protocol has it (the same list, undecorated), and the
 * served list otherwise, as `RestServer.metaListSource` does.
 *
 * Rows, through `dispatch()` (the `${prefix}/*` catch-all's delegate):
 *  1. the app list and the app by name prune the unlistable entry and keep the
 *     listable one, reading `object` on the execution face and never on the
 *     served one;
 *  2. FALLBACK — a protocol with no execution list face is asked
 *     `getMetaItems`, with the same prune.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const LISTED = { name: 'listed_widget', label: 'Listed Widget', enable: { apiMethods: ['get', 'list'] } };
/** Refuses `list` (405 for every user): its nav entry is pruned. */
const UNLISTED = { name: 'unlisted_widget', label: 'Unlisted Widget', enable: { apiMethods: ['get'] } };
const APP = {
    name: 'widgets',
    label: 'Widgets',
    navigation: [
        { id: 'nav_listed', type: 'object', label: 'Listed', objectName: LISTED.name },
        { id: 'nav_unlisted', type: 'object', label: 'Unlisted', objectName: UNLISTED.name },
    ],
};
const STORE: Record<string, any[]> = { app: [APP], object: [LISTED, UNLISTED] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

function protocolDouble(opts: { executionFace: boolean }) {
    const list = async ({ type }: any) => clone(STORE[singular(type)] ?? []);
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(list),
        ...(opts.executionFace ? { getMetaItemsForExecution: vi.fn(list) } : {}),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = (STORE[singular(type)] ?? []).find((i) => i.name === name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
    };
}

function bootDispatcher(opts: { executionFace: boolean }) {
    const protocol = protocolDouble(opts);
    const services: Record<string, unknown> = {
        protocol,
        security: { resolvePermissionSetNames: async () => [], getMetadataReadableFields: async () => [] },
    };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ userId: 'u_member', isSystem: false, systemPermissions: [] });
    const read = async (path: string) => {
        const res = await dispatcher.dispatch('GET', path, undefined, {}, { request: { headers: {} } } as any);
        return { status: res.response?.status ?? 0, body: res.response?.body };
    };
    return { read, protocol };
}

const navIds = (app: any): string[] => (app?.navigation ?? []).map((e: any) => e.id);
const listedApp = (body: any): any => {
    const data = body?.data;
    const items = Array.isArray(data) ? data : data?.items;
    return (items ?? []).find((a: any) => a?.name === APP.name);
};
const askedForObject = (spy: ReturnType<typeof vi.fn>): boolean =>
    spy.mock.calls.some(([req]: any[]) => singular(req?.type) === 'object');

describe('[#25783] the dispatcher judges /meta/app object nav entries on the execution list face', () => {
    it('the app LIST: the unlistable entry pruned, `object` read on the execution face, never the served one', async () => {
        const { read, protocol } = bootDispatcher({ executionFace: true });
        const out = await read('/meta/app');
        expect(out.status, JSON.stringify(out.body)).toBe(200);
        expect(navIds(listedApp(out.body))).toEqual(['nav_listed']);
        expect(askedForObject(protocol.getMetaItemsForExecution!)).toBe(true);
        expect(askedForObject(protocol.getMetaItems)).toBe(false);
    });

    it('the app BY NAME: the same prune, `object` read on the execution face, never the served one', async () => {
        const { read, protocol } = bootDispatcher({ executionFace: true });
        const out = await read(`/meta/app/${APP.name}`);
        expect(out.status, JSON.stringify(out.body)).toBe(200);
        expect(navIds(out.body?.data?.item)).toEqual(['nav_listed']);
        expect(askedForObject(protocol.getMetaItemsForExecution!)).toBe(true);
        expect(askedForObject(protocol.getMetaItems)).toBe(false);
    });

    it('FALLBACK: a protocol with no execution list face is asked `getMetaItems` — the same prune', async () => {
        const { read, protocol } = bootDispatcher({ executionFace: false });
        const out = await read('/meta/app');
        expect(out.status, JSON.stringify(out.body)).toBe(200);
        expect(navIds(listedApp(out.body))).toEqual(['nav_listed']);
        expect(askedForObject(protocol.getMetaItems)).toBe(true);
    });
});
