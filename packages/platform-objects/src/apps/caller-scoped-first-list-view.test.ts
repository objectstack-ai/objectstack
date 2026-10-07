// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A caller-scoped list view is never an object's FIRST, and every entry that
// wants one names it (#21972 — the family #21960 opened with Setup → Users).
//
// The mechanism: when a route names no view, the console opens the object's
// first declared list view (objectui `ObjectView`: the URL view id, then
// `?view=`, then a view marked `isDefault`, then `views[0]`; these objects mark
// none). So a `{current_user_id}`-filtered view declared first is what an
// administrator lands on from a Setup entry that names no view — their own
// rows, on the page meant for administering everyone's — and what every
// bare-object door opens (the record page's object breadcrumb, the object
// switcher).
//
// Both pins are DERIVED from this package's navigation, never from a hand list
// of objects: the population is every `type: 'object'` entry of
// `SETUP_NAV_CONTRIBUTIONS` and of `ACCOUNT_APP`, and the object each names,
// resolved from this package's own exports.
//
//   (a) every object such an entry names declares a first list view that is
//       not caller-scoped;
//   (b) every such entry whose object declares a caller-scoped view names a
//       view (`viewName`) the object declares under that name — and a Setup
//       entry names one that is not caller-scoped.
//
// "Caller-scoped" is read off the view itself: `{current_user_id}` anywhere in
// it (the `${current_user_id}` spelling contains it too). That token is
// presentation scope, not access: which rows a caller may read is RLS's
// decision, so the declared order decides which view opens and nothing else.
//
// Reach, stated so a green run is not read wider than it is:
//   - Setup entries a PLUGIN contributes at runtime (`nav_record_shares` from
//     `@objectstack/plugin-sharing`, `nav_approval_requests` from
//     `@objectstack/plugin-approvals`, …) are not in this population: they are
//     not visible from here, and this package cannot import the plugins (they
//     depend on it).
//   - An object an entry names that this package does not declare cannot be
//     judged by (a). (b) therefore requires its entry to name a view, and the
//     set is pinned exactly below so it cannot grow unnoticed.
//   - An object that declares ONLY caller-scoped list views cannot meet (a)
//     without a new view, which is not this file's to add. That set is pinned
//     exactly too, and (b) holds every entry naming it to a named view.
import { describe, it, expect } from 'vitest';
import { AppSchema, NavigationContributionSchema } from '@objectstack/spec/ui';

import * as PlatformObjects from '../index.js';
import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { ACCOUNT_APP } from './account.app.js';

type NavItem = {
  id?: string;
  type?: string;
  objectName?: string;
  viewName?: string;
  children?: NavItem[];
};

type ListView = { name?: string };

type ObjectDef = {
  name: string;
  fields: Record<string, unknown>;
  listViews?: Record<string, ListView>;
};

type Entry = {
  id: string;
  surface: 'setup' | 'account';
  objectName: string;
  viewName?: string;
};

const CALLER_TOKEN = '{current_user_id}';

const isCallerScoped = (view: unknown): boolean =>
  JSON.stringify(view ?? {}).includes(CALLER_TOKEN);

/** Every `type: 'object'` nav item under `items`, depth-first. */
function objectEntries(items: unknown[] | undefined, surface: Entry['surface']): Entry[] {
  const out: Entry[] = [];
  const walk = (list: unknown[] | undefined) => {
    for (const raw of list ?? []) {
      const item = raw as NavItem;
      if (!item) continue;
      if (item.type === 'object') {
        // Thrown, never skipped: an entry this walk cannot read is an entry
        // neither pin judges.
        if (typeof item.id !== 'string' || typeof item.objectName !== 'string') {
          throw new Error(`a ${surface} object entry without an id or objectName: ${JSON.stringify(item)}`);
        }
        out.push({ id: item.id, surface, objectName: item.objectName, viewName: item.viewName });
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(items);
  return out;
}

const ENTRIES: Entry[] = [
  ...SETUP_NAV_CONTRIBUTIONS.flatMap((c) => objectEntries(c.items as unknown[], 'setup')),
  ...objectEntries(ACCOUNT_APP.navigation as unknown[], 'account'),
];

/** This package's objects by name. Two different definitions under one name is a failure, not a pick. */
const CATALOGUE: Map<string, ObjectDef> = (() => {
  const byName = new Map<string, ObjectDef>();
  for (const value of Object.values(PlatformObjects)) {
    const def = value as unknown as ObjectDef;
    if (!def || typeof def !== 'object' || typeof def.name !== 'string') continue;
    if (!def.fields || typeof def.fields !== 'object') continue;
    const seen = byName.get(def.name);
    if (seen && seen !== def) throw new Error(`two different object definitions export the name ${def.name}`);
    byName.set(def.name, def);
  }
  return byName;
})();

const listViewsOf = (name: string): Record<string, ListView> => CATALOGUE.get(name)?.listViews ?? {};

const NAMED_OBJECTS = [...new Set(ENTRIES.map((e) => e.objectName))].sort();
const RESOLVED = NAMED_OBJECTS.filter((name) => CATALOGUE.has(name));
const UNRESOLVED = NAMED_OBJECTS.filter((name) => !CATALOGUE.has(name));

/** Resolved objects whose every declared list view is caller-scoped. */
const ONLY_CALLER_SCOPED = RESOLVED.filter((name) => {
  const views = Object.values(listViewsOf(name));
  return views.length > 0 && views.every(isCallerScoped);
});

/** The objects (a) judges: resolved, and declaring no list view or at least one unscoped one. */
const JUDGED_BY_A = RESOLVED.filter((name) => !ONLY_CALLER_SCOPED.includes(name));

/** The entries (b) judges: the object declares a caller-scoped view, or cannot be read from here. */
const JUDGED_BY_B = ENTRIES.filter(
  (e) => !CATALOGUE.has(e.objectName) || Object.values(listViewsOf(e.objectName)).some(isCallerScoped),
);

describe('the population is derived from Setup and Account navigation (#21972)', () => {
  it('reaches object entries in both apps', () => {
    expect(ENTRIES.filter((e) => e.surface === 'setup').length).toBeGreaterThan(0);
    expect(ENTRIES.filter((e) => e.surface === 'account').length).toBeGreaterThan(0);
  });

  // Non-vacuity control, not the population: the objects this card reordered
  // must still be judged by both pins, or a green run says nothing about them.
  it('judges every object whose caller-scoped first view this card moved', () => {
    for (const name of ['sys_user', 'sys_api_key', 'sys_session', 'sys_oauth_application', 'sys_account', 'sys_user_preference']) {
      expect(JUDGED_BY_A, `(a) no longer judges ${name}`).toContain(name);
      expect(JUDGED_BY_B.map((e) => e.objectName), `(b) no longer judges an entry naming ${name}`).toContain(name);
    }
  });

  it('cannot read exactly these named objects from this package', () => {
    // `sys_inbox_message` is `@objectstack/service-messaging`'s; the Account
    // app's Notifications entry names it, and names `mine`.
    expect(UNRESOLVED).toEqual(['sys_inbox_message']);
  });

  it('finds exactly these named objects declaring only caller-scoped list views', () => {
    // `sys_member` declares `mine` alone; only the Account app names it, with
    // `viewName: 'mine'`. Meeting (a) would take a new unscoped view, which is
    // a decision this card reported rather than made.
    expect(ONLY_CALLER_SCOPED).toEqual(['sys_member']);
  });
});

describe('(a) a named object declares a first list view that is not caller-scoped (#21972)', () => {
  it.each(JUDGED_BY_A)('%s', (name) => {
    const [firstName, firstView] = Object.entries(listViewsOf(name))[0] ?? [];
    expect(
      isCallerScoped(firstView),
      `${name} declares the caller-scoped list view "${firstName}" first, so a route naming no view opens the caller's own rows`,
    ).toBe(false);
  });
});

describe('(b) an entry whose object declares a caller-scoped view names its view (#21972)', () => {
  it.each(JUDGED_BY_B.map((e) => [`${e.surface} ${e.id} → ${e.objectName}`, e] as const))('%s', (_label, entry) => {
    expect(entry.viewName, `${entry.id} names no view, so it opens whatever ${entry.objectName} declares first`).toBeTypeOf(
      'string',
    );
    if (!CATALOGUE.has(entry.objectName)) return;
    const view = listViewsOf(entry.objectName)[entry.viewName!];
    expect(view, `${entry.objectName} declares no list view "${entry.viewName}"`).toBeDefined();
    expect(view.name).toBe(entry.viewName);
    if (entry.surface === 'setup') {
      expect(isCallerScoped(view), `Setup's ${entry.id} names the caller-scoped view "${entry.viewName}"`).toBe(false);
    }
  });
});

describe('the named views reach the served apps (#21972)', () => {
  it('every Setup contribution parses, keeping each object entry its `viewName`', () => {
    for (const contribution of SETUP_NAV_CONTRIBUTIONS) {
      const parsed = NavigationContributionSchema.safeParse(contribution);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const kept = objectEntries(parsed.data?.items as unknown[], 'setup');
      expect(kept).toEqual(objectEntries(contribution.items as unknown[], 'setup'));
    }
  });

  it('the Account app parses, keeping each object entry its `viewName`', () => {
    const parsed = AppSchema.safeParse(ACCOUNT_APP);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const kept = objectEntries(parsed.data?.navigation as unknown[], 'account');
    expect(kept).toEqual(objectEntries(ACCOUNT_APP.navigation as unknown[], 'account'));
  });
});
