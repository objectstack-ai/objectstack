// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36748 — a new object joins the menu of its package's one app,
 * through the design mode's menu save (`saveAppMenu`): the stored menu plus one
 * object entry, a draft under the first-write pin, then that app's publish.
 * With no app, several apps, or an entry already opening the object, nothing
 * is written; a refused save is answered, never thrown.
 */

import { describe, expect, it, vi } from 'vitest';
import { addNewObjectToAppMenu, objectMenuEntry } from './newObjectJoinsAppMenu';
import type { AppMenuSaveDoors, AppMenuSaveTexts } from '../../layout/designModeMenuSave';

vi.mock('../../assistant/assistantBus.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh: vi.fn(),
}));

const PKG = 'com.example.visits';
const TEXTS: AppMenuSaveTexts = {
  notListed: 'not listed',
  pendingDraft: 'pending draft',
  noVersion: 'no version',
  notWritable: 'not writable',
};

function fixture({
  apps = [{ name: 'visits', label: 'Visits' }] as Array<Record<string, unknown>>,
  stored = [] as unknown[],
  save = vi.fn(async () => ({})),
} = {}) {
  const calls: string[] = [];
  const client = {
    list: vi.fn(async () => apps),
    layered: vi.fn(async () => ({ effective: { name: 'visits', label: 'Visits', navigation: stored }, code: null })),
    save: vi.fn(async (type: string, name: string, body: unknown, options: Record<string, unknown>) => {
      calls.push(`save ${type} ${name} ${String(options.mode)} ${String(options.packageId)}`);
      return save(type, name, body, options);
    }),
    publish: vi.fn(async (type: string, name: string, options: { packageId?: string }) => {
      calls.push(`publish ${type} ${name} ${String(options.packageId)}`);
      return {};
    }),
    reset: vi.fn(async () => ({})),
  };
  const doors: AppMenuSaveDoors = {
    listPackages: async () => new Map([[PKG, { manifest: { id: PKG, version: '0.1.0' }, writable: true }]]) as never,
    ensureCustomization: async () => {
      throw new Error('no pair in this fixture');
    },
    client,
  };
  return { client, doors, calls };
}

const savedNavigation = (client: ReturnType<typeof fixture>['client']) =>
  (client.save.mock.calls.at(-1)?.[2] as { navigation?: unknown[] } | undefined)?.navigation;

describe('a new object joins its package’s one app menu (objectstack#36748)', () => {
  it('appends an object entry to the stored menu, saves it as a draft and publishes the app', async () => {
    const { client, doors, calls } = fixture({
      stored: [{ id: 'nav_home', type: 'dashboard', dashboardName: 'home' }],
    });
    const join = await addNewObjectToAppMenu(client, { packageId: PKG, objectName: 'visits_visit' }, TEXTS, doors);
    expect(join).toEqual({ kind: 'added', app: { name: 'visits', label: 'Visits' } });
    expect(calls).toEqual([`save app visits draft ${PKG}`, `publish app visits ${PKG}`]);
    expect(client.save.mock.calls[0][3]).toMatchObject({ ifNoneMatch: '*' });
    expect(savedNavigation(client)).toEqual([
      { id: 'nav_home', type: 'dashboard', dashboardName: 'home' },
      // No `label`: the entry shows the object's current label.
      { id: 'nav_visits_visit', type: 'object', objectName: 'visits_visit' },
    ]);
  });

  it('an empty menu gets its first entry', async () => {
    const { client, doors } = fixture();
    await addNewObjectToAppMenu(client, { packageId: PKG, objectName: 'visits_visit' }, TEXTS, doors);
    expect(savedNavigation(client)).toEqual([{ id: 'nav_visits_visit', type: 'object', objectName: 'visits_visit' }]);
  });

  it('no app, several apps, or an entry already opening the object: nothing is written', async () => {
    const none = fixture({ apps: [] });
    expect(await addNewObjectToAppMenu(none.client, { packageId: PKG, objectName: 'o' }, TEXTS, none.doors)).toEqual({
      kind: 'skipped',
      why: 'no-app',
    });
    const several = fixture({ apps: [{ name: 'a' }, { name: 'b' }] });
    expect(await addNewObjectToAppMenu(several.client, { packageId: PKG, objectName: 'o' }, TEXTS, several.doors)).toEqual({
      kind: 'skipped',
      why: 'several-apps',
    });
    const there = fixture({
      stored: [{ id: 'g', type: 'group', label: 'G', children: [{ id: 'x', type: 'object', objectName: 'o' }] }],
    });
    expect(await addNewObjectToAppMenu(there.client, { packageId: PKG, objectName: 'o' }, TEXTS, there.doors)).toEqual({
      kind: 'skipped',
      why: 'already-there',
    });
    for (const f of [none, several, there]) {
      expect(f.client.save).not.toHaveBeenCalled();
      expect(f.client.publish).not.toHaveBeenCalled();
    }
  });

  it('a draft pending on the app is refused, answered as a failure, and nothing is published', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { client, doors } = fixture({ save: vi.fn(async () => Promise.reject(conflict)) });
    const join = await addNewObjectToAppMenu(client, { packageId: PKG, objectName: 'o' }, TEXTS, doors);
    expect(join.kind).toBe('failed');
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('the entry id is one no entry holds', () => {
    expect(objectMenuEntry('o', [{ id: 'nav_o' }, { id: 'g', children: [{ id: 'nav_o_2' }] }]).id).toBe('nav_o_3');
  });
});
