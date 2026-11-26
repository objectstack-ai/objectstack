// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  RECORD_CITATIONS_MAX,
  RecordCitationSchema,
  stripBodyTags,
  type GetRecordContextOutput,
  type RecordCitationParsed,
  type RecordContextFieldEntry,
} from '@objectstack/spec/ai';
import { isHtmlBodyType } from './body-outline.js';
import type { RecordContextDoor } from './door.js';
import { executeGetRecordContext } from './record-context-tools.js';

/**
 * [ADR-0160 D9, third amendment] The citation verifier: which citations of an
 * answer survive, judged once, when the answer is produced, as the asking
 * user.
 *
 * A citation is a claim the model wrote. For each one the platform calls
 * `get_record_context` with the citation's `object`, `id`, `context` and
 * `anchor`, through the door bound to the asking user — the same executor, the
 * same gates, the same answer that user would get — and looks for `quote` in
 * the data member of that answer. This function persists nothing and renders
 * nothing: it returns the verified subset, and the producer persists it with
 * the message.
 *
 * ## The rule
 *
 * - **One call per distinct `(object, id, context, anchor)`.** Citations that
 *   name the same call share its answer.
 * - **A refused call verifies nothing.** A `context` no pack has, several
 *   packs and no `context`, an `anchor` that does not resolve, a record the
 *   caller cannot read or that does not exist, an object the caller is not
 *   served: each is an answer with no data member, so its citations are
 *   dropped (ADR-0160 point 23). No pack is picked for a citation that named
 *   none, and no call is retried without the offending argument.
 * - **What a quote is matched against** — the strings of the data member, and
 *   no other:
 *   - a field entry's `value`, when it is a string, and its `display`, at the
 *     root and in every related-list cell (a quote from a related row is cited
 *     on the root record);
 *   - the body's `text` — the whole body, or the one section `anchor` named.
 *     An `html` or `richtext` body is matched as stored and also with its tags
 *     removed (`stripBodyTags`, the reader the anchor derivation uses).
 *
 *   Never matched: the notes, the framing sentence, any label, the pack's and
 *   the record's own header, a body outline's headings, and a value that is
 *   not a string (a number, a boolean, a list or an object; its `display`,
 *   where the entry carries one, is matched). A withheld or hidden field has
 *   no value in the answer, so nothing is matched in it.
 * - **Verbatim, with whitespace runs collapsed.** Every run of whitespace in
 *   the quote and in the matched string reads as one space, and the quote is
 *   trimmed. Case and every other character must agree. A quote that is empty
 *   once trimmed verifies nothing.
 *
 * ## What it never does
 *
 * It never throws for a citation. A citation that does not parse
 * (`RecordCitationSchema`) is dropped like one that is not found, and only the
 * first {@link RECORD_CITATIONS_MAX} entries of the list are read, so a list a
 * model wrote cannot make the platform read without bound. A dropped citation
 * leaves no trace in the result: a caller who cannot read a record learns
 * nothing from its citations' fate that tells a hidden record from a missing
 * one.
 */
export async function verifyRecordCitations(
  citations: unknown,
  door: RecordContextDoor,
): Promise<RecordCitationParsed[]> {
  if (!Array.isArray(citations)) return [];
  const parsed: RecordCitationParsed[] = [];
  for (const raw of citations.slice(0, RECORD_CITATIONS_MAX)) {
    const result = RecordCitationSchema.safeParse(raw);
    if (result.success) parsed.push(result.data as RecordCitationParsed);
  }

  const haystacks = new Map<string, Promise<readonly string[] | undefined>>();
  for (const c of parsed) {
    const key = callKeyOf(c);
    if (!haystacks.has(key)) haystacks.set(key, haystackOf(c, door));
  }

  const verified: RecordCitationParsed[] = [];
  for (const c of parsed) {
    const quote = collapse(c.quote).trim();
    if (!quote) continue;
    const strings = await haystacks.get(callKeyOf(c));
    if (strings?.some((s) => s.includes(quote))) verified.push(c);
  }
  return verified;
}

/** The verifying call a citation makes, as one key. */
function callKeyOf(c: RecordCitationParsed): string {
  return JSON.stringify([c.object, c.id, c.context ?? null, c.anchor ?? null]);
}

/** Every run of whitespace as one space. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * The strings of the data member of `get_record_context`'s answer for the
 * citation's call, whitespace collapsed; `undefined` when the call is refused.
 */
async function haystackOf(c: RecordCitationParsed, door: RecordContextDoor): Promise<readonly string[] | undefined> {
  let answer: GetRecordContextOutput;
  try {
    answer = await executeGetRecordContext(
      {
        objectName: c.object,
        recordId: c.id,
        ...(c.context !== undefined ? { context: c.context } : {}),
        ...(c.anchor !== undefined ? { anchor: c.anchor } : {}),
      },
      door,
    );
  } catch {
    // Every refusal is one outcome: the citation is not verified.
    return undefined;
  }

  const data = answer.data;
  const strings: string[] = [];
  const addEntries = (entries: readonly RecordContextFieldEntry[] | undefined) => {
    for (const entry of entries ?? []) {
      if (typeof entry.value === 'string') strings.push(entry.value);
      if (typeof entry.display === 'string') strings.push(entry.display);
    }
  };
  addEntries(data.fields);
  for (const list of data.related ?? []) {
    for (const row of list.rows) addEntries(row.fields);
  }
  const text = data.body?.text;
  if (typeof text === 'string') {
    strings.push(text);
    if (text.includes('<') && (await bodyIsHtml(c.object, data.body?.field, door))) strings.push(stripBodyTags(text));
  }
  return strings.map(collapse);
}

/** Whether the body field writes HTML, by the definition the caller is served. */
async function bodyIsHtml(object: string, field: string | undefined, door: RecordContextDoor): Promise<boolean> {
  if (field === undefined) return false;
  try {
    const def = await door.servedObjectDefinitionOf(object);
    const fields = (def?.fields ?? {}) as Record<string, { type?: unknown } | undefined>;
    return isHtmlBodyType(fields[field]?.type);
  } catch {
    return false;
  }
}
