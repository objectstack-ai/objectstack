/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `gap: 0` and `padding: 0` are declared, legal, and must reach the DOM
 * (objectui#4003).
 *
 * `FlexSchema.gap` and `ContainerSchema.padding` are declared `number`, and both
 * renderers carry an explicit branch for the zero case — `gap === 0 && 'gap-0'`
 * in `layout/flex.tsx`, `padding === 0 && 'p-0'` in `layout/container.tsx`. Both
 * branches were unreachable: the value was read with `||`, so a declared `0` was
 * folded into the default (`2` / `4`) before the branch was ever tested. A node
 * asking for no gap rendered `gap-1.5 sm:gap-2`; a container asking for no
 * padding rendered `p-2 sm:p-3 md:p-4`.
 *
 * This is the #4001 failure mode one layer down: a declared key whose value the
 * engine silently discards, so the JSON says one thing and the DOM does another.
 * `stack.tsx` and `grid.tsx` already read their scales with `??`; the fix
 * converged `flex` and `container` onto the same spelling rather than inventing
 * one.
 *
 * Zero pre-existing node in the repository declared either key as `0` (measured
 * across every JSON under `packages/`, `apps/`, `examples/` at the base commit),
 * so nothing that renders today changes — the fix only makes the declared zero
 * reachable for the catalog examples that now need it.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

function classOf(schema: unknown): string {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  return (container.firstElementChild as HTMLElement).className;
}

describe('flex honours a declared gap of 0 (#4003)', () => {
  it('renders gap-0, not the default ladder', () => {
    expect(classOf({ type: 'flex', gap: 0, children: [] })).toBe(
      'flex flex-row justify-start items-start gap-0',
    );
  });

  it('still defaults to 2 when gap is omitted', () => {
    // The zero fix must not turn "unspecified" into "zero" — that would be the
    // mirror-image bug, and it is the reason `??` is correct where `||` was not.
    expect(classOf({ type: 'flex', children: [] })).toBe(
      'flex flex-row justify-start items-start gap-1.5 sm:gap-2',
    );
  });

  it('leaves every non-zero gap on the mobile-first ladder', () => {
    expect(classOf({ type: 'flex', gap: 3, children: [] })).toBe(
      'flex flex-row justify-start items-start gap-2 sm:gap-3',
    );
  });
});

describe('container honours a declared padding of 0 (#4003)', () => {
  it('renders p-0, not the default ladder', () => {
    expect(classOf({ type: 'container', maxWidth: '6xl', padding: 0, children: [] })).toBe(
      'w-full max-w-6xl mx-auto p-0',
    );
  });

  it('still defaults to 4 when padding is omitted', () => {
    expect(classOf({ type: 'container', maxWidth: '6xl', children: [] })).toBe(
      'w-full max-w-6xl mx-auto p-2 sm:p-3 md:p-4',
    );
  });

  it('leaves every non-zero padding on the mobile-first ladder', () => {
    expect(classOf({ type: 'container', maxWidth: '6xl', padding: 6, children: [] })).toBe(
      'w-full max-w-6xl mx-auto p-3 sm:p-4 md:p-6',
    );
  });
});
