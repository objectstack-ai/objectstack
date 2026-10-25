/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FieldEditWidget` DELIVERS the NON-DOM half of the contract it DECLARES
 * (objectui#7008) — the other half of objectui#6909 / #7009.
 *
 * ## The defect this pins closed
 *
 * #7009 made the factory forward `toDomProps(props)`, so the declared DOM block
 * finally arrived. `FieldWidgetComponentProps` also declares `error`,
 * `onUploadingChange`, and a whole "Host plumbing" block (`dataSource`,
 * `dependentValues`, `dependsOn`, `dependsOnLabels`, `emptyHint`,
 * `onSelectRecord`, `onCreateNew`) — and nothing carried any of it. A host
 * passed them with no type error and the widget never received them.
 *
 * `error` was the LIVE one, and measurably so on `main` at `71d83a6b1`:
 * `InlineFieldInput` (`@object-ui/plugin-detail`, since PR #7109) already
 * passes `error={error}` into this factory, which dropped it — so a control
 * that had failed validation never reported `aria-invalid`. A sighted user saw
 * the red hint; a screen-reader user was told nothing. That is the class
 * objectui#3222 / #3290 exist to close, and the one #7002 closed for
 * `NumberField` one layer down.
 *
 * ## What binds it, and what this file adds
 *
 * The fix hands the widget `toHostProps(props)` — a SIBLING executor, not more
 * entries in `DOM_PASS_THROUGH_KEYS`, because none of these keys is DOM-legal
 * and that whitelist is closed against exactly them. Three compile-time
 * assertions in `toHostProps.ts` make the two executors PARTITION the contract,
 * so a future declared key cannot go undelivered without a red build.
 *
 * A type cannot see the two things this file pins: that the keys ARRIVE at
 * runtime, and that arriving actually changes what assistive tech is told.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { SchemaRendererContext } from '@object-ui/react';

import { FieldEditWidget } from '../FieldEditWidget';
import type { FieldWidgetComponentProps } from '../widgets/types';

afterEach(() => cleanup());

/** `select` resolves to `SelectField`, whose trigger carries `aria-invalid`. */
const SELECT_FIELD = {
  name: 'stage',
  type: 'select',
  label: 'Stage',
  options: [{ label: 'New', value: 'new' }],
} as never;

/** `text` resolves to `TextField` — used only where the widget is irrelevant. */
const TEXT_FIELD = { name: 'f', type: 'text', label: 'F' } as never;

describe('FieldEditWidget delivers its declared NON-DOM block (objectui#7008)', () => {
  it('forwards every declared host-plumbing key it is handed, at the factory boundary', () => {
    const onUploadingChange = vi.fn();
    const onSelectRecord = vi.fn();
    const onCreateNew = vi.fn();
    const dataSource = { find: vi.fn() };

    // `zzcanary` is the control, carried over from the #7009 pin: NOT declared
    // on `FieldWidgetComponentProps` (passing it is a compile error, hence the
    // cast), but an SDUI node or a field config can carry exactly such a key at
    // runtime. Without it, "everything forwards now" would be
    // indistinguishable from having reopened the bare `{...props}` spread.
    const props = {
      field: TEXT_FIELD,
      value: '',
      onChange: () => {},
      readonly: false,
      // the two declared controlled-input keys the factory neither owns nor
      // routes to the DOM
      error: 'Required',
      onUploadingChange,
      // the declared "Host plumbing" block, minus `compact` (factory-owned)
      dataSource,
      dependentValues: { account: 'a1' },
      dependsOn: 'account',
      dependsOnLabels: { account: 'Account' },
      emptyHint: 'Pick an account first',
      onSelectRecord,
      onCreateNew,
      zzcanary: 'CANARY-STR',
    } as unknown as FieldWidgetComponentProps<string>;

    // Called as a plain function rather than rendered: it uses no hooks and its
    // return value IS the widget element, so this reads the handoff itself.
    const element = FieldEditWidget(props);
    expect(element).not.toBeNull();
    const forwarded = element!.props as Record<string, unknown>;

    // Exact set, not a subset — a subset check cannot see the control key, and
    // an extra key appearing here is the leak this guards.
    expect(Object.keys(forwarded).sort()).toEqual(
      [
        // rendered by the factory itself
        'field',
        'value',
        'onChange',
        'readonly',
        // the declared NON-DOM keys, via `toHostProps`
        'error',
        'onUploadingChange',
        'dataSource',
        'dependentValues',
        'dependsOn',
        'dependsOnLabels',
        'emptyHint',
        'onSelectRecord',
        'onCreateNew',
      ].sort(),
    );

    // Identity, not just presence: a conduit hands over the host's own object.
    expect(forwarded.dataSource).toBe(dataSource);
    expect(forwarded.onSelectRecord).toBe(onSelectRecord);
    expect(forwarded.onCreateNew).toBe(onCreateNew);
    expect(forwarded.onUploadingChange).toBe(onUploadingChange);
    expect(forwarded.error).toBe('Required');

    // CONTROL: the undeclared authored key is still dropped.
    expect(forwarded).not.toHaveProperty('zzcanary');
  });

  it('CONTROL: a key the host did not pass stays ABSENT, not `undefined`', () => {
    // The #7009 pin asserts an exact boundary set for a host that passes only
    // DOM keys. Forwarding the non-DOM block as nine always-present
    // `undefined`s would have broken that pin AND made the boundary unreadable
    // — "what the host supplied" is the claim, so absence must survive.
    const element = FieldEditWidget({
      field: TEXT_FIELD,
      value: '',
      onChange: () => {},
    } as FieldWidgetComponentProps<string>);
    expect(element).not.toBeNull();
    const forwarded = element!.props as Record<string, unknown>;

    for (const key of [
      'error',
      'onUploadingChange',
      'dataSource',
      'dependentValues',
      'dependsOn',
      'dependsOnLabels',
      'emptyHint',
      'onSelectRecord',
      'onCreateNew',
    ]) {
      expect(forwarded).not.toHaveProperty(key);
    }
    // CONTROL: the factory's own props are still there, so the assertion above
    // is not passing because the handoff is empty.
    expect(forwarded).toHaveProperty('field');
    expect(forwarded).toHaveProperty('value');
  });

  it('`error` reaches a real control as `aria-invalid` — the live a11y defect', async () => {
    const { getByTestId, rerender } = render(
      <FieldEditWidget field={SELECT_FIELD} value="" onChange={() => {}} error="Required" />,
    );
    // `SelectField` puts the DOM pass-through and `aria-invalid` on
    // `SelectTrigger` — the focusable `button role="combobox"` the user and
    // their screen reader actually meet (objectui#3306) — not on Radix `Root`,
    // which renders no element.
    const trigger = getByTestId('select-trigger-stage');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');

    // CONTROL: the same widget, same host, no `error`. `SelectField` computes
    // `!!error`, so a valid field SAYS "false" rather than staying mute — which
    // makes this a real two-state reading and not "the attribute exists".
    rerender(<FieldEditWidget field={SELECT_FIELD} value="" onChange={() => {}} />);
    expect(getByTestId('select-trigger-stage')).toHaveAttribute('aria-invalid', 'false');
  });

  it('`dataSource`: the explicit prop WINS over SchemaRendererContext', async () => {
    // The one delivered key that can CHANGE behaviour rather than only add it:
    // the relational widgets fall back to `SchemaRendererContext` (which the
    // grid already provides), so delivering the prop creates a precedence
    // question. `LookupField` already resolves "explicit prop > field-level >
    // wrapper field > SchemaRendererContext > none"; the factory is a conduit
    // and adds no second authority. This pins that the delivered prop is what
    // the widget ends up querying.
    const LOOKUP_FIELD = { name: 'account', type: 'lookup', reference: 'accounts' } as never;
    const makeSource = () => ({
      find: vi.fn().mockResolvedValue([]),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'accounts' }),
    });

    const fromProp = makeSource();
    const fromContext = makeSource();

    render(
      <SchemaRendererContext.Provider value={{ dataSource: fromContext } as never}>
        <FieldEditWidget
          field={LOOKUP_FIELD}
          value={undefined}
          onChange={() => {}}
          dataSource={fromProp}
        />
      </SchemaRendererContext.Provider>,
    );

    await waitFor(() => expect(fromProp.getObjectSchema).toHaveBeenCalledWith('accounts'));
    expect(fromContext.getObjectSchema).not.toHaveBeenCalled();

    cleanup();

    // CONTROL: drop the prop and the SAME context source IS queried. Without
    // this, "the context was not called" would be indistinguishable from a
    // context that was never wired up in this test at all.
    const contextOnly = makeSource();
    render(
      <SchemaRendererContext.Provider value={{ dataSource: contextOnly } as never}>
        <FieldEditWidget field={LOOKUP_FIELD} value={undefined} onChange={() => {}} />
      </SchemaRendererContext.Provider>,
    );
    await waitFor(() => expect(contextOnly.getObjectSchema).toHaveBeenCalledWith('accounts'));
  });
});
