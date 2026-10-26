/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in `select` branch renders NO control when its option list is
 * empty, so its visible label emits no `for` — objectui#3991.
 *
 * `for` may only reference a labelable element (`button`, `input`, `meter`,
 * `output`, `progress`, `select`, `textarea`). When the branch's option list
 * resolves empty — unconfigured, or a `dependsOn` gate withholding it (#2284) —
 * it returns `BuiltinSelectEmptyState`, a `<div>` carrying the status text, and
 * `<FormControl>`'s Slot put the field's id on that `div`. Measured on
 * `origin/main` @ `b6d07df4b`, for `{ name: 'empty', label: 'Empty', type:
 * 'select', options: [] }`:
 *
 * ```
 *   label for="_r_2_-form-item"  ->  ownerTag = DIV
 *   getByLabelText('Empty')      ->  throws "…the element associated with this
 *                                    label (<div />) is non-labellable…"
 * ```
 *
 * ## What this defect is, and what it is NOT
 *
 * Zero user-facing harm, and the fix is worth landing without inflating it:
 * there is no focusable control anywhere in this state, so neither "clicking
 * the label does nothing" nor "the control has no accessible name" can occur —
 * the thing a name would name does not exist. The cost is inert, invalid HTML
 * plus an author/test-side error that reads like a broken renderer when it is a
 * correctly-rendered empty state, and whose remedy line ("you can use
 * aria-label or aria-labelledby instead") points at a `div`.
 *
 * ## What the fix does NOT achieve, measured
 *
 * `getByLabelText('Empty')` still THROWS after the fix — with the truthful
 * "no form control was found associated to that label" instead of the
 * misleading "non-labellable" one. That is inherent and not a shortfall of the
 * fix: Testing Library throws for any label whose text matches while it
 * associates no control, and the only way to make it resolve is to give the
 * empty state an associable target — an `aria-labelledby` IDREF or a synthetic
 * role. Both were refused on objectui#3991: in this branch there is no control
 * at all, so either one would name a thing that is not a control — the same
 * category error as the `for`, spelled differently. The pins below therefore
 * assert the DOM, and assert the DEFECT-SPECIFIC phrase is gone rather than
 * pinning Testing Library's full wording (a third-party string).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/** HTML's labelable elements — the only ones a `<label for>` may address. */
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

/**
 * Stands in for a registered option widget (`@object-ui/components` tests never
 * load `@object-ui/fields`). It renders a REAL control even for an empty option
 * list — deliberately, because that is the case the host must not break: see
 * the last describe block.
 */
function SelectWidgetProbe(props: any) {
  const { name, value: _value, onChange: _onChange, field: _field, error: _error, options: _options, ...rest } = props;
  return <button type="button" role="combobox" data-testid={`probe-${name}`} {...rest} />;
}

beforeAll(() => {
  ComponentRegistry.register('select', SelectWidgetProbe, { namespace: 'field' });
}, 30000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(fields: any[], defaultValues: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        defaultValues,
        fields,
        onSubmit: () => {},
      }}
    />,
  );
}

/** The `<label>` rendered for `data-field="<name>"`. */
function labelOf(name: string): HTMLLabelElement {
  const el = document.querySelector(`[data-field="${name}"] label`);
  if (!el) throw new Error(`no label rendered for field "${name}"`);
  return el as HTMLLabelElement;
}

/**
 * Every `<label for=…>` in the document, with what its `for` actually reaches.
 * Read from the DOM rather than through a query helper: the defect is a
 * property of the emitted attribute, and a helper that throws would hide which
 * of the two failures (dangling vs non-labelable) is present.
 */
function labelTargets(): Array<{ text: string; forId: string; resolves: boolean; labelable: boolean }> {
  return Array.from(document.querySelectorAll('label'))
    .map((el) => {
      const forId = el.getAttribute('for') ?? '';
      const target = forId ? document.getElementById(forId) : null;
      return {
        text: (el.textContent ?? '').trim(),
        forId,
        resolves: !!target,
        labelable: !!target && LABELABLE.has(target.tagName.toLowerCase()),
      };
    })
    .filter((l) => l.forId !== '');
}

/** The message `getByLabelText` threw, or `''` when it resolved. */
function labelTextError(text: string): string {
  try {
    screen.getByLabelText(text);
    return '';
  } catch (e) {
    return String((e as Error).message);
  }
}

const EMPTY_FIELD = { name: 'empty', label: 'Empty', type: 'select', options: [] };

describe('built-in select, empty option list — no control, so no `for` (objectui#3991)', () => {
  it('emits a label with no `for` at all', () => {
    renderForm([EMPTY_FIELD]);

    const label = labelOf('empty');
    // The defect verbatim: `for="_r_N_-form-item"` naming the status `div`.
    expect(label.hasAttribute('for')).toBe(false);
    // The label is still there, and still reads as the field's name.
    expect(label.textContent?.trim()).toBe('Empty');
  });

  it('leaves no `for` in the document pointing at a non-labelable element', () => {
    renderForm([EMPTY_FIELD]);

    // Document-wide, not just this field's label: the invariant is that a
    // `for` this renderer emits always reaches a labelable element.
    expect(labelTargets().filter((l) => !l.labelable)).toEqual([]);
  });

  it('still renders the empty-state message beside the label', () => {
    renderForm([EMPTY_FIELD]);

    // The fix must not have removed the branch's actual output — only the
    // association to it.
    expect(screen.getByText('No options available')).toBeTruthy();
  });

  it('no longer fails `getByLabelText` with the misleading non-labelable error', () => {
    renderForm([EMPTY_FIELD]);

    const message = labelTextError('Empty');
    // Negative assertion on the ONE phrase the defect uniquely produced —
    // Testing Library emits it only when a label's `for` reaches an element
    // that cannot be labelled. Deliberately not a pin on its full wording.
    expect(message).not.toMatch(/non-labellable/i);
    // And the honest residue, asserted so it cannot be mistaken for a
    // regression later: with no control in the branch there is nothing to
    // resolve to, so the query still finds nothing. See the file header.
    expect(screen.queryAllByLabelText('Empty')).toHaveLength(0);
  });
});

describe('built-in select, dependency-gated option list (objectui#2284 + #3991)', () => {
  const GATED = [
    { name: 'parent', label: 'Parent', type: 'select', options: [{ label: 'A', value: 'a' }] },
    {
      name: 'child',
      label: 'Child',
      type: 'select',
      dependsOn: 'parent',
      options: [{ label: 'X', value: 'x', visibleWhen: "parent == 'a'" }],
    },
  ];

  it('drops the `for` on the gated field while it renders the gate hint', () => {
    renderForm(GATED);

    expect(labelOf('child').hasAttribute('for')).toBe(false);
    expect(labelTargets().filter((l) => !l.labelable)).toEqual([]);
  });

  it('leaves the CONTROLLING field, which does render a control, untouched', () => {
    renderForm(GATED);

    // The no-collateral half: suppression is keyed to the empty branch, not to
    // the field being a `select`, so a populated sibling keeps its association.
    const parent = labelOf('parent');
    expect(parent.hasAttribute('for')).toBe(true);
    const target = document.getElementById(parent.getAttribute('for')!);
    expect(target).toBeTruthy();
    expect(LABELABLE.has(target!.tagName.toLowerCase())).toBe(true);
  });
});

describe('built-in select WITH options — association unchanged (objectui#3976 stays green)', () => {
  it('resolves the label to the labelable trigger', () => {
    renderForm([{ name: 'status', label: 'Status', type: 'select', options: [{ label: 'Open', value: 'open' }] }]);

    const labelled = screen.getAllByLabelText('Status');
    expect(labelled).toHaveLength(1);
    expect(LABELABLE.has(labelled[0].tagName.toLowerCase())).toBe(true);
    expect(labelTargets().filter((l) => !l.labelable)).toEqual([]);
  });
});

describe('the registered-widget path is deliberately NOT suppressed (objectui#3991)', () => {
  it('keeps the `for` for a `field:select` widget that renders a control on an empty list', () => {
    // Why the host does not extend the suppression across the registry
    // boundary: what a widget renders in its empty state is the WIDGET's
    // business (`labelling`, objectui#3961), and a third-party `field:select`
    // may render a real control for an empty option list — as this probe does.
    // Suppressing the `for` on a host-side guess about a component the registry
    // resolved would break the association for a widget that had it right.
    renderForm([{ name: 'wempty', label: 'WEmpty', type: 'field:select', options: [] }]);

    const label = labelOf('wempty');
    expect(label.hasAttribute('for')).toBe(true);
    const labelled = screen.getAllByLabelText('WEmpty');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(screen.getByTestId('probe-wempty'));
    expect(labelTargets().filter((l) => !l.labelable)).toEqual([]);
  });
});
