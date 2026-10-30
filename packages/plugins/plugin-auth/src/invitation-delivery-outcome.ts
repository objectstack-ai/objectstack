// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27843 (ruling E on #27797) — `POST /organization/invite-member` says
 * whether its mail was delivered.
 *
 * ## The defect
 *
 * On a deployment with no live mail transport (the stock `log` transport, or
 * no email service at all) a successful invite answered exactly what a
 * delivered one answers: the invitation row. The console's `invite_user`
 * action then toasted "Invitation sent to …" while nothing left the server, and
 * the invitee never arrived. The server knew the difference and nothing carried
 * it to the client.
 *
 * ## What this does
 *
 * Every successful answer of the route — a new invitation and a resend
 * (`resend: true`) alike, the vendor answers both with the invitation row —
 * gains one top-level member beside the row's own columns:
 *
 * - `outcome: 'sent'` when mail is delivered on this deployment;
 * - `outcome: 'link_only'` when it is not, so the invitation exists and only
 *   its accept link (`sys_invitation.copy_invitation_link`) reaches the
 *   invitee.
 *
 * The console reads it through `ActionSchema.outcomeMessages` (the success
 * payload's top-level `outcome` names the copy), so the row keeps answering
 * `{{ result.email }}` exactly as before.
 *
 * ## The one rule that decides it
 *
 * `AuthManager.isEmailDeliveryLive()`, asked at call time: the wired email
 * service's own `isConfigured()` answer, the rule sign-up already uses.
 * ⛔ Not `hasEmailTransport()` / `isEmailServiceAvailable()`: they answer "a
 * service object is wired", which is true on every default boot, whose `log`
 * transport writes the mail to the console instead of sending it.
 *
 * It describes the transport, not the one send: a live transport whose send
 * then fails is still `sent` (the vendor's invitation callback swallows that
 * failure, and the row is already written), and the admin resends.
 *
 * Runs in the global `after` hook, where `ctx.context.returned` holds the
 * route's answer; a refusal there is an `APIError`, which this leaves alone.
 * The payload is completed in place, the shape `session-envelope-completion.ts`
 * uses, so every later reader of the answer sees the same object.
 */

import { INVITE_MEMBER_PATH } from './invite-role-not-found-code.js';

/** The closed set of delivery outcomes invite-member answers. */
export const INVITATION_DELIVERY_OUTCOMES = ['sent', 'link_only'] as const;

/** One member of {@link INVITATION_DELIVERY_OUTCOMES}. */
export type InvitationDeliveryOutcome = (typeof INVITATION_DELIVERY_OUTCOMES)[number];

/** The outcome for a transport that does (`true`) or does not deliver mail. */
export function invitationDeliveryOutcome(deliveryLive: boolean): InvitationDeliveryOutcome {
  return deliveryLive ? 'sent' : 'link_only';
}

/**
 * Stamp `outcome` on a successful invite-member answer. A no-op on every other
 * path, on a refusal, and on an answer that is not an object. Never throws: an
 * answer it cannot read is left exactly as the vendor wrote it.
 *
 * @param isEmailDeliveryLive the manager's deliverability reader, asked once,
 *   at call time.
 */
export async function stampInvitationDeliveryOutcome(
  ctx: any,
  isEmailDeliveryLive: () => boolean,
): Promise<void> {
  try {
    if (ctx?.path !== INVITE_MEMBER_PATH) return;
    const returned = ctx?.context?.returned;
    if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return;
    try {
      const { isAPIError } = await import('better-auth/api');
      if (isAPIError(returned)) return;
    } catch {
      if (returned instanceof Error) return;
    }
    (returned as Record<string, unknown>).outcome = invitationDeliveryOutcome(isEmailDeliveryLive());
  } catch {
    /* leave the answer exactly as the vendor route wrote it */
  }
}
