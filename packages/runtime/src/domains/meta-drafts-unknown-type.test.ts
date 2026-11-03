// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29180] The dispatcher's `GET /meta/_drafts` twin refuses a `type` that
 * names no metadata type, as `RestServer`'s route does
 * (`packages/rest/src/meta-drafts-unknown-filter.test.ts`) — with the same
 * verdict its own `/meta/:type` list branch asks (`refuseUnknownMetaListType`),
 * so this file pins the drafts answer EQUAL to the list branch's answer for the
 * same name, and `listDrafts` never called. The control: a known type in either
 * spelling reaches `listDrafts` and answers `200` empty.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };

function boot() {
    const protocol = {
        getMetaTypes: vi.fn(async () => ({ types: ['view', 'dashboard', 'object'] })),
        getMetaItems: vi.fn(async () => []),
        listDrafts: vi.fn(async (_r: any) => ({ drafts: [] })),
    };
    const services: Record<string, unknown> = { protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });
    return { dispatcher, protocol };
}

async function get(dispatcher: HttpDispatcher, path: string, query: Record<string, unknown> = {}) {
    const res = await dispatcher.dispatch('GET', path, undefined, query, { request: { headers: {} } } as any);
    return { status: res.response?.status ?? (res.handled ? 200 : 0), body: res.response?.body };
}

describe('[#29180] dispatcher GET /meta/_drafts — a type filter that names no type', () => {
    it.each(['dashbord', 'dashboardes', 'viewes', 'nosuchtype'])(
        '`?type=%s` answers the list branch\'s own 400, and listDrafts is never called',
        async (type) => {
            const { dispatcher, protocol } = boot();
            const drafts = await get(dispatcher, '/meta/_drafts', { type });
            const list = await get(dispatcher, `/meta/${type}`);
            expect(drafts.status).toBe(400);
            expect(drafts.body?.error?.code).toBe('INVALID_REQUEST');
            expect(drafts.body?.error?.message).toContain(`'${type}' is not a metadata type.`);
            expect(drafts.body).toEqual(list.body);
            expect(protocol.listDrafts).not.toHaveBeenCalled();
        },
    );

    it.each(['dashboard', 'dashboards', 'view'])(
        'a known type (`?type=%s`) reaches listDrafts as sent and answers 200 empty',
        async (type) => {
            const { dispatcher, protocol } = boot();
            const answer = await get(dispatcher, '/meta/_drafts', { type });
            expect(answer.status).toBe(200);
            expect(answer.body?.data).toEqual({ drafts: [] });
            expect(protocol.listDrafts).toHaveBeenCalledWith({ packageId: undefined, type });
        },
    );
});
