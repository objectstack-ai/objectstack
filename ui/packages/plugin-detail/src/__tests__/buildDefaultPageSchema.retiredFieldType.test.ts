/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Item 6 of objectui#4914 — `deriveHighlightFields`' `HIGHLIGHT_FRIENDLY_TYPES`
 * set, behind the retirement gate (maintainer ruling B, 2026-08-18).
 *
 * Before the gate a field TYPED with the retired spelling was highlight-
 * friendly, so the synthesized detail page put a pill for it on the highlight
 * strip while the same field's own editor answered with a tombstone: one page,
 * two verdicts on one field.
 *
 * ## The second door, and why this file pins both
 *
 * `deriveHighlightFields` selects twice. The type-driven loop is the face the
 * card names — but a `preferred` pass runs FIRST, selects by NAME, never looks
 * at the type, and the very first name it prefers is `owner`. Gating only the
 * named line would have left the exact shape this card is about — a field named
 * `owner` still typed `owner` — reaching the strip through the other door with
 * the fix reading as complete. Both doors are pinned, and the `preferred` one
 * is pinned first because it is the one that would have been missed.
 *
 * ## The idiom that must NOT be disturbed
 *
 * `{ type: 'user', name: 'owner' }` is the migration the tombstone prescribes,
 * and `owner` stays in the `preferred` NAME list for exactly that reason. A
 * pin below renders that shape and requires it to keep its slot — if the gate
 * ever starts reading names instead of types, this is what catches it.
 *
 * Ablation direction, predicted before running: drop the gate and the two
 * refusal pins go RED while every control pin stays green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/core';
import { deriveHighlightFields } from '../synth/buildDefaultPageSchema';

const RETIRED = Object.keys(RETIRED_FIELD_TYPES)[0];
/** The live sibling the retired spelling was a synonym for. */
const LIVE = 'user';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  resetRetiredFieldTypeReports();
});

/**
 * Both fixtures carry an explicit `name` text field so the object's TITLE
 * resolves to `name` and nothing else. `deriveHighlightFields` skips whatever
 * titles the record (it is already the page H1), and since objectui#7287 that
 * answer comes from the shared ADR-0079 ladder, which DERIVES a title when the
 * object declares none — on a def of only `{owner, amount, priority}` it lands
 * on `owner`, and on `{reviewer, note}` on `reviewer`. That would remove these
 * tests' own subject from the strip for a reason that has nothing to do with
 * the retirement gate they exist to pin. Naming the title field keeps the
 * fixture about the gate.
 */

/** An object def whose `owner` field carries `type`. */
const defWithOwnerTyped = (type: string) => ({
  name: 'tasks',
  fields: {
    name: { type: 'text', label: 'Name' },
    owner: { type, label: 'Owner' },
    amount: { type: 'currency', label: 'Amount' },
    priority: { type: 'select', label: 'Priority' },
  },
});

/** An object def whose retired-typed field is NOT one of the preferred names. */
const defWithArbitraryName = (type: string) => ({
  name: 'tasks',
  fields: {
    name: { type: 'text', label: 'Name' },
    reviewer: { type, label: 'Reviewer' },
    note: { type: 'text', label: 'Note' },
  },
});

/**
 * The one shape the fixtures above deliberately exclude: an object whose ONLY
 * retired-typed field is the one the shared ladder DERIVES as the title. It is
 * skipped from the strip as the page H1 — and must still be reported, or
 * objectui#7287's skip would have quietly closed the gate for exactly the
 * objects that most need it (objectui#4914 ruling B).
 */
const defWhoseTitleIsRetired = (type: string) => ({
  name: 'tasks',
  fields: {
    headline: { type, label: 'Headline' },
    closed_on: { type: 'date', label: 'Closed on' },
  },
});

describe('the `preferred` NAME pass', () => {
  it('keeps a field named `owner` when it carries the PRESCRIBED type', () => {
    // The control, and the migration the tombstone tells authors to make. If
    // this ever goes red the gate has started refusing by name.
    expect(deriveHighlightFields(defWithOwnerTyped(LIVE), null)).toContain('owner');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refuses the same field when it carries the RETIRED type', () => {
    const out = deriveHighlightFields(defWithOwnerTyped(RETIRED), null);
    expect(out).not.toContain('owner');
    // Non-vacuity: the strip is still built, so the refusal removed one field
    // rather than emptying the result and passing for the wrong reason.
    expect(out).toContain('amount');
  });
});

describe('the type-driven pass', () => {
  it('keeps an arbitrarily named field of the live sibling type', () => {
    expect(deriveHighlightFields(defWithArbitraryName(LIVE), null)).toContain('reviewer');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refuses it when the type is retired', () => {
    const out = deriveHighlightFields(defWithArbitraryName(RETIRED), null);
    expect(out).not.toContain('reviewer');
    expect(out).toContain('note');
  });
});

describe('the refusal is loud, and said once', () => {
  it('prints the table’s prescription exactly once across repeated derivations', () => {
    deriveHighlightFields(defWithOwnerTyped(RETIRED), null);
    deriveHighlightFields(defWithArbitraryName(RETIRED), null);
    deriveHighlightFields(defWithOwnerTyped(RETIRED), null);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });

  it('still reports when the retired field is the one the ladder titles with', () => {
    // `headline` is the only title-eligible field here, so it IS the H1 and is
    // skipped from the strip before either selection loop can see it.
    const out = deriveHighlightFields(defWhoseTitleIsRetired(RETIRED), null);
    expect(out).not.toContain('headline');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });

  it('closes the CLASS — every key of the table, not just today’s one', () => {
    for (const spelling of Object.keys(RETIRED_FIELD_TYPES)) {
      resetRetiredFieldTypeReports();
      expect(deriveHighlightFields(defWithArbitraryName(spelling), null), spelling)
        .not.toContain('reviewer');
    }
  });
});
