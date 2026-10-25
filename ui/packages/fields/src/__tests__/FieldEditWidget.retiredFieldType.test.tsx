/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the inline-edit DELEGATION road (objectui#4931, the last
 * measured active-contradiction face of objectui#4814's ruling A′).
 *
 * #4814 retired the `owner` field type with a loud tombstone, and #4914 carried
 * the shrink onto the published contract twins and inline edit. This seam
 * survived all of it. `hasFieldEditWidget` answers
 * `resolveInlineEditType(type) in EDIT_WIDGETS`, and `resolveInlineEditType`
 * returns a type UNCHANGED when it is already a key of `EDIT_WIDGETS` — so
 * while `owner: UserField` sat in that table the alias table was never
 * consulted and the retirement never applied. Measured on this branch before
 * the fix: `hasFieldEditWidget('owner') === true`, and a direct
 * `FieldEditWidget` call rendered a working person picker (one `role=button`
 * reading `Select…`, no tombstone). Deleting a routing-table membership
 * elsewhere does not disable a type; delegation reaches the same widget by
 * another road.
 *
 * What is pinned here is therefore the CLASS, not the spelling. Every
 * assertion below is quantified over `@object-ui/fields`' live
 * `RETIRED_FIELD_TYPES` table rather than written against `owner`, so the next
 * retirement closes this seam the day it lands in that table instead of
 * leaving a fresh delegation road open until someone measures it again.
 *
 * Three roads, three pins, because closing only the first would trade one
 * silent failure for another:
 *
 *  1. `hasFieldEditWidget` — the gate hosts ask before handing a cell to
 *     `FieldEditWidget`. Answers `false`.
 *  2. `isInlineExcludedFieldType` — what the host does NEXT. `ObjectGrid`
 *     marks a column `editable: false` exactly when `isFieldInlineEditable`
 *     (which consults this predicate) is false; otherwise the column stays
 *     editable, the cell editor gets `null`, and DataTable falls back to its
 *     built-in PLAIN TEXT input — which for a stored person reference writes a
 *     bare string over the value. Answers `true`.
 *  3. `FieldEditWidget` called directly, ignoring both gates. Renders no
 *     control at all and writes the once-per-spelling prescription.
 *
 * Both wrong outcomes are pinned in both directions — a working picker (the
 * pre-#4931 state) and a quiet text box (what closing road 1 alone would have
 * produced) — because a test asserting merely "not a UserField" would pass
 * just as happily against the text-box regression.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  FieldEditWidget,
  hasFieldEditWidget,
  isInlineExcludedFieldType,
  INLINE_EXCLUDED_FIELD_TYPES,
  RETIRED_FIELD_TYPES,
  resetRetiredFieldTypeReports,
} from '../index';

/** The one retired spelling today, and the survivor it was a synonym for. */
const RETIRED = 'owner';
const SURVIVOR = 'user';

const RETIRED_TYPES = () => Object.keys(RETIRED_FIELD_TYPES);

/**
 * A field literal spelling a RETIRED type.
 *
 * The type escape is the POINT here, not a workaround, and it is confined to
 * this one helper so the strictness holds everywhere else in the file. PR
 * #4932 shrank `owner` out of the published field-type unions in
 * `@object-ui/types`, so the compiler now REFUSES to let this payload be
 * written at all — and a payload the type refuses needs an escape to be
 * authored (the shape settled by objectui#4910 / PR #4920). That refusal is
 * the published contract twin working exactly as designed; it is asserted
 * head-on by `packages/types/src/__tests__/owner-retired-contract-twins.test.ts`,
 * so nothing is lost by escaping it here.
 *
 * This suite still has to author the refused spelling, because what it pins is
 * the RUNTIME disposition for a field that is ALREADY STORED that way — a
 * record typed `owner` before the retirement, which no compile-time union can
 * reach or fix. That stored-field case is the whole reason this seam mattered.
 */
const retiredFieldLiteral = (name: string) => ({ name, type: RETIRED as never });

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const said = () =>
  (error.mock.calls as unknown[][]).map((c) => String(c[0])).join('\n');

describe('the retirement premise this file is quantified over', () => {
  it('is a spelling this repo really has retired', () => {
    // Guards every assertion below from going vacuous: if the table emptied,
    // the quantified pins would all pass while testing nothing.
    expect(RETIRED_TYPES()).toContain(RETIRED);
    expect(RETIRED_TYPES().length).toBeGreaterThan(0);
  });
});

describe('road 1 — the delegation gate refuses every retired spelling', () => {
  it('`hasFieldEditWidget` answers false for every key of RETIRED_FIELD_TYPES', () => {
    const stillOffered = RETIRED_TYPES().filter((t) => hasFieldEditWidget(t));
    expect(stillOffered).toEqual([]);
  });

  it('is not a vacuous pass — the live relational types still answer true', () => {
    // If this ever fails together with the pin above, the gate has stopped
    // discriminating and is simply refusing everything.
    for (const t of ['lookup', 'master_detail', SURVIVOR]) {
      expect(hasFieldEditWidget(t), `${t} must keep its inline editor`).toBe(true);
    }
  });
});

describe('road 2 — the host is routed to its read-only path, not to a text box', () => {
  it('`isInlineExcludedFieldType` answers true for every retired spelling', () => {
    // This is the answer `ObjectGrid` turns into `editable: false` on the
    // column (via `isFieldInlineEditable`), which is what stops DataTable from
    // opening its built-in plain text input on a stored person reference.
    const notExcluded = RETIRED_TYPES().filter((t) => !isInlineExcludedFieldType(t));
    expect(notExcluded).toEqual([]);
  });

  it('answers so from the retirement table, without polluting the exclusion SET', () => {
    // `INLINE_EXCLUDED_FIELD_TYPES` is documented as the types this renderer
    // CHOSE not to edit in place, and a sibling guard asserts it holds only
    // renderable form types — which a retired spelling is precisely not. The
    // predicate diverging from raw membership is the established shape here
    // (`composite` → `object`, `video` → `file` resolve in the same way).
    for (const t of RETIRED_TYPES()) {
      expect(INLINE_EXCLUDED_FIELD_TYPES.has(t)).toBe(false);
    }
  });

  it('leaves the two answers consistent — never "no editor" AND "not excluded"', () => {
    // The pairing the whole file exists to protect: a type that has no inline
    // editor and is not excluded is exactly the state that falls through to
    // the grid's plain text input.
    for (const t of RETIRED_TYPES()) {
      expect(hasFieldEditWidget(t) || isInlineExcludedFieldType(t)).toBe(true);
    }
  });
});

describe('road 3 — a direct call, ignoring both gates', () => {
  it('renders no control at all for a retired spelling', () => {
    const { container } = render(
      <FieldEditWidget
        field={retiredFieldLiteral('record_owner')}
        value="u-1"
        onChange={vi.fn()}
      />,
    );

    // Direction 1 — the pre-#4931 failure: a working person picker while the
    // record form refused the same field. Measured before the fix as one
    // `role=button` reading `Select…`.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    // Direction 2 — the failure closing the gate ALONE would have introduced:
    // a raw text box that saves a bare string over the stored reference.
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    // Nothing an author could mistake for a working field.
    expect(container.innerHTML).toBe('');
  });

  it('holds for an `$expand`-ed value too — the refusal is not value-shaped', () => {
    // The expanded object is the case the picker branch existed for, so it is
    // the one most likely to slip past a refusal keyed on anything but type.
    const { container } = render(
      <FieldEditWidget
        field={retiredFieldLiteral('record_owner')}
        value={{ id: 'u-1', name: 'Ada Lovelace' }}
        onChange={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('is LOUD — it writes the prescription naming the migration', () => {
    render(
      <FieldEditWidget
        field={retiredFieldLiteral('record_owner')}
        value="u-1"
        onChange={vi.fn()}
      />,
    );

    // Rendering nothing is only half the disposition; silence would be the
    // other silent failure. The message is the text an author or an AI author
    // will act on, so its content is the contract — and asserting it also
    // proves this path runs through the retirement machinery rather than
    // merely missing a key in the widget map.
    expect(said()).toContain('`owner`');
    expect(said()).toContain('RETIRED');
    expect(said()).toContain("{ type: 'user', name: 'owner' }");
    expect(said()).toContain('objectui#4814');
  });

  it('reports ONCE per spelling, so a rendered grid cannot bury the message', () => {
    for (let i = 0; i < 25; i++) {
      render(
        <FieldEditWidget
          field={retiredFieldLiteral(`owner_${i}`)}
          value="u-1"
          onChange={vi.fn()}
        />,
      );
    }
    const prescriptions = (error.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .filter((m) => m.includes('objectui#4814'));
    expect(prescriptions).toHaveLength(1);
  });
});

describe('the `user` path is untouched — this is a subtraction of exactly one', () => {
  it('still routes to the real person picker and reaches no retirement machinery', () => {
    expect(hasFieldEditWidget(SURVIVOR)).toBe(true);
    expect(isInlineExcludedFieldType(SURVIVOR)).toBe(false);

    const { container } = render(
      <FieldEditWidget
        field={{ name: 'assignee', type: SURVIVOR }}
        value="u-1"
        onChange={vi.fn()}
      />,
    );
    // A real control, not the refusal — the widget `owner` used to borrow.
    expect(container.innerHTML).not.toBe('');
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(said()).not.toContain('objectui#4814');
  });

  it('leaves a genuinely unknown type on its pre-existing quiet fallback', () => {
    // Measured, not assumed — and the measurement is the sharpest statement of
    // what this card fixed. An unknown type resolves through the alias table's
    // `|| 'field:text'` tail onto the `text` editor, so `hasFieldEditWidget`
    // answers TRUE for it and the grid hands it a plain text box. That is the
    // pre-existing quiet fallback, deliberately preserved: retirement is a
    // NAMED disposition, never a new blanket noise source.
    //
    // The contrast with the retired spelling is the whole point. `owner` used
    // to be answered by an even worse road (a working person picker); had it
    // merely been dropped from the widget map it would have landed HERE, on
    // this text-box fallback, and saved a bare string over a stored person
    // reference. It is refused instead — the only type in this file that the
    // text tail does not catch.
    expect(hasFieldEditWidget('not-a-real-type')).toBe(true);
    expect(isInlineExcludedFieldType('not-a-real-type')).toBe(false);
    expect(said()).not.toContain('objectui#4814');

    // …and that fallback is exactly what every retired spelling is kept OFF.
    for (const t of RETIRED_TYPES()) {
      expect(hasFieldEditWidget(t), `${t} must not reach the text fallback`).toBe(false);
    }
  });
});
