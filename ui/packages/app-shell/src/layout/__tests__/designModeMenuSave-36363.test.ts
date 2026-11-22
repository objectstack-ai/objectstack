// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind the design mode's 「Save」 for the app's menu
 * (objectstack#36363): where Studio's menu editing writes it, published at
 * once, never over somebody's pending draft.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitMetadataRefresh = vi.hoisted(() => vi.fn());
vi.mock('../../assistant/assistantBus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh,
}));

import { saveAppMenu, type AppMenuSaveDoors } from '../designModeMenuSave';

const TEXTS = { notListed: 'not listed', pendingDraft: 'pending draft', noVersion: 'no version' };
const NAV = [{ id: 'leads', type: 'object', objectName: 'crm_lead' }];

function doors(opts: { writable: boolean; version?: string; save?: () => Promise<unknown>; publish?: () => Promise<unknown> }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const d: AppMenuSaveDoors = {
    listPackages: async () =>
      new Map([
        ['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: opts.writable, manifest: opts.version ? { version: opts.version } : {} }],
      ]),
    ensureCustomization: async (base) => {
      calls.push(['ensure', base]);
      return { basePackageId: base, packageId: `${base}.custom`, namespace: 'crm_custom', created: false, writable: true };
    },
    client: {
      get: async () => ({ name: 'crm', label: 'CRM', navigation: [], _packageId: 'com.acme.crm', _diagnostics: [] }),
      save: async (...args) => {
        calls.push(['save', ...args]);
        return opts.save ? opts.save() : {};
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

beforeEach(() => emitMetadataRefresh.mockReset());

describe('saving the app menu (objectstack#36363)', () => {
  it('a writable package: the app with its new menu, saved there as a draft and published', async () => {
    const { d, calls } = doors({ writable: true });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', navigation: NAV }, TEXTS, d);
    expect(calls).toEqual([
      ['save', 'app', 'crm', { name: 'crm', label: 'CRM', navigation: NAV }, { mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' }],
      ['publish', 'app', 'crm', { packageId: 'com.acme.crm' }],
    ]);
    expect(emitMetadataRefresh).toHaveBeenCalledTimes(1);
  });

  it("an installed (read-only) package: saved into its customization package, declaring the override at the base's version", async () => {
    const { d, calls } = doors({ writable: false, version: '6.5.0' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', navigation: NAV }, TEXTS, d);
    expect(calls).toEqual([
      ['ensure', 'com.acme.crm'],
      [
        'save',
        'app',
        'crm',
        { name: 'crm', label: 'CRM', navigation: NAV, overrides: { package: 'com.acme.crm', basedOn: '6.5.0' } },
        { mode: 'draft', packageId: 'com.acme.crm.custom', ifNoneMatch: '*' },
      ],
      ['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom' }],
    ]);
  });

  it('a read-only package that states no version is refused before anything is written', async () => {
    const { d, calls } = doors({ writable: false });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', navigation: NAV }, TEXTS, d)).rejects.toThrow('no version');
    expect(calls.filter(([c]) => c === 'save')).toEqual([]);
  });

  it('a package the server does not list is refused', async () => {
    const { d } = doors({ writable: true });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.other', navigation: NAV }, TEXTS, d)).rejects.toThrow('not listed');
  });

  it("a draft already pending is not overwritten nor published: the save says so", async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { d, calls } = doors({ writable: true, save: () => Promise.reject(conflict) });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', navigation: NAV }, TEXTS, d)).rejects.toThrow('pending draft');
    expect(calls.map(([c]) => c)).toEqual(['save']);
    expect(emitMetadataRefresh).not.toHaveBeenCalled();
  });

  it('a refused publish discards the draft this save wrote, and the refusal is passed on', async () => {
    const { d, calls } = doors({ writable: true, publish: () => Promise.reject(new Error('Package is read-only')) });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', navigation: NAV }, TEXTS, d)).rejects.toThrow('Package is read-only');
    expect(calls.map(([c]) => c)).toEqual(['save', 'publish', 'reset']);
    expect(calls[2]).toEqual(['reset', 'app', 'crm', { state: 'draft', packageId: 'com.acme.crm' }]);
  });
});
