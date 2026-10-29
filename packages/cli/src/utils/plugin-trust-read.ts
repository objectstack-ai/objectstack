// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { TRUSTED_KEY_OBJECT, resolveTrustedKey, type TrustedKeyResolution } from '@objectstack/runtime';
import { isExitSignal } from './format.js';
import { bootSchemaStack } from './schema-migrate.js';
import { absentTableReads } from './absent-table-reads.js';
import { NO_TRUST_STORE_ENGINE, trustStoreEngine, trustStorePlugins } from './plugin-trust-store.js';

/**
 * The ONE read of an environment's trusted plugin-publisher keys that a
 * signature is verified against (ADR-0025 §3.5 M1): `os plugin install` asks it
 * for the key its artifact names, and `os serve`'s boot-time loader asks it
 * for every key the installed plugins name, so an install and every later boot
 * of it trust the same store the same way.
 *
 * It boots the environment's database READ-ONLY (`deferSchemaDdl` +
 * `readOnlyProbe`), once for all the key ids, and shuts the boot down before it
 * answers. `os serve` asks before its own kernel bootstraps: the kernel takes
 * no plugin after that, and the keys are what decide which installed plugins
 * it takes. A table the boot measured absent has never trusted a key, so every
 * id is unknown there.
 *
 * The one member of the `bootSchemaStack` family that is a utility, not a
 * command: `schema-migrate.one-shot-family.integration.test.ts` runs its boot
 * through `os plugin install`.
 */
export type TrustedKeysRead =
  | { ok: true; keys: Map<string, TrustedKeyResolution> }
  | { ok: false; error: 'boot_failed' | 'no_engine' | 'trusted_keys_unreadable'; message: string };

export async function readTrustedKeys(
  keyIds: readonly string[],
  opts: { databaseUrl?: string; json: boolean },
): Promise<TrustedKeysRead> {
  const keys = new Map<string, TrustedKeyResolution>();
  if (keyIds.length === 0) return { ok: true, keys };
  let stack;
  try {
    stack = await bootSchemaStack({
      jsonOutput: opts.json,
      databaseUrl: opts.databaseUrl,
      extraPlugins: await trustStorePlugins(false),
      deferSchemaDdl: true,
      readOnlyProbe: true,
    });
  } catch (error) {
    return { ok: false, error: 'boot_failed', message: error instanceof Error ? error.message : String(error) };
  }
  try {
    const engine = trustStoreEngine(stack);
    if (!engine) return { ok: false, error: 'no_engine', message: NO_TRUST_STORE_ENGINE };
    const reads = absentTableReads(stack);
    if (reads.absent(TRUSTED_KEY_OBJECT)) {
      reads.notice(opts.json);
      for (const keyId of keyIds) keys.set(keyId, { verdict: 'unknown' });
      return { ok: true, keys };
    }
    for (const keyId of keyIds) keys.set(keyId, await resolveTrustedKey(engine, keyId));
    return { ok: true, keys };
  } catch (error) {
    if (isExitSignal(error)) throw error;
    return {
      ok: false,
      error: 'trusted_keys_unreadable',
      message: `Cannot read this environment's trusted keys: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await stack.shutdown();
  }
}
