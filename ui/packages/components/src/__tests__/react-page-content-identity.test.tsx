/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A `kind:'react'` page recompiles on CONTENT, not on schema identity
 * (objectui#13268).
 *
 * The console's `PageView` hands `SchemaRenderer` a fresh spread of the page
 * schema on every render, and any other host may do the same. `ReactKindPage`
 * used to key its scope on that object's identity, so every host re-render
 * recompiled the page — a new `Page` function, a new element type, a remount —
 * and the page's own `useState` was lost (measured on the showcase Task Desk:
 * its `editId` reset and an open record drawer vanished).
 *
 * `react-page-state.test.tsx` did not catch it: its host re-renders with a
 * module-scope schema, the one shape a real host does not produce. These pins
 * re-render with a NEW object of EQUAL content, under StrictMode, and keep the
 * controls that stop "stable" from meaning "stale": a changed source or a
 * changed declared scope value still recompiles.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';
// Registers PageRenderer for `type:'home'`, which dispatches kind:'react'. At
// module scope, not in a hook (object-ui/no-dynamic-import-in-test-hook).
import '../renderers';

const adapter = { find: async () => [], getObjectSchema: async () => ({ name: 'x', fields: {} }) } as any;

/** A page with local state, which also prints a declared scope value. */
const counterSource = (extra = '') => `
function Page() {
  const [n, setN] = React.useState(0);
  return (
    <div>
      <button data-testid="counter" onClick={() => setN(n + 1)}>{n}</button>
      <span data-testid="greeting">{variables.greeting}</span>
      ${extra}
    </div>
  );
}`;

/** A FRESH schema object on every call, the shape `PageView` hands over. */
function pageSchema(over: Record<string, unknown> = {}) {
  return {
    type: 'home',
    kind: 'react',
    name: 'identity_page',
    source: counterSource(),
    variables: { greeting: 'hello' },
    context: { params: { appName: 'showcase' } },
    ...over,
  };
}

function Host({ tick, schema }: { tick: number; schema: any }) {
  return (
    <React.StrictMode>
      <AdapterCtx.Provider value={adapter}>
        <span data-testid="tick">{tick}</span>
        <SchemaRenderer schema={schema} />
      </AdapterCtx.Provider>
    </React.StrictMode>
  );
}

async function mountAndClick() {
  const utils = render(<Host tick={0} schema={pageSchema()} />);
  fireEvent.click(await utils.findByTestId('counter'));
  expect(utils.getByTestId('counter').textContent).toBe('1');
  return utils;
}

describe("kind:'react' page recompiles on content, not schema identity (objectui#13268)", () => {
  it('keeps its state across a host re-render that hands it a new but equal schema object', async () => {
    const { getByTestId, rerender } = await mountAndClick();

    rerender(<Host tick={1} schema={pageSchema()} />);
    rerender(<Host tick={2} schema={pageSchema()} />);

    expect(getByTestId('tick').textContent).toBe('2');
    // '0' means the page was remounted: a new schema object with the same
    // content recompiled it.
    expect(getByTestId('counter').textContent).toBe('1');
  });

  it('CONTROL: a changed source recompiles, and the page resets', async () => {
    const { findByTestId, getByTestId, rerender } = await mountAndClick();

    rerender(<Host tick={1} schema={pageSchema({ source: counterSource('<i data-testid="marker" />') })} />);

    expect(await findByTestId('marker')).toBeTruthy();
    expect(getByTestId('counter').textContent).toBe('0');
  });

  it('CONTROL: a changed declared scope value recompiles, reaches the page, and the page resets', async () => {
    const { findByText, getByTestId, rerender } = await mountAndClick();
    expect(getByTestId('greeting').textContent).toBe('hello');

    rerender(<Host tick={1} schema={pageSchema({ variables: { greeting: 'bonjour' } })} />);

    expect(await findByText('bonjour')).toBeTruthy();
    // Scope values are compiled in, not passed as props: the new value reaches
    // the page through a recompile, so the page's state resets with it.
    expect(getByTestId('counter').textContent).toBe('0');
  });

  it('CONTROL: a changed nested page value (a route param) recompiles too', async () => {
    const { getByTestId, rerender } = await mountAndClick();

    rerender(<Host tick={1} schema={pageSchema({ context: { params: { appName: 'crm' } } })} />);

    // `page` is a declared scope value, and `context.params` rides it.
    expect(getByTestId('counter').textContent).toBe('0');
  });
});
