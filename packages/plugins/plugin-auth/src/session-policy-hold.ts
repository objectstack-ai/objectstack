// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30924] The authentication-policy hold a new session's `login` row records.
 *
 * `auth-session-audit.ts` carries the reasoning (module note: "A sign-in an
 * authentication policy holds"): an ADR-0069 D3 enforced-MFA hold is a posture
 * of a session that was minted, so it is recorded on that sign-in's own `login`
 * row as `context.reason` (the posture's machine code) and `context.rule` (the
 * policy's name), computed once, when the session is created.
 *
 * Package-internal on purpose: nothing re-exports this module, so the published
 * surface of `auth-session-audit.ts` (re-exported whole from the package index)
 * does not move.
 */

import { authGateScope, type AuthGate } from '@objectstack/core';
import type { AuthSessionAuditEventInput } from './auth-session-audit.js';

/**
 * The postures a `login` row records: the posture's machine code (an `AuthGate`
 * code, the code the session is answered with) → the policy rule that holds the
 * session. A posture absent here is not recorded. Extending it is one entry.
 */
export const AUDITED_SESSION_HOLD_RULES: Readonly<Record<string, string>> = Object.freeze({
  MFA_REQUIRED: 'mfa_required',
});

/** The hold a `login` row records. */
export interface SessionPolicyHold {
  /** The posture's machine code, e.g. `MFA_REQUIRED`. */
  reason: string;
  /** The policy that holds the session, e.g. `mfa_required`. */
  rule: string;
}

/**
 * The hold to record for a new session, or `undefined` when none of the
 * postures that hold it is one {@link AUDITED_SESSION_HOLD_RULES} records.
 *
 * `gates` is what `resolveUserAuthGates` answers for the session's user in the
 * session's active organization, most urgent first. Which of them hold THIS
 * session follows ADR-0069 D3 as amended, the split
 * `AuthManager.computeAuthGate` makes: every posture holds a session the user
 * signed in to themselves; only an `account`-scope posture holds an
 * impersonation session. The first posture that holds the session and has a
 * rule is recorded, so a user held by both a forced reset and enforced MFA has
 * the MFA hold recorded: the reset is not a posture this table records, and the
 * MFA requirement holds that session as well.
 */
export function sessionPolicyHoldOf(
  gates: readonly unknown[] | null | undefined,
  options: { impersonation?: boolean } = {},
): SessionPolicyHold | undefined {
  if (!Array.isArray(gates)) return undefined;
  for (const gate of gates) {
    const code = (gate as { code?: unknown } | null | undefined)?.code;
    if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(AUDITED_SESSION_HOLD_RULES, code)) continue;
    if (options.impersonation === true && authGateScope(gate as AuthGate) !== 'account') continue;
    return { reason: code, rule: AUDITED_SESSION_HOLD_RULES[code] };
  }
  return undefined;
}

/**
 * The `login` event with the hold recorded on it: `context.reason` and
 * `context.rule`, beside what `loginEventFor` already put there. No hold, or no
 * event, hands the event back unchanged.
 */
export function withSessionPolicyHold(
  event: AuthSessionAuditEventInput | null,
  hold: SessionPolicyHold | undefined,
): AuthSessionAuditEventInput | null {
  if (!event || !hold) return event;
  return { ...event, context: { ...(event.context ?? {}), reason: hold.reason, rule: hold.rule } };
}

/** The slice of a better-auth session row the hold is computed from. */
interface HeldSessionRow {
  userId?: unknown;
  activeOrganizationId?: unknown;
  impersonatedBy?: unknown;
}

/** The one per-user posture computation (`AuthManager.resolveUserAuthGates`). */
export type UserAuthGatesSource = (
  userId: string,
  options: { organizationId?: string },
) => Promise<readonly unknown[]>;

/**
 * The hold for a session row that was just created, asked of the same posture
 * computation the session gate asks, for the session's user in its active
 * organization. Never throws: a posture read that fails records no hold, which
 * is the gate's own fail-open direction (`resolveUserAuthGates` answers `[]`
 * on any lookup error), so the row never claims a hold the gate did not apply.
 */
export async function sessionPolicyHoldFor(
  session: HeldSessionRow | null | undefined,
  resolveUserAuthGates: UserAuthGatesSource | undefined,
): Promise<SessionPolicyHold | undefined> {
  const userId = typeof session?.userId === 'string' && session.userId ? session.userId : undefined;
  if (!userId || typeof resolveUserAuthGates !== 'function') return undefined;
  const organizationId =
    typeof session?.activeOrganizationId === 'string' && session.activeOrganizationId
      ? session.activeOrganizationId
      : undefined;
  const impersonation = typeof session?.impersonatedBy === 'string' && session.impersonatedBy.trim() !== '';
  try {
    const gates = await resolveUserAuthGates(userId, organizationId ? { organizationId } : {});
    return sessionPolicyHoldOf(gates, { impersonation });
  } catch {
    return undefined;
  }
}
