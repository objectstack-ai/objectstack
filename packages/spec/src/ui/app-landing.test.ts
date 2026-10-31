// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `app.landing` — the per-audience landing list (ruling record 6545223246,
 * letter A).
 *
 * The retired `homePageId` was an id into `navigation` that a renderer
 * resolved by falling back to the first item when it dangled. `landing` is an
 * id into the same tree, so what these cases pin is the refusal that makes the
 * difference: an `item` that names nothing in this app, or an entry that opens
 * nothing, is refused at parse at its own path; and the predicate is required
 * and reads no `data`.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { AppLandingEntrySchema, AppSchema, appLandingItemsResolve } from './app.zod';
import * as uiBarrel from './index';

const NAV = [
  { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
  {
    id: 'grp_service', type: 'group', label: 'Service', children: [
      { id: 'nav_service_console', type: 'page', label: 'Service console', pageName: 'service_console' },
    ],
  },
  { id: 'nav_new_case', type: 'action', label: 'New case', actionDef: { actionName: 'new_case' } },
  { type: 'separator', id: 'sep_one' },
];

const app = (extra: Record<string, unknown>) => ({ name: 'crm', label: 'CRM', navigation: NAV, ...extra });

const issuesOf = (r: z.ZodSafeParseResult<unknown>) =>
  r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));

describe('app.landing — accepted shapes', () => {
  it('accepts entries naming top-level and nested navigation entries, first match wins by order', () => {
    const r = AppSchema.safeParse(app({
      landing: [
        { item: 'nav_service_console', visible: "'service_agent' in current_user.positions" },
        { item: 'nav_leads', visible: "'sales_rep' in current_user.positions" },
      ],
    }));
    expect(issuesOf(r)).toEqual([]);
    // The bare string is normalised to the CEL envelope by the slot's own schema.
    expect(r.success && r.data.landing?.[0].visible).toEqual({
      dialect: 'cel',
      source: "'service_agent' in current_user.positions",
    });
  });

  it('accepts an entry naming an item that only an area declares', () => {
    const r = AppSchema.safeParse({
      name: 'crm',
      label: 'CRM',
      areas: [{ id: 'area_sales', label: 'Sales', navigation: [{ id: 'nav_pipeline', type: 'object', label: 'Pipeline', objectName: 'opportunity' }] }],
      landing: [{ item: 'nav_pipeline', visible: 'true' }],
    });
    expect(issuesOf(r)).toEqual([]);
  });

  it('CONTROL — an app without the key parses exactly as before', () => {
    const r = AppSchema.safeParse(app({}));
    expect(r.success).toBe(true);
    expect(r.success && 'landing' in r.data).toBe(false);
  });
});

describe('app.landing — refused at parse, at the entry\'s own path', () => {
  it('refuses an item that names no navigation entry of this app, listing the ones that exist', () => {
    const issues = issuesOf(AppSchema.safeParse(app({ landing: [{ item: 'nav_missing', visible: 'true' }] })));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: 'landing.0.item' });
    expect(issues[0].message).toContain('`nav_missing`');
    // Openable entries are named; the group, the action and the separator are not.
    expect(issues[0].message).toContain('`nav_leads`, `nav_service_console`');
    expect(issues[0].message).not.toContain('`grp_service`');
  });

  it.each([
    ['group', 'grp_service'],
    ['action', 'nav_new_case'],
    ['separator', 'sep_one'],
  ])('refuses an item naming a `%s` entry, which opens no page', (type, item) => {
    const issues = issuesOf(AppSchema.safeParse(app({ landing: [{ item, visible: 'true' }] })));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: 'landing.0.item' });
    expect(issues[0].message).toContain(`a \`${type}\` navigation entry`);
  });

  it('refuses a `visible` that reads `data`, which a landing entry never binds', () => {
    const issues = issuesOf(AppSchema.safeParse(app({ landing: [{ item: 'nav_leads', visible: 'data.total == 1' }] })));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: 'landing.0.visible' });
  });

  it('refuses an entry without `visible`: a predicate-less landing is `homePageId` again', () => {
    const issues = issuesOf(AppSchema.safeParse(app({ landing: [{ item: 'nav_leads' }] })));
    expect(issues.map((i) => i.path)).toContain('landing.0.visible');
  });

  it('refuses an empty list', () => {
    const issues = issuesOf(AppSchema.safeParse(app({ landing: [] })));
    expect(issues.map((i) => i.path)).toEqual(['landing']);
  });

  it('refuses an unknown key on an entry and routes near-miss spellings to the declared keys', () => {
    const r = AppLandingEntrySchema.safeParse({ navigationId: 'nav_leads', visibleWhen: 'true' });
    expect(r.success).toBe(false);
    const text = issuesOf(r).map((i) => i.message).join('\n');
    expect(text).toContain('`navigationId` → `item`');
    expect(text).toContain('`visibleWhen` → `visible`');
  });

  it('routes `landings` on the app to `landing`', () => {
    const text = issuesOf(AppSchema.safeParse(app({ landings: [] }))).map((i) => i.message).join('\n');
    expect(text).toContain('`landings` → `landing`');
  });
});

describe('appLandingItemsResolve — the exported refinement', () => {
  it('is reachable from the ui barrel by identity', () => {
    expect((uiBarrel as Record<string, unknown>).appLandingItemsResolve).toBe(appLandingItemsResolve);
    expect((uiBarrel as Record<string, unknown>).AppLandingEntrySchema).toBe(AppLandingEntrySchema);
  });

  it('judges the authored bare-string `visible` the same as the parsed envelope', () => {
    const issues: string[] = [];
    const ctx = { addIssue: (i: { path?: unknown[] }) => issues.push((i.path ?? []).join('.')) } as unknown as z.RefinementCtx;
    appLandingItemsResolve({ navigation: NAV, landing: [{ item: 'nav_leads', visible: 'data.x' }] }, ctx);
    appLandingItemsResolve({ navigation: NAV, landing: [{ item: 'nav_leads', visible: { dialect: 'cel', source: 'data.x' } }] }, ctx);
    expect(issues).toEqual(['landing.0.visible', 'landing.0.visible']);
  });
});
