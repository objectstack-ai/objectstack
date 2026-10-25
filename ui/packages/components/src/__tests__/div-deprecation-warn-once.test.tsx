/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins the once-semantics of the `div` deprecation notice (objectui#3965).
 *
 * `DivRenderer` used to `console.warn` on EVERY render. That is harmless on a
 * page with one `div`, and destructive on a page with many: the docs
 * schema-catalog index renders 400+ example thumbnails and emitted ~190
 * identical notices, which buried the page's real console errors underneath —
 * it twice cost a browser-verification run the signal it was looking for
 * (#3903 / PR #3964 had to fish two nested-button errors out of the flood).
 *
 * What is pinned here is the DEDUPLICATION, not the removal of the warning:
 * the deprecation still fires in dev builds, exactly once per module load.
 *
 * NOTE ON ORDER — the guard is a module-level Set, so it latches for the
 * lifetime of this module instance. The production-silence case must therefore
 * run BEFORE the dev case, and it doubles as a pin on the guard's ordering:
 * the production early-return happens before the Set is marked, so a
 * production render must not swallow a later dev notice.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const DEPRECATION_RE = /The "div" component is deprecated/;

function renderDiv(schema: Record<string, unknown>) {
  const Component = ComponentRegistry.get('div');
  if (!Component) throw new Error('Component "div" is not registered');
  return render(<Component schema={schema} />);
}

function deprecationCalls(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  // `ReturnType<typeof vi.spyOn>` erases the spied signature, so `mock.calls`
  // arrives as `any` and this parameter had no type to infer. `unknown[]` is
  // the row type this function already DECLARES it returns (objectui#4353).
  return spy.mock.calls.filter((args: unknown[]) => DEPRECATION_RE.test(String(args[0])));
}

describe('div deprecation notice — once per module load (#3965)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // MUST run first: see the note above. A production render may not mark the
  // warn-once Set, otherwise it would suppress the dev notice that follows.
  it('stays silent in production builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');

    renderDiv({ type: 'div', className: 'p-4', children: [{ type: 'text', content: 'a' }] });

    expect(deprecationCalls(warn)).toHaveLength(0);
  });

  it('warns exactly once however many div nodes render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Three separate renders, and one of them nests three more `div` nodes:
    // seven DivRenderer invocations in total, one notice expected.
    renderDiv({ type: 'div', className: 'a' });
    renderDiv({ type: 'div', className: 'b' });
    renderDiv({
      type: 'div',
      className: 'outer',
      children: [
        {
          type: 'div',
          className: 'middle',
          children: [
            { type: 'div', className: 'inner-1' },
            { type: 'div', className: 'inner-2' },
          ],
        },
      ],
    });

    const calls = deprecationCalls(warn);
    expect(calls).toHaveLength(1);
    // The deprecation is still being reported, with its migration guidance
    // intact. The guidance text itself was re-ruled in objectui#6877 (it now
    // names `box`, the one drop-in swap, and states the `body`→`children`
    // hazard); the ONCE-semantics this file pins are unaffected by that.
    expect(String(calls[0][0])).toContain('the drop-in swap is "box"');
    expect(String(calls[0][0])).toContain('"card", "flex", "container", "stack", or "grid"');
  });

  it('does not warn again on a later render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderDiv({ type: 'div', className: 'later' });

    expect(deprecationCalls(warn)).toHaveLength(0);
  });
});
