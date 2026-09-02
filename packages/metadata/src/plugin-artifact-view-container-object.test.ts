// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13912 — the artifact/HMR registrar never read a view container's OWN
 * top-level `object` field.
 *
 * ---------------------------------------------------------------------------
 * The defect, and why it survived #13407 and #13913
 * ---------------------------------------------------------------------------
 * `MetadataPlugin._parseAndRegisterArtifact` derives "which object does this
 * container bind to" at two sites, and both walked exactly two levels —
 * `list.data.object` then `form.data.object` — never consulting
 * `ViewSchema.object`, the field whose own `.describe()` names its readers:
 * "how a stack-level `views: [...]` entry says which object its views belong
 * to; read by `getViewsByObject()` / `GET /meta/view?object=`".
 *
 * #13407 repaired the RUNTIME door (`packages/metadata-protocol`, the
 * `PUT /meta/view` path) and #13913 repaired the READ backstop
 * (`MetadataManager.getViewsByObject`, which expands a container it finds in
 * its own store). Neither reaches this registrar, and the reason the backstop
 * does not cover it is structural rather than incidental: on the failing shape
 * the first site's `if (!viewObject) continue` dropped the container BEFORE any
 * registration, so `list('view')` never returned it and `getViewsByObject()`
 * had nothing to expand. The gap therefore survived both fixes exactly as the
 * card reports.
 *
 * ---------------------------------------------------------------------------
 * What is driven, and why it is the real door
 * ---------------------------------------------------------------------------
 * Every case goes through `_parseAndRegisterArtifact` — the same entry the boot
 * artifact load and the HMR reload share — with a bare `ObjectStackDefinition`,
 * so each fixture also passes the door's STRICT parse. That is load-bearing
 * here: `ObjectListViewSchema.data` requires `object` when `data` is present at
 * all, so the reachable failing shape is a container that declares the binding
 * once at the top and omits `data` from its view arms (measured — a `list` with
 * `data: { provider: 'object' }` and no `object` is refused by the door before
 * this code is reached, and a pin written on that shape would be testing the
 * schema, not this registrar).
 *
 * ---------------------------------------------------------------------------
 * Controls
 * ---------------------------------------------------------------------------
 * The two `CONTROL:` cases are green in BOTH directions, measured under the
 * ablation recorded in the PR body: this change must not move what the door
 * already registered, so a control going red would be reporting a regression
 * rather than this fix. Neither may therefore depend on the top-level `object`
 * being read.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataPlugin } from './plugin.js';

const logger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('@objectstack/core', async (orig) => ({
    ...((await orig()) as object),
    createLogger: () => logger,
}));

const MANIFEST = { id: 'crm', name: 'CRM', version: '1.0.0', type: 'app' };

/**
 * The card's shape: the binding lives ONLY in the container's own top-level
 * `object`. No view arm carries `data` at all — which is both the natural way
 * to author a container whose object is declared once at the top, and the only
 * arrangement the door's strict parse admits with no `data.object` anywhere.
 */
const objectOnlyContainer = {
    object: 'crm_lead',
    list: { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }, { field: 'company' }] },
    listViews: { hot: { label: 'Hot Leads', type: 'grid', columns: [{ field: 'name' }] } },
    formViews: { edit: { type: 'simple', sections: [{ label: 'Info', fields: [{ field: 'name' }] }] } },
};

/** What `objectOnlyContainer` expands to, sorted — the whole expected answer. */
const EXPANDED = ['crm_lead.default', 'crm_lead.edit', 'crm_lead.hot'];

/** The pre-existing shape: the binding lives only in `list.data.object`. */
const listDataObjectContainer = {
    list: {
        label: 'All Accounts',
        type: 'grid',
        columns: [{ field: 'name' }],
        data: { provider: 'object', object: 'crm_account' },
    },
    formViews: { edit: { type: 'simple', sections: [{ label: 'Info', fields: [{ field: 'name' }] }] } },
};

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

function newPlugin(): any {
    return new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } });
}

/** Load `views` through the real artifact door; returns the plugin. */
async function loadViews(views: unknown[]): Promise<{ plugin: any; total: number }> {
    const plugin = newPlugin();
    // Fresh deep copy per load — the door mutates items in place (`applyProtection`).
    const definition = JSON.parse(JSON.stringify({ manifest: MANIFEST, views }));
    const total = await plugin._parseAndRegisterArtifact(fakeCtx(), definition, 'fixture-13912');
    return { plugin, total };
}

const names = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((i) => i.name).sort();

describe('#13912 artifact door — a container binds by its own top-level `object`', () => {
    it('the fixture carries the card shape (premise guard)', () => {
        // If a later edit gives any view arm a `data.object`, the cases below
        // stop testing this defect and start passing through the old chain.
        const raw = JSON.stringify(objectOnlyContainer);
        expect(raw).toContain('"object":"crm_lead"');
        expect(raw).not.toContain('"data"');
        expect(objectOnlyContainer).not.toHaveProperty('name');
    });

    it('registers the container under the object its own `object` field names', async () => {
        const { plugin } = await loadViews([objectOnlyContainer]);

        // Pre-fix the two-deep chain found nothing here and the container was
        // dropped by `if (!viewObject) continue` — never registered at all.
        expect(await plugin.manager.get('view', 'crm_lead')).toBeDefined();
    });

    it('expands it into the independent `<object>.<key>` ViewItems', async () => {
        const { plugin, total } = await loadViews([objectOnlyContainer]);

        for (const name of EXPANDED) {
            const item = (await plugin.manager.get('view', name)) as any;
            expect(item, `expanded view '${name}' should register`).toBeDefined();
            expect(item.object).toBe('crm_lead');
            expect(item.viewKind === 'list' || item.viewKind === 'form').toBe(true);
        }
        // One container + three expanded items.
        expect(total).toBe(1 + EXPANDED.length);
    });

    it('makes `getViewsByObject()` answer for that object, with the expansion and never the container', async () => {
        const { plugin } = await loadViews([objectOnlyContainer]);

        const views = (await plugin.manager.getViewsByObject('crm_lead')) as Record<string, unknown>[];

        // The card's symptom, in one assertion: this used to be `[]`.
        expect(views.length).toBeGreaterThan(0);
        expect(names(views)).toEqual(EXPANDED);
        // #7163 — the container itself is never an answer.
        expect(names(views)).not.toContain('crm_lead');
        expect(views.some((v) => v.list !== undefined || v.listViews !== undefined)).toBe(false);
    });

    it('prefers the container own `object` over a disagreeing `list.data.object`', async () => {
        // The ordering #13407 settled at the runtime door, made observable: the
        // authorial top-level field decides the registration key. No container
        // shipped in this repo sets both, so nothing existing moves — this pins
        // the order itself so the four derivation sites cannot drift apart again.
        const { plugin } = await loadViews([
            {
                object: 'crm_lead',
                list: {
                    label: 'All',
                    type: 'grid',
                    columns: [{ field: 'name' }],
                    data: { provider: 'object', object: 'crm_account' },
                },
            },
        ]);

        expect(await plugin.manager.get('view', 'crm_lead')).toBeDefined();
        expect(await plugin.manager.get('view', 'crm_lead.default')).toBeDefined();
        expect(await plugin.manager.get('view', 'crm_account')).toBeUndefined();
        expect(await plugin.manager.get('view', 'crm_account.default')).toBeUndefined();
    });

    it('reads the same field on the fall-through registrar (the second derivation site)', async () => {
        // A `view` entry that is NOT an aggregated container (no `list`/`form`/
        // `listViews`/`formViews`) and carries no `name` reaches the second
        // site. It, too, used to be dropped despite declaring its binding — the
        // door discarding an item's own declared identity, which is exactly the
        // shape `ViewSchema.name`'s comment says the door must not repeat.
        const { plugin, total } = await loadViews([{ object: 'crm_lead', label: 'Lead views' }]);

        expect(total).toBe(1);
        expect(await plugin.manager.get('view', 'crm_lead')).toBeDefined();
    });

    // ------------------------------------------------------------------
    // Controls — green in BOTH directions, and measured so.
    // ------------------------------------------------------------------

    it('CONTROL: a container bound through `list.data.object` still registers and expands', async () => {
        const { plugin, total } = await loadViews([listDataObjectContainer]);

        expect(await plugin.manager.get('view', 'crm_account')).toBeDefined();
        expect(names(await plugin.manager.getViewsByObject('crm_account'))).toEqual([
            'crm_account.default',
            'crm_account.edit',
        ]);
        expect(total).toBe(3);
    });

    it('CONTROL: a container with no derivable binding at all is still skipped', async () => {
        // No top-level `object`, no `data.object`, no `name` — the derivation
        // returns undefined and nothing is registered. The fix widens WHERE the
        // binding may be declared; it does not invent one.
        const { plugin, total } = await loadViews([
            { list: { label: 'Orphan', type: 'grid', columns: [{ field: 'name' }] } },
        ]);

        expect(total).toBe(0);
        expect(await plugin.manager.list('view')).toEqual([]);
    });
});
