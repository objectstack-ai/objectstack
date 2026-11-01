// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28540 — an invitation issued for a person retires that person's expired
 * pending invitations in the same organization.
 *
 * better-auth's `invite-member` looks for the person's pending invitation with
 * `findPendingInvitation`, which drops every row whose `expiresAt` has passed.
 * So a resend (`resend: true`, the `sys_invitation.resend_invitation` action)
 * on an invitation that has already expired finds nothing to renew and issues
 * a NEW invitation, and so does a plain invite. The expired row keeps reading
 * `pending`: nothing in the vendor or in the platform ever moves it, and the
 * Pending list then shows two rows for one person, the older one admitting
 * no one.
 *
 * This runs in the global `after` hook, only on a successful invite-member
 * answer, so it acts only once the vendor has admitted the caller and written
 * the answered row; a refusal retires nothing. It moves each of the person's
 * other pending rows in that organization whose `expires_at` has passed to
 * `expired` (the ObjectStack half of `InvitationStatus`; better-auth has no
 * such value), so the row moves to the Expired / Canceled list. A resend that
 * renewed an unexpired row answers that same row, which is excluded by id;
 * any older expired row beside it is retired too.
 *
 * An expiry that does not read as a date counts as expired, as the vendor's
 * own check and the copy-link gate read it. The write names `status:
 * 'pending'` beside the id, so a row that left `pending` meanwhile (accepted,
 * declined, canceled) is not touched.
 *
 * Failure-isolated: the invitation is already issued and its mail handed off
 * when this runs, so a read or write that fails leaves the old row as it was
 * (the state before this existed), says so once at `warn`, and never turns
 * the issued invitation into an error answer.
 */

import { INVITE_MEMBER_PATH } from './invite-role-not-found-code.js';
import { isBeforeExpiry } from './invitation-link-action.js';

/** The better-auth model name of `sys_invitation`. */
const INVITATION_MODEL = 'invitation';

/** The status a retired row takes. */
const RETIRED_STATUS = 'expired';

/**
 * Retire the answered person's expired pending invitations after a successful
 * invite-member. A no-op on every other path, on a refusal, and on an answer
 * that does not carry an invitation's id, email and organization. Never throws.
 */
export async function retireExpiredInvitationsOnReissue(ctx: any): Promise<void> {
  if (ctx?.path !== INVITE_MEMBER_PATH) return;
  const returned = ctx?.context?.returned;
  if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return;
  try {
    const { isAPIError } = await import('better-auth/api');
    if (isAPIError(returned)) return;
  } catch {
    if (returned instanceof Error) return;
  }
  const answeredId = typeof returned.id === 'string' ? returned.id : undefined;
  const email = typeof returned.email === 'string' ? returned.email.toLowerCase() : undefined;
  const organizationId = typeof returned.organizationId === 'string' ? returned.organizationId : undefined;
  const adapter = ctx?.context?.adapter;
  if (!answeredId || !email || !organizationId || !adapter) return;

  try {
    const pending: any[] = await adapter.findMany({
      model: INVITATION_MODEL,
      where: [
        { field: 'email', value: email },
        { field: 'organizationId', value: organizationId },
        { field: 'status', value: 'pending' },
      ],
    });
    for (const row of pending ?? []) {
      if (!row || row.id === answeredId || isBeforeExpiry(row.expiresAt)) continue;
      await adapter.update({
        model: INVITATION_MODEL,
        where: [
          { field: 'id', value: row.id },
          { field: 'status', value: 'pending' },
        ],
        update: { status: RETIRED_STATUS },
      });
    }
  } catch (err: any) {
    console.warn(
      '[auth] The new invitation was issued, but an earlier expired invitation for the same person could '
        + 'not be marked expired, so it still reads pending in the invitation list (it admits no one): '
        + `${err?.message ?? String(err)}`,
    );
  }
}
