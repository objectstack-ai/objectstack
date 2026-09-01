// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#13216] `searchAll` sweeps PUBLISHED PAGES into the sibling `pages` array —
// direction 3 of the card, per the 2026-08-29 maintainer ruling (directions
// 1 + 3 adopted): a custom page created and published at runtime rendered
// perfectly and was absent from the ⌘K palette door alone (#13100 measured
// it), so the artifact an agent grew into a running app was reachable by
// direct URL only.
//
// ## What this file pins, and why each pin is here
//
//  1. THE SWEPT SET IS THE SERVED SET. Pages reach the sweep through
//     `getMetaItems({ type: 'page' })` — the same verb the REST
//     `GET /meta/page` list door serves — so whatever that door withholds
//     (draft rows, disabled-package items) the sweep never saw. That single
//     decision is the zero-new-authorization-surface basis the ruling
//     requires: search surfaces to a caller exactly what the caller's own
//     meta read door already answers, never more, and is not a second read
//     door. Pinned from both directions: a published (state `'active'`)
//     stored row surfaces, a draft row of the same shape does not, and a
//     disabled package's code-registered page does not.
//  2. RECORD HITS ARE UNTOUCHED. Page hits are a SIBLING array, never
//     members of `hits` — an existing consumer iterating `hits` (each one a
//     record with an `object`/`id` address) must not meet an element whose
//     address vocabulary it predates.
//  3. SCOPED SWEEPS SKIP PAGES. `?objects=lead` asks for records of `lead`;
//     answering pages there would widen a request the caller narrowed.
//  4. TERM SEMANTICS match the record sweep's: AND of terms, OR of fields
//     (name, every locale value of label/description), case-folded.
//  5. A FAILED PAGE READ PROPAGATES (#8896 one seam over): `getMetaItems`
//     raises a real store outage as a 503, and the sweep adds no `catch` — a
//     partial scan must not wear a whole one's answer.

import { describe, it, expect, vi } from 'vitest';
import { SearchAllPageHitSchema, SearchAllResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const text = (name: string) => ({ name, type: 'text' });

interface StoredRow {
    id: string;
    type: string;
    name: string;
    state: 'active' | 'draft';
    organization_id: string | null;
    package_id: string | null;
    metadata: string;
}

interface EngineOptions {
    /** Code-registered pages, served by `registry.listItems('page')`. */
    codePages?: Array<Record<string, unknown>>;
    /** `sys_metadata` rows, filtered honestly on `type`/`state`/`organization_id`. */
    storedRows?: StoredRow[];
    /** Package ids the registry reports disabled. */
    disabledPackages?: string[];
    /** Rows served per data object (the record sweep's half). */
    rowsByObject?: Record<string, unknown[]>;
    /** Data objects the registry enumerates. */
    objects?: Array<Record<string, unknown> & { name: string }>;
}

/**
 * A protocol over an engine double whose `sys_metadata` face is HONEST: rows
 * come back only when they match the queried `type` / `state` /
 * `organization_id` — because the draft-exclusion pin below is a claim about
 * the read the sweep performs, and a double that ignored `where.state` would
 * measure the double.
 */
function makeEngine(opts: EngineOptions = {}) {
    const objects = opts.objects ?? [];
    const disabled = new Set(opts.disabledPackages ?? []);
    const registry = {
        getObject: (n: string) => objects.find((o) => o.name === n),
        getAllObjects: () => objects,
        listItems: (type: string) => (type === 'page' ? (opts.codePages ?? []) : []),
        getItem: () => undefined,
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: (p: unknown) => typeof p === 'string' && disabled.has(p),
    };
    const find = vi.fn(async (object: string, q?: { where?: Record<string, unknown> }) => {
        if (object === 'sys_metadata') {
            const where = q?.where ?? {};
            return (opts.storedRows ?? []).filter((r) =>
                r.type === where.type
                && r.state === where.state
                && (r.organization_id ?? null) === ((where.organization_id ?? null) as string | null));
        }
        return opts.rowsByObject?.[object] ?? [];
    });
    return { engine: { registry, find }, find };
}

function makeProtocol(opts: EngineOptions = {}) {
    const { engine, find } = makeEngine(opts);
    return { p: new ObjectStackProtocolImplementation(engine as never), find };
}

const storedPage = (over: Partial<StoredRow> & { body: Record<string, unknown> }): StoredRow => ({
    id: `row_${String(over.body.name ?? 'page')}`,
    type: 'page',
    name: String(over.body.name ?? 'page'),
    state: 'active',
    organization_id: null,
    package_id: null,
    metadata: JSON.stringify(over.body),
    ...over,
});

describe('[#13216] searchAll sweeps published pages into `pages`', () => {
    it('a runtime-published (state active) page surfaces, with the declared hit shape', async () => {
        const { p } = makeProtocol({
            storedRows: [storedPage({
                body: {
                    name: 'sales_dashboard',
                    label: 'Sales Dashboard',
                    description: 'Quarterly pipeline overview for the sales team',
                    type: 'app',
                    kind: 'react',
                },
            })],
        });

        const result = await p.searchAll({ q: 'sales' });

        expect(result.pages).toHaveLength(1);
        const hit = result.pages[0];
        expect(hit).toMatchObject({ kind: 'page', name: 'sales_dashboard', title: 'Sales Dashboard', pageType: 'app' });
        const parsed = SearchAllPageHitSchema.safeParse(hit);
        expect(parsed.error?.issues ?? []).toEqual([]);
        // The whole body still parses against the widened response schema.
        const body = SearchAllResponseSchema.safeParse(JSON.parse(JSON.stringify(result)));
        expect(body.error?.issues ?? []).toEqual([]);
    });

    it('a DRAFT row of the same shape does not surface — the sweep reads the published state only', async () => {
        const body = {
            name: 'pending_dashboard',
            label: 'Pending Dashboard',
            type: 'app',
        };
        const { p, find } = makeProtocol({
            storedRows: [storedPage({ body, state: 'draft', name: 'pending_dashboard' })],
        });

        const result = await p.searchAll({ q: 'pending' });

        expect(result.pages).toEqual([]);
        // Discriminating control: the read RAN (the door was asked), and the
        // same row published IS a hit — so the emptiness above is the state
        // filter, not a sweep that never looked.
        expect(find.mock.calls.some(([o]) => o === 'sys_metadata')).toBe(true);
        const { p: published } = makeProtocol({ storedRows: [storedPage({ body })] });
        expect((await published.searchAll({ q: 'pending' })).pages).toHaveLength(1);
    });

    it("a DISABLED package's page does not surface — whatever the meta read door withholds, the sweep never saw", async () => {
        const page = { name: 'pkg_home', label: 'Package Home', type: 'app', _packageId: 'pkg_off' };
        const { p } = makeProtocol({ codePages: [page], disabledPackages: ['pkg_off'] });
        expect((await p.searchAll({ q: 'package' })).pages).toEqual([]);

        // Positive control — the same page with its package enabled surfaces,
        // so the emptiness above is the door's withholding, not a dead sweep.
        const { p: enabled } = makeProtocol({ codePages: [page] });
        expect((await enabled.searchAll({ q: 'package' })).pages).toHaveLength(1);
    });

    it('record hits are untouched beside page hits — and carry no `kind`', async () => {
        const lead = { name: 'lead', fields: { name: text('name') } };
        const { p } = makeProtocol({
            objects: [lead],
            rowsByObject: { lead: [{ id: 'l1', name: 'Acme Industrial' }] },
            storedRows: [storedPage({ body: { name: 'acme_home', label: 'Acme Home', type: 'app' } })],
        });

        const result = await p.searchAll({ q: 'acme' });

        expect(result.hits.map((h) => h.object)).toEqual(['lead']);
        expect(Object.keys(result.hits[0])).not.toContain('kind');
        expect(result.pages.map((h) => h.name)).toEqual(['acme_home']);
        // The record-side counters keep their record-only meaning.
        expect(result.totalHits).toBe(1);
        expect(result.totalObjects).toBe(1);
    });

    it('a SCOPED sweep (`objects`) answers `pages: []` even when a page matches', async () => {
        const lead = { name: 'lead', fields: { name: text('name') } };
        const { p, find } = makeProtocol({
            objects: [lead],
            rowsByObject: { lead: [{ id: 'l1', name: 'Acme Industrial' }] },
            storedRows: [storedPage({ body: { name: 'acme_home', label: 'Acme Home' } })],
        });

        const result = await p.searchAll({ q: 'acme', objects: ['lead'] });

        expect(result.hits).toHaveLength(1);
        expect(result.pages).toEqual([]);
        // Skipped, not filtered-after-reading: the page read never ran.
        expect(find.mock.calls.some(([o]) => o === 'sys_metadata')).toBe(false);
    });

    it('the blank-query short-circuit carries `pages: []` and still scans nothing', async () => {
        const { p, find } = makeProtocol({
            storedRows: [storedPage({ body: { name: 'anything', label: 'Anything' } })],
        });
        const result = await p.searchAll({ q: '   ' });
        expect(result).toEqual({ query: '', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false });
        expect(find).not.toHaveBeenCalled();
    });

    it('terms AND across fields, case-folded: each term may match a different field', async () => {
        const { p } = makeProtocol({
            storedRows: [storedPage({
                body: {
                    name: 'ops_board',
                    label: 'Operations Board',
                    description: 'Realtime fulfilment metrics',
                },
            })],
        });

        // 'operations' hits the label, 'metrics' the description — AND holds.
        expect((await p.searchAll({ q: 'OPERATIONS metrics' })).pages).toHaveLength(1);
        // One term matching nowhere fails the AND.
        expect((await p.searchAll({ q: 'operations nonexistent' })).pages).toEqual([]);
    });

    it('an i18n label map matches on EVERY locale value and titles through the shared resolution', async () => {
        const { p } = makeProtocol({
            storedRows: [storedPage({
                body: {
                    name: 'hr_portal',
                    label: { en: 'HR Portal', 'zh-CN': '人事门户' },
                },
            })],
        });

        // A caller searching in Chinese hits the zh-CN label value…
        const zh = await p.searchAll({ q: '人事' });
        expect(zh.pages.map((h) => h.name)).toEqual(['hr_portal']);
        // …and the title resolves through resolveI18nLabel's default chain
        // (this route carries no locale, so `en` leads it).
        expect(zh.pages[0].title).toBe('HR Portal');
    });

    it('a name match with no description carries no snippet; a description match carries the excerpt', async () => {
        const longDesc = 'x'.repeat(50) + ' the quarterly revenue figures live here ' + 'y'.repeat(120);
        const { p } = makeProtocol({
            storedRows: [
                storedPage({ body: { name: 'bare_page', label: 'Bare Page' } }),
                storedPage({ body: { name: 'rev_page', label: 'Revenue', description: longDesc } }),
            ],
        });

        const bare = (await p.searchAll({ q: 'bare' })).pages[0];
        expect(bare).toBeDefined();
        expect(Object.keys(bare)).not.toContain('snippet');

        const rev = (await p.searchAll({ q: 'quarterly' })).pages[0];
        expect(rev?.snippet).toContain('quarterly revenue');
        // Same excerpt geometry as a record hit: ellipsized at both truncated ends.
        expect(rev?.snippet?.startsWith('…')).toBe(true);
        expect(rev?.snippet?.endsWith('…')).toBe(true);
    });

    it('page hits cap at `perObject` — one more container, not a competitor for `limit`', async () => {
        const rows = Array.from({ length: 5 }, (_, i) =>
            storedPage({ body: { name: `report_page_${i}`, label: `Report Page ${i}` } }));
        const { p } = makeProtocol({ storedRows: rows });

        const result = await p.searchAll({ q: 'report', perObject: 2 });

        expect(result.pages).toHaveLength(2);
        // The cap is `perObject`, not `limit`: limit 1 still admits 2 pages.
        const wide = await p.searchAll({ q: 'report', limit: 1, perObject: 2 });
        expect(wide.pages).toHaveLength(2);
    });

    it('a failed page read PROPAGATES — a partial scan must not wear a whole one\'s answer (#8896)', async () => {
        const injected = Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
        const { engine } = makeEngine({});
        (engine as { find: unknown }).find = vi.fn(async (object: string) => {
            if (object === 'sys_metadata') throw injected;
            return [];
        });
        const p = new ObjectStackProtocolImplementation(engine as never);

        // `getMetaItems` classifies a real outage as a 503 metadata-store
        // failure (#5532) — what must NOT happen is a resolve with invented
        // `pages: []`.
        await expect(p.searchAll({ q: 'anything' })).rejects.toMatchObject({ status: 503 });
    });

    it('the swept set equals the served set — every page hit is a name `getMetaItems` serves', async () => {
        const { p } = makeProtocol({
            codePages: [{ name: 'code_home', label: 'Code Home' }],
            storedRows: [storedPage({ body: { name: 'stored_home', label: 'Stored Home' } })],
        });

        const served = await p.getMetaItems({ type: 'page' });
        const servedNames = new Set((served.items as Array<{ name?: string }>).map((i) => i.name));
        const { pages } = await p.searchAll({ q: 'home' });

        expect(pages.length).toBeGreaterThan(0);
        for (const hit of pages) expect(servedNames.has(hit.name)).toBe(true);
    });
});
