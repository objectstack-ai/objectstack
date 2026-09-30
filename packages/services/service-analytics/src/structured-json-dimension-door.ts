// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20807] A GROUPED dimension on a STRUCTURED-JSON field — `json`,
 * `composite`, `repeater`, `record`, `location`, `address`, `vector` — is
 * refused `INVALID_FIELD` / 400 at the analytics door, naming the member the
 * caller wrote, before either strategy builds anything.
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
 *   last segment, on the object the cube's own `joins` entry for that path
 *   names — the alias the dataset compiler registers and the strategy joins.
 *   Measured on the base the same way as the table above: a dataset dimension
 *   over `account.hq` (a `json` field of the joined object) answered one group
 *   per document on SQLite and 500 on PostgreSQL, like a base-object one.
 *
 * **Not judged** (the same "cannot answer, do not block" tiering as every
 * sibling gate in `ensureCube`): a host that wires no `sourceFieldMeta`, a cube
 * whose `sql` is not a bare object name, an expression `sql`, a dotted path
 * the cube declares no join for (a synthetic traversal: which object it lands
 * on is the strategy's guess, not a declaration), and every other field type.
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
 */

import type { Cube } from '@objectstack/spec/data';
import { STRUCTURED_JSON_TYPES } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { invalidMemberError } from './dataset-refusal.js';

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
 * The column a dimension `sql` reads, or `null` when this door cannot pin one.
 * A dotted path's object is the cube's DECLARED join at that path — the alias
 * is the path with its dots as `__`, as the dataset compiler registers it and
 * the strategy joins it — and a path with no declared join is not judged.
 */
function columnOf(cube: Cube, baseObject: string, sql: string): DimensionColumn | null {
  const path = sql.trim();
  if (BARE_IDENTIFIER.test(path)) return { object: baseObject, column: path, path };
  if (!IDENTIFIER_PATH.test(path)) return null;
  const segments = path.split('.');
  const column = segments.pop() as string;
  const joined = (cube.joins as Record<string, { name?: unknown } | undefined> | undefined)?.[segments.join('__')]?.name;
  return typeof joined === 'string' && joined !== '' ? { object: joined, column, path } : null;
}

/**
 * Refuse the first grouped member of `query` whose column is a declared
 * structured-JSON field — `INVALID_FIELD` / 400. See the module header.
 *
 * @param baseObject - The object `cube.sql` names (the caller has checked it
 *   is a bare object name).
 * @param sqlOf - The dimension `sql` a member resolves to, or the member itself
 *   when the cube declares none — the strategies' own lookup.
 * @param declaredFieldType - The declared `FieldType` of a column on an
 *   object, or `undefined` when nothing authoritative answers.
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
  declaredFieldType: (object: string, field: string) => string | undefined,
): void {
  for (const { member, param } of groupedMembers(query)) {
    const target = columnOf(cube, baseObject, sqlOf(member));
    if (!target) continue;
    const type = declaredFieldType(target.object, target.column);
    if (typeof type !== 'string' || !STRUCTURED_JSON_TYPES.has(type)) continue;

    const kind = param === 'timeDimensions' ? 'Time dimension' : 'Dimension';
    const verb = param === 'timeDimensions' ? 'buckets' : 'groups by';
    const declarer = target.path === target.column
      ? `which object '${target.object}' declares`
      : `whose column '${target.column}' the joined object '${target.object}' declares`;
    const err = invalidMemberError(
      `${kind} '${member}' on cube '${cube.name}' ${verb} field '${target.path}', ${declarer} `
      + `as ${type} — a structured-JSON value, which analytics does not group by. `
      + 'The query was NOT run. Group by a field that stores one scalar value: store the part you '
      + 'group on in a field of its own and group by that field. A JSON document is no group key '
      + 'the SQL dialects share: one grouped each serialized document apart, another refused the '
      + 'statement.',
      { member, param, cube: cube.name },
    ) as Error & { field?: string; object?: string };
    err.field = target.path;
    err.object = target.object;
    throw err;
  }
}
