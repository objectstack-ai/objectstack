// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/auth/organization/accepted-invitation?id=INVITATION_ID` — the
 * signed-in recipient's read of an invitation they already accepted.
 *
 * ## Why it exists
 *
 * A person who accepts an invitation and then opens the same link again (or
 * refreshes the accept page) asks better-auth 1.7.12's
 * `GET /organization/get-invitation`
 * (`dist/plugins/organization/routes/crud-invites.mjs`, `getInvitation`), which
 * refuses every invitation whose status is not `pending` with the same
 * code-less `400 "Invitation not found!"` it gives an unknown id — before it
 * even asks who is reading. `list-user-invitations` lists pending invitations
 * only, and the signed-out `invitation-preview` answers one uniform 404 by
 * design (ADR-0138 D2, `invitation-preview.ts`). So nothing could tell the
 * person "you have joined this organization".
 *
 * ## What it answers, and to whom
 *
 * Exactly one case answers: the invitation exists, its status is `accepted`,
 * and the session's user is its recipient. Then:
 *
 *     200 { success: true, data: { invitationId, status: 'accepted',
 *           organizationId, organizationName, organizationSlug, isMember } }
 *
 * `isMember` says whether the person still belongs to the organization (they
 * may have left since), so a client offers the way in only when there is one.
 *
 * Every other case answers the SAME `404 RESOURCE_NOT_FOUND` body
 * ({@link ACCEPTED_INVITATION_NOT_FOUND}): an unknown id, a session that is not
 * the recipient (whatever the invitation's state, pending included), a
 * recipient whose address is not verified, and the recipient's own pending,
 * rejected, canceled or expired invitation. Each of those is decided after the
 * same single invitation read, so neither the body nor the number of reads
 * tells them apart. The route tells a caller nothing get-invitation did not
 * already tell them, except the one fact it exists for, and only to the
 * person it is about. A caller with no session gets `401 UNAUTHENTICATED`.
 *
 * ## "Recipient" is decided the way the vendor decides it, with the verified rule
 *
 * The vendor's own test (`getInvitation`, `acceptInvitation`): the
 * invitation's address equals the session user's address, compared lowercase.
 * On top of it the rule `invitation-accept-verified-email.ts` holds for every
 * invitation answer: the address must be verified (`session.user.emailVerified`),
 * because the id is no proof of the mailbox. The one-step door's signed-in
 * mode (`invitation-mailbox-proof.ts`) asks exactly the same two questions. The
 * session is the vendor's (`getSessionFromCtx`, cookie and bearer alike) and
 * every read is the vendor's own adapter (`getOrgAdapter(ctx.context, options)`
 * — `findInvitationById`, `findOrganizationById`, `checkMembership`), keyed on
 * the very options object the organization plugin was built with.
 *
 * ## What it leaves alone
 *
 * `get-invitation` answers byte for byte as it did — to the recipient, to
 * anyone else and to a signed-out caller, in every state — and so does the
 * signed-out `invitation-preview`, which stays session-blind and uniform
 * (ADR-0138 D2, ruling 6413975861). No vendor handler is wrapped or rebuilt:
 * this is a new path on the organization plugin's own `endpoints` record, so
 * it exists exactly when that plugin does, one plugin registers it, and every
 * global hook (the `bearer()` echo among them) runs on it.
 *
 * ## Codes and envelope
 *
 * The success body is the `{ success, data }` envelope the one-step door
 * answers with. Refusals keep better-auth's flat `{ code, message }` shape,
 * with standard-catalog codes only (`UNAUTHENTICATED`, `RESOURCE_NOT_FOUND`,
 * `VALIDATION_ERROR`), so nothing here reaches the spec error-code ledger.
 *
 * ## Query parameters — a closed set (AGENTS.md route rule 5)
 *
 * `id`, once. Any other name answers the shared recognition rule's located 400
 * (`unknownQueryParamRefusalMessage`, `@objectstack/rest`), a repeated `id` the
 * shared multiplicity rule's 400, and a missing or blank `id` a 400 too.
 */

import { repeatedQueryParamMessage, unknownQueryParamRefusalMessage } from '@objectstack/rest';
import type { OrganizationOptions } from 'better-auth/plugins/organization';

/** The route under the auth base path. */
export const ACCEPTED_INVITATION_PATH = '/organization/accepted-invitation';

/** The key the endpoint takes on the organization plugin's `endpoints` record (`auth.api.getAcceptedInvitation`). */
export const ACCEPTED_INVITATION_ENDPOINT_KEY = 'getAcceptedInvitation';

/** The route's CLOSED query-parameter set: the handler reads `id` and nothing else. */
export const ACCEPTED_INVITATION_QUERY_PARAMS: readonly string[] = ['id'];

/** The one refusal for every invitation that is not the caller's own accepted one. */
export const ACCEPTED_INVITATION_NOT_FOUND = {
  code: 'RESOURCE_NOT_FOUND',
  message: 'No accepted invitation with this id is addressed to you.',
} as const;

/** The refusal for a caller with no session. */
export const ACCEPTED_INVITATION_UNAUTHENTICATED = {
  code: 'UNAUTHENTICATED',
  message: 'Sign in to read your invitation.',
} as const;

/** The projection the recipient reads, exactly. */
export interface AcceptedInvitationAnswer {
  invitationId: string;
  status: 'accepted';
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  /** Whether the reader still belongs to the organization (they may have left since accepting). */
  isMember: boolean;
}

/** The slice of better-auth's `organization` plugin this module extends. */
export interface OrganizationPluginLike {
  id: string;
  endpoints: Record<string, any>;
}

/** Every query parameter, each name with all its values, as the request carries them. */
function queriesOf(ctx: any): Record<string, readonly string[]> {
  const url = typeof ctx?.request?.url === 'string' ? ctx.request.url : undefined;
  if (url) {
    const out: Record<string, string[]> = {};
    for (const [name, value] of new URL(url).searchParams) (out[name] ??= []).push(value);
    return out;
  }
  // A server-side `auth.api` call carries no request: read the parsed query.
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries((ctx?.query ?? {}) as Record<string, unknown>)) {
    out[name] = (Array.isArray(value) ? value : [value]).map((v) => String(v));
  }
  return out;
}

/**
 * Is the session's user the invitation's recipient, by the vendor's address
 * comparison plus the verified-address rule? Exported for the pin.
 */
export function isVerifiedRecipient(
  invitation: { email?: unknown } | null | undefined,
  user: { email?: unknown; emailVerified?: unknown } | null | undefined,
): boolean {
  if (!invitation || typeof invitation.email !== 'string') return false;
  if (!user || typeof user.email !== 'string' || user.emailVerified !== true) return false;
  return invitation.email.toLowerCase() === user.email.toLowerCase();
}

/**
 * Add `GET /organization/accepted-invitation` to `organization`'s own
 * `endpoints` record.
 *
 * `options` MUST be the very object handed to `organization(options)`: it is
 * what the vendor's own `getOrgAdapter(ctx.context, options)` reads.
 *
 * Returns `false`, and adds nothing, when the key is already taken (a vendor
 * release that ships an endpoint under the same name): the caller says so
 * loudly rather than shadowing it.
 */
export async function addAcceptedInvitationRead(
  plugin: OrganizationPluginLike,
  options: OrganizationOptions,
): Promise<boolean> {
  if (!plugin?.endpoints || plugin.endpoints[ACCEPTED_INVITATION_ENDPOINT_KEY]) return false;
  const taken = Object.values(plugin.endpoints).some((e: any) => e?.path === ACCEPTED_INVITATION_PATH);
  if (taken) return false;

  const [{ createAuthEndpoint, APIError, getSessionFromCtx }, { getOrgAdapter }] = await Promise.all([
    import('better-auth/api'),
    import('better-auth/plugins/organization'),
  ]);

  const notFound = (): never => {
    throw new APIError('NOT_FOUND', { ...ACCEPTED_INVITATION_NOT_FOUND });
  };

  plugin.endpoints[ACCEPTED_INVITATION_ENDPOINT_KEY] = createAuthEndpoint(
    ACCEPTED_INVITATION_PATH,
    {
      method: 'GET',
      requireHeaders: true,
      metadata: {
        openapi: {
          description:
            'Read an invitation the signed-in recipient already accepted: the organization it joined them to. ' +
            'Every other invitation, and every other caller, answers the same 404.',
        },
      },
    },
    async (ctx: any) => {
      const queries = queriesOf(ctx);
      const unknown = unknownQueryParamRefusalMessage(queries, ACCEPTED_INVITATION_QUERY_PARAMS);
      if (unknown !== undefined) throw new APIError('BAD_REQUEST', { code: 'VALIDATION_ERROR', message: unknown });
      const ids = queries.id ?? [];
      if (ids.length > 1) {
        throw new APIError('BAD_REQUEST', { code: 'VALIDATION_ERROR', message: repeatedQueryParamMessage('id', ids.length) });
      }
      const id = (ids[0] ?? '').trim();
      if (!id) {
        throw new APIError('BAD_REQUEST', {
          code: 'VALIDATION_ERROR',
          message: 'The "id" query parameter is required: the invitation id from the invitation link.',
        });
      }

      const session = await getSessionFromCtx(ctx);
      if (!session) throw new APIError('UNAUTHORIZED', { ...ACCEPTED_INVITATION_UNAUTHENTICATED });

      const adapter = getOrgAdapter(ctx.context, options as any);
      // The single read every refused case is decided after.
      const invitation: any = await adapter.findInvitationById(id);
      if (!invitation || invitation.status !== 'accepted' || !isVerifiedRecipient(invitation, session.user)) {
        return notFound();
      }

      const organization: any = await adapter.findOrganizationById(invitation.organizationId);
      if (!organization || typeof organization.name !== 'string') return notFound();
      const member = await adapter.checkMembership({
        userId: session.user.id,
        organizationId: invitation.organizationId,
      });

      const data: AcceptedInvitationAnswer = {
        invitationId: String(invitation.id),
        status: 'accepted',
        organizationId: String(invitation.organizationId),
        organizationName: organization.name,
        organizationSlug: typeof organization.slug === 'string' ? organization.slug : null,
        isMember: Boolean(member),
      };
      return ctx.json({ success: true, data });
    },
  );
  return true;
}
