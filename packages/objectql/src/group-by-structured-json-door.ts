// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20783] A `groupBy` that names a STRUCTURED-JSON field — `json`,
 * `composite`, `repeater`, `record`, `location`, `address`, `vector` — is
 * refused with `INVALID_FIELD` / 400 by the engine's `aggregate`, naming the
 * field, its declared type and the position, before any driver is asked.
 * [#20808] So is a `groupBy` that names a MULTI-VALUE field (the second class,
 * below): every JSON-stored group key is refused at this one door.
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
 * field map, no verdict), and every scalar-stored type, single-value file
 * fields included.
 *
 * ## [#20808] The second class: a MULTI-VALUE field
 *
 * A field whose value is a list — an inherently-multi option type
 * (`multiselect`, `checkboxes`, `tags`) or a multi-capable type flagged
 * `multiple: true` (`select`, `lookup`, `user`, `file`, `image`) — is stored
 * in a JSON column too, and split the same three ways, measured on
 * `origin/main` `42d78b97fe` through `POST /api/v1/data/:object/query` over
 * every one of those eight declarations: the in-memory driver answered one
 * group per array, SQLite one group per serialized array, and PostgreSQL 16
 * refused the statement (`could not identify an equality operator for type
 * json`, a 500). The triage direction on #20808: "`groupBy` on a
 * `multiple: true` field is refused the same way" — "one bucket per member"
 * is a capability no caller was measured to need, and "one group per
 * serialized array" is not a meaning any caller could rely on; no dataset,
 * cube, report, view grouping or `groupBy` in `examples/` or in the published
 * hotcrm stack names a multi-value field. ⛔ No
 * bucket-per-member grouping. The refusal names what works: filter by one
 * member with `$contains`, the membership operator every driver lowers for a
 * JSON-stored list.
 *
 * The class is `@objectstack/spec/data`'s {@link isMultiValueField} — THE
 * definition of "is this field multi-valued", which reads the declaration
 * (`multiple`) as well as the type, so a single-value `select` or `lookup`
 * is untouched. Both classes are judged in ONE walk over the entries, so the
 * refusal names the first offending position whichever class it is, and
 * `fields` lists every offender.
 *
 * `INVALID_FIELD`, not a new code: the verdict is about the NAMED field's
 * type at a position, the question the ingress door answers with
 * `INVALID_FIELD` for an unknown `groupBy` name and the search axis answers
 * with `INVALID_FIELD` for a field whose type it cannot scan.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20783
 * @see https://github.com/objectstack-ai/objectstack/issues/20808
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { STRUCTURED_JSON_TYPES, isMultiValueField } from '@objectstack/spec/data';

/** Which JSON-stored class a `groupBy` entry's field belongs to. */
type JsonStoredGroupClass = 'structured-json' | 'multi-value';

/** One `groupBy` entry that names a JSON-stored field. */
interface JsonStoredGroupTarget {
  readonly field: string;
  readonly type: string;
  /** The declared field carries `multiple: true` (said in the words). */
  readonly multiple: boolean;
  readonly cls: JsonStoredGroupClass;
  /** `groupBy[i]` for a name, `groupBy[i].field` for the object form. */
  readonly position: string;
}

/**
 * The entries of `groupBy` that name a declared structured-JSON or
 * multi-value field, in order. An entry that names no field, a field the map
 * does not declare, or a field of any other type is not collected.
 */
function jsonStoredGroupTargets(
  fields: Record<string, unknown>,
  groupBy: readonly unknown[],
): JsonStoredGroupTarget[] {
  const hits: JsonStoredGroupTarget[] = [];
  for (const [i, entry] of groupBy.entries()) {
    const objectForm = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    const field = typeof entry === 'string'
      ? entry
      : objectForm ? (entry as { field?: unknown }).field : undefined;
    if (typeof field !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const def = fields[field] as { type?: unknown; multiple?: unknown } | undefined;
    const type = def?.type;
    if (typeof type !== 'string') continue;
    const multiple = def?.multiple === true;
    const cls: JsonStoredGroupClass | null = STRUCTURED_JSON_TYPES.has(type)
      ? 'structured-json'
      : isMultiValueField({ type, multiple }) ? 'multi-value' : null;
    if (cls === null) continue;
    hits.push({ field, type, multiple, cls, position: objectForm ? `groupBy[${i}].field` : `groupBy[${i}]` });
  }
  return hits;
}

/**
 * The verdict, the route and the reason for the FIRST offender's class. The
 * route comes before the reason so it lands inside the 500 characters the
 * REST door keeps.
 */
function groupByRefusalWords(first: JsonStoredGroupTarget): { verdict: string; tail: string } {
  if (first.cls === 'multi-value') {
    return {
      verdict: '— a multi-value field, which the engine does not group by',
      tail: '. The query was NOT run. Filter by one member instead: '
        + `where { "${first.field}": { "$contains": VALUE } } counts or lists the records that hold VALUE, `
        + 'one query per member. A list of values is no group key the drivers share: one grouped each '
        + 'list apart, one grouped each serialized list apart, one refused the statement.',
    };
  }
  return {
    verdict: '— a structured-JSON value, which the engine does not group by',
    tail: '. The query was NOT run. Group by a field that stores one scalar value: store the part you '
      + 'group on in a field of its own and group by that field. A JSON document is no group key the '
      + 'drivers share: one merged documents that differ into one group (or split them per array), '
      + 'one grouped each serialized document apart, one refused the statement.',
  };
}

/**
 * Refuse a `groupBy` entry that names a declared structured-JSON field
 * (#20783) or a declared multi-value field (#20808) — `INVALID_FIELD` / 400,
 * before any driver is asked. See the module header.
 *
 * The words put the position and the verdict first, then that the query did
 * not run, then the route, then the reason: the REST door keeps the first 500
 * characters of a 4xx message (`CLIENT_MESSAGE_MAX`), and the route must be
 * inside them.
 */
export function assertGroupByNamesNoJsonStoredField(
  object: string,
  schema: unknown,
  groupBy: unknown,
): void {
  if (!Array.isArray(groupBy) || groupBy.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const hits = jsonStoredGroupTargets(fields as Record<string, unknown>, groupBy);
  if (hits.length === 0) return;
  const [first] = hits;
  const { verdict, tail } = groupByRefusalWords(first);
  const declared = first.multiple ? `${first.type} field with multiple: true` : `${first.type} field`;
  const err = new Error(
    `aggregate('${object}'): ${first.position} names '${first.field}', a declared ${declared} `
    + verdict
    + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '')
    + tail,
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
