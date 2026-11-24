// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The figure each Approvals Inbox queue row shows beside its object name, and
 * the field the inbox's amount sort orders on: one field per object, read
 * from what the app author DECLARED on that object, never guessed.
 *
 * Two declarations of the object's schema decide it, and both come from one
 * metadata read:
 *
 *  - `highlightFields` (ADR-0085) — the object's one curated list of its most
 *    important fields, in priority order; the spec's docblock says the first
 *    entry wins wherever only one field fits. A queue row has room for one
 *    figure, so the figure is the first entry that names a numeric field
 *    ({@link inboxFigureField}). ⛔ No second "important fields" list, and no
 *    reading of field NAMES: an object that declares no numeric highlight
 *    shows no figure.
 *  - `hidden: true` — a field the author declared hidden is never the figure,
 *    and the queue never orders on it either (an ordering discloses relative
 *    magnitude). Details below.
 *
 * ## `hidden: true` is a UI contract, and the trim is here
 *
 * The maintainer's ruling on objectstack#10749 pinned it: *`hidden: true`
 * stays UI-only; `internal: true` is the serialization primitive*. A field an
 * author wants off the wire entirely is declared `internal: true` and never
 * reaches a client at all; a field-level access control is FLS, which the
 * server applies at serve time (`getReadableFields`, objectstack#11039).
 *
 * `hidden` is neither of those. The producer is **correct** to ship a `hidden`
 * field in an approval request's `payload_json` snapshot, so the UI is not
 * compensating for a bad producer when it declines to render it — the UI is
 * the *only* place that contract lives, and the queue rows and the amount sort
 * are default UI. That is why the trim is here and not in
 * `@objectstack/plugin-approvals`.
 *
 * ⛔ Do not extend this to `internal`. They are distinct primitives with
 * distinct meanings, and conflating them here would re-introduce the
 * serialization semantic the ruling refused.
 *
 * ## No answer, no figure
 *
 * The figure needs a positive declaration, so every case where the
 * declaration is not known — nothing declared, the read has not answered yet,
 * the read failed, a source that cannot describe objects — yields no figure.
 * That is not an access decision: the server stays the only authority on what
 * a principal may read, and the approver still sees every value on the
 * request's own page. It only means the queue shows nothing rather than a
 * number nobody chose.
 *
 * ## Cost
 *
 * One `getObjectSchema(objectName)` per distinct object, per mount — so a page
 * of N queue rows spanning K objects costs `K` reads, not N, and paging in
 * more rows costs only the objects not seen yet. See `planHiddenFieldReads`,
 * which IS the cost model and is pinned by `hiddenFields.test.ts`. The read is
 * `GET /api/v1/meta/object/:name` — the same read the record form and detail
 * view already perform for any business user — and it lands on the adapter's
 * own `MetadataCache` (LRU, 5-minute TTL, in-flight de-duplication), so
 * repeated reads of one object cost zero round trips. On top of that this
 * hook keeps a per-mount resolved map, so re-renders (the page's 60s clock,
 * search typing) cost nothing at all.
 *
 * Invalidation is therefore: the adapter cache's TTL, an explicit adapter
 * `clearCache()` (which the shell issues on a locale switch), or a page
 * reload. A declaration changed in Studio while this page is open is picked
 * up on the next reload — the same staleness `useRecordReadability` accepts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdapter } from '@object-ui/app-shell';

/**
 * Minimal structural view of the metadata source this needs. Declared here
 * rather than importing the adapter type so the reader is testable with a
 * counting stub — and so it can never reach for anything but a schema read.
 *
 * `getObjectSchema` is optional on purpose: `DataSource` implementations that
 * cannot describe an object simply do not have it, and that is an *unknown*
 * answer, not an empty one.
 */
export interface HiddenFieldsSource {
  getObjectSchema?(objectName: string): Promise<unknown>;
}

/** Nothing declared hidden. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * The schema's field definitions by name.
 *
 * `fields` arrives in either shape the platform serves: the record shape
 * (`{ name: def }`, the `*.object.ts` spec shape) or the array shape
 * (`[{ name, ...def }]`, the objectql shape). Both are read; anything else
 * yields no definitions.
 */
function fieldDefinitions(schema: unknown): ReadonlyMap<string, Record<string, unknown>> {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  const out = new Map<string, Record<string, unknown>>();
  if (!fields || typeof fields !== 'object') return out;
  if (Array.isArray(fields)) {
    for (const entry of fields) {
      if (!entry || typeof entry !== 'object') continue;
      const def = entry as Record<string, unknown>;
      const name = def.name;
      if (typeof name === 'string' && name !== '') out.set(name, def);
    }
  } else {
    for (const [name, def] of Object.entries(fields as Record<string, unknown>)) {
      if (def && typeof def === 'object') out.set(name, def as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Field names an object schema declares `hidden: true`.
 *
 * Strictly `=== true`. A truthy-but-not-true value (a string `'false'`, a `1`)
 * is not a declaration this can act on, and guessing at one would hide a field
 * the author never asked to hide.
 */
export function hiddenFieldNames(schema: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [name, def] of fieldDefinitions(schema)) {
    if (def.hidden === true) out.add(name);
  }
  return out.size > 0 ? out : NONE;
}

/** Field types whose stored value is a number (`@objectstack/spec` `FieldType`). */
const FIGURE_FIELD_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent', 'summary']);

/** A `formula` field's `returnType` values that compute a number. */
const FIGURE_FORMULA_RETURN_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent']);

function isFigureField(def: Record<string, unknown>): boolean {
  const type = def.type;
  if (typeof type !== 'string') return false;
  if (FIGURE_FIELD_TYPES.has(type)) return true;
  return type === 'formula'
    && typeof def.returnType === 'string'
    && FIGURE_FORMULA_RETURN_TYPES.has(def.returnType);
}

/**
 * The object's inbox figure: the first `highlightFields` entry (ADR-0085)
 * that names a numeric field of the object the author did not declare
 * `hidden: true`. `null` when the object declares no such entry — the queue
 * then shows no figure.
 *
 * Numeric means a `number`, `currency`, `percent` or `summary` (roll-up)
 * field, or a `formula` whose `returnType` is `number`, `currency` or
 * `percent`. An entry naming a field the schema does not define is skipped:
 * there is no type to judge it by.
 */
export function inboxFigureField(schema: unknown): string | null {
  const highlights = (schema as { highlightFields?: unknown } | null | undefined)?.highlightFields;
  if (!Array.isArray(highlights)) return null;
  const defs = fieldDefinitions(schema);
  for (const name of highlights) {
    if (typeof name !== 'string') continue;
    const def = defs.get(name);
    if (!def || def.hidden === true) continue;
    if (isFigureField(def)) return name;
  }
  return null;
}

/**
 * Read one object's inbox figure field.
 *
 * Never rejects: a source that cannot answer — no `getObjectSchema`, a 404, a
 * transport error, a principal without metadata read — resolves to `null`,
 * which shows no figure. See the header.
 */
export async function readInboxFigureField(
  source: HiddenFieldsSource | null | undefined,
  objectName: string,
): Promise<string | null> {
  if (typeof source?.getObjectSchema !== 'function') return null;
  try {
    return inboxFigureField(await source.getObjectSchema(objectName));
  } catch {
    // Unknown, so no figure. Deliberately silent: a viewer without metadata
    // access to the object hits this on every mount, and a console error per
    // mount would be noise, not a signal.
    return null;
  }
}

/**
 * The distinct objects one render needs answers for — **the cost model**.
 *
 * The returned length is exactly the number of metadata reads a render adds,
 * so a test can assert the cost directly instead of describing it. Names are
 * deduped and kept in first-seen order (stable output for stable input); a
 * missing or empty name is not an object and is dropped.
 */
export function planHiddenFieldReads(
  objectNames: readonly (string | null | undefined)[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of objectNames) {
    if (typeof name !== 'string' || name === '' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** What a row asks the lookup at render time. */
export interface InboxFigureFieldLookup {
  /**
   * The payload key `objectName`'s rows show as their figure, or `null` for
   * no figure — which covers *nothing declared*, *this object was never asked
   * about*, *the read has not answered yet* and *the read failed*, one answer
   * on purpose. See the header.
   */
  forObject(objectName: string | null | undefined): string | null;
}

/**
 * The inbox figure field of every object on screen, each resolved once per
 * mount.
 *
 * A queue is N rows spanning K objects, so the answer cannot be one field —
 * each object declares its own `highlightFields` and its own `hidden` fields.
 * The lookup is therefore keyed by object name, and a row always asks with its
 * OWN `object_name`.
 *
 * Every object is read at most once per mount: newly loaded rows cost only the
 * objects not seen yet, and re-renders (search typing, the minute clock) cost
 * nothing. Until a read answers, `forObject` returns `null`, so the first
 * paint shows no figure and the declared one appears once it is known.
 */
export function useInboxFigureFieldByObject(
  objectNames: readonly (string | null | undefined)[],
): InboxFigureFieldLookup {
  const adapter = useAdapter() as HiddenFieldsSource | null | undefined;
  const [known, setKnown] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  /** Object names already handed to a read — the "read once" ledger. */
  const attempted = useRef<Set<string>>(new Set());
  /** Latest names without making them an effect dependency (see `signature`). */
  const latest = useRef<readonly (string | null | undefined)[]>(objectNames);
  latest.current = objectNames;

  // `objectNames` is a fresh array every render, so the effect keys off the SET
  // of objects rather than the array's identity.
  const signature = useMemo(() => planHiddenFieldReads(objectNames).join('|'), [objectNames]);

  useEffect(() => {
    if (!adapter) return;
    const fresh = planHiddenFieldReads(latest.current).filter((n) => !attempted.current.has(n));
    if (fresh.length === 0) return;
    for (const n of fresh) attempted.current.add(n);
    let cancelled = false;
    // `readInboxFigureField` never rejects, so one object that cannot be
    // described resolves to `null` without dropping the others' answers.
    void Promise.all(
      fresh.map(async (n) => [n, await readInboxFigureField(adapter, n)] as const),
    ).then((entries) => {
      if (cancelled) return;
      setKnown((prev) => {
        const next = new Map(prev);
        for (const [n, field] of entries) next.set(n, field);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [adapter, signature]);

  return useMemo<InboxFigureFieldLookup>(() => ({
    forObject: (objectName) => (
      typeof objectName === 'string' && objectName !== ''
        ? known.get(objectName) ?? null
        : null
    ),
  }), [known]);
}
