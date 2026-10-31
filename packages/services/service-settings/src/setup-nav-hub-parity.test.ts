// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Setup sidebar and the settings hub name the same pages the same way
 * (#27854).
 *
 * Two lists describe one set of settings pages. The hub (`All Settings`) is
 * drawn from the registered manifests: one card per namespace, titled
 * `settings.<namespace>.title` from {@link settingsBuiltinTranslations}, or the
 * manifest's `label` where a locale has none. The Configuration group of the
 * Setup sidebar is drawn from `@objectstack/platform-objects`'
 * `SETUP_NAV_CONTRIBUTIONS` plus the entries this package contributes with a
 * namespace (Branding), labelled from `apps.setup.navigation.<id>.label`. Nothing
 * tied the two, so the sidebar said "Email" where the hub said "Mail Delivery",
 * and SMS Delivery and Data Lifecycle had a hub card and no sidebar entry.
 *
 * This file holds them together on the merged Setup tree the console reads,
 * in every shipped locale:
 *
 *   - every namespace the hub lists has exactly one sidebar entry opening it,
 *     and every sidebar entry opening a settings page names a namespace the hub
 *     lists;
 *   - the entry's label is the hub card's title, in `en` and in each translated
 *     locale where the hub carries a translated title.
 *
 * The hub set is the service's own `listManifests()` after a boot that mounts
 * the bundled manifests (as `os serve` does) and registers
 * `lifecycleSettingsManifest` the way `ObjectQLPlugin` does at `kernel:ready`.
 *
 * Every page the hub lists carries a translated title in each shipped locale,
 * Data Lifecycle included: it is `@objectstack/objectql`'s manifest, and its
 * copy lives in {@link settingsBuiltinTranslations} beside the bundled ones
 * (the coverage test there holds it to the same rule), so the label comparison
 * runs for every page and no page is exempt from it.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, lifecycleSettingsManifest } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS, SetupAppTranslations } from '@objectstack/platform-objects';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import type { SettingsService } from './settings-service.js';
import { settingsBuiltinTranslations } from './translations/index.js';

/** Where the hub opens a namespace; the sidebar entry for it points here. */
const SETTINGS_PAGE = /^\/apps\/setup\/system\/settings\/([a-z_]+)$/;

const TRANSLATED_LOCALES = ['zh-CN', 'ja-JP', 'es-ES'] as const;

interface NavItem { id?: string; type?: string; label?: string; url?: string; children?: NavItem[] }

async function bootHub(): Promise<{ manifests: SettingsManifest[]; registered: unknown[] }> {
  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const registered: unknown[] = [];
  kernel.registerService('manifest', { register: (m: unknown) => { registered.push(m); } });
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: kernel.registerService.bind(kernel),
    getService: kernel.getService.bind(kernel),
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };
  const plugin = new SettingsServicePlugin({ env: {}, registerRoutes: false });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  const service = ctx.getService('settings') as SettingsService;
  service.registerManifest(lifecycleSettingsManifest);
  return { manifests: service.listManifests(), registered };
}

/** The Configuration group of the Setup app as the registry folds it. */
function configurationEntries(registered: unknown[]): NavItem[] {
  const engine = new ObjectQL();
  engine.registry.logLevel = 'silent';
  engine.registerApp({
    id: 'com.objectstack.test.setup-shell', namespace: 'sys', version: '0.0.0', type: 'plugin', scope: 'system',
    name: 'Setup shell (fixture)', apps: [SETUP_APP], navigationContributions: SETUP_NAV_CONTRIBUTIONS,
  });
  for (const m of registered) engine.registerApp(m);
  const navigation = (engine.registry.getApp('setup') as { navigation?: NavItem[] } | undefined)?.navigation ?? [];
  return navigation.find((item) => item.id === 'group_configuration')?.children ?? [];
}

function settingsPageEntries(entries: NavItem[]): Map<string, NavItem[]> {
  const byNamespace = new Map<string, NavItem[]>();
  for (const item of entries) {
    const ns = item.type === 'url' ? SETTINGS_PAGE.exec(item.url ?? '')?.[1] : undefined;
    if (!ns) continue;
    byNamespace.set(ns, [...(byNamespace.get(ns) ?? []), item]);
  }
  return byNamespace;
}

const hubTitle = (locale: string, m: SettingsManifest): string | undefined =>
  (settingsBuiltinTranslations as Record<string, any>)[locale]?.settings?.[m.namespace]?.title;

const sidebarLabel = (locale: string, item: NavItem): string | undefined =>
  (SetupAppTranslations as Record<string, any>)[locale]?.apps?.setup?.navigation?.[item.id!]?.label;

describe('Setup sidebar and settings hub list the same pages under the same names (#27854)', async () => {
  const { manifests, registered } = await bootHub();
  const entries = settingsPageEntries(configurationEntries(registered));
  const namespaces = manifests.map((m) => m.namespace);

  it('reads a real hub and a real sidebar', () => {
    // Non-vacuity: the bundled slate plus lifecycle, and the sidebar's own
    // settings entries, are both present.
    expect(namespaces).toEqual(expect.arrayContaining(['mail', 'sms', 'lifecycle', 'branding', 'company']));
    expect(entries.size).toBeGreaterThanOrEqual(10);
  });

  it('every page the hub lists has exactly one sidebar entry, and no entry opens a page the hub does not list', () => {
    const missing = namespaces.filter((ns) => !entries.has(ns));
    const doubled = [...entries].filter(([, items]) => items.length > 1).map(([ns]) => ns);
    const orphan = [...entries.keys()].filter((ns) => !namespaces.includes(ns));
    expect({ missing, doubled, orphan }).toEqual({ missing: [], doubled: [], orphan: [] });
  });

  it('en: each sidebar entry is labelled with its hub card\'s title', () => {
    const drift = manifests
      .filter((m) => entries.has(m.namespace))
      .map((m) => {
        const item = entries.get(m.namespace)![0];
        const hub = hubTitle('en', m) ?? m.label;
        return { ns: m.namespace, hub, literal: item.label, served: sidebarLabel('en', item) ?? item.label };
      })
      .filter((r) => r.literal !== r.hub || r.served !== r.hub);
    expect(drift).toEqual([]);
  });

  for (const locale of TRANSLATED_LOCALES) {
    it(`${locale}: each sidebar entry reads as its hub card does`, () => {
      const drift = manifests
        .filter((m) => entries.has(m.namespace) && hubTitle(locale, m) != null)
        .map((m) => ({ ns: m.namespace, hub: hubTitle(locale, m), sidebar: sidebarLabel(locale, entries.get(m.namespace)![0]) }))
        .filter((r) => r.sidebar !== r.hub);
      expect(drift).toEqual([]);
    });

    it(`${locale}: every hub page carries a translated title`, () => {
      expect(manifests.filter((m) => hubTitle(locale, m) == null).map((m) => m.namespace)).toEqual([]);
    });
  }
});
