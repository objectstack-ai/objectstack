// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * TEST SUPPORT for the [#11739] audience-posture gate — not part of the
 * published plugin surface (no tsup entry reaches it; only `*.test.ts` files
 * import it).
 *
 * Since #11739 the platform's DEFAULT audience posture is `invite_only`:
 * only the very first account (zero users — the bootstrap bypass) may
 * self-register on an undeclared config, and every further self-serve
 * sign-up needs a pending invitation, an allowlisted email domain, or an
 * `open` posture. The in-memory harness suites in this package create their
 * second/third fixture users through the real better-auth sign-up route, so
 * they enter the way real users now do: holding a pending invitation.
 *
 * This is deliberately the INVITATION lane rather than an `open` posture on
 * the fixture config: `open` (and `email_domain`) force
 * `requireEmailVerification` on, which stops sign-up from minting the very
 * sessions these suites exist to exercise — and the invitation lane keeps
 * the audience gate itself honestly on the path (the carve-out is a real
 * admission verdict, not a bypass).
 */

/** The memory-engine shape every harness in this package shares. */
interface TablesEngine {
  tables: Map<string, any[]>;
}

/**
 * Seed a pending, unexpired `sys_invitation` row for `email` so the audience
 * gate admits its self-serve sign-up. Idempotent enough for fixtures (each
 * call adds one pending row; the gate only asks "does one exist").
 *
 * Accepts either the engine itself or an `AuthManager` (whose
 * `config.dataEngine` is the engine) so each file's `signUp` helper can call
 * it with whatever it already holds. Two engine shapes are served:
 *
 *  - the `tables`-Map memory harness: seeded SYNCHRONOUSLY (safe to call
 *    without awaiting — the Map mutation completes before this returns);
 *  - a real `IDataEngine` (the sqlite/ObjectQL suites): seeded via
 *    `insert(...)` under the system context — AWAIT the returned promise
 *    there, or the seed races the sign-up.
 */
export function inviteForAudienceGate(engineOrManager: unknown, email: string): Promise<void> {
  const row = {
    id: `inv_audience_${Math.random().toString(36).slice(2, 10)}`,
    // [#11770] Stored NORMALIZED, because that is the only form the product
    // writes: `organization/invite-member` lowercases the address before it
    // reaches `createInvitation`, and the vendor's own reads
    // (`findPendingInvitation`, `listUserInvitations`) look it up with
    // `email.toLowerCase()`. A fixture holding the inviter's raw casing would
    // pin a row shape no invitation route can produce and no accept route
    // could redeem.
    email: email.trim().toLowerCase(),
    status: 'pending',
    // A dedicated org id so suites that count THEIR invitations per
    // organization never see these rows.
    organization_id: 'org_audience_gate',
    role: 'member',
    inviter_id: 'usr_audience_gate',
    expires_at: new Date(Date.now() + 3_600_000),
  };
  const tablesEngine = resolveTablesEngine(engineOrManager);
  if (tablesEngine) {
    const rows = tablesEngine.tables.get('sys_invitation') ?? [];
    tablesEngine.tables.set('sys_invitation', [...rows, row]);
    return Promise.resolve();
  }
  const engine = resolveInsertEngine(engineOrManager);
  if (!engine) return Promise.resolve();
  return Promise.resolve(
    engine.insert('sys_invitation', row, { context: { isSystem: true } }),
  ).then(() => undefined);
}

function resolveTablesEngine(engineOrManager: unknown): TablesEngine | null {
  const direct = engineOrManager as TablesEngine & { config?: { dataEngine?: TablesEngine } };
  if (direct?.tables instanceof Map) return direct;
  const viaManager = (direct as any)?.config?.dataEngine;
  if (viaManager?.tables instanceof Map) return viaManager;
  return null;
}

function resolveInsertEngine(
  engineOrManager: unknown,
): { insert: (name: string, data: any, options?: any) => Promise<unknown> } | null {
  const direct = engineOrManager as any;
  if (typeof direct?.insert === 'function') return direct;
  const viaManager = direct?.config?.dataEngine;
  if (typeof viaManager?.insert === 'function') return viaManager;
  return null;
}
