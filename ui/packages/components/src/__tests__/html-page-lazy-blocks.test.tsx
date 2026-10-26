/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A `kind:'html'` page can use lazily-registered blocks (objectui#2953, html tier).
 *
 * Same root cause as the react tier, worse blast radius. The whitelist a page's
 * source is compiled against was built from `getAllTypes()` + `getConfig()` —
 * both loaded-only — so a block registered via `registerLazy()` was rejected as
 * "not an allowed component". And because a compile diagnostic fails the WHOLE
 * page rather than the one node, `<object-kanban>` anywhere in the source
 * replaced the entire page with an error panel. Load-order dependent, so the
 * same page worked or didn't depending on what else had rendered first.
 *
 * It also never recovered: `layoutElement` was memoised on `[schema, pageType]`
 * with no registry signal, so the cached error panel outlived the plugin
 * actually landing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';

const adapter = { find: async () => [] } as any;

/** Registers a lazy `object-kanban` whose chunk lands only when you say so. */
function lazyKanban() {
  let land!: () => void;
  const gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  ComponentRegistry.registerLazy(
    'object-kanban',
    async () => {
      await gate;
      ComponentRegistry.register('object-kanban', () => <div data-testid="kanban-double" />, {
        namespace: 'plugin-kanban',
      });
    },
    { namespace: 'plugin-kanban', category: 'view' },
  );
  return land;
}

function renderHtmlPage(source: string) {
  return render(
    <AdapterCtx.Provider value={adapter}>
      <SchemaRenderer schema={{ type: 'home', kind: 'html', name: 'test_page', label: 'Test page', source }} />
    </AdapterCtx.Provider>,
  );
}

// Registers PageRenderer for `type:'home'`, which dispatches kind:'html'. At
// module scope, NOT inside a `beforeAll` — there the cold transform is billed to
// `hookTimeout`, which is why this carried a raised timeout. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

afterEach(() => {
  ComponentRegistry.unregister('object-kanban', 'plugin-kanban');
  ComponentRegistry.unregister('object-kanban');
});

describe('kind:\'html\' page with a lazily-registered block', () => {
  it('compiles instead of failing the whole page, and renders the block once loaded', async () => {
    const land = lazyKanban();

    const { container, findByTestId } = renderHtmlPage(
      `<flex><object-kanban object="showcase_project" /></flex>`,
    );

    // Before: 'HTML page failed to compile (2)' — `<object-kanban> is not an
    // allowed component` + `is not a known component` — and no <flex> either.
    expect(container.textContent).not.toContain('failed to compile');

    land();
    expect(await findByTestId('kanban-double')).toBeTruthy();
  });

  it('recovers a page that compiled before the block was registered', async () => {
    // Nothing knows `object-kanban` yet, so this page genuinely cannot compile.
    const { container } = renderHtmlPage(`<flex><object-kanban object="showcase_project" /></flex>`);
    expect(container.textContent).toContain('failed to compile');

    // The plugin registers late — a legitimate case (a plugin installed at
    // runtime, or any registration that races first paint).
    ComponentRegistry.register('object-kanban', () => <div data-testid="kanban-double" />, {
      namespace: 'plugin-kanban',
    });

    // Before: the memoised error panel outlived the registration, permanently.
    await waitFor(() => expect(container.querySelector('[data-testid=kanban-double]')).toBeTruthy());
    expect(container.textContent).not.toContain('failed to compile');
  });

  it('still rejects a tag nothing has registered at all', async () => {
    const { container } = renderHtmlPage(`<flex><totally-not-a-block /></flex>`);

    // The negative control. Admitting lazy stubs must not turn the whitelist
    // into "anything goes" — that whitelist is what keeps a parsed page from
    // rendering arbitrary tags.
    await waitFor(() => expect(container.textContent).toContain('failed to compile'));
    expect(container.textContent).toContain('totally-not-a-block');
  });
});
