// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under the `invite_only` audience posture, a self-serve email-and-password
 * sign-up is admitted only by the invitation it PRESENTS
 * (`invitationProofFor` in `audience-posture.ts` decides which creations this
 * applies to; this module answers whether the request presented one).
 *
 * ## What the request presents
 *
 * The invitation's id — the one its accept link ends with
 * (`invitationAcceptPath`, `/accept-invitation/<id>`) — as the
 * {@link SIGN_UP_INVITATION_ID_FIELD} body field, beside `email`, `password`
 * and `name`. The link is the proof: a live mailer delivers it to the invited
 * mailbox, and on a deployment without one the administrator hands it over
 * through `sys_invitation.copy_invitation_link`. An address alone is refused
 * like any uninvited sign-up, with the posture's own code and message.
 *
 * The body is a declared contract: `RegisterRequestSchema`
 * (`@objectstack/spec/api`) names the field. better-auth's sign-up body schema
 * is `z.object({...}).and(z.record(z.string(), z.any()))`, so the key survives
 * validation on `ctx.body` (the operator-provisioning ticket rides the same
 * catch-all), and the vendor's `parseUserInput` drops it before the row is
 * written, so it never becomes a `sys_user` column. The `/sign-up/email`
 * before-hook and the `user.validateUserInfo` gate are handed the same
 * endpoint context, so both read the same body and cannot disagree.
 *
 * ## What counts as presented ({@link isPresentedInvitationPending})
 *
 * The one `sys_invitation` row the id names, read under the system context, is
 * `pending`, before its `expires_at` (`isBeforeExpiry`: a missing or unreadable
 * expiry reads as expired, as the vendor's accept route reads it), and
 * addressed to the sign-up's own address, both sides trimmed and lowercased.
 * Everything else answers `false`: no id, an id that is not a non-empty
 * string, an unknown id, an expired or non-pending row, a row addressed to
 * another address, and a store that cannot answer (fail closed: `false` here
 * withholds a carve-out, it never grants one). The id is compared exactly
 * after the read as well, so a store whose collation folds case can only
 * refuse, never widen.
 *
 * An invitation id is the vendor's `generateId()` (plugin-auth configures no
 * id generator of its own): 32 characters of `[a-zA-Z0-9]` from a
 * cryptographic generator, pinned by this module's test.
 */

import { InvitationStatus } from '@objectstack/spec/identity';
import { isBeforeExpiry } from './invitation-link-action.js';
import { withSystemReadContext } from './objectql-adapter.js';

/** The sign-up body field the presented invitation's id travels in. */
export const SIGN_UP_INVITATION_ID_FIELD = 'invitationId';

/**
 * The invitation id a sign-up request presents, read off the endpoint
 * context's parsed body. Only a non-empty string counts; any other value is
 * read as no id at all.
 */
export function presentedInvitationId(ctx: unknown): string | undefined {
  const value = (ctx as { body?: Record<string, unknown> } | undefined)?.body?.[SIGN_UP_INVITATION_ID_FIELD];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Does the presented invitation admit a sign-up for `email`? See the module
 * doc for the rule; never throws.
 */
export async function isPresentedInvitationPending(
  engine: unknown,
  invitationId: string | undefined,
  email: string,
): Promise<boolean> {
  if (!invitationId) return false;
  if (!engine || typeof (engine as { find?: unknown }).find !== 'function') return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  try {
    const reader = withSystemReadContext(engine as never) as unknown as {
      find(object: string, query: Record<string, unknown>): Promise<unknown>;
    };
    const rows = await reader.find('sys_invitation', { where: { id: invitationId }, limit: 1 });
    const row = (Array.isArray(rows) ? rows[0] : undefined) as Record<string, unknown> | undefined;
    if (!row || String(row.id) !== invitationId) return false;
    if (row.status !== InvitationStatus.enum.pending) return false;
    if (!isBeforeExpiry(row.expires_at ?? row.expiresAt)) return false;
    const rowEmail = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    return rowEmail === target;
  } catch {
    return false;
  }
}
