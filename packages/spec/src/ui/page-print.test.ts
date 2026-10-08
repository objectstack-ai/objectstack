// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The print page (#22158, card ① of the ruling of record on #8346, letter B′):
 * the `print` declaration on `PageSchema`, the parse-time composition check,
 * and the printable block subset's classification of the component vocabulary.
 *
 * The block subset itself is ENFORCED by `@objectstack/lint`'s
 * `validatePrintPageBlocks` and pinned there per refused type; what is pinned
 * here is the contract both ends read — that the subset and the refusal
 * reasons classify every type the vocabulary declares, exactly once, so a type
 * added to the vocabulary tomorrow cannot reach a print page unclassified.
 */

import { describe, expect, it } from 'vitest';

import {
  PageSchema,
  PagePrintSchema,
  PRINTABLE_PAGE_COMPONENT_TYPES,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from './page.zod';
import { KNOWN_COMPONENT_TYPES } from './component-type-vocabulary';

const BASE = { name: 'invoice_print', label: 'Invoice', type: 'record', object: 'invoice' } as const;
const REGIONS = [
  { name: 'header', components: [{ type: 'element:text', properties: { content: 'ACME Ltd.' } }] },
  { name: 'main', components: [{ type: 'record:details' }] },
  { name: 'footer', components: [{ type: 'element:text', properties: { content: 'Thank you.' } }] },
];

function issuesOf(value: unknown): Array<{ path: string; message: string; code: string }> {
  const result = PageSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

describe('the `print` declaration', () => {
  it('accepts a print page carrying every declared key', () => {
    const parsed = PageSchema.parse({
      ...BASE,
      regions: REGIONS,
      print: {
        paperSize: 'A4',
        orientation: 'landscape',
        margins: { top: 15, right: 12, bottom: 15, left: 12 },
        repeatHeader: true,
        repeatFooter: true,
        pageNumbers: true,
        repeatTableHeaders: true,
        avoidBreakInside: true,
      },
    });
    expect(parsed.print).toEqual({
      paperSize: 'A4',
      orientation: 'landscape',
      margins: { top: 15, right: 12, bottom: 15, left: 12 },
      repeatHeader: true,
      repeatFooter: true,
      pageNumbers: true,
      repeatTableHeaders: true,
      avoidBreakInside: true,
    });
  });

  it('accepts an empty declaration — every key is optional, and none materializes a default', () => {
    expect(PageSchema.parse({ ...BASE, regions: REGIONS, print: {} }).print).toEqual({});
  });

  it('declares exactly the keys the ruling names, and no more', () => {
    expect(Object.keys(PagePrintSchema.shape).sort()).toEqual([
      'avoidBreakInside',
      'margins',
      'orientation',
      'pageNumbers',
      'paperSize',
      'repeatFooter',
      'repeatHeader',
      'repeatTableHeaders',
    ]);
  });

  it('refuses a paper size outside the closed set', () => {
    expect(issuesOf({ ...BASE, regions: REGIONS, print: { paperSize: 'A3' } }).map((i) => i.path))
      .toEqual(['print.paperSize']);
  });

  it('refuses a negative margin, and a margin side the closed object does not declare', () => {
    const issues = issuesOf({ ...BASE, regions: REGIONS, print: { margins: { top: -1, middle: 4 } } });
    expect(issues.map((i) => i.path).sort()).toEqual(['print.margins', 'print.margins.top']);
    expect(issues.find((i) => i.path === 'print.margins')!.message).toMatch(/these print margins: `middle`/);
  });

  it('answers an undeclared key with the declared one (`paper` → `paperSize`)', () => {
    const [issue] = issuesOf({ ...BASE, regions: REGIONS, print: { paper: 'A4' } });
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toMatch(/this print declaration: `paper`[\s\S]*`paperSize`/);
  });

  it('answers a `header` block list with the region it belongs in', () => {
    const [issue] = issuesOf({ ...BASE, regions: REGIONS, print: { header: [] } });
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toMatch(/running header is the page's own `header` region/);
  });

  it('answers a page-level `pdf` key with `print`', () => {
    const [issue] = issuesOf({ ...BASE, regions: REGIONS, pdf: {} });
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toMatch(/`pdf` → `print`/);
  });
});

describe('checkPagePrintComposition — a print page prints exactly the blocks it authors', () => {
  it.each([
    ['slotted', { kind: 'slotted' }, /kind: 'slotted'.*synthesized default layout/s],
    ['html', { kind: 'html', source: 'Card' }, /kind: 'html'.*compiled from `source`/s],
    ['jsx', { kind: 'jsx', source: 'Card' }, /kind: 'jsx'.*compiled from `source`/s],
    ['react', { kind: 'react', source: 'Card' }, /kind: 'react'.*executed from `source`/s],
  ])('refuses `print` on a `%s` page, at `print`', (_kind, page, message) => {
    const issues = issuesOf({ ...BASE, ...page, regions: REGIONS, print: {} });
    expect(issues.map((i) => [i.path, i.code])).toEqual([['print', 'custom']]);
    expect(issues[0].message).toMatch(message);
  });

  it('refuses `print` on a `list` page and names the list print control instead', () => {
    const issues = issuesOf({ ...BASE, type: 'list', regions: REGIONS, print: {} });
    expect(issues.map((i) => [i.path, i.code])).toEqual([['print', 'custom']]);
    expect(issues[0].message).toMatch(/interfaceConfig\.allowPrinting/);
  });

  it('refuses `print` on a `utility` page — a floating panel, not a document — and names the admitted types', () => {
    const issues = issuesOf({ ...BASE, type: 'utility', regions: REGIONS, print: {} });
    expect(issues.map((i) => [i.path, i.code])).toEqual([['print', 'custom']]);
    expect(issues[0].message).toMatch(/type: 'utility'.*floating panel.*not a document/s);
    expect(issues[0].message).toContain("`type: 'record'`, `'home'` or `'app'`");
  });

  it('names the same admitted types in the `list` and `kind` refusals', () => {
    for (const value of [
      { ...BASE, type: 'list', regions: REGIONS, print: {} },
      { ...BASE, kind: 'slotted', regions: REGIONS, print: {} },
    ]) {
      expect(issuesOf(value)[0].message).toContain("`type: 'record'`, `'home'` or `'app'`");
    }
  });

  it('refuses `print` on a full page with no regions — it would draw the synthesized default layout', () => {
    for (const value of [{ ...BASE, print: {} }, { ...BASE, regions: [], print: {} }]) {
      const issues = issuesOf(value);
      expect(issues.map((i) => [i.path, i.code])).toEqual([['print', 'custom']]);
      expect(issues[0].message).toMatch(/synthesized default layout/);
    }
  });

  it.each([
    ['repeatHeader', 'header'],
    ['repeatFooter', 'footer'],
  ])('refuses `print.%s` on a page with no `%s` region, at the key', (key, region) => {
    const regions = REGIONS.filter((r) => r.name !== region);
    const issues = issuesOf({ ...BASE, regions, print: { [key]: true } });
    expect(issues.map((i) => [i.path, i.code])).toEqual([[`print.${key}`, 'custom']]);
    expect(issues[0].message).toContain(`declares no region named \`${region}\``);
    // `false` repeats nothing, so it needs no region.
    expect(issuesOf({ ...BASE, regions, print: { [key]: false } })).toEqual([]);
  });

  it('accepts `print` on a record, home and app page, the `full` default kind included', () => {
    for (const type of ['record', 'home', 'app'] as const) {
      expect(issuesOf({ ...BASE, type, regions: REGIONS, print: {} })).toEqual([]);
      expect(issuesOf({ ...BASE, type, kind: 'full', regions: REGIONS, print: {} })).toEqual([]);
    }
  });

  it('leaves a page without `print` untouched — the slotted, list and utility pages it refuses above still parse', () => {
    expect(issuesOf({ ...BASE, kind: 'slotted' })).toEqual([]);
    expect(issuesOf({ ...BASE, type: 'list' })).toEqual([]);
    expect(issuesOf({ ...BASE, type: 'utility' })).toEqual([]);
    expect(issuesOf({ ...BASE })).toEqual([]);
  });
});

describe('the printable block subset classifies the whole component vocabulary', () => {
  const live = [...KNOWN_COMPONENT_TYPES].filter((t) => !RETIRED_PAGE_COMPONENT_TYPES.has(t));

  it('every live vocabulary type is either printable or refused with a reason — never neither', () => {
    const unclassified = live.filter(
      (t) => !PRINTABLE_PAGE_COMPONENT_TYPES.has(t) && !PRINT_REFUSED_PAGE_COMPONENT_TYPES.has(t),
    );
    expect(unclassified).toEqual([]);
  });

  it('no type is both printable and refused', () => {
    expect([...PRINTABLE_PAGE_COMPONENT_TYPES].filter((t) => PRINT_REFUSED_PAGE_COMPONENT_TYPES.has(t)))
      .toEqual([]);
  });

  it('neither list names a type the vocabulary does not declare, or one it retired', () => {
    const stale = [...PRINTABLE_PAGE_COMPONENT_TYPES, ...PRINT_REFUSED_PAGE_COMPONENT_TYPES.keys()]
      .filter((t) => !KNOWN_COMPONENT_TYPES.has(t) || RETIRED_PAGE_COMPONENT_TYPES.has(t));
    expect(stale).toEqual([]);
  });

  it('keeps the ruling\'s named printable kinds in the subset: field blocks, a table of all rows, text, images', () => {
    for (const t of ['record:details', 'record:line_items', 'element:text', 'element:image']) {
      expect(PRINTABLE_PAGE_COMPONENT_TYPES.has(t), t).toBe(true);
    }
  });

  it('keeps the ruling\'s named refusals out of it: blocks that window their rows or lay out to the screen', () => {
    for (const t of ['object-grid', 'record:related_list', 'object-kanban', 'object-calendar', 'page:sidebar']) {
      expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.has(t), t).toBe(true);
    }
  });

  it('words every refusal reason as the clause after "it", ending without a full stop', () => {
    for (const [t, reason] of PRINT_REFUSED_PAGE_COMPONENT_TYPES) {
      expect(reason, t).toMatch(/^[a-z]/);
      expect(reason.endsWith('.'), t).toBe(false);
    }
  });
});
