// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36899 — Studio's left menu as data (ADR-0084, amended): six
 * groups in the amendment's order, a type in the group of its served domain,
 * the four entries that open no type's list in the groups of what they hold,
 * and the entry each Studio page marks current.
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MENU_GROUPS,
  buildStudioMenu,
  studioMenuCurrentKey,
  studioMenuEntryMatches,
  studioMenuScope,
} from './studioMenuModel';
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
    expect(entry('orgFlows').to).toBe('/studio/~org/automations');
    expect(entry('diagnostics').to).toBe(`/studio/${PKG}/metadata/_diagnostics`);
    expect(entry('owd').to).toBe(`/studio/${PKG}/access?surface=owd%3Aoverview`);
    expect(entry('environment').to).toBe('/studio/~all/metadata');
  });

  it('a package draws all six groups, an empty one included', () => {
    const menu = buildStudioMenu({ scope: studioMenuScope(PKG), types: [], counts: {} });
    expect(menu.map((g) => g.group)).toEqual(STUDIO_MENU_GROUPS);
    expect(keysOf(menu).data).toEqual([]);
  });

  it.each(['~org', '~all'])('%s: the environment\'s menu, only the groups that hold an entry', (segment) => {
    const types = [
      { type: 'position', domain: 'security' },
      { type: 'permission', domain: 'security' },
    ];
    const menu = buildStudioMenu({ scope: studioMenuScope(segment), types, counts: {} });
    expect(keysOf(menu)).toEqual({
      automation: ['orgFlows'],
      security: ['type:position', 'type:permission', 'environment'],
    });
    expect(menu.flatMap((g) => g.entries).find((e) => e.key === 'type:position')!.to).toBe(
      '/studio/~all/metadata/position?scope=environment',
    );
  });
});

describe('the current entry (aria-current)', () => {
  const current = (segment: string, path: string) => {
    const [pathname, query = ''] = path.split('?');
    return studioMenuCurrentKey({ segment, pathname, search: query ? `?${query}` : '' });
  };

  it('an area page is its type, diagnostics, or nothing at the directory', () => {
    expect(current(PKG, `/studio/${PKG}/metadata/view`)).toBe('type:view');
    expect(current(PKG, `/studio/${PKG}/metadata/view/v1/history`)).toBe('type:view');
    expect(current(PKG, `/studio/${PKG}/metadata/_diagnostics`)).toBe('diagnostics');
    expect(current(PKG, `/studio/${PKG}/metadata`)).toBeNull();
  });

  it('a pillar page is the type it designs; the Access pillar on its OWD overview is that entry', () => {
    // objectstack#36904 — the object designer is an area page: its type.
    expect(current(PKG, `/studio/${PKG}/metadata/object/account`)).toBe('type:object');
    expect(current(PKG, `/studio/${PKG}/automations`)).toBe('type:flow');
    expect(current(PKG, `/studio/${PKG}/access?surface=permission:admin`)).toBe('type:permission');
    expect(current(PKG, `/studio/${PKG}/access?surface=owd:overview`)).toBe('owd');
    expect(current(PKG, `/studio/${PKG}/bogus`)).toBeNull();
  });

  it('the package-less scope is its flows; the cross-package leg\'s root is the environment catalog', () => {
    expect(current('~org', '/studio/~org/automations')).toBe('orgFlows');
    expect(current('~all', '/studio/~all/metadata')).toBe('environment');
    expect(current('~all', '/studio/~all/metadata/position')).toBe('type:position');
  });
});

describe('the menu search', () => {
  const entry = { key: 'type:permission', kind: 'type' as const, type: 'permission', to: '/' };
  it('matches the label or the machine name, case-insensitive; an empty query matches all', () => {
    expect(studioMenuEntryMatches(entry, 'Permission Sets', 'sets')).toBe(true);
    expect(studioMenuEntryMatches(entry, '权限集', 'PERMISSION')).toBe(true);
    expect(studioMenuEntryMatches(entry, 'Permission Sets', 'flow')).toBe(false);
    expect(studioMenuEntryMatches(entry, 'Permission Sets', '  ')).toBe(true);
  });
});

describe('the group names: the menu\'s own, the shared dictionary unchanged', () => {
  it('the menu names `system` Platform / 平台 and `security` Access / 访问; the other four as the dictionary does', () => {
    expect(STUDIO_MENU_GROUPS.map((g) => studioMenuGroupLabel(g, 'en'))).toEqual(['Data', 'UI', 'Automation', 'Platform', 'Access', 'AI']);
    expect(STUDIO_MENU_GROUPS.map((g) => studioMenuGroupLabel(g, 'zh-CN'))).toEqual(['数据', '界面', '自动化', '平台', '访问', 'AI']);
  });

  it('the shared dictionary keeps System / 系统 and Security / 安全 (Setup\'s datasource pages read it, `PageShell`\'s badge)', () => {
    expect(translateMetadataDomain('system', 'en')).toBe('System');
    expect(translateMetadataDomain('system', 'zh-CN')).toBe('系统');
    expect(translateMetadataDomain('security', 'en')).toBe('Security');
    expect(translateMetadataDomain('security', 'zh-CN')).toBe('安全');
  });
});
