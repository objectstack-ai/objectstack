// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveStorageCapabilityArg } from '../commands/serve.js';

/**
 * The service plugins a gated data migration boots with, so the kernel carries
 * `sys_migration` (the deployment-level flag ledger) — and, for the file
 * migration, `sys_file` plus the deployment's REAL storage adapter.
 *
 * Settings first: the storage plugin re-resolves its adapter from persisted
 * settings when a settings service is present, which is how an S3-configured
 * deployment's backfill uploads land in S3 rather than on this machine.
 * Storage config goes through the SAME resolver `os serve` uses
 * (`resolveStorageCapabilityArg`), so the CLI materialises bytes exactly where
 * the server would. It did not, and that mattered more here than anywhere: the
 * file migration reconciles what records claim against what storage actually
 * holds, so a root that disagrees with the server's reconciles against the
 * wrong tree.
 *
 * ⚠️ `sys_migration` is registered by the STORAGE plugin (its first consumer),
 * which is why a migration with nothing to do with files still boots it. That
 * coupling is not this module's to fix — the ledger is platform infrastructure
 * and should not be owned by an optional service — but until it moves, every
 * gated migration boots the same set so they all find the same ledger. Tracked
 * separately; `os serve` auto-wires storage, so a served deployment always has
 * it registered and the runtime gates can read their flags.
 */
export async function buildDataMigrationPlugins(): Promise<unknown[]> {
  const plugins: unknown[] = [];
  try {
    const { SettingsServicePlugin } = await import('@objectstack/service-settings');
    plugins.push(new SettingsServicePlugin({ registerRoutes: false }));
  } catch {
    // optional — without it, constructor/env-driven storage config still applies
  }
  const { StorageServicePlugin } = await import('@objectstack/service-storage');
  const { options } = resolveStorageCapabilityArg(process.env.OS_STORAGE_ROOT);
  plugins.push(new StorageServicePlugin({ ...options, registerRoutes: false }));
  return plugins;
}
