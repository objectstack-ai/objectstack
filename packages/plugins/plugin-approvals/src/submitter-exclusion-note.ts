// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25573] The note a request writes on its own timeline when an approval
 * node's `excludeSubmitter: true` took the submitter off a slate, stored as a
 * code and rendered in the READER's language.
 *
 * ## Why the request says so
 *
 * The ruling that built the option (6377888641, letter B) wants the approval
 * record to "show when the exclusion changed the route". Without this note a
 * request whose submitter was removed reads exactly like one the submitter
 * was never on, and a request that went to the fallback slate or to the
 * organization's administrators because of the exclusion reads like an
 * unstaffed step. The note is written whenever the exclusion removed the
 * submitter from a slate the request could have opened on, and only then: a
 * node with the option on whose slate never named the submitter writes none.
 *
 * ## The stored shape, and the render
 *
 * The admin rescue note's shape (`admin-rescue-note.ts`), reused: the request's
 * node-config snapshot carries the note under
 * {@link SUBMITTER_EXCLUSION_NOTE_SNAPSHOT_KEY} as the id of the timeline row
 * it explains and the route the request took. The row's `comment` is the
 * English, which every reader without a locale is served; the approvals door
 * overlays the reader's language from the same catalog entries
 * (`approvalSubmitterExcluded*` in `./translations/messages.ts`).
 */

import { approvalMessageKey } from './approval-notification-text.js';
import { enMessages, type ApprovalMessageId } from './translations/messages.js';
import type { ApprovalSentenceRender } from './admin-rescue-note.js';

/**
 * Where the request went once the submitter was removed:
 *
 *  - `remaining_approvers` — the slate still named other people, and the
 *    request waits on them;
 *  - `fallback` — nobody was left, and the request opened on the node's
 *    declared `fallbackApprovers` (`onEmptyApprovers: 'fallback'`);
 *  - `administrators` — nobody was left, and the request opened on the
 *    organization's administrators (`admin_rescue`, the default, or a
 *    `fallback` that named no one but the submitter);
 *  - `no_one` — nobody was left and no administrator other than the submitter
 *    could take it, so the request opened on the slate that names no one,
 *    which only the privileged override decides.
 *
 * A `fail` node opens no request, so it has no route to record: its
 * `NO_APPROVERS` refusal names the exclusion instead.
 */
export type SubmitterExclusionRoute = 'remaining_approvers' | 'fallback' | 'administrators' | 'no_one';

const ROUTES: readonly SubmitterExclusionRoute[] = ['remaining_approvers', 'fallback', 'administrators', 'no_one'];

/** The node-config snapshot key the note rides under. */
export const SUBMITTER_EXCLUSION_NOTE_SNAPSHOT_KEY = '__submitterExclusionNote';

/** The note as the request's snapshot stores it. */
export interface SubmitterExclusionNote {
  /** The `sys_approval_action` row (an `action: 'comment'` with no actor) this note is. */
  readonly action_id: string;
  readonly route: SubmitterExclusionRoute;
}

const SENTENCE: Readonly<Record<SubmitterExclusionRoute, ApprovalMessageId>> = {
  remaining_approvers: 'approvalSubmitterExcludedRemaining',
  fallback: 'approvalSubmitterExcludedFallback',
  administrators: 'approvalSubmitterExcludedAdministrators',
  no_one: 'approvalSubmitterExcludedNoOne',
};

/**
 * The note's text. With no `render`, the English the row stores; with one,
 * the reader's language, or `undefined` when the pack does not hold the
 * sentence (the stored comment then stands).
 */
export function submitterExclusionNoteText(note: Pick<SubmitterExclusionNote, 'route'>): string;
export function submitterExclusionNoteText(
  note: Pick<SubmitterExclusionNote, 'route'>,
  render: ApprovalSentenceRender,
): string | undefined;
export function submitterExclusionNoteText(
  note: Pick<SubmitterExclusionNote, 'route'>,
  render?: ApprovalSentenceRender,
): string | undefined {
  const id = SENTENCE[note.route];
  return render ? render(approvalMessageKey(id), {}) : enMessages[id];
}

/**
 * The note a parsed node-config snapshot carries, or `undefined` when it
 * carries none or one this module did not write (the stored comment stands).
 */
export function submitterExclusionNoteOf(snapshot: unknown): SubmitterExclusionNote | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const note = (snapshot as Record<string, unknown>)[SUBMITTER_EXCLUSION_NOTE_SNAPSHOT_KEY];
  if (!note || typeof note !== 'object') return undefined;
  const { action_id, route } = note as Record<string, unknown>;
  if (typeof action_id !== 'string' || !action_id) return undefined;
  if (!ROUTES.includes(route as SubmitterExclusionRoute)) return undefined;
  return { action_id, route: route as SubmitterExclusionRoute };
}
