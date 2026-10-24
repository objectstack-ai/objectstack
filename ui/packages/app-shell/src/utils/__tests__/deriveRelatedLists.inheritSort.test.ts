/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5795 — a derived related list inherits the CHILD object's default
 * list view `sort`.
 *
 * Ruled on objectstack#11345 (maintainer, 2026-08-23 15:02Z) as **direction
 * 1**: inherit the child's list-view sort, and add **no** new spec key — the
 * field-level `relatedListSort` the issue also offered was explicitly not
 * approved. So there is nothing new to author: the ordering a child object
 * already declares for its own list is the ordering its related lists use,
 * exactly as `columns` already defaults to that list's columns.
 *
 * ## The dialect trap this file exists to pin
 *
 * `ListView.sort` and `record:related_list.sort` declare the SAME union
 * (`string | Array<{field, order}>`) in `@objectstack/spec` and mean DIFFERENT
 * things by the string arm:
 *
 *   - ListView's string is the legacy space-separated clause, `'seq_no desc'`
 *     (`@objectstack/spec` `ui/view.zod.ts`, annotated `Legacy "field desc"`);
 *   - the related list's own `normalizeSortSpec` (`plugin-detail/RelatedList
 *     .tsx`) reads the OData-ish `'field'` / `'-field'`.
 *
 * Inheriting the string verbatim therefore does not produce "a sort in another
 * notation" — it produces `$orderby` on a field whose NAME is the seven
 * characters `seq_no desc`, which no object has. The route taken is to resolve
 * that at this boundary, always to the ARRAY arm, through `@object-ui/core`'s
 * `convertSortToQueryParams`, so no second parser of the legacy string exists
 * to drift from it. `deriveRelatedLists` is the ONE place that knows it is
 * reading a ListView and writing a related list, which is why the resolution
 * belongs here and not as a tolerant reader on the consuming end
 * (AGENTS.md #0.1).
 *
 * ## What objectui#8221 changed, and what it did NOT
 *
 * Decision batch #77 (option B) RETIRED the legacy space-separated clause:
 * `convertSortToQueryParams` no longer lowers it, it REFUSES it with a
 * diagnostic naming the array form. So this boundary no longer TRANSLATES a
 * ListView string — it drops it and says so, and the pins below moved with it.
 *
 * ⚠️ The trap the old translation prevented is still prevented, and that is the
 * assertion worth keeping: a legacy string must never reach the wire as a FIELD
 * NAME. "Refused, loudly" and "translated" both satisfy that; "forwarded
 * verbatim" does not, and is what a later well-meaning simplification here
 * would reintroduce.
 *
 * ⚠️ Measured, and the reason this is a behaviour change rather than a
 * tidy-up: `@objectstack/spec@17.3.0`'s `ListViewSchema.sort` STILL accepts the
 * string (`'name desc'` parses; `42` is refused `invalid_union`; a `bogusProp`
 * control is refused by name on the same call). A platform view carrying the
 * legacy clause is therefore still spec-legal and stops being inherited here.
 * The spec-side pull-back is its own card; until it lands, this diagnostic is
 * the only thing standing between an operator and a silently unordered list.
 */

import { describe, it, expect, vi } from 'vitest';
import { resetRetiredSortSpellingReports } from '@object-ui/core';
import { deriveRelatedLists } from '../deriveRelatedLists';

const PARENT = { name: 'task_version', label: 'Task Version', fields: {} };

/**
 * Shaped after the issue's downstream case: a "task version" owns "check
 * items" that carry an explicit `seq_no` (10/20/30/40), which rendered in
 * record-id order because the derivation emitted no `sort` at all.
 */
const childWithList = (list: unknown) => ({
  name: 'check_item',
  label: 'Check Item',
  ...(list === undefined ? {} : { list }),
  fields: {
    seq_no: { type: 'number', label: 'Seq No' },
    task_version: { type: 'master_detail', reference: 'task_version', label: 'Task Version' },
  },
});

const derive = (child: unknown) =>
  deriveRelatedLists(PARENT, [PARENT, child as any])[0];

describe('deriveRelatedLists — inherited default list-view sort (objectui#5795)', () => {
  it('SUBJECT — inherits the array arm of the child list view sort', () => {
    const entry = derive(childWithList({ sort: [{ field: 'seq_no', order: 'asc' }] }));
    expect(entry.childObject).toBe('check_item');
    expect(entry.sort).toEqual([{ field: 'seq_no', order: 'asc' }]);
  });

  it('preserves a multi-key authored order, in the order authored', () => {
    // Key order matters and survives the map round-trip inside the
    // normalizer because every ObjectStack field name matches
    // `^[a-z_][a-z0-9_]*$` — none is an integer-like key JS would hoist.
    const entry = derive(
      childWithList({
        sort: [
          { field: 'stage', order: 'desc' },
          { field: 'seq_no', order: 'asc' },
        ],
      }),
    );
    expect(entry.sort).toEqual([
      { field: 'stage', order: 'desc' },
      { field: 'seq_no', order: 'asc' },
    ]);
  });

  it('THE RETIREMENT PIN — a legacy string arm is REFUSED, and refused OUT LOUD (objectui#8221)', () => {
    resetRetiredSortSpellingReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const entry = derive(childWithList({ sort: 'seq_no desc' }));

      // Nothing is inherited: the key is ABSENT, exactly as for a child that
      // declared no order at all.
      expect('sort' in entry).toBe(false);
      // The list itself is still derived — so the missing key means "this
      // order was refused", not "this derivation collapsed".
      expect(entry.childObject).toBe('check_item');

      // The original failure mode stays impossible: the seven characters
      // `seq_no desc` must never travel as a FIELD NAME.
      expect(JSON.stringify(entry)).not.toContain('seq_no desc');

      // And it is LOUD. A silent drop here is an operator's row order
      // disappearing with nothing in the console to explain it.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const message = String(errorSpy.mock.calls[0][0]);
      expect(message).toContain("[{ field: 'name', order: 'desc' }]");
      expect(message).toContain('"seq_no desc"');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('the other legacy spellings are refused the same way', () => {
    for (const spelling of ['seq_no', 'seq_no DESC']) {
      resetRetiredSortSpellingReports();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect('sort' in derive(childWithList({ sort: spelling }))).toBe(false);
        expect(errorSpy).toHaveBeenCalledTimes(1);
      } finally {
        errorSpy.mockRestore();
      }
    }

    // CONTROL — on the same derivation, the array arm still inherits, so the
    // refusals above are about the SPELLING and not a broken boundary.
    expect(derive(childWithList({ sort: [{ field: 'seq_no', order: 'desc' }] })).sort).toEqual([
      { field: 'seq_no', order: 'desc' },
    ]);
  });

  it('COUNTER-PROBE — a child with no list-view sort gains no `sort` key at all', () => {
    // Not `[]`, not `undefined`-valued: the key is ABSENT, so the synthesized
    // node stays byte-identical to what it was before this inheritance
    // existed. Were it present-and-empty, "inherited nothing" and "inherited
    // an order" would be indistinguishable downstream — and inheritance would
    // be satisfiable by inventing an order.
    for (const list of [undefined, {}, { sort: undefined }, { sort: '' }, { sort: [] }]) {
      const entry = derive(childWithList(list));
      expect(entry.childObject).toBe('check_item');
      expect('sort' in entry).toBe(false);
    }
  });

  it('COUNTER-PROBE — an unusable `sort` is dropped, never guessed at', () => {
    for (const sort of [42, { field: 'seq_no' }, ['seq_no'], [{ order: 'desc' }], null]) {
      expect('sort' in derive(childWithList({ sort }))).toBe(false);
    }
  });

  it('applies the same inherited order to EVERY related list of that child', () => {
    // A child may point at one parent through several FKs; each surfaces as
    // its own list, and all of them list the same object, so all inherit the
    // same declared order.
    const child = {
      name: 'check_item',
      label: 'Check Item',
      list: { sort: [{ field: 'seq_no', order: 'asc' }] },
      fields: {
        seq_no: { type: 'number', label: 'Seq No' },
        owner_version: { type: 'master_detail', reference: 'task_version', label: 'Owner' },
        review_version: { type: 'lookup', reference: 'task_version', label: 'Reviewer' },
      },
    };
    const entries = deriveRelatedLists(PARENT, [PARENT, child as any]);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.sort).toEqual([{ field: 'seq_no', order: 'asc' }]);
    }
  });

  it('leaves an unrelated child list untouched when only one child declares a sort', () => {
    const sorted = childWithList({ sort: [{ field: 'seq_no', order: 'asc' }] });
    const unsorted = {
      name: 'attachment_note',
      label: 'Note',
      fields: {
        task_version: { type: 'lookup', reference: 'task_version', label: 'Task Version' },
      },
    };
    const entries = deriveRelatedLists(PARENT, [PARENT, sorted as any, unsorted as any]);
    const byObject = Object.fromEntries(entries.map((e) => [e.childObject, e]));
    expect(byObject.check_item.sort).toEqual([{ field: 'seq_no', order: 'asc' }]);
    expect('sort' in byObject.attachment_note).toBe(false);
  });
});
