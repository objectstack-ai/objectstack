// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16569] `GET /organization/list-user-invitations` — honour the DECLARED
 * `requireEmailVerificationOnInvitation`, exactly as `accept-invitation`,
 * `reject-invitation` and `get-invitation` already do.
 *
 * ## The defect, and where it is minted
 *
 * Not here: it comes out of the pinned vendor. Measured against the installed
 * better-auth `1.7.2`, `dist/plugins/organization/routes/crud-invites.mjs`:
 * the three id-addressed routes ask
 * `shouldRequireVerifiedEmailForInvitationIdAction({ organizationOptions, … })`,
 * whose first line is
 *
 * ```js
 * if (organizationOptions.requireEmailVerificationOnInvitation !== void 0)
 *   return organizationOptions.requireEmailVerificationOnInvitation;
 * ```
 *
 * while `listUserInvitations` never asks — its handler reads
 *
 * ```js
 * if (session && !session.user.emailVerified)
 *   throw APIError.from("FORBIDDEN", ORGANIZATION_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION);
 * ```
 *
 * unconditionally. `auth-manager.ts` declares the option `false` on purpose
 * (no mailer wired ⇒ nothing can ever verify an invitee ⇒ requiring
 * verification dead-ends every invite flow), so on exactly the deployment
 * shape the option exists for an invitee can ACCEPT an invitation and can
 * never LIST it, and the SDK's `organizations.invitations.listMine()` inbox
 * is empty-by-403 for every user. `list-user-invitations-verification.test.ts`
 * measures both halves on the real pipeline — the 403, and the 200s from the
 * three siblings for the same unverified session — and pins that the vendor
 * still has the defect, so an upstream fix turns that pin red and this module
 * is what gets deleted.
 *
 * ## Why this shape: the endpoint is rebuilt IN PLACE, from the vendor's own options
 *
 * The same door `admin-impersonate-endpoint.ts` takes, for the same reasons:
 *
 *  - **One route, one owner.** The endpoint is replaced on the organization
 *    plugin's own `endpoints` record under the vendor's own key, so exactly one
 *    plugin ever registers the path — `checkEndpointConflicts` sees one entry
 *    and logs nothing — and `auth.api.listUserInvitations` IS this endpoint.
 *  - **Every hook keyed on the path still fires.** A global before-hook that
 *    answered the listing itself would short-circuit better-auth's dispatch
 *    before `runAfterHooks` (`dist/api/dispatch.mjs` returns the before-hook's
 *    response without running them), silently detaching the `bearer()`
 *    plugin's `set-auth-token` echo and every ObjectStack after-hook from this
 *    route. Rebuilding the endpoint keeps the full pipeline.
 *  - **No second copy of the request contract.** The vendor endpoint's OWN
 *    `options` object (`method`, the `query` schema with its `email` field,
 *    `use: [orgMiddleware]`, the OpenAPI entry) is handed straight back to
 *    `createAuthEndpoint`, so nothing about the contract is retyped and nothing
 *    about it can drift on a dependency bump.
 *
 * ## No second definition of a security filter
 *
 * "Which invitations may this session see" is answered by the vendor's own
 * exported `getOrgAdapter(ctx.context, options).listUserInvitations(email)` —
 * the identical call the vendor handler makes — keyed on the SESSION's email,
 * followed by the vendor's own `status === "pending"` post-filter. This module
 * writes no query, joins nothing and reads no other table. The two guards that
 * keep the listing from widening into "list by organization" or "fetch by
 * address" are the vendor's, carried verbatim and in the vendor's order: a
 * client-side `?email=` is refused with the vendor's 400 BEFORE the session is
 * consulted, and a request with neither session nor email is refused with the
 * vendor's 400 AFTER it.
 *
 * ## What actually changed vs. the vendor handler — ONE predicate
 *
 * The verification refusal is asked through {@link listingRequiresVerifiedEmail}
 * instead of unconditionally. That predicate honours the DECLARED option only:
 *
 *  - `false` → the listing is open to an unverified session — the declared
 *    posture, and the one `accept` / `reject` / `get-invitation` already apply
 *    to the same session on this deployment;
 *  - `true` → refused, byte-identical to the vendor's answer today;
 *  - undeclared (or any non-boolean) → refused, the vendor's own list-route
 *    posture. The siblings derive an undeclared option from
 *    `hasBuiltInOpaqueInvitationIdGeneration(...)`, a vendor internal this
 *    module deliberately refuses to re-implement: honouring what is DECLARED
 *    restores `declared = enforced`; re-deriving an undeclared default would
 *    be a second definition of a security posture.
 *
 * Direction, stated: the accept set of this route GROWS only for a session the
 * deployment has explicitly declared exempt from verification, and only by the
 * rows the same session can already accept one by one. Nothing the vendor
 * refuses for any other reason is admitted.
 *
 * ## Refusal envelope — the vendor's, on purpose
 *
 * Refusals keep better-auth's flat `{ message, code }` shape and the vendor's
 * OWN code constant, read off the plugin's `$ERROR_CODES` rather than retyped
 * (the local restatement is a fallback the test pins equal to the vendor's).
 * No new public error code is minted, so nothing here reaches the spec
 * error-code ledger.
 */

import type { OrganizationOptions } from 'better-auth/plugins/organization';

/** The vendor's path for the per-user invitation inbox. */
export const LIST_USER_INVITATIONS_PATH = '/organization/list-user-invitations';

/** The slice of better-auth's `organization` plugin this module rewrites. */
export interface OrganizationPluginLike {
  id: string;
  endpoints: Record<string, any>;
  $ERROR_CODES?: Record<string, { code: string; message: string }>;
}

/**
 * better-auth's `ORGANIZATION_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION`,
 * restated locally as the fallback for a plugin object carrying no
 * `$ERROR_CODES`. The vendor does not export the constant from a public
 * entry; `list-user-invitations-verification.test.ts` pins this equal to the
 * plugin's own value, so a vendor rename turns that red.
 */
export const EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION = {
  code: 'EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION',
  message: 'Email verification required to view or list invitations for the session email',
} as const;

/**
 * Does the listing refuse an UNVERIFIED session? Honours the DECLARED option
 * only — see the module header for why an undeclared option is read as the
 * vendor's own list-route posture rather than re-derived.
 */
export function listingRequiresVerifiedEmail(
  options: Pick<OrganizationOptions, 'requireEmailVerificationOnInvitation'>,
): boolean {
  return options.requireEmailVerificationOnInvitation !== false;
}

/**
 * Replace `organization`'s `/organization/list-user-invitations` with the
 * declared-option-honouring endpoint, in place, on the plugin's own
 * `endpoints` record.
 *
 * `options` MUST be the very object handed to `organization(options)`: it is
 * what the vendor's own `getOrgAdapter(ctx.context, options)` reads, and the
 * declaration this module honours lives on it.
 *
 * Returns the SAME plugin object (mutated), so the plugin's id, schema, hooks,
 * `$ERROR_CODES` and every other endpoint stay exactly as the vendor built
 * them, and only one plugin ever claims the path.
 *
 * A vendor bump that renames or drops the endpoint leaves the plugin untouched
 * and reports `false` — loudly handled by the caller — rather than silently
 * adding a second endpoint nobody routes to.
 */
export async function applyDeclaredInvitationVerificationToListing(
  plugin: OrganizationPluginLike,
  options: OrganizationOptions,
): Promise<boolean> {
  const vendor = plugin?.endpoints?.listUserInvitations;
  if (!vendor || vendor.path !== LIST_USER_INVITATIONS_PATH || !vendor.options) return false;

  const [{ createAuthEndpoint, APIError, getSessionFromCtx }, { getOrgAdapter }] = await Promise.all([
    import('better-auth/api'),
    import('better-auth/plugins/organization'),
  ]);

  const verificationRequired =
    plugin.$ERROR_CODES?.EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION ??
    EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION;

  // The vendor's own options object — method, `query` schema, `use`
  // (orgMiddleware) and OpenAPI metadata — is handed straight back to
  // `createAuthEndpoint`. Nothing about the request contract is retyped here,
  // so nothing about it can drift.
  plugin.endpoints.listUserInvitations = createAuthEndpoint(
    LIST_USER_INVITATIONS_PATH,
    vendor.options,
    async (ctx: any) => {
      // ── the vendor handler, in the vendor's order ────────────────────────
      const session = await getSessionFromCtx(ctx);
      if (ctx.request && ctx.query?.email) {
        throw APIError.fromStatus('BAD_REQUEST', {
          message: 'User email cannot be passed for client side API calls.',
        });
      }

      // ── THE changed predicate: asked, not assumed ────────────────────────
      if (session && !session.user.emailVerified && listingRequiresVerifiedEmail(options)) {
        throw APIError.from('FORBIDDEN', verificationRequired);
      }

      // ── everything below is the vendor handler, unchanged ────────────────
      const userEmail = session?.user.email || ctx.query?.email;
      if (!userEmail) {
        throw APIError.fromStatus('BAD_REQUEST', {
          message: 'Missing session headers, or email query parameter.',
        });
      }
      const pendingInvitations = (
        await getOrgAdapter(ctx.context, options).listUserInvitations(userEmail)
      ).filter((inv: { status?: string }) => inv.status === 'pending');
      return ctx.json(pendingInvitations);
    },
  );

  return true;
}
