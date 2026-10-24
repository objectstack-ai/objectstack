// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * `POST /packages/:id/publish-drafts` and its twin `POST
 * /packages/:id/discard-drafts` answer `404 RESOURCE_NOT_FOUND` for a package
 * the registry does not hold — the answer `GET /packages/:id` gives the same id.
 *
 * Both answered `200`: `{ success: false, outcome: 'nothing_to_publish' }` and
 * `{ success: true, discardedCount: 0 }` — the bodies a package that EXISTS and
 * has nothing pending gets, so an SDK or AI caller could not tell "no such
 * package" from "nothing to do". The draft doors now ask the registry lookup
 * their read sibling answers from (`packageIsUnknown`), and the parity cases
 * read both doors side by side so a future divergence fails here.
 *
 * Asked only when the protocol's answer is empty: drafts the protocol holds for
 * an id the registry lacks are still published (the control below), so the
 * change touches exactly the answer that lied.
 */

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const KNOWN = 'com.example.app';
const UNKNOWN = 'com.example.nope';

const NOTHING_TO_PUBLISH = {
    success: false, outcome: 'nothing_to_publish', publishedCount: 0, failedCount: 0,
    published: [], failed: [],
};
const PUBLISHED_ONE = {
    success: true, outcome: 'published', publishedCount: 1, failedCount: 0,
    published: [{ type: 'flow', name: 'nightly_rollup', version: 'sha256:aa11' }], failed: [],
};
const NOTHING_DISCARDED = { success: true, discardedCount: 0, failedCount: 0, discarded: [], failed: [] };

function makeDoor(opts: {
    publishResult?: Record<string, unknown>;
    apps?: Array<Record<string, unknown>>;
} = {}) {
    const publishPackageDrafts = vi.fn().mockImplementation(async () =>
        JSON.parse(JSON.stringify(opts.publishResult ?? NOTHING_TO_PUBLISH)));
    const discardPackageDrafts = vi.fn().mockImplementation(async () => ({ ...NOTHING_DISCARDED }));
    const apps = opts.apps ?? [];
    const getMetaItems = vi.fn().mockImplementation(async () => ({ items: apps.map((a) => ({ ...a })) }));
    const saveMetaItem = vi.fn().mockImplementation(async () => ({ ok: true }));
    const packages = new Map([[KNOWN, { id: KNOWN, manifest: { id: KNOWN, name: 'App', version: '1.0.0' }, enabled: true }]]);
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') {
                return Promise.resolve({ publishPackageDrafts, discardPackageDrafts, getMetaItems, saveMetaItem });
            }
            if (name === 'objectql') {
                return Promise.resolve({
                    insert: vi.fn(), find: vi.fn(), update: vi.fn(),
                    registry: {
                        getAllPackages: vi.fn().mockReturnValue([...packages.values()]),
                        getPackage: vi.fn((id: string) => packages.get(id)),
                    },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject: vi.fn() });
            return null;
        },
        context: { getService: () => null, trigger: vi.fn() },
    };
    const send = (path: string, method: string, body: unknown = {}) =>
        new HttpDispatcher(kernel).handlePackages(path, method, body, {}, PKG_ADMIN());
    return { send, publishPackageDrafts, discardPackageDrafts, saveMetaItem };
}

function answer(result: any) {
    return {
        status: result.response?.status,
        code: result.response?.body?.error?.code,
        message: result.response?.body?.error?.message,
    };
}

describe('the package draft doors answer an unknown package 404, like GET /packages/:id', () => {
    it('publish-drafts: 404 RESOURCE_NOT_FOUND naming the package, never 200 nothing_to_publish', async () => {
        const door = makeDoor();
        const result = await door.send(`/${UNKNOWN}/publish-drafts`, 'POST');

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.success).toBe(false);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(result.response?.body?.error?.message).toContain(UNKNOWN);
    });

    it('discard-drafts: 404 RESOURCE_NOT_FOUND naming the package, never 200 discardedCount 0', async () => {
        const door = makeDoor();
        const result = await door.send(`/${UNKNOWN}/discard-drafts`, 'POST');

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(result.response?.body?.error?.message).toContain(UNKNOWN);
    });

    it('both draft doors give the read sibling\'s answer for the same id — status, code and message', async () => {
        const door = makeDoor();
        const read = answer(await door.send(`/${UNKNOWN}`, 'GET', undefined));
        expect(read).toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });

        expect(answer(await door.send(`/${UNKNOWN}/publish-drafts`, 'POST'))).toEqual(read);
        expect(answer(await door.send(`/${UNKNOWN}/discard-drafts`, 'POST'))).toEqual(read);
    });

    it('control: a package that exists with nothing pending still answers 200 at both doors', async () => {
        const door = makeDoor();

        const published = await door.send(`/${KNOWN}/publish-drafts`, 'POST');
        expect(published.response?.status).toBe(200);
        expect(published.response?.body?.data?.outcome).toBe('nothing_to_publish');

        const discarded = await door.send(`/${KNOWN}/discard-drafts`, 'POST');
        expect(discarded.response?.status).toBe(200);
        expect(discarded.response?.body?.data?.discardedCount).toBe(0);
    });

    it('control: drafts the protocol holds for an id the registry lacks are still published', async () => {
        const door = makeDoor({ publishResult: PUBLISHED_ONE });
        const result = await door.send(`/${UNKNOWN}/publish-drafts`, 'POST');

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.outcome).toBe('published');
    });

    it('control: an unpublished app the door un-hid for that id is reported, not answered 404', async () => {
        const door = makeDoor({ apps: [{ name: 'crm', _unpublished: true }] });
        const result = await door.send(`/${UNKNOWN}/publish-drafts`, 'POST');

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.unhiddenApps).toEqual(['crm']);
        expect(door.saveMetaItem).toHaveBeenCalledTimes(1);
    });
});
