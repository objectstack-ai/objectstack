// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `@mention` recipient gate: a mention notification reaches a mentioned
 * user only when that user can READ both the comment it previews and the
 * record it links.
 *
 * The notification carries the comment's body preview and a deep link to the
 * record, so it is a copy of what the comment thread shows, and the bell copy
 * must not reach anyone the thread would not show that comment to. That is two
 * reads, and neither answers the other:
 *
 *  - the RECORD, which the deep link opens: not a user of another organization
 *    under a walled posture, and not a member the record's own sharing
 *    excludes;
 *  - the COMMENT, whose text the preview is. Reading the record does not imply
 *    reading its comments: a comment is readable when the reader's grants
 *    admit the comment object itself — its object-level CRUD, tenant wall and
 *    row scope — AND its record is readable (the thread read gate,
 *    `installCommentReadVisibility` in `comment-access-hooks.ts`). The
 *    recipient's own read of the comment, by id, asks all of that at once.
 *
 * The record is asked first so that the withheld reason names the narrower
 * fact; where the thread read gate is installed the comment read alone would
 * withhold the same recipients, and the record read keeps the deep link's own
 * question answered on an engine that has no seam to install that gate on.
 *
 * ⛔ Nothing here derives readability. Each mentioned user's envelope is built
 * by the resolver every request is built by (`resolveUserAuthzGrants`), their
 * organization claim is vetted by the rule a session's claim is vetted by
 * (`vetOrganizationClaim`), and both reads are asked of the one evaluator every
 * parent-derived read gate asks (`resolveReadableParentIds`) — the evaluator
 * the comment-reaction create door asks of a comment, too. So the record's
 * tenant wall, OWD/sharing, RLS and object-level CRUD decide the deep link,
 * and the comment object's, with the thread gate, decide the preview, exactly
 * as they decide when that user opens the record or lists its comments.
 *
 * The comment is read from inside the author's write: the mention writer runs
 * on the comment's `afterInsert` (and, for a mention an edit added, its
 * `afterUpdate`), where the engine binds every read to the write's own unit of
 * work. A read that cannot see the row withholds — the
 * fail-closed direction.
 *
 * ⛔ Not a row filter on `sys_notification`: a recipient reads their OWN
 * notification, so no read-side rule on the inbox can tell a leaked copy from
 * a legitimate one. The decision belongs at the write, where the record and
 * the comment are known.
 *
 * Fail-closed throughout: a mention that names no user, a comment with no
 * record behind it, a comment with no id to read it by, a record that cannot
 * be found, a grant resolution that fails, and a recipient whose own read of
 * the record or of the comment does not return it all withhold the
 * notification. Each withheld recipient is logged once at `warn` with the user
 * id (when there is one) and the reason — never the comment text.
 */

import {
  normalizePlatformAdminEmail,
  resolveReadableParentIds,
  resolveUserAuthzGrants,
  vetOrganizationClaim,
} from '@objectstack/core';
import type { TenancyPosture } from '@objectstack/spec/security';

import { COMMENT_OBJECT, parseCommentThreadId } from './comment-access-hooks.js';

/** The engine reads this gate makes — system-context lookups and the caller-scoped probe. */
export interface MentionRecipientGateEngine {
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  getSchema?(object: string): { fields?: Record<string, unknown> } | undefined;
}

export interface MentionRecipientGateDeps {
  engine: MentionRecipientGateEngine;
  /**
   * The tenancy posture in force, as the request path reads it
   * (`effectiveTenancyPosture` over the `tenancy` service). `undefined` when
   * no tenancy service is registered — the request path's answer for such a
   * host, so the claim is vetted here exactly as it would be there.
   */
  getTenancyPosture?(): TenancyPosture | undefined;
  logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void };
}

/**
 * Why a mentioned user was not notified. Logged; never shown to the author —
 * the author is told only THAT a named user will not be notified (`onWithheld`).
 */
export type MentionWithheldReason =
  | 'not_a_user'
  | 'unknown_email'
  | 'no_source_record'
  | 'no_comment_id'
  | 'source_record_missing'
  | 'grants_unavailable'
  | 'cannot_read_source'
  | 'cannot_read_thread';

export interface MentionGateInput {
  /** The raw `mentions` entries, already parsed from the stored JSON. */
  mentions: readonly string[];
  /** The comment's `thread_id` — `{object_name}:{record_id}`. */
  threadId: unknown;
  /** The comment author: never notified, whatever the mention list says. */
  actorId?: string | null;
  /** The organization the comment was written in — the fallback when the record carries none. */
  organizationId?: string | null;
  /**
   * The comment's id: each recipient's own read of the comment is asked by it,
   * and the withheld-recipient log line names it. Absent → nobody is notified
   * (`no_comment_id`): a comment that cannot be read back cannot be shown to
   * be readable.
   */
  commentId?: string | null;
  /**
   * [#27703] Told the id of each mentioned USER this gate withholds, once per
   * withholding, whatever the reason — the user the author named who will not
   * be notified. The reason is never passed: it stays in the log line. An
   * entry that names no user (an unknown email, an audience expansion) has no
   * id to pass. A callback that throws never changes the verdict.
   */
  onWithheld?: (userId: string) => void;
}

const SYSTEM_CONTEXT = { isSystem: true } as const;
const USER_OBJECT = 'sys_user';
/** Audience-spec prefixes the messaging service would EXPAND; a mention names one person. */
const NON_USER_PREFIXES = ['role:', 'team:', 'owner_of:'];

/**
 * The mentioned users who may be notified about this comment: each resolved
 * to a user id, minus the author, minus everyone who cannot read the record,
 * minus everyone who cannot read the comment itself.
 */
export async function admitMentionRecipients(
  deps: MentionRecipientGateDeps,
  input: MentionGateInput,
): Promise<string[]> {
  const withhold = (reason: MentionWithheldReason, userId?: string): void => {
    try {
      deps.logger?.warn?.('[audit] mention notification withheld', {
        reason,
        ...(userId ? { userId } : {}),
        ...(input.commentId ? { commentId: input.commentId } : {}),
      });
    } catch {
      /* logging must never fail the comment write */
    }
    if (userId) {
      try {
        input.onWithheld?.(userId);
      } catch {
        /* a listener must never change the verdict or fail the comment write */
      }
    }
  };

  const candidates: string[] = [];
  for (const raw of input.mentions) {
    const userId = await resolveMentionedUser(deps.engine, raw);
    if (!userId.ok) {
      withhold(userId.reason);
      continue;
    }
    if (input.actorId && userId.id === input.actorId) continue;
    if (!candidates.includes(userId.id)) candidates.push(userId.id);
  }
  if (candidates.length === 0) return [];

  const target = parseCommentThreadId(input.threadId);
  if (!target) {
    for (const uid of candidates) withhold('no_source_record', uid);
    return [];
  }
  const commentId = typeof input.commentId === 'string' && input.commentId ? input.commentId : undefined;
  if (!commentId) {
    for (const uid of candidates) withhold('no_comment_id', uid);
    return [];
  }

  let recordOrganization: string | undefined;
  try {
    const hasOrgColumn = !!deps.engine.getSchema?.(target.object)?.fields?.organization_id;
    const rows = await deps.engine.find(target.object, {
      where: { id: target.recordId },
      fields: hasOrgColumn ? ['id', 'organization_id'] : ['id'],
      limit: 1,
      context: SYSTEM_CONTEXT,
    });
    const record = Array.isArray(rows) ? rows[0] : undefined;
    if (!record) {
      for (const uid of candidates) withhold('source_record_missing', uid);
      return [];
    }
    const org = record.organization_id;
    if (typeof org === 'string' && org) recordOrganization = org;
  } catch {
    for (const uid of candidates) withhold('source_record_missing', uid);
    return [];
  }

  // The organization the mentioned user would open the record IN: the
  // record's own, else the comment's. Claimed, then vetted per user below.
  const claimedOrganization = recordOrganization ?? (input.organizationId || undefined);
  const posture = deps.getTenancyPosture?.();
  const admitted: string[] = [];
  for (const uid of candidates) {
    let verdict: 'admitted' | MentionWithheldReason;
    try {
      const context = await contextForMentionedUser(deps.engine, uid, claimedOrganization, posture);
      if (!(await readableIn(deps.engine, context, target.object, target.recordId))) verdict = 'cannot_read_source';
      else if (!(await readableIn(deps.engine, context, COMMENT_OBJECT, commentId))) verdict = 'cannot_read_thread';
      else verdict = 'admitted';
    } catch {
      withhold('grants_unavailable', uid);
      continue;
    }
    if (verdict === 'admitted') admitted.push(uid);
    else withhold(verdict, uid);
  }
  return admitted;
}

/**
 * Does `context`'s own read of `object` / `id` return the row? Asked of
 * {@link resolveReadableParentIds}, the one readability evaluator — a refused
 * or failing read is "not readable".
 */
async function readableIn(
  engine: MentionRecipientGateEngine,
  context: Record<string, unknown>,
  object: string,
  id: string,
): Promise<boolean> {
  const readable = await resolveReadableParentIds(engine, context, new Map([[object, new Set([id])]]));
  return readable.get(object)?.has(id) === true;
}

/**
 * The envelope `uid` would read the record with: their own grants, in the
 * claimed organization only while a current membership backs the claim under
 * a walled posture — the session arm of `resolveAuthzContext`, which drops an
 * unbacked claim and re-resolves with no active organization (Layer 0 then
 * fails closed).
 */
async function contextForMentionedUser(
  engine: MentionRecipientGateEngine,
  userId: string,
  claimedOrganization: string | undefined,
  posture: TenancyPosture | undefined,
): Promise<Record<string, unknown>> {
  let grants = await resolveUserAuthzGrants(engine, userId, claimedOrganization ? { tenantId: claimedOrganization } : {});
  const tenantId = vetOrganizationClaim(claimedOrganization, grants.accessible_org_ids, posture);
  if (claimedOrganization && !tenantId) grants = await resolveUserAuthzGrants(engine, userId, {});
  return {
    userId,
    ...(tenantId ? { tenantId } : {}),
    positions: grants.positions,
    permissions: grants.permissions,
    systemPermissions: grants.systemPermissions,
    org_user_ids: grants.org_user_ids,
    accessible_org_ids: grants.accessible_org_ids,
    ...(grants.tabPermissions ? { tabPermissions: grants.tabPermissions } : {}),
    ...(grants.posture ? { posture: grants.posture } : {}),
    ...(grants.email ? { email: grants.email } : {}),
  };
}

type MentionedUser = { ok: true; id: string } | { ok: false; reason: MentionWithheldReason };

/**
 * One `mentions` entry → the user it names. The field holds user ids; an
 * email-shaped entry is looked up to its user (identity only — whether that
 * user may be notified is the read check's question, never this lookup's).
 * An audience expansion (`role:` / `team:` / `owner_of:`) names no single
 * person and is not a mention.
 *
 * An email is looked up the way sign-in looks one up: identity stores
 * `sys_user.email` lowercased, and sign-in queries the lowercased address, so
 * a mention normalises with the platform's one email normalisation
 * (`normalizePlatformAdminEmail`: trim, then lowercase) before the exact
 * match. ⛔ No second email matcher here — a differently-cased address must
 * name the same user sign-in would.
 */
async function resolveMentionedUser(engine: MentionRecipientGateEngine, raw: string): Promise<MentionedUser> {
  let value = raw.trim();
  if (value.startsWith('user:')) value = value.slice('user:'.length).trim();
  if (!value) return { ok: false, reason: 'not_a_user' };
  if (NON_USER_PREFIXES.some((p) => value.startsWith(p))) return { ok: false, reason: 'not_a_user' };
  if (!value.includes('@')) return { ok: true, id: value };
  try {
    const rows = await engine.find(USER_OBJECT, {
      where: { email: normalizePlatformAdminEmail(value) },
      fields: ['id'],
      limit: 1,
      context: SYSTEM_CONTEXT,
    });
    const id = Array.isArray(rows) ? rows[0]?.id : undefined;
    if (id != null && String(id).length > 0) return { ok: true, id: String(id) };
  } catch {
    /* fall through: an unresolvable email notifies nobody */
  }
  return { ok: false, reason: 'unknown_email' };
}
