/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FieldEditWidget` DELIVERS the DOM pass-through block it DECLARES
 * (objectui#6909).
 *
 * ## The defect this pins closed
 *
 * The factory's props are `FieldWidgetComponentProps`: the controlled-input
 * keys intersected with `FieldWidgetDomProps`, `AriaAttributes` and the open
 * `data-` family. A host could therefore pass `id` / `name` / `tabIndex` /
 * `onBlur` / `onFocus` / `onClick` / any `aria-*` / any `data-*` with no type
 * error — and the body destructured `{ field, value, onChange, readonly,
 * autoFocus }` and rendered the widget with those five plus `compact`.
 * Everything else was silently dropped. `autoFocus` was the ONLY survivor of
 * the whole DOM block.
 *
 * That is this package's own first-class defect class, named in
 * `widgets/toDomProps.ts`: "a key that type-checks, reads as supported, and
 * silently never reaches the element" (objectui#3290's `aria-required`,
 * objectui#3222's validation slot). `toDomProps` binds the WIDGET contract to
 * its whitelist with compile-time assertions in both directions; nothing bound
 * THIS factory to either, so the factory was the one hole left in the chain.
 *
 * ## What binds it now — and why this file still exists
 *
 * The fix hands the widget `toDomProps(props)` — the package's own executor of
 * the declaration, not a second key list written out here. That reuse is the
 * structural guard: `toDomProps.ts`'s direction-2 assertion already makes
 * `keyof FieldWidgetDomProps extends DomPassThroughKey` a compile error to
 * violate, so a key added to the declared DOM block now reaches the widget
 * through this factory automatically. One mechanism, one judge.
 *
 * This file pins the half a type cannot: that the forwarded set actually
 * ARRIVES on a real control at runtime, and that the forwarding did NOT become
 * a bare `{...props}` spread — the shape `toDomProps` exists to prevent.
 *
 * ## Probe and control
 *
 * Two measurement points on purpose, because they answer different questions:
 *
 *  - the DOM (`it` #1) — "the host's set reaches a control the user can focus",
 *    which is the claim the card makes and the only one a host cares about;
 *  - the FACTORY BOUNDARY (`it` #2) — the exact prop set this component hands
 *    the widget. The DOM alone cannot see a reopened spread, because each
 *    widget re-filters through its own `toDomProps` and would quietly rescue
 *    the mistake. Read at the boundary, an undeclared authored key that the
 *    factory forwarded is visible immediately.
 *
 * `FieldEditWidget` is called as a plain function there rather than rendered:
 * it uses no hooks, and its return value IS the widget element, so this reads
 * the handoff itself with nothing in between.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { FieldEditWidget } from '../FieldEditWidget';
import type { FieldWidgetComponentProps } from '../widgets/types';

afterEach(() => cleanup());

/**
 * The locator is a `data-*` sentinel: an open family `toDomProps` forwards by
 * prefix, and — unlike `id` — nothing downstream rewrites it, so "the sentinel
 * is on element X" means "the host set reached element X" and nothing else.
 */
const PROBE = 'data-os6909';

/** `text` resolves to `TextField`, which spreads its whole `toDomProps` set onto a real `<input>`. */
const TEXT_FIELD = { name: 'f', type: 'text', label: 'F' } as never;

describe('FieldEditWidget delivers its declared DOM pass-through block (objectui#6909)', () => {
  it("a host's id / name / tabIndex / aria-* / data-* / onBlur / onFocus / onClick reach the control", () => {
    const onBlur = vi.fn();
    const onFocus = vi.fn();
    const onClick = vi.fn();

    const { container } = render(
      <FieldEditWidget
        field={TEXT_FIELD}
        value=""
        onChange={() => {}}
        id="host-id"
        name="host-name"
        tabIndex={3}
        onBlur={onBlur}
        onFocus={onFocus}
        onClick={onClick}
        aria-label="host label"
        data-os6909="probe"
      />,
    );

    const carriers = container.querySelectorAll(`[${PROBE}]`);
    expect(carriers.length).toBeGreaterThan(0);

    // A real control, not a wrapper — the host set is only useful where the
    // user's focus and pointer actually land.
    const control = carriers[0] as HTMLElement;
    expect(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT']).toContain(control.tagName);

    expect(control).toHaveAttribute('id', 'host-id');
    expect(control).toHaveAttribute('name', 'host-name');
    expect(control).toHaveAttribute('tabindex', '3');
    expect(control).toHaveAttribute('aria-label', 'host label');
    expect(control).toHaveAttribute(PROBE, 'probe');

    fireEvent.blur(control);
    expect(onBlur).toHaveBeenCalledTimes(1);

    fireEvent.focus(control);
    expect(onFocus).toHaveBeenCalledTimes(1);

    fireEvent.click(control);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: forwards exactly the declared set — an undeclared authored key is still dropped', () => {
    const onBlur = vi.fn();
    const onFocus = vi.fn();
    const onClick = vi.fn();
    const onChange = vi.fn();

    // `zzcanary` is the control. It is NOT declared on
    // `FieldWidgetComponentProps` — passing it is a compile error, which is
    // why this object is cast — but an SDUI node or a field config can carry
    // exactly such a key at runtime, and putting it on an element is the
    // `[object Object]` leak `toDomProps` was written for. It must not survive
    // the factory. Without this assertion "everything forwards now" would be
    // indistinguishable from having reopened the bare spread.
    const props = {
      field: TEXT_FIELD,
      value: '',
      onChange,
      readonly: false,
      id: 'host-id',
      name: 'host-name',
      autoFocus: true,
      tabIndex: 3,
      onBlur,
      onFocus,
      onClick,
      className: 'host-class',
      disabled: true,
      'aria-label': 'host label',
      [PROBE]: 'probe',
      zzcanary: 'CANARY-STR',
    } as unknown as FieldWidgetComponentProps<string>;

    const element = FieldEditWidget(props);
    expect(element).not.toBeNull();

    // `ReactElement`'s prop parameter defaults to `unknown` under these React
    // typings, so the handoff is read through one explicit narrowing rather
    // than `any` — the assertion below is about KEYS, and this keeps that the
    // only claim being made about it.
    const forwarded = element!.props as Record<string, unknown>;

    // Exact set, not a subset. A subset check cannot see the control key, and
    // an extra key appearing here is precisely the regression this guards.
    //
    // If a future key is added to `FieldWidgetDomProps`, `toDomProps.ts`'s
    // compile-time assertion forces it into `DOM_PASS_THROUGH_KEYS`, this list
    // goes red, and whoever added it confirms delivery through this factory
    // too. That red is the point, not a maintenance cost.
    expect(Object.keys(forwarded).sort()).toEqual(
      [
        // rendered by the factory itself
        'field',
        'value',
        'onChange',
        'readonly',
        // the declared DOM pass-through block (`FieldWidgetDomProps`)
        'id',
        'name',
        'autoFocus',
        'tabIndex',
        'onBlur',
        'onFocus',
        'onClick',
        // declared controlled-input keys the same executor forwards, because
        // withholding them would make it a silent styling / interactivity
        // dropper (see `toDomProps.ts`)
        'className',
        'disabled',
        // the two open families, matched by prefix
        'aria-label',
        PROBE,
      ].sort(),
    );

    expect(forwarded).not.toHaveProperty('zzcanary');
  });

  it('CONTROL: the undeclared key never reaches the DOM either', () => {
    const { container } = render(
      <FieldEditWidget
        {...({
          field: TEXT_FIELD,
          value: '',
          onChange: () => {},
          [PROBE]: 'probe',
          zzcanary: 'CANARY-STR',
        } as unknown as FieldWidgetComponentProps<string>)}
      />,
    );

    // The probe proves the render really carried a host set through, so the
    // absence below is a measurement and not an empty tree.
    expect(container.querySelectorAll(`[${PROBE}]`).length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[zzcanary]').length).toBe(0);
    expect(container.innerHTML).not.toContain('CANARY-STR');
  });
});
