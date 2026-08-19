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
 */

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
 * Is this session user a platform admin under ADR-0068 D2?
 *
 * Reads the canonical signals `customSession` contributes — the derived
 * `isPlatformAdmin` alias and `platform_admin` in `positions[]` — plus the
 * legacy `role` scalar as the back-compat fallback described above.
 *
 * Exported separately from `judgePlatformAdmin` so a caller that already holds
 * a session (a test, a hook) can ask the question without building an
 * envelope.
 */
export function isPlatformAdminUser(sessionUser: unknown): boolean {
  const u = sessionUser as Record<string, unknown> | null | undefined;
  if (!u) return false;
  if (u.isPlatformAdmin === true) return true;
  if (Array.isArray(u.positions) && u.positions.includes('platform_admin')) return true;
  return u.role === 'admin';
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
        body: { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in first' } },
      },
    };
  }

  if (!isPlatformAdminUser(user)) {
    return {
      ok: false,
      refusal: {
        status: 403,
        body: { success: false, error: { code: 'PERMISSION_DENIED', message: 'Admin role required' } },
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
