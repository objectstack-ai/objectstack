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
import { executeGetRecordContext, isCodedRefusal } from './record-context-tools.js';

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
 * - **A failed call verifies nothing either, and is reported.** A refusal is
 *   a throw carrying an ADR-0112 `code` with a declared 4xx status — the only
 *   shape `get_record_context` refuses with. The declared status is read as
 *   ADR-0112's reader reads it (`resolveThrownHttpError`'s `declaredStatus`
 *   in `@objectstack/types`): `.status`, then `.statusCode`. Any other throw
 *   (no `code`, no status, a 5xx, a thrown value that is not an object: an
 *   outage, a bug) is a failure, not an answer: its citations are dropped all
 *   the same, so the result stays fail-closed, and the failure goes to
 *   `options.onError`, once per call, so the host can log or retry it.
 *   ADR-0112 names the status channel as the one structural signal between a
 *   refusal and a fault; a driver errno also arrives on `.code`, so the
 *   string alone cannot tell.
 *
 *   The executor draws the same line with the same reader
 *   (`isCodedRefusal`) at the reads of a related object it judges, so a
 *   failure there is no refusal either: it arrives here as
 *   `SERVICE_UNAVAILABLE` (503), naming nothing, with the original error on
 *   its `cause`, and is reported. The whole 4xx band is a refusal, so a door that declared a coded 408 or
 *   429 would have a transient condition dropped without a report; no door on
 *   the read path declares one today.
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
 *
 *   The tag-removed reading is a second string, not a replacement, so it can
 *   verify a quote the stored text does not hold: removing a tag joins the
 *   text on either side of it, so `<p>Fire</p><p>cover</p>` reads as
 *   `Firecover`. It never verifies a quote that is not in the body's
 *   characters in order, but it is not "only stricter" than matching as
 *   stored.
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
 * model wrote cannot make the platform read without bound. That is the cap a
 * producer gets: this function reads the first 20 and drops the rest, where
 * `RecordCitationsSchema` refuses a list of 21 outright; a producer that
 * verifies a model's list with this function persists at most 20. A dropped
 * citation leaves no trace in the result: a caller who cannot read a record
 * learns nothing from its citations' fate that tells a hidden record from a
 * missing one. `onError` is for the host, never the caller: it is called for a
 * failure only, never for a refusal, so a refused read and a missing record
 * give the host the same answer too. A callback that throws, or returns a
 * promise that rejects, is ignored.
 */
export async function verifyRecordCitations(
  citations: unknown,
  door: RecordContextDoor,
  options: VerifyRecordCitationsOptions = {},
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
    if (!haystacks.has(key)) haystacks.set(key, haystackOf(c, door, options.onError));
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

/** Options of {@link verifyRecordCitations}. */
export interface VerifyRecordCitationsOptions {
  /**
   * Called with the thrown value and the call's arguments when a read made to
   * verify a citation failed rather than refused (see the rule). Two reads
   * report:
   *
   * - the verifying `get_record_context` call: its citations are dropped
   *   whether or not this is given, and it reports at most once per call;
   * - the read of the served definition behind an `html` or `richtext` body:
   *   the call answered, and only the tag-removed reading of the body is
   *   lost, so a citation whose quote is in a field or in the body as stored
   *   still verifies.
   *
   * A callback that throws, or returns a promise that rejects, changes
   * nothing.
   */
  onError?: (error: unknown, call: VerifyingCall) => void;
}

/** The arguments of one verifying `get_record_context` call. */
export interface VerifyingCall {
  object: string;
  id: string;
  context?: string;
  anchor?: string;
}

/** Hand a failure to the host; a callback that throws changes nothing. */
function report(onError: VerifyRecordCitationsOptions['onError'], err: unknown, c: RecordCitationParsed): void {
  if (onError === undefined || isCodedRefusal(err)) return;
  const call: VerifyingCall = {
    object: c.object,
    id: c.id,
    ...(c.context !== undefined ? { context: c.context } : {}),
    ...(c.anchor !== undefined ? { anchor: c.anchor } : {}),
  };
  try {
    const returned: unknown = onError(err, call);
    // An async callback's rejection would otherwise be an unhandled rejection.
    if (returned != null && typeof (returned as { then?: unknown }).then === 'function') {
      (returned as PromiseLike<unknown>).then(undefined, () => {});
    }
  } catch {
    // The verifier never throws for a citation.
  }
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
async function haystackOf(
  c: RecordCitationParsed,
  door: RecordContextDoor,
  onError: VerifyRecordCitationsOptions['onError'],
): Promise<readonly string[] | undefined> {
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
  } catch (err) {
    // A refusal and a failure are one outcome for the result: the citation is
    // not verified. Only a failure is reported.
    report(onError, err, c);
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
    if (text.includes('<') && (await bodyIsHtml(c, data.body?.field, door, onError))) strings.push(stripBodyTags(text));
  }
  return strings.map(collapse);
}

/** Whether the body field writes HTML, by the definition the caller is served. */
async function bodyIsHtml(
  c: RecordCitationParsed,
  field: string | undefined,
  door: RecordContextDoor,
  onError: VerifyRecordCitationsOptions['onError'],
): Promise<boolean> {
  if (field === undefined) return false;
  try {
    const def = await door.servedObjectDefinitionOf(c.object);
    const fields = (def?.fields ?? {}) as Record<string, { type?: unknown } | undefined>;
    return isHtmlBodyType(fields[field]?.type);
  } catch (err) {
    // Fail-closed: the body is matched as stored only. A failure is reported.
    report(onError, err, c);
    return false;
  }
}
