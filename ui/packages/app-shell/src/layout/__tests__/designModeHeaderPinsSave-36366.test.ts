// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — the write behind the design mode's 「Save」 for an
 * object's pinned header actions: the object's own package when it is
 * writable, else the installed object's customization (`object_extension`),
 * published at once, never over a pending draft, and never with a name the
 * header cannot draw.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitMetadataRefresh = vi.hoisted(() => vi.fn());
vi.mock('../../assistant/assistantBus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh,
}));

import { saveObjectPins, type ObjectPinsSaveDoors } from '../designModeHeaderPinsSave';
import type { ObjectPins } from '../designModeHeaderPinsModel';

const TEXTS = {
  notListed: 'not listed',
  pendingDraft: 'pending draft',
  pairNotWritable: 'pair not writable',
  unknown: (n: string) => `unknown ${n}`,
  notPlaced: (n: string) => `not placed ${n}`,
};

/** The object as served: every package's actions folded in. */
const SERVED = {
  name: 'crm_lead',
  label: 'Lead',
  _packageId: 'com.acme.crm',
  actions: [
    { name: 'convert', locations: ['record_header'] },
    { name: 'log_call', locations: ['record_more'] },
    { name: 'mass_assign', locations: ['list_toolbar'] },
  ],
};

function doors(opts: {
  writable: boolean;
  layers?: unknown;
  extension?: unknown;
  pairWritable?: boolean;
  save?: () => Promise<unknown>;
  publish?: () => Promise<unknown>;
}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const d: ObjectPinsSaveDoors = {
    listPackages: async () =>
      new Map([['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: opts.writable, manifest: { version: '1.0.0' } }]]),
    ensureCustomization: async (base) => {
      calls.push(['ensure', base]);
      return { basePackageId: base, packageId: `${base}.custom`, namespace: 'crm_custom', created: false, writable: opts.pairWritable ?? true };
    },
    client: {
      layered: async (...args) => {
        calls.push(['layered', ...args]);
        return opts.layers ?? null;
      },
      get: async (...args) => {
        calls.push(['get', ...args]);
        // The console's client answers `null` for an item that is not there.
        return opts.extension === undefined ? null : opts.extension;
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
  };
  return { d, calls };
}

const input = (pins: ObjectPins) => ({ objectName: 'crm_lead', packageId: 'com.acme.crm', served: SERVED, pins });

beforeEach(() => emitMetadataRefresh.mockReset());

describe('saving the header pins (objectstack#36366)', () => {
  it('a writable package: the object as its author wrote it, with the new pins, saved as a draft and published', async () => {
    const authored = { name: 'crm_lead', label: 'Lead', actions: [{ name: 'convert', locations: ['record_header'] }] };
    const { d, calls } = doors({ writable: true, layers: { code: authored } });
    await saveObjectPins(input({ record: { pinned: ['log_call', 'convert'] } }), TEXTS, d);
    expect(calls).toEqual([
      ['layered', 'object', 'crm_lead', { packageId: 'com.acme.crm' }],
      [
        'save',
        'object',
        'crm_lead',
        { ...authored, actionLayout: { record: { pinned: ['log_call', 'convert'] } } },
        { mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' },
      ],
      ['publish', 'object', 'crm_lead', { packageId: 'com.acme.crm' }],
    ]);
    expect(emitMetadataRefresh).toHaveBeenCalledTimes(1);
  });

  it("an installed (read-only) package: a new object_extension in its customization package, carrying no `name`", async () => {
    const { d, calls } = doors({ writable: false });
    await saveObjectPins(input({ list: { pinned: ['$export', 'mass_assign'] } }), TEXTS, d);
    expect(calls).toEqual([
      ['ensure', 'com.acme.crm'],
      ['get', 'object_extension', 'crm_lead', { packageId: 'com.acme.crm.custom' }],
      ['layered', 'object', 'crm_lead', { packageId: 'com.acme.crm' }],
      [
        'save',
        'object_extension',
        'crm_lead',
        { extend: 'crm_lead', actionLayout: { list: { pinned: ['$export', 'mass_assign'] } } },
        { mode: 'draft', packageId: 'com.acme.crm.custom', ifNoneMatch: '*' },
      ],
      ['publish', 'object_extension', 'crm_lead', { packageId: 'com.acme.crm.custom' }],
    ]);
  });

  it('an installed package whose extension is already published keeps what it holds, and replaces only the pins', async () => {
    const extension = {
      extend: 'crm_lead',
      fields: { score__c: { type: 'number' } },
      actionLayout: { record: { pinned: ['convert'] } },
      _packageId: 'com.acme.crm.custom',
    };
    const { d, calls } = doors({ writable: false, extension });
    await saveObjectPins(input({ record: { pinned: ['log_call'] } }), TEXTS, d);
    const save = calls.find((c) => c[0] === 'save');
    expect(save?.[3]).toEqual({ extend: 'crm_lead', fields: { score__c: { type: 'number' } }, actionLayout: { record: { pinned: ['log_call'] } } });
  });

  it('S3: only the arm the administrator changed is written: the served arm of another scope is not copied in', async () => {
    const served = { ...SERVED, actionLayout: { list: { pinned: ['mass_assign'] }, record: { pinned: ['log_call'] } } };
    const { d, calls } = doors({ writable: false });
    await saveObjectPins(
      { ...input({ list: { pinned: ['mass_assign'] }, record: { pinned: ['convert'] } }), served },
      TEXTS,
      d,
    );
    const save = calls.find((c) => c[0] === 'save');
    expect(save?.[3]).toEqual({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert'] } } });
  });

  it('S3: an arm the target document already holds for an unchanged scope stays as it holds it', async () => {
    const served = { ...SERVED, actionLayout: { list: { pinned: ['mass_assign'] }, record: { pinned: ['log_call'] } } };
    const extension = { extend: 'crm_lead', actionLayout: { list: { pinned: ['mass_assign'] } } };
    const { d, calls } = doors({ writable: false, extension });
    await saveObjectPins(
      { ...input({ list: { pinned: ['mass_assign'] }, record: { pinned: [], more: ['convert'] } }), served },
      TEXTS,
      d,
    );
    const save = calls.find((c) => c[0] === 'save');
    expect(save?.[3]).toEqual({
      extend: 'crm_lead',
      actionLayout: { list: { pinned: ['mass_assign'] }, record: { pinned: [], more: ['convert'] } },
    });
  });

  it('S3: a staged value that arranges as the object is served writes nothing', async () => {
    const served = { ...SERVED, actionLayout: { record: { pinned: ['log_call'] } } };
    const { d, calls } = doors({ writable: true });
    await saveObjectPins({ ...input({ record: { pinned: ['log_call'] } }), served }, TEXTS, d);
    expect(calls).toEqual([]);
  });

  it('S4: a built-in is only ever pinned: `more` is written with action names only', async () => {
    const { d, calls } = doors({ writable: false });
    await saveObjectPins(input({ list: { pinned: ['mass_assign'], more: ['$import', '$export'] } }), TEXTS, d);
    const save = calls.find((c) => c[0] === 'save');
    expect(save?.[3]).toEqual({ extend: 'crm_lead', actionLayout: { list: { pinned: ['mass_assign'], more: [] } } });
  });

  it('S5: an installed object is written through the one writer of its arrangement: a pair the server answers not writable is refused before anything is read or written to it', async () => {
    const { d, calls } = doors({ writable: false, pairWritable: false });
    await expect(saveObjectPins(input({ record: { pinned: ['convert'] } }), TEXTS, d)).rejects.toThrow('pair not writable');
    expect(calls).toEqual([['ensure', 'com.acme.crm']]);
    expect(emitMetadataRefresh).not.toHaveBeenCalled();
  });

  it('S5: through the one writer, every key the stored extension holds is kept, and a landed publish announces itself', async () => {
    const extension = {
      extend: 'crm_lead',
      relatedLists: [{ objectName: 'crm_task', relationshipField: 'lead' }],
      fieldGroups: [{ key: 'main', fields: ['name'] }],
      actionLayout: { list: { pinned: ['mass_assign'] } },
    };
    const { d, calls } = doors({ writable: false, extension });
    await saveObjectPins(input({ record: { pinned: ['convert'] } }), TEXTS, d);
    const save = calls.find((c) => c[0] === 'save');
    expect(save?.[3]).toEqual({
      ...extension,
      actionLayout: { list: { pinned: ['mass_assign'] }, record: { pinned: ['convert'] } },
    });
    expect(calls.at(-1)).toEqual(['publish', 'object_extension', 'crm_lead', { packageId: 'com.acme.crm.custom' }]);
    expect(emitMetadataRefresh).toHaveBeenCalledTimes(1);
  });

  it('a name the header cannot draw is refused before anything is read or written, with its reason', async () => {
    const { d, calls } = doors({ writable: true });
    await expect(saveObjectPins(input({ record: { pinned: ['ghost'] } }), TEXTS, d)).rejects.toThrow('unknown ghost');
    await expect(saveObjectPins(input({ list: { pinned: ['convert'] } }), TEXTS, d)).rejects.toThrow('not placed convert');
    expect(calls).toEqual([]);
  });

  it('a package the server does not list is refused', async () => {
    const { d } = doors({ writable: true });
    await expect(saveObjectPins({ ...input({ record: { pinned: ['convert'] } }), packageId: 'com.other' }, TEXTS, d)).rejects.toThrow('not listed');
  });

  it("a draft already pending (the object's, or the extension's) is not overwritten nor published: the save says so", async () => {
    const own = doors({ writable: true, layers: { code: { name: 'crm_lead' }, draft: { name: 'crm_lead' } } });
    await expect(saveObjectPins(input({ record: { pinned: ['convert'] } }), TEXTS, own.d)).rejects.toThrow('pending draft');
    expect(own.calls.map((c) => c[0])).toEqual(['layered']);

    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const pair = doors({ writable: false, save: () => Promise.reject(conflict) });
    await expect(saveObjectPins(input({ record: { pinned: ['convert'] } }), TEXTS, pair.d)).rejects.toThrow('pending draft');
    expect(pair.calls.map((c) => c[0])).toEqual(['ensure', 'get', 'layered', 'save']);
    expect(emitMetadataRefresh).not.toHaveBeenCalled();
  });

  it('a refused publish discards the draft this save wrote, and the refusal is passed on', async () => {
    const refusal = new Error('refused');
    const { d, calls } = doors({ writable: true, layers: { code: { name: 'crm_lead' } }, publish: () => Promise.reject(refusal) });
    await expect(saveObjectPins(input({ record: { pinned: ['convert'] } }), TEXTS, d)).rejects.toBe(refusal);
    expect(calls.at(-1)).toEqual(['reset', 'object', 'crm_lead', { state: 'draft', packageId: 'com.acme.crm' }]);
  });
});
