// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0068 D2 platform-admin gate, in ONE place.
 *
 * Every ObjectStack raw `/admin/*` mount owns its own authorization, because
 * better-auth's `admin` plugin cannot be pointed at ObjectStack's predicate.
 * That is a MEASURED property of the installed vendor version, not an
 * assumption — see `admin-ban-endpoints.ts` for the measurement, and
 * `auth-manager.ts` for the `positions[]` derivation this reads.
 *
 * Before this module the gate existed as four near-identical inline copies
 * (`/admin/oauth2/toggle-disabled`, `/admin/unlock-user`, and the shared
 * `gateAdmin` behind `/admin/create-user` + `/admin/set-user-password` +
 * `/admin/import-users`). N copies of an authorization predicate is the shape
 * that drifts: the next mount is written by copying whichever copy the author
 * happened to open. One exported judge, called by every mount, is the fix —
 * and it is what lets a new signal be added in a single edit.
 *
 * ⛔ `user.role === 'admin'` is accepted ONLY as the legacy fallback it has
 * always been here. It is NOT synthesized, and nothing in ObjectStack writes
 * it for a platform admin (ADR-0068 D2; re-synthesizing it is permanently
 * vetoed by the maintainer's 2026-08-18 ruling). It stays readable so a
 * deployment that still carries the scalar from before D2 is not locked out.
 *
 * ## A held session is refused here too (ADR-0069 D3)
 *
 * The platform-admin surface is a protected resource, and ADR-0069 D3 gates a
 * held session (an expired or administrator-forced password, enforced MFA not
 * yet enrolled) out of every protected resource until it remediates. These
 * mounts sit under the auth namespace on the raw host app, so neither ADR-0069
 * transport seam (the REST server, the runtime dispatcher) ever sees them:
 * measured on a real boot, a held platform admin was refused on a data read
 * and admitted to every mount judged here, in both held states. So the judge
 * consults the gate's ONE shared decision, `evaluateAuthGate`, exactly as the
 * other raw route families do at their own doors, and every mount that calls
 * the judge is covered without re-implementing it.
 *
 * ⛔ No request path is passed. The empty path is the shared allow-list's
 * declared fail-closed input, so no mount can earn an exemption here. Passing
 * the real path would let this family inherit the auth-namespace exemption,
 * which exists so a held user can remediate (change-password, two-factor
 * enrollment, sign-out) and was never a declaration about administration.
 * None of those remediation endpoints is judged here, so none changes.
 *
 * ## The same refusal at the vendor-served doors
 *
 * Three platform-admin doors are served by better-auth itself rather than by a
 * raw mount, so this judge never runs there: the re-authorized impersonation
 * endpoint (`admin-impersonate-endpoint.ts`), SSO-provider administration
 * (registration, and an owner's update and delete), and the `admin` plugin's
 * own role-scalar actions (both in `auth-manager.ts`'s global before-hook). Their session is a raw better-auth
 * read that `customSession` never decorates, so it carries no `authGate`.
 * Each door therefore asks the auth service for the acting user's posture —
 * the same computation, and the same first entry, that `customSession` puts on
 * a session (`resolveUserAuthGates`, ADR-0069 · #23287 ruling C′ item 3) — and
 * hands it to {@link judgeHeldSession}, the refusal this judge gives. One
 * posture computation, one decision, one refusal body, at every door.
 */

import { evaluateAuthGate } from '@objectstack/core';

/** The caller a passing gate hands back to the route. */
export interface PlatformAdminActor {
  id: string;
  email?: string;
}

/** ADR-0112 refusal envelope — the ObjectStack shape, not better-auth's. */
export interface PlatformAdminRefusal {
  status: 401 | 403;
  body: { success: false; error: { code: string; message: string } };
}

export type PlatformAdminVerdict =
  | { ok: true; actor: PlatformAdminActor }
  | { ok: false; refusal: PlatformAdminRefusal };

/**
 * The human half of the two refusals, keyed by the status that carries them.
 *
 * Lifted out of `judgePlatformAdmin` (whose bytes are unchanged) so the
 * better-auth-native `/admin/` lane can answer an anonymous caller with the
 * SAME body rather than a second string that merely looks the same today —
 * see `vendor-admin-refusal-envelope.ts` (#10349). The machine half is not
 * duplicated anywhere: it is ADR-0112's own derived-code map,
 * `standardErrorCodeForHttpStatus`.
 */
export const PLATFORM_ADMIN_REFUSAL_MESSAGES: Readonly<Record<401 | 403, string>> = {
  401: 'Sign in first',
  403: 'Admin role required',
};

/**
 * Is this session user a platform admin under ADR-0068 D2?
 *
 * Reads the derived `isPlatformAdmin` alias `customSession` contributes — which
 * is the ADR-0095 D3 posture RUNG, not a name — plus the legacy `role` scalar as
 * the back-compat fallback described above.
 *
 * ⛔ [#15136] It does NOT read `platform_admin` from `positions[]`, and that leg
 * was REMOVED rather than merely left unused. `positions[]` is the security axis
 * (ruling A), so it carries ADR-0057 D4 `sys_user_position` names — and
 * `sys_user_position` is `apiEnabled`, writable by a tenant admin outright and by
 * a delegate whose bound-set test passes vacuously for a position carrying no
 * position-bound set. A row spelled `platform_admin` would therefore have made
 * this predicate — and so the `/admin/*` mount gate below — admit a principal
 * that `hasPlatformAdminStanding` refuses. The array read was defensible only
 * while `positions` carried the auth axis, where nothing a tenant writes could
 * put that word in it; it is the exact form `resolve-authz-context.ts` forbids.
 *
 * Exported separately from `judgePlatformAdmin` so a caller that already holds
 * a session (a test, a hook) can ask the question without building an
 * envelope.
 */
export function isPlatformAdminUser(sessionUser: unknown): boolean {
  const u = sessionUser as Record<string, unknown> | null | undefined;
  if (!u) return false;
  if (u.isPlatformAdmin === true) return true;
  return u.role === 'admin';
}

/**
 * ADR-0069 D3 — the refusal a held session meets on the platform-admin
 * surface, or `null` when `sessionUser` holds no posture.
 *
 * `sessionUser` is anything carrying the session gate's posture carrier,
 * `authGate` (the first entry of `resolveUserAuthGates`, as `customSession`
 * stamps it). The decision is the gate's own, `evaluateAuthGate`, consulted
 * pathless for the reason the module header gives, so every posture code holds,
 * whatever its scope: a session IS the password sign-in (#23287, ruling C′
 * item 1), and the session gate refuses each code on every route outside its
 * remediation allow-list. The body is the one {@link judgePlatformAdmin}
 * answers: `403`, the posture's own `code` and `message` (its remediation
 * pointer), in the ADR-0112 envelope. No code of its own.
 */
export function judgeHeldSession(sessionUser: unknown): PlatformAdminRefusal | null {
  const held = evaluateAuthGate(sessionUser, '');
  if (!held) return null;
  return {
    status: 403,
    body: { success: false, error: { code: held.code, message: held.message } },
  };
}

/**
 * Judge a resolved session for a platform-admin-only route.
 *
 * `session` is what `auth.api.getSession({ headers })` returned — that call
 * goes through the `customSession` override, which is why `positions[]` and
 * `isPlatformAdmin` are present on `session.user` at all.
 *
 * The two refusals are deliberately distinct and are asserted as such by the
 * dogfood sweep: anonymous is 401 `UNAUTHENTICATED` (we do not know who you
 * are), a signed-in non-admin is 403 `PERMISSION_DENIED` (we do, and the
 * answer is no). Collapsing them into one status would make the sweep unable
 * to tell "the payload never reached the gate" from "the gate said no".
 *
 * A held session is refused between the two, with `403` and the gate's own
 * `code` and `message` (`AuthGateCodeSchema`): identity first,
 * then the authentication-policy posture, then authorization, the order the
 * REST and dispatcher seams already apply. A held non-admin therefore reads
 * the posture refusal rather than `PERMISSION_DENIED`, the same 403 status.
 */
export function judgePlatformAdmin(session: unknown): PlatformAdminVerdict {
  const user = (session as { user?: unknown } | null | undefined)?.user as
    | Record<string, unknown>
    | undefined;

  if (!user?.id) {
    return {
      ok: false,
      refusal: {
        status: 401,
        body: {
          success: false,
          error: { code: 'UNAUTHENTICATED', message: PLATFORM_ADMIN_REFUSAL_MESSAGES[401] },
        },
      },
    };
  }

  // ADR-0069 D3: the gate's shared decision, pathless (see the header).
  const held = judgeHeldSession(user);
  if (held) return { ok: false, refusal: held };

  if (!isPlatformAdminUser(user)) {
    return {
      ok: false,
      refusal: {
        status: 403,
        body: {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: PLATFORM_ADMIN_REFUSAL_MESSAGES[403] },
        },
      },
    };
  }

  return {
    ok: true,
    actor: {
      id: String(user.id),
      email: typeof user.email === 'string' ? user.email : undefined,
    },
  };
}
