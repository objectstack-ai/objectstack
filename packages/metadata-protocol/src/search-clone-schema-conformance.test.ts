// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11924] `searchAll` / `cloneData` conform to their newly declared response
// schemas — the PRODUCER half of the conformance coverage that entitles the
// route-ledger rows for `GET /api/v1/search` and
// `POST /data/:object/:id/clone` to name a `responseSchema` at all (#3877:
// ⛔ no row filled without conformance coverage; `packages/rest` carries the
// relay half against the real mounts).
//
// Both routes answer BARE — the REST handlers relay these methods' returns
// verbatim (`res.json(result)` / `res.status(201).json(result)`) — so what is
// measured here IS the wire body. The maintainer ruling (2026-08-25) is
// "declare them as they actually are": the schema is judged against what the
// real producer emits over a fixture engine, not against a hand-built body
// shaped to match the declaration.
//
// The two assertions per surface are deliberately different questions, the
// same split as `discovery-schema-conformance.test.ts`:
//
//   * `safeParse` judges VALUES — required keys present, declared types hold;
//   * the key-set subset check judges KEYS — nothing is emitted that the spec
//     never declared (a plain `z.object` STRIPS unknown keys, so the parse
//     alone is blind in exactly that direction).
//
// Key-set checks run on the JSON round-trip of the return value, because that
// is the body a caller holds: `searchAll` builds hits as
// `{ …, snippet: <possibly undefined> }`, and JSON serialization is what
// drops the undefined-valued key on the wire.

import { describe, it, expect, vi } from 'vitest';
import { CloneDataResponseSchema, SearchAllHitSchema, SearchAllPageHitSchema, SearchAllResponseSchema } from '@objectstack/spec/api';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** What a caller actually holds after the REST relay: the JSON body. */
function overTheWire<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function declaredKeys(schema: unknown): Set<string> {
    return new Set(Object.keys((schema as { shape: Record<string, unknown> }).shape));
}

// ─────────────────────────────────────────────────────────────────────────────
// searchAll — the real sweep over a fixture object set
// ─────────────────────────────────────────────────────────────────────────────

const text = (name: string) => ({ name, type: 'text' });

/**
 * A protocol over a fixed object set, rows served verbatim by `find` (the
 * engine double filters nothing — recall is the engine's contract, pinned in
 * `protocol.search-case-fold.test.ts`; this file is about the emitted SHAPE).
 *
 * [#13216] The registry also serves one published PAGE matching the query
 * (and one that does not), so the body's `pages` member is measured as
 * produced — both `snippet` branches of the page hit included: the matching
 * page's description contains the term (excerpt present), and a page hit
 * whose match is name/label-only serializes the key away (covered in the
 * page-hit key test below via `acme_home`).
 */
function makeSearchProtocol() {
    const lead = {
        name: 'lead',
        fields: { name: text('name'), notes: text('notes') },
    };
    const rows = [
        // Searchable column contains the term → `snippet` present.
        { id: 'lead_1', name: 'Acme Industrial', notes: 'acme is evaluating the pilot' },
        // No searchable column contains the term → `snippet` key serializes away.
        { id: 'lead_2', name: 'Beta Corp', notes: 'no matching text here' },
    ];
    const pages = [
        // Description contains the term → page `snippet` present.
        { name: 'acme_portal', label: 'Acme Portal', description: 'acme rollout portal', type: 'app' },
        // Match on name/label only → page `snippet` serializes away.
        { name: 'acme_home', label: 'Acme Home', type: 'app' },
        // No match at all → not a hit.
        { name: 'ops_board', label: 'Operations Board', type: 'app' },
    ];
    const engine = {
        registry: {
            getObject: (n: string) => (n === 'lead' ? lead : undefined),
            getAllObjects: () => [lead],
            listItems: (type: string) => (type === 'page' ? pages : []),
            getItem: () => undefined,
            applyNavContributions: (x: unknown) => x,
            isPackageDisabled: () => false,
        },
        find: vi.fn(async (object: string) => (object === 'sys_metadata' ? [] : rows)),
    };
    return new ObjectStackProtocolImplementation(engine as never);
}

describe('[#11924] searchAll conforms to SearchAllResponseSchema', () => {
    it('emits a body that parses, as returned and over the wire', async () => {
        const body = await makeSearchProtocol().searchAll({ q: 'acme' });

        const raw = SearchAllResponseSchema.safeParse(body);
        expect(raw.error?.issues ?? []).toEqual([]);
        expect(raw.success).toBe(true);

        const wire = SearchAllResponseSchema.safeParse(overTheWire(body));
        expect(wire.error?.issues ?? []).toEqual([]);
        expect(wire.success).toBe(true);

        // The members the declaration names carry the sweep's real answers.
        expect(body.query).toBe('acme');
        expect(body.hits.length).toBe(2);
        expect(body.totalObjects).toBe(1);
        expect(body.totalHits).toBe(body.hits.length);
        expect(body.truncated).toBe(false);
        // [#13216] …including the published-page sibling array, as produced.
        expect(body.pages.map((h) => h.name)).toEqual(['acme_portal', 'acme_home']);
    });

    it('emits no top-level key the spec does not declare', async () => {
        const body = overTheWire(await makeSearchProtocol().searchAll({ q: 'acme' }));
        const declared = declaredKeys(SearchAllResponseSchema);
        const undeclared = Object.keys(body).filter((k) => !declared.has(k));
        expect(undeclared, 'keys emitted by searchAll that SearchAllResponseSchema never declares').toEqual([]);
    });

    it('emits no hit-level key the spec does not declare — and `snippet` is genuinely conditional', async () => {
        const body = overTheWire(await makeSearchProtocol().searchAll({ q: 'acme' }));
        const declared = declaredKeys(SearchAllHitSchema);
        for (const hit of body.hits) {
            const undeclared = Object.keys(hit).filter((k) => !declared.has(k));
            expect(undeclared, `keys on hit ${hit.id} that SearchAllHitSchema never declares`).toEqual([]);
        }
        // Both branches of the optional member, measured on one body: the row
        // whose searchable column contains the term carries an excerpt; the
        // row matched without one serializes the key away (#7643 — absence is
        // a correct answer, not a miss).
        const withSnippet = body.hits.find((h: { id: string }) => h.id === 'lead_1');
        const withoutSnippet = body.hits.find((h: { id: string }) => h.id === 'lead_2');
        // Term matching is case-folded but the excerpt preserves SOURCE casing
        // — 'acme' matched the `name` column's 'Acme Industrial'.
        expect(withSnippet?.snippet?.toLowerCase()).toContain('acme');
        expect(withoutSnippet).toBeDefined();
        expect(Object.keys(withoutSnippet!)).not.toContain('snippet');
    });

    it('emits no PAGE-hit key the spec does not declare — and the page `snippet` is genuinely conditional (#13216)', async () => {
        const body = overTheWire(await makeSearchProtocol().searchAll({ q: 'acme' }));
        const declared = declaredKeys(SearchAllPageHitSchema);
        for (const hit of body.pages) {
            const undeclared = Object.keys(hit).filter((k) => !declared.has(k));
            expect(undeclared, `keys on page hit ${hit.name} that SearchAllPageHitSchema never declares`).toEqual([]);
        }
        // Both branches of the optional member, measured on one body: the page
        // whose DESCRIPTION contains the term carries the excerpt; the page
        // matched on name/label alone serializes the key away (the title
        // already shows the match).
        const withSnippet = body.pages.find((h: { name: string }) => h.name === 'acme_portal');
        const withoutSnippet = body.pages.find((h: { name: string }) => h.name === 'acme_home');
        expect(withSnippet?.snippet?.toLowerCase()).toContain('acme rollout');
        expect(withoutSnippet).toBeDefined();
        expect(Object.keys(withoutSnippet!)).not.toContain('snippet');
    });

    it('the blank-query short-circuit parses too — the one body built by a different return', async () => {
        // `searchAll` has exactly two return statements; this is the other one.
        const body = await makeSearchProtocol().searchAll({ q: '   ' });
        const parsed = SearchAllResponseSchema.safeParse(body);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(body).toEqual({ query: '', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// cloneData — the real clone over a fixture engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A protocol over one clonable object whose field set includes a static
 * `readonly` column — the one kind of key a clone carries WITHOUT the caller
 * typing it (it is copied from the source row before `overrides` apply).
 *
 * [#15703] The engine double behaves like the real one AFTER #14147: it strips
 * the `readonly` keys the payload carried and reports them, once, through
 * `options.onFieldsDropped` — the channel whose wire shape this file measures.
 * The strip RULE is not re-tested here (it is pinned against a real engine in
 * `packages/objectql/src/engine-insert-static-readonly-strip.test.ts`); a
 * double that never dropped anything would leave the `droppedFields` half of
 * the conformance below vacuously green, so the source row is the switch:
 * pass one carrying `approval_status` to exercise the produced branch, the
 * default row to exercise omit-when-empty.
 */
function makeCloneProtocol(opts: { source?: Record<string, unknown> } = {}) {
    const customer = {
        name: 'customer',
        fields: {
            name: text('name'),
            notes: text('notes'),
            approval_status: { name: 'approval_status', type: 'text', readonly: true, defaultValue: 'draft' },
        },
    };
    const source = opts.source ?? { id: 'cus_1', name: 'Acme Industrial', notes: 'source row' };
    const inserts: Array<{ object: string; data: Record<string, unknown>; options: unknown }> = [];
    const engine = {
        registry: { getObject: (n: string) => (n === 'customer' ? customer : undefined) },
        findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return ({ ...source }); }),
        insert: vi.fn(async (
            object: string,
            data: Record<string, unknown>,
            options?: { onFieldsDropped?: (e: DroppedFieldsEvent) => void },
        ) => {
            inserts.push({ object, data, options });
            const row: Record<string, unknown> = { ...data };
            const dropped: string[] = [];
            for (const [name, def] of Object.entries(customer.fields)) {
                if (!(def as { readonly?: boolean }).readonly || !(name in row)) continue;
                delete row[name];
                dropped.push(name);
            }
            if (dropped.length > 0 && typeof options?.onFieldsDropped === 'function') {
                options.onFieldsDropped({ object, fields: dropped, reason: 'readonly' });
            }
            return { id: 'cus_2', ...row, created_at: '2026-08-25T00:00:00Z' };
        }),
    };
    return { p: new ObjectStackProtocolImplementation(engine as never), inserts };
}

describe('[#11924] cloneData conforms to CloneDataResponseSchema', () => {
    it('emits a body that parses, as returned and over the wire', async () => {
        const { p } = makeCloneProtocol();
        const body = await p.cloneData({ object: 'customer', id: 'cus_1', overrides: { name: 'Acme Copy' } });

        const raw = CloneDataResponseSchema.safeParse(body);
        expect(raw.error?.issues ?? []).toEqual([]);
        expect(raw.success).toBe(true);

        const wire = CloneDataResponseSchema.safeParse(overTheWire(body));
        expect(wire.error?.issues ?? []).toEqual([]);
        expect(wire.success).toBe(true);

        // The members the declaration names carry the clone's real answers:
        // `id` is the NEW record's, `sourceId` the copied record's — the pair
        // whose distinction is the whole reason this is not CreateDataResponse.
        expect(body.object).toBe('customer');
        expect(body.id).toBe('cus_2');
        expect(body.sourceId).toBe('cus_1');
        expect(body.record).toMatchObject({ id: 'cus_2', name: 'Acme Copy', notes: 'source row' });
    });

    it('emits no top-level key the spec does not declare — `droppedFields` included, now that it is declared AND produced (#15703)', async () => {
        // The source row carries a static `readonly` column, so the copy does
        // too — the clone-specific way a create ends up holding a key the
        // caller never typed. The engine strips it and reports it; the body
        // names it. Until #15703 this case pinned the key's ABSENCE by name,
        // because the producer emitted nothing and the schema (declared AS
        // PRODUCED, #11924) must not promise what conformance cannot measure;
        // the member and the listener landed together, so the pin flips to the
        // produced branch — measured on the real producer, not a hand-built body.
        const { p } = makeCloneProtocol({
            source: { id: 'cus_1', name: 'Acme Industrial', notes: 'source row', approval_status: 'approved' },
        });
        const returned = await p.cloneData({ object: 'customer', id: 'cus_1' });
        const body = overTheWire(returned);

        const declared = declaredKeys(CloneDataResponseSchema);
        const undeclared = Object.keys(body).filter((k) => !declared.has(k));
        expect(undeclared, 'keys emitted by cloneData that CloneDataResponseSchema never declares').toEqual([]);

        expect(body.droppedFields).toEqual([
            { object: 'customer', fields: ['approval_status'], reason: 'readonly' },
        ]);
        expect(body.record).not.toHaveProperty('approval_status');

        // Values, both as returned and over the wire: the declared element
        // shape (`DroppedFieldsEventSchema`) holds for what the producer emits.
        const raw = CloneDataResponseSchema.safeParse(returned);
        expect(raw.error?.issues ?? []).toEqual([]);
        expect(raw.success).toBe(true);
        const wire = CloneDataResponseSchema.safeParse(body);
        expect(wire.error?.issues ?? []).toEqual([]);
        expect(wire.success).toBe(true);
    });

    it('omits `droppedFields` when nothing was dropped — the member is optional and omit-when-empty, as on createData', async () => {
        // The default source row carries no readonly column, so the engine
        // reports nothing and the key must not appear at all: an empty array
        // would be a second spelling of "nothing dropped" (#7643 — absence is
        // the answer). Still a subset of the declared key set.
        const { p } = makeCloneProtocol();
        const body = overTheWire(await p.cloneData({ object: 'customer', id: 'cus_1' }));
        const declared = declaredKeys(CloneDataResponseSchema);
        const undeclared = Object.keys(body).filter((k) => !declared.has(k));
        expect(undeclared, 'keys emitted by cloneData that CloneDataResponseSchema never declares').toEqual([]);
        expect(body).not.toHaveProperty('droppedFields');
    });
});
