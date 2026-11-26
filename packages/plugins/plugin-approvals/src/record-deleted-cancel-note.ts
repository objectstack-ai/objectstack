// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37531] The note a pending request writes on its own timeline when the
 * record it is about is deleted (`ApprovalService.cancelForDeletedRecord`),
 * rendered in the READER's language.
 *
 * The note needs no stored code: the request it explains already carries
 * every fact the sentence names — `cancel_reason: 'record_deleted'`,
 * `object_name` and `record_id` — and the row is that request's one
 * `action: 'cancel'` with no actor. So the sentence is a catalog entry
 * (`approvalAutoCancelledRecordDeleted`, `./translations/messages.ts`), the
 * row's stored `comment` is its `en` rendering with the object's name, and a
 * reader with a locale is served it re-composed from the request's columns,
 * with the object's label in that language where the pack holds one.
 */

import type { ApprovalSentenceRender } from './admin-rescue-note.js';
import { approvalMessageKey, interpolate } from './approval-notification-text.js';
import { enMessages } from './translations/messages.js';

/** The `sys_approval_request.cancel_reason` this note explains. */
export const RECORD_DELETED_CANCEL_REASON = 'record_deleted';

/** What the sentence names: the object (a name, or a reader's label for it) and the record's id. */
export interface RecordDeletedCancelNote {
  readonly object: string;
  readonly record: string;
}

/**
 * The note's text. With no `render`, the English the row stores; with one,
 * the reader's language, or `undefined` when the pack does not hold the
 * sentence (the stored comment then stands).
 */
export function recordDeletedCancelNoteText(note: RecordDeletedCancelNote): string;
export function recordDeletedCancelNoteText(
  note: RecordDeletedCancelNote,
  render: ApprovalSentenceRender,
): string | undefined;
export function recordDeletedCancelNoteText(
  note: RecordDeletedCancelNote,
  render?: ApprovalSentenceRender,
): string | undefined {
  const params = { object: note.object, record: note.record };
  return render
    ? render(approvalMessageKey('approvalAutoCancelledRecordDeleted'), params)
    : interpolate(enMessages.approvalAutoCancelledRecordDeleted, params);
}
