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
import { slatePositions, type ApprovalSentenceRender, type PositionLabelOf } from './admin-rescue-note.js';
import { isPlatformAdminAddress, slateNamesAPerson } from './approver-address.js';

/** The node-config snapshot key the note rides under. */
export const NO_APPROVER_NOTE_SNAPSHOT_KEY = '__noApproverNote';

/**
 * The note as the request's snapshot stores it.
 *
 * [#36035] A note stores the slate's literals as `slots`, the `type:value`
 * references themselves, so a read can name a position by its label the way
 * the administrators' note does (`adminRescueNoteText`). A note written before
 * stored `who` instead: the literals pre-composed as English, which no read
 * can take apart again, so it is rendered exactly as it always was.
 */
export interface NoApproverNote {
  /** The `sys_approval_action` row (an `action: 'comment'` with no actor) this note is. */
  readonly action_id: string;
  /** The slate's literals, as `type:value`, which a member must hold; absent when it kept none. */
  readonly slots?: readonly string[];
  /** A note written before `slots`: the literals as `type 'value'`, read as stored. */
  readonly who?: string;
}

/** The literals on `slate` a member must hold, as `type:value`, or `undefined` when it holds none. */
export function noApproverSlots(slate: readonly string[]): string[] | undefined {
  const slots = slate.filter((slot) => !!slot && slot.includes(':') && !isPlatformAdminAddress(slot));
  return slots.length ? slots : undefined;
}

/**
 * What the literals on `slate` ask a member to hold, as `type 'value'`, or
 * `undefined` when it holds none. [#36035] With `positionLabel`, a position's
 * value is the label it answers; with none, or for a position it does not
 * know, the position's name stands, which is the English the row stores.
 */
export function noApproverWho(slate: readonly string[], positionLabel?: PositionLabelOf): string | undefined {
  const named = (noApproverSlots(slate) ?? []).map((slot) => {
    const type = slot.slice(0, slot.indexOf(':'));
    const value = slot.slice(slot.indexOf(':') + 1);
    return `${type} '${(type === 'position' && positionLabel?.(value)) || value}'`;
  });
  return named.length ? named.join(', ') : undefined;
}

/** [#36035] The position names a note's `slots` hold, each once; none for a note that stored `who`. */
export function noApproverPositions(note: Pick<NoApproverNote, 'slots'>): string[] {
  return slatePositions(note.slots ?? []);
}

/** Does `slate` name no person other than `submitter`, so no one else can decide it? */
export function namesNoOneBut(slate: readonly string[], submitter: string): boolean {
  return !slateNamesAPerson(slate.filter((slot) => slot !== submitter));
}

/**
 * The catalog sentence for the note, and its parameters. A note's `slots` are
 * composed here, each position named by `positionLabel` where it knows one; a
 * note that stored `who` keeps it as written.
 */
export function noApproverSentence(note: Pick<NoApproverNote, 'slots' | 'who'>, positionLabel?: PositionLabelOf): {
  id: ApprovalMessageId; params: Record<string, string>;
} {
  const who = note.slots ? noApproverWho(note.slots, positionLabel) : note.who;
  return who
    ? { id: 'approvalNoApproverHolding', params: { who } }
    : { id: 'approvalNoApprover', params: {} };
}

/**
 * The note's text. With no `render`, the English the row stores and the
 * refusal says; with one, the reader's language, or `undefined` when the pack
 * does not hold the sentence (the stored comment then stands).
 *
 * [#36035] With `positionLabel` too, a position the note's `slots` name is
 * named by the label it answers, as `adminRescueNoteText` names one. The
 * stored English keeps the name: it is the audit text.
 */
export function noApproverNoteText(note: Pick<NoApproverNote, 'slots' | 'who'>): string;
export function noApproverNoteText(
  note: Pick<NoApproverNote, 'slots' | 'who'>,
  render: ApprovalSentenceRender,
  positionLabel?: PositionLabelOf,
): string | undefined;
export function noApproverNoteText(
  note: Pick<NoApproverNote, 'slots' | 'who'>,
  render?: ApprovalSentenceRender,
  positionLabel?: PositionLabelOf,
): string | undefined {
  const { id, params } = noApproverSentence(note, render ? positionLabel : undefined);
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
  const { action_id, slots, who } = note as Record<string, unknown>;
  if (typeof action_id !== 'string' || !action_id) return undefined;
  if (slots !== undefined) {
    if (!Array.isArray(slots) || !slots.every((slot) => typeof slot === 'string')) return undefined;
    return slots.length ? { action_id, slots } : { action_id };
  }
  return typeof who === 'string' && who ? { action_id, who } : { action_id };
}
