// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24750 — `POST /organization/invite-member` refused a role outside the
 * closed membership vocabulary with a message and no `code`.
 *
 * ## The defect, at the seam
 *
 * better-auth's invite route checks the requested role against the static
 * roles (plus the organization's dynamic ones, when dynamic access control is
 * on) and throws
 *
 *     new APIError("BAD_REQUEST", { message: `${ROLE_NOT_FOUND}: ${unknownRoles}` })
 *
 * (`dist/plugins/organization/routes/crud-invites.mjs`, measured against the
 * installed better-auth `1.7.3`). Its sibling `update-member-role`
 * (`routes/crud-members.mjs`) throws the SAME refusal with
 * `code: ROLE_NOT_FOUND` beside the identical message — so one vendor
 * condition reached the wire coded on one door and uncoded on the other. The
 * spec promises the code on this door: the invitation schema's `role`
 * docstring (`identity/organization.zod.ts`) says a name outside the
 * vocabulary is "refused at the door (`ROLE_NOT_FOUND`) before any invitation
 * row exists", and an ADR-0112 client branches on `error.code`, never on prose.
 *
 * ## What this does
 *
 * Runs in the `after` hook, where better-auth hands the thrown `APIError` over
 * on `ctx.context.returned`, and re-throws THIS refusal — and only this one —
 * as `APIError('BAD_REQUEST', { code: 'ROLE_NOT_FOUND', message })` with the
 * vendor's own message, so the body is byte-for-byte what `update-member-role`
 * answers for the same condition. better-auth's hook runner replaces the
 * returned value with an `APIError` an after hook throws, so the status, the
 * message and the moment of the refusal (before any invitation row is written)
 * are the vendor's; only the missing `code` is added.
 *
 * Recognition is deliberately narrow: the invite path, a 400 `APIError`, no
 * `code` of its own, and a message that starts with the vendor's
 * `ROLE_NOT_FOUND: ` prefix. Every other refusal on the route — including any
 * future vendor release that codes this one itself — passes through untouched.
 * The vendored library is not patched.
 */

/** The published endpoint whose refusal this codes. */
export const INVITE_MEMBER_PATH = '/organization/invite-member';

/** The ADR-0112 code the spec's invitation `role` docstring promises. */
export const ROLE_NOT_FOUND_CODE = 'ROLE_NOT_FOUND';

/** better-auth's message prefix for this refusal: `ROLE_NOT_FOUND: <roles>`. */
const VENDOR_MESSAGE_PREFIX = `${ROLE_NOT_FOUND_CODE}: `;

/**
 * Re-throw invite-member's uncoded unknown-role refusal with
 * `code: 'ROLE_NOT_FOUND'`. A no-op on every other path and every other
 * answer. Call it LAST in the `after` hook: the throw ends the hook.
 */
export async function codeInviteRoleNotFound(ctx: any): Promise<void> {
  if (ctx?.path !== INVITE_MEMBER_PATH) return;
  const returned = ctx?.context?.returned;
  const { APIError, isAPIError } = await import('better-auth/api');
  if (!isAPIError(returned)) return;
  if (returned.statusCode !== 400) return;
  const body = returned.body as { code?: unknown; message?: unknown } | undefined;
  if (body?.code !== undefined) return;
  const message = body?.message;
  if (typeof message !== 'string' || !message.startsWith(VENDOR_MESSAGE_PREFIX)) return;
  throw new APIError('BAD_REQUEST', { code: ROLE_NOT_FOUND_CODE, message });
}
