// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data API's sort door and the served sortability projection answer one
 * question — is this field's TYPE computed on read, with no column to order
 * by — from one source, `isVirtualSearchField` (`@objectstack/spec/data`).
 *
 * The door (`assertSortFieldsExist`, third verdict) used to judge it by a set
 * of its own, `formula` alone, while the projection
 * (`resolveObjectSortability`, `reason: 'virtual-type'`) read the spec's. Two
 * one-member sets agree only while neither grows:
 *
 * - a type added to the door's alone is a sort the grid offers (the
 *   projection still says `sortable: true`) and the Data API refuses;
 * - a type added to the spec's alone is still refused, by the door's FOURTH
 *   verdict, which reads the projection and words every refusal as an
 *   author's `sortable: false` — the wrong reason for a computed type.
 *
 * So this file does not copy a verdict table. For EVERY member of the spec's
 * `FieldType` it asks the projection, then holds the door to that answer, and
 * it tells the door's third verdict from its fourth without reading a
 * sentence: the third names the computed fields alone, the fourth names every
 * field the projection calls unsortable. Sorting by the field under test AND
 * by a companion that declares `sortable: false` therefore answers
 *
 *   third verdict   →  `fields: [<the field>]`
 *   fourth verdict  →  `fields: [<the companion>]`             (type not computed)
 *                      `fields: [<the field>, <the companion>]` (the two parted)
 *
 * and the third row is what the old local set answers the day the spec's set
 * grows without it.
 */

import { describe, it, expect, vi } from 'vitest';
// `./protocol.js` reaches `@objectstack/lint` only through a dynamic import; paid
// here at module scope so the first load lands during collection, not inside a
// clocked window (`pnpm check:test-source-alias`).
import '@objectstack/lint';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { FieldType } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './protocol.js';

const OBJECT = 'sort_agreement_37386';

/** Every field type the spec knows, as the enum lists them. */
const FIELD_TYPES: readonly string[] = FieldType.options;

const fieldOf = (type: string) => `f_${type}`;

/** A stored column whose author declared it unsortable: the door's fourth verdict, by construction. */
const COMPANION = 'declared_unsortable';

const DEFINITION = {
    name: OBJECT,
    fields: {
        ...Object.fromEntries(FIELD_TYPES.map((type) => [fieldOf(type), { name: fieldOf(type), type }])),
        [COMPANION]: { name: COMPANION, type: 'text', sortable: false },
    },
};

/** The projection's verdicts over the same definition the door's registry serves. */
const PROJECTION = resolveObjectSortability(DEFINITION).fields;

const computedByProjection = (type: string) => PROJECTION[fieldOf(type)]?.reason === 'virtual-type';

function makeProtocol() {
    const find = vi.fn(async () => []);
    const engine = { registry: { getObject: (name: string) => (name === OBJECT ? DEFINITION : undefined) }, find };
    return { protocol: new ObjectStackProtocolImplementation(engine as any), find };
}

/** What the door answers a sort by `fields`: the refusal it threw, or the `orderBy` it handed the engine. */
async function sortBy(fields: readonly string[]) {
    const { protocol, find } = makeProtocol();
    const orderBy = fields.map((field) => ({ field, order: 'asc' as const }));
    try {
        await protocol.findData({ object: OBJECT, query: { orderBy } });
    } catch (err) {
        const refusal = err as { code?: unknown; status?: unknown; field?: unknown; fields?: unknown };
        return { refused: { code: refusal.code, status: refusal.status, field: refusal.field, fields: refusal.fields }, reads: find.mock.calls.length };
    }
    const options = (find.mock.calls[0] as unknown[] | undefined)?.[1] as { orderBy?: unknown } | undefined;
    return { applied: options?.orderBy, reads: find.mock.calls.length };
}

describe('the sort door and the sortability projection agree on which field types are computed (#37386)', () => {
    it('the table is not empty on either side: the spec knows a computed type and a stored one', () => {
        // Without both, every row below would agree about nothing.
        expect(FIELD_TYPES.filter(computedByProjection), 'field types the projection calls virtual').not.toEqual([]);
        expect(FIELD_TYPES.filter((type) => !computedByProjection(type)), 'field types the projection calls stored').not.toEqual([]);
        // The companion is the fourth verdict's, whatever the field beside it.
        expect(PROJECTION[COMPANION]).toEqual({ sortable: false, reason: 'author-declared' });
    });

    it.each(FIELD_TYPES)('a sort by a `%s` field alone is refused exactly when the projection calls it unsortable', async (type) => {
        const answer = await sortBy([fieldOf(type)]);
        if (PROJECTION[fieldOf(type)]?.sortable === false) {
            expect(answer).toEqual({
                refused: { code: 'INVALID_SORT', status: 400, field: fieldOf(type), fields: [fieldOf(type)] },
                reads: 0,
            });
        } else {
            // CONTROL — what the grid may offer, the Data API performs.
            expect(answer).toEqual({ applied: [{ field: fieldOf(type), order: 'asc' }], reads: 1 });
        }
    });

    it.each(FIELD_TYPES)('a `%s` field gets the computed-type verdict exactly when the projection says `virtual-type`', async (type) => {
        const answer = await sortBy([fieldOf(type), COMPANION]);
        // The third verdict names the computed field alone and outranks the
        // fourth; with no computed field the fourth names the companion alone.
        const named = computedByProjection(type) ? fieldOf(type) : COMPANION;
        expect(answer).toEqual({
            refused: { code: 'INVALID_SORT', status: 400, field: named, fields: [named] },
            reads: 0,
        });
    });
});
