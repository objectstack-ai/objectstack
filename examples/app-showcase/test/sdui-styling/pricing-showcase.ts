// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ResponsiveStyles } from './compile-block-styles.js';

/**
 * Showcase: the SDUI styling-model authoring shape (ADR-0065).
 *
 * A pricing card styled the *new* way — a per-component `responsiveStyles`
 * object whose values are **design tokens** (`var(--space-*)`, `var(--radius-*)`,
 * `var(--color-*)`), with responsiveness expressed as breakpoint maps rather
 * than `md:` utility classes. Compare to the cloud Pricing page that motivated
 * the ADR, which leaned on arbitrary Tailwind class strings.
 *
 * This is intentionally a plain data literal: the point of the model is that
 * styling is **data**, not a class-string DSL — which is what makes it
 * build-independent, collision-free, and safe for an AI to author.
 */
export interface ShowcaseBlock {
  id: string;
  type: string;
  responsiveStyles?: ResponsiveStyles;
}

export const pricingShowcase: ShowcaseBlock[] = [
  {
    id: 'plan_solo',
    type: 'page:card',
    responsiveStyles: {
      // Token-constrained values → consistency + an enumerable surface for AI.
      large: {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        padding: 'var(--space-6)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--color-surface)',
        boxShadow: 'var(--shadow-md)',
      },
      // Responsive owned by the model: tighter on small screens. No `md:` class.
      small: {
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
      },
    },
  },
  {
    id: 'plan_price',
    type: 'element:text',
    responsiveStyles: {
      large: {
        // Arbitrary value — build-independent: works with zero Tailwind compile.
        fontSize: '44px',
        fontWeight: '700',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--color-text-strong)',
      },
      small: { fontSize: '32px' },
    },
  },
];
