// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { validatePageSourceStyling, PAGE_SOURCE_CLASSNAME } from './validate-page-source-styling.js';
import { explainRule } from './rule-explanations.js';

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

  it('does not read the retired jsx kind — the page parse refuses that kind first', () => {
    const f = validatePageSourceStyling(page('jsx', '<flex className="p-4" />'));
    expect(f).toEqual([]);
  });
});

// [#22161] Slice 16: the `fix:` line names the replacement for `className` in
// one line per kind; why authored Tailwind produces no CSS, the theme tokens and
// the overlay advice are `os explain page-source-className-tailwind`, an entry
// this slice adds.
describe('[#22161] one-line fix — page-source-className-tailwind', () => {
  const NAME = 'regional_enterprise_account_overview_dashboard_page';
  const fire = (kind: string, source: string) =>
    validatePageSourceStyling({ pages: [{ name: NAME, kind, source }] });

  it('each kind reads as one remedy line of at most 200 characters', () => {
    const [react] = fire('react', 'function Page(){ return <div className="grid" />; }');
    const [html] = fire('html', '<flex className="gap-4" />');
    expect(react!.hint).toBe(
      "Replace className with inline style={{}} using hsl(var(--token)) theme colors, e.g. style={{ color: 'hsl(var(--foreground))' }}",
    );
    expect(html!.hint).toBe(
      "Replace className with the components' structured props (<flex direction gap>, <grid columns>) and a JSON " +
        'style object, e.g. style={{"color":"hsl(var(--foreground))"}}',
    );
    for (const f of [react!, html!]) {
      expect(f.hint).not.toContain('\n');
      expect(f.hint.length, f.hint).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the `fix:` lines no longer say', () => {
    const entry = explainRule(PAGE_SOURCE_CLASSNAME);
    expect(entry, 'no `os explain page-source-className-tailwind` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      'never an authored page string',
      'ADR-0065',
      "`background: 'hsl(var(--card))'`",
      '`formType="drawer"`',
      'hand-rolled overlay',
      'JSON style object',
    ]) {
      expect(text, fact).toContain(fact);
    }
  });
});
