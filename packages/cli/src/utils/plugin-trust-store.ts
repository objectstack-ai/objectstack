// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { userInfo } from 'node:os';
import type { TrustedKeyEngine } from '@objectstack/runtime';
import type { SchemaStack } from './schema-migrate.js';

/**
 * What `os plugin trust add | list | revoke` and `os plugin install` share
 * around their one-shot boot of the environment's database (ADR-0025 §3.5
 * M1): which plugins the boot composes, and the engine handle the
 * `sys_trusted_key` store is read and written through
 * (`@objectstack/runtime`'s `plugin-trusted-keys.ts`).
 *
 * Each command calls `bootSchemaStack` itself, so each is a declared member of
 * the one-shot family (`schema-migrate.one-shot-family.integration.test.ts`).
 */

/**
 * The plugins the boot composes. `PlatformObjectsPlugin` registers
 * `sys_trusted_key`. A WRITE boot adds `AuditPlugin`, whose CRUD mirror records
 * the insert or the revoke in `sys_audit_log`: adding or revoking a trusted key
 * is an operator act on the environment's trust, so it leaves a ledger row.
 */
export async function trustStorePlugins(write: boolean): Promise<unknown[]> {
  const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
  const plugins: unknown[] = [new PlatformObjectsPlugin()];
  if (write) {
    const { AuditPlugin } = await import('@objectstack/plugin-audit');
    plugins.push(new AuditPlugin());
  }
  return plugins;
}

/** The booted engine, as the trusted-key store reads it, or `null` when the boot carries none. */
export function trustStoreEngine(stack: SchemaStack): TrustedKeyEngine | null {
  const engine = stack.kernel.getService('objectql') as Partial<TrustedKeyEngine> | undefined;
  if (!engine || typeof engine.find !== 'function' || typeof engine.insert !== 'function' || typeof engine.update !== 'function') {
    return null;
  }
  return engine as TrustedKeyEngine;
}

/** The refusal printed when {@link trustStoreEngine} finds no engine. */
export const NO_TRUST_STORE_ENGINE =
  'No ObjectQL engine on this boot, so the environment\'s trusted keys (`sys_trusted_key`) cannot be read or written.';

/**
 * Who is adding a key: the operating-system account running the command. The
 * CLI acts at the host with no platform session, so this is the identity the
 * act has. `null` when the platform cannot say (no passwd entry).
 */
export function operatorName(): string | null {
  try {
    const name = userInfo().username;
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
