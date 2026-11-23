// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one writer of an installed object's arrangement (objectstack#36499,
 * ADR-0146 D10): the pair the ensure door answers, the pair's STORED
 * extension with only the caller's keys replaced (`fields`, `fieldPatches`,
 * `place` and the other arrangement key kept), a pinned draft, a publish; a
 * refused publish discards the draft; a pair the server lists read-only is
 * refused before anything is written.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  extensionWithArrangement,
  saveObjectExtensionArrangement,
  type ExtensionArrangementDoors,
} from '../objectExtensionArrangementSave';

const BASE = 'app.hotcrm';
const PAIR = 'app.hotcrm.custom';
const TEXTS = { notListed: 'not listed', pendingDraft: 'pending draft', notWritable: 'pair not writable' };

const STORED_EXTENSION = {
  extend: 'lead',
  fields: { region__c: { type: 'text', label: 'Region' } },
  fieldPatches: { status: { label: 'Stage' } },
  place: [{ field: 'region__c', after: 'status' }],
  fieldGroups: [{ key: 'basic', label: 'Basics', fields: ['name'] }],
  relatedLists: ['task'],
  _packageId: PAIR,
};

function doors(opts: {
  extension?: unknown;
  pairWritable?: boolean;
  listed?: boolean;
  save?: () => Promise<unknown>;
  publish?: () => Promise<unknown>;
}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const refreshed = vi.fn();
  const d: ExtensionArrangementDoors = {
    listPackages: async () => (opts.listed === false ? new Map() : new Map([[BASE, { writable: false }]])),
    ensureCustomization: async (base) => {
      calls.push(['ensure', base]);
      return { packageId: PAIR, writable: opts.pairWritable ?? true };
    },
    client: {
      get: async (...args) => {
        calls.push(['get', ...args]);
        return opts.extension === undefined ? null : opts.extension;
      },
      layered: async (...args) => {
        calls.push(['layered', ...args]);
        const code = { name: 'lead', relatedLists: [{ list: 'contact', label: 'People' }] };
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
    refreshed,
  };
  return { d, calls, refreshed };
}

describe("writing an installed object's arrangement into its pair (objectstack#36499)", () => {
  it('replaces only the returned key over the STORED extension, every other key kept, pinned draft then publish', async () => {
    const { d, calls, refreshed } = doors({ extension: STORED_EXTENSION });
    const seen: unknown[] = [];
    const pair = await saveObjectExtensionArrangement(
      {
        objectName: 'lead',
        basePackageId: BASE,
        arrange: (stored) => {
          seen.push(stored);
          return { relatedLists: ['contact', { list: 'task', hidden: true }] };
        },
      },
      TEXTS,
      d,
    );
    expect(pair).toBe(PAIR);
    // The caller composes over what is stored: the extension without its read
    // envelope, the object of the layered read.
    const { _packageId: _envelope, ...storedBody } = STORED_EXTENSION;
    expect(seen).toEqual([{ extension: storedBody, object: { name: 'lead', relatedLists: [{ list: 'contact', label: 'People' }] } }]);
    expect(calls).toEqual([
      ['ensure', BASE],
      ['get', 'object_extension', 'lead', { packageId: PAIR }],
      ['layered', 'object', 'lead', { packageId: BASE }],
      [
        'save',
        'object_extension',
        'lead',
        {
          extend: 'lead',
          fields: STORED_EXTENSION.fields,
          fieldPatches: STORED_EXTENSION.fieldPatches,
          place: STORED_EXTENSION.place,
          fieldGroups: STORED_EXTENSION.fieldGroups,
          relatedLists: ['contact', { list: 'task', hidden: true }],
        },
        { mode: 'draft', packageId: PAIR, ifNoneMatch: '*' },
      ],
      ['publish', 'object_extension', 'lead', { packageId: PAIR }],
    ]);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('a second caller writes fieldGroups through the same writer, the tab list kept', async () => {
    const { d, calls } = doors({ extension: STORED_EXTENSION });
    await saveObjectExtensionArrangement(
      { objectName: 'lead', basePackageId: BASE, arrange: () => ({ fieldGroups: [{ key: 'all', label: 'All' }] }) },
      TEXTS,
      d,
    );
    const body = calls.find(([c]) => c === 'save')?.[3] as Record<string, unknown>;
    expect(body.fieldGroups).toEqual([{ key: 'all', label: 'All' }]);
    expect(body.relatedLists).toEqual(['task']);
    expect(body.fields).toEqual(STORED_EXTENSION.fields);
  });

  it('no extension stored yet: the body is the object it extends and the returned key', async () => {
    const { d, calls } = doors({});
    await saveObjectExtensionArrangement(
      { objectName: 'lead', basePackageId: BASE, arrange: () => ({ relatedLists: ['task'] }) },
      TEXTS,
      d,
    );
    expect(calls.find(([c]) => c === 'save')?.[3]).toEqual({ extend: 'lead', relatedLists: ['task'] });
  });

  it('a key returned undefined is taken off (the base arrangement is served again)', () => {
    expect(extensionWithArrangement({ extend: 'lead', relatedLists: ['task'], place: [] }, 'lead', { relatedLists: undefined })).toEqual({
      extend: 'lead',
      place: [],
    });
  });

  it('a pair the server answers read-only, or an unlisted base: refused before anything is written', async () => {
    for (const [opts, sentence, expected] of [
      [{ pairWritable: false }, 'pair not writable', ['ensure']],
      [{ listed: false }, 'not listed', []],
    ] as const) {
      const { d, calls } = doors(opts);
      await expect(
        saveObjectExtensionArrangement({ objectName: 'lead', basePackageId: BASE, arrange: () => ({ relatedLists: [] }) }, TEXTS, d),
      ).rejects.toThrow(sentence);
      expect(calls.map(([c]) => c)).toEqual(expected);
    }
  });

  it('a draft already pending is refused with its sentence; a refused publish discards the draft this save wrote', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const pending = doors({ save: () => Promise.reject(conflict) });
    await expect(
      saveObjectExtensionArrangement({ objectName: 'lead', basePackageId: BASE, arrange: () => ({ relatedLists: [] }) }, TEXTS, pending.d),
    ).rejects.toThrow('pending draft');
    expect(pending.calls.map(([c]) => c)).not.toContain('publish');

    const refused = doors({ publish: () => Promise.reject(new Error('refused')) });
    await expect(
      saveObjectExtensionArrangement({ objectName: 'lead', basePackageId: BASE, arrange: () => ({ relatedLists: [] }) }, TEXTS, refused.d),
    ).rejects.toThrow('refused');
    expect(refused.calls.at(-1)).toEqual(['reset', 'object_extension', 'lead', { state: 'draft', packageId: PAIR }]);
    expect(refused.refreshed).toHaveBeenCalledTimes(1);
  });
});
