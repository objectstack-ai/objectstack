/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { cn } from '@object-ui/components';

/**
 * Breakpoint column map — grid column counts per Tailwind-style breakpoint,
 * owned by this package since objectui#7580 (maintainer ruling 2026-09-04,
 * option A).
 *
 * These were hand copies until objectui#4167, each carrying the word "mirrors"
 * — the doc-comment shape objectstack#4115 catalogues, where the claim is what
 * the next agent reads as canonical and the code is what actually decides. They
 * were then bound by reference to `@objectstack/spec/ui`, which was right for
 * as long as the spec published them.
 *
 * objectstack#11027 retired the whole `ui/responsive` vocabulary upstream, so
 * there is no longer anything to bind to — and, unlike the four types that left
 * with the key, this one has a renderer that implements it:
 * {@link resolveColumnClasses} applies it on `ResponsiveGrid`'s render path.
 * The tombstone's own return condition — the vocabulary "returns if and when a
 * renderer implements it" — is met here, which is why the type is re-homed
 * rather than deleted.
 *
 * The node that once made it authorable from JSON is gone. The
 * `responsive-grid` registration retired under objectui#11441 (the
 * maintainer's ruling `5950208338`, letter B), which kept this declaration and
 * named the `grid` node with a breakpoint `columns` object as the one
 * authorable spelling. `ResponsiveGrid` is now a React-only export, and this
 * map is the type of its `columns` prop.
 *
 * ⚠️ Members are the retired `BreakpointColumnMapSchema`'s, verbatim: six
 * optional column counts keyed `xs`…`2xl`. The schema was `$strict`, so no
 * index signature is restored here either — an unknown breakpoint key was a
 * parse error upstream and stays a type error here.
 *
 * `BreakpointOrderMap` RETIRED with the key (same ruling, item 3) and is NOT
 * re-homed. Its own comment in this file already recorded the reason: it had no
 * read point in this package — `ResponsiveGrid` resolves columns only — and it
 * was published solely because the spec's `ResponsiveConfigSchema` paired the
 * two, so an author configuring `order` needed the type. That pairing is what
 * objectstack#11027 deleted; with the schema gone there is no order vocabulary
 * left for it to be the type OF, and re-homing it would have re-declared a key
 * nothing reads on either side of the boundary — the declare-without-enforce
 * shape ADR-0049 removes.
 *
 * ⏳ Interim, and it self-expires: the pin is still `@objectstack/spec` 17.2.0,
 * which PRE-dates the retirement and still exports this name, so the collision
 * is real today and carries a reasoned entry in
 * `scripts/check-spec-symbol-derivation.mjs`. The guard's ratchet 3 fails an
 * ALLOW entry that excuses nothing, so the pin bump is forced to delete it.
 */
export interface BreakpointColumnMap {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
  '2xl'?: number;
}

export interface ResponsiveGridProps {
  /** Grid column map per breakpoint */
  columns?: BreakpointColumnMap;
  /** Gap between grid items */
  gap?: number | string;
  /** Additional class names */
  className?: string;
  /** Children */
  children: React.ReactNode;
}

/**
 * Tailwind class mapping for grid columns at each breakpoint.
 * Uses standard Tailwind grid-cols utilities for CSS-only responsiveness.
 */
const COLS_CLASSES: Record<string, Record<number, string>> = {
  xs: { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 6: 'grid-cols-6', 12: 'grid-cols-12' },
  sm: { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 6: 'sm:grid-cols-6', 12: 'sm:grid-cols-12' },
  md: { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 6: 'md:grid-cols-6', 12: 'md:grid-cols-12' },
  lg: { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 6: 'lg:grid-cols-6', 12: 'lg:grid-cols-12' },
  xl: { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 6: 'xl:grid-cols-6', 12: 'xl:grid-cols-12' },
  '2xl': { 1: '2xl:grid-cols-1', 2: '2xl:grid-cols-2', 3: '2xl:grid-cols-3', 4: '2xl:grid-cols-4', 6: '2xl:grid-cols-6', 12: '2xl:grid-cols-12' },
};

/**
 * Resolve a BreakpointColumnMap into Tailwind CSS grid classes.
 */
function resolveColumnClasses(columns?: BreakpointColumnMap): string {
  if (!columns) return 'grid-cols-1';

  const classes: string[] = [];
  for (const [bp, cols] of Object.entries(columns)) {
    const bpClasses = COLS_CLASSES[bp];
    if (bpClasses && cols) {
      // Use closest supported column count
      const supported = Object.keys(bpClasses).map(Number);
      const closest = supported.reduce((prev, curr) =>
        Math.abs(curr - cols) < Math.abs(prev - cols) ? curr : prev
      );
      classes.push(bpClasses[closest]);
    }
  }

  return classes.join(' ') || 'grid-cols-1';
}

const GAP_CLASSES: Record<number, string> = {
  0: 'gap-0', 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4',
  5: 'gap-5', 6: 'gap-6', 8: 'gap-8',
};

/**
 * ResponsiveGrid — A layout component that consumes this package's own
 * BreakpointColumnMap (the six keys xs, sm, md, lg, xl, '2xl') for
 * responsive grid layouts.
 *
 * Uses pure Tailwind CSS classes for responsive behavior (no JS resize listeners).
 *
 * @example
 * ```tsx
 * <ResponsiveGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap={4}>
 *   <Card>Item 1</Card>
 *   <Card>Item 2</Card>
 *   <Card>Item 3</Card>
 * </ResponsiveGrid>
 * ```
 */
export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  columns,
  gap = 4,
  className,
  children,
}) => {
  const colClasses = resolveColumnClasses(columns);
  const gapClass = typeof gap === 'number' ? (GAP_CLASSES[gap] || `gap-${gap}`) : '';

  return (
    <div className={cn('grid', colClasses, gapClass, className)}>
      {children}
    </div>
  );
};
