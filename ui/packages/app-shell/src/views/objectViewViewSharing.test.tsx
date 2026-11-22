// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36371 — who may share a list's views, and the three acts that
 * share or unshare one (`./objectViewViewSharing.ts`).
 *
 * WHAT IS PINNED.
 *  - Who: an administrator whose session holds `manage_metadata`; an
 *    administrator without it (an organization administrator) is not offered
 *    a control the server refuses.
 *  - Create, shared: saved and published in one act, never left as a draft.
 *  - Make shared: the reader's row becomes a published view under a key no
 *    served view holds, then the row is deleted and the pin follows it.
 *  - Unshare: the view becomes one of the reader's own, then is deleted; a
 *    delete the server refuses takes the copy back.
 *  - Which shared views may be unshared: one saved here, never a view the
 *    object authors, a read-only package ships or a package's customization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { freeViewKey, isUnsharableView, mayShareViews, useViewSharing } from './objectViewViewSharing';
import type { PersonalView } from './personalViews';

const t = ((key: string, options?: { defaultValue?: string; name?: string }) =>
    (options?.defaultValue ?? key).replace('{{name}}', options?.name ?? '')) as never;

const OBJECT = 'crm_lead';
const OBJECT_DEF = { name: OBJECT, fields: { name: { type: 'text' } } };

function rig(over: { personal?: PersonalView[]; savedViews?: unknown[]; deleteView?: (...a: unknown[]) => Promise<unknown>; pinned?: string | null; activeViewId?: string } = {}) {
    const metadataClient = {
        save: vi.fn(async () => ({})),
        publish: vi.fn(async () => ({})),
        reset: vi.fn(async () => ({})),
    };
    const dataSource = { deleteView: vi.fn(over.deleteView ?? (async () => ({ deleted: true }))) };
    const personalViews = {
        views: over.personal ?? [],
        save: vi.fn(async () => 'pv_copy'),
        remove: vi.fn(async () => {}),
    };
    const navigate = vi.fn();
    const setPinnedViewId = vi.fn();
    const refresh = vi.fn();
    const confirmHandler = vi.fn(async () => true);
    const viewIds = ['all', `${OBJECT}.team`, ...(over.personal ?? []).map((v) => v.id)];
    const { result } = renderHook(() => useViewSharing({
        objectName: OBJECT,
        objectDef: OBJECT_DEF,
        metadataClient,
        dataSource,
        app: { packageId: null },
        personalViews,
        savedViews: over.savedViews ?? [],
        viewIds,
        labelOf: (id) => (id === `${OBJECT}.team` ? 'Team' : id),
        activeViewId: over.activeViewId,
        routeViewId: undefined,
        navigate,
        pinnedViewId: over.pinned ?? null,
        setPinnedViewId,
        refresh,
        confirmHandler: confirmHandler as never,
        t,
    }));
    return { result, metadataClient, dataSource, personalViews, navigate, setPinnedViewId, refresh, confirmHandler };
}

beforeEach(() => {
    for (const fn of Object.values(toast)) fn.mockClear();
});

describe('objectstack#36371 — who may share views', () => {
    it('an administrator holding manage_metadata; neither half alone', () => {
        expect(mayShareViews(true, true)).toBe(true);
        expect(mayShareViews(true, false)).toBe(false); // an organization administrator
        expect(mayShareViews(false, true)).toBe(false);
        expect(mayShareViews(false, false)).toBe(false);
    });
});

describe('objectstack#36371 — which shared views may be unshared', () => {
    it('a saved, published view of the list, and no other', () => {
        expect(isUnsharableView({}, { name: 'team' } as never)).toBe(true);
        expect(isUnsharableView({ readonly: true }, undefined)).toBe(false); // authored by the object
        expect(isUnsharableView({}, undefined)).toBe(false); // not a saved view
        expect(isUnsharableView({ definitionReadonly: true }, {})).toBe(false); // a read-only package ships it
        expect(isUnsharableView({ customized: true }, {})).toBe(false); // a package view's customization
        expect(isUnsharableView({}, { _draft: true })).toBe(false); // an unpublished draft
    });
});

describe('objectstack#36371 — the key a view made shared is saved under', () => {
    it('the key its name gives, numbered past every served view', () => {
        expect(freeViewKey(OBJECT, 'Team', 'grid', ['all'])).toBe('team');
        expect(freeViewKey(OBJECT, 'Team', 'grid', [`${OBJECT}.team`])).toBe('team_2');
        expect(freeViewKey(OBJECT, 'Team', 'grid', ['team', `${OBJECT}.team_2`])).toBe('team_3');
    });
});

describe('objectstack#36371 — Create, shared', () => {
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
        expect(options).toEqual({ mode: 'draft', ifNoneMatch: '*' });
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
});

describe('objectstack#36371 — Make shared', () => {
    const MINE: PersonalView = { id: 'pv_1', label: 'Team', config: { type: 'kanban', columns: ['name'], kanban: { groupByField: 'name' } } };

    it('publishes the row\'s body as a new view under a free key, then deletes the row and moves the pin', async () => {
        const r = rig({ personal: [MINE], pinned: 'pv_1', activeViewId: 'pv_1' });
        await act(async () => { await r.result.current.makeShared('pv_1'); });
        expect(r.confirmHandler).toHaveBeenCalledTimes(1);
        const [, name, body] = r.metadataClient.save.mock.calls[0] as unknown as [string, string, Record<string, any>];
        // `team` is served already, so the next free key.
        expect(name).toBe(`${OBJECT}.team_2`);
        expect(body).toMatchObject({ name: `${OBJECT}.team_2`, label: 'Team', config: { type: 'kanban', kanban: { groupByField: 'name' }, data: { object: OBJECT } } });
        expect(r.metadataClient.publish).toHaveBeenCalledWith('view', `${OBJECT}.team_2`);
        expect(r.personalViews.remove).toHaveBeenCalledWith('pv_1');
        expect(r.setPinnedViewId).toHaveBeenCalledWith(`${OBJECT}.team_2`);
        expect(r.navigate).toHaveBeenCalledWith(`view/${OBJECT}.team_2`);
        expect(toast.success).toHaveBeenCalled();
    });

    it('a declined confirm writes nothing', async () => {
        const r = rig({ personal: [MINE] });
        r.confirmHandler.mockResolvedValueOnce(false);
        await act(async () => { await r.result.current.makeShared('pv_1'); });
        expect(r.metadataClient.save).not.toHaveBeenCalled();
        expect(r.personalViews.remove).not.toHaveBeenCalled();
    });

    it('a refused publish keeps the reader\'s row: nothing changed', async () => {
        const r = rig({ personal: [MINE] });
        r.metadataClient.publish.mockRejectedValueOnce(new Error('refused'));
        await act(async () => { await r.result.current.makeShared('pv_1'); });
        expect(r.personalViews.remove).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });
});

describe('objectstack#36371 — Unshare', () => {
    const SAVED = { id: `${OBJECT}.team`, name: `${OBJECT}.team`, label: 'Team', type: 'grid', columns: ['name'], filter: [['name', '=', 'x']] };

    it('copies the view into the reader\'s own views, then deletes the shared view and opens the copy', async () => {
        const r = rig({ savedViews: [SAVED], pinned: `${OBJECT}.team`, activeViewId: `${OBJECT}.team` });
        await act(async () => { await r.result.current.unshare(`${OBJECT}.team`); });
        expect(r.personalViews.save).toHaveBeenCalledTimes(1);
        const [label, config] = r.personalViews.save.mock.calls[0] as unknown as [string, Record<string, any>];
        expect(label).toBe('Team');
        expect(config).toMatchObject({ type: 'grid', columns: ['name'], filter: [['name', '=', 'x']], data: { object: OBJECT } });
        expect(r.dataSource.deleteView).toHaveBeenCalledWith(OBJECT, `${OBJECT}.team`);
        expect(r.personalViews.remove).not.toHaveBeenCalled();
        expect(r.setPinnedViewId).toHaveBeenCalledWith('pv_copy');
        expect(r.navigate).toHaveBeenCalledWith('view/pv_copy');
    });

    it('a delete the server refuses takes the copy back, and says so', async () => {
        const r = rig({ savedViews: [SAVED], deleteView: async () => { throw new Error('Deleting metadata requires the `manage_metadata` capability.'); } });
        await act(async () => { await r.result.current.unshare(`${OBJECT}.team`); });
        expect(r.personalViews.remove).toHaveBeenCalledWith('pv_copy');
        expect(r.refresh).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });

    it('a delete that answers deleted: false is a refusal too', async () => {
        const r = rig({ savedViews: [SAVED], deleteView: async () => ({ deleted: false }) });
        await act(async () => { await r.result.current.unshare(`${OBJECT}.team`); });
        expect(r.personalViews.remove).toHaveBeenCalledWith('pv_copy');
        expect(r.navigate).not.toHaveBeenCalled();
    });

    it('a view that is not a saved view of the list is left alone', async () => {
        const r = rig({ savedViews: [] });
        await act(async () => { await r.result.current.unshare('all'); });
        expect(r.confirmHandler).not.toHaveBeenCalled();
        expect(r.personalViews.save).not.toHaveBeenCalled();
        expect(r.dataSource.deleteView).not.toHaveBeenCalled();
    });
});
