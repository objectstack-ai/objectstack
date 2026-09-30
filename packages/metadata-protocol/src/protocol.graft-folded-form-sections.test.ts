// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7134 — `saveMeta` persists the `groups` → `sections` fold the spec performed.
 *
 * `FormViewSchema` folds the legacy `groups` alias onto canonical `sections` at
 * the producer (#6926, PR #7128), so every consumer of a PARSED form sees one
 * key. `saveMetaItem` parses through that very schema and then discards
 * `parsed.data` on purpose — the authored body is persisted verbatim so the
 * Studio-only round-trip keys (`isPinned`, `isDefault`, `sortOrder`) survive. A
 * Studio-saved form therefore kept reaching `sections`-reading consumers spelled
 * `groups`, and the three `/forms/:slug` routes in `packages/rest` degrade on
 * exactly that. While saves keep minting the authored spelling the alias can
 * never be retired — the same argument `graftNormalizedOperators` was written
 * for, one key-shape over.
 *
 * `graftFoldedFormSections` grafts that ONE normalization back on. The tests
 * below pin both halves: the key move DOES reach the stored row, at every depth
 * a form can live, and everything else does NOT change.
 *
 * ## Two levels, deliberately
 *
 * The first two blocks drive the REAL `saveMetaItem` against a stub engine and
 * read the persisted `sys_metadata` row, because the storage row is what the
 * REST routes read and therefore what this card is about — a helper-only pin
 * would stay green if the call site were dropped. The last block exercises the
 * helper directly for the structural cases a save cannot reach (a `groups` key
 * the schema KEEPS, a mismatched parsed tree), mirroring
 * `protocol.graft-normalized-operators.test.ts`.
 *
 * ## Since #20051's stage (iv): a `view` stores its parsed body
 *
 * A `view` no longer runs this graft on a verbatim body. `saveMetaItem` stores
 * the parsed value of every key the body carried (`projectStorableViewBody`),
 * which subsumes the fold, the operator graft beside it, and every other key
 * move; the graft keeps serving the other types. The save-path blocks above
 * therefore now pin the projection's behaviour on the same fixtures, and the
 * pins that asserted the verbatim save were re-judged where they stand. The
 * stage's own pins are the last three blocks, riding this file's pinned engine
 * double for the reason the #20051 door-half block below gives.
 */
import { describe, expect, it, vi } from 'vitest';
import { ViewMetadataSchema, VIEW_CONSOLE_ROUND_TRIP_KEYS } from '@objectstack/spec/ui';
import { getMetadataTypeSchema, registerMetadataTypeSchema } from '@objectstack/spec/kernel';
import { z } from 'zod';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch, assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, graftFoldedFormSections } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

/**
 * The engine surface the repository write path touches — the same stub shape
 * `protocol.save-flow-canonicalization.test.ts` uses, for the same reason: a fix
 * INSIDE `saveMetaItem` cannot be tested through a harness that mocks it.
 */
function makeProtocol() {
    // ⚠️ Keyed BY TABLE, and that is a correctness property of this harness
    // rather than tidiness. One flat row map answers a read of `sys_metadata`
    // with rows the protocol wrote to `sys_metadata_history` and
    // `sys_metadata_commit`: a DRAFT save appends a history row carrying no
    // `state`, the declared `defaultValue: 'active'` modelled below fills it
    // in, and the draft comes back as an ACTIVE metadata row. Measured in
    // #16223, where one assertion's polarity was the only thing that caught it.
    const tables = new Map<string, Map<string, Row>>();
    const tableOf = (table: string): Map<string, Row> => {
        const existing = tables.get(table);
        if (existing) return existing;
        const created = new Map<string, Row>();
        tables.set(table, created);
        return created;
    };
    /** The store table these tests assert on; the journals get their own. */
    const rows = tableOf('sys_metadata');
    let nextId = 0;
    const findRow = (table: string, w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of tableOf(table)) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of tableOf(table)) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(table, opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            return Array.from(tableOf(table).values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            tableOf(table).set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(table, opts.where);
            if (!found) return { id: null };
            tableOf(table).set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(table, opts.where);
            if (!found) return { deleted: 0 };
            tableOf(table).delete(found.key);
            return { deleted: 1 };
        },
        registry: { registerItem: () => {}, registerObject: () => {} },
    };
    return { protocol: new ObjectStackProtocolImplementation(engine, () => new Map()), rows };
}

/** Save a view through the real write path and return the body the ROW holds. */
async function storedViewBody(name: string, item: unknown): Promise<any> {
    const { protocol, rows } = makeProtocol();
    const result: any = await (protocol as any).saveMetaItem({ type: 'view', name, item });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const row = Array.from(rows.values()).find((r) => r.type === 'view');
    expect(row, 'the save persisted no view row at all').toBeDefined();
    return JSON.parse(row!.metadata);
}

/** The one section every fixture below declares, in the authored spelling. */
const SECTION = { label: 'About you', fields: ['name', 'email'] };
const SHARING = { allowAnonymous: true, publicLink: '/forms/contact-us' };
const DATA = { provider: 'object', object: 'lead' };

/** A flattened runtime FORM overlay — the shape a Studio form save sends. */
const flatForm = (extra: Record<string, unknown> = {}) => ({
    name: 'contact_us',
    object: 'lead',
    viewKind: 'form',
    label: 'Contact us',
    type: 'simple',
    sharing: SHARING,
    ...extra,
});

describe('#7134 the save path persists the folded `sections`, at every depth a form lives', () => {
    it('flattened form overlay: an authored `groups` reaches the row as `sections`', async () => {
        const body = await storedViewBody('contact_us', flatForm({ groups: [SECTION] }));
        expect(body.sections).toEqual([SECTION]);
        expect(body, 'the authored alias must not survive into the row').not.toHaveProperty('groups');
    });

    it('ViewItem `config.groups` reaches the row as `config.sections`', async () => {
        const body = await storedViewBody('lead.contact_us', {
            name: 'lead.contact_us',
            object: 'lead',
            viewKind: 'form',
            label: 'Contact us',
            config: { type: 'simple', data: DATA, sharing: SHARING, groups: [SECTION] },
        });
        expect(body.config.sections).toEqual([SECTION]);
        expect(body.config).not.toHaveProperty('groups');
    });

    it('container `form.groups` and `formViews.*.groups` both reach the row as `sections`', async () => {
        // One save covering both container slots: a form slot the walk finds by
        // structure, not by a maintained list of places a form can live.
        const body = await storedViewBody('lead_views', {
            name: 'lead_views',
            form: { type: 'simple', data: DATA, sharing: SHARING, groups: [SECTION] },
            formViews: {
                intake: { type: 'simple', data: DATA, sharing: SHARING, groups: [SECTION] },
            },
        });
        expect(body.form.sections).toEqual([SECTION]);
        expect(body.form).not.toHaveProperty('groups');
        expect(body.formViews.intake.sections).toEqual([SECTION]);
        expect(body.formViews.intake).not.toHaveProperty('groups');
    });

    it('the row carries the AUTHORED array, not `parsed.data`\'s defaulted one', async () => {
        // `parsed.data` would have stamped `collapsible`, `collapsed` and
        // `columns` onto the section. Persisting those is the wholesale swap
        // this whole design avoids — the graft moves the key, nothing else.
        const body = await storedViewBody('contact_us', flatForm({ groups: [SECTION] }));
        expect(Object.keys(body.sections[0]).sort()).toEqual(['fields', 'label']);
    });

    it('`sections` wins when the author wrote both — `groups` is dropped, empty array included', async () => {
        // The producer's own precedence rule (`spec.sections ?? spec.groups`).
        const body = await storedViewBody('contact_us', flatForm({ sections: [], groups: [SECTION] }));
        expect(body.sections).toEqual([]);
        expect(body).not.toHaveProperty('groups');
    });

    it('[#20051] the fold and the form overlay\'s declared keys coexist on one save; its undeclared ones do not', async () => {
        // Re-judged at stage (iv) of #20051, which stores a view's parsed
        // body. The fold is stored, and so is `isDefault`, which the flattened
        // FORM overlay declares. `isPinned` and `sortOrder` are the list
        // switcher's row state: the form member declares neither and the
        // console writes neither on a form row (`VIEW_CONSOLE_ROUND_TRIP_KEYS`
        // maps no key to `formOverlay`), so the stored row drops both.
        const body = await storedViewBody(
            'contact_us',
            flatForm({ groups: [SECTION], isPinned: true, isDefault: false, sortOrder: 3 }),
        );
        expect(body.sections).toEqual([SECTION]);
        expect(body).not.toHaveProperty('groups');
        expect(body.isDefault).toBe(false);
        expect(body).not.toHaveProperty('isPinned');
        expect(body).not.toHaveProperty('sortOrder');
    });
});

describe('#7134 what the save path must NOT change', () => {
    it('GUARD: the console\'s round-trip keys survive the save on the member that declares them', async () => {
        // GUARD, green in BOTH directions: stored verbatim before #20051's stage
        // (iv), stored because declared after it. Re-judged from a FORM overlay
        // to the flat LIST overlay, the row these keys are written on
        // (`VIEW_CONSOLE_ROUND_TRIP_KEYS`): every key that record maps to
        // `listOverlay`, with a value the console writes.
        const authored = {
            name: 'crm_lead.all',
            object: 'crm_lead',
            viewKind: 'list',
            sort: [{ field: 'name', order: 'asc' }],
            isPinned: true,
            isDefault: false,
            sortOrder: 3,
            visibility: 'team',
            columnState: { order: ['name'], widths: { name: 180 } },
            _isOverride: true,
        };
        expect(Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS).filter(
            (k) => (VIEW_CONSOLE_ROUND_TRIP_KEYS as Record<string, readonly string[]>)[k].includes('listOverlay'),
        ).every((k) => k in authored)).toBe(true);
        expect(await storedViewBody(authored.name, authored)).toEqual(authored);
    });

    it('[#20051] a form authored with canonical `sections` is stored as authored — no section default, no `sharing.enabled`, no undeclared key', async () => {
        // Re-judged at stage (iv): was "stored byte-identical", with an
        // `isPinned` the form member does not declare riding along. The parse
        // adds `collapsible` / `collapsed` / `columns` to the section and
        // `enabled: false` to `sharing`; ruling B stores none of them (ADR-0087's
        // `storable` rule), and the undeclared `isPinned` is dropped.
        const authored = flatForm({ sections: [SECTION], isPinned: true });
        const parsed = (ViewMetadataSchema as any).parse(authored);
        expect(parsed.sections[0]).toMatchObject({ collapsible: false, collapsed: false, columns: 1 });
        expect(parsed.sharing.enabled).toBe(false);
        const body = await storedViewBody('contact_us', authored);
        const { isPinned: _dropped, ...declared } = authored as Record<string, unknown>;
        expect(body).toEqual(declared);
    });

    it('GUARD: a LIST overlay is untouched — this walk is form-shaped only', async () => {
        const authored = {
            name: 'open_leads',
            object: 'lead',
            viewKind: 'list',
            label: 'Open',
            type: 'grid',
            columns: ['name'],
            filter: [{ field: 'status', operator: 'equals', value: 'open' }],
            sortOrder: 2,
        };
        expect(await storedViewBody('open_leads', authored)).toEqual(authored);
    });

    it('GUARD: the operator graft still fires on the same save — the two walks compose', async () => {
        // GUARD, not evidence: green in BOTH directions. `graftFoldedFormSections`
        // runs first and hands its result to `graftNormalizedOperators`; a list
        // overlay reaches the second walk identically either way. Pinned so a
        // future edit cannot drop one normalization by rewiring the other.
        const body = await storedViewBody('open_leads', {
            name: 'open_leads',
            object: 'lead',
            viewKind: 'list',
            label: 'Open',
            type: 'grid',
            columns: ['name'],
            filter: [{ field: 'status', operator: 'notEquals', value: 'done' }],
        });
        expect(body.filter[0].operator).toBe('not_equals');
    });
});

describe('graftFoldedFormSections — structural safety, no save involved', () => {
    // The cases a save cannot reach: a `groups` key the schema KEEPS, and a
    // parsed tree whose shape does not line up.

    it('leaves a `groups` key the parse kept entirely alone', () => {
        // A different `groups` vocabulary (app nav groups, a passthrough
        // record). The fold's post-condition is not met, so nothing moves.
        const authored = { groups: [{ id: 'a' }], sections: undefined };
        expect(graftFoldedFormSections(authored, { groups: [{ id: 'a' }] })).toBe(authored);
    });

    it('does not invent `sections` when the parse produced none', () => {
        // `groups` stripped by a `.strip()` schema that has no `sections` at
        // all — dropping it here would be guessing, so the authored key stays.
        const authored = { groups: [{ id: 'a' }] };
        expect(graftFoldedFormSections(authored, { name: 'x' })).toBe(authored);
    });

    it('ignores a parsed tree whose shape does not match', () => {
        const authored = { form: { groups: [{ label: 'G' }] } };
        expect(graftFoldedFormSections(authored, { form: 'not-an-object' })).toBe(authored);
        expect(graftFoldedFormSections(authored, undefined)).toBe(authored);
        expect(graftFoldedFormSections(authored, null)).toBe(authored);
    });

    it('passes primitives and empty structures through unchanged', () => {
        expect(graftFoldedFormSections('x', 'y')).toBe('x');
        expect(graftFoldedFormSections(7, 8)).toBe(7);
        expect(graftFoldedFormSections(null, { a: 1 })).toBe(null);
        const empty = {};
        expect(graftFoldedFormSections(empty, { a: 1 })).toBe(empty);
    });

    it('walks through arrays in lockstep', () => {
        const out = graftFoldedFormSections(
            { items: [{ groups: [{ label: 'G' }] }] },
            { items: [{ sections: [{ label: 'G' }] }] },
        ) as { items: Array<Record<string, unknown>> };
        expect(out.items[0].sections).toEqual([{ label: 'G' }]);
        expect(out.items[0]).not.toHaveProperty('groups');
    });

    it('the fold it replays is the schema\'s own, not a second opinion', () => {
        // Ties the helper to the producer: whatever `ViewMetadataSchema` decides
        // about `groups`, the grafted body agrees with — key for key.
        const authored = flatForm({ groups: [SECTION] });
        const parsed = (ViewMetadataSchema as any).safeParse(authored);
        expect(parsed.success).toBe(true);
        const grafted = graftFoldedFormSections(authored, parsed.data) as Record<string, unknown>;
        expect('groups' in grafted).toBe('groups' in parsed.data);
        expect('sections' in grafted).toBe('sections' in parsed.data);
    });
});

/**
 * [#20051] The view write door judges a flat list overlay's legacy `options`
 * bag — driven through the REAL `saveMetaItem`, riding this file's pinned
 * engine double rather than minting a second one (the double is the reason
 * these cases live here, not the `groups` fold).
 *
 * Measured before the change on `origin/main` @ `8d1f7ab`, through this same
 * harness: `options: { timeline: { metaFields: ['region'] } }` on a flat list
 * overlay saved `success: true` and the row held the bag byte-for-byte, while
 * the direct `timeline.metaFields` was refused. `saveMetaItem` stores the
 * request body, not the parse output, so what the door does not judge is what
 * reaches storage.
 *
 * Refusals assert the envelope (`code` + `status`) and that NO row was written.
 */
describe('[#20051] the save door judges a flat list overlay\'s `options` bag', () => {
    const TIMELINE = { startDateField: 'created_at', titleField: 'name', metaFields: ['region'] };
    const flatList = (extra: Record<string, unknown>) => ({
        name: 'crm_lead.timeline',
        object: 'crm_lead',
        viewKind: 'list',
        label: 'Timeline',
        type: 'timeline',
        columns: ['name'],
        ...extra,
    });

    async function refusal(item: unknown): Promise<{ err: any; rowsWritten: number }> {
        const { protocol, rows } = makeProtocol();
        let err: any;
        try {
            await (protocol as any).saveMetaItem({ type: 'view', name: 'crm_lead.timeline', item });
        } catch (e) { err = e; }
        return { err, rowsWritten: Array.from(rows.values()).filter((r) => r.type === 'view').length };
    }

    it('a direct and an `options`-wrapped out-of-contract key get the same refusal, and nothing is stored', async () => {
        const direct = await refusal(flatList({ timeline: TIMELINE }));
        const wrapped = await refusal(flatList({ options: { timeline: TIMELINE } }));
        for (const { err, rowsWritten } of [direct, wrapped]) {
            expect(err?.code).toBe('INVALID_METADATA');
            expect(err?.status).toBe(422);
            expect(rowsWritten).toBe(0);
        }
        const hit = (err: any, path: string) =>
            (err.issues as Array<{ path: string; code?: string; message: string }>)
                .find((i) => i.path === path && i.code === 'unrecognized_keys');
        const directHit = hit(direct.err, 'timeline');
        const wrappedHit = hit(wrapped.err, 'options.timeline');
        expect(directHit, JSON.stringify(direct.err.issues)).toBeDefined();
        expect(wrappedHit, JSON.stringify(wrapped.err.issues)).toBeDefined();
        // Refused by NAME, on the same surface text as the direct spelling.
        expect(wrappedHit!.message).toBe(directHit!.message);
        expect(wrappedHit!.message).toContain('`metaFields`');
    });

    it('an unknown key in the bag itself is refused by name, not dropped', async () => {
        const { err, rowsWritten } = await refusal(flatList({ timeline: { startDateField: 'created_at', titleField: 'name' }, options: { foo: 1 } }));
        expect(err?.code).toBe('INVALID_METADATA');
        expect(err?.status).toBe(422);
        expect(rowsWritten).toBe(0);
        expect((err.issues as Array<{ path: string; message: string }>).some((i) => i.path === 'options' && i.message.includes('`foo`')))
            .toBe(true);
    });

    it('a legal legacy `options.map` bag (the path objectui pins) saves, and the row carries it unchanged', async () => {
        const authored = {
            name: 'showcase_task.work_map',
            object: 'showcase_task',
            viewKind: 'list',
            label: 'Work Map',
            type: 'map',
            columns: ['title', 'location'],
            options: { map: { locationField: 'location', titleField: 'legacy_title' } },
        };
        const body = await storedViewBody('showcase_task.work_map', authored);
        expect(body.options).toEqual(authored.options);
        // …and the stored row passes the same door again: a GET → PUT of it is
        // not refused by the judgement it was saved under.
        expect((ViewMetadataSchema as any).safeParse(body).success).toBe(true);
    });
});

/**
 * #20186 — a flattened overlay is judged by the member its `viewKind` names,
 * pinned at the WRITE DOOR (the spec-side pins: `view-overlay-viewkind-arm.test.ts`).
 *
 * Before: a column-less `viewKind: 'list'` body was refused by the list member
 * (no `columns`) and ACCEPTED by the form member, which strips every list key —
 * so a retired `sort` string answered `success: true` and the row held it as
 * sent. Now the list member judges the column-less PATCH (the ruled storage
 * shape of every console toolbar save, maintainer ruling on #7494), and its
 * invalid list keys are refused, located, with nothing stored. Same double as
 * the blocks above, so the save runs the real repository path.
 */
describe('#20186 the save door judges a flattened overlay by the member its viewKind names', () => {
    const ID = { name: 'crm_lead.all', object: 'crm_lead' } as const;
    const LIST = { ...ID, viewKind: 'list' } as const;
    const FORM = { ...ID, viewKind: 'form' } as const;

    /** The refusal, with its envelope asserted and NO row written. */
    async function refused(item: Record<string, unknown>): Promise<Array<{ path: string; code?: string; message: string }>> {
        const { protocol, rows } = makeProtocol();
        let err: any;
        try {
            await (protocol as any).saveMetaItem({ type: 'view', name: item.name as string, item });
        } catch (e) { err = e; }
        expect(err?.code).toBe('INVALID_METADATA');
        expect(err?.status).toBe(422);
        expect(Array.from(rows.values()).filter((r) => r.type === 'view')).toHaveLength(0);
        return err.issues;
    }
    const at = (issues: Array<{ path: string; code?: string; message: string }>, path: string) => {
        const hit = issues.find((i) => i.path === path);
        expect(hit, `no issue at \`${path}\` in ${JSON.stringify(issues)}`).toBeDefined();
        return hit!;
    };

    it('the headline `{ name, object, viewKind: list, sort }` saves, and the row is the body as sent', async () => {
        const body = { ...LIST, sort: [{ field: 'name', order: 'asc' }] };
        expect(await storedViewBody(body.name, body)).toEqual(body);
    });

    it('the objectui sort toggle (`{ ...patch, viewKind }` + object / name / _isOverride) saves verbatim', async () => {
        const body = { sort: [{ field: 'name', order: 'desc' }], viewKind: 'list', ...ID, _isOverride: true };
        expect(await storedViewBody(body.name, body)).toEqual(body);
    });

    it('a retired bare-string `sort`: 422 at `sort`, with the 17.5.0 retirement prescription', async () => {
        const issue = at(await refused({ ...LIST, sort: 'name desc' }), 'sort');
        expect(issue.code).toBe('invalid_type');
        expect(issue.message).toContain('The bare string `sort` clause was removed from `view.sort` in @objectstack/spec 17.5.0');
    });

    it('the `timeline.metaFields` twin: 422 at `timeline`, naming the key', async () => {
        const issue = at(await refused({ ...LIST, timeline: { startDateField: 'created', titleField: 'name', metaFields: ['region'] } }), 'timeline');
        expect(issue.code).toBe('unrecognized_keys');
        expect(issue.message).toContain('Unrecognized key(s) on this timeline configuration: `metaFields`.');
    });

    it('a non-array `searchableFields`: 422 at `searchableFields`', async () => {
        expect(at(await refused({ ...LIST, searchableFields: 'name' }), 'searchableFields').code).toBe('invalid_type');
    });

    it('a form-style `sharing` on a list body: 422 at `sharing`', async () => {
        expect(at(await refused({ ...LIST, sharing: { enabled: true } }), 'sharing').code).toBe('unrecognized_keys');
    });

    it('a column-less list overlay that names a `type`: 422 at `columns`, with the prescription', async () => {
        const issue = at(await refused({ ...LIST, type: 'kanban', groupByField: 'stage' }), 'columns');
        expect(issue.code).toBe('custom');
        expect(issue.message).toMatch(/^This list view overlay sets `type` but lists no `columns`\./);
    });

    it('the mirror — list `columns` on a `viewKind: form` body: 422 at `columns`, with the count prescription', async () => {
        const issue = at(await refused({ ...FORM, columns: ['name'] }), 'columns');
        expect(issue.code).toBe('invalid_type');
        expect(issue.message).toMatch(/^On a form view `columns` is the NUMBER of body columns/);
    });

    // W2 — declared widening (`Clause-②: yes (narrowing)`): a list-legal value
    // under a key both members declare with different schemas, refused before
    // because the FORM member judged it.
    it.each([
        ['aria', { aria: { ariaLabel: 'Leads' } }],
        ['an i18n description', { description: { en: 'All leads' } }],
        ['list-style sharing', { sharing: { type: 'personal' } }],
    ])('W2: %s now saves verbatim', async (_label, extra) => {
        const body = { ...LIST, ...extra };
        expect(await storedViewBody(body.name, body)).toEqual(body);
    });

    it('controls: a real form overlay and a list overlay with `columns` save verbatim', async () => {
        const form = { ...FORM, type: 'simple', sections: [{ label: 'Main', fields: ['name'] }] };
        expect(await storedViewBody(form.name, form)).toEqual(form);
        const list = { ...LIST, columns: ['name'], sort: [{ field: 'name', order: 'asc' }] };
        expect(await storedViewBody(list.name, list)).toEqual(list);
    });
});

/**
 * [#20051] Stage (iv), ruling 甲 under letter B: a saved view stores the parsed
 * value of every key its request body carried — undeclared keys dropped,
 * schema defaults NOT materialised (ADR-0087's `storable` rule, the one flows
 * follow). Driven through the REAL `saveMetaItem`, reading the stored row.
 *
 * The toolbar bodies are the console's own writes at the `.objectui-sha` pin,
 * measured on the card (W1–W5): `buildPersistedViewBody`'s overlay branch plus
 * the identity and marker `updateViewConfig` stamps, and a sort entry carrying
 * the row id `ListView`'s header sort mints.
 */
describe('[#20051] stage (iv): a saved view stores the parsed value of every key its body carried', () => {
    const OVERLAY_ID = { viewKind: 'list', object: 'crm_lead', name: 'crm_lead.all', _isOverride: true } as const;
    const SORT_ROW_ID = '6f1c1e7a-0000-4000-8000-000000000001';
    const TOOLBAR_SAVES: Array<[string, Record<string, unknown>]> = [
        ['W1 sort', { sort: [{ id: SORT_ROW_ID, field: 'name', order: 'desc' }] }],
        ['W2 density', { rowHeight: 'compact' }],
        ['W3 hidden fields', { hiddenFields: ['status'] }],
        ['W4 column state', { columnState: { order: ['status', 'name'], widths: { name: 180 } } }],
        ['W5 inline edit', { inlineEdit: false }],
    ];

    it.each(TOOLBAR_SAVES)('%s: the stored row carries no `type` the author did not write', async (_label, patch) => {
        const body = { ...patch, ...OVERLAY_ID };
        // The default is real: the parse of this very body names a list type.
        expect((ViewMetadataSchema as any).parse(body).type).toBe('grid');
        const stored = await storedViewBody(body.name, body);
        expect(stored).not.toHaveProperty('type');
        // Everything the patch said is stored, and nothing else.
        const expected = 'sort' in patch
            ? { ...body, sort: [{ field: 'name', order: 'desc' }] }
            : body;
        expect(stored).toEqual(expected);
    });

    it('W1: a sort row id the console mints is not stored (`VIEW_CONSOLE_ROW_DECORATIONS`)', async () => {
        const body = { ...TOOLBAR_SAVES[0][1], ...OVERLAY_ID };
        const stored = await storedViewBody(body.name, body);
        expect(stored.sort).toEqual([{ field: 'name', order: 'desc' }]);
    });

    it('an undeclared key is dropped: the saved-view toolbar toggle\'s `id` / `objectName`, and a form-only `layout`', async () => {
        // W6b's shape: `buildPersistedViewBody`'s saved-view branch writes the
        // whole tab back, and the tab carries `id` and `objectName`.
        const declared = {
            name: 'crm_lead.my_leads',
            object: 'crm_lead',
            viewKind: 'list',
            label: 'My leads',
            type: 'grid',
            columns: ['name', 'status'],
            data: { provider: 'object', object: 'crm_lead' },
            isDefault: false,
        };
        const stored = await storedViewBody(declared.name, {
            ...declared, id: 'crm_lead.my_leads', objectName: 'crm_lead', layout: 'diagonal',
        });
        expect(stored).toEqual(declared);
    });

    it('a declared key keeps its normalised value', async () => {
        const stored = await storedViewBody('crm_lead.open', {
            name: 'crm_lead.open',
            object: 'crm_lead',
            viewKind: 'list',
            type: 'grid',
            columns: ['name'],
            exportOptions: ['csv'],
            filter: [{ field: 'status', operator: 'notEquals', value: 'done' }],
        });
        expect(stored.exportOptions).toEqual({ formats: ['csv'] });
        expect(stored.filter).toEqual([{ field: 'status', operator: 'not_equals', value: 'done' }]);
    });

    it('a key moved inside a moved key is stored under its canonical spelling, with no default beside it', async () => {
        // Two levels of key move: `groups` → `sections`, and within each section
        // and field `visibleOn` → `visibleWhen`. Neither graft covered the
        // second; the projection finds both by re-parsing, so the stored row
        // keeps the predicates and drops the section / field defaults.
        const stored = await storedViewBody('contact_us', flatForm({
            groups: [{
                label: 'About you',
                visibleOn: 'record.stage == "open"',
                fields: ['name', { field: 'email', visibleOn: 'record.opted_in == true' }],
            }],
        }));
        expect(stored).not.toHaveProperty('groups');
        expect(stored.sections).toEqual([{
            label: 'About you',
            visibleWhen: { dialect: 'cel', source: 'record.stage == "open"' },
            fields: ['name', { field: 'email', visibleWhen: { dialect: 'cel', source: 'record.opted_in == true' } }],
        }]);
        expect(stored.sharing).toEqual(SHARING);
    });

    it('the persisted body parses to exactly what the save parsed', async () => {
        const bodies: Array<Record<string, unknown>> = [
            ...TOOLBAR_SAVES.map(([, patch]) => ({ ...patch, ...OVERLAY_ID })),
            flatForm({ groups: [SECTION], isPinned: true }),
            {
                name: 'lead.contact_us', object: 'lead', viewKind: 'form', label: 'Contact us',
                config: { type: 'simple', data: DATA, sharing: SHARING, groups: [SECTION] },
            },
            {
                name: 'lead_views',
                list: { type: 'grid', data: DATA, columns: ['name'] },
                formViews: { intake: { type: 'simple', data: DATA, groups: [SECTION] } },
            },
        ];
        for (const body of bodies) {
            const stored = await storedViewBody(body.name as string, body);
            expect((ViewMetadataSchema as any).parse(stored), JSON.stringify(body))
                .toEqual((ViewMetadataSchema as any).parse(body));
        }
    });
});

/**
 * [#20051] Stage (iv), Q3: a top-level `options` bag on a ViewItem RECORD is
 * refused by name, with the prescription to write `config.KIND`. Before, the
 * record member's `.strip()` dropped it from the parse unread while the save
 * stored it; with the parsed body stored it would vanish on a `200`.
 */
describe('[#20051] stage (iv): a ViewItem record\'s top-level `options` bag is refused by name', () => {
    const RECORD = {
        name: 'crm_lead.board',
        object: 'crm_lead',
        viewKind: 'list',
        label: 'Board',
        config: {
            type: 'kanban',
            data: { provider: 'object', object: 'crm_lead' },
            columns: ['name'],
            kanban: { groupByField: 'stage', columns: ['name'] },
        },
    };

    async function refusedRecord(item: Record<string, unknown>) {
        const { protocol, rows } = makeProtocol();
        let err: any;
        try {
            await (protocol as any).saveMetaItem({ type: 'view', name: item.name as string, item });
        } catch (e) { err = e; }
        expect(err?.code).toBe('INVALID_METADATA');
        expect(err?.status).toBe(422);
        expect(Array.from(rows.values()).filter((r) => r.type === 'view')).toHaveLength(0);
        const issue = (err.issues as Array<{ path: string; code?: string; message: string }>)
            .find((i) => i.path === 'options');
        expect(issue, JSON.stringify(err.issues)).toBeDefined();
        return issue!;
    }

    it('on the list arm: 422 at `options`, naming the move to `config.KIND`', async () => {
        const issue = await refusedRecord({ ...RECORD, options: { kanban: { groupByField: 'stage' } } });
        expect(issue.message).toMatch(/^A view item record carries no top-level `options` bag/);
        expect(issue.message).toContain('Move each `options.KIND` block to `config.KIND`');
    });

    it('on the form arm too', async () => {
        const issue = await refusedRecord({
            name: 'lead.contact_us', object: 'lead', viewKind: 'form', label: 'Contact us',
            config: { type: 'simple', data: DATA, sections: [SECTION] },
            options: { timeline: { titleField: 'name' } },
        });
        expect(issue.message).toMatch(/^A view item record carries no top-level `options` bag/);
    });

    it('control: the same record without the bag saves, and the row is the record', async () => {
        expect(await storedViewBody(RECORD.name, RECORD)).toEqual(RECORD);
    });
});

/**
 * [#20051] Stage (iv) is gated on the `view` type. Every other type keeps its
 * request body (with the two grafts), which a page shows: its parse turns a
 * component's CEL string into an expression object and adds `properties: {}`,
 * and neither reaches the row.
 */
describe('[#20051] stage (iv): the projection is view-only', () => {
    it('a page is stored as sent, not as parsed', async () => {
        const component = { type: 'record:details', visibleWhen: 'record.stage == "open"' };
        const page = { name: 'lead_record', label: 'Lead', type: 'record', object: 'lead', regions: [{ name: 'main', components: [component] }] };
        const { protocol, rows } = makeProtocol();
        const result: any = await (protocol as any).saveMetaItem({ type: 'page', name: page.name, item: page });
        expect(result.success, JSON.stringify(result)).toBe(true);
        const row = Array.from(rows.values()).find((r) => r.type === 'page');
        const stored = JSON.parse(row!.metadata);
        expect(stored.regions[0].components[0]).toEqual(component);
    });
});

/**
 * [#20051] The save's fail-safe arm, driven through the REAL `saveMetaItem`:
 * when {@link projectStorableViewBody} does not converge, the view is stored
 * as its whole parse output and a warning is logged ONCE per view name.
 *
 * No `view` schema reaches that arm today, so the seam is the production API
 * a plugin uses to replace a type's schema, `registerMetadataTypeSchema` —
 * never a test-only hook. The stand-in schema's parse is not idempotent (it
 * bumps a counter on every parse), so no body re-parses to what the save
 * parsed. The built-in `view` schema is registered back in `finally`.
 */
describe('[#20051] stage (iv): the non-converging fallback stores the parse output and warns once per view', () => {
    const nonConverging = z.object({
        name: z.string(),
        object: z.string(),
        viewKind: z.literal('list'),
        n: z.number().transform((v) => v + 1),
    });
    const FALLBACK_WARNING = 'no body of only the keys the request carried re-parses to the same view';

    it('two saves of one view warn once; a second view warns on its own', async () => {
        const builtin = getMetadataTypeSchema('view')!;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerMetadataTypeSchema('view', nonConverging);
        try {
            const { protocol, rows } = makeProtocol();
            const save = (name: string, n: number) => (protocol as any).saveMetaItem({
                type: 'view', name, item: { name, object: 'crm_lead', viewKind: 'list', n },
            });
            await save('crm_lead.a', 1);
            await save('crm_lead.a', 5);
            const fallbackWarnings = () => warn.mock.calls
                .map((call) => String(call[0]))
                .filter((line) => line.includes(FALLBACK_WARNING));
            expect(fallbackWarnings()).toHaveLength(1);
            expect(fallbackWarnings()[0]).toContain('view/crm_lead.a');
            // The row is the whole parse output of the LAST save — not the
            // authored body (`n: 5`), and no key lost.
            const row = Array.from(rows.values()).find((r) => r.type === 'view' && r.name === 'crm_lead.a');
            expect(JSON.parse(row!.metadata)).toEqual({ name: 'crm_lead.a', object: 'crm_lead', viewKind: 'list', n: 6 });

            await save('crm_lead.b', 1);
            expect(fallbackWarnings()).toHaveLength(2);
            expect(fallbackWarnings()[1]).toContain('view/crm_lead.b');
        } finally {
            registerMetadataTypeSchema('view', builtin);
            warn.mockRestore();
        }
        expect(getMetadataTypeSchema('view')).toBe(builtin);
    });
});
