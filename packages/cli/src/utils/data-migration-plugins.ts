// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveStorageCapabilityArg, resolveStorageLocalRootEnv } from '../commands/serve.js';

/**
 * The plugins a gated data migration boots with.
 *
 * Every gated migration needs the `sys_migration` flag ledger (#3617), and
 * that is all most of them need: it is registered by `PlatformObjectsPlugin`
 * — platform infrastructure, present with or without any optional service
 * (#4243). `os migrate value-shapes` boots exactly that.
 *
 * Only the FILE migration (`os migrate files-to-references`) also needs
 * `sys_file` plus the deployment's REAL storage adapter — it reconciles what
 * records claim against what storage actually holds, so a root that disagrees
 * with the server's reconciles against the wrong tree. `storage: true` adds:
 *
 *  - Settings first: the storage plugin re-resolves its adapter from
 *    persisted settings when a settings service is present, which is how an
 *    S3-configured deployment's backfill uploads land in S3 rather than on
 *    this machine.
 *  - Storage config through the SAME resolver `os serve` uses
 *    (`resolveStorageCapabilityArg`), fed by the SAME env channel
 *    (`resolveStorageLocalRootEnv`, #4968), so the CLI materialises bytes
 *    exactly where the server would. Reading `process.env.OS_STORAGE_ROOT`
 *    here instead would reintroduce the split that made the settings service
 *    swap the adapter out from under the root the operator named.
 */
export async function buildDataMigrationPlugins(
  opts: { storage?: boolean; automation?: boolean } = {},
): Promise<unknown[]> {
  const plugins: unknown[] = [];
  const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
  plugins.push(new PlatformObjectsPlugin());
  if (opts.automation === true) {
    // `os migrate meta --stored` needs the automation ENGINE, never the
    // automation RUNTIME (#4454). Flow-node conversions carry ADR-0078's
    // open-namespace conflict guard, which consults the live executor registry
    // to tell a rename from a clobber — and only this plugin has that registry.
    //
    // `armRuntime: false` is what makes taking it safe: the engine and the full
    // node registry come up (built-ins plus whatever `automation:ready`
    // contributes, because a PARTIAL registry would make the guard rewrite over
    // a live custom node type instead of refusing), and then nothing is armed —
    // no flow registered, no record trigger or scheduled job bound, no
    // declarative connector materialized, no suspended run resumed. A migration
    // process must not become a second server.
    const { AutomationServicePlugin } = await import('@objectstack/service-automation');
    plugins.push(new AutomationServicePlugin({ armRuntime: false, suspendedRunStore: 'memory' }));
  }
  if (opts.storage === true) {
    try {
      const { SettingsServicePlugin } = await import('@objectstack/service-settings');
      plugins.push(new SettingsServicePlugin({ registerRoutes: false }));
    } catch {
      // optional — without it, constructor/env-driven storage config still applies
    }
    const { StorageServicePlugin } = await import('@objectstack/service-storage');
    const { options } = resolveStorageCapabilityArg(resolveStorageLocalRootEnv());
    plugins.push(new StorageServicePlugin({ ...options, registerRoutes: false }));
  }
  return plugins;
}
