/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A `kind:'react'` page keeps its own state (objectui#2954).
 *
 * The page's `source` is evaluated into a fresh `Page` function on every
 * compile — a new element TYPE, which React remounts. So the page's `useState`
 * survives only as long as nothing recompiles it, and that holds only while
 * BOTH links in the chain stay identity-stable: `ReactRunner` memoises on
 * `(code, scope)`, and `ReactKindPage` rebuilds `scope` only when the schema's
 * CONTENT or the adapter changes (objectui#13268; a new but equal schema object
 * is pinned in `react-page-content-identity.test.tsx`).
 *
 * Break either link and nothing fails loudly. Types check, every scope-contract
 * test still passes, the page still renders — it just silently drops whatever
 * the user had typed, scrolled to, or selected, at a moment nobody can trace
 * back to a scope object. These tests are the tripwire, written against the
 * user-visible symptom rather than the memo internals.
 *
 * The lazy-load case is the one worth staring at. `react-page.tsx` deliberately
 * does NOT subscribe to ComponentRegistry changes the way SchemaRenderer does —
 * a reasonable-looking "fix" for load-order gaps, and the thing that would make
 * every lazy plugin finishing its import wipe every react page on screen.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { CAP_REACT_PAGES, ComponentRegistry, enableCapability } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';

const adapter = { find: async () => [], getObjectSchema: async () => ({ name: 'showcase_project', fields: {} }) } as any;

/** A page that holds interactive state, plus an optional extra block. */
const counterSource = (extra = '') => `
function Page() {
  const [n, setN] = React.useState(0);
  return (
    <div>
      <button data-testid="counter" onClick={() => setN(n + 1)}>{n}</button>
      ${extra}
    </div>
  );
}`;

/** Module-scope so the schema identity is stable across host re-renders. */
const PLAIN_SCHEMA = { type: 'home', kind: 'react', name: 'test_page', source: counterSource() };

// Registers PageRenderer for `type:'home'`, which dispatches kind:'react'. At
// module scope, NOT inside a `beforeAll` — there the cold transform is billed to
// `hookTimeout`, which is why this carried a raised timeout. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

// `kind:'react'` pages run only where the host turns the react-pages capability on
// (it defaults off); the pages this file renders need it on.
enableCapability(CAP_REACT_PAGES);

afterEach(() => {
  ComponentRegistry.unregister('object-kanban', 'plugin-kanban');
  ComponentRegistry.unregister('object-kanban');
});

function Host({ tick, schema }: { tick: number; schema: any }) {
  return (
    <AdapterCtx.Provider value={adapter}>
      <span data-testid="tick">{tick}</span>
      <SchemaRenderer schema={schema} />
    </AdapterCtx.Provider>
  );
}

describe('kind:\'react\' page state', () => {
  it('survives a parent re-render', async () => {
    const { findByTestId, getByTestId, rerender } = render(<Host tick={0} schema={PLAIN_SCHEMA} />);
    fireEvent.click(await findByTestId('counter'));
    expect(getByTestId('counter').textContent).toBe('1');

    rerender(<Host tick={1} schema={PLAIN_SCHEMA} />);

    expect(getByTestId('tick').textContent).toBe('1');
    // '0' here means the page was remounted: something upstream handed
    // ReactRunner a new `code` or a new `scope` identity.
    expect(getByTestId('counter').textContent).toBe('1');
  });

  it('survives a lazy block finishing its load (objectui#2953 ∩ #2954)', async () => {
    // The page renders a block whose plugin chunk has not been imported yet.
    // Loading it calls register(), which notifies every registry subscriber.
    let landPlugin!: () => void;
    const loaded = new Promise<void>((resolve) => {
      landPlugin = resolve;
    });
    ComponentRegistry.registerLazy(
      'object-kanban',
      async () => {
        await loaded;
        ComponentRegistry.register('object-kanban', () => <div data-testid="kanban-double" />, {
          namespace: 'plugin-kanban',
        });
      },
      { namespace: 'plugin-kanban', category: 'view' },
    );

    const schema = { type: 'home', kind: 'react', name: 'lazy_page', source: counterSource('<ObjectKanban objectName="showcase_project" />') };
    const { findByTestId, getByTestId } = render(<Host tick={0} schema={schema} />);

    // State the user has already produced, while the block is still loading.
    fireEvent.click(await findByTestId('counter'));
    expect(getByTestId('counter').textContent).toBe('1');

    landPlugin();
    expect(await findByTestId('kanban-double')).toBeTruthy();

    // If ReactKindPage subscribed to the registry, this notify would rebuild
    // the scope, hand ReactRunner a new identity, and reset the page — every
    // interactive react page on screen, on any plugin's first use.
    await waitFor(() => expect(getByTestId('counter').textContent).toBe('1'));
  });

  it('does recompile when the page source itself changes', async () => {
    const { findByTestId, getByTestId, rerender } = render(<Host tick={0} schema={PLAIN_SCHEMA} />);
    fireEvent.click(await findByTestId('counter'));
    expect(getByTestId('counter').textContent).toBe('1');

    // The negative control: stability must not mean staleness. A genuinely
    // different page is a different page, state included.
    rerender(<Host tick={0} schema={{ ...PLAIN_SCHEMA, source: counterSource('<i data-testid="marker" />') }} />);

    expect(await findByTestId('marker')).toBeTruthy();
    expect(getByTestId('counter').textContent).toBe('0');
  });
});
