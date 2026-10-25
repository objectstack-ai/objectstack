/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — a RETIRED field-type spelling in inline edit (objectui#4914,
 * fast-follow to objectui#4814's ruling A′).
 *
 * #4814 retired the `owner` field type with a loud tombstone: the record FORM
 * answers `type: 'owner'` with a visible refusal naming the migration, plus a
 * console prescription deduped once per spelling. `InlineFieldInput` did not
 * participate. Its `INLINE_ROUTED_FIELD_TYPES` set and its `isUserRef` branch
 * are consulted at runtime against whatever type a STORED field actually
 * carries, so a field still typed `owner` got a working person picker inline
 * while the form refused it — two edit surfaces disagreeing about one field,
 * which is worse than either uniform outcome, and the exact drift A′ was
 * chartered to end.
 *
 * Contract now: inline edit meets the SAME loud refusal the form gives. The
 * two ways of getting this wrong are pinned in both directions — a working
 * picker (the pre-#4914 state) and a quiet degradation to the terminal
 * plain-text input (what deleting the set member alone would have produced,
 * since `isKnownFieldType('owner')` is false once the alias table drops it).
 *
 * Asserting the ENVELOPE, not merely "something changed": the refusal's
 * testid + `data-retired-field-type` + the prescription text, because a
 * refusal that does not name the offending spelling and its migration is not
 * the disposition #4814 ruled for.
 *
 * The retired vocabulary is read from `@object-ui/fields`' live
 * `RETIRED_FIELD_TYPES` table rather than restated here — one place per fact,
 * the discipline #4814's own pins follow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/fields';
import {
  InlineFieldInput,
  INLINE_PLAIN_TEXT_FIELD_TYPES,
  INLINE_PLAIN_TEXT_INPUT_TESTID,
  INLINE_ROUTED_FIELD_TYPES,
} from '../InlineFieldInput';

/** The one retired spelling, and the survivor it was a synonym for. */
const RETIRED = 'owner';
const SURVIVOR = 'user';

const dataSource = { find: vi.fn(async () => ({ data: [], total: 0 })) };

const renderInline = (field: Record<string, any>, value: unknown = 'u-1') =>
  render(
    <InlineFieldInput
      field={field}
      value={value}
      onChange={vi.fn()}
      dataSource={dataSource}
    />,
  );

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InlineFieldInput — a retired field-type spelling (objectui#4914)', () => {
  it('is a spelling this repo really has retired', () => {
    // Guards the premise of every assertion below: if the table stopped
    // carrying `owner`, these would be testing nothing.
    expect(Object.keys(RETIRED_FIELD_TYPES)).toContain(RETIRED);
  });

  it('renders the same visible refusal the record form gives, naming the spelling', () => {
    renderInline({ name: 'record_owner', type: RETIRED });

    const alert = screen.getByTestId('field-retired-tombstone');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-retired-field-type')).toBe(RETIRED);
    // The prescription, not a bare "unsupported": an author must be able to
    // read the migration off the refusal itself.
    expect(alert.textContent).toContain("{ type: 'user', name: 'owner' }");
    expect(alert.textContent).toContain('objectui#4814');
  });

  it('offers no editable control at all — neither the person picker nor a text box', () => {
    const { container } = renderInline({ name: 'record_owner', type: RETIRED });

    // Direction 1 — the pre-#4914 failure: a working `UserField` picker while
    // the form refused the same field.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // Direction 2 — the failure a bare set-member deletion would have
    // introduced: the terminal raw text input, which displays through
    // `coerceToSafeValue` and SAVES a string over the stored value.
    expect(screen.queryByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID)).toBeNull();
    // Nothing an author could mistake for a working field.
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('writes the console prescription ONCE, not once per edited row', () => {
    renderInline({ name: 'record_owner', type: RETIRED });
    renderInline({ name: 'other_owner', type: RETIRED });

    const said = (error.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .filter((m) => m.includes('objectui#4814'));
    // The message is a fix instruction for an author, not a per-render event.
    expect(said).toHaveLength(1);
  });

  it('holds an `$expand`-ed value the same way — the refusal is not value-shaped', () => {
    // A stored `owner` field arriving expanded is exactly the case the picker
    // branch existed for, so it is the one most likely to slip past a refusal
    // keyed on anything but the type.
    renderInline({ name: 'record_owner', type: RETIRED }, { id: 'u-1', name: 'Ada Lovelace' });
    expect(screen.getByTestId('field-retired-tombstone')).toBeInTheDocument();
    expect(screen.queryByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID)).toBeNull();
  });
});

describe('the `user` path is untouched — this is a subtraction of exactly one', () => {
  it('still routes to a real editor and reaches no retirement machinery', () => {
    renderInline({ name: 'assignee', type: SURVIVOR });

    expect(screen.queryByTestId('field-retired-tombstone')).toBeNull();
    // A routed type must not land on the lossy fallback either.
    expect(screen.queryByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID)).toBeNull();
    expect(
      (error.mock.calls as unknown[][]).map((c) => String(c[0])).join('\n'),
    ).not.toContain('objectui#4814');
  });

  it('leaves a genuinely unknown type on its pre-existing quiet fallback', () => {
    // Retirement is a NAMED disposition, never a new blanket noise source.
    renderInline({ name: 'weird', type: 'not-a-real-type' }, 'plain');
    expect(screen.queryByTestId('field-retired-tombstone')).toBeNull();
    expect(screen.getByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID)).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('no retired spelling can re-enter the inline routing tables', () => {
  it('the routed set carries no retired spelling', () => {
    // Structural, and quantified over the whole table — so the NEXT retirement
    // is covered here the day it lands, instead of needing this file edited.
    const retiredButRouted = Object.keys(RETIRED_FIELD_TYPES).filter((t) =>
      INLINE_ROUTED_FIELD_TYPES.has(t),
    );
    expect(retiredButRouted).toEqual([]);
    // …and the survivor is still routed, so this is not a vacuous pass.
    expect(INLINE_ROUTED_FIELD_TYPES.has(SURVIVOR)).toBe(true);
  });

  it('a retired spelling is not smuggled in as "benign" either', () => {
    for (const retired of Object.keys(RETIRED_FIELD_TYPES)) {
      // Benign would mean "its stored value is already a string, the terminal
      // input is lossless" — a claim no retired spelling gets to make.
      expect(INLINE_PLAIN_TEXT_FIELD_TYPES.has(retired)).toBe(false);
    }
  });

  it('does NOT rely on the delegation gate, which still answers `owner` with a picker', () => {
    // Measured while writing this file, and the reason the refusal branch is
    // the load-bearing part of #4914 rather than the two deletions:
    // `hasFieldEditWidget('owner')` is TRUE, because the fields package still
    // maps `owner: UserField` in `EDIT_WIDGETS`
    // (`packages/fields/src/FieldEditWidget.tsx` — a residual face #4914 does
    // not enumerate). Had the routing-table member simply been deleted, the
    // type would have reached the same person picker down the delegation road.
    //
    // That asymmetry is deliberately NOT asserted here in either direction: it
    // is the other card's to fix, and a pin on today's value would go red on
    // the very fix that card proposes. What IS pinned is the outcome, which
    // holds either way — the refusal runs before both roads.
    renderInline({ name: 'record_owner', type: RETIRED });
    expect(screen.getByTestId('field-retired-tombstone')).toBeInTheDocument();
  });
});
