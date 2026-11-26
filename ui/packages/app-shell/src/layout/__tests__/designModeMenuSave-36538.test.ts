// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design mode's menu save (objectstack#36538): a stored read that holds
 * no app refuses the save (review N8), and the publish is pinned to the
 * published row the save was composed over (review N6), read at the address
 * the publish writes, before the body.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitMetadataRefresh = vi.hoisted(() => vi.fn());
vi.mock('../../assistant/assistantBus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh,
}));

import {
  menuTranslationName,
  readStoredMenu,
  saveAppMenu,
  writeAppMenu,
  type AppMenuSaveDoors,
  type AppMenuSaveTexts,
} from '../designModeMenuSave';
import { draftPublishDoor } from '../../views/__tests__/draftPublishDoor-37440';

const TEXTS: AppMenuSaveTexts = {
  notListed: 'not listed',
  pendingDraft: 'pending draft',
  noVersion: 'no version',
  notWritable: 'not writable',
  storedUnread: 'stored unread',
  publishedMoved: 'published moved',
};
const NAV = [{ id: 'leads', type: 'object', objectName: 'crm_lead' }];
const INPUT = { appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV };
/** What `MetadataClient.layered` answers for a 404. */
const NOT_FOUND = { code: null, overlay: null, overlayScope: null, effective: null };
const APP = { name: 'crm', label: 'CRM', navigation: [] };

type Layers = Record<string, unknown>;

function doors(opts: {
  writable?: boolean;
  /** The customization pair is listed. */
  pairListed?: boolean;
  /** The ensure door created the pair. */
  created?: boolean;
  /** The layered read at each package. */
  layers: Record<string, Layers>;
  publish?: () => Promise<unknown>;
}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const base = { id: 'com.acme.crm', name: 'CRM', writable: opts.writable ?? true, manifest: { version: '6.5.0' } };
  const pair = { id: 'com.acme.crm.custom', name: 'CRM custom', writable: true, manifest: { version: '0.0.1' } };
  const d: AppMenuSaveDoors = {
    listPackages: async () => new Map([['com.acme.crm', base], ...(opts.pairListed ? [['com.acme.crm.custom', pair] as const] : [])]),
    ensureCustomization: async (id) => {
      calls.push(['ensure', id]);
      return { basePackageId: id, packageId: `${id}.custom`, namespace: 'crm_custom', created: opts.created ?? false, writable: true };
    },
    client: {
      layered: async (...args) => {
        calls.push(['layered', ...args]);
        return opts.layers[String(args[2].packageId)] ?? NOT_FOUND;
      },
      save: async (...args) => {
        calls.push(['save', ...args]);
        return {};
      },
      publish: async (...args) => {
        calls.push(['publish', ...args]);
        return opts.publish ? opts.publish() : {};
      },
      reset: async (...args) => {
        calls.push(['reset', ...args]);
        return {};
      },
    },
  };
  return { d, calls };
}

const publishOf = (calls: Array<[string, ...unknown[]]>) => calls.find(([c]) => c === 'publish');

beforeEach(() => emitMetadataRefresh.mockReset());

describe('a stored read that holds no app refuses the save (objectstack#36538, review N8)', () => {
  it('the layered read answers a 404: nothing is written, and the save says why', async () => {
    const { d, calls } = doors({ layers: { 'com.acme.crm': NOT_FOUND } });
    await expect(saveAppMenu(INPUT, TEXTS, d)).rejects.toThrow(TEXTS.storedUnread);
    expect(calls.map(([c]) => c)).toEqual(['layered']);
  });

  it('a caller that states no sentence for it is told the package sentence', async () => {
    const { d } = doors({ layers: { 'com.acme.crm': NOT_FOUND } });
    const { storedUnread: _, ...texts } = TEXTS;
    await expect(saveAppMenu(INPUT, texts, d)).rejects.toThrow(TEXTS.notListed);
  });

  it('CONTROL: a read that holds the app saves and publishes', async () => {
    const { d, calls } = doors({ layers: { 'com.acme.crm': { code: APP, effective: APP } } });
    await saveAppMenu(INPUT, TEXTS, d);
    expect(calls.map(([c]) => c)).toEqual(['layered', 'save', 'publish']);
  });

  it("the editor's stored menu is unknown (`null`) for a 404, never an empty menu; a stored app with no menu is an empty one", async () => {
    const layered = vi.fn(async () => NOT_FOUND);
    expect(await readStoredMenu('crm', 'com.acme.crm', { layered })).toBeNull();
    layered.mockResolvedValueOnce({ code: { name: 'crm', label: 'CRM' }, effective: null } as never);
    expect(await readStoredMenu('crm', 'com.acme.crm', { layered })).toEqual([]);
  });
});

describe('the publish is pinned to the published row the save read (objectstack#36538, review N6)', () => {
  it("a writable package: the read's overlayVersion is sent as If-Match", async () => {
    const { d, calls } = doors({ layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: 'v3' } } });
    await saveAppMenu(INPUT, TEXTS, d);
    expect(publishOf(calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm', ifMatch: 'v3' }]);
  });

  it('no published row at that address (overlayVersion null): the publish is sent If-None-Match *', async () => {
    const { d, calls } = doors({ layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: null } } });
    await saveAppMenu(INPUT, TEXTS, d);
    expect(publishOf(calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm', ifNoneMatch: '*' }]);
  });

  it('CONTROL: a server that serves no overlayVersion: the publish is not pinned, as before', async () => {
    const { d, calls } = doors({ layers: { 'com.acme.crm': { code: APP, effective: APP } } });
    await saveAppMenu(INPUT, TEXTS, d);
    expect(publishOf(calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm' }]);
  });

  it('a publish landed since the read is refused 409: the draft is discarded, and the save says so', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { d, calls } = doors({
      layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: 'v3' } },
      publish: () => Promise.reject(conflict),
    });
    const refusal = await saveAppMenu(INPUT, TEXTS, d).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe(TEXTS.publishedMoved);
    expect((refusal as Error).cause).toBe(conflict);
    expect(calls.map(([c]) => c)).toEqual(['layered', 'save', 'publish', 'reset']);
    expect(calls[3]).toEqual(['reset', 'app', 'crm', { state: 'draft', packageId: 'com.acme.crm' }]);
  });

  it('CONTROL: another refusal of the publish is passed on as it came', async () => {
    const refused = Object.assign(new Error('Package is read-only'), { status: 403, code: 'PERMISSION_DENIED' });
    const { d } = doors({ layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: 'v3' } }, publish: () => Promise.reject(refused) });
    await expect(saveAppMenu(INPUT, TEXTS, d)).rejects.toBe(refused);
  });

  it("an installed app with a listed pair: the pair's published row is read first, and pins the publish there", async () => {
    const { d, calls } = doors({
      writable: false,
      pairListed: true,
      layers: {
        'com.acme.crm.custom': { code: null, overlay: APP, effective: APP, overlayVersion: 'pair-9' },
        'com.acme.crm': { code: APP, effective: APP, overlayVersion: 'base-1' },
      },
    });
    await saveAppMenu(INPUT, TEXTS, d);
    expect(calls.filter(([c]) => c === 'layered').map((c) => (c[3] as { packageId: string }).packageId)).toEqual([
      'com.acme.crm.custom',
      'com.acme.crm',
    ]);
    expect(publishOf(calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom', ifMatch: 'pair-9' }]);
  });

  it('a listed pair that holds nothing of the app (a 404 there): the publish is sent If-None-Match *', async () => {
    const { d, calls } = doors({
      writable: false,
      pairListed: true,
      layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: null } },
    });
    await saveAppMenu(INPUT, TEXTS, d);
    expect(publishOf(calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom', ifNoneMatch: '*' }]);
  });

  it('a pair the ensure door created holds nothing: If-None-Match *; one it found unlisted was not read: not pinned', async () => {
    const created = doors({ writable: false, created: true, layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: null } } });
    await saveAppMenu(INPUT, TEXTS, created.d);
    expect(publishOf(created.calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom', ifNoneMatch: '*' }]);

    const found = doors({ writable: false, created: false, layers: { 'com.acme.crm': { code: APP, effective: APP, overlayVersion: 'base-1' } } });
    await saveAppMenu(INPUT, TEXTS, found.d);
    expect(publishOf(found.calls)).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom' }]);
  });
});

describe('the menu Save publishes only the drafts it wrote (objectstack#37440)', () => {
  const PKG = 'com.acme.crm';
  const BODY = { ...APP, navigation: NAV };
  const TRANSLATION = menuTranslationName('crm', 'zh-CN');
  function doorDoors() {
    const door = draftPublishDoor();
    const liveVersion = door.seedLive('app', 'crm', PKG, APP);
    const d: Pick<AppMenuSaveDoors, 'client'> = { client: { ...door.client, layered: async () => NOT_FOUND } };
    const prepared = { appName: 'crm', target: PKG, body: BODY, publishPin: { ifMatch: liveVersion } };
    return { door, d, prepared, liveVersion };
  }

  it("PIN (menu): another writer's draft write before the publish is refused, published by nobody, and kept", async () => {
    const { door, d, prepared } = doorDoors();
    door.interleave('app', 'crm', PKG, { ...APP, label: 'theirs' });
    await expect(writeAppMenu(prepared, TEXTS, d)).rejects.toThrow(TEXTS.pendingDraft);
    expect(door.liveOf('app', 'crm', PKG)).toEqual(APP);
    expect(door.draftOf('app', 'crm', PKG)).toEqual({ ...APP, label: 'theirs' });
    expect(door.calls.find(([c]) => c === 'publish')?.[3]).toMatchObject({ ifMatch: prepared.publishPin.ifMatch, draftVersion: expect.any(String) });
  });

  it('the published row moved instead: still said as a live change, and the draft this save wrote is taken back', async () => {
    const { door, d, prepared } = doorDoors();
    door.seedLive('app', 'crm', PKG, { ...APP, label: 'published since' });
    await expect(writeAppMenu(prepared, TEXTS, d)).rejects.toThrow(TEXTS.publishedMoved);
    expect(door.liveOf('app', 'crm', PKG)).toEqual({ ...APP, label: 'published since' });
    expect(door.draftOf('app', 'crm', PKG)).toBeUndefined();
  });

  it('CONTROL (menu): with no write in between, the same pinned publish takes the menu live', async () => {
    const { door, d, prepared } = doorDoors();
    await writeAppMenu(prepared, TEXTS, d);
    expect(door.liveOf('app', 'crm', PKG)).toEqual(BODY);
    expect(door.draftOf('app', 'crm', PKG)).toBeUndefined();
  });

  const translated = (prepared: ReturnType<typeof doorDoors>['prepared']) => ({
    ...prepared,
    writesMenu: false,
    translation: { name: TRANSLATION, locale: 'zh-CN', labels: { leads: '线索' } },
  });

  it("PIN (translation): another writer's draft write before its publish is refused, published by nobody, and kept", async () => {
    const { door, d, prepared } = doorDoors();
    door.interleave('translation', TRANSLATION, PKG, { name: TRANSLATION, label: 'theirs' });
    await expect(writeAppMenu(translated(prepared), TEXTS, d)).rejects.toThrow(TEXTS.pendingDraft);
    expect(door.liveOf('translation', TRANSLATION, PKG)).toBeUndefined();
    expect(door.draftOf('translation', TRANSLATION, PKG)).toEqual({ name: TRANSLATION, label: 'theirs' });
  });

  it('CONTROL (translation): with no write in between, the labels go live', async () => {
    const { door, d, prepared } = doorDoors();
    await writeAppMenu(translated(prepared), TEXTS, d);
    expect(door.liveOf('translation', TRANSLATION, PKG)).toMatchObject({
      name: TRANSLATION,
      locale: 'zh-CN',
      apps: { crm: { navigation: { leads: { label: '线索' } } } },
    });
    expect(door.draftOf('translation', TRANSLATION, PKG)).toBeUndefined();
  });
});
