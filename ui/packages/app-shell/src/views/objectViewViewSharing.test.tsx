// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36409 — who may create a shared view from a list's view
 * dropdown, and the act that creates one (`./objectViewViewSharing.ts`).
 *
 * WHAT IS PINNED.
 *  - Who: an administrator whose session holds `manage_metadata`; an
 *    administrator without it (an organization administrator) is not offered
 *    a Shared choice the server refuses.
 *  - Create, shared: saved and published in one act, never left as a draft; a
 *    refused save publishes nothing, and a name a pending draft holds is said
 *    (`shareNameTaken`).
 *  - objectstack#38149: outside an app the create asks for its package and
 *    saves there; a cancelled ask writes nothing and says nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { mayManageViews, useViewSharing } from './objectViewViewSharing';

const t = ((key: string, options?: { defaultValue?: string; name?: string }) =>
    (options?.defaultValue ?? key).replace('{{name}}', options?.name ?? '')) as never;

const OBJECT = 'crm_lead';
const OBJECT_DEF = { name: OBJECT, fields: { name: { type: 'text' } } };

/** The package the create ask answers (objectstack#38149): no app here, so it asks. */
let askAnswer: string | null = 'app.chosen';

function rig() {
    const metadataClient = {
        save: vi.fn(async () => ({})),
        publish: vi.fn(async () => ({})),
        reset: vi.fn(async () => ({})),
    };
    const navigate = vi.fn();
    const refresh = vi.fn();
    const { result } = renderHook(() => useViewSharing({
        objectName: OBJECT,
        objectDef: OBJECT_DEF,
        metadataClient,
        dataSource: {},
        app: { packageId: null, askPackage: async () => askAnswer },
        routeViewId: undefined,
        navigate,
        refresh,
        t,
    }));
    return { result, metadataClient, navigate, refresh };
}

beforeEach(() => {
    askAnswer = 'app.chosen';
    for (const fn of Object.values(toast)) fn.mockClear();
});

describe('objectstack#36409 — who may share views', () => {
    it('an administrator holding manage_metadata; neither half alone', () => {
        expect(mayManageViews(true, true)).toBe(true);
        expect(mayManageViews(true, false)).toBe(false); // an organization administrator
        expect(mayManageViews(false, true)).toBe(false);
        expect(mayManageViews(false, false)).toBe(false);
    });
});

describe('objectstack#36409 — Create, shared', () => {
    it('saves and publishes the new view in one act, and opens it', async () => {
        const r = rig();
        let created = false;
        await act(async () => {
            created = await r.result.current.createShared({ type: 'grid', label: 'Hot leads', name: 'hot_leads', columns: ['name'] });
        });
        expect(created).toBe(true);
        expect(r.metadataClient.save).toHaveBeenCalledTimes(1);
        const [type, name, , options] = r.metadataClient.save.mock.calls[0] as unknown as [string, string, unknown, Record<string, unknown>];
        expect([type, name]).toEqual(['view', `${OBJECT}.hot_leads`]);
        expect(options).toEqual({ mode: 'draft', packageId: 'app.chosen', ifNoneMatch: '*' });
        expect(r.metadataClient.publish).toHaveBeenCalledWith('view', `${OBJECT}.hot_leads`);
        expect(r.navigate).toHaveBeenCalledWith(`view/${OBJECT}.hot_leads`);
    });

    it('a refused save is said and reported unsaved; nothing is published', async () => {
        const r = rig();
        r.metadataClient.save.mockRejectedValueOnce(Object.assign(new Error('Saving metadata requires the `manage_metadata` capability.'), { status: 403 }));
        let created = true;
        await act(async () => {
            created = await r.result.current.createShared({ type: 'grid', label: 'Hot leads', name: 'hot_leads' });
        });
        expect(created).toBe(false);
        expect(r.metadataClient.publish).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });

    it('a name an unpublished draft already holds: told so, reported unsaved, nothing published', async () => {
        const r = rig();
        r.metadataClient.save.mockRejectedValueOnce(Object.assign(new Error('pending'), { status: 409, code: 'METADATA_CONFLICT' }));
        let created = true;
        await act(async () => {
            created = await r.result.current.createShared({ type: 'grid', label: 'Hot leads', name: 'hot_leads' });
        });
        expect(created).toBe(false);
        expect(r.metadataClient.publish).not.toHaveBeenCalled();
        expect(r.refresh).not.toHaveBeenCalled();
        expect(r.navigate).not.toHaveBeenCalled();
        const [, options] = toast.error.mock.calls[0] as unknown as [string, { description: string }];
        expect(options.description).toContain('An unpublished draft already uses this view’s name');
    });

    it('objectstack#38149: a cancelled package ask writes nothing, says nothing, and reports unsaved', async () => {
        askAnswer = null;
        const r = rig();
        let created = true;
        await act(async () => {
            created = await r.result.current.createShared({ type: 'grid', label: 'Hot leads', name: 'hot_leads' });
        });
        expect(created).toBe(false);
        expect(r.metadataClient.save).not.toHaveBeenCalled();
        expect(r.metadataClient.publish).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        expect(r.navigate).not.toHaveBeenCalled();
    });
});
