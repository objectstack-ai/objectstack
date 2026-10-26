/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10210 — saving a code-defined view's config must not turn it into a
 * read-only "system view".
 *
 * "Edit view config → Save" used to persist the FLAT runtime tab. On a
 * code-defined (registry-backed) view the platform's write door inherits
 * `viewKind: 'list'` from the registry entry the row shadows
 * (`viewIdentityPatch`, `@objectstack/metadata-protocol`), and a flat row that
 * carries `viewKind` is the shape the adapter's legacy-overlay net reads as a
 * personalization overlay — so `listViews()` dropped the row, the tab lost its
 * saved-view status (`readonly: !saved`) and publishing made it permanent.
 *
 * The save now persists a ViewItem envelope ({@link buildViewConfigSaveBody}).
 * Pinned here, round trip through the REAL adapter read, against a store that
 * behaves like the platform's write door in the two ways this defect depends
 * on — it inherits identity from the registry entry, and it refuses a body the
 * spec's `view` schema refuses:
 *
 * - the body is spec-valid and keeps the row key (the save lands on the row it
 *   always landed on and never forks a second view);
 * - a re-read still classifies the view as a saved view, and a never-saved
 *   sibling — the card's control — is unaffected;
 * - a pending draft resumed into the panel and saved again lands on the same
 *   row in the same shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { buildViewConfigSaveBody } from './ObjectView';
import { isSavedViewId, viewRowId } from '../utils/viewIdentity';
import {
    inspectorDraftToRuntimeView,
    runtimeViewToInspectorDraft,
    storedViewToRuntimeView,
} from './view-config-adapter';

const OBJECT_NAME = 'crm_lead';
const VIEW_ID = 'crm_lead.all';
const CONTROL_ID = 'crm_lead.open';

/** The registry entries the two code-defined views are served as, untouched. */
const REGISTRY: Record<string, Record<string, unknown>> = {
    [VIEW_ID]: {
        name: VIEW_ID,
        object: OBJECT_NAME,
        viewKind: 'list',
        label: 'Everything',
        config: {
            label: 'Everything',
            type: 'grid',
            data: { provider: 'object', object: OBJECT_NAME },
            columns: [{ field: 'name' }],
        },
    },
    [CONTROL_ID]: {
        name: CONTROL_ID,
        object: OBJECT_NAME,
        viewKind: 'list',
        label: 'Open',
        config: {
            label: 'Open',
            type: 'grid',
            data: { provider: 'object', object: OBJECT_NAME },
            columns: [{ field: 'name' }, { field: 'status' }],
        },
    },
};

/**
 * The draft the panel hands `handleViewConfigSave` after the label is edited —
 * the request body captured from a live run against a `@objectstack` 17.4.0
 * backend, before this fix.
 */
const PANEL_DRAFT = {
    label: 'Everything EDITED',
    type: 'grid',
    columns: [{ field: 'name' }],
    name: VIEW_ID,
    isDefault: false,
    id: VIEW_ID,
};

/**
 * The same draft when the tab it was built from had absorbed a stored row: the
 * tab spreads the served document (`config`, registry bookkeeping, read
 * decorations) and, when a toolbar overlay was merged in, its marker and
 * `columnState`. None of that is view body.
 */
const TAB_LADEN_DRAFT = {
    ...PANEL_DRAFT,
    object: OBJECT_NAME,
    viewKind: 'list',
    objectName: OBJECT_NAME,
    config: REGISTRY[VIEW_ID].config,
    order: 0,
    scope: 'package',
    _packageId: 'com.example.crm',
    _provenance: 'package',
    _diagnostics: { valid: true },
    _draft: true,
    _isOverride: true,
    rowHeight: 'short',
    columnState: { widths: { name: 180 } },
    isPinned: true,
    sortOrder: 2,
};

/**
 * A `sys_metadata`-shaped store standing in for the platform's `view` write
 * door: identity inherited from the registry entry the row shadows, then the
 * spec's own `view` schema as the gate (a refused body is a 422, not a row).
 */
function makePlatformStore() {
    const rows = new Map<string, any>(Object.entries(REGISTRY).map(([k, v]) => [k, { ...v }]));
    const meta = {
        getItems: vi.fn(async () => ({ type: 'view', items: [...rows.values()] })),
        getItem: vi.fn(async (_type: string, name: string) => ({ type: 'view', name, item: rows.get(name) })),
        saveItem: vi.fn(async (_type: string, name: string, item: any) => {
            const baseline = REGISTRY[name];
            const stored = { ...item };
            for (const key of ['viewKind', 'object', 'label'] as const) {
                if (stored[key] === undefined && baseline?.[key] !== undefined) stored[key] = baseline[key];
            }
            const verdict = ViewMetadataSchema.safeParse(stored);
            if (!verdict.success) {
                throw Object.assign(new Error('INVALID_METADATA'), { status: 422, issues: verdict.error.issues });
            }
            rows.set(name, stored);
            return { success: true, item: stored };
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
 * `savedViews` exactly as `ObjectView` normalizes the adapter's rows
 * (objectui#11013 dropped the `objectName` stamp that normalization carried).
 */
async function readSavedViews(ds: any) {
    const rows: any[] = await ds.listViews(OBJECT_NAME);
    return rows.map((sv) => ({ ...sv, id: viewRowId(sv) }));
}

describe('objectui#10210 — the view-config save persists a ViewItem envelope', () => {
    it('the saved body is spec-valid and addressed to the row it was saved from', () => {
        for (const draft of [PANEL_DRAFT, TAB_LADEN_DRAFT]) {
            const body = buildViewConfigSaveBody(OBJECT_NAME, draft);
            const verdict = ViewMetadataSchema.safeParse(body);
            expect(verdict.success, JSON.stringify(verdict.error?.issues)).toBe(true);
            expect(body.name).toBe(draft.id);
            expect(body).toMatchObject({ object: OBJECT_NAME, viewKind: 'list', label: 'Everything EDITED' });
            expect(body.config).toMatchObject({ type: 'grid', columns: [{ field: 'name' }] });
        }
    });

    it('a tab-laden draft keeps its row state and sheds the overlay marker', () => {
        const body: Record<string, any> = buildViewConfigSaveBody(OBJECT_NAME, TAB_LADEN_DRAFT);
        expect(body).toMatchObject({
            isDefault: false,
            isPinned: true,
            sortOrder: 2,
            columnState: { widths: { name: 180 } },
        });
        expect(body.config.rowHeight).toBe('short');
        expect(body._isOverride).toBeUndefined();
        expect(body.config._isOverride).toBeUndefined();
        expect(body.config.config).toBeUndefined();
    });

    it('a re-read still classifies the view as a saved view; the never-saved sibling is unaffected', async () => {
        const { meta, rows } = makePlatformStore();
        const ds = makeAdapter(meta);

        const before = await readSavedViews(ds);
        expect(isSavedViewId(before, VIEW_ID)).toBe(true);
        expect(isSavedViewId(before, CONTROL_ID)).toBe(true);

        // The draft's publish lands the same body on the row — whole-document.
        await meta.saveItem('view', VIEW_ID, buildViewConfigSaveBody(OBJECT_NAME, PANEL_DRAFT));
        expect(rows.get(VIEW_ID).viewKind).toBe('list');

        const after = await readSavedViews(ds);
        // `readonly: !saved` — the six-entry tab menu stays.
        expect(isSavedViewId(after, VIEW_ID)).toBe(true);
        expect(after.find((sv) => sv.id === VIEW_ID)?.label).toBe('Everything EDITED');
        // The card's control: a sibling whose view was never saved.
        expect(isSavedViewId(after, CONTROL_ID)).toBe(true);
    });

    it('a resumed draft saved again lands on the same row in the same shape', () => {
        const stored = buildViewConfigSaveBody(OBJECT_NAME, PANEL_DRAFT);
        // What the panel does with a pending draft on reopen, then on Save.
        const resumed = runtimeViewToInspectorDraft(storedViewToRuntimeView(stored), OBJECT_NAME);
        const savedAgain = buildViewConfigSaveBody(OBJECT_NAME, inspectorDraftToRuntimeView(resumed));
        expect(savedAgain).toEqual(stored);
    });
});
