// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { PageSchema } from '../ui/page.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * `page-main-region-width-removed` — the data-at-rest half of the refusal of
 * `'small'`, `'medium'` and `'large'` on a page region named `main`
 * (`checkPageMainRegionWidth`).
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table. What this file pins on top:
 *
 *   - the conversion and the parse judge the same set: over every width, name
 *     casing, page kind and template below, the width is deleted exactly where
 *     the parse refuses it at `regions.N.width`, and nowhere else;
 *   - the authoring funnel never replays it (retired from the load path), so a
 *     live author still meets the parse's refusal at the region's `width`;
 *   - IDEMPOTENCE: the converted result replays to itself with no second notice;
 *   - the stored-row seam replays it, and the converted row parses against
 *     `PageSchema` where the stored one was refused.
 */
describe('page-main-region-width-removed (ADR-0087 D2)', () => {
  const ID = 'page-main-region-width-removed';
  type Region = { name: string; width?: string; components: unknown[] };
  const page = (regions: Region[], extra: Record<string, unknown> = {}) => ({
    name: 'sales_home_page', label: 'Sales Home', type: 'home', ...extra, regions,
  });
  const LARGE_MAIN = page(
    [{ name: 'sidebar', width: 'small', components: [] }, { name: 'main', width: 'large', components: [] }],
    { template: 'three-column' },
  );

  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(entry!.retiredAfter).toBe('17.7.0');
  });

  it('deletes the width from `main`, one notice per region, and leaves the rails and a `full` main alone', () => {
    const wallboard = page([{ name: 'main', width: 'full', components: [] }], { name: 'wallboard' });
    const { stack, notices } = collectConversionNotices({ pages: [LARGE_MAIN, wallboard] }, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === ID);
    expect(mine.map((n) => [n.path, n.from, n.to])).toEqual([['pages[0].regions[1].width', 'width', '(removed)']]);
    const out = (stack as { pages: Array<{ regions: Region[] }> }).pages;
    expect(out[0]!.regions).toEqual([{ name: 'sidebar', width: 'small', components: [] }, { name: 'main', components: [] }]);
    // The rail is the same reference: copy-on-write.
    expect(out[0]!.regions[0]).toBe(LARGE_MAIN.regions[0]);
    expect(out[1]).toBe(wallboard);
  });

  // The two judges, in step: the conversion deletes a width exactly where the
  // parse refuses one at `regions.N.width`.
  const NAMES = ['main', 'Main', 'MAIN', 'sidebar', 'aside', 'header', 'kpis'];
  const WIDTHS = ['small', 'medium', 'large', 'full'];
  const SHAPES: Array<[string, Record<string, unknown>]> = [
    ['default', {}],
    ['three-column', { template: 'three-column' }],
    ['header-sidebar-main', { template: 'header-sidebar-main' }],
    ['dashboard', { template: 'dashboard' }],
    ['a slotted record page', { type: 'record', object: 'account', kind: 'slotted' }],
    ['an html page', { kind: 'html', source: '<box />' }],
  ];
  const ROWS = SHAPES.flatMap(([shape, extra]) =>
    NAMES.flatMap((name) => WIDTHS.map((width) => [shape, name, width, extra] as const)),
  ).filter(([shape, name]) => shape === 'dashboard' || !['kpis'].includes(name))
    // `header-sidebar-main` places no `aside`; the placement check would refuse it.
    .filter(([shape, name]) => !(shape === 'header-sidebar-main' && name === 'aside'));

  it.each(ROWS)('on %s, region `%s` with width %s: the conversion deletes it iff the parse refuses it there', (_shape, name, width, extra) => {
    const stored = page([{ name, width, components: [] }], extra);
    const parsed = PageSchema.safeParse(stored);
    const refusedAtWidth = parsed.success
      ? false
      : parsed.error.issues.some((i) => i.path.join('.') === 'regions.0.width');
    // The fixture is otherwise valid: the only refusal ever in play is the width's.
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toEqual(['regions.0.width']);
    const converted = applyConversionsToStoredItem('page', structuredClone(stored)) as { regions: Region[] };
    expect('width' in converted.regions[0]!).toBe(!refusedAtWidth);
    expect(refusedAtWidth).toBe(name.toLowerCase() === 'main' && width !== 'full');
  });

  it('control: a stack with no width on `main` is returned as the same reference, with no notice', () => {
    const clean = { pages: [page([{ name: 'main', components: [] }, { name: 'sidebar', width: 'large', components: [] }])] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out).toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('⛔ never replays on the authoring funnel — the default load path leaves the width for the parse to refuse', () => {
    const { stack, notices } = collectConversionNotices({ pages: [structuredClone(LARGE_MAIN)] });
    expect((stack as { pages: Array<{ regions: Region[] }> }).pages[0]!.regions[1]).toHaveProperty('width', 'large');
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
    const parsed = PageSchema.safeParse(LARGE_MAIN);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual(['regions.1.width']);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions({ pages: [structuredClone(LARGE_MAIN)] }, { includeRetired: true });
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the stored-row seam replays it, and the converted row parses against `PageSchema`', () => {
    const stored = structuredClone(LARGE_MAIN);
    expect(PageSchema.safeParse(stored).success).toBe(false);
    const converted = applyConversionsToStoredItem('page', stored) as { regions: Region[] };
    expect(converted.regions[1]).toEqual({ name: 'main', components: [] });
    expect(PageSchema.safeParse(converted).success).toBe(true);
  });
});
