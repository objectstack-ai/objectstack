// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A caller-scoped list view is never the FIRST view of an object that a Setup
 * or Account entry opens, and every entry that wants one names it — judged over
 * the RUNTIME-MERGED apps, plugin contributions included.
 *
 * ## The mechanism
 *
 * When a route names no view, the console opens the object's first declared
 * list view (objectui `ObjectView`: the URL view id, then `?view=`, then a view
 * marked `isDefault`, then `views[0]`). A `{current_user_id}`-filtered view
 * declared first is therefore what an administrator lands on from a Setup entry
 * that names no view: their own rows, on the page meant for administering
 * everyone's.
 *
 * ## Why a boot, and why here
 *
 * `packages/platform-objects/src/apps/caller-scoped-first-list-view.test.ts`
 * pins these two rules over that package's own Setup contributions and Account
 * app. It cannot see a plugin's entries: the plugins depend on
 * `platform-objects`, not the other way round, and their Setup entries arrive
 * only at runtime, through `manifest.navigationContributions`. Setup →
 * Approvals → Requests (`nav_approval_requests`, contributed by
 * `@objectstack/plugin-approvals`) opened the caller-scoped `my_pending` view
 * inside exactly that blind spot.
 *
 * So this file boots the composition the way
 * `packages/cli/scripts/check-app-nav-i18n.mjs` does — the same contributor
 * roster, the same `manifest`-service seam, each manifest handed to
 * `ObjectQL.registerApp` — and reads the apps back through the registry's
 * `getApp`, which applies the same `applyNavContributions` merge the
 * `/api/v1/meta/app` path serves. Every `type: 'object'` entry of the merged
 * Setup and Account apps is in the population, so an entry a plugin adds later
 * is judged without anyone listing it here.
 *
 * ## The two rules
 *
 *   (a) every object such an entry names declares a first list view that is
 *       not caller-scoped;
 *   (b) every such entry whose object declares a caller-scoped view names a
 *       view (`viewName`) the object declares under that name, and a Setup
 *       entry names one that is not caller-scoped.
 *
 * "Caller-scoped" is read off the view itself: `{current_user_id}` anywhere in
 * it (the `${current_user_id}` spelling contains it too). That token is
 * presentation scope, not access: which rows a caller may read is row-level
 * security's decision, so the declared order decides which view opens and
 * nothing else.
 *
 * ## Where an object's definition is read
 *
 *   - From the composition's own registry (`registry.getObject`), which holds
 *     every object the booted contributors register.
 *   - Otherwise from `@objectstack/platform-objects/identity`, the barrel that
 *     `@objectstack/plugin-auth` registers its identity objects from
 *     (`authIdentityObjects` in its `manifest.ts`). plugin-auth is not booted:
 *     `AuthPlugin` refuses to start without a secret, which is also why
 *     check-app-nav-i18n leaves it out of its roster.
 *
 * A named object neither source declares fails the run: an entry neither rule
 * can judge is not a pass.
 *
 * ## Reach, stated so a green run is not read wider than it is
 *
 *   - The roster below mirrors check-app-nav-i18n's `CONTRIBUTORS`. A
 *     contributor added there and not here is one this file does not see, so
 *     the two move together.
 *   - plugin-auth's `nav_sso_providers` is contributed only when an external
 *     IdP is wired, so no composition this file boots merges it.
 *   - An object that declares ONLY caller-scoped list views cannot meet (a)
 *     without a new view, which is not this file's to add. That set is pinned
 *     exactly, and (b) holds every entry naming one of them to a named view.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import * as IdentityObjects from '@objectstack/platform-objects/identity';
import { createSetupAppPlugin } from '@objectstack/setup';
import { createAccountAppPlugin } from '@objectstack/account';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { DatasourceAdminServicePlugin } from '@objectstack/service-datasource';
import { CONNECT_AGENT_UI_BUNDLE } from '@objectstack/mcp';
import {
  CLOUD_CONNECTION_UI_BUNDLE,
  MARKETPLACE_BROWSE_UI_BUNDLE,
  MARKETPLACE_INSTALLED_UI_BUNDLE,
} from '@objectstack/cloud-connection';

type AppName = 'setup' | 'account';
const APPS: readonly AppName[] = ['setup', 'account'];

type Manifest = {
  apps?: Array<{ name?: string; navigation?: unknown[] }>;
  navigationContributions?: Array<{ app?: string; items?: Array<{ id?: string }> }>;
};

type BootablePlugin = {
  init?(ctx: unknown): unknown;
  start?(ctx: unknown): unknown;
};

type Contributor = {
  source: string;
  apps: readonly AppName[];
  load(): { plugin?: BootablePlugin; manifests?: Manifest[] };
};

// The composition. EXPLICIT, as in check-app-nav-i18n: a contributor that
// drops out of this list must do so in a diff someone reads.
const CONTRIBUTORS: readonly Contributor[] = [
  { source: '@objectstack/setup', apps: ['setup'], load: () => ({ plugin: createSetupAppPlugin() }) },
  { source: '@objectstack/account', apps: ['account'], load: () => ({ plugin: createAccountAppPlugin() }) },
  { source: '@objectstack/plugin-security', apps: ['setup'], load: () => ({ plugin: new SecurityPlugin({}) }) },
  { source: '@objectstack/plugin-sharing', apps: ['setup'], load: () => ({ plugin: new SharingServicePlugin({}) }) },
  {
    source: '@objectstack/plugin-approvals',
    apps: ['setup'],
    load: () => ({ plugin: new ApprovalsServicePlugin({ disableService: true }) }),
  },
  { source: '@objectstack/plugin-audit', apps: ['setup'], load: () => ({ plugin: new AuditPlugin() }) },
  {
    source: '@objectstack/plugin-webhooks',
    apps: ['setup'],
    load: () => ({ plugin: new WebhookOutboxPlugin({ autoEnqueue: false }) }),
  },
  { source: '@objectstack/service-messaging', apps: ['setup'], load: () => ({ plugin: new MessagingServicePlugin({}) }) },
  {
    source: '@objectstack/service-datasource',
    apps: ['setup'],
    load: () => ({ plugin: new DatasourceAdminServicePlugin({}) }),
  },
  {
    source: '@objectstack/mcp',
    apps: ['setup', 'account'],
    load: () => ({ manifests: [CONNECT_AGENT_UI_BUNDLE as Manifest] }),
  },
  {
    source: '@objectstack/cloud-connection',
    apps: ['setup'],
    load: () => ({
      manifests: [CLOUD_CONNECTION_UI_BUNDLE, MARKETPLACE_BROWSE_UI_BUNDLE, MARKETPLACE_INSTALLED_UI_BUNDLE] as Manifest[],
    }),
  },
];

type NavItem = { id?: string; type?: string; objectName?: string; viewName?: string; children?: NavItem[] };
type ListView = Record<string, unknown>;
type ObjectDef = { name?: string; fields?: unknown; listViews?: Record<string, ListView> };

type Entry = { id: string; app: AppName; objectName: string; viewName?: string; source: string };

const CALLER_TOKEN = '{current_user_id}';
const isCallerScoped = (view: unknown): boolean => JSON.stringify(view ?? {}).includes(CALLER_TOKEN);

/** Every nav id in a tree, depth-first, groups included. */
function navIds(items: unknown[] | undefined): string[] {
  const out: string[] = [];
  const walk = (list: unknown[] | undefined) => {
    for (const raw of list ?? []) {
      const item = (raw ?? {}) as NavItem;
      if (typeof item.id === 'string' && item.id) out.push(item.id);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(items);
  return out;
}

// ── Boot ────────────────────────────────────────────────────────────────────

const engine = new ObjectQL();

/** Manifests registered by the contributor currently being booted. */
let sink: Manifest[] = [];

// Exactly one real service, `manifest`, whose `register` is the seam every nav
// contribution flows through, and inert but COMPLETE members for the rest of
// the context, so a plugin never dies on a missing member and reads as absent.
const ctx = {
  getService: (name: string) => (name === 'manifest' ? { register: (m: Manifest) => sink.push(m) } : undefined),
  registerService: () => {},
  registerServiceFactory: () => {},
  replaceService: () => {},
  getServiceScoped: async () => undefined,
  getServices: () => new Map(),
  hook: () => {},
  trigger: async () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getKernel: () => undefined,
};

/** contributor → app → the nav ids it landed there. */
const landed = new Map<string, Record<AppName, string[]>>();
/** app → nav id → the contributor that declared it. */
const declaredBy = new Map<AppName, Map<string, string>>(APPS.map((a) => [a, new Map()]));

for (const contributor of CONTRIBUTORS) {
  sink = [];
  const loaded = contributor.load();
  if (loaded.plugin) {
    await loaded.plugin.init?.(ctx);
    await loaded.plugin.start?.(ctx);
  }
  sink.push(...(loaded.manifests ?? []));

  const ids: Record<AppName, string[]> = { setup: [], account: [] };
  for (const manifest of sink) {
    for (const contribution of manifest.navigationContributions ?? []) {
      const app = contribution.app as AppName;
      if (!APPS.includes(app)) continue;
      for (const item of contribution.items ?? []) {
        if (!item?.id) continue;
        ids[app].push(item.id);
        declaredBy.get(app)!.set(item.id, contributor.source);
      }
    }
    for (const shell of manifest.apps ?? []) {
      const app = shell.name as AppName;
      if (!APPS.includes(app)) continue;
      for (const id of navIds(shell.navigation)) {
        ids[app].push(id);
        if (!declaredBy.get(app)!.has(id)) declaredBy.get(app)!.set(id, contributor.source);
      }
    }
    engine.registerApp(manifest);
  }
  landed.set(contributor.source, ids);
}

/** Every `type: 'object'` entry of one merged app, depth-first. */
function objectEntries(app: AppName): Entry[] {
  const merged = engine.registry.getApp(app) as { navigation?: unknown[] } | undefined;
  const out: Entry[] = [];
  const walk = (list: unknown[] | undefined) => {
    for (const raw of list ?? []) {
      const item = (raw ?? {}) as NavItem;
      if (item.type === 'object') {
        // Thrown, never skipped: an entry this walk cannot read is an entry
        // neither rule judges.
        if (typeof item.id !== 'string' || typeof item.objectName !== 'string') {
          throw new Error(`a merged ${app} object entry without an id or objectName: ${JSON.stringify(item)}`);
        }
        out.push({
          id: item.id,
          app,
          objectName: item.objectName,
          viewName: item.viewName,
          source: declaredBy.get(app)!.get(item.id) ?? '(undeclared)',
        });
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(merged?.navigation);
  return out;
}

const MERGED_APPS = new Map(APPS.map((app) => [app, engine.registry.getApp(app) !== undefined]));
const ENTRIES: Entry[] = APPS.flatMap((app) => (MERGED_APPS.get(app) ? objectEntries(app) : []));

/** The identity objects plugin-auth registers at runtime, by name. */
const IDENTITY: Map<string, ObjectDef> = (() => {
  const byName = new Map<string, ObjectDef>();
  for (const value of Object.values(IdentityObjects)) {
    const def = value as unknown as ObjectDef;
    if (!def || typeof def !== 'object' || typeof def.name !== 'string' || !def.fields) continue;
    const seen = byName.get(def.name);
    if (seen && seen !== def) throw new Error(`two different identity object definitions export the name ${def.name}`);
    byName.set(def.name, def);
  }
  return byName;
})();

/** Where each named object's definition came from. */
type Resolved = { def: ObjectDef; from: 'composition' | 'identity' };
const NAMED_OBJECTS = [...new Set(ENTRIES.map((e) => e.objectName))].sort();
const CATALOGUE = new Map<string, Resolved>();
for (const name of NAMED_OBJECTS) {
  const registered = engine.registry.getObject(name) as ObjectDef | undefined;
  if (registered) CATALOGUE.set(name, { def: registered, from: 'composition' });
  else if (IDENTITY.has(name)) CATALOGUE.set(name, { def: IDENTITY.get(name)!, from: 'identity' });
}
const UNRESOLVED = NAMED_OBJECTS.filter((name) => !CATALOGUE.has(name));

const listViewsOf = (name: string): Record<string, ListView> => CATALOGUE.get(name)?.def.listViews ?? {};

/** Resolved objects whose every declared list view is caller-scoped. */
const ONLY_CALLER_SCOPED = NAMED_OBJECTS.filter((name) => {
  const views = Object.values(listViewsOf(name));
  return CATALOGUE.has(name) && views.length > 0 && views.every(isCallerScoped);
});

/** The objects (a) judges: resolved, declaring no list view or at least one unscoped one. */
const JUDGED_BY_A = NAMED_OBJECTS.filter((name) => CATALOGUE.has(name) && !ONLY_CALLER_SCOPED.includes(name));

/** The entries (b) judges: the object declares a caller-scoped view, or cannot be read. */
const JUDGED_BY_B = ENTRIES.filter(
  (e) => !CATALOGUE.has(e.objectName) || Object.values(listViewsOf(e.objectName)).some(isCallerScoped),
);

// ── The composition is complete ─────────────────────────────────────────────

describe('the merged Setup and Account apps are booted whole', () => {
  it('both apps are registered and merged', () => {
    for (const app of APPS) expect(MERGED_APPS.get(app), `the ${app} app is not registered at all`).toBe(true);
  });

  // The anti-false-green half: a contributor whose registration silently
  // no-ops shrinks the population, which makes this file GREENER, not redder.
  it.each(CONTRIBUTORS.flatMap((c) => c.apps.map((app) => [c.source, app] as const)))(
    '%s lands at least one navigation id in the %s app',
    (source, app) => {
      expect(landed.get(source)?.[app] ?? [], `${source} landed no ${app} navigation id`).not.toHaveLength(0);
    },
  );

  it('the population carries entries a plugin contributes, not only the shells', () => {
    const pluginEntries = ENTRIES.filter((e) => e.source !== '@objectstack/setup' && e.source !== '@objectstack/account');
    expect(pluginEntries.map((e) => `${e.app}/${e.id}`)).toEqual(
      expect.arrayContaining(['setup/nav_approval_requests', 'setup/nav_record_shares']),
    );
    expect(ENTRIES.filter((e) => e.app === 'account').length).toBeGreaterThan(0);
  });

  // Non-vacuity, not the population: every object this family reordered must
  // still be judged by both rules, or a green run says nothing about it.
  it('judges every object whose caller-scoped first view was moved off first place', () => {
    for (const name of [
      'sys_approval_request',
      'sys_record_share',
      'sys_user',
      'sys_api_key',
      'sys_session',
      'sys_oauth_application',
      'sys_account',
      'sys_user_preference',
    ]) {
      expect(JUDGED_BY_A, `(a) no longer judges ${name}`).toContain(name);
      expect(JUDGED_BY_B.map((e) => e.objectName), `(b) no longer judges an entry naming ${name}`).toContain(name);
    }
  });

  it('every object an entry names is declared by the composition or by the identity barrel', () => {
    // Remedy for a red here: add the plugin that registers the object to the
    // roster above (and to check-app-nav-i18n's), never a fallback.
    expect(UNRESOLVED, 'named objects neither source declares').toEqual([]);
  });

  it('the objects that declare only caller-scoped list views are exactly these', () => {
    // Each can meet (a) only with a new unscoped view, which is triage's call,
    // so the set is pinned exactly and (b) holds every entry naming one of them.
    expect(ONLY_CALLER_SCOPED).toEqual(['sys_inbox_message', 'sys_member']);
  });
});

// ── (a) a caller-scoped list view is never an object's first ────────────────

describe('(a) no object a Setup or Account entry opens declares a caller-scoped list view first', () => {
  it.each(JUDGED_BY_A)('%s', (name) => {
    const [first, view] = Object.entries(listViewsOf(name))[0] ?? [];
    const namedBy = ENTRIES.filter((e) => e.objectName === name).map((e) => `${e.app}/${e.id}`);
    expect(
      isCallerScoped(view),
      `${name} declares the caller-scoped list view "${first}" first; it is opened by ${namedBy.join(', ')}`,
    ).toBe(false);
  });
});

// ── (b) every entry that wants a caller-scoped object names its view ────────

describe('(b) every entry whose object declares a caller-scoped view names its view', () => {
  it.each(JUDGED_BY_B.map((e) => [`${e.app}/${e.id}`, e] as const))('%s', (_label, entry) => {
    const where = `${entry.app}/${entry.id} (object ${entry.objectName}, contributed by ${entry.source})`;
    expect(entry.viewName, `${where} names no viewName`).toBeTypeOf('string');
    const views = listViewsOf(entry.objectName);
    if (!CATALOGUE.has(entry.objectName)) return;
    expect(Object.keys(views), `${where} names "${entry.viewName}", which the object does not declare`).toContain(
      entry.viewName,
    );
    if (entry.app === 'setup') {
      expect(
        isCallerScoped(views[entry.viewName!]),
        `${where} is an administrator's entry and names the caller-scoped view "${entry.viewName}"`,
      ).toBe(false);
    }
  });
});
