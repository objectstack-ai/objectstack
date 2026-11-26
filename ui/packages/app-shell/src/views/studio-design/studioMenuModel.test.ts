// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36899 — Studio's left menu as data (ADR-0084, amended): six
 * groups in the amendment's order, a type in the group of its served domain,
 * the four entries that open no type's list in the groups of what they hold,
 * and the entry each Studio page marks current.
 *
 * objectstack#37201 — the menu reads the placement table (ADR-0084, amended
 * 2026-11-25): each group's entries in the table's order, each stamped with
 * its tier, the four entries that are not a type in 高级, a 常用 type the
 * settled sweep counts none of marked empty, and the 常用 types always listed.
 *
 * objectstack#37360 — 全部类型 All types (ADR-0084, amended 2026-11-25): a
 * package's entry under no group, opening the area's type directory, which is
 * now its current entry; CONTROL: the fold's rule still leaves out a 高级 type
 * the package holds none of.
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MENU_ADVANCED_COOKIE,
  STUDIO_MENU_ALWAYS_TYPES,
  STUDIO_MENU_GROUPS,
  buildStudioMenu,
  readStudioMenuAdvancedCookie,
  studioMenuAllTypesEntry,
  studioMenuCurrentKey,
  studioMenuEntryMatches,
  studioMenuScope,
  studioMenuTiers,
} from './studioMenuModel';
import { STUDIO_MENU_PLACEMENT } from './studioMenuPlacement';
import { studioMenuGroupLabel } from './studioMenuGroupLabel';
import { translateMetadataDomain } from '../metadata-admin/i18n';
// The zh rows of the menu's own names live in `@object-ui/i18n`'s lazily loaded `studio` namespace.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const PKG = 'com.example.crm';
const TYPES = [
  { type: 'object', domain: 'data' },
  { type: 'view', domain: 'ui' },
  { type: 'flow', domain: 'automation' },
  { type: 'datasource', domain: 'system' },
  { type: 'permission', domain: 'security' },
  { type: 'agent', domain: 'ai' },
  { type: 'legacy', domain: 'identity' },
];

const keysOf = (menu: ReturnType<typeof buildStudioMenu>) =>
  Object.fromEntries(menu.map((g) => [g.group, g.entries.map((e) => e.key)]));

describe('the menu groups (objectstack#36899, ADR-0084 amended)', () => {
  it('are the six registered domains, in the amendment\'s order', () => {
    expect(STUDIO_MENU_GROUPS).toEqual(['data', 'ui', 'automation', 'system', 'security', 'ai']);
  });

  it('a package: every type in its domain\'s group, and the four entries that are not a type', () => {
    const menu = buildStudioMenu({ scope: studioMenuScope(PKG), types: TYPES, counts: { object: 4 } });
    expect(keysOf(menu)).toEqual({
      data: ['type:object'],
      ui: ['type:view'],
      automation: ['type:flow', 'orgFlows'],
      system: ['type:datasource', 'diagnostics'],
      security: ['type:permission', 'owd', 'environment'],
      ai: ['type:agent'],
    });
    const entry = (key: string) => menu.flatMap((g) => g.entries).find((e) => e.key === key)!;
    expect(entry('type:object')).toMatchObject({ to: `/studio/${PKG}/metadata/object?package=${PKG}`, count: 4 });
    expect(entry('type:view').count).toBeUndefined();
    // ADR-0146 D1 — runtime configuration is Setup's.
    expect(entry('type:datasource').to).toBe('/apps/setup/metadata/datasource');
    expect(entry('orgFlows').to).toBe('/studio/~org/metadata/flow?source=runtime');
    expect(entry('diagnostics').to).toBe(`/studio/${PKG}/metadata/_diagnostics`);
    // objectstack#36905 — the overview's own route.
    expect(entry('owd').to).toBe(`/studio/${PKG}/owd`);
    expect(entry('environment').to).toBe('/studio/~all/metadata');
  });

  // objectstack#37201 — rewritten on purpose: a group is drawn only where it holds an entry
  // (ADR-0084, amended 2026-11-25, §3.3). It was "a package draws all six groups, an empty one included".
  it('a package draws a group only where it holds an entry: with no type served, the groups of the entries that are not a type', () => {
    const menu = buildStudioMenu({ scope: studioMenuScope(PKG), types: [], counts: {} });
    expect(keysOf(menu)).toEqual({
      automation: ['orgFlows'],
      system: ['diagnostics'],
      security: ['owd', 'environment'],
    });
  });

  it.each(['~org', '~all'])('%s: the environment\'s menu, only the groups that hold an entry', (segment) => {
    const types = [
      { type: 'position', domain: 'security' },
      { type: 'permission', domain: 'security' },
    ];
    const menu = buildStudioMenu({ scope: studioMenuScope(segment), types, counts: {} });
    // objectstack#37201 — the table's order, not the served one: permission set, then position.
    expect(keysOf(menu)).toEqual({
      automation: ['orgFlows'],
      security: ['type:permission', 'type:position', 'environment'],
    });
    expect(menu.flatMap((g) => g.entries).find((e) => e.key === 'type:position')!.to).toBe(
      '/studio/~all/metadata/position?scope=environment',
    );
  });
});

/** A package's served types in the server's order: by domain, then alphabetically by type. */
const SERVED = [
  { type: 'dataset', domain: 'data' },
  { type: 'hook', domain: 'data' },
  { type: 'mapping', domain: 'data' },
  { type: 'object', domain: 'data' },
  { type: 'picklist', domain: 'data' },
  { type: 'zz_unplaced', domain: 'data' },
  { type: 'action', domain: 'ui' },
  { type: 'app', domain: 'ui' },
  { type: 'dashboard', domain: 'ui' },
  { type: 'page', domain: 'ui' },
  { type: 'report', domain: 'ui' },
  { type: 'view', domain: 'ui' },
  { type: 'flow', domain: 'automation' },
  { type: 'job', domain: 'automation' },
  { type: 'book', domain: 'system' },
  { type: 'doc', domain: 'system' },
  { type: 'email_template', domain: 'system' },
  { type: 'assignment_rule', domain: 'security' },
  { type: 'permission', domain: 'security' },
  { type: 'position', domain: 'security' },
  { type: 'agent', domain: 'ai' },
  { type: 'skill', domain: 'ai' },
  { type: 'tool', domain: 'ai' },
];

describe('the menu reads the placement table (objectstack#37201, ADR-0084 amended 2026-11-25)', () => {
  const menu = buildStudioMenu({ scope: studioMenuScope(PKG), types: SERVED, counts: {} });
  const entries = menu.flatMap((g) => g.entries);

  it("orders each group by the table, an unplaced type after the placed ones, then the entries that are not a type", () => {
    expect(keysOf(menu)).toEqual({
      data: ['type:object', 'type:dataset', 'type:picklist', 'type:hook', 'type:mapping', 'type:zz_unplaced'],
      ui: ['type:app', 'type:page', 'type:dashboard', 'type:report', 'type:view', 'type:action'],
      automation: ['type:flow', 'type:job', 'orgFlows'],
      system: ['type:doc', 'type:book', 'type:email_template', 'diagnostics'],
      security: ['type:permission', 'type:position', 'type:assignment_rule', 'owd', 'environment'],
      ai: ['type:agent', 'type:tool', 'type:skill'],
    });
  });

  it("stamps each type with its row's tier, and 高级 on a type with no row", () => {
    const tierOf = new Map(STUDIO_MENU_PLACEMENT.map((row) => [row.type, row.tier]));
    for (const e of entries.filter((x) => x.kind === 'type')) {
      expect(e.tier, e.key).toBe(e.type === 'zz_unplaced' ? 'advanced' : tierOf.get(e.type!));
    }
    expect(entries.find((e) => e.key === 'type:object')!.tier).toBe('common');
    expect(entries.find((e) => e.key === 'type:picklist')!.tier).toBe('advanced');
    // objectstack#37564 — placed by name (ADR-0084, amended 2026-11-26).
    expect(entries.find((e) => e.key === 'type:dataset')!.tier).toBe('common');
    expect(entries.find((e) => e.key === 'type:position')!.tier).toBe('common');
  });

  it('the four entries that are not a type are 高级 on a package', () => {
    for (const key of ['orgFlows', 'diagnostics', 'owd', 'environment']) {
      expect(entries.find((e) => e.key === key)!.tier, key).toBe('advanced');
    }
  });

  it('splits into the 常用 groups and the 高级 fold, a group in a tier only where it holds an entry of that tier', () => {
    const tiers = studioMenuTiers(menu);
    expect(Object.fromEntries(tiers.common.map((g) => [g.group, g.entries.map((e) => e.key)]))).toEqual({
      // objectstack#37564 — dataset directly after object, position directly after permission set, both above the fold.
      data: ['type:object', 'type:dataset'],
      ui: ['type:app', 'type:page', 'type:dashboard', 'type:report'],
      automation: ['type:flow'],
      security: ['type:permission', 'type:position'],
      ai: ['type:agent', 'type:tool', 'type:skill'],
    });
    // 平台 Platform holds no 常用 entry: its label is drawn inside the fold alone; AI holds no 高级 one here.
    expect(tiers.common.map((g) => g.group)).not.toContain('system');
    expect(tiers.advanced.map((g) => g.group)).toEqual(['data', 'ui', 'automation', 'system', 'security']);
    expect(tiers.advanced.find((g) => g.group === 'security')!.entries.map((e) => e.key)).toEqual([
      'type:assignment_rule',
      'owd',
      'environment',
    ]);
  });

  it('keeps every address and entry key: only the order and the tier are new', () => {
    for (const e of entries.filter((x) => x.kind === 'type' && x.type !== 'datasource')) {
      expect(e.key).toBe(`type:${e.type}`);
      expect(e.to).toBe(`/studio/${PKG}/metadata/${e.type}?package=${PKG}`);
    }
  });
});

describe('the 常用 types are always listed on a package (objectstack#37201)', () => {
  it('the list the directory rule keeps regardless of the sweep is the table\'s 常用 rows, in order', () => {
    expect(STUDIO_MENU_ALWAYS_TYPES).toEqual(STUDIO_MENU_PLACEMENT.filter((r) => r.tier === 'common').map((r) => r.type));
    expect(STUDIO_MENU_ALWAYS_TYPES).toEqual([
      'object', 'dataset',
      'app', 'page', 'dashboard', 'report',
      'flow',
      'permission', 'position',
      'agent', 'tool', 'skill',
    ]);
  });

  it("a new package's directory rule lists them though the sweep has none of them", async () => {
    const { scopeDirectoryEntries } = await import('../metadata-admin/directoryScope');
    const listed = scopeDirectoryEntries(SERVED, {
      environment: false,
      packageId: PKG,
      packagesByType: {},
      always: STUDIO_MENU_ALWAYS_TYPES,
    }).map((e) => e.type);
    expect(listed.sort()).toEqual([
      'agent', 'app', 'dashboard', 'dataset', 'flow', 'object', 'page', 'permission', 'position', 'report', 'skill', 'tool',
    ]);
  });
});

describe('an empty 常用 type means the sweep answered none, not "not answered yet" (objectstack#37201)', () => {
  const types = [
    { type: 'object', domain: 'data' },
    { type: 'app', domain: 'ui' },
    { type: 'hook', domain: 'data' },
  ];
  const empty = (opts: { settled?: boolean; counts?: Record<string, number>; segment?: string }) =>
    buildStudioMenu({ scope: studioMenuScope(opts.segment ?? PKG), types, counts: opts.counts ?? {}, settled: opts.settled })
      .flatMap((g) => g.entries)
      .filter((e) => e.empty)
      .map((e) => e.key);

  it('settled: a 常用 type with no count, or a count of 0, is empty; one with items is not', () => {
    expect(empty({ settled: true, counts: { object: 2, app: 0 } })).toEqual(['type:app']);
    expect(empty({ settled: true, counts: {} })).toEqual(['type:object', 'type:app']);
  });

  it('not settled: nothing is empty', () => {
    expect(empty({ settled: false, counts: {} })).toEqual([]);
    expect(empty({ counts: {} })).toEqual([]);
  });

  it('a 高级 type is never marked empty, nor anything on ~org or ~all', () => {
    expect(empty({ settled: true })).not.toContain('type:hook');
    expect(empty({ settled: true, segment: '~all' })).toEqual([]);
    expect(empty({ settled: true, segment: '~org' })).toEqual([]);
  });
});

describe('the 高级 fold\'s cookie (objectstack#37201)', () => {
  it('is its own name, apart from the menu\'s collapse cookie', () => {
    expect(STUDIO_MENU_ADVANCED_COOKIE).toBe('studio_menu_advanced');
  });

  it('reads open only from the literal the menu writes; closed by default', () => {
    expect(readStudioMenuAdvancedCookie('')).toBe(false);
    expect(readStudioMenuAdvancedCookie('studio_menu_state=true')).toBe(false);
    expect(readStudioMenuAdvancedCookie('a=1; studio_menu_advanced=true')).toBe(true);
    expect(readStudioMenuAdvancedCookie('studio_menu_advanced=false')).toBe(false);
    expect(readStudioMenuAdvancedCookie('studio_menu_advanced=1')).toBe(false);
    expect(readStudioMenuAdvancedCookie('xstudio_menu_advanced=true')).toBe(false);
  });
});

describe('the current entry (aria-current)', () => {
  const current = (segment: string, path: string) => {
    const [pathname, query = ''] = path.split('?');
    return studioMenuCurrentKey({ segment, pathname, search: query ? `?${query}` : '' });
  };

  // objectstack#37360 — rewritten on purpose: the directory is now an entry's page, 全部类型 All types.
  // It was "an area page is its type, diagnostics, or nothing at the directory".
  it('an area page is its type, diagnostics, or at the directory 全部类型 All types', () => {
    expect(current(PKG, `/studio/${PKG}/metadata/view`)).toBe('type:view');
    expect(current(PKG, `/studio/${PKG}/metadata/view/v1/history`)).toBe('type:view');
    expect(current(PKG, `/studio/${PKG}/metadata/_diagnostics`)).toBe('diagnostics');
    expect(current(PKG, `/studio/${PKG}/metadata`)).toBe('allTypes');
  });

  it('a pillar page is the type it designs; the OWD overview\'s route is that entry', () => {
    // objectstack#36904, objectstack#36903 — the object and flow designers are area pages: their type.
    expect(current(PKG, `/studio/${PKG}/metadata/object/account`)).toBe('type:object');
    expect(current(PKG, `/studio/${PKG}/metadata/flow/notify`)).toBe('type:flow');
    // objectstack#36905 — a permission set and the overview have left the Access pillar.
    expect(current(PKG, `/studio/${PKG}/metadata/permission/admin`)).toBe('type:permission');
    expect(current(PKG, `/studio/${PKG}/owd`)).toBe('owd');
    expect(current(PKG, `/studio/${PKG}/owd?object=account`)).toBe('owd');
    expect(current(PKG, `/studio/${PKG}/access?surface=owd:overview`)).toBeNull();
    expect(current(PKG, `/studio/${PKG}/bogus`)).toBeNull();
  });

  it('the package-less scope is its flows; the cross-package leg\'s root is the environment catalog', () => {
    expect(current('~org', '/studio/~org/metadata/flow')).toBe('orgFlows');
    expect(current('~org', '/studio/~org/metadata/flow/f')).toBe('orgFlows');
    expect(current('~all', '/studio/~all/metadata')).toBe('environment');
    expect(current('~all', '/studio/~all/metadata/position')).toBe('type:position');
  });
});

describe('the menu search', () => {
  const entry = { key: 'type:permission', kind: 'type' as const, type: 'permission', to: '/', tier: 'common' as const };
  it('matches the label or the machine name, case-insensitive; an empty query matches all', () => {
    expect(studioMenuEntryMatches(entry, 'Permission Sets', 'sets')).toBe(true);
    expect(studioMenuEntryMatches(entry, '权限集', 'PERMISSION')).toBe(true);
    expect(studioMenuEntryMatches(entry, 'Permission Sets', 'flow')).toBe(false);
    expect(studioMenuEntryMatches(entry, 'Permission Sets', '  ')).toBe(true);
  });
});

describe('the group names: one dictionary for the menu and the directory (ADR-0084, amended)', () => {
  it('the menu names `system` Platform / 平台 and `security` Access / 访问', () => {
    expect(STUDIO_MENU_GROUPS.map((g) => studioMenuGroupLabel(g, 'en'))).toEqual(['Data', 'UI', 'Automation', 'Platform', 'Access', 'AI']);
    expect(STUDIO_MENU_GROUPS.map((g) => studioMenuGroupLabel(g, 'zh-CN'))).toEqual(['数据', '界面', '自动化', '平台', '访问', 'AI']);
  });

  it('the menu draws each group with the shared dictionary\'s word, in en and zh-CN', () => {
    for (const locale of ['en', 'zh-CN']) {
      for (const g of STUDIO_MENU_GROUPS) {
        expect(studioMenuGroupLabel(g, locale), `${g} in ${locale}`).toBe(translateMetadataDomain(g, locale));
      }
    }
  });
});

describe('全部类型 All types: the 高级 fold\'s last row, under no group (objectstack#37360, ADR-0084 amended 2026-11-25)', () => {
  it('a package has it: it opens the area\'s type directory, and it is 高级', () => {
    expect(studioMenuAllTypesEntry(studioMenuScope(PKG))).toEqual({
      key: 'allTypes',
      kind: 'allTypes',
      to: `/studio/${PKG}/metadata`,
      tier: 'advanced',
    });
  });

  it('~org and ~all, which draw no fold, have none', () => {
    expect(studioMenuAllTypesEntry(studioMenuScope('~org'))).toBeNull();
    expect(studioMenuAllTypesEntry(studioMenuScope('~all'))).toBeNull();
  });

  it('it sits under no group: no group of the menu or of either tier holds it', () => {
    const menu = buildStudioMenu({ scope: studioMenuScope(PKG), types: SERVED, counts: {} });
    const keys = menu.flatMap((g) => g.entries.map((e) => e.key));
    expect(keys).not.toContain('allTypes');
    const tiers = studioMenuTiers(menu);
    expect([...tiers.common, ...tiers.advanced].flatMap((g) => g.entries.map((e) => e.key))).not.toContain('allTypes');
  });

  it('CONTROL: the fold\'s rule does not change — a 高级 type the package holds none of is still left out', async () => {
    const { scopeDirectoryEntries } = await import('../metadata-admin/directoryScope');
    // The package holds a hook and nothing else of 高级; email_template and doc are served, held by none.
    const listed = scopeDirectoryEntries(SERVED, {
      environment: false,
      packageId: PKG,
      packagesByType: { hook: [PKG], email_template: ['com.other.pkg'] },
      always: STUDIO_MENU_ALWAYS_TYPES,
    });
    const advanced = studioMenuTiers(buildStudioMenu({ scope: studioMenuScope(PKG), types: listed, counts: { hook: 2 } })).advanced;
    const keys = advanced.flatMap((g) => g.entries.map((e) => e.key));
    expect(keys).toContain('type:hook');
    expect(keys).not.toContain('type:email_template');
    expect(keys).not.toContain('type:doc');
  });
});
