/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The adapter reaches a `kind:'react'` page's blocks, and keeps reaching them
 * when the host swaps it.
 *
 * The blocks resolve it from the `SchemaRendererProvider` the page is wrapped
 * in — the channel every registered block reads. It is NOT stamped onto the
 * node: `dataSource` there is the spec's per-element binding, and the wrapper
 * used to pun the adapter (or `null`) into it (objectui#11070). The stand-in
 * below therefore reads the context, as the real blocks do, and asserts the
 * node carries no `dataSource` at all.
 *
 * `ReactKindPage` memoises the injected scope on `[schema, adapter]`, and a
 * change to either recompiles the page and costs its `useState`
 * (objectui#2954). The `adapter` half now serves the page's OWN code, not the
 * blocks (see the comment on that memo): an effect that reads through
 * `useAdapter()` without naming the adapter in its dependencies is re-run by
 * that recompile.
 *
 * These pin both halves: a swapped adapter must reach the blocks, and an
 * unchanged one must not disturb the page.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx, SchemaRendererContext } from '@object-ui/react';
import type { PageDocumentNode } from '@object-ui/types';
import '../renderers';

/** The adapter each render of the stand-in block resolved from its context. */
const seen: unknown[] = [];
/** Whether each render's node carried a `dataSource` key. */
const nodeCarriedDataSource: boolean[] = [];

const makeAdapter = (id: string) => ({ id, find: async () => [] }) as any;

const SOURCE = `
function Page() {
  const [n, setN] = React.useState(0);
  return (
    <div>
      <button data-testid="counter" onClick={() => setN(n + 1)}>{n}</button>
      <ListView objectName="showcase_project" />
    </div>
  );
}`;

const SCHEMA: PageDocumentNode = { type: 'home', kind: 'react', name: 'adapter_page', label: 'Adapter page', source: SOURCE };

// The barrel import moved to module scope (see the `import '../renderers'`
// above): inside the hook its cold transform was billed to `hookTimeout`, which
// is why this carried a raised timeout. The override below still has to run
// AFTER the barrel, and it does — static imports are evaluated before any hook.
// See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
beforeAll(() => {
  ComponentRegistry.register('list-view', (props: any) => {
    seen.push(React.useContext(SchemaRendererContext)?.dataSource);
    nodeCarriedDataSource.push(!!props.schema && 'dataSource' in props.schema);
    return <div data-testid="list-view-double" />;
  });
});

afterAll(() => {
  ComponentRegistry.unregister('list-view');
});

function Host({ adapter }: { adapter: any }) {
  return (
    <AdapterCtx.Provider value={adapter}>
      <SchemaRenderer schema={SCHEMA} />
    </AdapterCtx.Provider>
  );
}

describe('kind:\'react\' page ↔ adapter identity', () => {
  it('hands blocks the new adapter when the host swaps it', async () => {
    seen.length = 0;
    nodeCarriedDataSource.length = 0;
    const first = makeAdapter('first');
    const second = makeAdapter('second');

    const { findByTestId, rerender } = render(<Host adapter={first} />);
    await findByTestId('list-view-double');
    expect(seen.at(-1)).toBe(first);

    rerender(<Host adapter={second} />);

    // The block reads the provider, so the new adapter reaches it through
    // context propagation; the node carries none on any render.
    await waitFor(() => expect(seen.at(-1)).toBe(second));
    expect(nodeCarriedDataSource).not.toContain(true);
  });

  it('leaves the page alone while the adapter identity holds', async () => {
    seen.length = 0;
    const adapter = makeAdapter('stable');

    const { findByTestId, getByTestId, rerender } = render(<Host adapter={adapter} />);
    const counter = await findByTestId('counter');
    counter.click();
    await waitFor(() => expect(getByTestId('counter').textContent).toBe('1'));

    rerender(<Host adapter={adapter} />);

    // The other half of the tradeoff: the same adapter must not recompile, or
    // the page loses its state on every parent render.
    expect(getByTestId('counter').textContent).toBe('1');
    expect(seen.at(-1)).toBe(adapter);
  });
});
