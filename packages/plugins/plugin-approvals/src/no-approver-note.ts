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

import { approvalMessageKey, interpolate, type ApprovalTextParam } from './approval-notification-text.js';
import { enMessages, type ApprovalMessageId } from './translations/messages.js';
import { slatePositions, type ApprovalSentenceRender, type PositionLabelOf } from './admin-rescue-note.js';
import { isPlatformAdminAddress, slateNamesAPerson } from './approver-address.js';
import { positionLabelKey } from './reader-locale-labels.js';

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
 * The catalog word of each approver type a no-approver slot is written under
 * (`resolveApproverSpec`'s `type:value` fallback). The `en` word IS the type's
 * machine token, so the English reads as it always did. A slot of any other
 * type (a stored `role:` or `queue:` slot, a `bu` dialect) is named by its
 * token, in every language, as the administrators' note names one.
 */
const APPROVER_TYPE_WORDS: Readonly<Record<string, ApprovalMessageId>> = {
  position: 'approvalApproverTypePosition',
  team: 'approvalApproverTypeTeam',
  department: 'approvalApproverTypeDepartment',
  org_membership_level: 'approvalApproverTypeOrgMembershipLevel',
};

/** One literal of a slate, split at its first `:`. */
interface Slot {
  readonly type: string;
  readonly value: string;
}

function slotsOf(slate: readonly string[]): Slot[] {
  return (noApproverSlots(slate) ?? []).map((slot) => ({
    type: slot.slice(0, slot.indexOf(':')),
    value: slot.slice(slot.indexOf(':') + 1),
  }));
}

/** A slot's value as named: a position by the label `positionLabel` knows, else as configured. */
function slotValue(slot: Slot, positionLabel: PositionLabelOf | undefined): string {
  return (slot.type === 'position' && positionLabel?.(slot.value)) || slot.value;
}

/** One slot's clause, `type 'value'`: in English, or in `render`'s language. */
function slotClause(slot: Slot, value: string, render: ApprovalSentenceRender | undefined): string {
  const word = APPROVER_TYPE_WORDS[slot.type];
  const english = interpolate(enMessages.approvalNoApproverSlot, { type: word ? enMessages[word] : slot.type, value });
  if (!render) return english;
  const type = word ? render(approvalMessageKey(word), {}) : slot.type;
  return (type !== undefined ? render(approvalMessageKey('approvalNoApproverSlot'), { type, value }) : undefined)
    ?? english;
}

/**
 * What the literals on `slate` ask a member to hold, one clause per slot
 * (`position 'legal'`), or `undefined` when it holds none. [#36035] With
 * `positionLabel`, a position's value is the label it answers; with none, or
 * for a position it does not know, the position's name stands, which is the
 * English the row stores. With `render`, each clause and the separator are
 * the reader's language, the approver type named by its word there; a clause
 * the pack does not hold falls back to its English.
 */
export function noApproverWho(
  slate: readonly string[],
  positionLabel?: PositionLabelOf,
  render?: ApprovalSentenceRender,
): string | undefined {
  const clauses = slotsOf(slate).map((slot) => slotClause(slot, slotValue(slot, positionLabel), render));
  if (!clauses.length) return undefined;
  const separator = (render && render(approvalMessageKey('approvalNoApproverSlotSeparator'), {}))
    ?? enMessages.approvalNoApproverSlotSeparator;
  return clauses.join(separator);
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
 * The submitter's notice body for the note: its catalog sentence and the
 * params the messaging service fills per recipient, at delivery
 * (`EmitInput.keyedText`).
 *
 * A hole there takes one text or one hole-free catalog key, so a sentence
 * composed from clauses cannot ride as a param. A slate of ONE slot is
 * therefore spelled inline, `approvalNoApproverHoldingSlot`: its `type` is
 * the approver type's word as a key, and a position's `value` is its
 * reader-language label as a key (`positions.<name>.label`, the key the
 * timeline reads) falling back to `declaredLabel`, else the name — the order
 * the timeline note names it in. A slate of several slots names them in
 * English inside the reader's sentence, each position by `declaredLabel`; a
 * note that stored `who` keeps it as written.
 */
export function noApproverNotice(note: Pick<NoApproverNote, 'slots' | 'who'>, declaredLabel?: PositionLabelOf): {
  id: ApprovalMessageId; params: Record<string, ApprovalTextParam>;
} {
  const slots = note.slots ? slotsOf(note.slots) : [];
  if (slots.length === 1) {
    const [slot] = slots;
    const word = APPROVER_TYPE_WORDS[slot.type];
    const value = slotValue(slot, declaredLabel);
    return {
      id: 'approvalNoApproverHoldingSlot',
      params: {
        type: word ? { key: approvalMessageKey(word), fallback: enMessages[word] } : slot.type,
        value: slot.type === 'position' ? { key: positionLabelKey(slot.value), fallback: value } : value,
      },
    };
  }
  const who = note.slots ? noApproverWho(note.slots, declaredLabel) : note.who;
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
 * named by the label it answers, as `adminRescueNoteText` names one, and each
 * slot's approver type by its word in the reader's pack. The stored English
 * keeps the name and the type's token: it is the audit text.
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
  const who = note.slots ? noApproverWho(note.slots, render ? positionLabel : undefined, render) : note.who;
  if (!who) return render ? render(approvalMessageKey('approvalNoApprover'), {}) : enMessages.approvalNoApprover;
  return render
    ? render(approvalMessageKey('approvalNoApproverHolding'), { who })
    : interpolate(enMessages.approvalNoApproverHolding, { who });
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
