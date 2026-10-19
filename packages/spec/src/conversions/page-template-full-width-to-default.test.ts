// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { PageSchema } from '../ui/page.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * `page-template-full-width-to-default` — the data-at-rest half of the closed
 * template set, for the one retired spelling that is a second name for a
 * registered template.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table. What this file pins on top:
 *
 *   - only the retired SPELLING converts: a registered template and an
 *     UNREGISTERED name (`centered`) both come back as the same reference —
 *     an unregistered name is not a shape this entry positively recognizes,
 *     and stays with the parse;
 *   - the authoring funnel never replays it (retired from the load path), so a
 *     live author still meets the parse's one-word refusal at `template`;
 *   - IDEMPOTENCE: the converted result replays to itself with no second notice;
 *   - the stored-row seam replays it, and the converted row parses against
 *     `PageSchema` where the stored one was refused.
 */
describe('page-template-full-width-to-default (ADR-0087 D2)', () => {
  const ID = 'page-template-full-width-to-default';
  const FULL_WIDTH = {
    name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', template: 'full-width',
    regions: [{ name: 'main', components: [] as unknown[] }],
  };

  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(entry!.retiredAfter).toBe('17.7.0');
  });

  it('re-spells `full-width` as `default`, one notice per page, and leaves every other template alone', () => {
    const registered = { name: 'sales_home_page', label: 'Sales Home', type: 'home', template: 'three-column' };
    const unregistered = { name: 'app_launcher_page', label: 'Launcher', type: 'app', template: 'centered' };
    const none = { name: 'team_home', label: 'Team Home', type: 'home' };
    const { stack, notices } = collectConversionNotices(
      { pages: [FULL_WIDTH, registered, unregistered, none] },
      { includeRetired: true },
    );
    const mine = notices.filter((n) => n.conversionId === ID);
    expect(mine.map((n) => [n.path, n.from, n.to])).toEqual([['pages[0].template', 'full-width', 'default']]);
    const out = (stack as { pages: Record<string, unknown>[] }).pages;
    expect(out[0]).toEqual({ ...FULL_WIDTH, template: 'default' });
    expect(out[1]).toBe(registered);
    expect(out[2]).toBe(unregistered);
    expect(out[3]).toBe(none);
  });

  it('control: a stack with no `full-width` page is returned as the same reference, with no notice', () => {
    const clean = { pages: [{ name: 'team_home', label: 'Team Home', type: 'home', template: 'default' }] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out).toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('⛔ never replays on the authoring funnel — the default load path leaves the name for the parse to refuse', () => {
    const { stack, notices } = collectConversionNotices({ pages: [structuredClone(FULL_WIDTH)] });
    expect((stack as { pages: Record<string, unknown>[] }).pages[0]).toHaveProperty('template', 'full-width');
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
    const parsed = PageSchema.safeParse(FULL_WIDTH);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual(['template']);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions({ pages: [structuredClone(FULL_WIDTH)] }, { includeRetired: true });
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the stored-row seam replays it, and the converted row parses against `PageSchema`', () => {
    const stored = structuredClone(FULL_WIDTH);
    expect(PageSchema.safeParse(stored).success).toBe(false);
    const converted = applyConversionsToStoredItem('page', stored) as Record<string, unknown>;
    expect(converted.template).toBe('default');
    expect(PageSchema.safeParse(converted).success).toBe(true);
  });
});
