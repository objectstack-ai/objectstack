/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A lookup column whose `options` are an EMPTY array must still be FILTERABLE
 * (objectui#5031).
 *
 * objectui#4874 (PR #5030) answered the VALUE-DOMAIN question for this shape:
 * `options: []` means "the static domain is not in place", so a value on such a
 * column is never cleared against it, and the criterion was written down once,
 * as `hasStaticOptionDomain(field)` (= `options` is a NON-EMPTY array). But
 * `renderValueInput`'s remote-picker branch was still asking the same question
 * in its own words — `!field?.options` — and `[]` is truthy, so it answered the
 * opposite way: the value-domain side treated the column as remote (keep the
 * value) while the control side treated it as static (draw the option-driven
 * Select over zero options).
 *
 * The user-visible result was a column that could not be filtered at all: a
 * scalar operator drew a Select with no candidates and no search box, and
 * `in`/`notIn` drew an empty checkbox list — while the SAME column with the
 * `options` key simply absent got full remote search. The two branches now read
 * one criterion, so a `referenceTo` column with `options: []` reaches
 * {@link LookupValuePicker}.
 *
 * DIRECTIONS, predicted before running (reverse verification restores
 * `!field?.options` in the branch condition and re-runs this file):
 *
 *   - "routes an unloaded lookup column to the remote picker" — RED without the
 *     fix. Every case there asserts a picker artifact (the search box, the
 *     candidate list, the by-hand id input, the multi-value id input); on the
 *     old condition the column draws a Radix Select or a checkbox list instead
 *     and none of those artifacts exists;
 *   - "a column that owns its option domain keeps the static Select" — GREEN in
 *     both directions by design. It is the blast-radius guard: a fix that read
 *     the criterion inverted, or that sent every lookup to the remote picker,
 *     turns all of it red;
 *   - "the branch's other conditions are untouched" — GREEN in both directions
 *     too. `hasStaticOptionDomain` replaces ONE conjunct; a column with no
 *     `referenceTo` and a non-lookup type must route exactly as before, or the
 *     change widened the branch instead of correcting it.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/core';
import { FilterBuilder } from '../custom/filter-builder';

/**
 * The retired spelling, read from the table rather than written down
 * (objectui#4914). `owner_pending` below carries it.
 */
const RETIRED_FIELD_TYPE = Object.keys(RETIRED_FIELD_TYPES)[0];

/**
 * The columns this card distinguishes. Every one of them is the SAME lookup
 * apart from its `options` key, because that key is the whole subject:
 *
 *   - `account` — `referenceTo`, `options` ABSENT. The shape that already
 *     reached the remote picker; here as the reference behaviour the others
 *     are measured against;
 *   - `account_pending` — `referenceTo`, `options: []`. The card's column: the
 *     shape `deriveFilterFields` produces before an object's picklist values
 *     arrive, and the one that used to fall through to an empty Select;
 *   - `account_loaded` — `referenceTo` AND a NON-EMPTY `options`. A lookup whose
 *     domain really is local and complete; it must keep the static Select, or
 *     the fix has taken the static case with it;
 *   - `assignee_pending` — `type: 'user'` with `options: []` and no
 *     `referenceTo`, reached through the branch's `type === "user"` conjunct.
 *     It took this slot from `owner_pending` in objectui#4914: that column was
 *     the ONLY pin on the type-driven half of the third conjunct, and inverting
 *     it without a live stand-in would have deleted the coverage rather than
 *     moved it;
 *   - `owner_pending` — the RETIRED spelling with `options: []` and no
 *     `referenceTo`. It used to be reached through the branch's own
 *     `type === "owner"` conjunct; objectui#4914's gate refuses it ahead of the
 *     branch, and the pin below is inverted to say so;
 *   - `stage_pending` — a `select` (NOT lookup-like) with `options: []`. It has
 *     no remote search to fall back to, so it must be unaffected;
 *   - `orphan_pending` — a lookup with `options: []` and NO `referenceTo`, of a
 *     type that is not `user`. There is nothing to search against, so the
 *     branch's third conjunct must keep rejecting it.
 */
const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'account', label: 'Account', type: 'lookup', referenceTo: 'accounts' },
  {
    value: 'account_pending',
    label: 'Account (pending)',
    type: 'lookup',
    referenceTo: 'accounts',
    options: [],
  },
  {
    value: 'account_loaded',
    label: 'Account (loaded)',
    type: 'lookup',
    referenceTo: 'accounts',
    options: [
      { value: 'acc_001', label: 'Acme' },
      { value: 'acc_002', label: 'Globex' },
    ],
  },
  { value: 'assignee_pending', label: 'Assignee', type: 'user', options: [] },
  { value: 'owner_pending', label: 'Owner', type: RETIRED_FIELD_TYPE, options: [] },
  { value: 'stage_pending', label: 'Stage', type: 'select', options: [] },
  { value: 'orphan_pending', label: 'Orphan', type: 'lookup', options: [] },
];

/** The records the remote search returns — the candidates the card says are missing. */
const ACCOUNTS = [
  { id: 'acc_007', name: 'Initech' },
  { id: 'acc_008', name: 'Umbrella' },
];

function renderRow(
  condition: Record<string, unknown>,
  opts: { dataSource?: unknown } = {},
) {
  const onChange = vi.fn();
  // Hoisted OUT of the JSX, as in PR #5030's suite: the sync effect re-seeds
  // internal state whenever the `value` PROP's identity changes, which would
  // undo the interaction under test on the next render.
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
  const tree = (
    <FilterBuilder fields={FIELDS as any} value={value as any} onChange={onChange} />
  );
  const utils = render(
    opts.dataSource ? (
      <SchemaRendererContext.Provider value={{ dataSource: opts.dataSource } as any}>
        {tree}
      </SchemaRendererContext.Provider>
    ) : (
      tree
    ),
  );
  return { ...utils, onChange };
}

/** A DataSource that answers `find` with {@link ACCOUNTS}. */
function fakeDataSource() {
  return { find: vi.fn(async () => ({ data: ACCOUNTS })) };
}

/**
 * The row's value control, identified by what it IS rather than by position.
 *
 * The bug and the fix draw two structurally different controls, so the pins read
 * the DOM for the control that is actually there: `comboboxes` counts the Radix
 * triggers (field, operator, and — only for an option-driven column — value),
 * and the picker helpers look for `LookupValuePicker`'s own artifacts.
 */
function comboboxCount(): number {
  return screen.queryAllByRole('combobox').length;
}

function lastRow(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the builder never called onChange').toBeGreaterThan(0);
  return calls[calls.length - 1][0].conditions[0];
}

describe('routes an unloaded lookup column to the remote picker', () => {
  it('opens a search box and real candidates for a `referenceTo` column with `options: []`', async () => {
    const dataSource = fakeDataSource();
    renderRow(
      { field: 'account_pending', operator: 'equals', value: '' },
      { dataSource },
    );

    // The card's literal complaint, asserted as the user meets it: a trigger
    // that opens a searchable list. On the old condition this column drew a
    // Radix Select whose only content was the row's own value.
    const trigger = screen.getByTestId('lookup-picker-account_pending');
    fireEvent.click(trigger);

    expect(await screen.findByTestId('lookup-search-account_pending')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Initech')).toBeInTheDocument();
      expect(screen.getByText('Umbrella')).toBeInTheDocument();
    });
    expect(dataSource.find).toHaveBeenCalledWith('accounts', expect.anything());
  });

  it('lets the user pick a NEW value there — the thing the empty Select made impossible', async () => {
    const dataSource = fakeDataSource();
    const { onChange } = renderRow(
      { field: 'account_pending', operator: 'equals', value: '' },
      { dataSource },
    );

    fireEvent.click(screen.getByTestId('lookup-picker-account_pending'));
    const candidate = await screen.findByText('Umbrella');
    fireEvent.click(candidate);

    // "值可见了,用户依然挑不出别的记录" is what the card is about; this is the
    // assertion that the user CAN now, and that the choice reaches the row.
    expect(lastRow(onChange)).toMatchObject({
      field: 'account_pending',
      value: 'acc_008',
    });
  });

  it('draws no option-driven value Select for that column at all', () => {
    renderRow({ field: 'account_pending', operator: 'equals', value: 'acc_007' });

    // Field and operator only. A third combobox is the empty Select of the bug
    // report — the control with no search box and no candidates.
    expect(comboboxCount()).toBe(2);
  });

  it('keeps the row value visible in the picker when no DataSource is configured', () => {
    const { onChange } = renderRow({
      field: 'account_pending',
      operator: 'equals',
      value: 'acc_007',
    });

    // `LookupValuePicker`'s by-hand fallback. The C half of objectui#4874's
    // ruling — the value is never invisible — is preserved by the reroute, it
    // is just the picker that honours it now instead of a temporary SelectItem.
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Account (pending) id"]',
    );
    expect(input, 'the unloaded lookup drew no id input').toBeTruthy();
    expect(input!.value).toBe('acc_007');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives the list operators the multi-value picker, not an empty checkbox list', () => {
    renderRow({ field: 'account_pending', operator: 'in', value: ['acc_007'] });

    // `in`/`notIn` on this column used to render a checkbox list over zero
    // options: every existing term invisible, no term addable. The multiple
    // picker keeps list ARITY (objectui#3958) while restoring the search.
    expect(screen.getByTestId('lookup-ids-account_pending')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('routes a `user` column with `options: []` through the same criterion', () => {
    renderRow({ field: 'assignee_pending', operator: 'equals', value: 'usr_1' });

    // The branch's `type === "user"` conjunct, which supplies its own
    // `referenceTo` ("users") downstream. `options: []` used to block it here
    // exactly as it blocked the `referenceTo` case.
    //
    // This case was `owner_pending` until objectui#4914 retired that spelling.
    // The column moved to the live sibling rather than the assertion being
    // deleted: it is the only pin on the type-driven half of the conjunct, and
    // this card's own rule is that a fixture inverts, never merely disappears.
    expect(comboboxCount()).toBe(2);
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Enter Assignee id"]');
    expect(input, 'the user column drew no id input').toBeTruthy();
    expect(input!.value).toBe('usr_1');
  });

  it('matches the behaviour of the same column with `options` absent', () => {
    const absent = renderRow({ field: 'account', operator: 'equals', value: 'acc_007' });
    const absentComboboxes = absent.container.querySelectorAll('[role="combobox"]').length;
    const absentIdInput = absent.container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Account id"]',
    );

    const pending = renderRow({
      field: 'account_pending',
      operator: 'equals',
      value: 'acc_007',
    });
    const pendingComboboxes = pending.container.querySelectorAll('[role="combobox"]').length;
    const pendingIdInput = pending.container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Account (pending) id"]',
    );

    // The card's own framing: `options: []` and no `options` key describe the
    // same state of the world (the domain has not arrived), so the column must
    // not be filterable in one spelling and unfilterable in the other. Compared
    // control-for-control rather than asserted twice, so the pin fails if either
    // side moves.
    expect(pendingComboboxes).toBe(absentComboboxes);
    expect(absentIdInput?.value).toBe('acc_007');
    expect(pendingIdInput?.value).toBe('acc_007');
  });
});

describe('a column that owns its option domain keeps the static Select', () => {
  it('draws the option-driven Select for a lookup with NON-EMPTY options', async () => {
    renderRow({ field: 'account_loaded', operator: 'equals', value: 'acc_001' });

    // The half of the criterion that must NOT move: these options ARE the
    // column's domain, so the local Select is the right control and the remote
    // picker would be a regression.
    expect(comboboxCount()).toBe(3);
    expect(screen.queryByTestId('lookup-picker-account_loaded')).toBeNull();

    const trigger = screen.getAllByRole('combobox')[2];
    expect(trigger.textContent).toBe('Acme');

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(
        screen.getAllByRole('option').map((o) => o.textContent),
      ).toEqual(expect.arrayContaining(['Acme', 'Globex']));
    });
  });

  it('keeps the checkbox list for a list operator on that column', () => {
    renderRow({ field: 'account_loaded', operator: 'in', value: ['acc_001'] });

    expect(screen.queryByTestId('lookup-ids-account_loaded')).toBeNull();
    expect(
      screen.getAllByRole('checkbox').map((box) => ({
        label: box.parentElement?.textContent ?? '',
        checked: box.getAttribute('data-state') === 'checked',
      })),
    ).toEqual([
      { label: 'Acme', checked: true },
      { label: 'Globex', checked: false },
    ]);
  });
});

describe('a RETIRED spelling is refused the branch entirely (objectui#4914)', () => {
  it('draws no picker for `owner_pending`, and says why once', () => {
    // THE INVERSION. This column was the file's POSITIVE pin on the branch's
    // `type === "owner"` conjunct — its previous assertion required an id input
    // to be present. The maintainer's ruling of 2026-08-18 put the retirement
    // gate ahead of the branch, so the same column must now be refused, and the
    // pin says the opposite thing about the same DOM.
    //
    // It was inverted in the SAME change that added the gate, never ahead of
    // it: while the production predicate still special-cased the spelling, this
    // assertion was TRUE, and deleting it early would have been a net loss of
    // coverage for nothing.
    resetRetiredFieldTypeReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderRow({ field: 'owner_pending', operator: 'equals', value: 'usr_1' });

      expect(screen.queryByTestId('lookup-picker-owner_pending')).toBeNull();
      expect(
        document.querySelector('input[placeholder="Enter Owner id"]'),
        'the retired column still drew the picker’s id input',
      ).toBeNull();

      // Loud, and exactly once — the half that distinguishes this ruling from
      // the mechanical deletion the premise-gate measurement rejected.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED_FIELD_TYPE]);
    } finally {
      errorSpy.mockRestore();
      resetRetiredFieldTypeReports();
    }
  });

  it('is refused for the LIST operators too', () => {
    resetRetiredFieldTypeReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderRow({ field: 'owner_pending', operator: 'in', value: ['usr_1'] });
      // `in`/`notIn` reach the multi-value picker by the same branch, so the
      // refusal has to hold on both arities or the gate only closed one door.
      expect(screen.queryByTestId('lookup-ids-owner_pending')).toBeNull();
    } finally {
      errorSpy.mockRestore();
      resetRetiredFieldTypeReports();
    }
  });
});

describe("the branch's other conditions are untouched", () => {
  it('leaves a non-lookup `select` column with `options: []` exactly where it was', () => {
    renderRow({ field: 'stage_pending', operator: 'equals', value: 'draft' });

    // `select` is not lookup-like: there is no remote search behind it, so its
    // empty Select is a metadata problem rather than this defect. Rerouting it
    // would be the fix over-reaching past the conjunct it replaced.
    expect(comboboxCount()).toBe(3);
    expect(screen.queryByTestId('lookup-picker-stage_pending')).toBeNull();
  });

  it('still rejects a lookup with `options: []` that has nothing to search against', () => {
    renderRow({ field: 'orphan_pending', operator: 'equals', value: 'x_1' });

    // No `referenceTo`, and not `user`: the picker would have no
    // object to query. The third conjunct is what says so, and it is unchanged —
    // this column's degradation is the card's adjacent observation, out of scope.
    expect(screen.queryByTestId('lookup-picker-orphan_pending')).toBeNull();
    expect(comboboxCount()).toBe(3);
  });
});
