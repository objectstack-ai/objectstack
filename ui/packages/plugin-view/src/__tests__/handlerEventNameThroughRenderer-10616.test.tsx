/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10616 — the three view event-name keys work through the REAL
 * `SchemaRenderer`, which is the path an authored document takes.
 *
 * ## The defect this pins
 *
 * objectui#6124 declared `FilterUISchema.onChange`, `SortUISchema.onChange`
 * and `ViewSwitcherSchema.onViewChange` as EVENT NAMES: the authored string is
 * the name of a `CustomEvent` dispatched on `window`. But `SchemaRenderer`
 * spreads every non-metadata node key as a React prop, so the same string also
 * lands in the component's same-named CALLBACK prop. Each control called that
 * prop before dispatching, so the first interaction threw
 * `TypeError: onChange is not a function` (`onViewChange` on the switcher) and
 * the window event after it never fired.
 *
 * ## Why this file does not mock `SchemaRenderer`
 *
 * The objectui#6124 pins (`handlerEventNameLiveness.6124.test.tsx`) render the
 * components DIRECTLY and mock `SchemaRenderer`, so the callback prop is always
 * `undefined` there and they stayed green over this defect. Those pins still
 * own what they own — the keys are declared, and the directly rendered control
 * dispatches — and this file owns the other entry: a registered node rendered
 * through the real renderer and registry, with and without a host function.
 *
 * ## What each leg asserts
 *
 * - AUTHORED string, no host prop: the documented event fires once with the
 *   documented `detail`, and nothing is reported (no `TypeError`).
 * - CONTROL — a host FUNCTION passed through `SchemaRenderer` next to the same
 *   authored string: the function is called once with the new value AND the
 *   event still fires. It was green before the fix too; it is here so the fix
 *   cannot pass by dropping the host channel.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import type { FilterUISchema, SortUISchema, ViewSwitcherSchema } from '@object-ui/types';
// Module scope, not a hook: this import IS the registration of
// `filter-ui`, `sort-ui` and `view-switcher` in the real registry.
import '../index';

interface Reading<D> {
  /** Every error React or the runtime reported while the interaction ran. */
  reported: string[];
  /** The `detail` of every `eventName` event dispatched on `window`. */
  details: D[];
}

/**
 * Run `act` and record what it reported and dispatched.
 *
 * Errors are read from THREE places because React 19 does not rethrow an
 * error thrown inside an event handler out of `fireEvent` — it REPORTS it
 * (window `error` event and `console.error`). A bare `expect(...).toThrow()`
 * would read a crashing control as green.
 */
function interact<D>(eventName: string, act: () => void): Reading<D> {
  const reported: string[] = [];
  const details: D[] = [];
  const onEvent = (e: Event) => details.push((e as CustomEvent<D>).detail);
  const onError = (e: Event) => {
    reported.push(String((e as ErrorEvent).error ?? e));
    e.preventDefault();
  };
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    reported.push(args.map((a) => String(a)).join(' '));
  });
  window.addEventListener(eventName, onEvent);
  window.addEventListener('error', onError);
  try {
    act();
  } catch (err) {
    reported.push(String(err));
  } finally {
    window.removeEventListener(eventName, onEvent);
    window.removeEventListener('error', onError);
    spy.mockRestore();
  }
  return { reported, details };
}

describe('filter-ui: an authored onChange event name through SchemaRenderer (objectui#10616)', () => {
  const node: FilterUISchema = {
    type: 'filter-ui',
    layout: 'inline',
    filters: [{ field: 'qty', label: 'Qty', type: 'number' }],
    onChange: 'zz10616:filter',
  };
  const typeSeven = (container: HTMLElement) => {
    const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input, 'the registered filter-ui rendered no number input').toBeTruthy();
    fireEvent.change(input!, { target: { value: '7' } });
  };

  it('dispatches the named window event with detail { values } and reports nothing', () => {
    const { container } = render(<SchemaRenderer schema={node} />);
    const { reported, details } = interact<{ values: Record<string, unknown> }>(
      'zz10616:filter',
      () => typeSeven(container),
    );
    expect(reported).toEqual([]);
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({ values: { qty: 7 } });
  });

  it('CONTROL: a host function passed through SchemaRenderer is called, and the event still fires', () => {
    const host = vi.fn();
    const { container } = render(<SchemaRenderer schema={node} onChange={host} />);
    const { reported, details } = interact<{ values: Record<string, unknown> }>(
      'zz10616:filter',
      () => typeSeven(container),
    );
    expect(reported).toEqual([]);
    expect(host).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledWith({ qty: 7 });
    expect(details).toEqual([{ values: { qty: 7 } }]);
  });
});

describe('sort-ui: an authored onChange event name through SchemaRenderer (objectui#10616)', () => {
  const node: SortUISchema = {
    type: 'sort-ui',
    variant: 'buttons',
    fields: [{ field: 'name', label: 'Name' }],
    onChange: 'zz10616:sort',
  };
  const clickName = () => fireEvent.click(screen.getByRole('button', { name: /name/i }));

  it('dispatches the named window event with detail { sort } and reports nothing', () => {
    render(<SchemaRenderer schema={node} />);
    const { reported, details } = interact<{ sort: unknown }>('zz10616:sort', clickName);
    expect(reported).toEqual([]);
    expect(details).toEqual([{ sort: [{ field: 'name', direction: 'asc' }] }]);
  });

  it('CONTROL: a host function passed through SchemaRenderer is called, and the event still fires', () => {
    const host = vi.fn();
    render(<SchemaRenderer schema={node} onChange={host} />);
    const { reported, details } = interact<{ sort: unknown }>('zz10616:sort', clickName);
    expect(reported).toEqual([]);
    expect(host).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledWith([{ field: 'name', direction: 'asc' }]);
    expect(details).toEqual([{ sort: [{ field: 'name', direction: 'asc' }] }]);
  });
});

describe('view-switcher: an authored onViewChange event name through SchemaRenderer (objectui#10616)', () => {
  const node: ViewSwitcherSchema = {
    type: 'view-switcher',
    variant: 'buttons',
    views: [{ type: 'list' }, { type: 'grid' }],
    onViewChange: 'zz10616:view',
  };
  const clickGrid = () => fireEvent.click(screen.getByRole('button', { name: /grid/i }));

  it('dispatches the named window event with detail { view } and reports nothing', () => {
    render(<SchemaRenderer schema={node} />);
    const { reported, details } = interact<{ view: string }>('zz10616:view', clickGrid);
    expect(reported).toEqual([]);
    expect(details).toEqual([{ view: 'grid' }]);
  });

  it('CONTROL: a host function passed through SchemaRenderer is called, and the event still fires', () => {
    const host = vi.fn();
    render(<SchemaRenderer schema={node} onViewChange={host} />);
    const { reported, details } = interact<{ view: string }>('zz10616:view', clickGrid);
    expect(reported).toEqual([]);
    expect(host).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledWith('grid');
    expect(details).toEqual([{ view: 'grid' }]);
  });
});
