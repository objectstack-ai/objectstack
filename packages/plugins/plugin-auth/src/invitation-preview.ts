// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/auth/organization/invitation-preview?id=INVITATION_ID` — the
 * signed-out invitation preview (#26020, ruling `6413975861`, Q1 A).
 *
 * ## What it answers, and to whom
 *
 * A person who opens an invitation link before they have an account (or while
 * signed out) lands on a sign-in page that cannot say who invited them or to
 * what: better-auth 1.7.12's own `GET /organization/get-invitation`
 * (`dist/plugins/organization/routes/crud-invites.mjs`, `getInvitation`) answers
 * 401 to a caller with no session, unconditionally — no option turns that check
 * off — and with a session it hands back the WHOLE invitation row plus the
 * inviter's address, to the invitee only. This route is the one read that page
 * needs, and nothing wider:
 *
 *   `{ organizationName, inviterName, email }`, with `email` MASKED.
 *
 * ## The door it is (ADR-0138 D2)
 *
 * An unauthenticated read is admitted only by a door ADR-0138 D2 lists. This is
 * a class-2-shaped door, recorded by the dated note under D2's table: the
 * invitation id the link already carries is the capability token, and it
 * admits ONE validated read of ONE record, projected. Concretely:
 *
 *  - **One record, by its id.** No listing, no lookup by address or
 *    organization; the id is the only key.
 *  - **Validated.** Only a `pending` invitation whose `expires_at` is still in
 *    the future answers. Unknown, expired, accepted, rejected and cancelled ids
 *    all get the SAME 404 body ({@link INVITATION_PREVIEW_NOT_FOUND}), and each
 *    of those five is decided after the same single read, so neither the body
 *    nor the number of reads tells the states apart.
 *  - **Projected.** Exactly three keys. The invited address is masked
 *    ({@link maskInvitedEmail}): the id is a bearer secret that can be
 *    forwarded, and a forwarded link names the inviting organization and the
 *    inviter to its holder (common practice) but not the invitee's full
 *    address. The ruling refused the unmasked variant for that reason.
 *  - **The same answer for everyone.** The handler never reads the session, so
 *    a signed-in caller gets the identical projection, never extra fields.
 *  - **Rate-limited**, as ADR-0121 D6 requires of a door that admits an
 *    anonymous caller: a fixed window per established client address
 *    ({@link INVITATION_PREVIEW_RATE_LIMIT}), counted BEFORE anything is read or
 *    parsed, in the kernel `cache` service when one is registered (the same lazy
 *    resolution the auth rate-limit counters use, ADR-0069 D2).
 *
 * It sits in the `/auth` namespace, which the control-plane allowlist
 * (`isAuthGateAllowlisted`) exempts as a whole; the door is this route's own
 * checks, not that exemption. It is ledgered in `auth-route-ledger.ts`.
 *
 * ## Query parameters — a closed set (AGENTS.md route rule 5)
 *
 * `id`, once. Any other name answers the shared recognition rule's located 400
 * (`unknownQueryParamRefusalMessage`, `@objectstack/rest`), a repeated `id` the
 * shared multiplicity rule's 400, and a missing or blank `id` a 400 too — a
 * malformed request is not a state of an invitation, so it is not folded into
 * the uniform not-found.
 */

import { repeatedQueryParamMessage, unknownQueryParamRefusalMessage } from '@objectstack/rest';
import { withSystemContext } from './objectql-adapter.js';
import { incrementFixedWindow, type CounterStore } from './rate-limit-storage.js';

/** The route under the auth base path. */
export const INVITATION_PREVIEW_PATH = '/organization/invitation-preview';

/** The route's CLOSED query-parameter set: the handler reads `id` and nothing else. */
export const INVITATION_PREVIEW_QUERY_PARAMS: readonly string[] = ['id'];

/** At most `max` previews per client address per `window` seconds (ADR-0121 D6). */
export const INVITATION_PREVIEW_RATE_LIMIT = { window: 60, max: 10 } as const;

/** The one answer for every invitation that is not a pending, unexpired one. */
export const INVITATION_PREVIEW_NOT_FOUND = {
  success: false,
  error: {
    code: 'RESOURCE_NOT_FOUND',
    message: 'Invitation not found. It may have expired, been used, or been withdrawn.',
  },
} as const;

/** The projection, exactly. */
export interface InvitationPreview {
  organizationName: string;
  /** `null` when the inviter's account no longer exists or carries no name. */
  inviterName: string | null;
  /** The invited address, masked ({@link maskInvitedEmail}). */
  email: string;
}

export interface InvitationPreviewAnswer {
  status: 200 | 400 | 404 | 429 | 500;
  body: unknown;
  headers?: Record<string, string>;
}

/** The slice of the data engine this read needs. */
export interface InvitationPreviewEngine {
  findOne(object: string, query?: unknown): Promise<unknown>;
}

export interface InvitationPreviewDeps {
  getDataEngine(): InvitationPreviewEngine | undefined;
  /** The store the per-address window counts in. */
  counterStore(): Promise<CounterStore>;
  now?: () => number;
}

export interface InvitationPreviewRequest {
  /** Every query parameter as the transport parsed it, each name with all its values. */
  queries: Record<string, readonly string[]>;
  /** The address the server established for the caller; `undefined` when it could not. */
  clientAddress: string | undefined;
}

/**
 * Mask an invited address for a signed-out reader: the first character of the
 * local part, a fixed `***`, and the domain — `alice@acme.com` → `a***@acme.com`.
 * The run of stars is fixed, so the mask does not reveal the local part's
 * length. A value with no usable `@` reveals nothing at all: `***`.
 */
export function maskInvitedEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

function refusal(status: 400 | 429 | 500, code: string, message: string, headers?: Record<string, string>): InvitationPreviewAnswer {
  return { status, body: { success: false, error: { code, message } }, ...(headers ? { headers } : {}) };
}

const notFound = (): InvitationPreviewAnswer => ({ status: 404, body: INVITATION_PREVIEW_NOT_FOUND });

function isLiveInvitation(row: Record<string, unknown>, nowMs: number): boolean {
  if (row.status !== 'pending') return false;
  const expires = row.expires_at;
  if (expires === null || expires === undefined) return false;
  const expiresMs = new Date(expires as string | number | Date).getTime();
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

/** The body of the route; `auth-plugin.ts` mounts it and writes what it returns. */
export async function runInvitationPreview(
  request: InvitationPreviewRequest,
  deps: InvitationPreviewDeps,
): Promise<InvitationPreviewAnswer> {
  const now = deps.now ?? Date.now;

  // Counted first: a malformed probe spends the budget like a well-formed one.
  const store = await deps.counterStore();
  const nowMs = now();
  const { count, resetAt } = await incrementFixedWindow(
    store,
    `invitation-preview:${request.clientAddress ?? 'unestablished'}`,
    INVITATION_PREVIEW_RATE_LIMIT.window,
    nowMs,
  );
  if (count > INVITATION_PREVIEW_RATE_LIMIT.max) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - nowMs) / 1000));
    return refusal(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Too many invitation preview requests from this address. Try again later.',
      { 'Retry-After': String(retryAfter) },
    );
  }

  const unknown = unknownQueryParamRefusalMessage(request.queries, INVITATION_PREVIEW_QUERY_PARAMS);
  if (unknown !== undefined) return refusal(400, 'VALIDATION_ERROR', unknown);
  const ids = request.queries.id ?? [];
  if (ids.length > 1) return refusal(400, 'VALIDATION_ERROR', repeatedQueryParamMessage('id', ids.length));
  const id = (ids[0] ?? '').trim();
  if (!id) return refusal(400, 'VALIDATION_ERROR', 'The "id" query parameter is required: the invitation id from the invitation link.');

  const engine = deps.getDataEngine();
  if (!engine) return refusal(500, 'INTERNAL_ERROR', 'The invitation preview is unavailable: no data engine is configured.');
  const sys = withSystemContext(engine as never) as unknown as InvitationPreviewEngine;

  const invitation = (await sys.findOne('sys_invitation', { where: { id } })) as Record<string, unknown> | null;
  if (!invitation || !isLiveInvitation(invitation, nowMs)) return notFound();

  const organization = (await sys.findOne('sys_organization', {
    where: { id: invitation.organization_id },
  })) as Record<string, unknown> | null;
  if (!organization || typeof organization.name !== 'string') return notFound();

  const inviterId = invitation.inviter_id;
  const inviter = typeof inviterId === 'string' && inviterId
    ? ((await sys.findOne('sys_user', { where: { id: inviterId } })) as Record<string, unknown> | null)
    : null;
  const inviterName = typeof inviter?.name === 'string' && inviter.name.trim() ? inviter.name : null;

  const data: InvitationPreview = {
    organizationName: organization.name,
    inviterName,
    email: maskInvitedEmail(typeof invitation.email === 'string' ? invitation.email : ''),
  };
  return { status: 200, body: { success: true, data } };
}
