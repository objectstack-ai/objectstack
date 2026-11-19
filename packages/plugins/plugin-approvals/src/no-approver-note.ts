// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The note a request writes on its own timeline when it opens on the slate
 * that names no one, and the remedy the decision door names to a submitter it
 * refuses on a slate that names no one else. Stored as a code and rendered in
 * the READER's language, the shape `submitter-exclusion-note.ts` gives its
 * note.
 *
 * ## Why the request says so
 *
 * A request opens on that slate when no approver resolved to a person and no
 * administrator other than its submitter could take it (an organization of
 * one, whose step sets `excludeSubmitter`, is the common case). No inbox lists
 * it and no approver is told, so without this note its submitter sees only
 * "Submitted". The ruled outcome stands — the submitter never approves their
 * own request, not even through the administrator override — so the note
 * names the way forward instead: an organization administrator adds a member
 * who can approve it. When the slate kept the `type:value` literals that
 * resolved to no one (an unstaffed position), the note names them, and a
 * member who holds one takes that slot once added; when nothing is left on
 * the slate, the request is reassigned to that member.
 */

import { approvalMessageKey, interpolate } from './approval-notification-text.js';
import { enMessages, type ApprovalMessageId } from './translations/messages.js';
import type { ApprovalSentenceRender } from './admin-rescue-note.js';
import { isPlatformAdminAddress, slateNamesAPerson } from './approver-address.js';

/** The node-config snapshot key the note rides under. */
export const NO_APPROVER_NOTE_SNAPSHOT_KEY = '__noApproverNote';

/** The note as the request's snapshot stores it. */
export interface NoApproverNote {
  /** The `sys_approval_action` row (an `action: 'comment'` with no actor) this note is. */
  readonly action_id: string;
  /** The slate's literals, as `type 'value'`, which a member must hold; absent when it kept none. */
  readonly who?: string;
}

/** What the literals on `slate` ask a member to hold, or `undefined` when it holds none. */
export function noApproverWho(slate: readonly string[]): string | undefined {
  const named = slate
    .filter((slot) => !!slot && slot.includes(':') && !isPlatformAdminAddress(slot))
    .map((slot) => `${slot.slice(0, slot.indexOf(':'))} '${slot.slice(slot.indexOf(':') + 1)}'`);
  return named.length ? named.join(', ') : undefined;
}

/** Does `slate` name no person other than `submitter`, so no one else can decide it? */
export function namesNoOneBut(slate: readonly string[], submitter: string): boolean {
  return !slateNamesAPerson(slate.filter((slot) => slot !== submitter));
}

/** The catalog sentence for the note, and its parameters. */
export function noApproverSentence(note: Pick<NoApproverNote, 'who'>): {
  id: ApprovalMessageId; params: Record<string, string>;
} {
  return note.who
    ? { id: 'approvalNoApproverHolding', params: { who: note.who } }
    : { id: 'approvalNoApprover', params: {} };
}

/**
 * The note's text. With no `render`, the English the row stores and the
 * refusal says; with one, the reader's language, or `undefined` when the pack
 * does not hold the sentence (the stored comment then stands).
 */
export function noApproverNoteText(note: Pick<NoApproverNote, 'who'>): string;
export function noApproverNoteText(note: Pick<NoApproverNote, 'who'>, render: ApprovalSentenceRender): string | undefined;
export function noApproverNoteText(
  note: Pick<NoApproverNote, 'who'>,
  render?: ApprovalSentenceRender,
): string | undefined {
  const { id, params } = noApproverSentence(note);
  return render ? render(approvalMessageKey(id), params) : interpolate(enMessages[id], params);
}

/**
 * The note a parsed node-config snapshot carries, or `undefined` when it
 * carries none or one this module did not write (the stored comment stands).
 */
export function noApproverNoteOf(snapshot: unknown): NoApproverNote | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const note = (snapshot as Record<string, unknown>)[NO_APPROVER_NOTE_SNAPSHOT_KEY];
  if (!note || typeof note !== 'object') return undefined;
  const { action_id, who } = note as Record<string, unknown>;
  if (typeof action_id !== 'string' || !action_id) return undefined;
  return typeof who === 'string' && who ? { action_id, who } : { action_id };
}
