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
 */
import { describe, expect, it } from 'vitest';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
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
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
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

    it('the fold and the Studio round-trip keys COEXIST on one save', async () => {
        // The combined statement, and the reason a wholesale `parsed.data` swap
        // was never an option: that swap would fold the key and strip
        // `isPinned` / `isDefault` / `sortOrder`; persisting verbatim keeps them
        // and folds nothing. Only the graft does both. Evidence, not a guard —
        // the `sections` half goes red on revert.
        const body = await storedViewBody(
            'contact_us',
            flatForm({ groups: [SECTION], isPinned: true, isDefault: false, sortOrder: 3 }),
        );
        expect(body.sections).toEqual([SECTION]);
        expect(body).not.toHaveProperty('groups');
        expect({ isPinned: body.isPinned, isDefault: body.isDefault, sortOrder: body.sortOrder })
            .toEqual({ isPinned: true, isDefault: false, sortOrder: 3 });
    });
});

describe('#7134 what the save path must NOT change', () => {
    it('GUARD: Studio-only round-trip keys still survive the save', async () => {
        // GUARD, green in BOTH directions — the reason `parsed.data` is
        // discarded at all (ADR-0005 §Validation). It asserts ONLY the
        // round-trip keys: a `sections` assertion here would be evidence for
        // the fix wearing a guard's label, which is the mislabel this file's
        // reverse-verification caught. The two claims are pinned together in
        // the coexistence case above, where the combined statement belongs.
        const body = await storedViewBody(
            'contact_us',
            flatForm({ groups: [SECTION], isPinned: true, isDefault: false, sortOrder: 3 }),
        );
        expect(body.isPinned).toBe(true);
        expect(body.isDefault).toBe(false);
        expect(body.sortOrder).toBe(3);
    });

    it('GUARD: a form authored with canonical `sections` is stored byte-identical', async () => {
        // Also green in both directions: nothing folded, so nothing to graft.
        const authored = flatForm({ sections: [SECTION], isPinned: true });
        const body = await storedViewBody('contact_us', authored);
        expect(body).toEqual(authored);
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
