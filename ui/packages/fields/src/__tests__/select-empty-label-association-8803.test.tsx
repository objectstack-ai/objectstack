/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The zero-option state of the REGISTERED `field:select` widget keeps the
 * host's label association (objectui#8803).
 *
 * The other half of objectui#3991, measured there and split out because it is
 * the same FAULT reached by a different MECHANISM. #3991 repaired the BUILT-IN
 * `select` branch, which `form.tsx` owns and can therefore reason about. This
 * branch belongs to `SelectField`, a component `ComponentRegistry` resolves, so
 * the host cannot know what it renders and must not guess.
 *
 * ## What was broken
 *
 * Measured on `origin/main` at `50798f37d`, the real form renderer hosting one
 * `{ name: 'wempty', label: 'WEmpty', type: 'field:select', options: [] }`:
 *
 * ```
 * label for="_r_2_-form-item"   label.control = NULL        (id on NO element)
 * div   data-testid="select-empty-wempty"                   (no id, no name)
 * getByLabelText('WEmpty') -> throws "however no form control was found
 *                             associated to that label"
 * ```
 *
 * The widget's zero-option branch returns before its `toDomProps` spread, so
 * not one host key reaches an element: the `…-form-item` id is on nothing and
 * the label's `for` DANGLES.
 *
 * ## Why the repair is a LABELABLE element and not any of the alternatives
 *
 * Each alternative below was rendered and read, not argued. `label.control` is
 * the HTML mechanism itself (`HTMLLabelElement.control`); `byLabelText` is
 * Testing Library resolving the same association an assistive technology walks.
 *
 * ```
 * shape                         label.control   byLabelText   accessible name
 * div carrying the host id      NULL            THROWS        (empty)
 * no `for` at all               NULL            THROWS        (empty)
 * button[disabled]              button          RESOLVES      WEmpty
 * output                        output          RESOLVES      WEmpty
 * ```
 *
 *  - **the host id on the `div`** — the shape #3991 had just judged inert. The
 *    dangling pointer disappears from the DOM and the label is exactly as
 *    unusable: `for` may only reference a LABELABLE element, so pointing it at
 *    a `div` leaves `HTMLLabelElement.control` null and contributes no
 *    accessible name;
 *  - **dropping the `for`** — #3991's remedy on the branch IT owns. It does not
 *    transfer: a widget cannot drop an attribute the host emits, and the
 *    reading above shows the label ends up no more usable than before;
 *  - **declaring `select` as `labelling: 'group'`** — measured to move the LIVE
 *    path: a select WITH options lost its working `<label for>` to the
 *    `button[role="combobox"]` (objectui#3306's path) and still left the
 *    zero-option branch with no association at all, because the branch consumes
 *    no IDREF either. Two changes, and the defect survives both;
 *  - **a synthetic control** (`button`) — reads the same as `output` here, and
 *    is the "synthetic role for a thing that is not a control" #3991 refused.
 *
 * `<output>` is a labelable element whose implicit role (`status`) claims no
 * interactivity: it is the result of a computation, which is literally what the
 * box states. So `labelling: 'control'` — "the component's outermost rendered
 * element is a LABELABLE HTML element" — becomes TRUE of this branch for the
 * first time, and nothing on the host side, and no published declaration, has
 * to move.
 *
 * The widgets are registered raw rather than through `registerAllFields()`,
 * whose `React.lazy` loaders put an unbounded module load inside a bounded
 * `findBy` window — this repo's known flake generator (AGENTS.md 测试纪律,
 * objectui#3010).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { SelectField } from '../widgets/SelectField';
import { RadioField } from '../widgets/RadioField';

beforeAll(() => {
  // `select` registers with NO `labelling` key — `'control'` spelled as absence,
  // exactly as `registerField` does it. `radio` carries `labelling: 'group'`,
  // the declaration objectui#3990 / #4005 answer.
  ComponentRegistry.register('select', SelectField as any, {
    namespace: 'field',
    skipFallback: true,
  });
  ComponentRegistry.register('radio', RadioField as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'group',
  });
}, 30000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        defaultValues: {},
        fields,
      }}
    />,
  );
}

const item = (name: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!el) throw new Error(`no form item rendered for field "${name}"`);
  return el;
};

const hostLabel = (name: string): HTMLLabelElement => {
  const el = item(name).querySelector('label');
  if (!el) throw new Error(`no host label rendered for field "${name}"`);
  return el as HTMLLabelElement;
};

/** Elements whose `aria-describedby` NAMES `id`, resolved against the document. */
const describedbyConsumers = (id: string): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[aria-describedby]')).filter((el) =>
    (el.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(id),
  );

const EMPTY_SELECT = {
  name: 'wempty',
  label: 'WEmpty',
  type: 'field:select',
  options: [],
  description: 'Some help',
};

describe('objectui#8803 — a zero-option `field:select` keeps its label association', () => {
  it('the label `for` resolves to a LABELABLE element, not to nothing', () => {
    renderForm([EMPTY_SELECT]);
    const label = hostLabel('wempty');

    // The reproduction line. `HTMLLabelElement.control` is the HTML mechanism,
    // not a query helper's opinion: it is null both when `for` points at no
    // element at all (the reported defect) and when it points at a
    // non-labelable one (the div-carries-the-id shape that was rejected).
    expect(label.getAttribute('for')).toBeTruthy();
    expect(label.control, 'the host label names no labelable element').not.toBeNull();
  });

  it('the element it resolves to IS the empty-state box, carrying the host id', () => {
    renderForm([EMPTY_SELECT]);
    const label = hostLabel('wempty');
    const box = screen.getByTestId('select-empty-wempty');

    // Ownership, resolved against the document — the same discipline
    // `readonly-host-plumbing-e2e` uses. A name query would answer "no match"
    // for both "nobody carries the id" and "the id is on the wrong element".
    expect(document.getElementById(label.getAttribute('for')!)).toBe(box);
    expect(box.tagName.toLowerCase()).toBe('output');
  });

  it('`getByLabelText` resolves it, and the box is named by the visible label', () => {
    renderForm([EMPTY_SELECT]);

    // The author/test-side symptom the card names: this threw
    // "Found a label with the text of: WEmpty, however no form control was
    // found associated to that label".
    expect(screen.getByLabelText('WEmpty')).toBe(screen.getByTestId('select-empty-wempty'));
    expect(screen.getByTestId('select-empty-wempty')).toHaveAccessibleName('WEmpty');
  });

  it('the visible help text is described by the box that replaced the control', () => {
    renderForm([EMPTY_SELECT]);
    const descEl = item('wempty').querySelector<HTMLElement>('[id$="-form-item-description"]');
    expect(descEl).not.toBeNull();

    // The objectui#4005 half of the same early return: the field renders no
    // input in this state, so this box is the only surface that can carry the
    // description. Measured at 0 consumers before this fix.
    expect(describedbyConsumers(descEl!.id)).toEqual([screen.getByTestId('select-empty-wempty')]);
  });

  it('the box carries no CONTROL-channel state — the objectui#3291 / #4005 line', () => {
    renderForm([EMPTY_SELECT]);
    const box = screen.getByTestId('select-empty-wempty');

    // `aria-invalid` / `aria-required` report what a user's own editing may do
    // wrong, to the element they would edit; `name` is the leak objectui#3291
    // sweeps for. None of them belongs on a surface nobody can edit.
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).not.toHaveAttribute('aria-required');
    expect(box).not.toHaveAttribute('name');
    // Named by `for`, so a second IDREF channel would be the double naming
    // objectui#3978 removed.
    expect(box).not.toHaveAttribute('aria-labelledby');
  });

  /* ── Live controls ─────────────────────────────────────────────────────── */

  it('LIVE CONTROL — a `field:select` WITH options does not move (objectui#3306)', () => {
    renderForm([
      {
        name: 'wfull',
        label: 'WFull',
        type: 'field:select',
        options: [{ label: 'Alpha', value: 'a' }],
        description: 'Some help',
      },
    ]);
    const label = hostLabel('wfull');

    // The path that was already correct: the `for` reaches Radix's
    // `button[role="combobox"]`, which IS labelable.
    expect(label.control?.tagName.toLowerCase()).toBe('button');
    expect(label.control).toHaveAttribute('role', 'combobox');
    expect(screen.getByLabelText('WFull')).toBe(label.control);
  });

  it('LIVE CONTROL — a zero-option `field:radio` keeps the group IDREF channel', () => {
    renderForm([
      { name: 'rempty', label: 'REmpty', type: 'field:radio', options: [], description: 'Some help' },
    ]);
    const label = hostLabel('rempty');
    const box = screen.getByTestId('radio-empty-rempty');

    // objectui#3990 / #4005: a group-labelled widget publishes the label id and
    // answers by IDREF instead. Untouched by this card — and the reason the
    // repair here could not simply reuse that channel.
    expect(label.getAttribute('for')).toBeNull();
    expect(label.id).toBeTruthy();
    expect(box.getAttribute('aria-labelledby')?.split(/\s+/)).toContain(label.id);
    expect(box).toHaveAttribute('role', 'group');
    expect(screen.getByLabelText('REmpty')).toBe(box);
  });

  /* ── NOT evidence ──────────────────────────────────────────────────────── */

  it('NOT EVIDENCE (reads the same before and after) — the box still states the empty copy', () => {
    // Kept because a repair that changed the element must not change what the
    // box SAYS, but it cannot distinguish the fixed tree from the broken one:
    // the text was already correct. It is named here so no reader counts it.
    renderForm([EMPTY_SELECT]);
    expect(screen.getByTestId('select-empty-wempty')).toHaveTextContent(/no options available/i);
  });
});
