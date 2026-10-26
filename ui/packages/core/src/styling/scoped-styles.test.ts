/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  compileScopedStyles,
  scopeClassFor,
  hasResponsiveStyles,
  STYLE_BREAKPOINTS,
} from './scoped-styles.js';

describe('scoped-styles compiler (ADR-0065)', () => {
  it('scopes every rule to the selector — never a global rule', () => {
    const css = compileScopedStyles('.os-s-card', {
      large: { padding: '24px', display: 'flex' },
      small: { padding: '12px' },
    });
    expect(css).toContain('.os-s-card { padding: 24px !important; display: flex !important; }');
    expect(css).toContain('@media (max-width: 640px) { .os-s-card { padding: 12px !important; } }');
    // No declaration ever sits outside a `.selector { … }` block.
    expect(css).not.toMatch(/(^|\n)\s*padding:/);
  });

  it('generates @media for each breakpoint; base is unconditional', () => {
    const css = compileScopedStyles('.x', {
      large: { gap: '16px' },
      medium: { gap: '12px' },
      small: { gap: '8px' },
      xsmall: { gap: '4px' },
    });
    expect(css.split('\n')[0]).toBe('.x { gap: 16px !important; }');
    expect(css).toContain(`@media (max-width: ${STYLE_BREAKPOINTS.medium}px)`);
    expect(css).toContain(`@media (max-width: ${STYLE_BREAKPOINTS.small}px)`);
    expect(css).toContain(`@media (max-width: ${STYLE_BREAKPOINTS.xsmall}px)`);
    expect(css).not.toContain('md:'); // never a variant class
  });

  it('passes arbitrary values + design tokens through verbatim (build-independent)', () => {
    const css = compileScopedStyles('.y', {
      large: {
        fontSize: '44px',
        color: '#1a2b3c',
        padding: 'var(--space-6)',
        gridTemplateColumns: 'repeat(3, 1fr)',
      },
    });
    expect(css).toContain('font-size: 44px !important;');
    expect(css).toContain('color: #1a2b3c !important;');
    expect(css).toContain('padding: var(--space-6) !important;');
    expect(css).toContain('grid-template-columns: repeat(3, 1fr) !important;'); // camel→kebab, value intact
  });

  it('emits nothing for empty / absent styles', () => {
    expect(compileScopedStyles('.z', {})).toBe('');
    expect(compileScopedStyles('.z', { large: {} })).toBe('');
  });

  it('scopeClassFor sanitizes ids to CSS-safe class names', () => {
    expect(scopeClassFor('plan_solo')).toBe('os-s-plan_solo');
    expect(scopeClassFor(':r0:')).toBe('os-s--r0-'); // React useId() shape
    expect(scopeClassFor('a.b c')).toBe('os-s-a-b-c');
  });

  it('emits `!important` so a scoped display always beats a same-specificity utility class (regression: flex/grid layout conflict)', () => {
    // A `type: 'flex'` node also carrying `responsiveStyles: { display: 'grid', ... }`
    // lands `.flex` (from the Flex renderer) and `.os-s-<id>` (this compiler's
    // output) on the same element — both single-class selectors, equal
    // specificity. Without `!important` the winner depends on stylesheet
    // injection order (flips between dev HMR and prod builds); with it, the
    // scoped per-node override always wins deterministically.
    const css = compileScopedStyles('.os-s-x', { large: { display: 'grid' } });
    expect(css).toBe('.os-s-x { display: grid !important; }');
  });

  it('hasResponsiveStyles detects real style payloads', () => {
    expect(hasResponsiveStyles({ large: { padding: '1px' } })).toBe(true);
    expect(hasResponsiveStyles({ small: { gap: '1px' } })).toBe(true);
    expect(hasResponsiveStyles(undefined)).toBe(false);
    expect(hasResponsiveStyles({})).toBe(false);
    expect(hasResponsiveStyles('nope')).toBe(false);
  });
});
