// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0146 D7] The Security plugin's two Setup → People & Organization
// entries: "Position Holders" and "Permission Set Assignment".
//
// The pages are console components the app shell registers under
// `security:position-holders` and `security:permission-set-assignment`; Setup's
// navigation is server metadata, so without an entry naming each ref the pages
// are reachable by typed URL only. This file pins the half this repository
// owns — the two entries, the refs they name, the group they sit in, and their
// gate. The console pins the ref → page half on its side.
//
// Why plugin-security and not `@objectstack/platform-objects`: the pages read
// and write this plugin's assignment rows, so the entries live and die with the
// plugin, exactly like its Positions / Capabilities / Permission Sets entries.
// That is also their gate: none of their own. The catalog entries carry no
// `requiredPermissions`, `requiresService` or `requiresObject`; the Setup app's
// `setup.access` and the group anchor decide who sees them.

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS, SetupAppTranslations } from '@objectstack/platform-objects/apps';
import { NavigationContributionSchema } from '@objectstack/spec/ui';
import { SecurityPlugin } from './security-plugin.js';

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  componentRef?: string;
  requiredPermissions?: string[];
  requiresService?: string;
  requiresObject?: string;
  visible?: unknown;
  children?: NavItem[];
};

type Contribution = { app: string; group?: string; priority?: number; items: NavItem[] };

/** Run the plugin's init() and return the manifest it registered. */
async function registeredManifest(): Promise<any> {
  const registered: any[] = [];
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: unknown) => registered.push(m) };
      throw new Error(`service not registered: ${name}`);
    },
    registerService() {},
    hook() {},
  };
  await new SecurityPlugin().init(ctx);
  expect(registered).toHaveLength(1);
  return registered[0];
}

const POSITION_HOLDERS = {
  id: 'nav_position_holders',
  type: 'component',
  label: 'Position Holders',
  componentRef: 'security:position-holders',
};
const PERMISSION_SET_ASSIGNMENT = {
  id: 'nav_permission_set_assignment',
  type: 'component',
  label: 'Permission Set Assignment',
  componentRef: 'security:permission-set-assignment',
};

/** The item keys that decide who sees an entry. */
const GATE_KEYS = ['requiredPermissions', 'requiresService', 'requiresObject', 'visible'] as const;
const gateOf = (item: NavItem) => Object.fromEntries(GATE_KEYS.map((k) => [k, item[k]]));

/**
 * The Setup app as `GET /api/v1/meta/app` folds it: the real `SchemaRegistry`
 * over `SETUP_APP`, platform-objects' own contributions, and — when
 * `withSecurity` — this plugin's, registered under its manifest id.
 */
async function renderedSetup(withSecurity: boolean): Promise<NavItem[]> {
  const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
  (registry as any).logLevel = 'silent';
  registry.registerApp(structuredClone(SETUP_APP), '@objectstack/platform-objects');
  for (const contribution of SETUP_NAV_CONTRIBUTIONS) {
    registry.registerAppNavContribution(structuredClone(contribution) as any, '@objectstack/platform-objects');
  }
  if (withSecurity) {
    const manifest = await registeredManifest();
    for (const contribution of manifest.navigationContributions) {
      registry.registerAppNavContribution(structuredClone(contribution), manifest.id);
    }
  }
  return (registry.getApp('setup')?.navigation ?? []) as NavItem[];
}

const groupChildren = (nav: NavItem[], group: string): NavItem[] =>
  nav.find((n) => n.id === group)?.children ?? [];

describe('SecurityPlugin — Setup People & Organization assignment entries (ADR-0146 D7)', () => {
  it('contributes both entries into group_people_org, naming the two component refs, and it parses', async () => {
    const manifest = await registeredManifest();
    const contributions = manifest.navigationContributions as Contribution[];
    const peopleOrg = contributions.filter((c) => c.app === 'setup' && c.group === 'group_people_org');
    expect(peopleOrg).toHaveLength(1);
    expect(peopleOrg[0].items).toEqual([
      expect.objectContaining(POSITION_HOLDERS),
      expect.objectContaining(PERMISSION_SET_ASSIGNMENT),
    ]);
    // Registry KEYS, never console paths.
    for (const item of peopleOrg[0].items) {
      expect(item.componentRef).toMatch(/^[a-z0-9_-]+:[a-z0-9_-]+$/);
    }
    for (const contribution of contributions) {
      expect(() => NavigationContributionSchema.parse(contribution)).not.toThrow();
    }
  });

  it('carries no gate of its own, and the catalog entries are gone (ADR-0146 D1)', async () => {
    const manifest = await registeredManifest();
    const contributions = manifest.navigationContributions as Contribution[];
    const items = contributions.flatMap((c) => c.items);
    const byId = new Map(items.map((i) => [i.id, i]));
    // Setup carries no metadata catalog: positions, capabilities and permission
    // sets are Studio's "All metadata" area's, so this plugin contributes no
    // entry into Access Control.
    for (const id of ['nav_positions', 'nav_capabilities', 'nav_permission_sets']) {
      expect(byId.has(id), id).toBe(false);
    }
    expect(contributions.filter((c) => c.group === 'group_access_control')).toEqual([]);
    for (const id of [POSITION_HOLDERS.id, PERMISSION_SET_ASSIGNMENT.id]) {
      const entry = byId.get(id);
      expect(entry, id).toBeDefined();
      expect(Object.values(gateOf(entry!)).filter((v) => v !== undefined), id).toEqual([]);
    }
  });

  it('the rendered Setup nav serves both under People & Organization, beside the base entries', async () => {
    const nav = await renderedSetup(true);
    const children = groupChildren(nav, 'group_people_org');
    // Control: platform-objects' base entries fold into the same group.
    expect(children.map((i) => i.id)).toContain('nav_users');
    expect(children.find((i) => i.id === POSITION_HOLDERS.id)).toMatchObject(POSITION_HOLDERS);
    expect(children.find((i) => i.id === PERMISSION_SET_ASSIGNMENT.id)).toMatchObject(PERMISSION_SET_ASSIGNMENT);
    // The group anchor they land in is ungated, like Access Control's.
    const anchor = nav.find((n) => n.id === 'group_people_org');
    const accessControl = nav.find((n) => n.id === 'group_access_control');
    expect(anchor?.requiredPermissions ?? []).toEqual(accessControl?.requiredPermissions ?? []);
    // Both entries open in exactly one place.
    const all = nav.flatMap((n) => n.children ?? []);
    expect(all.filter((i) => i.componentRef === POSITION_HOLDERS.componentRef)).toHaveLength(1);
    expect(all.filter((i) => i.componentRef === PERMISSION_SET_ASSIGNMENT.componentRef)).toHaveLength(1);
  });

  it('without this plugin, neither entry appears', async () => {
    const nav = await renderedSetup(false);
    const ids = nav.flatMap((n) => n.children ?? []).map((i) => i.id);
    // Control: the fold still serves platform-objects' entries.
    expect(ids).toContain('nav_users');
    expect(ids).not.toContain(POSITION_HOLDERS.id);
    expect(ids).not.toContain(PERMISSION_SET_ASSIGNMENT.id);
  });
});

// The labels. Setup's nav labels — this plugin's catalog entries included —
// live in `@objectstack/platform-objects`' hand-authored Setup bundles
// (`apps.setup.navigation.<id>.label`); this plugin's own bundle carries no
// `apps` section. So the population is every locale of the SERVED Setup bundle
// that carries the People & Organization group, and the ids are read off this
// plugin's manifest, not retyped. Served, not raw: a translation whose recorded
// source digest no longer matches is served as the English source
// (`withSourceFallback`), and that is what an administrator reads.
describe('SecurityPlugin — People & Organization assignment entries are labelled in every Setup locale', () => {
  it('each locale carrying group_people_org labels both entries; translated locales do not serve the English', async () => {
    const manifest = await registeredManifest();
    const ids = (manifest.navigationContributions as Contribution[])
      .filter((c) => c.app === 'setup' && c.group === 'group_people_org')
      .flatMap((c) => c.items.map((i) => i.id!));
    expect(ids).toEqual([POSITION_HOLDERS.id, PERMISSION_SET_ASSIGNMENT.id]);

    const navOf = (locale: string) =>
      ((SetupAppTranslations as any)[locale]?.apps?.setup?.navigation ?? {}) as Record<string, { label?: string }>;
    const locales = Object.keys(SetupAppTranslations).filter((l) => navOf(l).group_people_org?.label);
    // Control: the four Setup locales carry the group, so the loop below judges something.
    expect(locales.sort()).toEqual(['en', 'es-ES', 'ja-JP', 'zh-CN']);

    const en = navOf('en');
    expect(en[POSITION_HOLDERS.id]?.label).toBe(POSITION_HOLDERS.label);
    expect(en[PERMISSION_SET_ASSIGNMENT.id]?.label).toBe(PERMISSION_SET_ASSIGNMENT.label);
    for (const locale of locales.filter((l) => l !== 'en')) {
      const nav = navOf(locale);
      for (const id of ids) {
        expect(nav[id]?.label, `${locale} ${id}`).toBeTruthy();
        expect(nav[id]?.label, `${locale} ${id} serves the English source`).not.toBe(en[id]?.label);
      }
    }
  });
});
