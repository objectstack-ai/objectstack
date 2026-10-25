/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The five widgets that never read the delivered `error` now report
 * `aria-invalid` on a FOCUSABLE control, through the real inline seam
 * (objectui#7126).
 *
 * ## The defect
 *
 * objectui#7008 made `FieldEditWidget` DELIVER the declared `error` key
 * (`toHostProps`, landed as f08bcd9af). Of the 27 distinct components in
 * `EDIT_WIDGETS`, 21 read it; five did not — `TextField`, `BooleanField`
 * (`boolean` + `toggle`), `DateField`, `DateTimeField`, `TimeField` — so for
 * their field types the delivery was inert and `aria-invalid` was still never
 * set. `text` being in that set is what made it live rather than tidy: it is
 * the most common type in any object, and the kanban `RequiredFieldsDialog`
 * renders whatever types the target column made required.
 *
 * ## Why the FACTORY and not the widgets directly
 *
 * In the FORM these five were already announced correctly and always had been:
 * `<FormControl>` is a Radix `Slot`, its `aria-invalid` reached the control
 * through each widget's props spread untouched, and
 * `widget-aria-invalid-registry-e2e.test.tsx` sweeps exactly that path with an
 * EMPTY `NOT_YET_DELIVERED` ledger. So a form-based test would have been green
 * before this change and proves nothing about it.
 *
 * `FieldEditWidget` renders no Slot. It is the seam every NON-form host
 * composes — the grid's inline cell editor, the detail page's inline edit
 * (`InlineFieldInput`), the kanban required-fields dialog — and the only way
 * the state reaches the control there is the declared `error` prop. That is
 * the path that was broken, so that is the path measured here.
 *
 * ## What is NOT claimed
 *
 * The marking only. objectui#3222's slot drives `aria-invalid` and renders no
 * text; the visible message stays with the host. Nothing here becomes visible
 * that was not visible before.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { FieldEditWidget } from '../FieldEditWidget';
// `date` / `datetime` draw the platform picker, which `FieldEditWidget` loads
// lazily (objectui#12664). Imported at module scope, with the specifier the
// factory's `import()` resolves to, so that load costs nothing inside a test.
import '../widgets/date-picker/DatePickerField';

afterEach(() => cleanup());

/**
 * HTML's own focusability rules, as a selector — copied from
 * `widget-aria-invalid-registry-e2e.test.tsx` on purpose, so both sweeps judge
 * "the control a keyboard user can land on" by one definition.
 *
 * This is the objectui#5223 line: a mark on a non-focusable wrapper satisfies a
 * subtree query while telling a screen-reader user nothing, and it is the
 * cheapest way to make an assertion like the ones below go green without
 * helping anyone.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function describeEl(el: Element): string {
  const role = el.getAttribute('role');
  const type = el.getAttribute('type');
  return `${el.tagName.toLowerCase()}${type ? `[type=${type}]` : ''}${role ? `[role=${role}]` : ''}`;
}

async function renderInline(field: Record<string, unknown>, error?: string) {
  const { container } = render(
    <FieldEditWidget
      field={field as never}
      value={undefined as never}
      onChange={() => {}}
      error={error}
    />,
  );
  // A lazily loaded widget (the date picker) settles first; the rest render
  // synchronously and pass straight through.
  await waitFor(() => expect(container.querySelector('[data-testid="field-edit-widget-loading"]')).toBeNull());
  return container;
}

/**
 * The population of objectui#7126, by the field TYPE each widget serves inline
 * — six types, five widgets (`boolean` and `toggle` both resolve to
 * `BooleanField`), plus the two branch variants that a type key alone does not
 * reach: `TextField`'s textarea branch (`rows > 1`) and `BooleanField`'s
 * checkbox branch (`widget: 'checkbox'`). Both are real authored configs, and
 * each renders a DIFFERENT element, so a fix applied to only one branch of
 * either widget still fails here.
 */
const CASES: ReadonlyArray<readonly [label: string, field: Record<string, unknown>]> = [
  ['text', { name: 'f', type: 'text', label: 'F' }],
  ['text (rows > 1 -> textarea branch)', { name: 'f', type: 'text', label: 'F', rows: 4 }],
  ['boolean (switch branch)', { name: 'f', type: 'boolean', label: 'F' }],
  ['boolean (widget: checkbox branch)', { name: 'f', type: 'boolean', label: 'F', widget: 'checkbox' }],
  ['toggle', { name: 'f', type: 'toggle', label: 'F' }],
  ['date', { name: 'f', type: 'date', label: 'F' }],
  ['datetime', { name: 'f', type: 'datetime', label: 'F' }],
  ['time', { name: 'f', type: 'time', label: 'F' }],
];

describe('inline field widgets announce a delivered `error` (objectui#7126)', () => {
  it.each(CASES)(
    '%s — carries aria-invalid="true" on a FOCUSABLE control when the host delivers `error`',
    async (_label, field) => {
      const container = await renderInline(field, 'Required');

      const carriers = Array.from(container.querySelectorAll('[aria-invalid="true"]'));
      expect(
        carriers.map(describeEl),
        'the host delivered `error` and nothing in the rendered widget says so — assistive tech is never told the field failed',
      ).not.toEqual([]);

      // THE WRAPPER-MARK HOLE (objectui#5223). `BooleanField` is the case this
      // exists for: it renders its control inside a flex `div`, and marking
      // that `div` would satisfy the query above while the switch the user
      // actually operates announces nothing.
      expect(
        carriers.filter((el) => el.matches(FOCUSABLE)).map(describeEl),
        `aria-invalid sits ONLY on non-focusable element(s) [${carriers.map(describeEl).join(', ')}] — that is a wrapper mark, not a control mark`,
      ).not.toEqual([]);
    },
  );

  it.each(CASES)(
    '%s — says an explicit aria-invalid="false" when the host delivers no `error`',
    async (_label, field) => {
      // The load-bearing half, and the reason this is a two-state reading
      // rather than "the attribute exists": `!!undefined` must yield `"false"`,
      // so a valid field SAYS it is valid instead of staying mute (the
      // objectui#3222 discipline). Without this, an unconditional
      // `aria-invalid="true"` would pass the case above.
      const container = await renderInline(field);

      const control = container.querySelector(FOCUSABLE);
      expect(control, 'no focusable control rendered at all').not.toBeNull();
      expect(control).toHaveAttribute('aria-invalid', 'false');
      expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    },
  );

  it('CONTROL: a widget that ALREADY read `error` reports the same way through the same harness', async () => {
    // Without this, a green sweep above could not be distinguished from a
    // harness that marks everything it renders. `select` -> `SelectField` was
    // one of the 21 readers before this change (objectui#3306 / #7008's pin),
    // so it must read `true`/`false` here for exactly the reasons the five now
    // do — same factory, same delivery, same assertion.
    const SELECT_FIELD = {
      name: 'stage',
      type: 'select',
      label: 'Stage',
      options: [{ label: 'New', value: 'new' }],
    };

    const invalid = await renderInline(SELECT_FIELD, 'Required');
    const trigger = invalid.querySelector('[role="combobox"]')!;
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');

    cleanup();

    const valid = await renderInline(SELECT_FIELD);
    expect(valid.querySelector('[role="combobox"]')).toHaveAttribute('aria-invalid', 'false');
  });

  it('CONTROL: `user` was a FALSE zero in the census and is NOT in the population', async () => {
    // The one trap in the measurement that produced this card. A word-boundary
    // `error` grep over the 27 `EDIT_WIDGETS` components returns SIX zeroes,
    // and `UserField` is one of them — but it renders `LookupField` with a
    // props spread, so it delivers `error` transitively and has always marked.
    // A naive census reports six and is wrong about one; this pins the sixth so
    // the next reader does not "fix" a widget that was never broken (and so a
    // future refactor that flattens the delegation cannot silently drop it).
    const container = await renderInline(
      { name: 'owner_id', type: 'user', label: 'Owner', reference: 'sys_user' },
      'Required',
    );

    const carriers = Array.from(container.querySelectorAll('[aria-invalid="true"]'));
    expect(carriers.filter((el) => el.matches(FOCUSABLE)).map(describeEl)).not.toEqual([]);
  });
});
