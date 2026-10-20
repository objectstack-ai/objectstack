// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `@mention` recipient gate: a mention notification reaches a mentioned
 * user only when that user can READ the record the comment is about.
 *
 * The notification carries the comment's body preview and a deep link to the
 * record, so it is a copy of what the comment thread shows. The thread itself
 * is readable exactly when its record is (`comment-access-hooks.ts`); the bell
 * copy must not reach anyone the thread would not. Before this gate the
 * writer emitted one notification per id in `mentions` verbatim, so a
 * mentioned user who could not read the record — a user of another
 * organization under a walled posture, or a member the record's own sharing
 * excludes — still received the preview.
 *
 * ⛔ Nothing here derives readability. Each mentioned user's envelope is built
 * by the resolver every request is built by (`resolveUserAuthzGrants`), their
 * organization claim is vetted by the rule a session's claim is vetted by
 * (`vetOrganizationClaim`), and the read is asked of the one evaluator every
 * parent-derived read gate asks (`resolveReadableParentIds`) — so the record's
 * tenant wall, OWD/sharing, RLS and object-level CRUD decide, exactly as they
 * decide when that user opens the deep link.
 *
 * ⛔ Not a row filter on `sys_notification`: a recipient reads their OWN
 * notification, so no read-side rule on the inbox can tell a leaked copy from
 * a legitimate one. The decision belongs at the write, where the record is
 * known.
 *
 * Fail-closed throughout: a mention that names no user, a comment with no
 * record behind it, a record that cannot be found, and a grant resolution
 * that fails all withhold the notification. Each withheld recipient is logged
 * once at `warn` with the user id (when there is one) and the reason — never
 * the comment text.
 */

import {
  resolveReadableParentIds,
  resolveUserAuthzGrants,
  vetOrganizationClaim,
} from '@objectstack/core';
import type { TenancyPosture } from '@objectstack/spec/security';

import { parseCommentThreadId } from './comment-access-hooks.js';

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

/** Why a mentioned user was not notified. Logged; never shown to the author. */
export type MentionWithheldReason =
  | 'not_a_user'
  | 'unknown_email'
  | 'no_source_record'
  | 'source_record_missing'
  | 'grants_unavailable'
  | 'cannot_read_source';

export interface MentionGateInput {
  /** The raw `mentions` entries, already parsed from the stored JSON. */
  mentions: readonly string[];
  /** The comment's `thread_id` — `{object_name}:{record_id}`. */
  threadId: unknown;
  /** The comment author: never notified, whatever the mention list says. */
  actorId?: string | null;
  /** The organization the comment was written in — the fallback when the record carries none. */
  organizationId?: string | null;
  /** For the withheld-recipient log line. */
  commentId?: string | null;
}

const SYSTEM_CONTEXT = { isSystem: true } as const;
const USER_OBJECT = 'sys_user';
/** Audience-spec prefixes the messaging service would EXPAND; a mention names one person. */
const NON_USER_PREFIXES = ['role:', 'team:', 'owner_of:'];

/**
 * The mentioned users who may be notified about this comment: each resolved
 * to a user id, minus the author, minus everyone who cannot read the record.
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
    let readable = false;
    try {
      const context = await contextForMentionedUser(deps.engine, uid, claimedOrganization, posture);
      readable = !!(
        await resolveReadableParentIds(deps.engine, context, new Map([[target.object, new Set([target.recordId])]]))
      )
        .get(target.object)
        ?.has(target.recordId);
    } catch {
      withhold('grants_unavailable', uid);
      continue;
    }
    if (readable) admitted.push(uid);
    else withhold('cannot_read_source', uid);
  }
  return admitted;
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
 */
async function resolveMentionedUser(engine: MentionRecipientGateEngine, raw: string): Promise<MentionedUser> {
  let value = raw.trim();
  if (value.startsWith('user:')) value = value.slice('user:'.length).trim();
  if (!value) return { ok: false, reason: 'not_a_user' };
  if (NON_USER_PREFIXES.some((p) => value.startsWith(p))) return { ok: false, reason: 'not_a_user' };
  if (!value.includes('@')) return { ok: true, id: value };
  try {
    const rows = await engine.find(USER_OBJECT, {
      where: { email: value },
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
