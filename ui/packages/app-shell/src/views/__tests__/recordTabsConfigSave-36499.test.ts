// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind 「Configure tabs」 「Save」 (objectstack#36499): the
 * object's `relatedLists`, composed over the object as STORED (the layered
 * read, never the served object), saved as a draft with the first-write pin
 * into the object's own writable package and published at once; a refused
 * publish discards that draft; a read-only package is refused before anything
 * is written.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The announcement is a door, not a module mock: the `unit` project runs
// with `isolate: false`, where a module another file loaded first keeps its
// real binding.
const emitMetadataRefresh = vi.fn();

import { recordTabsCatalog, type RecordTabsDraft } from '../recordTabsConfig';
import { resolveRecordTabsSaveTarget, saveRecordTabs, type RecordTabsSaveDoors } from '../recordTabsConfigSave';

const TEXTS = { notListed: 'not listed', pendingDraft: 'pending draft', notWritable: 'not writable' };
const PKG = 'app.crm';
const served = {
  name: 'account',
  label: 'Account (served, translated)',
  _packageId: PKG,
  relatedLists: ['contact', 'spliced_from_another_package'],
  _relatedListsArrangement: undefined,
};
const objects = [
  served,
  { name: 'contact', _packageId: PKG, fields: { account: { type: 'lookup', reference: 'account' } } },
  { name: 'task', _packageId: PKG, fields: { account: { type: 'lookup', reference: 'account' } } },
];
const catalog = recordTabsCatalog(served, objects);
const DRAFT: RecordTabsDraft = { order: ['task.account', 'contact.account'], hidden: [], attachmentsHidden: false, labels: {} };

function doors(opts: { writable?: boolean; listed?: boolean; save?: () => Promise<unknown>; publish?: () => Promise<unknown> }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const d: RecordTabsSaveDoors = {
    listPackages: async () => (opts.listed === false ? new Map() : new Map([[PKG, { writable: opts.writable ?? true }]])),
    client: {
      layered: async (...args) => {
        calls.push(['layered', ...args]);
        const code = { name: 'account', label: 'Account', fields: {}, relatedLists: [{ list: 'contact', columns: ['name'] }], _packageId: PKG };
        return { code, effective: code };
      },
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
    refreshed: emitMetadataRefresh,
  };
  return { d, calls };
}

beforeEach(() => emitMetadataRefresh.mockReset());

describe("saving the record page's tabs (objectstack#36499)", () => {
  it('a writable package: the stored object with its new relatedLists, a pinned draft there, published', async () => {
    const { d, calls } = doors({});
    await saveRecordTabs({ objectName: 'account', packageId: PKG, draft: DRAFT, catalog }, TEXTS, d);
    expect(calls).toEqual([
      ['layered', 'object', 'account', { packageId: PKG }],
      [
        'save',
        'object',
        'account',
        // The stored label, not the served one; the stored entry's columns
        // kept; no read decoration; nothing spliced in by the server.
        { name: 'account', label: 'Account', fields: {}, relatedLists: ['task', { list: 'contact', columns: ['name'] }] },
        { mode: 'draft', packageId: PKG, ifNoneMatch: '*' },
      ],
      ['publish', 'object', 'account', { packageId: PKG }],
    ]);
    expect(emitMetadataRefresh).toHaveBeenCalledTimes(1);
  });

  it('a draft already pending: refused with its sentence, nothing published', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { d, calls } = doors({ save: () => Promise.reject(conflict) });
    await expect(saveRecordTabs({ objectName: 'account', packageId: PKG, draft: DRAFT, catalog }, TEXTS, d)).rejects.toThrow(
      'pending draft',
    );
    expect(calls.map(([c]) => c)).toEqual(['layered', 'save']);
    expect(emitMetadataRefresh).not.toHaveBeenCalled();
  });

  it('a refused publish discards the draft this save wrote, and is rethrown', async () => {
    const { d, calls } = doors({ publish: () => Promise.reject(new Error('refused')) });
    await expect(saveRecordTabs({ objectName: 'account', packageId: PKG, draft: DRAFT, catalog }, TEXTS, d)).rejects.toThrow(
      'refused',
    );
    expect(calls.map(([c]) => c)).toEqual(['layered', 'save', 'publish', 'reset']);
    expect(calls[3]).toEqual(['reset', 'object', 'account', { state: 'draft', packageId: PKG }]);
  });

  it('a read-only (installed) package or an unlisted one: refused before anything is read or written', async () => {
    for (const [opts, sentence] of [
      [{ writable: false }, 'not writable'],
      [{ listed: false }, 'not listed'],
    ] as const) {
      const { d, calls } = doors(opts);
      await expect(saveRecordTabs({ objectName: 'account', packageId: PKG, draft: DRAFT, catalog }, TEXTS, d)).rejects.toThrow(
        sentence,
      );
      expect(calls).toEqual([]);
    }
  });

  it('the one seam: a writable package is the target; anything else has none yet', () => {
    expect(resolveRecordTabsSaveTarget(PKG, new Map([[PKG, { writable: true }]]))).toEqual({ kind: 'package', packageId: PKG });
    expect(resolveRecordTabsSaveTarget(PKG, new Map([[PKG, { writable: false }]]))).toBeNull();
    expect(resolveRecordTabsSaveTarget(PKG, new Map())).toBeNull();
  });
});
