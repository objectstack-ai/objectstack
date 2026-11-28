// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — a view or report created in the console is never saved
 * naming no package. Where the app's package (or its customization package)
 * cannot be had, the person is asked to pick or create one; a system app and
 * a caller the ensure door refuses are refused instead, with nothing written
 * (decisions Q-b of topic objectstack#37424, answered C).
 *
 * Controls: an app whose package is writable saves there with no ask (the
 * objectstack#35624 path), and a write that creates nothing (no app: an
 * in-place save of an existing row) names no package and asks nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createRuntimeMetadata,
  isRuntimeCreateNotSaved,
  pickRuntimeCreatePackage,
  resolveRuntimeCreatePackage,
  saveAndPublishRuntimeMetadata,
  type RuntimeCreatePackageDoors,
} from './runtime-metadata-persistence';

const APP = 'com.example.crm';

function doors(
  listed: Record<string, { writable: boolean; manifest?: Record<string, unknown> }>,
  ensure: RuntimeCreatePackageDoors['ensureCustomization'] = async () => ({ packageId: `${APP}.custom`, writable: true }),
): RuntimeCreatePackageDoors {
  return { listPackages: async () => new Map(Object.entries(listed)), ensureCustomization: vi.fn(ensure) };
}

const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('resolveRuntimeCreatePackage: where a console create goes (objectstack#38149)', () => {
  it('outside any app: ask', async () => {
    expect(await resolveRuntimeCreatePackage(null, 'view', doors({}))).toEqual({ kind: 'ask', preselect: null });
  });

  it('an app whose package is not listed: ask', async () => {
    expect(await resolveRuntimeCreatePackage(APP, 'view', doors({}))).toEqual({ kind: 'ask', preselect: null });
  });

  it('a base the ensure door refuses (not the caller): ask', async () => {
    const d = doors({ [APP]: { writable: false, manifest: { scope: 'project' } } }, async () => {
      throw refusal(409, 'The package is held by several apps.');
    });
    expect(await resolveRuntimeCreatePackage(APP, 'view', d)).toEqual({ kind: 'ask', preselect: null });
  });

  it('a system app: refused, and the ensure door is never asked', async () => {
    const d = doors({ 'com.objectstack.setup': { writable: false, manifest: { scope: 'system' } } });
    expect(await resolveRuntimeCreatePackage('com.objectstack.setup', 'view', d)).toEqual({ kind: 'refused', reason: 'system-app' });
    expect(d.ensureCustomization).not.toHaveBeenCalled();
  });

  it('the ensure door refusing the caller itself (403): refused with its reason', async () => {
    const d = doors({ [APP]: { writable: false, manifest: { scope: 'project' } } }, async () => {
      throw refusal(403, 'Only the platform operator may create a customization package here.');
    });
    expect(await resolveRuntimeCreatePackage(APP, 'report', d)).toEqual({
      kind: 'refused',
      reason: 'caller-refused',
      message: 'Only the platform operator may create a customization package here.',
    });
  });

  it('control: a writable app package is the answer, a read-only base its pair', async () => {
    expect(await resolveRuntimeCreatePackage(APP, 'view', doors({ [APP]: { writable: true } }))).toEqual({ kind: 'package', packageId: APP });
    expect(await resolveRuntimeCreatePackage(APP, 'view', doors({ [APP]: { writable: false, manifest: { scope: 'project' } } })))
      .toEqual({ kind: 'package', packageId: `${APP}.custom` });
  });
});

describe('pickRuntimeCreatePackage: the ask answers, or nothing is written (objectstack#38149)', () => {
  it('asks when no package can be had, and takes the answer', async () => {
    const askPackage = vi.fn(async () => 'app.chosen');
    expect(await pickRuntimeCreatePackage({ packageId: APP, askPackage }, 'view', doors({}))).toBe('app.chosen');
    expect(askPackage).toHaveBeenCalledTimes(1);
  });

  it('a cancelled ask throws not-saved (cancelled)', async () => {
    const err = await pickRuntimeCreatePackage({ packageId: null, askPackage: async () => null }, 'view', doors({})).catch((e) => e);
    expect(isRuntimeCreateNotSaved(err) && err.reason).toBe('cancelled');
  });

  it('a system app throws not-saved (system-app) and never asks', async () => {
    const askPackage = vi.fn(async () => 'app.chosen');
    const d = doors({ 'com.objectstack.setup': { writable: false, manifest: { scope: 'system' } } });
    const err = await pickRuntimeCreatePackage({ packageId: 'com.objectstack.setup', askPackage }, 'view', d).catch((e) => e);
    expect(isRuntimeCreateNotSaved(err) && err.reason).toBe('system-app');
    expect(askPackage).not.toHaveBeenCalled();
  });
});

describe('the create writes name the package, or write nothing (objectstack#38149)', () => {
  const client = () => ({
    save: vi.fn(async () => ({ version: 'v1' })),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
  });

  it('createRuntimeMetadata outside any app saves into the package the person picked', async () => {
    const metadataClient = client();
    // `fetch` answers the package list as empty: no app package is listed.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    try {
      await createRuntimeMetadata('view', 'account.mine', { name: 'account.mine' }, {
        metadataClient,
        app: { packageId: null, askPackage: async () => 'app.chosen' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(metadataClient.save).toHaveBeenCalledWith('view', 'account.mine', { name: 'account.mine' }, {
      mode: 'draft',
      packageId: 'app.chosen',
      ifNoneMatch: '*',
    });
  });

  it('a cancelled ask writes nothing', async () => {
    const metadataClient = client();
    const err = await saveAndPublishRuntimeMetadata('view', 'account.mine', {}, {
      metadataClient,
      app: { packageId: null, askPackage: async () => null },
    }).catch((e) => e);
    expect(isRuntimeCreateNotSaved(err)).toBe(true);
    expect(metadataClient.save).not.toHaveBeenCalled();
    expect(metadataClient.publish).not.toHaveBeenCalled();
  });

  it('control: a write that creates nothing (no app) names no package and asks nothing', async () => {
    const metadataClient = client();
    await saveAndPublishRuntimeMetadata('view', 'account.loose', { name: 'account.loose' }, { metadataClient });
    expect(metadataClient.save).toHaveBeenCalledWith('view', 'account.loose', { name: 'account.loose' }, {
      mode: 'draft',
      ifNoneMatch: '*',
    });
  });
});
