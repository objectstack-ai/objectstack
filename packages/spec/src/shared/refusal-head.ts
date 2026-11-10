// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32279] The one-line HEAD a long spec refusal answers on the wire, beside
 * the full prescription it keeps everywhere else.
 *
 * ## Why a refusal carries two texts
 *
 * The retired-key, retired-aggregation and filter-comparand refusals are
 * written for an AUTHOR: the refused key, the version and ADR that retired it,
 * why, the fix and its spellings. `os compile`, the save doors and
 * `os migrate` print that prescription, and an upgrading author (very often an
 * AI) reads it there. On the data doors the same sentence reached a caller as
 * `fields[].message` or the top-level message, at 300–1,300 characters, which
 * a toast cannot show (#32169, item 2b).
 *
 * So each such refusal is split by audience at the place it is written:
 *
 *  - the **prescription** is the refusal's message, byte-equal to what it was,
 *    so every authoring surface prints exactly what it printed;
 *  - the **head** is one line, written by hand (⛔ never cut from the
 *    prescription: in several of them the key or the fix sits in a later
 *    sentence), naming the refused key or shape and the fix, at most
 *    {@link REFUSAL_HEAD_MAX} characters.
 *
 * A data door answers the head as the message and the prescription beside it
 * as the hint (`fields[].hint`, `details.hint`). Nothing is cut, so the hint
 * holds the whole account the message used to.
 *
 * ## How a head travels with its refusal
 *
 * Three carriers, because zod lets a refusal carry anything beside its
 * message only on some issue kinds:
 *
 *  - a thrown `Error` carries `refusalHead` as an own property (the
 *    comparand-shape face's `INVALID_FILTER` refusals);
 *  - a zod `custom` issue carries it in `params.refusalHead` (the save door's
 *    comparand refusals, raised with `ctx.addIssue`);
 *  - a refusal zod raises from an error map (a retired key's `z.never`, a
 *    retired enum member) can carry only its message, so its head is
 *    registered against the prescription text once, where the constant is
 *    declared ({@link withRefusalHead}), and found again by that text.
 *
 * {@link refusalHeadOf} reads all three, so a door asks one question.
 */

/** The longest head a refusal answers: the bound PR #32303 set for the datasource refusals. */
export const REFUSAL_HEAD_MAX = 160;

/**
 * Prescription text → its head, for the refusals zod raises from an error map.
 *
 * Held on `globalThis` under a registered symbol rather than in this module's
 * scope: `@objectstack/spec` ships ESM and CJS builds, and a host that loads
 * both would otherwise register a constant in one copy and look it up in the
 * other. Keys are a fixed set of module constants, so the map never grows at
 * request time.
 */
const REGISTRY_KEY = Symbol.for('@objectstack/spec:refusal-heads');

function registry(): Map<string, string> {
  const holder = globalThis as unknown as Record<symbol, Map<string, string> | undefined>;
  let map = holder[REGISTRY_KEY];
  if (!map) {
    map = new Map<string, string>();
    holder[REGISTRY_KEY] = map;
  }
  return map;
}

/**
 * Register `head` as the one-line head of the constant `prescription`, and
 * return the prescription unchanged, so the constant keeps its text and type:
 *
 * ```ts
 * export const QUERY_CURSOR_REMOVED = withRefusalHead(
 *   '`query.cursor` was removed in … caller-built record.',
 *   '`query.cursor` was removed in @objectstack/spec 17: delete the key and …',
 * );
 * ```
 *
 * Only for a constant: a refusal built per call (it names a field or a
 * value) carries its head on the error or the issue instead, so this map
 * never holds request input.
 */
export function withRefusalHead(prescription: string, head: string): string {
  assertRefusalHead(head);
  registry().set(prescription, head);
  return prescription;
}

/**
 * Refuse a head that breaks the contract: blank, more than one line, or
 * longer than {@link REFUSAL_HEAD_MAX}. Thrown at the declaration, so a head
 * that grew past the bound fails the module load and every test that loads it.
 */
export function assertRefusalHead(head: string): void {
  if (head.trim() === '' || head.includes('\n') || head.length > REFUSAL_HEAD_MAX) {
    throw new Error(
      `refusal head must be one non-blank line of at most ${REFUSAL_HEAD_MAX} characters `
      + `(got ${head.length}): ${head.slice(0, 80)}`,
    );
  }
}

/**
 * A field name as a head prints it: whole up to 48 characters, then elided.
 * A head that names a caller's field (a `where` key) must stay inside the
 * bound whatever the caller sent.
 */
export function headFieldName(field: string): string {
  return field.length > 48 ? `${field.slice(0, 47)}…` : field;
}

/**
 * The head a refusal carries, or `undefined` when it has none: a thrown
 * error's `refusalHead`, a zod issue's `params.refusalHead`, or the head
 * registered for its message ({@link withRefusalHead}). Anything that is not
 * a one-line string within the bound is ignored, so a stray property never
 * replaces a message.
 */
export function refusalHeadOf(carrier: unknown): string | undefined {
  if (carrier === null || typeof carrier !== 'object') return undefined;
  const own = (carrier as { refusalHead?: unknown }).refusalHead;
  const params = (carrier as { params?: { refusalHead?: unknown } | null }).params;
  const fromParams = params !== null && typeof params === 'object' ? params.refusalHead : undefined;
  const message = (carrier as { message?: unknown }).message;
  const registered = typeof message === 'string' ? registry().get(message) : undefined;
  const head = typeof own === 'string' ? own : typeof fromParams === 'string' ? fromParams : registered;
  if (head === undefined || head.trim() === '' || head.includes('\n') || head.length > REFUSAL_HEAD_MAX) {
    return undefined;
  }
  return head;
}
