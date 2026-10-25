// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plain sentence a refused write leads with, and whether anything is left
 * behind it (objectui#13332).
 *
 * The server's message stays the source. A refusal's message is written for
 * whoever debugs it as much as for the person reading the screen: it can open
 * with the code or the field path in brackets (`[writable_package_required]`,
 * `[body.redirect_uris.0]`), go on for several sentences of remedy and
 * decision-record prose, and the console's own envelope reader appends the
 * declared code in parentheses (`readEnvelopeFailureText`). Shown whole, one
 * refusal filled most of a narrow sheet.
 *
 * So the screen leads with the message's FIRST SENTENCE, with any leading
 * bracketed code or path and any trailing parenthesised code left out of it,
 * and the whole message, byte for byte, stays one click away. Nothing is
 * rewritten or translated here and nothing is dropped: `full` is the text the
 * caller passed, trimmed.
 *
 * A sentence ends at `.`, `!` or `?` followed by whitespace or the end, at a
 * CJK full stop, at a `;` that opens another bracketed issue (the shape a
 * validator uses to join several issues into one message:
 * `[path] message; [path] message`), or at a line break. A full stop after a
 * lone letter (`e.g.`, `i.e.`) does not end one, and neither does a `;` inside
 * a sentence.
 */

/** One or more bracketed tokens with no space inside, at the very start. */
const LEADING_CODE = /^(?:\[[^\]\s]+\]\s*)+/;
/** A parenthesised UPPER_SNAKE code at the very end — the envelope reader's suffix. */
const TRAILING_CODE = /\s*\([A-Z][A-Z0-9_]*\)$/;
/** Candidate sentence ends. */
const SENTENCE_END = /[.!?](?=\s|$)|[。！？]|;(?=\s*\[)|\n/g;
/** The text before a `.` ends in a lone letter, or a run of them (`e.g`, `i.e`). */
const ABBREVIATION_TAIL = /(?:^|[\s(])(?:[A-Za-z]\.)*[A-Za-z]$/;

export interface RefusalLead {
  /** The first plain sentence. */
  lead: string;
  /**
   * The whole message when it says more than `lead`; `null` when `lead` is
   * all of it, so there is nothing to disclose.
   */
  full: string | null;
}

function firstSentenceEnd(text: string): number {
  for (const match of text.matchAll(SENTENCE_END)) {
    const at = match.index ?? 0;
    const mark = match[0];
    if (mark === '.' && ABBREVIATION_TAIL.test(text.slice(0, at))) continue;
    // A clause separator and a line break are not part of the sentence.
    return mark === ';' || mark === '\n' ? at : at + mark.length;
  }
  return -1;
}

export function splitRefusal(text: string): RefusalLead {
  const full = text.trim();
  const body = full.replace(LEADING_CODE, '');
  // A message that is only a code has no sentence to lead with.
  if (!body) return { lead: full, full: null };
  const end = firstSentenceEnd(body);
  const sentence = (end === -1 ? body : body.slice(0, end)).trim();
  const lead = sentence.replace(TRAILING_CODE, '') || sentence;
  return { lead, full: lead === full ? null : full };
}
