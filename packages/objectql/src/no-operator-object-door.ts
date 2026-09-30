// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20546] The NO-OPERATOR-OBJECT arm: a plain object with no `$`-operator key
 * written where a scalar field's value belongs — `{ amount: { a: 1 } }` over a
 * declared `number` field — is refused with `INVALID_FILTER` / 400, naming the
 * field and the path, at every position the engine judges.
 *
 * ## ⛔ Not a door of its own: an ARM of the number-comparand door's walk
 *
 * This module holds the arm's three parts — which columns it judges, what it
 * refuses, and the words — and nothing that walks a filter. The walk is
 * `number-comparand-declared-type-door.ts`'s `walkCondition`, the one filter
 * walk the engine runs at all three filter positions with the column's
 * declaration in hand (`where` in both spellings, `aggregations[i].filter`,
 * and `having`). Triage directed it there: "If the same walk is the natural
 * site, it lands serially after that PR, in the same walk. ⛔ No second
 * traversal of the filter." That walk already stood on the exact branch — a
 * field spec with no `$` key — and stepped past it for the numeric fields it
 * judges; it now asks this module about every declared field before the number
 * arm runs.
 *
 * ## What ran before this arm, measured on `origin/main` `fbec216e2d`
 *
 * Three rows, through `engine.find` / `engine.aggregate` and
 * `POST /api/v1/data/:object/query` (both doors answered alike):
 *
 * | position · filter | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `where` `{ amount: { a: 1 } }` (number), `{ title: { a: 1 } }` (text), and the select, boolean, date, autonumber, multi-select, `multiple: true` select twins | 200, no rows | 400 `INVALID_FILTER`, the driver's words | same as SQLite |
 * | `where` `{ $not: { amount: { a: 1 } } }` | 200, **every row** | 400, the driver's words | same |
 * | `aggregations[1].filter` `{ amount: { a: 1 } }` | 200, count 0 | 200, count 0 | 200, count 0 |
 * | `having` `{ total: { a: 1 } }` (a `sum`), `{ title: { a: 1 } }` (a groupBy) | 200, no group | 200, no group | 200, no group |
 *
 * One mistake, two answers at `where`, decided by the driver; a silent empty
 * at the two positions the engine evaluates itself.
 *
 * ## Which columns it judges — a closed definition, from the spec's classes
 *
 * A column is judged when its declared type stores SCALAR values: one scalar
 * ({@link SCALAR_FILTER_HEAD_TYPES}, `@objectstack/spec/data`'s published
 * "stores one scalar value" set, derived from the ADR-0104 value classes — the
 * #8371 dotted-head verdict reads the same set), or a list of scalar members
 * (the same set under `multiple: true`, and the inherently-multi option types,
 * {@link MULTI_OPTION_TYPES}). An object can never equal such a value, nor any
 * member of it, on any backend.
 *
 * - **Multi-value fields are judged, unlike the dotted-head verdict's
 *   carve-out.** That carve-out exists because a numeric-index DOTTED path
 *   (`'tags.0'`) reaches an array member on two backends. The nested-object
 *   spelling does not: `{ tags: { 0: 'x' } }` over a `multiple: true` select
 *   answered 200 with no rows on InMemoryDriver and 400 on both SQL dialects,
 *   the same split as the scalar case (measured on the base above).
 * - **The accepted side, never judged here:** a relation (`lookup`,
 *   `master_detail`, `user`, `tree`, single or multiple) — `{ owner: { region:
 *   'NA' } }` is a nested-relation condition, the form `FilterCondition`
 *   declares; a structured-JSON type (`json`, `composite`, `address`, …) — an
 *   object comparand is a whole-value match; a file or media type (a legacy
 *   stored value is an inline metadata object); `formula` (refused one door
 *   earlier, `INVALID_FIELD`); and a type this module has not met. That is
 *   the fail-open direction every neighbour takes: a hole, not a false 400.
 *   [#20745] The relation and structured-JSON rows are judged now, each in
 *   words of its own — see the section below.
 * - **A `{ $field }` reference is never this arm's**: it carries a `$` key. So
 *   does every operator bag, however malformed — the drivers and the
 *   comparand doors answer those.
 * - **`{}` is judged too** under a judged column. It has no `$` key, and at the
 *   two engine-evaluated positions it counted no row and kept no group on every
 *   driver; at `where` the drivers already refused it, and now the engine does,
 *   first.
 *
 * ## Structure test
 *
 * A PLAIN object only — prototype `Object.prototype` or `null`. A `Map` or a
 * class instance is a comparand the comparand-type door refuses in its own
 * words one call later, and a `Date` or an array is a comparand too: none of
 * them is filter structure.
 *
 * ## [#20745] Two more judged kinds: relation and structured-JSON columns
 *
 * The accepted side above was accepted by direction, not because anything
 * served it. Measured on `origin/main` `a51920f5fb` through
 * `POST /api/v1/data/:object/query`, three rows (owner `u1` in region NA on
 * `d1` and `d3`):
 *
 * | `where` | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `{ owner: { region: 'NA' } }` under a `lookup`, and its `master_detail`, `multiple: true` lookup, `user` and `tree` twins | 200, **no rows** (`d1` and `d3` were meant) | 400 `INVALID_FILTER`, the driver's words | same as SQLite |
 * | `{ meta: { a: 1 } }` under a `json` field; `{ ship_to: { city: 'Paris' } }` under an `address`, and a `composite` twin | 200, the deep-equal rows | 400, the driver's words | same |
 * | `{ id: { a: 1 } }` — `id` is absent from the declared map | 200, no rows | 400, the driver's words | same |
 * | `aggregations[1].filter` `{ owner: { region: 'NA' } }` | count 0 | count 0 | count 0 |
 * | `having` `{ owner: { region: 'NA' } }` over a `lookup` groupBy | no group | no group | no group |
 *
 * So the arm now judges three kinds of column, each with its own words
 * ({@link noOperatorObjectColumnKind}, a closed definition from the spec's
 * classes again):
 *
 * - **`scalar`** — as above, and now also a PLATFORM-PROVISIONED column the
 *   declared map omits (`id`, `created_at`, `updated_at`: the three every
 *   record carries and `find` / `findOne` / the write gate admit
 *   unconditionally, {@link provisionedNoOperatorObjectColumn}). The declared
 *   map deciding "is this a column" would have left `id` to the drivers.
 * - **`relation`** — {@link REFERENCE_VALUE_TYPES} (`lookup`,
 *   `master_detail`, `user`, `tree`), single or multiple. The object is the
 *   nested-relation form `FilterCondition` declares, and no data-path driver
 *   serves it: the column stores the related record's id. The words name the
 *   route every driver serves today — filter the related object, then match
 *   the ids it returns: `$in` for a single-valued field, `$contains` per id
 *   for a multi-valued one, whose JSON column the SQL driver refuses `$in` on
 *   (both measured on all three cells: rows `d1` and `d3`). A dotted path
 *   (`'owner.region'`) is no route: the #8371 dotted verdict refuses it on
 *   every driver, one door earlier.
 * - **`json`** — {@link STRUCTURED_JSON_TYPES} (`json`, `composite`,
 *   `address`, `location`, …). The object is a whole-value match, and the
 *   drivers share no meaning for one: memory compares documents, SQL refuses
 *   the bind. The words name what every driver answers alike: `$null` /
 *   `$exists` over the whole value, or a stored field holding the part the
 *   filter is about. `$contains` is no route here — the text-operator door
 *   refuses it over a JSON-valued column on every driver.
 *
 * **Still never judged:** file and media types (the #8371 carve-out — a
 * legacy stored value is an inline metadata object), `formula` (refused one
 * door earlier, `INVALID_FIELD`), a type this module has not met, and an
 * undeclared key that is not platform-provisioned (the engine's registry-less
 * tolerance: no second opinion about a name).
 *
 * ## [#20802] The relation kind at `where`: served, not refused
 *
 * The maintainer ruled the nested-relation form served (#20802, letter A),
 * lowered at the engine's filter seam with the drivers untouched. At `where`
 * the walk therefore hands a no-operator object beneath a relation column to
 * `relation-filter-lowering.ts` instead of refusing it: admitted against the
 * related object's declarations, then lowered by reading the related object as
 * the caller. The relation words below are raised only at the two positions
 * the engine evaluates itself — an aggregation's `filter` and `having` — and
 * say so. The `scalar` and `json` kinds are unchanged.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20546
 * @see https://github.com/objectstack-ai/objectstack/issues/20745
 */

import {
  isMultiValueField,
  MULTI_OPTION_TYPES,
  REFERENCE_VALUE_TYPES,
  referenceTargetOf,
  SCALAR_FILTER_HEAD_TYPES,
  STRUCTURED_JSON_TYPES,
} from '@objectstack/spec/data';

/**
 * Does a column of this declared type hold scalar values — one, or a list of
 * scalar members — so that an object beneath it can match nothing? The arm's
 * `scalar` kind; see the module header for the closed definition and the
 * accepted side.
 */
export function holdsScalarValues(type: string): boolean {
  return SCALAR_FILTER_HEAD_TYPES.has(type) || MULTI_OPTION_TYPES.has(type);
}

/**
 * [#20745] The three kinds of column the arm judges, each refused in words of
 * its own: a column holding scalar values, a relation column (it stores the
 * related record's id), and a structured-JSON column (a whole-value match has
 * no meaning the drivers share).
 */
export type NoOperatorObjectColumnKind = 'scalar' | 'relation' | 'json';

/**
 * [#20745] Which kind of column the arm judges a declared type as, or `null`
 * for a type it never judges (file and media, `formula`, a type it has not
 * met). One closed definition, from the spec's classes; see the module header.
 */
export function noOperatorObjectColumnKind(type: string): NoOperatorObjectColumnKind | null {
  if (holdsScalarValues(type)) return 'scalar';
  if (REFERENCE_VALUE_TYPES.has(type)) return 'relation';
  if (STRUCTURED_JSON_TYPES.has(type)) return 'json';
  return null;
}

/** What the arm knows about one judged column — what its words are written from. */
export interface NoOperatorObjectColumn {
  readonly kind: NoOperatorObjectColumnKind;
  /** The declared `FieldType` — for `having`, the type the aggregated column carries. */
  readonly type: string;
  /** A field declaration to read the relation route from; absent for an aggregated or provisioned column. */
  readonly def?: unknown;
  /** The column is platform-provisioned and absent from the declared map (`id`, …). */
  readonly provisioned?: boolean;
}

/**
 * [#20745] The judged column a field declaration names, or `null` when the
 * arm does not judge its type. Reads the declaration's `type` only; the
 * relation words read the rest of it, and only when a refusal is written.
 */
export function declaredNoOperatorObjectColumn(def: unknown): NoOperatorObjectColumn | null {
  if (typeof def !== 'object' || def === null) return null;
  const type = (def as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const kind = noOperatorObjectColumnKind(type);
  return kind === null ? null : { kind, type, def };
}

/**
 * [#20745] The columns every record carries whether or not the declared map
 * lists them, with the type each stores: the same three names `find` /
 * `findOne` add to their known set and the write gate admits unconditionally
 * (`PLATFORM_PROVISIONED_COLUMNS` in `engine.ts`), because the platform
 * provisions them rather than the author declaring them.
 */
const PLATFORM_PROVISIONED_COLUMN_TYPES: ReadonlyMap<string, string> = new Map([
  ['id', 'text'],
  ['created_at', 'datetime'],
  ['updated_at', 'datetime'],
]);

/**
 * [#20745] The judged column a key names when the declared map omits it: a
 * platform-provisioned column, judged by the type it stores — or `null` for
 * any other undeclared key, which keeps the engine's registry-less tolerance.
 */
export function provisionedNoOperatorObjectColumn(key: string): NoOperatorObjectColumn | null {
  const type = PLATFORM_PROVISIONED_COLUMN_TYPES.get(key);
  return type === undefined ? null : { kind: 'scalar', type, provisioned: true };
}

/**
 * Is this field spec a PLAIN object with no `$`-operator key — filter
 * structure where a value belongs? `{}` included; a `Map`, a class instance, a
 * `Date` and an array are comparands, not structure (see the module header).
 */
export function isNoOperatorObject(spec: unknown): spec is Record<string, unknown> {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return !Object.keys(spec).some((key) => key.startsWith('$'));
}

/** What the arm found: the column, its kind and type, where it sits, and the object's keys. */
export interface NoOperatorObjectRefusal {
  /** The filter key, which names the column. */
  readonly field: string;
  /** The judged column: its kind, its type and — for a declared field — its declaration. */
  readonly column: NoOperatorObjectColumn;
  /** The key path the object sits at (`where.amount`, `having.total`, …). */
  readonly path: string;
  /** The object's own keys, in order — `[]` for `{}`. */
  readonly keys: readonly string[];
  /** `having`: the column is an aggregated row's, not a declared field of the object. */
  readonly aggregated: boolean;
}

/** How the object is named in the words: its keys, never its values. */
function describeObject(keys: readonly string[]): string {
  if (keys.length === 0) return 'an empty object {}';
  const shown = keys.slice(0, 3).map((key) => JSON.stringify(key)).join(', ');
  const more = keys.length > 3 ? `, and ${keys.length - 3} more` : '';
  return `an object with no operator key (keys ${shown}${more})`;
}

/** The column, as the words name it at its position. */
function describeColumn(refusal: NoOperatorObjectRefusal): string {
  const { field, column } = refusal;
  if (refusal.aggregated) return `the aggregated column '${field}', which carries a ${column.type} value`;
  if (column.provisioned) return `the platform-provisioned ${column.type} column '${field}'`;
  return `the declared ${column.type} field '${field}'`;
}

/**
 * The scalar kind's words (#20546), less the context and the object.
 *
 * [#20745] Every kind's words put the verdict and the route FIRST and the
 * reasoning after: the REST door bounds a 4xx message at 500 characters by
 * truncation (`CLIENT_MESSAGE_MAX`, `@objectstack/rest`'s
 * `error-response.ts`), so what a caller must do next has to land inside it.
 */
function scalarWords(refusal: NoOperatorObjectRefusal): string {
  const { field, column } = refusal;
  return (
    `where a value of ${describeColumn(refusal)} belongs. An object with no "$" operator is filter `
    + 'structure, not a value. The filter was NOT applied. Compare '
    + `'${field}' with a value ({ "${field}": VALUE }) or an operator ({ "${field}": { "$eq": VALUE } }). `
    + `A ${column.type} column holds scalar values — one, or a list of them — so no record can match an `
    + 'object there, and an empty answer would read exactly like a real one.'
  );
}

/**
 * [#20745] The relation kind's words. [#20802] The nested-relation form is
 * SERVED at `where` (`relation-filter-lowering.ts`), so this arm raises these
 * words only where it is not: an aggregation's own `filter` and `having`,
 * which the engine evaluates itself over rows it already holds. The words send
 * the condition to `where`, and name the ids route that works at THIS
 * position: `$in` on a single-valued column. A multi-valued column has no
 * member test here — the engine's evaluator compares the stored list as one
 * value, so neither `$in` nor `$contains` matches a member of it — so `where`
 * is its only route. An aggregated column (`having`) names no declaration to
 * read either from, so it is given the single-valued spelling.
 */
function relationWords(refusal: NoOperatorObjectRefusal): string {
  const { field, column } = refusal;
  const def = column.def as { type: string; multiple?: boolean } | undefined;
  const target = def === undefined ? undefined : referenceTargetOf(def);
  const related = target === undefined ? 'the related object' : `the related object '${target}'`;
  const multiple = def !== undefined && isMultiValueField(def);
  const position = refusal.aggregated ? "'having'" : "an aggregation's 'filter'";
  const route = multiple
    ? `Put the condition in 'where' instead: here the stored list of ids is compared as one value, so no `
      + 'operator matches one member of it.'
    : `Put the condition in 'where' instead, or filter ${related} first and match '${field}' against `
      + `the ids it returns: { "${field}": { "$in": [ID, …] } }.`;
  return (
    `beneath ${describeColumn(refusal)} — the nested-relation form, which the engine serves in 'where' `
    + `and not in ${position}. The filter was NOT applied. ${route} An object with no "$" operator is `
    + `filter structure, not a value, here: '${field}' holds the related record's id, and an empty answer `
    + 'would read exactly like a real one.'
  );
}

/**
 * [#20745] The structured-JSON kind's words. The route is what every driver
 * answers alike: presence of the whole value, or a stored field of its own for
 * the part the filter is about (the dotted path into a JSON value is live on
 * some backends and silently empty on others, so it is not offered).
 */
function jsonWords(refusal: NoOperatorObjectRefusal): string {
  const { field } = refusal;
  return (
    `as the value of ${describeColumn(refusal)} — a whole-value match, which the engine does not `
    + `serve. The filter was NOT applied. Test the whole value's presence with { "${field}": { "$null": `
    + 'false } }, or store the part you filter on in a field of its own and filter that field. An object '
    + 'with no "$" operator is filter structure, not a value, and the drivers share no meaning for a '
    + 'whole-value match: one compares the documents, another refuses the bind.'
  );
}

/**
 * The refusal's words. Every position reads the same, less the subject: a
 * declared (or platform-provisioned) field at `where` and
 * `aggregations[i].filter`, an aggregated column at `having`. Each kind of
 * column has its own middle and its own route (#20745). No tracker id: the
 * lesson is in the sentence.
 */
export function noOperatorObjectRefusalMessage(refusal: NoOperatorObjectRefusal, context: string): string {
  const head = `${context}: filter on '${refusal.field}' puts ${describeObject(refusal.keys)} at ${refusal.path}, `;
  switch (refusal.column.kind) {
    case 'relation':
      return head + relationWords(refusal);
    case 'json':
      return head + jsonWords(refusal);
    default:
      return head + scalarWords(refusal);
  }
}
