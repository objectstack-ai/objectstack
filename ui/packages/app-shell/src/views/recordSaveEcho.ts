/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record a save answered, laid over the record the page holds
 * (objectstack#33827).
 *
 * A write's MutationEvent carries the server's answer to it — the record as
 * the server now holds it, field-masked for the caller like any read. The
 * record page draws the saved values from that answer the moment the write
 * lands, so the page and the save's success toast agree; the re-read the same
 * write triggers still runs and replaces the result whole.
 *
 * Invariants:
 *
 * - An answer that does not name this record (`id`, or `_id`, equal to it) is
 *   not taken: the page keeps what it holds and waits for its re-read.
 * - Nothing loaded yet ⇒ nothing to lay the answer over: the load answers.
 * - A key the answer does not carry keeps the held value (the re-read settles
 *   it).
 * - A relation the page read EXPANDED (`{ id, name, … }`) and the answer gives
 *   back as the same bare id keeps the expanded value, so a save that did not
 *   touch it never trades the related record's name for its id. A relation the
 *   save CHANGED takes the answer's value.
 * - When the answer changes nothing the held object itself comes back, so an
 *   equal answer never republishes the record as a new object (ui/AGENTS.md
 *   #10).
 */
export function applySavedRecordEcho<R>(held: R, answer: unknown, recordId: string): R {
  if (!held || typeof held !== 'object' || !isRecordObject(answer)) return held;
  const answerId = answer.id ?? answer._id;
  if (answerId == null || String(answerId) !== recordId) return held;

  const base = held as unknown as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(answer)) {
    const current = base[key];
    if (Object.is(current, value) || sameReference(current, value)) continue;
    next ??= { ...base };
    next[key] = value;
  }
  return (next ?? held) as R;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function idOf(value: unknown): unknown {
  return isRecordObject(value) ? value.id ?? value._id : undefined;
}

function sameId(expanded: unknown, bare: unknown): boolean {
  const id = idOf(expanded);
  return id != null && (typeof bare === 'string' || typeof bare === 'number') && String(id) === String(bare);
}

/** True when `held` is the expanded form of the reference(s) `answer` names. */
function sameReference(held: unknown, answer: unknown): boolean {
  if (Array.isArray(held) && Array.isArray(answer)) {
    return held.length === answer.length && held.every((h, i) => sameId(h, answer[i]));
  }
  return sameId(held, answer);
}
