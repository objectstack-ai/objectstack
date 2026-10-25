/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10853 — `element:record_picker` re-reads its options when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * change to the object it queries, in place, and never touches the bound
 * page-variable value.
 *
 * Before this card the option read ran only when the adapter or the query
 * (object, filter, sort, limit) changed, so after a page action over raw HTTP
 * the picker kept offering the pre-action records until its host remounted it,
 * and `PageView`'s remount is what objectui#10519 removes.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, inside a real `PageVariablesProvider` whose variable is bound
 * to the picker. Reads answer at once until a case holds them, so the case can
 * look at the picker while a re-read is in flight. The bare
 * `useDataInvalidation` reader beside the picker is the positive control.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, act, cleanup, waitFor, screen } from '@testing-library/react';
import {
  AdapterCtx,
  PageVariablesProvider,
  SchemaRenderer,
  notifyDataChanged,
  useDataInvalidation,
  usePageVariables,
} from '@object-ui/react';
// Registers `element:record_picker` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

type Row = Record<string, any>;

interface HeldRead {
  objectName: string;
  resolve: (value: unknown) => void;
}

function makeAdapter(stored: Row[]) {
  const held: HeldRead[] = [];
  const state = { hold: false, rows: stored };
  const adapter = {
    find: vi.fn((objectName: string) => {
      if (state.hold) {
        return new Promise((resolve) => {
          held.push({ objectName, resolve });
        });
      }
      return Promise.resolve({ data: state.rows.map((r) => ({ ...r })) });
    }),
  };
  return { adapter, held, state };
}

/** The positive control: a bare reader of the picker's object. */
function BusControl() {
  const nonce = useDataInvalidation('account');
  return <span data-testid="bus-control">{nonce}</span>;
}

/** What the page holds in the variable the picker writes. */
function BoundValue() {
  const { variables } = usePageVariables();
  return <span data-testid="bound-value">{String(variables.sel)}</span>;
}

// The picker reads its object from the node-level `dataSource` binding (objectui#11880).
const PICKER = { type: 'element:record_picker', id: 'picker', dataSource: { object: 'account' } };

function mountPicker(stored: Row[], node: Record<string, unknown> = PICKER) {
  const made = makeAdapter(stored);
  render(
    <AdapterCtx.Provider value={made.adapter as never}>
      <PageVariablesProvider definitions={[{ name: 'sel', type: 'record_id', source: 'picker', defaultValue: 'a1' } as never]}>
        <BusControl />
        <BoundValue />
        <SchemaRenderer schema={node as never} />
      </PageVariablesProvider>
    </AdapterCtx.Provider>,
  );
  return made;
}

async function settle(fn: () => void = () => {}) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}
const rest = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const emit = (change: { objectName: string; recordId?: string }) => settle(() => notifyDataChanged(change));

const trigger = () => screen.getByTestId('record-picker-trigger') as HTMLButtonElement;
const boundValue = () => screen.getByTestId('bound-value').textContent;

async function mountAtRest(stored: Row[] = [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }]) {
  const made = mountPicker(stored);
  await waitFor(() => expect(made.adapter.find).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(trigger().textContent).toBe('Acme'));
  await rest();
  return made;
}

describe('element:record_picker re-reads its options on the data-invalidation bus (objectui#10853)', () => {
  it('an unscoped change ("*") re-reads once, in place, keeping the bound value', async () => {
    const { adapter, held, state } = await mountAtRest();
    const triggerNode = trigger();
    state.hold = true;

    await emit({ objectName: '*' });

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    await waitFor(() => expect(adapter.find, 'the options never re-read after the bus reported a change').toHaveBeenCalledTimes(2));
    expect(adapter.find.mock.calls[1][0]).toBe('account');
    // In flight: the same control, enabled, still showing the bound record.
    expect(trigger(), 'the re-read remounted the picker').toBe(triggerNode);
    expect(trigger().disabled, 'the re-read disabled the picker').toBe(false);
    expect(trigger().textContent, 'the re-read blanked the picker to "Loading…"').toBe('Acme');
    expect(boundValue()).toBe('a1');

    await settle(() => held[0].resolve({ data: [{ id: 'a1', name: 'Acme (renamed)' }, { id: 'a2', name: 'Globex' }] }));
    await waitFor(() => expect(trigger().textContent).toBe('Acme (renamed)'));
    expect(trigger()).toBe(triggerNode);
    expect(boundValue(), 'the re-read changed the bound page-variable value').toBe('a1');
  });

  it('a change to its object re-reads once; an unrelated object does not', async () => {
    const { adapter } = await mountAtRest();

    await emit({ objectName: 'unrelated_object' });
    await rest();
    expect(adapter.find, 'a change to another object re-read the options').toHaveBeenCalledTimes(1);

    await emit({ objectName: 'account', recordId: 'a2' });
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(2));
    await rest();
    expect(adapter.find, 'one change re-read the options more than once').toHaveBeenCalledTimes(2);
  });

  it('the bound record gone from the re-read options: the value is kept, the control shows no label, and the label returns with the record', async () => {
    const { adapter, state } = await mountAtRest();

    state.rows = [{ id: 'a2', name: 'Globex' }];
    await emit({ objectName: 'account' });
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(2));
    await rest();

    expect(boundValue(), 'the re-read cleared the bound page-variable value').toBe('a1');
    // The value names no offered record: neither the old label nor the
    // placeholder is drawn (a value is set, so the placeholder does not apply).
    expect(trigger().textContent).toBe('');
    expect(trigger().disabled).toBe(false);

    state.rows = [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }];
    await emit({ objectName: 'account' });
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(trigger().textContent).toBe('Acme'));
    expect(boundValue()).toBe('a1');
  });

  it('control: a picker with no object reads nothing, on mount or on an invalidation', async () => {
    const { adapter } = mountPicker([{ id: 'a1', name: 'Acme' }], { type: 'element:record_picker', id: 'picker', properties: {} });
    await rest();

    await emit({ objectName: '*' });
    await rest();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(adapter.find).not.toHaveBeenCalled();
  });
});
