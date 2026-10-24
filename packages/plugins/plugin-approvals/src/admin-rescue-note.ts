// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25576] The note an `admin_rescue` request writes on its own timeline, as a
 * stored code and its parameters, rendered in the READER's language.
 *
 * ## What was wrong
 *
 * When an approver slate named no one and the request opened on the
 * organization's administrators (#22824), `openNodeRequest` composed one
 * English sentence ("Routed to this organization's administrators because the
 * approver slate named no one: position 'X' has no holder.") and stored it as
 * the `comment` of a system `sys_approval_action` row. The approvals door
 * served that comment as stored, so a zh-CN, ja-JP or es-ES reader of the
 * timeline read English.
 *
 * ## The stored shape
 *
 * The request's node-config snapshot carries the note as data, under
 * {@link ADMIN_RESCUE_NOTE_SNAPSHOT_KEY}: the id of the timeline row it
 * explains, the abandoned slate and why a declared `fallback` did not help.
 * The snapshot, not a new column, is where a request already keeps what it
 * resolved at open time (`__flowLabel`, `__round`, `__resolvedFrom`), so no
 * schema moves. The row's `comment` stays the English rendering: the audit
 * text the generic data door, the action-history list views and every reader
 * without a locale are served, exactly as before.
 *
 * ## The render, reused
 *
 * The sentence and its clauses are catalog entries in this plugin's `messages`
 * face (`./translations/messages.ts`, `approvalAdminRescue*`). The English is
 * those `en` entries interpolated here, ⛔ never a second spelling; the
 * reader's language is the same entries through `II18nService.t()` at the
 * reader's negotiated locale (`ReaderLabels.sentence`, `reader-locale-labels.ts`
 * — the one way the approvals door picks a reader's language). A clause the
 * pack does not hold falls back to its English; a note sentence the pack does
 * not hold leaves the stored comment as it is.
 *
 * A row written before this note existed has no snapshot entry, so it is served
 * as stored: the English it always carried. Its clauses survive only inside that
 * prose, and parsing prose back into a code is the defect this module replaces,
 * so no backfill recovers them.
 */

import { approvalMessageKey, interpolate } from './approval-notification-text.js';
import { enMessages, type ApprovalMessageId } from './translations/messages.js';

/** Why a declared `onEmptyApprovers: 'fallback'` did not name anyone. */
export type AdminRescueFallback = 'not_declared' | 'resolved_to_no_one';

/** The node-config snapshot key the note rides under. */
export const ADMIN_RESCUE_NOTE_SNAPSHOT_KEY = '__adminRescueNote';

/** The note as the request's snapshot stores it. */
export interface AdminRescueNote {
  /** The `sys_approval_action` row (an `action: 'comment'` with no actor) this note is. */
  readonly action_id: string;
  /** The slate that named no one, as resolved: `type:value` slots and anything else it held. */
  readonly abandoned: readonly string[];
  /** Set when the node declared `onEmptyApprovers: 'fallback'` and it did not help. */
  readonly fallback?: AdminRescueFallback;
}

/** One catalog sentence and its params. */
interface Clause {
  readonly id: ApprovalMessageId;
  readonly params: Readonly<Record<string, string>>;
}

/** Renders a catalog sentence in some language, or answers `undefined` when it cannot. */
export type ApprovalSentenceRender = (
  key: string,
  params: Readonly<Record<string, string>>,
) => string | undefined;

/** The reason's clauses: one per abandoned `type:value` slot, then the fallback's. */
function reasonClauses(abandoned: readonly string[], fallback: AdminRescueFallback | undefined): Clause[] {
  const clauses: Clause[] = abandoned
    .filter((slot) => !!slot && slot.includes(':'))
    .map((slot): Clause => {
      const at = slot.indexOf(':');
      const type = slot.slice(0, at);
      const value = slot.slice(at + 1);
      return type === 'position'
        ? { id: 'approvalAdminRescuePositionUnheld', params: { value } }
        : { id: 'approvalAdminRescueSlotUnresolved', params: { type, value } };
    });
  if (!clauses.length) clauses.push({ id: 'approvalAdminRescueNoApprover', params: {} });
  if (fallback === 'resolved_to_no_one') clauses.push({ id: 'approvalAdminRescueFallbackUnresolved', params: {} });
  if (fallback === 'not_declared') clauses.push({ id: 'approvalAdminRescueFallbackUndeclared', params: {} });
  return clauses;
}

const english = (clause: Clause): string => interpolate(enMessages[clause.id], clause.params);

/**
 * Why the slate named no one, in English: the audit snapshot's
 * `admin_rescue:reason` and the log lines.
 */
export function adminRescueReason(abandoned: readonly string[], fallback: AdminRescueFallback | undefined): string {
  return reasonClauses(abandoned, fallback).map(english).join(enMessages.approvalAdminRescueReasonSeparator);
}

/**
 * The note's text. With no `render`, the English the row stores; with one,
 * the reader's language, or `undefined` when the note sentence itself is not
 * rendered (the stored comment then stands).
 */
export function adminRescueNoteText(note: Omit<AdminRescueNote, 'action_id'>): string;
export function adminRescueNoteText(
  note: Omit<AdminRescueNote, 'action_id'>,
  render: ApprovalSentenceRender,
): string | undefined;
export function adminRescueNoteText(
  note: Omit<AdminRescueNote, 'action_id'>,
  render?: ApprovalSentenceRender,
): string | undefined {
  const clauses = reasonClauses(note.abandoned, note.fallback);
  if (!render) {
    const reason = clauses.map(english).join(enMessages.approvalAdminRescueReasonSeparator);
    return interpolate(enMessages.approvalAdminRescueNote, { reason });
  }
  const separator = render(approvalMessageKey('approvalAdminRescueReasonSeparator'), {})
    ?? enMessages.approvalAdminRescueReasonSeparator;
  const reason = clauses
    .map((clause) => render(approvalMessageKey(clause.id), clause.params) ?? english(clause))
    .join(separator);
  return render(approvalMessageKey('approvalAdminRescueNote'), { reason });
}

/**
 * The note a parsed node-config snapshot carries, or `undefined` when it
 * carries none or one this module did not write (the stored comment stands).
 */
export function adminRescueNoteOf(snapshot: unknown): AdminRescueNote | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const note = (snapshot as Record<string, unknown>)[ADMIN_RESCUE_NOTE_SNAPSHOT_KEY];
  if (!note || typeof note !== 'object') return undefined;
  const { action_id, abandoned, fallback } = note as Record<string, unknown>;
  if (typeof action_id !== 'string' || !action_id) return undefined;
  if (!Array.isArray(abandoned) || !abandoned.every((slot) => typeof slot === 'string')) return undefined;
  if (fallback !== undefined && fallback !== 'not_declared' && fallback !== 'resolved_to_no_one') return undefined;
  return { action_id, abandoned, ...(fallback ? { fallback } : {}) };
}
