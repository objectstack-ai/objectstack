/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  getRecordDisplayName,
  leadWithNameField,
  resolveNameField,
} from '@object-ui/core';
import {
  deriveHighlightFields,
  resolveTitleField,
  type ObjectDefLike,
} from '../buildDefaultPageSchema';

/**
 * objectui#7287 — `resolveTitleField` must BE the shared ADR-0079 ladder, not a
 * second one that happens to agree.
 *
 * ADR-0079 collapsed ~6 divergent record-title resolvers (`record-title.ts`'s
 * own header tells that story, and the "Untitled everywhere" bug it produced).
 * `plugin-detail` grew one back: a private ladder topped by `def.primaryField`
 * — a `DetailViewSchema` key (`@object-ui/types` `views.ts`) read off an
 * OBJECT def — with a literal `['name','full_name','title','subject',
 * 'display_name']` walk underneath that matches on NAME with no type check.
 *
 * These tests pin the two halves that a second ladder cannot give you:
 *
 *  1. the `primaryField` rung is GONE (each test here goes red the moment it
 *     returns to the chain — that is what makes them discriminating rather
 *     than merely descriptive);
 *  2. the detail page, the list column and the lookup chip resolve the SAME
 *     field for the same object — asserted against core's OTHER consumers
 *     (`getRecordDisplayName`, `leadWithNameField`), not by re-reading
 *     `resolveNameField` back at itself, so the assertions still mean
 *     something if the delegation is ever unwound.
 */
describe('[#7287] resolveTitleField delegates to the shared ADR-0079 ladder', () => {
  describe('the `primaryField` rung is gone', () => {
    /**
     * `primaryField` is not a key any producer can put on an object.
     * `@objectstack/spec`'s object schema is a `strictObject`: `safeParse`
     * answers `unrecognized_keys: ['primaryField']` and `ObjectSchema.create()`
     * throws — which is why objectstack#6326 deleted the identical read from
     * two lint rules. Reading it here ranked a view key ABOVE the canonical
     * `nameField` that ADR-0079 Phase 2 made the pointer.
     */
    it('does not let `primaryField` outrank the canonical `nameField`', () => {
      const def = {
        primaryField: 'ref_no',
        nameField: 'name',
        fields: { ref_no: { type: 'text' }, name: { type: 'text' } },
      } as unknown as ObjectDefLike;
      expect(resolveTitleField(def)).toBe('name');
    });

    it('does not let `primaryField` outrank the type-aware derivation', () => {
      const def = {
        primaryField: 'ref_no',
        fields: { ref_no: { type: 'text' }, name: { type: 'text' } },
      } as unknown as ObjectDefLike;
      // `name` is name-ish-exact, `ref_no` is not: the shared ladder ranks
      // `name` first. With the rung present, `ref_no` won regardless.
      expect(resolveTitleField(def)).toBe('name');
    });

    it('does not let `primaryField` keep the H1 field out of the highlight strip', () => {
      const def = {
        primaryField: 'ref_no',
        fields: {
          ref_no: { type: 'text' },
          name: { type: 'text' },
          priority: { type: 'text' },
        },
      } as unknown as ObjectDefLike;
      // The strip skips the field the H1 actually shows (`name`), and no
      // longer burns a slot hiding `ref_no`, which the H1 never shows.
      expect(deriveHighlightFields(def, null)).toContain('ref_no');
      expect(deriveHighlightFields(def, null)).not.toContain('name');
    });
  });

  describe('the detail page, the list column and the lookup chip agree', () => {
    /**
     * The card's first divergence example, executed. `headline` is the only
     * title-eligible field, so core derives it and the H1 renders its value —
     * while the old literal walk knew only five names, returned `null`, and
     * left the detail page skipping nothing.
     */
    it('a derived title field (`headline`) resolves the same on every surface', () => {
      const def = {
        fields: { due_at: { type: 'datetime' }, headline: { type: 'text' } },
      } as unknown as ObjectDefLike;
      const record = { id: 'r1', due_at: '2026-01-01', headline: 'Q3 rollout' };

      // detail page (this module) === list/lookup (core)
      expect(resolveTitleField(def)).toBe('headline');
      expect(leadWithNameField(def, ['due_at', 'headline'])[0]).toBe('headline');
      // …and the field they name is the one whose value the H1 renders.
      expect(getRecordDisplayName(def, record)).toBe(record.headline);
      expect(getRecordDisplayName(def, record)).toBe(
        (record as any)[resolveTitleField(def) as string],
      );
    });

    /**
     * The card's second divergence example, executed. A `select` named `title`
     * is matched by NAME alone by the old literal walk, and rejected by TYPE
     * by the shared ladder — so the detail page used to skip a field the H1
     * never shows, and show nothing where the title belonged.
     */
    it('a `select` named `title` is not mistaken for the title field', () => {
      const def = {
        fields: { title: { type: 'select' }, body: { type: 'text' } },
      } as unknown as ObjectDefLike;
      const record = { id: 'r2', title: 'open', body: 'Ship the thing' };

      expect(resolveTitleField(def)).toBe('body');
      expect(leadWithNameField(def, ['title', 'body'])[0]).toBe('body');
      expect(getRecordDisplayName(def, record)).toBe(record.body);
    });

    /**
     * The strip sits directly under the H1 and must not repeat it — the
     * duplication objectui#2548 removed for DECLARED titles. A derived title
     * used to slip through: the literal walk knew five names, `headline` is
     * not one of them, `resolveTitleField` returned `null`, and `headline`
     * became the first chip under a heading already showing its value.
     */
    it('the strip stops repeating a DERIVED title field under the H1', () => {
      const def = {
        fields: {
          stage: { type: 'select' },
          headline: { type: 'text' },
          priority: { type: 'text' },
        },
      } as unknown as ObjectDefLike;
      const record = { id: 'r4', stage: 'open', headline: 'Q3 rollout', priority: 'High' };

      expect(getRecordDisplayName(def, record)).toBe(record.headline);
      expect(deriveHighlightFields(def, null)).not.toContain('headline');
      expect(deriveHighlightFields(def, null)).toContain('priority');
    });

    it('a deprecated `displayNameField` alias resolves the same on every surface', () => {
      const def = {
        displayNameField: 'activity_name',
        fields: { activity_name: { type: 'text' }, note: { type: 'text' } },
      } as unknown as ObjectDefLike;
      const record = { id: 'r3', activity_name: 'Kickoff call', note: 'n/a' };

      expect(resolveTitleField(def)).toBe('activity_name');
      expect(leadWithNameField(def, ['note', 'activity_name'])[0]).toBe('activity_name');
      expect(getRecordDisplayName(def, record)).toBe(record.activity_name);
    });

    /**
     * THE ONE INPUT where the old skip set and the new one disagree, and so
     * the one that has to be pinned: an object declaring `nameField` AND the
     * deprecated `displayNameField` alias to DIFFERENT fields, both present.
     *
     * The old `deriveHighlightFields` read all three declared roles
     * separately and skipped EVERY one it found, so `legacy_title` never
     * reached the strip. The shared ADR-0079 ladder PICKS one rung —
     * `nameField` outranks its deprecated alias — so only `headline` is
     * skipped now, deliberately: `getRecordDisplayName` reads that same
     * ladder and renders `headline`'s value, so `legacy_title` is an ordinary
     * field the heading never shows, and hiding it spent a strip slot for
     * nothing. This also makes the heuristic branch agree with the DECLARED
     * branch, which has only ever filtered a single title field.
     *
     * Goes red if the three raw reads come back, which is the shape this card
     * exists to remove — so the pin is on the BEHAVIOUR, not on the spelling.
     */
    it('skips only the winner when nameField and displayNameField disagree', () => {
      const def = {
        nameField: 'headline',
        displayNameField: 'legacy_title',
        fields: {
          headline: { type: 'text' },
          legacy_title: { type: 'text' },
          priority: { type: 'text' },
        },
      } as unknown as ObjectDefLike;
      const record = {
        id: 'r5',
        headline: 'Q3 rollout',
        legacy_title: 'stale',
        priority: 'High',
      };

      // The canonical pointer wins the ladder on every surface…
      expect(resolveTitleField(def)).toBe('headline');
      expect(leadWithNameField(def, ['priority', 'headline'])[0]).toBe('headline');
      expect(getRecordDisplayName(def, record)).toBe(record.headline);

      // …so the strip drops the H1 field and KEEPS the losing alias, which
      // the heading never shows.
      const strip = deriveHighlightFields(def, null);
      expect(strip).not.toContain('headline');
      expect(strip).toContain('legacy_title');
    });

    /**
     * The invariant, stated once over a table: for every object, the field the
     * detail page calls "the title" is the field core calls "the name". A
     * second ladder can satisfy the cases above and still break here on the
     * next change; delegation cannot.
     */
    it('agrees with core on every shape in the table', () => {
      const defs: Array<Record<string, any>> = [
        { fields: { name: { type: 'text' } } },
        { fields: { due_at: { type: 'datetime' }, headline: { type: 'text' } } },
        { fields: { title: { type: 'select' }, body: { type: 'text' } } },
        { nameField: 'code_label', fields: { code_label: { type: 'text' }, x: { type: 'text' } } },
        { displayNameField: 'activity_name', fields: { activity_name: { type: 'text' } } },
        { fields: { amount: { type: 'currency' }, closed_on: { type: 'date' } } },
        { fields: {} },
        {},
      ];
      for (const def of defs) {
        expect(resolveTitleField(def as ObjectDefLike)).toBe(resolveNameField(def) ?? null);
      }
    });

    it('returns null (not undefined) when nothing resolves, for the `?? \'name\'` call sites', () => {
      const def = { fields: { amount: { type: 'currency' } } } as unknown as ObjectDefLike;
      expect(resolveTitleField(def)).toBeNull();
      expect(resolveTitleField(undefined)).toBeNull();
    });
  });
});
