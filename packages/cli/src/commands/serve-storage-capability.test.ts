// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4096 — what `StorageServicePlugin` is actually constructed with.
 *
 * The fallback used to be `{ driver: 'local', root }`, and
 * `StorageServicePluginOptions` declares neither key. Both were dropped
 * silently, so the plugin applied its own `./storage` default,
 * `OS_STORAGE_ROOT` changed nothing, and uploads landed somewhere the operator
 * never named. The `storage` settings namespace then corrected the root on its
 * first read — its manifest default is `./.objectstack/data/uploads` — which
 * swapped the adapter and warned "existing files were NOT migrated" on every
 * boot of a healthy server.
 *
 * The warning was telling the truth; the configuration was wrong. These pin the
 * option SHAPE, because a shape mismatch is exactly the failure a passing type
 * check does not catch when the receiving interface has no index signature and
 * the value is built as a plain object literal.
 *
 * framework#4167 then removed the `config.storage` branch this helper also had.
 * `storage` was never a declared stack key, so `defineStack` — which every
 * documented authoring path and every compiled artifact goes through — stripped
 * it long before `serve` ran. Reading it here made one authoring key work on the
 * single path that skips `defineStack` and vanish on all the others. Authors who
 * write it are now told, by `lintUnknownAuthoringKeys`.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { _resetEnvDeprecationWarnings } from '@objectstack/types';
import { resolveStorageCapabilityArg, resolveStorageLocalRootEnv } from './serve.js';

describe('resolveStorageCapabilityArg', () => {
  it('builds options StorageServicePlugin actually reads', () => {
    // `adapter` + `local.rootDir` — NOT `driver` + `root`.
    expect(resolveStorageCapabilityArg().options).toEqual({
      adapter: 'local',
      local: { rootDir: '.objectstack/data/uploads' },
    });
  });

  it('never emits the keys the plugin ignores', () => {
    // The regression guard proper: `{driver, root}` type-checks fine as an
    // argument and does nothing at runtime.
    const { options } = resolveStorageCapabilityArg();
    expect(options).not.toHaveProperty('driver');
    expect(options).not.toHaveProperty('root');
  });

  // Renamed from "honours OS_STORAGE_ROOT" (#4968): this case never read env,
  // it passes the root as an argument. Naming it after a variable it does not
  // touch is how the env channel went unexamined while the shape looked pinned.
  it('honours an explicit root, which the old shape discarded', () => {
    const { options, localRoot } = resolveStorageCapabilityArg('/srv/uploads');
    expect(options).toEqual({ adapter: 'local', local: { rootDir: '/srv/uploads' } });
    expect(localRoot).toBe('/srv/uploads');
  });

  it('ignores a blank or whitespace-only env root', () => {
    for (const blank of ['', '   ']) {
      expect(resolveStorageCapabilityArg(blank).options).toEqual({
        adapter: 'local',
        local: { rootDir: '.objectstack/data/uploads' },
      });
    }
  });

  it('reports the local root the production warning names', () => {
    // The warning quotes this, so it has to be the directory actually in use —
    // it previously named a root the adapter was not using.
    expect(resolveStorageCapabilityArg().localRoot).toBe('.objectstack/data/uploads');
    expect(resolveStorageCapabilityArg('/srv/x').localRoot).toBe('/srv/x');
  });

  it('does not read config.storage at all — it was never a stack key (#4167)', () => {
    // `ObjectStackDefinitionSchema` does not declare `storage`, and is not
    // `.strict()`, so `defineStack` strips it before serve could see it. Reading
    // it here made the same authoring key work on the one path that skips
    // `defineStack` and vanish on every documented one. The signature no longer
    // accepts it; `lintUnknownAuthoringKeys` now tells the author instead.
    expect(resolveStorageCapabilityArg.length).toBe(1);
  });

});

/**
 * #4968 — the env CHANNEL, which #4096 left split.
 *
 * #4096 pinned the option shape and the tests above went green, but the value
 * still could not reach the settings service: the CLI wrote `OS_STORAGE_ROOT`
 * and the settings service reads `envKeyOf('storage','local_root')` =
 * `OS_STORAGE_LOCAL_ROOT`, which nothing in the repo ever set. So settings saw
 * only the manifest's schema default and swapped the adapter at `kernel:ready`
 * — `OS_STORAGE_ROOT` took effect for exactly one value (the one equal to that
 * default) and `dev --fresh` wrote uploads into the project cwd.
 *
 * The stamp assertion is the load-bearing one. Returning the legacy value is
 * only half the migration; if the canonical name is not also SET, a deployment
 * on the old spelling keeps the original bug in full, silently.
 */
describe('resolveStorageLocalRootEnv (#4968)', () => {
  const CANONICAL = 'OS_STORAGE_LOCAL_ROOT';
  const LEGACY = 'OS_STORAGE_ROOT';
  const originalCanonical = process.env[CANONICAL];
  const originalLegacy = process.env[LEGACY];

  afterEach(() => {
    if (originalCanonical === undefined) delete process.env[CANONICAL];
    else process.env[CANONICAL] = originalCanonical;
    if (originalLegacy === undefined) delete process.env[LEGACY];
    else process.env[LEGACY] = originalLegacy;
    _resetEnvDeprecationWarnings();
    vi.restoreAllMocks();
  });

  it('reads the canonical name the settings service derives, quietly', () => {
    delete process.env[LEGACY];
    process.env[CANONICAL] = '/srv/uploads';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveStorageLocalRootEnv()).toBe('/srv/uploads');
    expect(warn).not.toHaveBeenCalled();
    // The whole point: this is the name `envKeyOf('storage','local_root')`
    // produces, so the settings service resolves source:'env' at this value.
    expect(process.env[CANONICAL]).toBe('/srv/uploads');
  });

  it('still reads the legacy name AND stamps it onto the canonical one', () => {
    delete process.env[CANONICAL];
    process.env[LEGACY] = '/srv/legacy-uploads';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveStorageLocalRootEnv()).toBe('/srv/legacy-uploads');
    // Without this line a legacy deployment keeps the exact defect #4968
    // describes: adapter built at /srv/legacy-uploads, settings still on its
    // schema default, adapter swapped away at kernel:ready.
    expect(process.env[CANONICAL]).toBe('/srv/legacy-uploads');

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain(LEGACY);
    expect(msg).toContain(CANONICAL);
    expect(msg).toContain('deprecated');
  });

  it('feeds the capability arg from the legacy name end to end', () => {
    delete process.env[CANONICAL];
    process.env[LEGACY] = '/srv/legacy-uploads';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { options, localRoot } = resolveStorageCapabilityArg(resolveStorageLocalRootEnv());
    expect(options).toEqual({ adapter: 'local', local: { rootDir: '/srv/legacy-uploads' } });
    expect(localRoot).toBe('/srv/legacy-uploads');
    // Constructor side and settings side now name the same directory, which is
    // what makes `needsStorageSwap` answer false instead of swapping + warning.
    expect(process.env[CANONICAL]).toBe(localRoot);
  });

  it('lets the canonical name win when both are set, without warning', () => {
    process.env[CANONICAL] = '/srv/canonical';
    process.env[LEGACY] = '/srv/legacy';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveStorageLocalRootEnv()).toBe('/srv/canonical');
    expect(process.env[CANONICAL]).toBe('/srv/canonical');
    // The stamp must never overwrite an explicitly-set canonical value, and the
    // legacy variable is left exactly as the operator wrote it.
    expect(process.env[LEGACY]).toBe('/srv/legacy');
    expect(warn).not.toHaveBeenCalled();
  });

  it('sets nothing when neither name is set, so the default still applies', () => {
    delete process.env[CANONICAL];
    delete process.env[LEGACY];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveStorageLocalRootEnv()).toBeUndefined();
    // Must NOT stamp a default: an env-locked value would show up in Setup as
    // locked-by-env and take the root out of the admin's hands for no reason.
    expect(process.env[CANONICAL]).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    // Unset falls through to the resolver default, which equals the manifest
    // default — this is exactly why plain `pnpm dev` never showed the bug.
    expect(resolveStorageCapabilityArg(resolveStorageLocalRootEnv()).localRoot)
      .toBe('.objectstack/data/uploads');
  });
});
