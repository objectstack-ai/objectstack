// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16569] `GET /organization/list-user-invitations` — the invitation inbox
 * needs a verified email address, on every deployment.
 *
 * ## The rule
 *
 * A session whose address is not verified is refused, `403
 * EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION`, so the listing never hands an
 * invitation's id to an identity that has not proven the invited mailbox. It
 * is the listing's half of the rule `invitation-accept-verified-email.ts`
 * states for accepting and declining; `get-invitation` alone stays open to the
 * recipient, so the accept page can name the invitation.
 *
 * ## Why the host owns it
 *
 * The platform declares `requireEmailVerificationOnInvitation: false`
 * (`auth-manager-organization-plugin.ts`) so that `get-invitation` stays open:
 * better-auth's option governs accept, reject and get-invitation together.
 * better-auth 1.7.12's own `listUserInvitations`
 * (`dist/plugins/organization/routes/crud-invites.mjs`) never reads that
 * option and refuses an unverified session unconditionally — the rule this
 * module wants. Rebuilding the endpoint with the refusal written here makes
 * the rule this plugin's: no vendor release that teaches its listing to read
 * the option can open the inbox under the declaration above.
 * `list-user-invitations-verification.test.ts` pins the vendor's handler as
 * it stands, so a change upstream is seen.
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
 * ## What differs from the vendor handler — nothing a caller can see
 *
 * Today the rebuilt handler answers exactly as the vendor's does: the same
 * refusal for an unverified session, at the same point (after the client-side
 * `?email=` refusal, before the listing is read). What differs is who owns
 * the refusal.
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
 * Replace `organization`'s `/organization/list-user-invitations` with an
 * endpoint that refuses a session whose address is not verified, in place, on
 * the plugin's own `endpoints` record.
 *
 * `options` MUST be the very object handed to `organization(options)`: it is
 * what the vendor's own `getOrgAdapter(ctx.context, options)` reads.
 *
 * Returns the SAME plugin object (mutated), so the plugin's id, schema, hooks,
 * `$ERROR_CODES` and every other endpoint stay exactly as the vendor built
 * them, and only one plugin ever claims the path.
 *
 * A vendor bump that renames or drops the endpoint leaves the plugin untouched
 * and reports `false` — loudly handled by the caller — rather than silently
 * adding a second endpoint nobody routes to.
 */
export async function requireVerifiedAddressOnListing(
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

      // ── the rule: an unverified session lists nothing ────────────────────
      if (session && !session.user.emailVerified) {
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
