/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins the once-semantics of the `span` deprecation notice (objectui#4917).
 *
 * `SpanRenderer` used to `console.warn` on EVERY render. That is harmless on a
 * page with one inline node, and destructive on a page with many: the notice
 * buries the page's real console errors underneath, which is what cost two
 * browser-verification runs the signal they were looking for when `div` had the
 * same defect (objectui#3965, fixed by PR #3998 — that PR named `span` as the
 * follow-up and left the shape here untouched).
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

const DEPRECATION_RE = /The "span" component is deprecated/;

function renderSpan(schema: Record<string, unknown>) {
  const Component = ComponentRegistry.get('span');
  if (!Component) throw new Error('Component "span" is not registered');
  return render(<Component schema={schema} />);
}

function deprecationCalls(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  // `ReturnType<typeof vi.spyOn>` erases the spied signature, so `mock.calls`
  // arrives as `any` and this parameter had no type to infer. `unknown[]` is
  // the row type this function already DECLARES it returns (objectui#4353).
  return spy.mock.calls.filter((args: unknown[]) => DEPRECATION_RE.test(String(args[0])));
}

describe('span deprecation notice — once per module load (#4917)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // MUST run first: see the note above. A production render may not mark the
  // warn-once Set, otherwise it would suppress the dev notice that follows.
  it('stays silent in production builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');

    renderSpan({ type: 'span', className: 'px-1', children: [{ type: 'text', content: 'a' }] });

    expect(deprecationCalls(warn)).toHaveLength(0);
  });

  it('warns exactly once however many span nodes render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Three separate renders, and one of them nests three more `span` nodes:
    // seven SpanRenderer invocations in total, one notice expected.
    //
    // The nesting spells the canonical child key (objectui#5027). It used to
    // spell `body`, the one key nothing produces and, since that fix, the one
    // key this renderer does not read — so the nested nodes would never have
    // mounted and the count below would have been three invocations dressed up
    // as seven, passing for the wrong reason.
    renderSpan({ type: 'span', className: 'a' });
    renderSpan({ type: 'span', className: 'b' });
    const nested = renderSpan({
      type: 'span',
      className: 'outer',
      children: [
        {
          type: 'span',
          className: 'middle',
          children: [
            { type: 'span', className: 'inner-1' },
            { type: 'span', className: 'inner-2' },
          ],
        },
      ],
    });
    // The seven invocations are a claim about what mounted, so read it back
    // instead of trusting the schema's shape.
    expect(nested.container.querySelectorAll('span')).toHaveLength(4);

    const calls = deprecationCalls(warn);
    expect(calls).toHaveLength(1);
    // The notice itself is unchanged — the deprecation is still being reported,
    // with its migration guidance intact.
    expect(String(calls[0][0])).toContain('use "badge" component');
    expect(String(calls[0][0])).toContain('use "text" component with appropriate className');
  });

  it('does not warn again on a later render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderSpan({ type: 'span', className: 'later' });

    expect(deprecationCalls(warn)).toHaveLength(0);
  });
});
