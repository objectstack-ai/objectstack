/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { BoxSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { forwardRef } from 'react';

/**
 * `box` — the neutral block container (objectui#3965).
 *
 * Minted by the 2026-08-29 maintainer ruling (方案 A) because the vocabulary
 * had no class-transparent block box, which is why the deprecated `div` could
 * never retire from the JSON surface: every replacement the deprecation notice
 * names injects layout of its own (`container` adds width/centering/padding,
 * `flex`/`stack` add a display mode and gaps, `grid` adds `grid-cols-*`,
 * `card` adds border/shadow AND wraps children in a `CardContent` element —
 * all measured through the real `SchemaRenderer`, recorded in
 * `examples/schema-catalog/test/deprecated-component-types.test.ts`).
 *
 * The contract, all three clauses from the ruling, pinned in
 * `../__tests__/box-neutral-container.test.tsx`:
 *
 *   1. renders `children`;
 *   2. the authored `className` passes through VERBATIM;
 *   3. zero injected classes — no `cn()` merge, no default class, nothing.
 *
 * This renderer reads `children` ONLY, and since objectui#6771 retired the
 * `body` dialect every renderer outside the `page:*` namespace does too. The
 * exceptions are FOUR, all in `layout/containers.tsx` — `page:card` and the
 * three thin `page:section` / `page:footer` / `page:sidebar` containers — and
 * all four are back-compat reads for STORED documents, which `@objectstack/spec`
 * says in as many words on `PageContainerProps`. So `box` is no longer the
 * exception it was written as, and the surviving reads are not an authoring
 * face at all (escalation: objectui#9916). The hazard it was minted against was `div`'s
 * `children || body` fallback, which made a mechanical `div`→X swap unsafe
 * (four catalog fixtures authored `body` and would have lost their content
 * silently, with an unchanged element count). That fallback is retired; the
 * one spelling is now the protocol's, not just this renderer's.
 */
// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const BoxRenderer = forwardRef<HTMLDivElement, { schema: BoxSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: BoxSchema; className?: string; [key: string]: any }, ref) => {
    // DOM pass-through is a WHITELIST, never a list of keys to strip — the
    // objectui#3291 discipline, executed by {@link toDomProps} as on the
    // sibling `grid.tsx` / `flex.tsx` (objectui#4787 / #5574). `style` is
    // forwarded BY NAME (the objectui#4435 route): it is the designer's sizing
    // channel and deliberately not part of the shared element-agnostic set.
    // `data-obj-id` / `data-obj-type` arrive through the open `data-*` family
    // the whitelist already forwards.
    const { style, ...hostProps } = props;

    return (
      <div ref={ref} {...toDomProps(hostProps)} className={className} style={style}>
        {renderChildren(schema.children)}
      </div>
    );
  }
);
BoxRenderer.displayName = 'BoxRenderer';

ComponentRegistry.register('box', BoxRenderer, {
  namespace: 'ui',
  label: 'Box',
  category: 'layout',
  // LAYOUT containment (objectui#6804 / objectui#9910 Q2): the react-page JSX
  // scope skips this tag and the public layout ledger lists it. It no longer
  // answers "does this node accept a child list?" — the `children` slot input
  // below does, and it is the only thing `validateTree`'s `not-a-container`
  // reads (objectui#9910 Q1). `children` is a BASE property of every node, so
  // declaring the slot widens no spec surface.
  isContainer: true,
  inputs: [
    { name: 'className', type: 'string' },
    { name: 'children', type: 'slot' }
  ],
});
