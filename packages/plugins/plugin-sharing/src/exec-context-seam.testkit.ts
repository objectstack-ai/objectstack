// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5859] A REAL execution context for sharing tests — produced by the seam,
 * never hand-written.
 *
 * Why this exists: #5852's cross-organization escalation survived every unit
 * test in this package because those tests hand-built the context they fed in
 * (`{ userId, organizationId }`) — a shape the runtime NEVER produces. The
 * sharing service read `organizationId`, the transports write the caller's
 * active org onto `tenantId`, and no test could see the gap because each test
 * wrote both sides itself.
 *
 * So a test that wants to say something about tenancy must not name the
 * context's tenancy fields at all. This helper takes what a real deployment
 * actually holds — a better-auth session (`activeOrganizationId`) and
 * `sys_member` rows — and runs it through `resolveAuthzContext`, the SINGLE
 * shared authorization resolver (`@objectstack/core/security`) that BOTH HTTP
 * entry points delegate to (`packages/rest/src/rest-server.ts` and
 * `packages/runtime/src/security/resolve-execution-context.ts`). Whichever
 * field that resolver decides carries the active organization is the field the
 * test hands to the sharing service — so a rename, a drop, or a re-spelling of
 * the tenancy authority breaks these tests instead of silently disabling them.
 *
 * `.testkit.ts`, not `.test.ts`: it holds no assertions and must not be
 * collected as a suite. It is imported only by tests, so tsup (entry
 * `src/index.ts`) never bundles it into `dist`.
 */

import { resolveAuthzContext } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { TenancyPosture } from '@objectstack/spec/security';

/** A `sys_member` row as the identity tables really store it. */
export interface SeamMembership {
  organization_id: string;
  role?: string;
}

export interface SeamPrincipal {
  /** `sys_user.id` of the signed-in caller. */
  userId: string;
  email?: string;
  /**
   * better-auth `session.activeOrganizationId` — the ONE wire field a real
   * login carries the caller's active organization on (ADR-0093 D9 stamps it
   * from the user's `sys_member` row on session create). `null` reproduces a
   * membership-less / platform-scoped session.
   */
  activeOrganizationId?: string | null;
  /** `sys_member` rows for this user (defaults to one row per active org). */
  memberships?: SeamMembership[];
}

/** Minimal in-memory ObjectQL: `find(object, { where })` with `===` + `$in`. */
function makeSeamQl(tables: Record<string, any[]>) {
  return {
    async find(object: string, opts: any) {
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
    },
  };
}

/**
 * What the DEPLOYMENT holds, as opposed to what the principal holds.
 *
 * [#15349] Separate from {@link SeamPrincipal} on purpose: the tenancy posture
 * is a property of the deployment (the `tenancy` service a host registers),
 * never of the caller, and a test that reproduced it as a principal field would
 * be re-inventing at this seam the hand-built shape the file exists to refuse.
 */
export interface SeamDeployment {
  /**
   * The posture IN FORCE, exactly as a transport derives it from the `tenancy`
   * service and hands it to `resolveAuthzContext`. Omitted — the default — is
   * the honest reproduction of a host that registers no `tenancy` service at
   * all: `undefined` means "run no posture-conditional refusal", which is a
   * different fact from `'single'` (a posture that is present and enforces no
   * wall). Every existing caller therefore keeps a byte-identical envelope.
   *
   * Supply it to reach the refusals the resolver gates on it — the two API-key
   * ones and the session arm that drops an `activeOrganizationId` claim no
   * `sys_member` row backs. ⛔ A test cannot reach any of them by naming a
   * context field itself: the posture is an INPUT to the resolver, and the
   * whole point of this kit is that the test never writes the output.
   */
  tenancyPosture?: TenancyPosture;
}

/**
 * Resolve an execution context the way an inbound HTTP request does.
 *
 * The returned object is the authorization envelope `resolveAuthzContext`
 * produced, spread exactly as both transports spread it (plus
 * `isSystem: false`) — this helper never names a tenancy field, so neither does
 * the test that calls it.
 */
export async function bootRequestContext(
  principal: SeamPrincipal,
  deployment: SeamDeployment = {},
): Promise<ExecutionContext> {
  const activeOrg = principal.activeOrganizationId ?? null;
  const memberships: SeamMembership[] =
    principal.memberships ?? (activeOrg ? [{ organization_id: activeOrg, role: 'member' }] : []);

  const ql = makeSeamQl({
    sys_user: [{ id: principal.userId, email: principal.email }],
    sys_member: memberships.map((m, i) => ({
      id: `mem_${principal.userId}_${i}`,
      user_id: principal.userId,
      organization_id: m.organization_id,
      role: m.role ?? 'member',
    })),
    sys_user_position: [],
    sys_user_permission_set: [],
    sys_permission_set: [],
  });

  const authz = await resolveAuthzContext({
    ql,
    headers: new Headers(),
    // [#15349] The posture a transport supplies. Threaded rather than omitted
    // so this kit can reproduce a posture-conditional verdict at all; absent by
    // default, which is what a `tenancy`-less host really produces.
    tenancyPosture: deployment.tenancyPosture,
    // The better-auth session shape, as `AuthManager` hands it to the resolver.
    getSession: async () => ({
      user: { id: principal.userId, email: principal.email },
      session: { userId: principal.userId, activeOrganizationId: activeOrg },
    }),
  });

  // [#7136] Returned AS RESOLVED — no cast. This helper's whole promise is
  // that a test receives what a real request receives, and until the sharing
  // service's own parameters named the full envelope, keeping that promise
  // required forcing the real thing through `as unknown as` into a six-field
  // shape. A double cast on the value a test is meant to trust is the seam
  // lying about itself: it would have absorbed a genuine drift in
  // `resolveAuthzContext`'s output silently, which is the exact failure mode
  // (#5852) this file exists to prevent.
  return { ...authz, isSystem: false };
}
