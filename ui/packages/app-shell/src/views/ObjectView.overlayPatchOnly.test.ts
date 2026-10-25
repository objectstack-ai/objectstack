/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5233 — a personalization overlay must not freeze the source view.
 *
 * The console's toolbar write (`persistViewPatch` → `updateViewConfig`) used
 * to send `{ ...baseViewDef, ...patch }`, so an overlay written by a mere
 * column drag copied the view's CURRENT effective `filter` (and `columns`,
 * `label`, `type`, `isDefault` …) into the stored row. The display merge is
 * `{ ...source, ...override }`, so that copy then outranked the source view
 * forever: an admin edits the view's filter and every user who once resized a
 * column keeps the old filter, with nothing reporting it.
 *
 * Ruled by the maintainer on 2026-08-12 (objectstack#7494, comment
 * 5261754173): "`persistViewPatch` 只存 patch,不存 merged base … 这与 per-user
 * 之争无关,是纯粹的存储形状错误."
 *
 * - **read** (PR #5272): an overlay contributes only the keys it owns
 *   (`VIEW_OVERLAY_OWNED_KEYS`), so every base key already frozen into every
 *   stored row stops shadowing the source. That is the issue's third
 *   disposition for existing rows — tolerate on read — chosen deliberately and
 *   pinned rather than assumed, which is the difference the issue draws between
 *   tolerance and SILENT tolerance. It still runs: the rows are at rest.
 * - **write**: the toolbar write stored the patch alone from objectui#5233 on,
 *   and since objectui#12504 there is no toolbar write at all — the sort and
 *   the column layout (objectui#12418), the density and the hidden fields
 *   (objectui#12474) are the user's own list state, and the writer retired
 *   with the adapter method it was the last caller of. The census at the end of
 *   this file pins that absence. Every overlay this file reads is therefore a
 *   row an install already carries, put in the store in the shape the retired
 *   write stored it (`object`, `name` and the `_isOverride` marker stamped on
 *   the body).
 *
 * Read through the REAL adapter read and the REAL consumer merge
 * (`loadViewOverrides` → `buildViewTabs`), not against a hand-written
 * override map: the merge is where a frozen copy would win.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSource } from '@object-ui/types';
import * as dataObjectstack from '@object-ui/data-objectstack';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { buildViewTabs, loadViewOverrides, sanitizeViewOverride } from './ObjectView';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as stripCommentsUntyped } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const stripComments: (source: string) => string = stripCommentsUntyped;

const OBJECT_NAME = 'crm_lead';
const VIEW_ID = 'crm_lead.default';

/** The code-defined view, as the object metadata declares it TODAY. */
const SOURCE_VIEW_AT_WRITE_TIME = {
    name: VIEW_ID,
    label: 'All Leads',
    type: 'grid',
    columns: ['name', 'status'],
    filter: [{ field: 'status', operator: 'equals', value: 'open' }],
    isDefault: true,
};

/** The same view AFTER an admin edits its filter (and its column set). */
const SOURCE_VIEW_AFTER_ADMIN_EDIT = {
    ...SOURCE_VIEW_AT_WRITE_TIME,
    label: 'All Leads (active)',
    columns: ['name', 'status', 'owner'],
    filter: [{ field: 'status', operator: 'equals', value: 'qualified' }],
};

/** A stub metadata store keyed the way `sys_metadata` is: `type` + `name`. */
function makeMetaStore() {
    const rows = new Map<string, any>();
    const meta = {
        getItems: vi.fn(async (type: string) => ({
            type,
            items: [...rows.entries()].filter(([k]) => k.startsWith(`${type}::`)).map(([, v]) => v),
        })),
        getItem: vi.fn(async (type: string, name: string) => {
            const item = rows.get(`${type}::${name}`);
            if (!item) {
                const err: any = new Error(`Not found: ${type}/${name}`);
                err.status = 404;
                throw err;
            }
            return { type, name, item };
        }),
        saveItem: vi.fn(async (type: string, name: string, item: any) => {
            rows.set(`${type}::${name}`, { ...item });
            return { success: true, item: rows.get(`${type}::${name}`) };
        }),
    };
    return { meta, rows };
}

function makeAdapter(meta: any) {
    const ds: any = new ObjectStackAdapter({
        baseUrl: 'http://test.local',
        fetch: vi.fn(async () =>
            new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })),
    });
    ds.connected = true;
    ds.connectionState = 'connected';
    ds.client = { meta };
    return ds;
}

/**
 * Put a personalization overlay in the store the way the retired toolbar write
 * (`updateViewConfig`, objectui#12504) stored one: the body, with `object`,
 * `name` and the `_isOverride` marker stamped on it.
 */
function plantOverlay(rows: Map<string, any>, body: Record<string, unknown>) {
    rows.set(`view::${VIEW_ID}`, { ...body, object: OBJECT_NAME, name: VIEW_ID, _isOverride: true });
}

const fallbackTab = () => ({ id: 'all', label: 'All records', type: 'grid', columns: [] });

/** The tab the switcher renders for `VIEW_ID`, built the way `ObjectView` builds it. */
async function tabAfterAdminEdit(ds: any) {
    const viewOverrides = await loadViewOverrides(ds, OBJECT_NAME, [VIEW_ID]);
    const tabs = buildViewTabs({
        definedViews: { [VIEW_ID]: SOURCE_VIEW_AFTER_ADMIN_EDIT },
        savedViews: [],
        viewOverrides,
        fallbackTab,
    });
    return tabs.find((t) => t.id === VIEW_ID)!;
}

describe('objectui#5233 — a source-view filter change reaches users who have an overlay', () => {
    it('a PRE-FIX fat overlay no longer shadows the source view on read', async () => {
        const { meta, rows } = makeMetaStore();
        const ds = makeAdapter(meta);

        // EXACTLY what the retired toolbar write stored for a column drag on a
        // system view before objectui#5233: the whole active tab, plus the one
        // key the user actually changed, with the marker the write stamped. A
        // row an install has been carrying since then.
        plantOverlay(rows, {
            ...SOURCE_VIEW_AT_WRITE_TIME,
            columnState: { order: ['status', 'name'], widths: { name: 220 } },
        });

        // The row really did capture the source view verbatim — the defect in
        // one assertion, measured at rest rather than assumed.
        const stored = (await ds.listViewOverrides(OBJECT_NAME))[VIEW_ID];
        expect(stored.filter).toEqual(SOURCE_VIEW_AT_WRITE_TIME.filter);

        const tab = await tabAfterAdminEdit(ds);

        // The whole card: the admin's edit reaches this user.
        expect(tab.filter).toEqual(SOURCE_VIEW_AFTER_ADMIN_EDIT.filter);
        // …and so does every other key the overlay had frozen alongside it.
        expect(tab.columns).toEqual(SOURCE_VIEW_AFTER_ADMIN_EDIT.columns);
        expect(tab.label).toBe(SOURCE_VIEW_AFTER_ADMIN_EDIT.label);
    });

    it('the overlay still carries what it was written for', async () => {
        const { meta, rows } = makeMetaStore();
        const ds = makeAdapter(meta);

        plantOverlay(rows, {
            ...SOURCE_VIEW_AT_WRITE_TIME,
            columnState: { order: ['status', 'name'], widths: { name: 220 } },
            sort: [{ field: 'created_at', order: 'desc' }],
            hiddenFields: ['owner'],
            rowHeight: 'compact',
            inlineEdit: true,
        });

        const tab = await tabAfterAdminEdit(ds);

        expect(tab.columnState).toEqual({ order: ['status', 'name'], widths: { name: 220 } });
        expect(tab.sort).toEqual([{ field: 'created_at', order: 'desc' }]);
        expect(tab.hiddenFields).toEqual(['owner']);
        expect(tab.rowHeight).toBe('compact');
        expect(tab.inlineEdit).toBe(true);
        // Narrowing is not amnesia: the personalization survives a reload,
        // which is the whole reason these rows exist.
        expect(tab.filter).toEqual(SOURCE_VIEW_AFTER_ADMIN_EDIT.filter);
    });
});

describe('objectui#5233 — rows written BEFORE this fix (the disposition, pinned)', () => {
    /**
     * The decision this test encodes: existing rows are TOLERATED ON READ, not
     * stripped-on-next-write and not migrated. So a row already carrying the
     * frozen body behaves correctly on the very next page load, without its
     * user having to touch that view again and without an operator running
     * anything.
     *
     * One exception is ruled (objectui#10210, ruling B, comment 5824008636):
     * a row written before the `_isOverride` marker existed carries no
     * marker, and the marker is now the only thing that makes a row an
     * overlay. The shape guess that used to narrow it too is retired — an
     * "Edit view config → Save" wrote the same shape and the guess turned the
     * user's own view read-only. The case that pinned the old narrowing is
     * rewritten below to pin the exposure the ruling accepts, not deleted.
     */
    it('a row stored in the old shape stops shadowing the source on the NEXT READ — no write, no migration', async () => {
        const { meta, rows } = makeMetaStore();
        const ds = makeAdapter(meta);

        // Put the row in the store directly: this is the state of an install
        // that has been running the pre-fix write path, not something this
        // code path just produced.
        rows.set(`view::${VIEW_ID}`, {
            ...SOURCE_VIEW_AT_WRITE_TIME,
            object: OBJECT_NAME,
            viewKind: 'list',
            columnState: { order: ['status', 'name'] },
            _isOverride: true,
        });

        const tab = await tabAfterAdminEdit(ds);

        expect(tab.filter).toEqual(SOURCE_VIEW_AFTER_ADMIN_EDIT.filter);
        expect(tab.columns).toEqual(SOURCE_VIEW_AFTER_ADMIN_EDIT.columns);
        expect(tab.columnState).toEqual({ order: ['status', 'name'] });
        // Nothing was rewritten to achieve that — the row is untouched at rest.
        expect(meta.saveItem).not.toHaveBeenCalled();
    });

    it('a PRE-MARKER legacy row is no longer narrowed: its frozen copy covers the source again (objectui#10210 ruling B, the accepted exposure)', async () => {
        const { meta, rows } = makeMetaStore();
        const ds = makeAdapter(meta);

        // Written before `_isOverride` existed (objectui#4227): flat body, and
        // a `viewKind` only the platform's registry-backed identity heal can
        // have put there. This case used to assert that the retired shape
        // guess narrowed it, so the admin's edit won. Under ruling B the row is
        // a plain row: the ruling names exactly this — an overlay written
        // before the marker and never touched since, whose frozen label,
        // columns and filter copy covers the code definition again.
        rows.set(`view::${VIEW_ID}`, {
            ...SOURCE_VIEW_AT_WRITE_TIME,
            object: OBJECT_NAME,
            viewKind: 'list',
            sort: [{ field: 'created_at', order: 'desc' }],
        });

        const tab = await tabAfterAdminEdit(ds);

        expect(tab.filter).toEqual(SOURCE_VIEW_AT_WRITE_TIME.filter);
        expect(tab.columns).toEqual(SOURCE_VIEW_AT_WRITE_TIME.columns);
        expect(tab.label).toBe(SOURCE_VIEW_AT_WRITE_TIME.label);
        expect(tab.sort).toEqual([{ field: 'created_at', order: 'desc' }]);
    });
});

describe('objectui#5233 — what must NOT be narrowed', () => {
    it("a saved view's OWN body keeps every key its author wrote", async () => {
        // The runtime "Add View" shape (app-shell's `viewEnvelope`): nested
        // `config`, no marker. For this row the body IS the view — narrowing it
        // would delete a user's own view definition on read.
        const savedRow = {
            name: 'crm_lead.my_pipeline',
            object: OBJECT_NAME,
            viewKind: 'list',
            label: 'My Pipeline',
            config: { type: 'kanban', columns: ['name'] },
            filter: [{ field: 'owner', operator: 'equals', value: 'u1' }],
        };
        expect(sanitizeViewOverride(savedRow)).toBe(savedRow);
    });

    it('an explicit-save override still wins over the source filter (#4155 contract)', () => {
        // No marker, no legacy signature → not a personalization overlay. This
        // is the case `ObjectView.overlayFilterRecovery.test.tsx` already pins;
        // restated here because #5233's narrowing runs FIRST and must not eat it.
        const saved = { name: 'wo.mine', filter: [{ field: 'owner', operator: 'equals', value: 'u1' }] };
        expect(sanitizeViewOverride(saved)).toEqual(saved);
    });
});

/**
 * objectui#12504 — THE ABSENCE CENSUS: the toolbar-to-view write family is
 * retired, and none of it comes back.
 *
 * objectui#12474 left `persistViewPatch` with no caller and pinned that here
 * as a reference count. The maintainer's ruling on objectui#12504 (letter A)
 * retired the whole family at once: the in-component writer and its machinery,
 * `DataSource.updateViewConfig` (`@object-ui/types`) and
 * `ObjectStackAdapter.updateViewConfig` (`@object-ui/data-objectstack`) with
 * the capability gate that only that method read. The shared view is written
 * by an explicit save alone. So the census now pins ABSENCE, on all three
 * homes, each with a control that proves the reader is reading the real thing.
 *
 * Read off the code with comments stripped (`scripts/js-comment-mask.mjs`), so
 * the docblocks that tell the history do not count, and a call, a reference
 * handed to a prop and a re-export all do. `DataSource` is pinned twice: off
 * its source (red under `vitest`), and as a type (red under this package's
 * `type-check`, which compiles its tests — a member declared any other way,
 * inherited or as a property, is caught there).
 */
describe('objectui#12504 census — the toolbar-to-view write family is retired', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const objectViewCode = stripComments(readFileSync(path.join(here, 'ObjectView.tsx'), 'utf8'));
    const dataSourceCode = stripComments(
        readFileSync(path.join(here, '..', '..', '..', 'types', 'src', 'data.ts'), 'utf8'),
    );

    /** Every name of the retired family that `ObjectView.tsx` used to define or call. */
    const RETIRED_IN_OBJECT_VIEW = [
        'persistViewPatch',
        'buildPersistedViewBody',
        'toolbarWriteInputs',
        'CONSOLE_MADE_TAB',
        'updateViewConfig',
        'setSystemCapabilities',
        'isViewConfigPermissionDeniedError',
        'viewConfigPermissionDenied',
    ];

    it('ObjectView.tsx defines and reaches none of the family', () => {
        const present = RETIRED_IN_OBJECT_VIEW.filter((name) => new RegExp(`\\b${name}\\b`).test(objectViewCode));
        expect(present, 'a toolbar-to-view writer is back in ObjectView.tsx').toEqual([]);
    });

    it('CONTROL: the explicit save still writes the shared view through `persistRuntimeMetadata`', () => {
        // The reader is reading the real component, and the one write path to
        // the shared view this retirement keeps is still there.
        expect(objectViewCode.length).toBeGreaterThan(10_000);
        expect(objectViewCode).toMatch(/const handleViewConfigSave = useCallback\(/);
        expect(objectViewCode).toMatch(/await persistRuntimeMetadata\('view', vid, buildViewConfigSaveBody\(objectName, draft\)/);
    });

    it('CONTROL: the doors objectui#12474 moved still write the user\'s own list state', () => {
        expect(objectViewCode).toMatch(/onDensityChange:\s*\(mode\)\s*=>\s*\{\s*listPrefs\.patchView\(/);
        expect(objectViewCode).toMatch(/const persistHiddenFields = \(hidden: string\[\]\) => \{[\s\S]{0,120}?listPrefs\.patchView\(viewDef\.id, \{ hiddenFields: hidden \}\)/);
    });

    it('`DataSource` declares no `updateViewConfig` (@object-ui/types)', () => {
        // Vacuous-pass guard: the interface and its surviving view writes are read.
        expect(dataSourceCode).toMatch(/export interface DataSource<T = any> \{/);
        expect(dataSourceCode).toMatch(/\bupdateView\?\(objectName: string, viewName: string/);
        expect(dataSourceCode).not.toMatch(/\bupdateViewConfig\b/);

        // The same fact as a type, red under `type-check`.
        type Absent = 'updateViewConfig' extends keyof DataSource ? false : true;
        const absent: Absent = true;
        expect(absent).toBe(true);
    });

    it('`ObjectStackAdapter` has no `updateViewConfig`, and the package exports none of its gate (@object-ui/data-objectstack)', () => {
        // CONTROL first: the probe reads the real class, which keeps its other view writes.
        expect(typeof ObjectStackAdapter.prototype.updateView).toBe('function');
        expect(typeof ObjectStackAdapter.prototype.createView).toBe('function');
        expect('updateViewConfig' in ObjectStackAdapter.prototype).toBe(false);
        expect('setSystemCapabilities' in ObjectStackAdapter.prototype).toBe(false);

        // The gate only `updateViewConfig` read, exported for its one caller.
        const exported = Object.keys(dataObjectstack);
        expect(exported).toContain('ObjectStackAdapter');
        expect(exported.filter((name) => [
            'ViewConfigPermissionDeniedError',
            'isViewConfigPermissionDeniedError',
            'VIEW_CONFIG_CAPABILITY',
        ].includes(name))).toEqual([]);

        // The same fact as a type, red under `type-check`.
        type Absent = 'updateViewConfig' extends keyof ObjectStackAdapter ? false : true;
        const absent: Absent = true;
        expect(absent).toBe(true);
    });
});
