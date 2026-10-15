// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A page declares nothing the console does not honour (#23610, maintainer
 * ruling A on Q1 and Q2, record 6190536588).
 *
 *  - **Q1.** `isDefault: true` is refused on a page `defaultRecordPageObject`
 *    does not place — any page that is not a record page bound to an object.
 *    Nothing read it there: an app opens on its first navigation item and the
 *    root landing follows the APP's `isDefault`. The refusal names both.
 *  - **Q2.** `template` closes to the templates the console registers
 *    (`PageTemplateSchema`; `full-width`, a second name for `default`, retired
 *    by name), and on a `kind: 'full'` page a region whose name the template
 *    does not place (`PAGE_TEMPLATE_SLOTS`) is refused at that region's name,
 *    naming the template's slots. The console stacked such a region under
 *    `main` at full width and dropped its `width`.
 *
 * Bookkeeping shapes, pinned below: both refusals are exported object-level
 * checks attached to `PageSchema` (parity in
 * `object-refinement-check-exports.test.ts`); neither has a D2 conversion, so a
 * stored row replays unchanged and the parse still refuses it; each has a D3
 * entry.
 *
 * On the assertion set: a bare `PageSchema` parse raises zod issues, pinned by
 * `code`, `path` and the message's named subjects; the stack door wraps them
 * in the ADR-0112 envelope, pinned by `code` and `status`.
 */

import { describe, expect, it } from 'vitest';

import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { misplacedDefaultPageRefusal } from './default-record-page';
import {
  PAGE_TEMPLATE_OPEN_GRID,
  PAGE_TEMPLATE_SLOTS,
  PageSchema,
  PageTemplateSchema,
  definePage,
} from './page.zod';

const Q1_D3 = 'page-is-default-off-record-page-refused';
const Q2_D3 = 'page-template-closed-region-unplaced-refused';

const region = (name: string, width?: 'small' | 'medium' | 'large' | 'full') => ({
  name,
  ...(width ? { width } : {}),
  components: [],
});

function refusalOf(value: unknown) {
  const r = PageSchema.safeParse(value);
  expect(r.success, 'expected a refusal').toBe(false);
  return r.success ? [] : r.error.issues;
}

function stackRefusalOf(pages: unknown[]) {
  let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
  try {
    defineStack({
      manifest: { id: 'com.example.pages', name: 'pages', version: '1.0.0', type: 'app', namespace: 'pgs' },
      pages,
    } as never);
  } catch (e) {
    refusal = e as typeof refusal;
  }
  expect(refusal, 'defineStack must refuse').toBeDefined();
  return refusal!;
}

describe('Q1 — `isDefault: true` on a page that is not a record page bound to an object', () => {
  it.each(['home', 'app', 'utility', 'list'] as const)(
    'refuses it on a `%s` page, at `isDefault`, naming the navigation order and the app\'s `isDefault`',
    (type) => {
      const issues = refusalOf({ name: 'sales_home_page', label: 'Home', type, isDefault: true });
      expect(issues).toHaveLength(1);
      const [issue] = issues;
      expect(issue!.code).toBe('custom');
      expect(issue!.path).toEqual(['isDefault']);
      expect(issue!.message.startsWith(`\`isDefault: true\` is refused on a \`type: '${type}'\` page`)).toBe(true);
      // Where a landing really is set: the app's first navigation item, and
      // the APP's `isDefault` for the root landing.
      expect(issue!.message).toContain('first navigation item');
      expect(issue!.message).toContain("app's own `isDefault`");
      // Runtime prose carries no tracker number (`check:doc-authoring`).
      expect(issue!.message).not.toMatch(/#\d/);
    },
  );

  it('refuses it on a record page bound to no object — `type` left out (the `record` default) too — naming `object`', () => {
    for (const page of [
      { name: 'orphan_record', label: 'Orphan', type: 'record', isDefault: true },
      { name: 'orphan_record', label: 'Orphan', isDefault: true },
    ]) {
      const issues = refusalOf(page);
      expect(issues.map((i) => i.path.join('.'))).toEqual(['isDefault']);
      expect(issues[0]!.message.startsWith('`isDefault: true` is refused on a record page bound to no `object`')).toBe(true);
    }
  });

  it('the parse and the registry door print the one sentence (`misplacedDefaultPageRefusal`)', () => {
    const page = { name: 'sales_home_page', label: 'Home', type: 'home', isDefault: true };
    expect(refusalOf(page)[0]!.message).toBe(misplacedDefaultPageRefusal(page));
  });

  it('`definePage` throws, and the stack door wraps the refusal at `pages.N.isDefault`', () => {
    expect(() => definePage({ name: 'pgs_home', label: 'Home', type: 'home', isDefault: true })).toThrow(/`isDefault: true` is refused/);
    const refusal = stackRefusalOf([
      { name: 'pgs_landing', label: 'Landing', type: 'home' },
      { name: 'pgs_home', label: 'Home', type: 'home', isDefault: true },
    ]);
    expect({ code: refusal.code, status: refusal.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'pages.1.isDefault', code: 'custom' },
    ]);
  });

  it.each([
    ['a default record page bound to an object', { name: 'acct_detail', label: 'Account', type: 'record', object: 'account', isDefault: true }],
    ['a `home` page with `isDefault: false`', { name: 'pgs_home', label: 'Home', type: 'home', isDefault: false }],
    ['a `home` page that leaves `isDefault` out', { name: 'pgs_home', label: 'Home', type: 'home' }],
  ])('CONTROL — %s parses', (_label, page) => {
    const r = PageSchema.safeParse(page);
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });
});

describe('Q2 — the template set is closed', () => {
  it('declares exactly the ruled templates and slots', () => {
    expect(PAGE_TEMPLATE_SLOTS).toEqual({
      default: ['header', 'sidebar', 'main', 'aside', 'footer'],
      'header-sidebar-main': ['header', 'sidebar', 'main'],
      'three-column': ['header', 'sidebar', 'main', 'aside', 'footer'],
      dashboard: ['header', 'footer'],
    });
    expect(PAGE_TEMPLATE_OPEN_GRID).toEqual(['dashboard']);
    expect(PageTemplateSchema.options).toEqual(Object.keys(PAGE_TEMPLATE_SLOTS));
    expect(PageSchema.parse({ name: 'pg_page', label: 'P', type: 'home' }).template).toBe('default');
  });

  it('refuses the retired `full-width` by name, prescribing `default`', () => {
    const issues = refusalOf({ name: 'pg_page', label: 'P', type: 'home', template: 'full-width' });
    expect(issues.map((i) => i.path.join('.'))).toEqual(['template']);
    expect(issues[0]!.message.startsWith("Page `template: 'full-width'` was removed in @objectstack/spec 18")).toBe(true);
    expect(issues[0]!.message).toContain("Use `template: 'default'`");
  });

  it.each(['two-column', 'single-column', 'three-column-layout'])('refuses an unregistered `%s` at `template`', (template) => {
    const issues = refusalOf({ name: 'pg_page', label: 'P', type: 'home', template });
    expect(issues.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([{ path: 'template', code: 'invalid_value' }]);
  });
});

describe('Q2 — a region the template does not place', () => {
  it('refuses `left_sidebar` / `right_sidebar` on a `three-column` page, each at its name, naming the slots and the rename', () => {
    const issues = refusalOf({
      name: 'sales_home_page',
      label: 'Home',
      type: 'home',
      template: 'three-column',
      regions: [region('header'), region('left_sidebar', 'small'), region('main'), region('right_sidebar', 'medium')],
    });
    expect(issues.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'regions.1.name', code: 'custom' },
      { path: 'regions.3.name', code: 'custom' },
    ]);
    const [left, right] = issues;
    expect(left!.message.startsWith("Region `left_sidebar` is refused on a `template: 'three-column'` page")).toBe(true);
    expect(left!.message).toContain('`header`, `sidebar`, `main`, `aside`, `footer`');
    expect(left!.message).toContain('Rename it `sidebar`');
    expect(right!.message).toContain('Rename it `aside`');
    expect(left!.message).not.toMatch(/#\d/);
  });

  it('judges a page that leaves `template` out as `default`, and names only that template\'s slots on `header-sidebar-main`', () => {
    expect(refusalOf({ name: 'pg_page', label: 'P', type: 'home', regions: [region('content')] })[0]!.message)
      .toContain('Rename it `main`');
    const hsm = refusalOf({ name: 'pg_page', label: 'P', type: 'app', template: 'header-sidebar-main', regions: [region('main'), region('aside')] });
    expect(hsm.map((i) => i.path.join('.'))).toEqual(['regions.1.name']);
    expect(hsm[0]!.message).toContain('places only `header`, `sidebar`, `main`,');
    // `aside` is not one of its slots, so no rename is offered for it.
    expect(hsm[0]!.message).toContain('Rename it to one of those slots');
  });

  it('the stack door wraps the refusal at `pages.N.regions.M.name`', () => {
    const refusal = stackRefusalOf([
      { name: 'pgs_home', label: 'Home', type: 'home', template: 'three-column', regions: [region('main'), region('right_sidebar')] },
    ]);
    expect({ code: refusal.code, status: refusal.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal.issues!.map((i) => i.path.join('.'))).toEqual(['pages.0.regions.1.name']);
  });

  it.each([
    ['the five slots on `default`', { template: 'default', regions: ['header', 'sidebar', 'main', 'aside', 'footer'].map((n) => region(n)) }],
    ['the five slots on `three-column`', { template: 'three-column', regions: ['header', 'sidebar', 'main', 'aside', 'footer'].map((n) => region(n)) }],
    ['the renamed HotCRM shape (`sidebar` / `aside`) on `three-column`', { template: 'three-column', regions: [region('header'), region('sidebar', 'small'), region('main'), region('aside', 'medium')] }],
    ['a slot in another case (`Sidebar`)', { regions: [region('Sidebar'), region('MAIN')] }],
    ['any names on `dashboard` — the open grid', { template: 'dashboard', regions: [region('header'), region('kpis'), region('pipeline'), region('footer')] }],
    ['an unplaced name on a `slotted` record page — it renders its slots', { type: 'record', object: 'account', kind: 'slotted', regions: [region('left_sidebar')] }],
    ['an unplaced name on an `html` page — it renders its source', { kind: 'html', source: '<box />', regions: [region('content')] }],
  ])('CONTROL — %s parses', (_label, extra) => {
    const r = PageSchema.safeParse({ name: 'pg_page', label: 'P', type: 'home', ...extra });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });
});

describe('the ledger — two D3 entries and no D2 conversion', () => {
  it.each([Q1_D3, Q2_D3])('step 18 carries `%s`, judging no mechanical edit', (id) => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((e) => e.id === id);
    expect(entry, id).toBeDefined();
    expect(entry!.conversionIds ?? []).toEqual([]);
  });

  it.each([
    ['a non-record `isDefault`', { name: 'sales_home_page', label: 'Home', type: 'home', isDefault: true, regions: [] }, ['isDefault']],
    ['the retired `full-width`', { name: 'pg_page', label: 'P', type: 'record', object: 'invoice', template: 'full-width', regions: [region('main')] }, ['template']],
    ['an unplaced region', { name: 'pg_page', label: 'P', type: 'home', template: 'three-column', regions: [region('main'), region('left_sidebar')] }, ['regions.1.name']],
  ])('a STORED row with %s replays unchanged — no conversion touches it — and the parse still refuses it', (_label, row, paths) => {
    const notices: ConversionNotice[] = [];
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) });
    expect(rehydrated).toEqual(row);
    expect(notices.map((n) => n.conversionId)).toEqual([]);
    expect(refusalOf(rehydrated).map((i) => i.path.join('.'))).toEqual(paths);
  });
});
