// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { validatePageSourceStyling, PAGE_SOURCE_CLASSNAME } from './validate-page-source-styling.js';

const page = (kind: string, source: string) => ({ pages: [{ name: 'p', kind, source }] });

describe('validatePageSourceStyling (ADR-0065 guardrail)', () => {
  it('flags Tailwind className in a react source page', () => {
    const f = validatePageSourceStyling(page('react', 'function Page(){ return <div className="grid grid-cols-5 p-8" />; }'));
    expect(f.length).toBe(1);
    expect(f[0].rule).toBe(PAGE_SOURCE_CLASSNAME);
    expect(f[0].severity).toBe('warning');
    expect(f[0].hint).toMatch(/hsl\(var\(--/);
  });

  it('flags className in an html source page (with the html-specific hint)', () => {
    const f = validatePageSourceStyling(page('html', '<flex className="gap-4"><text content="hi" /></flex>'));
    expect(f.length).toBe(1);
    expect(f[0].hint).toMatch(/structured props/);
  });

  it('passes a react page styled with inline style + hsl tokens', () => {
    const f = validatePageSourceStyling(page('react', "function Page(){ return <div style={{ color: 'hsl(var(--foreground))' }} />; }"));
    expect(f).toEqual([]);
  });

  it('passes an html page that uses structured props + a style object', () => {
    const f = validatePageSourceStyling(page('html', '<flex direction="col" gap={4} style={{"padding":"16px"}} />'));
    expect(f).toEqual([]);
  });

  it('ignores structured (full/slotted) pages without source', () => {
    expect(validatePageSourceStyling({ pages: [{ name: 'p', kind: 'full', regions: [] }] })).toEqual([]);
  });

  it('also covers the deprecated jsx alias', () => {
    const f = validatePageSourceStyling(page('jsx', '<flex className="p-4" />'));
    expect(f.length).toBe(1);
  });
});
