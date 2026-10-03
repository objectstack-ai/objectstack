// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveStorageCapabilityArg, resolveStorageLocalRootEnv } from '../commands/serve.js';
import { oneShotSettingsPlugin } from './one-shot-settings.js';

/**
 * The plugins a gated data migration boots with.
 *
 * Every gated migration needs the `sys_migration` flag ledger (#3617), and
 * that is all most of them need: it is registered by `PlatformObjectsPlugin`
 * — platform infrastructure, present with or without any optional service
 * (#4243). `os migrate value-shapes` boots exactly that, plus the
 * `MigrationRecoveryPlugin` every data boot carries (#21498). A journal-backed
 * run started here is resumed by `os migrate resume`, which boots this same set.
 *
 * Only the FILE migration (`os migrate files-to-references`) also needs
 * `sys_file` plus the deployment's REAL storage adapter — it reconciles what
 * records claim against what storage actually holds, so a root that disagrees
 * with the server's reconciles against the wrong tree. `storage: true` adds:
 *
 *  - Settings first: the storage plugin re-resolves its adapter from
 *    persisted settings when a settings service is present, which is how an
 *    S3-configured deployment's backfill uploads land in S3 rather than on
 *    this machine. [#21471] It is the one-shot composition
 *    (`./one-shot-settings.ts`): the settings service opens a stored
 *    credential with the data key this host already has, and never mints
 *    one in the key home — `os storage orphans` is report-only.
 *  - Storage config through the SAME resolver `os serve` uses
 *    (`resolveStorageCapabilityArg`), fed by the SAME env channel
 *    (`resolveStorageLocalRootEnv`, #4968), so the CLI materialises bytes
 *    exactly where the server would. Reading `process.env.OS_STORAGE_ROOT`
 *    here instead would reintroduce the split that made the settings service
 *    swap the adapter out from under the root the operator named.
 */
export async function buildDataMigrationPlugins(
  opts: { storage?: boolean; automation?: boolean; audit?: boolean } = {},
): Promise<unknown[]> {
  const plugins: unknown[] = [];
  const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
  plugins.push(new PlatformObjectsPlugin());
  // [#21498] The `migration-plans` registry (ADR-0119 D2), once per boot. The
  // plan's owner hands its plan over at `kernel:ready`
  // (`@objectstack/metadata-protocol` registers
  // `metadata.recorded-by-sentinel-to-null`), and `os migrate resume` looks it
  // up once the boot is done. Two processes never share a registry, so the
  // resume boot needs its own, filled by the plan's owner rather than by the
  // run being resumed.
  //
  // The plugin's journal scan rides along. Its measured effects here: a data
  // command booted over an interrupted run warns about that run on stderr
  // before it does anything else, and a read-only boot of a database that has no
  // journal table yet warns that it could not check. That database is one these
  // commands already refuse, because the tables they read are not there either.
  const { MigrationRecoveryPlugin } = await import('@objectstack/runtime');
  plugins.push(new MigrationRecoveryPlugin());
  if (opts.audit === true) {
    // [#21120] `os migrate audit-metadata-bodies` reads and rewrites
    // `sys_audit_log` / `sys_activity` rows, so their schema must be
    // registered — those objects are plugin-audit's, not platform-objects'.
    // The plugin's own write hooks exclude both tables (`SKIP_OBJECTS`), so
    // arming it cannot recurse on the rewrite; nothing else here is armed, the
    // same "a migration is not a second server" discipline the automation arm
    // takes above.
    const { AuditPlugin } = await import('@objectstack/plugin-audit');
    plugins.push(new AuditPlugin());
  }
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
      plugins.push(await oneShotSettingsPlugin());
    } catch {
      // optional — without it, constructor/env-driven storage config still applies
    }
    const { StorageServicePlugin } = await import('@objectstack/service-storage');
    const { options } = resolveStorageCapabilityArg(resolveStorageLocalRootEnv());
    plugins.push(new StorageServicePlugin({ ...options, registerRoutes: false }));
  }
  return plugins;
}
