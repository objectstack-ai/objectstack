/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `stack` reads `gap`, and ONLY `gap` (objectui#4890).
 *
 * `StackSchema extends Omit<FlexSchema, 'type'>`, and `FlexSchema`'s spacing key
 * is `gap`. `spacing` was declared by nothing — not the TypeScript interface, not
 * the zod mirror, not the renderer's own `inputs` registration, which has always
 * listed `gap` alone. `stack.tsx` read it anyway:
 *
 *     const gap = schema.gap ?? (schema as any).spacing ?? 2;
 *
 * The `as any` is the whole story: it existed to get past the type system saying
 * the key was not there. A lenient consumer leg like that does not stay in the
 * consumer — it becomes a second de-facto contract that producers write to. 135
 * catalog nodes across 39 files did exactly that, and every one of them RENDERED
 * CORRECTLY, so nothing ever pointed at it. Those examples are the docs site's
 * reference material and an AI few-shot retrieval source, so the reach of the
 * alias was "every author who copied a stack".
 *
 * The trap it was one edit away from springing: `flex` — semantically a `stack`
 * with a `direction` — never read `spacing`. Re-typing any of those 135 nodes
 * would have dropped the spacing to the default with no error, no warning and no
 * visible cause. That is objectui#4001's failure mode, and #4001's own body
 * makes the point that the "happens to look right" variant is the worst kind.
 *
 * Fixed at the PRODUCER per AGENTS.md #0.1: the 135 nodes author `gap` and this
 * leg is deleted — NOT by adding `spacing` to `StackSchema`, which would promote
 * a pure alias to public contract and leave AI authors guessing between two
 * names for one thing.
 *
 * What this file pins is the state AFTER: an undeclared key has no effect, and
 * `stack` and `flex` now answer identically for it. The catalog-side ban (no node
 * may author `spacing` at all) lives with the sweep that removed them, in
 * `examples/schema-catalog/test/layout-props-conversion.test.tsx`.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

const classOf = (schema: unknown): string => {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  return (container.firstElementChild as HTMLElement).className;
};

/** `stack`'s default gap (2) as the mobile-first ladder renders it. */
const DEFAULT_STACK_GAP = 'gap-1.5 sm:gap-2';

describe('stack no longer reads the undeclared `spacing` key (#4890)', () => {
  it('a stack authoring `spacing` renders the DEFAULT gap, not the value', () => {
    // 6 was a real value in the catalog (`dashboard/dashboard-overview`), and it
    // is a step the ladder maps — so if the alias were still read this assertion
    // would see `gap-3 sm:gap-4 md:gap-6` and fail loudly rather than coincide
    // with the default.
    const withSpacing = classOf({ type: 'stack', spacing: 6, children: [] });
    const withNothing = classOf({ type: 'stack', children: [] });

    expect(withSpacing).toContain(DEFAULT_STACK_GAP);
    expect(withSpacing).not.toContain('md:gap-6');
    expect(
      withSpacing,
      'an undeclared key must be inert — identical to not writing it at all',
    ).toBe(withNothing);
  });

  it('`flex` answers the same way, which is the trap that is now closed', () => {
    // `flex.tsx` never read `spacing`. While `stack.tsx` did, re-typing a stack
    // to flex silently changed its spacing; the two renderers now agree.
    expect(classOf({ type: 'flex', spacing: 6, children: [] }))
      .toBe(classOf({ type: 'flex', children: [] }));
  });

  it('`gap` — the declared key — still drives the whole ladder', () => {
    expect(classOf({ type: 'stack', gap: 6, children: [] }))
      .toBe('flex flex-col justify-start items-stretch gap-3 sm:gap-4 md:gap-6');
    expect(classOf({ type: 'stack', gap: 3, children: [] }))
      .toBe('flex flex-col justify-start items-stretch gap-2 sm:gap-3');
  });

  it('`gap: 0` stays reachable — the read is `??`, never `||`', () => {
    // The sweep moved five catalog nodes carrying `spacing: 0`. `||` would fold
    // that legal value into the default; this is the same failure `flex.tsx`'s
    // gap and `container.tsx`'s padding/maxWidth were fixed for (#4003/#4889).
    expect(classOf({ type: 'stack', gap: 0, children: [] }))
      .toBe('flex flex-col justify-start items-stretch gap-0');
  });
});
