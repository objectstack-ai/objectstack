// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { PageSchema } from '../ui/page.zod.js';
import { misplacedDefaultPageRefusal } from '../ui/default-record-page.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * `page-is-default-off-record-page-removed` — the data-at-rest half of the
 * misplaced-`isDefault` refusal.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table. What this file pins on top:
 *
 *   - the entry strips EXACTLY the pages the parse's one judge refuses
 *     (`misplacedDefaultPageRefusal`): a `home`, `app`, `utility` or `list`
 *     page and a record page bound to no object lose the flag; a default
 *     record page bound to an object keeps it, as the SAME reference;
 *   - the authoring funnel never replays it (retired from the load path), so a
 *     live author still meets the parse's refusal at `isDefault`;
 *   - IDEMPOTENCE: the converted result replays to itself with no second notice;
 *   - the stored-row seam replays it, and the converted row parses against
 *     `PageSchema` where the stored one was refused.
 */
describe('page-is-default-off-record-page-removed (ADR-0087 D2)', () => {
  const ID = 'page-is-default-off-record-page-removed';
  const HOME = { name: 'sales_home_page', label: 'Sales Home', type: 'home', isDefault: true, regions: [] as unknown[] };
  const BOUND = { name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', isDefault: true, regions: [] as unknown[] };

  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(entry!.retiredAfter).toBe('17.7.0');
  });

  it('strips the flag from every page the parse refuses it on, one notice per page, and from no other', () => {
    const pages = [
      HOME,
      { name: 'launcher', label: 'Launcher', type: 'app', isDefault: true },
      { name: 'utility_bar', label: 'Utilities', type: 'utility', isDefault: true },
      { name: 'account_list', label: 'Accounts', type: 'list', object: 'crm_account', isDefault: true },
      // A record page (the default type, spelled or omitted) bound to no object.
      { name: 'draft_record', label: 'Draft', type: 'record', isDefault: true },
      { name: 'untyped_record', label: 'Untyped', isDefault: true },
      BOUND,
      { name: 'team_home', label: 'Team Home', type: 'home', isDefault: false },
    ];
    // Every stripped page is one the judge refuses; every kept one it admits.
    for (const page of pages) {
      const refused = misplacedDefaultPageRefusal(page) !== undefined;
      expect(refused, page.name).toBe(page.isDefault === true && page !== BOUND);
    }
    const { stack, notices } = collectConversionNotices({ pages }, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === ID);
    expect(mine.map((n) => n.path)).toEqual([
      'pages[0].isDefault',
      'pages[1].isDefault',
      'pages[2].isDefault',
      'pages[3].isDefault',
      'pages[4].isDefault',
      'pages[5].isDefault',
    ]);
    for (const n of mine) {
      expect(n.from).toBe('isDefault');
      expect(n.to).toBe('(removed)');
    }
    const out = (stack as { pages: Record<string, unknown>[] }).pages;
    for (let i = 0; i < 6; i++) expect(out[i], pages[i]!.name).not.toHaveProperty('isDefault');
    // Everything else on a stripped page survives verbatim.
    expect(out[0]).toEqual({ name: 'sales_home_page', label: 'Sales Home', type: 'home', regions: [] });
    // The bound default record page and the `false` flag are untouched — the same references.
    expect(out[6]).toBe(BOUND);
    expect(out[7]).toBe(pages[7]);
  });

  it('control: a stack whose pages carry no misplaced flag is returned as the same reference, with no notice', () => {
    const clean = { pages: [BOUND, { name: 'team_home', label: 'Team Home', type: 'home' }] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out, 'nothing to strip ⇒ copy-on-write returns the input').toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('⛔ never replays on the authoring funnel — the default load path leaves the flag for the parse to refuse', () => {
    const { stack, notices } = collectConversionNotices({ pages: [structuredClone(HOME)] });
    expect((stack as { pages: Record<string, unknown>[] }).pages[0]).toHaveProperty('isDefault', true);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
    const parsed = PageSchema.safeParse(HOME);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual(['isDefault']);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions({ pages: [structuredClone(HOME)] }, { includeRetired: true });
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the stored-row seam replays it, and the converted row parses against `PageSchema`', () => {
    const stored = structuredClone(HOME);
    // Before: the flag is refused at parse — the row a pre-retirement author
    // left behind would be badged invalid on every read without the replay.
    expect(PageSchema.safeParse(stored).success).toBe(false);
    const converted = applyConversionsToStoredItem('page', stored);
    expect(converted).not.toHaveProperty('isDefault');
    expect(PageSchema.safeParse(converted).success).toBe(true);
    // The row's identity survives: name, type and regions are as stored.
    expect(converted).toMatchObject({ name: 'sales_home_page', type: 'home', regions: [] });
  });
});
