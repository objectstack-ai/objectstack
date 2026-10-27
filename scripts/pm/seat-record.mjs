// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * seat-record — the ONE reading of the seat's `## 席位核对` record on a pull
 * request: where the record is, and which verdict it carries.
 *
 * ## Why it is its own file
 *
 * Two tools read this one artefact. `check-half-states.mjs` (H69) asks whether
 * a record is on the thread at all; `fleet-roster.mjs` asks whether the record
 * lets the pull land. Each used to carry its own pattern for the heading, and
 * they read the live inline spelling `## 席位核对 — ACCEPT · …` differently: H69
 * saw a record, the roster saw no verdict. Neither tool imports the other, so
 * the heading and the verdict reading live here and both import them. ⛔ Never
 * re-spell either pattern in a reader; a new spelling is added here, with a
 * case in BOTH self-tests.
 *
 * It is a sibling of its two readers, ⛔ not under a `lib/` subdirectory: a
 * multi-segment import specifier counts as a dispatch-gates watch hint, and a
 * module that inherits one from its gate files loses it when they import here.
 *
 * ## The record, as it is written
 *
 * The heading opens a line, optionally inside a blockquote, as `## 席位核对`
 * (pm-dispatch SKILL.md ①, `references/execution-duties.md`). The verdict is
 * read in this order, and the FIRST verdict word met decides:
 *
 *   inline   on the heading line itself, after a separator:
 *            `## 席位核对 — ACCEPT · domain:skills#2 · …`
 *   below    the first line under the heading that opens with a verdict word,
 *            bold or bare: `**ACCEPT** · …`, `REWORK · …`
 *
 * `ACCEPT` is the only verdict that lets a pull land; `REWORK` and `REJECT`
 * never do, and a record whose verdict cannot be read carries `null`.
 *
 * ⛔ No network, no I/O, no imports: a body in, a reading out.
 */

/**
 * The seat's record, as a heading line — line-anchored, an optional leading
 * blockquote, no `g` flag (so two reads of one body agree). A `###`
 * sub-heading or a mention in prose (the landing comment is told ⛔ 不复述
 * `## 席位核对`) is no record.
 */
export const SEAT_RECORD_MARKER = /^\s*>?\s*## 席位核对/m;

/** The verdict words a record can carry; only the first lands a pull. */
export const SEAT_RECORD_VERDICTS = Object.freeze(['ACCEPT', 'REWORK', 'REJECT']);

const VERDICT_WORD = SEAT_RECORD_VERDICTS.join('|');

/** The inline arm: the heading's own tail, after an optional separator. */
const INLINE_VERDICT = new RegExp(`^[ \\t]*(?:[—–:：·|-][ \\t]*)*(?:\\*\\*)?(${VERDICT_WORD})(?:\\*\\*)?\\b`, 'u');

/** The below arm: a line under the heading that opens with a verdict word. */
const LINE_VERDICT = new RegExp(`^[ \\t]*>?[ \\t]*(?:\\*\\*)?(${VERDICT_WORD})(?:\\*\\*)?\\b`, 'u');

/**
 * The record a comment body carries: `null` when there is none, else
 * `{ verdict }` with the verdict word, or `null` when none could be read. Pure.
 */
export function seatRecordOf(body) {
  const text = String(body ?? '');
  const m = SEAT_RECORD_MARKER.exec(text);
  if (!m) return null;
  const [headingTail, ...below] = text.slice(m.index + m[0].length).split(/\r?\n/);
  const inline = INLINE_VERDICT.exec(headingTail);
  if (inline) return { verdict: inline[1] };
  for (const line of below) {
    const v = LINE_VERDICT.exec(line);
    if (v) return { verdict: v[1] };
  }
  return { verdict: null };
}

/** Does this comment body carry a seat record whose verdict is ACCEPT? Pure. */
export function seatRecordAccepts(body) {
  return seatRecordOf(body)?.verdict === 'ACCEPT';
}
