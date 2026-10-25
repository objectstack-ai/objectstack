// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12688 — the Interfaces rail's display text, paired from the
 * server's localized `/meta` app and the published layer it translated.
 *
 * The fixtures are the showcase's shape: the published layer is the authored
 * English document `/layers` serves, and the served row is what
 * `/meta/app?package=…` answers on a zh-CN request (`translateApp` rewrites
 * each node's `label` by its `id`, and the app's own `label`). Both documents
 * parse against the spec's `AppSchema`, so every case is an input the rail
 * receives.
 */

import { describe, expect, it } from 'vitest';
import { AppSchema } from '@objectstack/spec/ui';
import { displayAppLabel, displayNavTree, servedNavTextOf } from './servedNavText';
import type { NavNode } from './navSurface';

const PUBLISHED = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [
    { id: 'nav_capability_map', type: 'page', label: 'Capability Map', pageName: 'capability_map' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: 'Workspace',
      children: [{ id: 'nav_my_work', type: 'page', label: 'My Work', pageName: 'my_work' }],
    },
    // Label-less: the runtime names it by its target, unless the server serves a label.
    { id: 'nav_tasks', type: 'object', objectName: 'showcase_task' },
    { id: 'nav_settings', type: 'object', objectName: 'showcase_setting' },
  ],
};

const SERVED_ZH = {
  name: 'showcase_app',
  label: '功能展示',
  navigation: [
    { id: 'nav_capability_map', type: 'page', label: '能力地图', pageName: 'capability_map' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: '工作区',
      children: [{ id: 'nav_my_work', type: 'page', label: '我的工作', pageName: 'my_work' }],
    },
    // The bundle names this label-less entry; the other one it leaves label-less.
    { id: 'nav_tasks', type: 'object', label: '任务', objectName: 'showcase_task' },
    { id: 'nav_settings', type: 'object', objectName: 'showcase_setting' },
  ],
};

/** The labels of a tree, flattened in tree order, `undefined` kept. */
function labels(nodes: NavNode[]): unknown[] {
  return nodes.flatMap((n) => [n.label, ...labels(n.children ?? [])]);
}

describe('the objectui#12688 fixture is what the spec accepts', () => {
  it('the published layer and the served row both parse against AppSchema', () => {
    expect(AppSchema.safeParse(PUBLISHED).success).toBe(true);
    expect(AppSchema.safeParse(SERVED_ZH).success).toBe(true);
  });
});

describe('displayNavTree — the rail draws the served label of an unchanged entry (objectui#12688)', () => {
  const served = servedNavTextOf(PUBLISHED, SERVED_ZH);

  it('an entry whose label is the published one, at any depth, draws the served label', () => {
    expect(labels(displayNavTree(PUBLISHED.navigation as NavNode[], served))).toEqual([
      '能力地图',
      '工作区',
      '我的工作',
      '任务',
      undefined,
    ]);
  });

  it('a label-less entry the server serves no label for keeps inheriting', () => {
    const tree = displayNavTree(PUBLISHED.navigation as NavNode[], served);
    expect(tree[3]).toBe(PUBLISHED.navigation[3]);
    expect('label' in tree[3]).toBe(false);
  });

  it('an entry changed in the draft, and one added there, draw their authored text', () => {
    const draft: NavNode[] = [
      { ...PUBLISHED.navigation[0], label: 'Capability Atlas' },
      PUBLISHED.navigation[1] as NavNode,
      { id: 'nav_release_notes', type: 'page', label: 'Release Notes', pageName: 'release_notes' },
      // An authored label written over an entry that inherited.
      { ...PUBLISHED.navigation[2], label: 'All Tasks' },
    ];
    expect(labels(displayNavTree(draft, served))).toEqual(['Capability Atlas', '工作区', '我的工作', 'Release Notes', 'All Tasks']);
  });

  it('a locale map is the same authored label as an equal map, whatever its key order', () => {
    const published = { ...PUBLISHED, navigation: [{ ...PUBLISHED.navigation[0], label: { en: 'Map', fr: 'Carte' } }] };
    const servedRow = { ...SERVED_ZH, navigation: [{ ...SERVED_ZH.navigation[0], label: '地图' }] };
    const text = servedNavTextOf(published, servedRow);
    const reordered = [{ ...PUBLISHED.navigation[0], label: { fr: 'Carte', en: 'Map' } }] as NavNode[];
    const edited = [{ ...PUBLISHED.navigation[0], label: { en: 'Map', fr: 'Plan' } }] as NavNode[];
    expect(displayNavTree(reordered, text)[0].label).toBe('地图');
    expect(displayNavTree(edited, text)[0].label).toEqual({ en: 'Map', fr: 'Plan' });
  });

  it('every key but the label is kept, and the buffer is never modified', () => {
    const before = JSON.stringify(PUBLISHED.navigation);
    const [first] = displayNavTree(PUBLISHED.navigation as NavNode[], served);
    expect(first).toEqual({ ...PUBLISHED.navigation[0], label: '能力地图' });
    expect(JSON.stringify(PUBLISHED.navigation)).toBe(before);
  });
});

describe('servedNavTextOf — what counts as a served counterpart (objectui#12688)', () => {
  it('no served text without both documents, or for two different apps', () => {
    expect(servedNavTextOf(null, SERVED_ZH)).toBeNull();
    expect(servedNavTextOf(PUBLISHED, null)).toBeNull();
    // `/layers` answering 404 leaves the pillar an empty document.
    expect(servedNavTextOf({}, SERVED_ZH)).toBeNull();
    expect(servedNavTextOf(PUBLISHED, { ...SERVED_ZH, name: 'other_app' })).toBeNull();
  });

  it('the app list row as the console used to read it (no navigation) changes nothing', () => {
    const served = servedNavTextOf(PUBLISHED, { name: 'showcase_app', label: 'Showcase' });
    const tree = PUBLISHED.navigation as NavNode[];
    expect(displayNavTree(tree, served)).toBe(tree);
  });
});

describe('displayAppLabel — the rail heading (objectui#12688)', () => {
  const served = servedNavTextOf(PUBLISHED, SERVED_ZH);

  it('the published app label draws the served one; an edited one draws as authored', () => {
    expect(displayAppLabel('Showcase', served)).toBe('功能展示');
    expect(displayAppLabel('Showcase Studio', served)).toBe('Showcase Studio');
    expect(displayAppLabel('Showcase', null)).toBe('Showcase');
  });

  it("a label-less app is compared by its name, as the heading falls back to it", () => {
    const published = { ...PUBLISHED, label: undefined };
    expect(displayAppLabel('showcase_app', servedNavTextOf(published, SERVED_ZH))).toBe('功能展示');
  });
});
