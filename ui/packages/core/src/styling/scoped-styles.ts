/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Scoped style-object → CSS compiler (framework ADR-0065).
 *
 * The SDUI styling primitive: a metadata node carries a `responsiveStyles`
 * object (per-breakpoint CSS-property maps); at render time it compiles to
 * **id-scoped CSS** injected as a `<style>` tag. This is build-independent
 * (arbitrary values + design tokens pass through verbatim — no Tailwind JIT
 * needed), collision-free (scoped to one node's class — two independently-built
 * stylesheets cannot fight), and responsive-correct (model breakpoint maps →
 * generated `@media`, never author-written `md:` variant classes).
 *
 * Mirrors Builder.io's SDK (`createCssClass` / `responsiveStyles`). Desktop-first:
 * `large` is the unconditional base; `medium`/`small`/`xsmall` are `max-width`
 * overrides.
 */

import type { StyleMap, ResponsiveStyles } from '@objectstack/spec/ui';

/**
 * `StyleMap` / `ResponsiveStyles` are **owned by the spec** (ADR-0065,
 * `@objectstack/spec/ui`) and re-exported here, not re-declared.
 *
 * They used to be hand-written copies under the spec's own names. Both were
 * member-for-member identical to the spec's at the time of the burn-down
 * (objectstack#4115), which is exactly what makes a copy dangerous: it passes
 * every structural comparison right up until the spec adds a breakpoint or
 * widens a value type, and the doc comment above claims spec canonicity the
 * whole time. Binding the names to the spec at compile time is the only form
 * that cannot drift.
 */
export type { StyleMap, ResponsiveStyles } from '@objectstack/spec/ui';

/** max-width breakpoints (px), mirroring Builder.io's default device sizes. */
export const STYLE_BREAKPOINTS: Record<'medium' | 'small' | 'xsmall', number> = {
  medium: 991,
  small: 640,
  xsmall: 479,
};

const camelToKebab = (k: string): string =>
  k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** Style-map → `prop: value;` declarations. Values pass through **verbatim** —
 * that is the whole point: arbitrary values (`13px`, `#1a2b3c`) and design
 * tokens (`var(--space-6)`) work with zero build step.
 *
 * `!important` on every declaration is deliberate: this scoped rule and a
 * component's own base utility class (e.g. `flex`/`grid` from the layout
 * renderer) both land on the same element with equal (single-class)
 * specificity, so without it the winner depends on stylesheet injection
 * order — which flips between dev (HMR-injected Tailwind CSS) and prod
 * (head `<link>` precedes body). An explicit per-node style is always the
 * more specific author intent and must win deterministically. */
const declarations = (m: StyleMap): string =>
  Object.entries(m)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${camelToKebab(k)}: ${typeof v === 'number' ? String(v) : v} !important;`)
    .join(' ');

/** True when a node actually carries responsive styles worth compiling. */
export function hasResponsiveStyles(rs: unknown): rs is ResponsiveStyles {
  if (!rs || typeof rs !== 'object') return false;
  const r = rs as ResponsiveStyles;
  return Boolean(r.large || r.medium || r.small || r.xsmall);
}

/** Deterministic, CSS-safe scope class for a node id. */
export function scopeClassFor(id: string): string {
  return `os-s-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/**
 * Compile a node's responsive styles to CSS scoped to `selector`.
 * Returns '' when there is nothing to emit. No unscoped/global rule is ever
 * produced — that scoping is what makes per-node styles collision-free.
 */
export function compileScopedStyles(selector: string, rs: ResponsiveStyles): string {
  const rules: string[] = [];
  if (rs.large) {
    const base = declarations(rs.large);
    if (base) rules.push(`${selector} { ${base} }`);
  }
  for (const size of ['medium', 'small', 'xsmall'] as const) {
    const s = rs[size];
    if (!s) continue;
    const d = declarations(s);
    if (d) rules.push(`@media (max-width: ${STYLE_BREAKPOINTS[size]}px) { ${selector} { ${d} } }`);
  }
  return rules.join('\n');
}
