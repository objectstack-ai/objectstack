// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20807] A GROUPED dimension on a STRUCTURED-JSON field — `json`,
 * `composite`, `repeater`, `record`, `location`, `address`, `vector` — is
 * refused `INVALID_FIELD` / 400 at the analytics door, naming the member the
 * caller wrote, before either strategy builds anything. [#20912] So is a
 * grouped dimension on a MULTI-VALUE field, and a `count_distinct` measure
 * over a JSON-stored field: every JSON-stored column the engine's aggregate
 * door refuses is refused here, ahead of the strategy that bypasses it.
 *
 * ## What ran before this door, measured on `origin/main` `793fb839`
 *
 * `POST /api/v1/analytics/query` over the service `AnalyticsServicePlugin`
 * composes on a real engine, three rows with a different `meta` document each:
 *
 * | `dimensions` | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | a `text` member (the control) | 200, one group per value | same |
 * | a cube or dataset member over a `json` field | 200, one group per serialized document | **500 `DATABASE_ERROR`** ("could not identify an equality operator for type json") |
 *
 * `NativeSQLStrategy` compiled `GROUP BY meta` itself and ran it once through
 * the raw-SQL bridge; `engine.aggregate` was asked 0 times, so the engine's own
 * `groupBy` door (#20783, `packages/objectql`'s
 * `group-by-structured-json-door.ts`) never saw the query. `ObjectQLStrategy`
 * (a driver without raw SQL, or any bucketed time dimension) did reach that
 * door, and was refused there under the engine's position (`groupBy[0]`), a
 * name the caller never wrote.
 *
 * ## Where it stands
 *
 * In `AnalyticsService.ensureCube`, right after the dimension source-field
 * gate, on every path out of it — so it runs ahead of strategy selection, for
 * `query()` (the `/analytics/query` door, and every query a dataset selection
 * runs through `DatasetExecutor`) and for `generateSql()` (the `/analytics/sql`
 * dry run) alike. This is the first compile step that knows both halves of the
 * verdict: the member the caller wrote (a `dimensions` entry, or a dataset
 * dimension's name, which is the cube key it compiled to) and the declared type
 * of the column it resolves to (`sourceFieldMeta`). One door ahead of both
 * strategies gives one answer on every driver.
 *
 * ## What it judges
 *
 * - The members that GROUP: every `dimensions` entry, and every
 *   `timeDimensions` entry that carries a `granularity` (a bucket is a group
 *   key; no granularity makes a JSON document a date). A `timeDimensions`
 *   entry with no granularity only bounds a range and groups nothing.
 * - The class is `@objectstack/spec/data`'s {@link STRUCTURED_JSON_TYPES},
 *   the predicate the engine's door reads — never a list minted here.
 *
 * - The column is read the way `NativeSQLStrategy` compiles it: the member's
 *   dimension `sql` (the member itself when the cube declares none). A bare
 *   identifier is a column of the cube's object. A dotted identifier path
 *   (`account.hq`, a dataset dimension over an `include`d relationship) is the
 *   last segment, on the object the path's last hop reaches — [#21232] asked
 *   of the one hop resolver (`hop-object.ts`'s `columnObjectOf`): the cube's
 *   declared join at that path, else the relationship field's declared
 *   `reference`, else the alias. That is the object both strategies join and
 *   read for the path, so the door judges the column the statement groups by.
 *   Measured on the base the same way as the table above: a dataset dimension
 *   over `account.hq` (a `json` field of the joined object) answered one group
 *   per document on SQLite and 500 on PostgreSQL, like a base-object one.
 *
 * **Not judged** (the same "cannot answer, do not block" tiering as every
 * sibling gate in `ensureCube`): a host that wires no `sourceFieldMeta`, a cube
 * whose `sql` is not a bare object name, an expression `sql`, a column whose
 * object the host does not describe (a hop the host cannot resolve reads its
 * alias, and an alias that names no described object answers nothing), and
 * every other field type. The same tiers hold for the two #20912 judgements
 * below.
 *
 * ## [#21232] A relationship path the cube declares no join for
 *
 * Until #21232 the door located a dotted path's object through `cube.joins`
 * alone and stood down on a path the cube declares no join for — while the
 * strategies, through the one hop resolver, joined the lookup's declared
 * target and grouped by its column. Measured on `origin/main` `3a7b6eb0`
 * through `POST /api/v1/analytics/query` on the real dispatcher route, a
 * configured cube over `deal` whose lookup `owner` (`reference` a person
 * object holding `prefs` `json` and `labels` `tags`) has no declared join,
 * beside `account` (declared join, `hq` `json`):
 *
 * | member | face | SQLite | PostgreSQL 16.14 |
 * |:--|:--|:--|:--|
 * | dimension over `owner.prefs` / `owner.labels` | native | 200, one group per serialized value | **500 `DATABASE_ERROR`** |
 * | the same | ObjectQL | 400, the engine's `groupBy[1]` (a position the caller never wrote) | same |
 * | `count_distinct` over `owner.prefs` / `owner.labels` | native | 200, 2 / 2 | **500** |
 * | the same | ObjectQL | 400, its cross-object refusal (no `field` / `object`) | same |
 * | control — the same two members over `account.hq` | both | 400 `INVALID_FIELD`, this door | same |
 *
 * Every row now answers this door's `INVALID_FIELD` / 400 on both faces and
 * both dialects, naming the member, `field` the path and `object` the
 * reference's target.
 *
 * ## [#20912] The engine's second class, and its second door
 *
 * #20808 taught the engine's aggregate door two more refusals, and the native
 * strategy bypassed both the same way. Measured on `origin/main` `8d329f02`
 * through this service as `AnalyticsServicePlugin` composes it on a real
 * engine, four rows (`tags` [a,b], [a,b], [b], [ab]; a `multiselect` and a
 * `select` with `multiple: true` [a,b], [a,b], [b], [b]; a `json` document
 * per row, two of them equal):
 *
 * | query | SQLite | PostgreSQL 16.13 | `ObjectQLStrategy` |
 * |:--|:--|:--|:--|
 * | a cube or dataset dimension on a multi-value field | 200, one group per serialized array | **500 `DATABASE_ERROR`** | 400, the engine's `groupBy[0]` |
 * | an inferred `FIELD_count_distinct` over `json` / `tags` / the `multiple: true` select | 200, 2 / 3 / 2 | **500** | 400, the engine's `aggregations[0].field` |
 *
 * So the door judges both, ahead of both strategies, in the engine's words
 * with the member the caller wrote:
 *
 * - A GROUPED member whose column is a MULTI-VALUE field —
 *   {@link isMultiValueField}, which reads the declaration: an inherently
 *   multi option type (`multiselect`, `checkboxes`, `tags`) or a
 *   multi-capable type flagged `multiple: true` (`select`, `radio`,
 *   `lookup`, `user`, `file`, `image`). The same type without the flag
 *   stores one scalar value and is served.
 * - A `measures` entry that resolves to a `count_distinct` measure whose
 *   column is JSON-STORED: the compatibility table's `count_distinct` row
 *   refuses the type (`@objectstack/spec/data`'s
 *   `isAggregateCompatibleWithFieldType`), or `isMultiValueField` says the
 *   declaration is a list. The member resolves the way the strategies resolve
 *   a measure (cube-qualified, flattened), and its column the way a dimension's
 *   does (`columnOf`, through the one hop resolver). An authored measure, a
 *   suffix-inferred one (`tags_count_distinct`) and a compiled dataset's are
 *   one population here; a `count` measure compares nothing and is not judged.
 *
 * ⛔ Every predicate is the spec's — the ones the engine's two doors read —
 * and the declaration arrives as `{ type, multiple }`
 * (`ValueShapeFieldDef`), never the type alone: a type-only reading would
 * refuse `tags` and serve a `select` with `multiple: true`, which is the same
 * JSON column.
 *
 * The multi-value route is a RECORD query's membership filter, named on the
 * object that declares the column: `$contains` over a JSON-stored list is
 * lowered as membership by the engine on every driver. ⚠️ It is not this
 * service's own `where`: measured on the same base, `NativeSQLStrategy`
 * compiles that operator to `LIKE` — a substring match on SQLite (`[ab]`
 * counts as holding `a`) and a 500 on PostgreSQL (`json ~~ text`) — so a route
 * through it would trade one wrong answer for another.
 *
 * ## The envelope
 *
 * `INVALID_FIELD` / 400 through {@link invalidMemberError} (ADR-0112): the
 * verdict is about ONE MEMBER the request named, the family the three
 * source-field gates and the engine's door already answer with
 * `INVALID_FIELD`. `member` is the entry as the request spelled it; `field` is
 * the column it groups by, spelled as the dimension's `sql` spells it
 * (`account.hq` for a joined one) — it exists, and its declared type is the
 * verdict — and `object` is the object that declares it.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20807
 * @see https://github.com/objectstack-ai/objectstack/issues/20912
 * @see https://github.com/objectstack-ai/objectstack/issues/21232
 */

import type { Cube, ValueShapeFieldDef } from '@objectstack/spec/data';
import {
  FieldType,
  STRUCTURED_JSON_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
} from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { AnalyticsRequestKey } from './dataset-refusal.js';
import { invalidMemberError } from './dataset-refusal.js';
import { columnObjectOf, type HopReference } from './hop-object.js';

/** The declared `FieldType` vocabulary — the only types the compatibility table can answer for. */
const DECLARED_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/** Which JSON-stored class a column belongs to, as the engine's two doors name them. */
type JsonStoredClass = 'structured-json' | 'multi-value';

/** One grouped member, tagged with the request key that carried it. */
interface GroupedMember {
  readonly member: string;
  readonly param: 'dimensions' | 'timeDimensions';
}

/** The column a grouped member reads: where it is declared, and how the dimension spells it. */
interface DimensionColumn {
  /** The object that declares the column. */
  readonly object: string;
  /** The column's name on that object. */
  readonly column: string;
  /** The dimension's `sql` as written: the column, or the dotted path to it. */
  readonly path: string;
}

/** A bare identifier: one column. */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A dotted identifier path: relationship hops, then one column (`NativeSQLStrategy`'s own test). */
const IDENTIFIER_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

/**
 * The members of `query` that group the result, in request-key order:
 * `dimensions` first, then each bucketed `timeDimensions` entry.
 */
function groupedMembers(query: AnalyticsQuery): GroupedMember[] {
  return [
    ...(query.dimensions ?? []).map((member) => ({ member, param: 'dimensions' as const })),
    ...(query.timeDimensions ?? [])
      .filter((td) => !!td.granularity)
      .map((td) => ({ member: td.dimension, param: 'timeDimensions' as const })),
  ];
}

/**
 * The column a dimension `sql` reads, or `null` when this door cannot pin one
 * (an expression). [#21232] A dotted path's column is its last segment, on the
 * object the path's last hop reaches: {@link columnObjectOf}, the one hop
 * resolver (`hop-object.ts`) — the cube's declared join, else the
 * relationship field's declared `reference` through `referenceOf`, else the
 * alias — which is the object both strategies join and read for that path.
 * ⛔ No second walk.
 */
function columnOf(
  cube: Cube,
  baseObject: string,
  sql: string,
  referenceOf: HopReference | undefined,
): DimensionColumn | null {
  const path = sql.trim();
  if (BARE_IDENTIFIER.test(path)) return { object: baseObject, column: path, path };
  if (!IDENTIFIER_PATH.test(path)) return null;
  return {
    object: columnObjectOf(cube, baseObject, path, referenceOf),
    column: path.slice(path.lastIndexOf('.') + 1),
    path,
  };
}

/**
 * The class of a column a member GROUPS by, or `null` when it stores one
 * scalar value — the engine's `groupBy` door's two predicates, in its order:
 * {@link STRUCTURED_JSON_TYPES}, then {@link isMultiValueField} (the
 * declaration, `multiple` included).
 */
function groupedClassOf(shape: ValueShapeFieldDef): JsonStoredClass | null {
  if (STRUCTURED_JSON_TYPES.has(shape.type)) return 'structured-json';
  return isMultiValueField(shape) ? 'multi-value' : null;
}

/**
 * [#20912] The class of a column a measure COUNTS DISTINCT, or `null` when
 * every backend compares its values alike — the engine's `count_distinct`
 * door's two predicates: the compatibility table's `count_distinct` row
 * ({@link isAggregateCompatibleWithFieldType}, the TYPE half) beside
 * {@link isMultiValueField} (the DECLARATION half, which the per-type row
 * cannot see). A type outside `FieldType` (a driver-internal alias) is not
 * judged: the table is fail-closed on vocabulary, and "cannot answer, do not
 * block" is this consumer's tier.
 */
function distinctClassOf(shape: ValueShapeFieldDef): JsonStoredClass | null {
  if (!DECLARED_FIELD_TYPES.has(shape.type)) return null;
  const multiValue = isMultiValueField(shape);
  if (isAggregateCompatibleWithFieldType('count_distinct', shape.type) && !multiValue) return null;
  return multiValue ? 'multi-value' : 'structured-json';
}

/** The declaration as the words say it: the type, and the flag when the field carries it. */
function declaredAs(shape: ValueShapeFieldDef): string {
  return shape.multiple === true ? `${shape.type} with multiple: true` : shape.type;
}

/** Who declares the column, as the words say it: the cube's own object, or the joined one. */
function declarerOf(target: DimensionColumn): string {
  return target.path === target.column
    ? `which object '${target.object}' declares`
    : `whose column '${target.column}' the joined object '${target.object}' declares`;
}

/**
 * [#20912] The cube measure a `measures` entry resolves to —
 * `NativeSQLStrategy.lookupMember(…, 'measure')`'s resolution, which
 * `ObjectQLStrategy`'s mirrors: the key itself, then for a dotted entry the
 * key after its first segment (the `<cube>.` qualifier, or the legacy second
 * segment), then the underscore-flattened key. A measure has no synthetic
 * relation tier, so nothing else resolves. Own keys only.
 */
function measureEntryOf(cube: Cube, member: string): { type?: unknown; sql?: unknown } | undefined {
  const bag = (cube.measures ?? {}) as Record<string, { type?: unknown; sql?: unknown } | undefined>;
  const own = (key: string) => (Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined);
  if (own(member)) return own(member);
  if (!member.includes('.')) return undefined;
  return own(member.split('.').slice(1).join('.')) ?? own(member.replace(/\./g, '_'));
}

/** The ADR-0112 envelope every refusal of this door carries, naming the member and the column. */
function refusal(
  message: string,
  member: string,
  param: AnalyticsRequestKey,
  cube: Cube,
  target: DimensionColumn,
): Error {
  const err = invalidMemberError(message, { member, param, cube: cube.name }) as Error & {
    field?: string;
    object?: string;
  };
  err.field = target.path;
  err.object = target.object;
  return err;
}

/**
 * Refuse the first grouped member of `query` whose column is a declared
 * structured-JSON (#20807) or multi-value (#20912) field, then the first
 * `count_distinct` measure whose column is a declared JSON-stored field
 * (#20912) — `INVALID_FIELD` / 400. See the module header.
 *
 * @param baseObject - The object `cube.sql` names (the caller has checked it
 *   is a bare object name).
 * @param sqlOf - The dimension `sql` a member resolves to, or the member itself
 *   when the cube declares none — the strategies' own lookup.
 * @param declaredValueShape - The DECLARATION of a column on an object — its
 *   `FieldType` and its `multiple` flag — or `undefined` when nothing
 *   authoritative answers. The flag is half the verdict: a `select` with
 *   `multiple: true` is a list stored as JSON, whatever its type name says.
 * @param referenceOf - [#21232] The host's answer for a relationship field's
 *   declared target — tier 2 of the one hop resolver (`hop-object.ts`), the
 *   same function the field gate and both strategies resolve a hop with — or
 *   `undefined` for a host that cannot answer (a hop then reads its alias).
 *
 * The words put the verdict first, then that the query did not run, then the
 * route, then the reason: a door that bounds a 4xx message keeps the front of
 * it.
 */
export function assertNoStructuredJsonDimension(
  query: AnalyticsQuery,
  cube: Cube,
  baseObject: string,
  sqlOf: (member: string) => string,
  declaredValueShape: (object: string, field: string) => ValueShapeFieldDef | undefined,
  referenceOf: HopReference | undefined,
): void {
  for (const { member, param } of groupedMembers(query)) {
    const target = columnOf(cube, baseObject, sqlOf(member), referenceOf);
    if (!target) continue;
    const shape = declaredValueShape(target.object, target.column);
    if (typeof shape?.type !== 'string') continue;
    const cls = groupedClassOf(shape);
    if (cls === null) continue;

    const kind = param === 'timeDimensions' ? 'Time dimension' : 'Dimension';
    const verb = param === 'timeDimensions' ? 'buckets' : 'groups by';
    const head = `${kind} '${member}' on cube '${cube.name}' ${verb} field '${target.path}', ${declarerOf(target)} `
      + `as ${declaredAs(shape)} — `;
    throw refusal(
      cls === 'structured-json'
        ? head
          + 'a structured-JSON value, which analytics does not group by. '
          + 'The query was NOT run. Group by a field that stores one scalar value: store the part you '
          + 'group on in a field of its own and group by that field. A JSON document is no group key '
          + 'the SQL dialects share: one grouped each serialized document apart, another refused the '
          + 'statement.'
        : head
          + 'a multi-value field, which analytics does not group by. The query was NOT run. '
          + `Filter by one member instead: a record query on '${target.object}' with `
          + `where { "${target.column}": { "$contains": VALUE } } counts or lists the records that hold `
          + 'VALUE, one query per member. A list of values is no group key the SQL dialects share: one '
          + 'grouped each serialized list apart, another refused the statement.',
      member,
      param,
      cube,
      target,
    );
  }

  for (const member of query.measures ?? []) {
    const entry = measureEntryOf(cube, member);
    if (entry?.type !== 'count_distinct' || typeof entry.sql !== 'string') continue;
    const target = columnOf(cube, baseObject, entry.sql, referenceOf);
    if (!target) continue;
    const shape = declaredValueShape(target.object, target.column);
    if (typeof shape?.type !== 'string') continue;
    const cls = distinctClassOf(shape);
    if (cls === null) continue;

    const route = cls === 'multi-value'
      ? 'Count the records that hold one member instead: count with '
        + `where { "${target.column}": { "$contains": VALUE } } in a record query on '${target.object}', `
        + 'one query per member.'
      : 'Count distinct values of a field that stores one scalar value: store the part you count in a '
        + 'field of its own and count_distinct that field, or count the rows with count.';
    throw refusal(
      `Measure '${member}' on cube '${cube.name}' counts distinct field '${target.path}', ${declarerOf(target)} `
      + `as ${declaredAs(shape)} — ${cls === 'multi-value' ? 'a multi-value field' : 'a structured-JSON value'}, `
      + `which analytics does not count distinct. The query was NOT run. ${route} `
      + 'A JSON-stored value is no distinct key the SQL dialects share: one compared the serialized '
      + 'text, another refused the statement.',
      member,
      'measures',
      cube,
      target,
    );
  }
}
