/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The HITL continuation marker — ONE producer, ONE reader (objectstack#30223).
 *
 * After the operator presses 确认 / 取消 on an inline approval card,
 * `useHitlInChat` sends the model a short follow-up turn ("The operator
 * approved the `create_record` call … Acknowledge the outcome …") so it can
 * carry on. That turn rides the ordinary user-message channel, because it is
 * the only one the agent route reads, so the model MUST keep receiving it.
 * What the person must not see is that text as their own bubble, as their
 * conversation's preview line, or as the "latest thing the user said".
 *
 * Why the marker is the text's leading tag and not message metadata: the text
 * is the only part of a user message that survives storage. The agent route
 * collapses an inbound message's `parts` to their joined text, and an
 * `ai_messages` row has no column for message metadata, so a `metadata` flag
 * or a part flag is gone after a reload, while the tag comes back verbatim.
 * Keeping the tag's spelling in this one module (the producer below and
 * every reader call {@link isHitlContinuation}) is what keeps it a marker
 * rather than a prose match.
 *
 * ⛔ Pure module: no React, no chat UI import. `./core` re-exports it, and the
 * app shell's list and language readers import it from there.
 */

/** The tag a continuation turn's text starts with. */
export function hitlContinuationTag(pendingActionId: string): string {
  return `[HITL ${pendingActionId}]`;
}

// `[HITL <id>] ` at the very start of the text: the id is one token with no
// whitespace and no closing bracket, and one space follows the tag.
const CONTINUATION_TAG = /^\[HITL [^\]\s]+\] /;

/**
 * True when `text` is a HITL continuation turn that `useHitlInChat` composed
 * for the model, not something the person typed. Accepts any value so readers
 * of loosely typed stored rows can call it without a cast; anything that is
 * not a string is not a continuation.
 */
export function isHitlContinuation(text: unknown): boolean {
  return typeof text === 'string' && CONTINUATION_TAG.test(text);
}
