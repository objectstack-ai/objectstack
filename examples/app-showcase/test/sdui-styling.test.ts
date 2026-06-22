// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  compileBlockStyles,
  compilePageStyles,
  BREAKPOINTS,
} from './sdui-styling/compile-block-styles.js';
import { pricingShowcase } from './sdui-styling/pricing-showcase.js';

/**
 * Verifies the SDUI styling model (ADR-0065) actually delivers the four
 * properties the decision rests on. In the "demonstrated AND verified" spirit
 * of the showcase: a model that merely *declares* a styling shape but compiles
 * to colliding / build-dependent / responsive-inverting CSS would slip past a
 * shape-only assertion — but not these.
 */
describe('SDUI styling model — scoped style-objects (ADR-0065)', () => {
  // (1) id-scoping: every rule targets `.{id}` — never a global/unscoped
  // selector. This is what makes two independently-built stylesheets unable to
  // collide, and removes the whole two-build cascade war.
  it('scopes every rule to the component id (no global selectors)', () => {
    const css = compileBlockStyles('plan_solo', {
      large: { padding: '24px' },
      small: { padding: '12px' },
    });
    expect(css).toContain('.plan_solo {');
    expect(css).toContain('@media (max-width: 640px) { .plan_solo {');
    // No bare/global declaration leaks outside an id scope.
    expect(css).not.toMatch(/(^|\n)\s*padding:/); // padding only ever inside `.plan_solo { … }`

    // Two different blocks → disjoint selectors → cannot collide.
    const a = compileBlockStyles('block_a', { large: { color: 'red' } });
    const b = compileBlockStyles('block_b', { large: { color: 'blue' } });
    expect(a).toContain('.block_a {');
    expect(b).toContain('.block_b {');
    expect(a).not.toContain('block_b');
  });

  // (2) responsive = generated @media owned by the model (desktop-first,
  // max-width), NOT author-written `md:` classes. Deletes the
  // layer-vs-media-query inversion class.
  it('emits proper @media rules for breakpoints (no variant classes)', () => {
    const css = compileBlockStyles('plan_solo', {
      large: { padding: '24px' },
      medium: { padding: '20px' },
      small: { padding: '12px' },
      xsmall: { padding: '8px' },
    });
    expect(css).toContain(`@media (max-width: ${BREAKPOINTS.medium}px)`);
    expect(css).toContain(`@media (max-width: ${BREAKPOINTS.small}px)`);
    expect(css).toContain(`@media (max-width: ${BREAKPOINTS.xsmall}px)`);
    // The base (`large`) is unconditional — not wrapped in a media query.
    expect(css.split('\n')[0]).toBe('.plan_solo { padding: 24px; }');
    // Author never writes a breakpoint variant class.
    expect(css).not.toContain('md:');
    expect(css).not.toContain('sm:');
  });

  // (3) build-independence: arbitrary values pass through verbatim. This is the
  // property arbitrary Tailwind classes CANNOT guarantee (JIT scans source at
  // build; metadata is never scanned).
  it('passes arbitrary values through verbatim (zero build step)', () => {
    const css = compileBlockStyles('odd', {
      large: { fontSize: '13px', color: '#1a2b3c', gridTemplateColumns: 'repeat(3, 1fr)' },
    });
    expect(css).toContain('font-size: 13px;');
    expect(css).toContain('color: #1a2b3c;');
    // camelCase → kebab-case, value untouched.
    expect(css).toContain('grid-template-columns: repeat(3, 1fr);');
  });

  // (4) token resolution: values may be design tokens → consistency + an
  // enumerable, AI-safe surface. Tokens pass through as `var(--…)`.
  it('passes design-token values through as CSS variables', () => {
    const css = compilePageStyles(pricingShowcase);
    expect(css).toContain('.plan_solo {');
    expect(css).toContain('padding: var(--space-6);');
    expect(css).toContain('border-radius: var(--radius-lg);');
    // Showcase responsive shrink applied via the model, scoped.
    expect(css).toContain('@media (max-width: 640px) { .plan_solo {');
    expect(css).toContain('.plan_price {');
    expect(css).toContain('font-size: 44px;'); // arbitrary value alongside tokens
  });

  // Guard mirrors Builder.io: no id → no CSS (never an unscoped global rule).
  it('emits nothing for a block with no id', () => {
    expect(compileBlockStyles('', { large: { padding: '24px' } })).toBe('');
  });
});
