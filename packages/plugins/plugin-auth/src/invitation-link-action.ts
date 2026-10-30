// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27843 (ruling E on #27797) — `sys_invitation.copy_invitation_link`, the
 * server action that answers a pending invitation's accept link.
 *
 * ## Why it exists
 *
 * On a deployment whose mail is not delivered, invite-member answers
 * `outcome: 'link_only'` (`invitation-delivery-outcome.ts`): the invitation
 * exists and nothing reached the invitee. The governed invite action is the
 * metadata one, and nothing beside it handed the link over, so the admin had
 * no way to finish the invitation by hand. This action is that way: the row
 * menu and the record header offer it, and the console shows its answer in a
 * copyable result dialog.
 *
 * ## The link
 *
 * `{ acceptUrl }`, composed by {@link invitationAcceptPath} through the
 * manager's one Console-page composer (`AuthManager.getConsoleUrl`, the public
 * reader of `getConsolePageUrl`), which is exactly what `sendInvitationEmail`
 * puts in the mail: the canonical origin, the Console mount `uiBasePath`, and
 * `/accept-invitation/<id>`. No second link builder exists.
 *
 * ## Who gets it — the gates of `resend_invitation`, enforced here
 *
 * ⛔ The URL is a bearer credential: whoever opens it can accept the
 * invitation. The declaration's `visible` predicate is UI courtesy only, and
 * this handler's body runs system-elevated at the platform action door, so it
 * enforces every gate itself, in this order:
 *
 * 1. **Cloud-managed** — refused `409 RESOURCE_CONFLICT`, as invite-member
 *    (resends included) is refused there: the hosting organisation invites in
 *    the cloud.
 * 2. **One invitation, named** — the action runs on a record.
 * 3. **An identified caller** — the request's own `session.userId`, never the
 *    elevated execution context the body is handed.
 * 4. **Invite reach** — the caller's `sys_member` row in the invitation's
 *    organization carries a grade of `MEMBERSHIP_REACH.invite_member` (owner,
 *    admin, delegated_admin): the grades whose statements reach
 *    `/organization/invite-member`, which a resend calls. The table is pinned
 *    to the roles map plugin-auth hands better-auth by
 *    `membership-reach-table.test.ts`. Before the status gate, so a caller
 *    outside the reach learns nothing about the row.
 * 5. **Pending** — any other status has no link that admits anyone.
 *
 * The invitation and the membership are re-read from the store under the
 * system context, never taken from the record the door projected for the
 * caller's view (which may be sparse).
 *
 * ⛔ Nothing here logs the link, in any environment.
 */

import { isCloudManaged } from '@objectstack/core';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { MEMBERSHIP_REACH, InvitationStatus } from '@objectstack/spec/identity';
import {
  CLOUD_MANAGED_REFUSAL_CODE,
  CLOUD_MANAGED_REFUSAL_MESSAGES,
  CLOUD_MANAGED_REFUSAL_STATUS,
} from './cloud-managed.js';
import { parseOrgRoles } from './invitation-role-cap.js';
import { AUTH_PLUGIN_ID } from './manifest.js';
import { withSystemContext } from './objectql-adapter.js';

/** The object the action is declared on. */
export const INVITATION_OBJECT = 'sys_invitation';

/** The action's name, and the handler key its declaration's `target` names. */
export const COPY_INVITATION_LINK_ACTION = 'copy_invitation_link';

/**
 * The Console page an invitation's accept link opens, relative to the Console
 * mount. The one spelling: the invitation mail and this action both compose
 * their link from it.
 */
export function invitationAcceptPath(invitationId: string): string {
  return `/accept-invitation/${invitationId}`;
}

/** The answer of {@link COPY_INVITATION_LINK_ACTION}. */
export interface CopyInvitationLinkAnswer {
  acceptUrl: string;
}

export interface CopyInvitationLinkDeps {
  /** The data engine; read under the system context. */
  engine: IDataEngine;
  /** The manager's Console-page composer (`AuthManager.getConsoleUrl`). */
  consoleUrl: (path: string) => string;
}

function refusal(status: number, code: string, message: string): Error {
  const err = new Error(message) as Error & { status: number; code: string };
  err.status = status;
  err.code = code;
  return err;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The grades that reach `/organization/invite-member`. */
const INVITE_REACH_GRADES: readonly string[] = MEMBERSHIP_REACH.invite_member.grades;

/**
 * Build the action handler. It receives the platform action door's context
 * (`record`, `session`, `params`, …) and answers {@link CopyInvitationLinkAnswer},
 * or throws a refusal carrying its own `status` and ADR-0112 `code`.
 */
export function createCopyInvitationLinkHandler(deps: CopyInvitationLinkDeps) {
  const sys = withSystemContext(deps.engine);
  return async (ctx: any): Promise<CopyInvitationLinkAnswer> => {
    if (isCloudManaged()) {
      throw refusal(CLOUD_MANAGED_REFUSAL_STATUS, CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_MESSAGES.invitationLink);
    }

    const invitationId = nonEmptyString(ctx?.params?.recordId) ?? nonEmptyString(ctx?.record?.id);
    if (!invitationId) {
      throw refusal(400, 'MISSING_REQUIRED_FIELD', 'Copy invite link runs on one invitation: name it with `recordId`.');
    }

    const callerId = nonEmptyString(ctx?.session?.userId);
    if (!callerId) {
      throw refusal(401, 'UNAUTHENTICATED', 'Sign in to copy an invite link.');
    }

    const invitation: any = await sys.findOne(INVITATION_OBJECT, {
      where: { id: invitationId },
      fields: ['id', 'organization_id', 'status'],
    });
    if (!invitation) {
      throw refusal(404, 'RECORD_NOT_FOUND', `No invitation '${invitationId}' exists.`);
    }

    const organizationId = nonEmptyString(invitation.organization_id);
    const membership: any = organizationId
      ? await sys.findOne('sys_member', {
        where: { organization_id: organizationId, user_id: callerId },
        fields: ['id', 'role'],
      })
      : undefined;
    const reaches = parseOrgRoles(membership?.role).some((role) => INVITE_REACH_GRADES.includes(role));
    if (!reaches) {
      throw refusal(
        403,
        'PERMISSION_DENIED',
        "Only an owner, admin or delegated admin of the invitation's organization can copy its invite link, "
          + 'the same members who can resend it.',
      );
    }

    if (invitation.status !== InvitationStatus.enum.pending) {
      throw refusal(
        409,
        'RESOURCE_CONFLICT',
        `This invitation is ${String(invitation.status)}, so its link no longer lets anyone join. `
          + 'Only a pending invitation has a link to copy; send a new invitation instead.',
      );
    }

    return { acceptUrl: deps.consoleUrl(invitationAcceptPath(String(invitation.id))) };
  };
}

/**
 * Register {@link COPY_INVITATION_LINK_ACTION} on `sys_invitation`, owned by
 * plugin-auth's package id (the id the identity objects are registered under).
 */
export function registerCopyInvitationLinkAction(
  ql: Pick<IObjectQLEngine, 'registerAction'>,
  deps: CopyInvitationLinkDeps,
): void {
  ql.registerAction(INVITATION_OBJECT, COPY_INVITATION_LINK_ACTION, createCopyInvitationLinkHandler(deps), AUTH_PLUGIN_ID);
}
