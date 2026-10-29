// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27123 slice 2] `os plugin uninstall`'s answers when the record moves under
 * it, against a stand-in store: the record and the lock themselves are pinned
 * in `@objectstack/runtime`'s suite, and the command end to end in
 * `install.integration.test.ts`.
 *
 * Pinned: a record found before the lock and gone under it is
 * `plugin_not_installed` ("removed while this command ran"), never "Marked";
 * a busy lock is `installations_locked`; any other failure of the mark is
 * `uninstall_failed`; each writes nothing and exits 1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '@oclif/core';

const stub = vi.hoisted(() => {
  class PluginInstallationsLockedError extends Error {}
  return {
    PluginInstallationsLockedError,
    mark: null as null | (() => unknown),
    emitted: [] as Array<{ payload: unknown; exitCode: number }>,
  };
});

vi.mock('@objectstack/runtime', () => ({
  PluginInstallationsLockedError: stub.PluginInstallationsLockedError,
  markPluginUninstall: () => (stub.mark as () => unknown)(),
}));
vi.mock('../../utils/plugin-install.js', () => ({
  pluginEnvironmentId: () => 'env_local',
  findPluginInstallation: (_env: string, id: string) => ({
    ok: true,
    record: { id, version: '1.0.0', status: 'installed', dir: `/home/os/plugins/env_local/${id}/1.0.0` },
  }),
}));
vi.mock('../../utils/format.js', () => ({
  emitJson: async (payload: unknown, exitCode = 0) => {
    stub.emitted.push({ payload, exitCode });
  },
  printError: () => {},
  printHeader: () => {},
  printInfo: () => {},
  printKV: () => {},
  printSuccess: () => {},
}));

import PluginUninstall from './uninstall.js';

beforeEach(() => {
  stub.emitted = [];
});

afterEach(() => {
  stub.mark = null;
});

/**
 * The command on its own: its body and flags are what is under test, so it
 * runs without loading the CLI's oclif config (seconds per run, for nothing
 * this file reads).
 */
async function uninstall(): Promise<{ payload: unknown; exitCode: number }> {
  const config = { runHook: async () => ({ successes: [], failures: [] }) } as unknown as Config;
  await new PluginUninstall(['com.acme.raced', '--json'], config).run();
  expect(stub.emitted).toHaveLength(1);
  return stub.emitted[0];
}

describe('os plugin uninstall when the record moves under it', () => {
  it('a record removed between the read and the lock is plugin_not_installed, not "Marked"', async () => {
    stub.mark = () => undefined;
    expect(await uninstall()).toEqual({
      exitCode: 1,
      payload: {
        error: 'plugin_not_installed',
        message: expect.stringMatching(/^com\.acme\.raced is not installed in the environment 'env_local' any more: it was removed while this command ran\. Nothing was changed\.$/),
      },
    });
  });

  it.each([
    ['a lock another writer holds', 'installations_locked', () => new stub.PluginInstallationsLockedError('locked by process 7.')],
    ['any other failure of the mark', 'uninstall_failed', () => new Error('the records file cannot be written.')],
  ])('%s is %s, and nothing was changed', async (_label, code, error) => {
    stub.mark = () => { throw error(); };
    const out = await uninstall();
    expect(out).toEqual({ exitCode: 1, payload: { error: code, message: expect.stringMatching(/ Nothing was changed\.$/) } });
  });
});
