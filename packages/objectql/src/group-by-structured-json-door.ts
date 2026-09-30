// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20783] A `groupBy` that names a STRUCTURED-JSON field — `json`,
 * `composite`, `repeater`, `record`, `location`, `address`, `vector` — is
 * refused with `INVALID_FIELD` / 400 by the engine's `aggregate`, naming the
 * field, its declared type and the position, before any driver is asked.
 *
 * ## What ran before this door, measured on `origin/main` `7a09eee1b1`
 *
 * Through `POST /api/v1/data/:object/query` (`{ groupBy: [FIELD],
 * aggregations: [{ function: 'count', alias: 'n' }] }`) and `engine.aggregate`
 * alike, three rows whose values under the grouped field differ:
 *
 * | `groupBy` | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | a `text` field (the control) | 200, one group per value | same | same |
 * | a `json` field, and its `composite`, `repeater`, `record`, `location`, `address` twins | 200, **one group** holding every row | 200, one group per serialized document | **500 `DATABASE_ERROR`** |
 * | a `vector` field | 200, one group per array | 200, one group per serialized array | 500 |
 * | `{ field: 'meta', dateGranularity: 'month' }` over a `json` field | 200, one `null` bucket | 200, one `null` bucket | 500 |
 *
 * One query, three answers, one of them a server error. No member of the class
 * answers one way on the three drivers, so the class is refused, not its
 * `json` member alone.
 *
 * ## Refuse, don't define
 *
 * The triage direction on the card: grouping by a JSON document has no meaning
 * the drivers share, no producer that groups by one was measured (no dataset,
 * cube, view grouping or `groupBy` in `examples/` names a structured-JSON
 * field), and #20745 refused the JSON object comparand at this same door. So
 * the engine refuses it rather than choosing a serialization for every driver
 * to agree on. ⛔ No per-driver serialization rule. A real producer that needs
 * a meaning proposes one on a card of its own.
 *
 * ## Where it stands, and what it judges
 *
 * `aggregate` is the one engine verb that takes `groupBy` (`find` refuses the
 * key: `ENGINE_FIND_OPTION_KEYS`), and this door runs at its entry, beside the
 * credential refusal that reads the same `groupBy` entries, so it holds for
 * every caller that reaches the engine: the REST query door, a flow, a hook,
 * and the analytics strategy that lowers a cube query onto `engine.aggregate`.
 * Both spellings of an entry are judged — a field name, and the `{ field }`
 * object (a date bucket included: no granularity makes a JSON document a
 * date).
 *
 * The class is `@objectstack/spec/data`'s {@link STRUCTURED_JSON_TYPES}, the
 * set #20745's JSON arm judges too, never a list minted here. **Not judged:**
 * an undeclared name (the engine's registry-less tolerance — the ingress door
 * answers an unknown one `INVALID_FIELD` first), a registry-less host (no
 * field map, no verdict), and every other type, `multiple: true` lists and
 * file fields included: those are not this card's class.
 *
 * `INVALID_FIELD`, not a new code: the verdict is about the NAMED field's
 * type at a position, the question the ingress door answers with
 * `INVALID_FIELD` for an unknown `groupBy` name and the search axis answers
 * with `INVALID_FIELD` for a field whose type it cannot scan.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20783
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { STRUCTURED_JSON_TYPES } from '@objectstack/spec/data';

/** One `groupBy` entry that names a structured-JSON field. */
interface StructuredJsonGroupTarget {
  readonly field: string;
  readonly type: string;
  /** `groupBy[i]` for a name, `groupBy[i].field` for the object form. */
  readonly position: string;
}

/**
 * The entries of `groupBy` that name a declared structured-JSON field, in
 * order. An entry that names no field, a field the map does not declare, or a
 * field of any other type is not collected.
 */
function structuredJsonGroupTargets(
  fields: Record<string, unknown>,
  groupBy: readonly unknown[],
): StructuredJsonGroupTarget[] {
  const hits: StructuredJsonGroupTarget[] = [];
  for (const [i, entry] of groupBy.entries()) {
    const objectForm = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    const field = typeof entry === 'string'
      ? entry
      : objectForm ? (entry as { field?: unknown }).field : undefined;
    if (typeof field !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const type = (fields[field] as { type?: unknown } | undefined)?.type;
    if (typeof type !== 'string' || !STRUCTURED_JSON_TYPES.has(type)) continue;
    hits.push({ field, type, position: objectForm ? `groupBy[${i}].field` : `groupBy[${i}]` });
  }
  return hits;
}

/**
 * Refuse a `groupBy` entry that names a declared structured-JSON field —
 * `INVALID_FIELD` / 400, before any driver is asked. See the module header.
 *
 * The words put the position and the verdict first, then that the query did
 * not run, then the route, then the reason: the REST door keeps the first 500
 * characters of a 4xx message (`CLIENT_MESSAGE_MAX`), and the route must be
 * inside them.
 */
export function assertGroupByNamesNoStructuredJsonField(
  object: string,
  schema: unknown,
  groupBy: unknown,
): void {
  if (!Array.isArray(groupBy) || groupBy.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const hits = structuredJsonGroupTargets(fields as Record<string, unknown>, groupBy);
  if (hits.length === 0) return;
  const [first] = hits;
  const err = new Error(
    `aggregate('${object}'): ${first.position} names '${first.field}', a declared ${first.type} field `
    + '— a structured-JSON value, which the engine does not group by'
    + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '')
    + '. The query was NOT run. Group by a field that stores one scalar value: store the part you '
    + 'group on in a field of its own and group by that field. A JSON document is no group key the '
    + 'drivers share: one merged every row into a single group, one grouped each serialized '
    + 'document apart, one refused the statement.',
  ) as Error & {
    code?: string; status?: number; httpStatus?: number;
    field?: string; fields?: string[]; object?: string; param?: string;
  };
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a
  // consumer holding the THROWN error reads; `status` stays for the HTTP doors.
  err.httpStatus = 400;
  err.field = first.field;
  err.fields = hits.map((h) => h.field);
  err.object = object;
  err.param = 'groupBy';
  throw err;
}
