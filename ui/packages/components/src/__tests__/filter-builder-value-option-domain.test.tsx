/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A row's value must stay inside the option DOMAIN of the column it filters —
 * and where it cannot be, it must at least be VISIBLE (objectui#4874).
 *
 * objectui#4781 settled the TYPE half of the field switch and deliberately
 * stopped there: `select`/`lookup` are text-family, so `"acme"` is a string a
 * picklist column can perfectly well HOLD. What it cannot be is one of that
 * column's options — and the control drawn for those columns is a Radix Select,
 * whose trigger renders only what one of its MOUNTED `SelectItem`s carries. So a
 * text row filtered `equals "acme"`, pointed at a picklist of `won`/`lost`,
 * showed a BLANK trigger while the row kept carrying `"acme"`: persisted by
 * `foldFilterGroupToSpecRules`, queried by the live grid as
 * `stage equals "acme"`. Third face of the same invisible value —
 * objectui#4768 on the operator, objectui#4781 on the value's type, this one on
 * its domain.
 *
 * Ruled 2026-08-17 as **A + C combined**:
 *
 *   - **A** — a column whose `options` are STATIC and present owns its whole
 *     value domain, so a field switch clears a non-member to objectui#4781's
 *     empty shape (scalar `''`, list `[]`);
 *   - **C** — a remote/async column (lookup with remote search, `options`
 *     absent or not yet loaded) keeps its value and the control MAKES IT
 *     VISIBLE, because a valid lookup id is not the local page's to delete;
 *   - **⛔ B** — keep the value and tolerate it being invisible — stays
 *     rejected, as objectui#4781's ruling already rejected it.
 *
 * DIRECTIONS, predicted before running:
 *
 *   - everything under "a static option domain clears what it cannot hold" is
 *     RED on `origin/main` (`e71c854`), where the switch carries `"acme"` onto
 *     the picklist verbatim and the trigger goes blank — measured, that is the
 *     card's own repro;
 *   - everything under "a remote/async domain keeps the value AND shows it" is
 *     RED on main too, but for the opposite reason: main KEEPS the value
 *     correctly (it clears nothing) and renders an EMPTY Select for a column
 *     whose options have not loaded, so the value assertions are green and the
 *     *visibility* assertions are red. The two halves of the ruling fail main in
 *     two different places, which is why both are pinned;
 *   - "a value the new column DOES offer survives" is GREEN in both directions
 *     by design. It is the blast-radius guard: a fix that cleared on every
 *     switch to an option-bearing column turns all of it red, and so does one
 *     that compares membership more strictly than the controls compare it
 *     (`0` vs `'0'`);
 *   - the `narrowFilterValueToOptions` matrix does not COMPILE on main (the
 *     helper does not exist there) — the same status `retypeFilterValue`'s
 *     matrix had in PR #4876.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterBuilder, narrowFilterValueToOptions } from '../custom/filter-builder';

/**
 * The four columns this card distinguishes, plus the text/number columns a value
 * arrives FROM:
 *
 *   - `stage` / `stage_alt` / `priority` — STATIC picklists. Two of them share
 *     the option id `won`, which is what makes "keep the members, drop the rest"
 *     expressible on one list;
 *   - `level` — a static picklist whose option id is `'0'`, the falsy id
 *     objectui#4873 was about. Membership must not confuse it with "unset";
 *   - `account` — a lookup with `referenceTo` and NO `options`: the remote
 *     search column, `renderValueInput`'s own `hasStaticOptionDomain` branch;
 *   - `account_pending` — a lookup whose `options` are PRESENT BUT EMPTY, the
 *     shape `deriveFilterFields` produces before the picklist values arrive.
 *     A membership test against it would clear everything, so the narrowing is
 *     inert here — and since objectui#5031 the render path reads that same
 *     criterion, so this column reaches the remote picker rather than an
 *     option-driven Select. The visibility assertions below therefore read the
 *     picker's id input, exactly as `account`'s do; the Select's own temporary
 *     -option path is pinned on `stage`, a column that really does own its
 *     option domain.
 */
const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  {
    value: 'stage',
    label: 'Stage',
    type: 'select',
    options: [
      { value: 'won', label: 'Won' },
      { value: 'lost', label: 'Lost' },
    ],
  },
  {
    value: 'stage_alt',
    label: 'Stage (alt)',
    type: 'select',
    options: [
      { value: 'won', label: 'Won (alt)' },
      { value: 'pending', label: 'Pending' },
    ],
  },
  {
    value: 'priority',
    label: 'Priority',
    type: 'status',
    options: [
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' },
    ],
  },
  {
    value: 'level',
    label: 'Level',
    type: 'select',
    options: [
      { value: '0', label: 'Zero' },
      { value: '1', label: 'One' },
    ],
  },
  { value: 'account', label: 'Account', type: 'lookup', referenceTo: 'accounts' },
  {
    value: 'account_pending',
    label: 'Account (pending)',
    type: 'lookup',
    referenceTo: 'accounts',
    options: [],
  },
];

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted OUT of the JSX, as in PR #4762 / #4779 / #4876's suites: the sync
  // effect re-seeds internal state whenever the `value` PROP's identity changes,
  // which would undo the interaction under test on the next render.
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
  const utils = render(
    <FilterBuilder fields={FIELDS as any} value={value as any} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

/** The row the component handed back on its most recent `onChange`. */
function lastRow(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the builder never called onChange').toBeGreaterThan(0);
  return calls[calls.length - 1][0].conditions[0];
}

/** Drive the REAL field dropdown — index 0 of the row's comboboxes. */
async function pickField(label: string) {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[0], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the field dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/** Drive the REAL operator dropdown — index 1 of the row's comboboxes. */
async function pickOperator(label: string) {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[1], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the operator dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/**
 * What the VALUE control displays — the symptom this card is about, read off the
 * rendered DOM rather than inferred.
 *
 * The value Select is the row's third combobox (field, operator, value). Radix
 * puts the matched item's children in the trigger, so this is literally the text
 * a user sees: `''` is the blank trigger of the bug report, and the placeholder
 * `'Select value'` is the honest "nothing picked" state.
 */
function valueTriggerText(): string {
  const triggers = screen.getAllByRole('combobox');
  expect(triggers.length, 'the row drew no value Select').toBeGreaterThan(2);
  return triggers[2].textContent ?? '';
}

/** Every checkbox row of a list-operator value control, label + checked state. */
function checkboxRows(): Array<{ label: string; checked: boolean }> {
  return screen.getAllByRole('checkbox').map((box) => ({
    label: box.parentElement?.textContent ?? '',
    checked: box.getAttribute('data-state') === 'checked',
  }));
}

describe('the reported repro: a text value pointed at a static picklist column', () => {
  it('clears the value the picklist cannot hold, instead of hiding it in the row', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickField('Stage');

    const row = lastRow(onChange);
    expect(row.field).toBe('stage');
    // The row used to keep `"acme"` here — persisted by the fold, queried by the
    // grid as `stage equals "acme"`, and invisible in the panel. `''` is
    // objectui#4781's scalar empty shape, unchanged.
    expect(row.value).toBe('');
  });

  it('leaves the value Select on its placeholder — nothing shown, nothing stored', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickField('Stage');

    // Before the fix these two disagreed: a blank trigger over a row carrying
    // `"acme"`. Now the placeholder and the empty row say the same thing.
    expect(valueTriggerText()).toBe('Select value');
    expect(lastRow(onChange).value).toBe('');
  });
});

describe('a static option domain clears what it cannot hold', () => {
  it('drops a scalar the new picklist does not offer', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'equals', value: 'lost' });
    await pickField('Priority');

    expect(lastRow(onChange)).toMatchObject({ field: 'priority', value: '' });
    expect(valueTriggerText()).toBe('Select value');
  });

  it('keeps the list entries the new picklist offers and drops the rest', async () => {
    const { onChange } = renderRow({
      field: 'stage',
      operator: 'in',
      value: ['won', 'acme', 'lost'],
    });
    await pickField('Stage (alt)');

    const row = lastRow(onChange);
    expect(row.operator).toBe('in');
    // Entry by entry, not all-or-nothing: `won` is an option of the new column,
    // so the user's good term survives; `acme` never was one and `lost` is the
    // OLD column's option, and neither can be shown or edited here.
    expect(row.value).toEqual(['won']);
    expect(checkboxRows()).toEqual([
      { label: 'Won (alt)', checked: true },
      { label: 'Pending', checked: false },
    ]);
  });

  it('falls to the list empty shape `[]` when no entry survives', async () => {
    const { onChange } = renderRow({
      field: 'stage',
      operator: 'in',
      value: ['won', 'lost'],
    });
    await pickField('Priority');

    // `[]`, objectui#4781's list empty shape — the "nothing filled in yet" shape
    // the write path drops, not a one-element array with an empty string in it.
    expect(lastRow(onChange).value).toEqual([]);
    expect(checkboxRows()).toEqual([
      { label: 'High', checked: false },
      { label: 'Low', checked: false },
    ]);
  });

  it('does not mistake the falsy option id `0` for an unfilled row', async () => {
    // The objectui#4873 interplay: `'0'` is a real option of `level`, and
    // membership is decided the way the controls decide visibility (`String()`
    // on both sides), so it must survive a switch between two columns that both
    // offer it. A membership test written with `!value` or `Number()` would
    // clear it and hand the user a placeholder where they had picked "Zero".
    const { onChange } = renderRow({ field: 'level', operator: 'equals', value: 0 });
    await pickField('Level');
    // Radix fires nothing when the field already selected is re-picked, so the
    // switch is asserted from the render instead: the row is untouched and the
    // trigger reads the option's label.
    expect(onChange).not.toHaveBeenCalled();
    expect(valueTriggerText()).toBe('Zero');
  });
});

describe('a remote/async option domain keeps the value AND shows it', () => {
  it('carries a value onto a remote lookup column instead of guessing it is invalid', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acc_007' });
    await pickField('Account');

    // `options` absent ⇒ the domain lives on the server. Clearing here would
    // delete a perfectly valid lookup id on the strength of a local option set
    // that never existed — the risk that made this card a separate ruling.
    expect(lastRow(onChange)).toMatchObject({ field: 'account', value: 'acc_007' });
  });

  it('shows the id on the remote column rather than an empty control', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acc_007' });
    await pickField('Account');

    // No DataSource in this render, so `LookupValuePicker` draws its by-hand id
    // input; with one it draws the popover trigger, which falls back to the raw
    // id the same way. Either way the value is on screen — never invisible.
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Enter Account id"]');
    expect(input, 'the remote lookup drew no id input').toBeTruthy();
    expect(input!.value).toBe('acc_007');
    expect(lastRow(onChange).value).toBe('acc_007');
  });

  it('keeps a value on a column whose options have not loaded yet', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acc_007' });
    await pickField('Account (pending)');

    // `options: []` is "not in place", not "the domain is empty". Membership
    // against it would clear every value on earth.
    expect(lastRow(onChange)).toMatchObject({ field: 'account_pending', value: 'acc_007' });
  });

  it('shows the kept value rather than leaving the control blank', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acc_007' });
    await pickField('Account (pending)');

    // The C half, still the invariant: the control shows what the row holds.
    // On `origin/main` (before PR #5030) this column drew a Select whose trigger
    // rendered `''` — Radix matches `SelectValue` against mounted `SelectItem`s
    // and there were none — which is shape B (row carries it, control blank) and
    // is what the ruling refuses. Since objectui#5031 the column reaches
    // `LookupValuePicker` instead of a Select at all, so the value is read off
    // the picker's by-hand id input; the ASSERTION is unchanged in substance —
    // what the row holds is on screen.
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Account (pending) id"]',
    );
    expect(input, 'the unloaded lookup drew no id input').toBeTruthy();
    expect(input!.value).toBe('acc_007');
    expect(lastRow(onChange).value).toBe('acc_007');
  });

  it('shows a value that arrived from a persisted view, without rewriting it', () => {
    // No switch happened, so nothing is cleared: silently mutating an incoming
    // `value` prop would rewrite a saved view behind the user's back. The
    // invariant the control owes is only that what the row holds is VISIBLE, and
    // it holds however the value got here.
    const { onChange } = renderRow({
      field: 'account_pending',
      operator: 'equals',
      value: 'acc_042',
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Account (pending) id"]',
    );
    expect(input, 'the unloaded lookup drew no id input').toBeTruthy();
    expect(input!.value).toBe('acc_042');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mounts a persisted non-member as its own option on a STATIC column', () => {
    // The Select's temporary-option path, which the two cases above used to
    // carry before objectui#5031 rerouted `account_pending` to the picker. It
    // has to stay pinned on a column that genuinely owns its option domain:
    // `stage` offers `won`/`lost`, the saved view filters by `acme`, no switch
    // happens so nothing narrows it away — and the trigger must still show it
    // rather than the blank of shape B.
    const { onChange } = renderRow({ field: 'stage', operator: 'equals', value: 'acme' });

    expect(valueTriggerText()).toBe('acme');
    expect(valueTriggerText()).not.toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a non-member list entry as its own checked row', () => {
    // The list face of the same mechanism: a selected entry matching no option
    // is checked nowhere, so the row filtered by a term the panel never drew.
    renderRow({ field: 'stage', operator: 'in', value: ['acme', 'won'] });

    expect(checkboxRows()).toEqual([
      { label: 'acme', checked: true },
      { label: 'Won', checked: true },
      { label: 'Lost', checked: false },
    ]);
  });

  it('lets the user remove a non-member list entry it just made visible', () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'in', value: ['acme', 'won'] });

    const outside = screen.getAllByRole('checkbox')[0];
    fireEvent.click(outside);

    // Visible AND actionable — the point of showing it rather than clearing it.
    expect(lastRow(onChange).value).toEqual(['won']);
  });
});

describe('a value the new column DOES offer survives the switch', () => {
  it('keeps a shared option id across two picklists', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'equals', value: 'won' });
    await pickField('Stage (alt)');

    expect(lastRow(onChange)).toMatchObject({ field: 'stage_alt', value: 'won' });
    // Same id, the new column's label — the value moved, the display followed.
    expect(valueTriggerText()).toBe('Won (alt)');
  });

  it('keeps a text value that happens to be an option of the new column', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'won' });
    await pickField('Stage');

    expect(lastRow(onChange).value).toBe('won');
    expect(valueTriggerText()).toBe('Won');
  });

  it('leaves a `between` range alone — two plain inputs, no option domain', async () => {
    // `between` draws range inputs and never consults `options`, so nothing is
    // out of domain there. Answered structurally in
    // `isOptionDrivenValueControl` rather than resting on the coincidence that
    // the select bucket does not offer `between` today.
    expect(
      narrowFilterValueToOptions(['acme', 'zeta'], FIELDS[2] as any, 'between'),
    ).toEqual(['acme', 'zeta']);
  });

  it('leaves the value alone on a switch between two non-option columns', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickOperator('Contains');
    await pickField('Title');

    // Blast-radius guard: the narrowing must be inert everywhere it has no
    // option domain to narrow to.
    expect(lastRow(onChange).value).toBe('acme');
  });
});

describe('narrowFilterValueToOptions — the A/C split, stated on the helper', () => {
  const STATIC_SELECT = {
    type: 'select',
    options: [
      { value: 'won', label: 'Won' },
      { value: 'lost', label: 'Lost' },
    ],
  };

  it('clears a scalar outside a static domain, keeps one inside it', () => {
    expect(narrowFilterValueToOptions('acme', STATIC_SELECT, 'equals')).toBe('');
    expect(narrowFilterValueToOptions('won', STATIC_SELECT, 'equals')).toBe('won');
  });

  it('compares membership as the controls do — `String()` on both sides', () => {
    const numericIds = { type: 'select', options: [{ value: '0', label: 'Zero' }] };
    expect(narrowFilterValueToOptions(0, numericIds, 'equals')).toBe(0);
    expect(narrowFilterValueToOptions('0', numericIds, 'equals')).toBe('0');
    expect(narrowFilterValueToOptions(1, numericIds, 'equals')).toBe('');
  });

  it('filters a list entry by entry', () => {
    expect(narrowFilterValueToOptions(['won', 'acme'], STATIC_SELECT, 'in')).toEqual(['won']);
    expect(narrowFilterValueToOptions(['acme'], STATIC_SELECT, 'in')).toEqual([]);
    expect(narrowFilterValueToOptions([], STATIC_SELECT, 'in')).toEqual([]);
  });

  it('reads the operator through the spec fold, so a stored alias narrows too', () => {
    // `not_in` is the spec spelling of the dropdown's `notIn`; both are list
    // arity, and a row read back in canonical form must be narrowed as a list
    // rather than folded to a scalar.
    expect(narrowFilterValueToOptions(['won', 'acme'], STATIC_SELECT, 'not_in')).toEqual(['won']);
  });

  it('treats an unfilled row as unfilled, never as a non-member to clear', () => {
    expect(narrowFilterValueToOptions('', STATIC_SELECT, 'equals')).toBe('');
    expect(narrowFilterValueToOptions([], STATIC_SELECT, 'equals')).toBe('');
  });

  it('is inert where the local option set cannot vouch for the value', () => {
    // The three remote/async shapes, each returned untouched.
    expect(narrowFilterValueToOptions('acc_007', { type: 'lookup' }, 'equals')).toBe('acc_007');
    expect(
      narrowFilterValueToOptions('acc_007', { type: 'lookup', options: [] }, 'equals'),
    ).toBe('acc_007');
    expect(
      narrowFilterValueToOptions('acc_007', { type: 'lookup', options: undefined }, 'equals'),
    ).toBe('acc_007');
    expect(narrowFilterValueToOptions(['a', 'b'], { type: 'lookup', options: [] }, 'in')).toEqual([
      'a',
      'b',
    ]);
  });

  it('is inert on a column whose control shows anything anyway', () => {
    // A `text` column carrying `options` keeps its plain input — the value is
    // visible, so there is nothing to decide. Clearing it would be the fix
    // over-reaching into a control that never had the defect.
    const textWithOptions = { type: 'text', options: [{ value: 'won', label: 'Won' }] };
    expect(narrowFilterValueToOptions('acme', textWithOptions, 'equals')).toBe('acme');
  });

  it('is inert on a malformed or absent field entry', () => {
    // Inert because `hasStaticOptionDomain` gates on `Array.isArray` BEFORE any
    // option is read — not because the reading is lenient. Measured: with that
    // gate removed, this case does not merely answer wrongly, it throws inside
    // `optionKeysOf` (`.map` on a string). The criterion is what keeps the
    // narrowing total, so it is pinned here as well as on the A/C split.
    expect(narrowFilterValueToOptions('acme', undefined, 'equals')).toBe('acme');
    expect(
      narrowFilterValueToOptions('acme', { type: 'select', options: 'won' as any }, 'equals'),
    ).toBe('acme');
  });
});
