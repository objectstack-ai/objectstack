// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7467] `publicPicker` is DECLARABLE — the acceptance surface for the
 * public-lookup opt-in, through the real parse doors.
 *
 * `GET /forms/:slug/lookup/:field` (`packages/rest/src/rest-server.ts`) has
 * always gated the anonymous picker on a `publicPicker` block on the field's
 * form declaration — and until #7467 that key was declared in NO schema, so
 * `FormFieldSchema`'s strictness (ADR-0089 D3a) refused every form carrying
 * one: the capability was enforced but unreachable, ADR-0049's "declared ≠
 * enforced" in the mirror direction. The maintainer ruled DECLARE (option 1 of
 * the card's fork), and these tests pin both halves of that ruling:
 *
 *  - the card's measured-rejected fixture now parses, through the SAME doors
 *    that refused it (`ViewMetadataSchema.safeParse` on the ViewItem branch,
 *    and `FormViewSchema.parse` for code-authored forms);
 *  - the block admits NOTHING the route does not enforce — unknown subkeys are
 *    still `unrecognized_keys` (loud, ADR-0089 D3a), and the route's hard
 *    bounds are encoded: `maxResults` beyond the route's ceiling of 50 and
 *    `displayFields` beyond the 5 the route projects are refused at authoring
 *    time instead of silently clamped/sliced at request time. This is a
 *    security-relevant surface (it opens an UNAUTHENTICATED search), so the
 *    schema is deliberately the narrow mirror of the route's reads.
 */

import { describe, expect, it } from 'vitest';
import { FormViewSchema, ViewMetadataSchema } from './view.zod';

/** The card's fixture, verbatim: measured `unrecognized_keys`-rejected on main @ 08363a09f. */
const CARD_FIELD = { field: 'owner', publicPicker: { displayFields: ['name'] } };

/** A ViewItem-branch form carrying one declared field. */
const viewItem = (field: unknown) => ({
    name: 'lead.contact',
    object: 'lead',
    viewKind: 'form',
    label: 'Contact us',
    config: {
        type: 'simple',
        data: { provider: 'object', object: 'lead' },
        sections: [{ label: 'About you', fields: [field] }],
    },
});

describe('#7467 the card\'s measured-rejected fixture now parses', () => {
    it('ViewMetadataSchema (ViewItem branch) accepts { field: owner, publicPicker: { displayFields: [name] } }', () => {
        const r = ViewMetadataSchema.safeParse(viewItem(CARD_FIELD));
        expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
    });

    it('FormViewSchema.parse — the code-authored door is the same door', () => {
        const parsed = FormViewSchema.parse({
            type: 'simple',
            sections: [{ label: 'About you', fields: [CARD_FIELD] }],
        });
        const field: any = parsed.sections?.[0]?.fields?.[0];
        expect(field.publicPicker).toEqual({ displayFields: ['name'] });
    });

    it('an EMPTY block is a valid opt-in — the route supplies its own defaults', () => {
        // The route treats any truthy `publicPicker` as the opt-in and defaults
        // displayFields to ['name'] and maxResults to 20. `{}` is therefore a
        // real declaration, not a mistake — refusing it would make the shortest
        // correct authoring spelling a 422.
        const r = ViewMetadataSchema.safeParse(viewItem({ field: 'owner', publicPicker: {} }));
        expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
    });

    it('the full surface parses: displayFields + maxResults + filter + object — the route\'s exact read set', () => {
        const r = ViewMetadataSchema.safeParse(viewItem({
            field: 'owner',
            publicPicker: {
                displayFields: ['name', 'email'],
                maxResults: 50,
                filter: [{ field: 'is_active', operator: 'equals', value: true }],
                object: 'sys_user',
            },
        }));
        expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
    });

    it('GUARD: a bare field declaration without a picker still parses — the opt-in stays an opt-in', () => {
        const r = ViewMetadataSchema.safeParse(viewItem({ field: 'owner' }));
        expect(r.success).toBe(true);
    });
});

describe('#7467 the block admits nothing the route does not enforce', () => {
    it('an unknown subkey is still `unrecognized_keys` — loud per ADR-0089 D3a, not dropped', () => {
        // The nearest-miss an author will actually type: pagination does not
        // exist on this surface (the route pins offset to 0 so an anonymous
        // visitor cannot enumerate the table). It must be a parse error, not a
        // silently-dropped key that ships an author a false setting.
        const r = FormViewSchema.safeParse({
            type: 'simple',
            sections: [{
                label: 'About you',
                fields: [{ field: 'owner', publicPicker: { displayFields: ['name'], offset: 10 } }],
            }],
        });
        expect(r.success).toBe(false);
        const issues = r.error?.issues ?? [];
        expect(JSON.stringify(issues)).toContain('unrecognized_keys');
        expect(JSON.stringify(issues)).toContain('offset');
    });

    it('maxResults: 51 is refused — the route clamps to a hard ceiling of 50, so 51 is a lie', () => {
        const r = ViewMetadataSchema.safeParse(viewItem({
            field: 'owner',
            publicPicker: { maxResults: 51 },
        }));
        expect(r.success).toBe(false);
    });

    it('maxResults: 0, negatives and fractions are refused — the route would never honor them', () => {
        // The route computes Math.min(Math.max(1, Number(v) || 20), 50): 0 is
        // falsy and becomes the default, negatives clamp to 1, and a fraction
        // would flow into `limit`. None of those spellings ever executes as
        // written, so authoring one is refused instead of silently rewritten.
        for (const maxResults of [0, -5, 2.5]) {
            const r = ViewMetadataSchema.safeParse(viewItem({
                field: 'owner',
                publicPicker: { maxResults },
            }));
            expect(r.success, `maxResults: ${maxResults} must be refused`).toBe(false);
        }
    });

    it('a 6th displayField is refused — the route projects at most 5', () => {
        const r = ViewMetadataSchema.safeParse(viewItem({
            field: 'owner',
            publicPicker: { displayFields: ['a', 'b', 'c', 'd', 'e', 'f'] },
        }));
        expect(r.success).toBe(false);
    });

    it('displayFields: [] is refused — the route treats an empty list as absent, so it never means what it says', () => {
        const r = ViewMetadataSchema.safeParse(viewItem({
            field: 'owner',
            publicPicker: { displayFields: [] },
        }));
        expect(r.success).toBe(false);
    });

    it('a malformed filter row is refused through the shared rule dialect (#6227 shape coupling included)', () => {
        // `filter` reuses ViewFilterRuleSchema — the same dialect the route
        // composes with its own `{ field, operator: 'contains', value: q }`
        // search row. A set operator with a scalar comparand is the #6227
        // authoring defect; it must be refused here exactly as on every other
        // filter carrier, not deferred to a public 400 at request time.
        const r = ViewMetadataSchema.safeParse(viewItem({
            field: 'owner',
            publicPicker: { filter: [{ field: 'stage', operator: 'not_in', value: 'won' }] },
        }));
        expect(r.success).toBe(false);
    });

    it('picker.sort is NOT declarable — undeclared reads stay loud until ruled on', () => {
        // The route also reads `picker.sort` (rest-server.ts, the lookup
        // handler's findData call) — a fifth read the #7467 card's enumeration
        // does not include. The ruling bounds this change to the four keys
        // above, so `sort` stays undeclared and a form authoring one is a
        // parse error rather than a silently-admitted key; recorded as a
        // follow-up finding on the card. If a later ruling declares it, this
        // pin is the reminder to encode its shape from the route's actual read.
        const r = ViewMetadataSchema.safeParse(viewItem({
            field: 'owner',
            publicPicker: { sort: [{ field: 'name', order: 'asc' }] },
        }));
        expect(r.success).toBe(false);
    });
});
