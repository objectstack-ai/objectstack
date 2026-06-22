// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateResponsiveStyles,
  STYLE_NODE_MISSING_ID,
  STYLE_CLASSNAME_TAILWIND,
  STYLE_RESPONSIVE_NO_BASE,
  STYLE_UNKNOWN_CSS_PROPERTY,
  STYLE_UNKNOWN_TOKEN,
} from './validate-responsive-styles.js';

/** Wrap component nodes into a minimal stack with one page. */
const stackWith = (...components: any[]) => ({
  pages: [{ name: 'pricing', regions: [{ name: 'main', components }] }],
});

const rules = (findings: ReturnType<typeof validateResponsiveStyles>) => findings.map((f) => f.rule);

describe('validateResponsiveStyles (ADR-0065)', () => {
  it('passes a clean page styled with responsiveStyles + tokens', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'card', type: 'flex',
      responsiveStyles: {
        large: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-6)', backgroundColor: 'var(--surface)', border: '1px solid hsl(var(--primary))' },
        small: { padding: 'var(--space-4)' },
      },
      properties: {
        children: [
          { id: 'price', type: 'element:text', responsiveStyles: { large: { fontSize: '40px', color: 'var(--text-strong)' } }, properties: { content: '$29' } },
        ],
      },
    }));
    expect(findings).toEqual([]);
  });

  it('errors when a styled node has no id (CSS cannot be scoped)', () => {
    const findings = validateResponsiveStyles(stackWith({
      type: 'flex', responsiveStyles: { large: { padding: 'var(--space-4)' } },
    }));
    expect(rules(findings)).toContain(STYLE_NODE_MISSING_ID);
    expect(findings[0].severity).toBe('error');
  });

  it('warns when a smaller breakpoint has no large base', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'x', type: 'flex', responsiveStyles: { small: { padding: 'var(--space-2)' } },
    }));
    expect(rules(findings)).toContain(STYLE_RESPONSIVE_NO_BASE);
  });

  it('warns on Tailwind-looking className (silently dead in metadata)', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'x', type: 'flex', className: 'flex flex-col gap-4 md:grid-cols-2 bg-primary',
    }));
    expect(rules(findings)).toContain(STYLE_CLASSNAME_TAILWIND);
  });

  it('warns on an unknown CSS property (typo)', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'x', type: 'flex', responsiveStyles: { large: { flexDirektion: 'column' } },
    }));
    expect(rules(findings)).toContain(STYLE_UNKNOWN_CSS_PROPERTY);
  });

  it('warns on an unknown design token (typo)', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'x', type: 'flex', responsiveStyles: { large: { padding: 'var(--spcae-6)' } },
    }));
    expect(rules(findings)).toContain(STYLE_UNKNOWN_TOKEN);
  });

  it('resolves known tokens (incl. hsl(var(--primary))) without complaint', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'x', type: 'flex',
      responsiveStyles: { large: { color: 'hsl(var(--primary))', boxShadow: '0 0 0 3px hsl(var(--primary) / 0.25), var(--shadow-lg)', borderRadius: 'var(--radius-xl)' } },
    }));
    expect(findings).toEqual([]);
  });

  it('recurses into nested properties.children', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'root', type: 'flex', responsiveStyles: { large: { display: 'flex' } },
      properties: { children: [
        { type: 'flex', responsiveStyles: { large: { gap: 'var(--space-2)' } } }, // missing id, nested
      ] },
    }));
    expect(rules(findings)).toContain(STYLE_NODE_MISSING_ID);
  });

  it('does not flag a plain non-Tailwind className', () => {
    const findings = validateResponsiveStyles(stackWith({
      id: 'x', type: 'flex', className: 'my-custom-scope', responsiveStyles: { large: { display: 'flex' } },
    }));
    expect(rules(findings)).not.toContain(STYLE_CLASSNAME_TAILWIND);
  });
});
