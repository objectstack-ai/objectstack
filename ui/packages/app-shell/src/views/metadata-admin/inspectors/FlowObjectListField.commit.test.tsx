// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression (objectui#2838): the repeater must never publish upward from inside
 * a `setRows` updater.
 *
 * React runs updater functions during the RENDER phase. `commitCell` / `removeRow`
 * used to call `flush()` — which calls the parent's `onCommit` — in there, so a
 * parent that stores the committed value took a `setState` mid-render:
 *
 *   Cannot update a component (`MetadataResourceEditPageImpl`) while rendering a
 *   different component (`FlowObjectListField`).
 *
 * Two things kept this hidden from the existing suites, and both are encoded in
 * the setup below:
 *
 *   • **The parent must hold state.** `ResourceEditPage` does (`FlowNodeInspector`
 *     → `setField` → `onPatch`); an `onCommit: vi.fn()` takes no update, so there
 *     is nothing for React to complain about.
 *   • **The component must already have a queued update.** React computes an
 *     updater eagerly inside `dispatchSetState` when the fiber has no pending
 *     work, which runs it in the handler and hides the bug. Queue one first —
 *     type in a cell, then hit the row's ✕ in the same tick — and the updater is
 *     deferred to the render pass, where the warning fires. In the real designer
 *     the inspector is never that quiescent, which is why every commit warned
 *     there while a lone `fireEvent.click` here stays silent.
 *
 * The commit BEHAVIOUR is asserted alongside the warning: publishing nothing at
 * all would silence React just as effectively and would be the wrong fix.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { FlowObjectListField } from './FlowObjectListField';
import type { FlowConfigColumn } from './flow-node-config';

afterEach(cleanup);

const COLUMNS: FlowConfigColumn[] = [
  { key: 'type', label: 'Type', kind: 'text' },
  { key: 'value', label: 'Value', kind: 'text' },
];

/** Set a controlled input's value the way the browser does, so React's onChange runs. */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function StatefulHost({ initial, onCommitted }: {
  initial: Array<Record<string, unknown>>;
  onCommitted: (v: Array<Record<string, unknown>> | undefined) => void;
}) {
  const [list, setList] = React.useState<Array<Record<string, unknown>> | undefined>(initial);
  return (
    <FlowObjectListField
      label="Approvers"
      columns={COLUMNS}
      value={list}
      onCommit={(v) => {
        setList(v);
        onCommitted(v);
      }}
      addLabel="Add"
      removeLabel="Remove"
      emptyLabel="None"
    />
  );
}

describe('FlowObjectListField — upward commit (objectui#2838)', () => {
  let errors: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = [];
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(' '));
    });
  });

  afterEach(() => spy.mockRestore());

  const setStateInRender = () => errors.filter((e) => /Cannot update a component/.test(e));

  it('commits with a pending update in flight, without a setState-in-render warning', () => {
    const onCommitted = vi.fn();
    render(
      <StatefulHost
        initial={[
          { type: 'user', value: 'u1' },
          { type: 'position', value: 'finance' },
        ]}
        onCommitted={onCommitted}
      />,
    );

    // Type into the second row's Value (queues a `setCell` update), then remove
    // the first row — both in one tick, so the remove cannot be computed eagerly.
    act(() => {
      const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
      typeInto(inputs[3], 'legal');
      // `.click()` rather than `fireEvent.click`: fireEvent wraps each call in
      // its own `act`, which would flush the typed update before the remove and
      // hand the remove an idle fiber — the eager-updater path that hides the bug.
      (screen.getAllByLabelText('Remove')[0] as HTMLElement).click();
    });

    expect(setStateInRender()).toEqual([]);
    // The surviving row is published — and it carries the character typed in the
    // same tick, so the flush read the rows that were actually applied rather
    // than a stale snapshot.
    expect(onCommitted).toHaveBeenCalledWith([{ type: 'position', value: 'legal' }]);
  });

  it('removing the last row commits `undefined`, still without the warning', () => {
    const onCommitted = vi.fn();
    render(<StatefulHost initial={[{ type: 'user', value: 'u1' }]} onCommitted={onCommitted} />);

    fireEvent.click(screen.getByLabelText('Remove'));

    // An empty list commits `undefined` so the key drops out of the node config
    // rather than persisting as `[]`.
    expect(onCommitted).toHaveBeenCalledWith(undefined);
    expect(setStateInRender()).toEqual([]);
  });

  it('a pure re-render never republishes — only an interaction commits', () => {
    const onCommitted = vi.fn();
    const { rerender } = render(
      <StatefulHost initial={[{ type: 'user', value: 'u1' }]} onCommitted={onCommitted} />,
    );
    rerender(<StatefulHost initial={[{ type: 'user', value: 'u1' }]} onCommitted={onCommitted} />);

    // The commit effect is gated on an intent flag, not on `rows` changing, so
    // re-renders and external value syncs stay silent.
    expect(onCommitted).not.toHaveBeenCalled();
  });
});
