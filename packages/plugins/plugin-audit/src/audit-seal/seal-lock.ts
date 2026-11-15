// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0154 D3 as amended (seat ruling 6885005594, E + B) — the audit seal
 * lock's contract: its name, its Postgres key and its wait. The lock itself
 * lands with the commit after the pins that hold it.
 */

export const AUDIT_SEAL_LOCK_NAME = 'objectstack:audit-seal';
export const AUDIT_SEAL_PG_LOCK_KEY = '-5564991198496822599';
export const AUDIT_SEAL_LOCK_WAIT_MS = 10 * 60_000;

/** The engine surface a hold reads. */
export interface AuditSealLockEngine {
  registry: { getAllObjects(): ReadonlyArray<{ name: string; lifecycle?: unknown }> };
  getDriverForObject(name: string): unknown;
}

/** Not built yet. */
export async function holdAuditSealLock(_engine: AuditSealLockEngine, _options: unknown): Promise<{ finish(): Promise<{ lost: boolean; line?: string }> }> {
  throw new Error('holdAuditSealLock: not built yet');
}
