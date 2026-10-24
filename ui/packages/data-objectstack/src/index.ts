/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ObjectStackClient, type QueryOptions as ObjectStackQueryOptions } from '@objectstack/client';
import type { DroppedFieldsEvent, EngineAggregateOptions } from '@objectstack/spec/data';
import type { ListViewGroupHeaderRow } from '@objectstack/spec/ui';
// objectui#11013 — a VALUE import: the keys `listViews` carries off a stored
// ViewItem record are the spec's own record of the console's round-trip keys,
// read off the pin rather than hand-listed (see `VIEW_ITEM_ROUND_TRIP_KEYS`).
import { VIEW_CONSOLE_ROUND_TRIP_KEYS } from '@objectstack/spec/ui';
// #4934 — a VALUE import, not a type one: the write-warning boundary parses the
// wire's `reason` against the enum the spec itself declares, so the accept set
// is read off the pin instead of hand-copied here (a hand copy is the drift
// this seam already paid for once — see `DroppedFieldsEvent`'s comment below).
import { DroppedFieldsEventSchema } from '@objectstack/spec/data';
// #6825 / #7752 — the spec's OWN filter-AST gate and its OWN lowering sink,
// imported as VALUES for the same reason: `aggregate()` decides whether a
// `where` is a filter, and turns a `FilterArray` into the `FilterCondition` the
// wire declares, by asking the contract — not by a hand-rolled shape sniff or a
// second lowering that could disagree with the door it is feeding. Same
// predicate and same sink the server ingress runs, so the producer-side refusal
// and the wire-side one cannot drift.
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
// objectui#9048 — the case-insensitive-contains comparand door, read from the
// contract's owner rather than restated: the predicate that decides which
// comparands `FILTER_TEXT_CASES` declares REFUSED, and the reason text its
// `mustMention` makes load-bearing. `@object-ui/core`'s `convertFiltersToAST`
// and `ValueDataSource` read these same two functions, so the rule-entry form
// below cannot judge a different set than the `$` dialect beside it.
import { isRefusedTextComparand, textComparandRefusalReason } from '@objectstack/spec/data';
import type { ApiError, ValidateDataIssue } from '@objectstack/spec/api';
import { ValidateDataIssueSchema } from '@objectstack/spec/api';
import { stripReadDecorations } from '@objectstack/spec/kernel';
// #4237 — the metadata save door's advisory reader, shared with `MetadataClient`
// rather than forked. ONE reader, two call sites: the other client class calls it
// from `MetadataClient.save` (#4133/#4236), this one from the interceptor below.
import {
  readSaveAdvisories,
  type MetadataSaveAdvisoryEvent,
  type MetadataSaveAdvisoryListener,
} from './metadata-client';
import type { AnalyticsResult, DatasetSelection } from '@objectstack/spec/contracts';
import type {
  DataSource,
  ConnectionState,
  // #4564 — the canonical `deleteView` receipt shapes, declared beside the
  // `DataSource` interface they belong to. Imported for the local uses below
  // and re-exported under the same names further down, so this package's
  // existing importers are untouched by the move.
  DeleteViewResult,
  ViewHomeDeleteOutcome,
  BatchTransactionOperation,
  DataSourceMutationEvent,
  QueryParams,
  QueryResult,
  GlobalSearchResult,
  GlobalSearchHit,
  FileUploadResult,
  ExportDownloadRequest,
  ImportRequestOptions,
  ImportRecordsResult,
  CreateImportJobResult,
  ImportJobProgressInfo,
  ImportJobResultsInfo,
  ImportJobSummaryInfo,
  ImportJobUndoResult,
  ListImportJobsOptions,
} from '@object-ui/types';
import { errorCodeIs, errorCodeIsAnyOf } from '@object-ui/types';
import {
  attachObjectSortability,
  convertFiltersToAST,
  emulateBatchTransaction,
  normalizeSchemaReferenceKeys,
  type DatasetDrillRange,
} from '@object-ui/core';
import { MetadataCache } from './cache/MetadataCache';
import { MetadataClient } from './metadata-client';
import { formatMetadataError } from './metadata-error';
import {
  ObjectStackError,
  MetadataNotFoundError,
  BulkOperationError,
  ConnectionError,
  DataApiValidationError,
  createErrorFromResponse,
} from './errors';
// #9594 - the ONE error-envelope reader for this module's HTTP failure paths.
// Four hand-copied ladders each read two of the three live envelope dialects
// and missed the flat `{ code, error: <string> }` one, so a 403 naming the
// missing grant reached the operator as the word `Forbidden`. Deliberately NOT
// re-exported from this entry point: it is internal, and exporting it would
// widen this package's published face.
import { readErrorEnvelope } from './error-envelope';

/**
 * Map human-readable filter operator names produced by SDUI view configs
 * (e.g. `lead.view.ts`) to the canonical operator symbols expected by the
 * ObjectStack server's filter AST. Unknown operators fall through unchanged
 * so existing AST-style entries keep working.
 *
 * Every VALUE here must be a member of the spec's `VALID_AST_OPERATORS`
 * (`@objectstack/spec/data`) — that set gates `isFilterAST()`, and a filter it
 * rejects is not converted, not validated, and then silently DROPPED by
 * driver-sql (objectstack#3948). Pinned by `filter-operator-ast-parity.test.ts`.
 *
 * Exported for that test. @internal
 */
export const FILTER_OPERATOR_ALIASES: Record<string, string> = {
  equals: '=',
  eq: '=',
  '==': '=',
  not_equals: '!=',
  notequals: '!=',
  ne: '!=',
  greater_than: '>',
  greaterthan: '>',
  gt: '>',
  greater_than_or_equal: '>=',
  greater_than_or_equals: '>=',
  greaterthanorequal: '>=',
  gte: '>=',
  less_than: '<',
  lessthan: '<',
  lt: '<',
  less_than_or_equal: '<=',
  less_than_or_equals: '<=',
  lessthanorequal: '<=',
  lte: '<=',
  in: 'in',
  not_in: 'nin',
  notin: 'nin',
  nin: 'nin',
  contains: 'contains',
  // Case-insensitive contains. A canonical `VIEW_FILTER_OPERATORS` member that
  // arrived with `@objectstack/spec` 17.1.0 (objectui#5328), and an IDENTITY row
  // like `contains` above: `icontains` is itself a member of
  // `VALID_AST_OPERATORS`, so the spelling the author writes is the spelling the
  // AST takes — nothing is translated and no case-sensitivity is lost.
  // Declared rather than left to the `?? op` fall-through on the rule this
  // table's test states: the AST gate accepting a spelling is not the driver
  // compiling it into a WHERE clause.
  icontains: 'icontains',
  not_contains: 'notcontains',
  notcontains: 'notcontains',
  starts_with: 'startswith',
  startswith: 'startswith',
  ends_with: 'endswith',
  endswith: 'endswith',
  between: 'between',
  is_null: 'isnull',
  isnull: 'isnull',
  is_not_null: 'isnotnull',
  isnotnull: 'isnotnull',
  // Date comparisons. `before`/`after` are CANONICAL members of the spec's
  // `VIEW_FILTER_OPERATORS` (ui/view.zod.ts), so a stored view legitimately
  // carries them — but they are absent from `VALID_AST_OPERATORS`
  // (data/filter.zod.ts), which gates `isFilterAST()`. Without these two
  // entries they reached the wire unchanged, the server's AST gate rejected
  // the shape, and driver-sql skipped the filter ENTIRELY — an unfiltered
  // result set with no error anywhere. objectstack#3948.
  before: '<',
  after: '>',
};

/**
 * Resolve an authored filter operator to the AST symbol the wire takes.
 *
 * Deliberately NOT named `normalizeFilterOperator`. That name belongs to a
 * DIFFERENT function, which `@objectstack/spec/ui` exports and which this
 * monorepo's view layer imports from there (`viewFilterFold`,
 * `filter-converter`, `ListView`, `UserFilters`, the FilterBuilder). The two
 * take the same input and agree on nothing else: the spec's folds a legacy
 * spelling to the canonical VIEW vocabulary (`VIEW_FILTER_OPERATORS`) so that
 * `ViewFilterRuleSchema`'s enum can judge it, leaving a canonical operator
 * unchanged — `eq` becomes `equals` and `before` stays `before`. This one
 * translates the same input into the server's filter-AST symbols through
 * {@link FILTER_OPERATOR_ALIASES} — `eq` AND `equals` both become `=`, and
 * `before` becomes `<`. Which spellings the two disagree on is enumerated by
 * the pin named below rather than written down here; it is most of them.
 *
 * Renamed at objectui#7265, off the ledger in
 * `scripts/check-spec-symbol-derivation.mjs`, so that a reader who has seen
 * `normalizeFilterOperator` anywhere else in this tree cannot read the call
 * below as the same fold. Nothing about the behaviour moved with the name.
 *
 * The `?? op` tail is shared with the spec's, and load-bearing for the same
 * reason: an entry already written in AST form (`'='`, `'nin'`) has no row here
 * and must pass through. The `null` arm is NOT shared — the spec's hands a
 * non-string back verbatim (its body ends `return op as string`), this one
 * refuses, and `objectFilterEntryToAST` turns the refusal into a
 * `MalformedFilterError` instead of putting a number in the operator slot of a
 * tuple it is about to send. Both halves are pinned, in both directions, in
 * `scripts/__tests__/spec-symbol-ledger-data-objectstack-7265.test.ts`.
 */
function toAstFilterOperator(op: unknown): string | null {
  if (typeof op !== 'string') return null;
  const lower = op.toLowerCase();
  return FILTER_OPERATOR_ALIASES[lower] ?? FILTER_OPERATOR_ALIASES[op] ?? op;
}

/**
 * A filter entry as it appears inside a refusal message, without letting the
 * explanation throw.
 *
 * `JSON.stringify` throws on a BigInt and on a cyclic object. A `TypeError`
 * raised while a refusal builds its message escapes in the refusal's place, and
 * a caller then reads a transport-looking failure about a filter this adapter
 * had already judged (objectui#9048: the text-comparand refusal constructs a
 * {@link MalformedFilterError} for exactly such an entry). The replacer renders
 * a BigInt as its literal and leaves every other value alone, so an entry that
 * serialised before serialises to the same bytes now. Module-private.
 */
function describeFilterEntry(entry: unknown): string {
  try {
    return JSON.stringify(entry, (_key, value) => (typeof value === 'bigint' ? `${value}n` : value))
      ?? String(entry);
  } catch {
    return String(entry);
  }
}

/**
 * A filter entry this adapter cannot translate into an AST tuple.
 *
 * Thrown rather than skipped. Dropping one entry out of an `and` WIDENS the
 * result set, and dropping the last one emits no `filter=` at all — every row,
 * no error, from a query that asked for a subset. That is the same silent
 * over-fetch the server-side drivers stopped doing in objectstack#3948, and
 * skipping it here just moves it one layer up.
 *
 * Carries the code and status the data API uses for its own version of this
 * refusal (objectstack#4121) so a failed list renders "this view's filter is
 * malformed" rather than "check your connection" (#3066).
 */
export class MalformedFilterError extends Error {
  readonly code = 'INVALID_FILTER';
  readonly httpStatus = 400;
  readonly entry: unknown;
  readonly index: number;
  constructor(entry: unknown, index: number) {
    // BigInt-safe (see `describeFilterEntry`); byte-identical to a bare
    // `JSON.stringify(entry) ?? String(entry)` for every entry that did not throw.
    const shown = describeFilterEntry(entry);
    super(
      `Filter entry ${index} is not a usable filter rule (${shown}). `
      + 'Expected { field, operator, value } with a non-empty field.',
    );
    this.name = 'MalformedFilterError';
    this.entry = entry;
    this.index = index;
  }
}

/** Detect the malformed-filter refusal, whether raised here or by the server. */
export function isMalformedFilterError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return e.code === 'INVALID_FILTER' || e.name === 'MalformedFilterError';
}

/**
 * A `where` that reached `aggregate()`'s SPEC-SHAPE branch as an array the spec
 * cannot read as a filter — an unlowered `ViewFilterRule[]` above all.
 *
 * WHY THIS IS A REFUSAL AND NOT A LOWERING (objectui#6825, maintainer ruling
 * 2026-08-30, option A). The two branches of `aggregate()` take a filter by
 * different names: the analytics branch takes `filter` and lowers it through
 * `translateFilterArray` (objectui#6302), the spec-shape branch takes `where`
 * and posts it to `POST /data/:object/query` verbatim. Lowering here too was
 * option B and was REFUSED: it is the tolerant-consumer direction AGENTS.md
 * #0.1 exists to stop, and it would bless as supported a params shape
 * `AggregateParams` does not even declare. Retiring the branch was option D and
 * was refused as the riskier move — this repo has no producer that can reach it
 * (`ObjectChart`'s gate requires a non-array `aggregate.groupBy`, and all three
 * in-tree constructors pass a string), but `ObjectChart`'s props are `any` and
 * an out-of-repo host may already send this shape. So the branch stays, and it
 * says no out loud.
 *
 * What that buys is the FAILURE MODE, not a failure count. The receiving engine
 * already refuses these arrays ("is not a filter" — objectstack's
 * `engine-filter-array-lowering.test.ts`), so nothing that reaches this point
 * could have produced a correct number; the pre-existing behaviour was to find
 * that out on the wire, or worse, to have the predicate quietly dropped while
 * the chart rendered confident, wrong figures with no signal to their author.
 * This moves the same refusal to the producer, where the author can act on it.
 *
 * Carries the `INVALID_FILTER` / 400 pair its sibling {@link MalformedFilterError}
 * carries, so `isMalformedFilterError()` recognises it and a failed widget renders
 * "this filter is malformed" rather than "check your connection" (objectui#3066).
 */
export class UnloweredAggregateWhereError extends Error {
  readonly code = 'INVALID_FILTER';
  readonly httpStatus = 400;
  /** The value as received, so a caller can log what its producer actually built. */
  readonly where: unknown;
  /** The object `aggregate()` was called for. */
  readonly resource: string;
  constructor(where: unknown, resource: string) {
    const shown = JSON.stringify(where) ?? String(where);
    super(
      `aggregate('${resource}'): the spec-shape branch received a \`where\` array `
      + `that is not a filter — ${shown}. This branch posts \`where\` to `
      + 'POST /data/:object/query verbatim, so it must ALREADY be lowered: either a '
      + 'FilterCondition object (`QuerySchema.where`, @objectstack/spec '
      + 'data/query.zod.ts), or a FilterArray the ingress can lower — a comparison '
      + "tuple (['stage','=','won']), a logical node (['and',[..],[..]]), or an array "
      + 'of nodes (data/filter.zod.ts, gate `isFilterAST`). A ViewFilterRule[] '
      + '([{ field, operator, value }, ...]) is authoring sugar, not a filter: lower it '
      + 'in the producer that built these aggregate params, not here. Nothing was sent '
      + 'to the server, so no unfiltered numbers came back.',
    );
    this.name = 'UnloweredAggregateWhereError';
    this.where = where;
    this.resource = resource;
  }
}

/**
 * Gate the spec-shape branch's `where` on the spec's own AST predicate.
 *
 * Scoped to ARRAYS on purpose, and the two carve-outs are measured, not assumed:
 *
 * - A NON-array `where` is the declared shape. `QuerySchema.where` is
 *   `FilterConditionSchema` — the MongoDB-style condition object — so refusing
 *   `{ stage: 'won' }` here would refuse the contract itself. Untouched.
 * - An EMPTY array is "no filter", and the engine says so in as many words:
 *   objectstack's `engine-filter-array-lowering.test.ts` pins `where: []`
 *   returning every row from `find()` and `3` from `count()`. `isFilterAST([])`
 *   is `false`, so gating on the predicate alone would refuse a value the
 *   receiving door accepts — a refusal the ruling did not order.
 *
 * Every remaining array is one the receiving door refuses too, so this adds no
 * new failure — it moves an existing one to where an author can read it.
 */
function assertSpecShapeWhereIsFilterAst(where: unknown, resource: string): void {
  if (!Array.isArray(where)) return;
  if (where.length === 0) return;
  if (isFilterAST(where)) return;
  throw new UnloweredAggregateWhereError(where, resource);
}

/**
 * The keys `aggregate()`'s ANALYTICS branch reads and its SPEC-SHAPE branch does
 * not: `filter`, `field`, `function`.
 *
 * Written out once, and read by both the refusal below and its message, so the
 * set a caller is told about cannot drift from the set that is checked.
 *
 * ⛔ Deliberately NOT "every key the spec-shape branch does not read". A refusal
 * scoped that widely would reject `orderBy`, a future spec key, or any harmless
 * extra a host happens to carry, and it would satisfy a naive "the spec-shape
 * branch refuses `filter`" test while breaking traffic nobody complained about.
 * These three are named one by one because they are the OTHER branch's own
 * parameters: their presence says the params were built for the analytics wire
 * and arrived on the spec-shape one, which is a producer defect with a name.
 */
const ANALYTICS_ONLY_AGGREGATE_KEYS = ['filter', 'field', 'function'] as const;

type AnalyticsOnlyAggregateKey = (typeof ANALYTICS_ONLY_AGGREGATE_KEYS)[number];

/** What each refused key means, and where its spec-shape equivalent lives. */
const ANALYTICS_ONLY_KEY_ADVICE: Record<AnalyticsOnlyAggregateKey, string> = {
  filter:
    '`filter` is the ANALYTICS branch\'s filter and is lowered there through '
    + '`parseFilterAST`; this branch\'s filter is `where` (`QuerySchema.where`, '
    + '@objectstack/spec data/query.zod.ts) and is posted VERBATIM — rename it to '
    + '`where` and lower it in the producer.',
  field:
    '`field` is half of the analytics branch\'s `${field}_${function}` measure; '
    + 'this branch\'s measure is `aggregations`, an AggregationNode[] such as '
    + "[{ function: 'sum', field: 'amount', alias: 'amount_sum' }].",
  function:
    '`function` is the other half of that measure pair and belongs inside an '
    + '`aggregations` node, not beside `groupBy`.',
};

/** Which disjunct(s) of `looksLikeSpecShape` put this call on the branch. */
function specShapeSelectorReasons(params: any): string[] {
  const reasons: string[] = [];
  if (Array.isArray(params?.groupBy)) reasons.push('`groupBy` is an array');
  if (Array.isArray(params?.aggregations)) reasons.push('`aggregations` is an array');
  if (params?.where !== undefined) reasons.push('a `where` key is present');
  return reasons;
}

/**
 * Analytics-branch params — `filter`, `field`, `function` — that reached
 * `aggregate()`'s SPEC-SHAPE branch, which reads none of them.
 *
 * WHY A REFUSAL AND NOT A DROP (`503cd8b89`). This applies the maintainer
 * ruling of 2026-08-30 on objectui#6825 — option A, REFUSE at the producer — to
 * the rest of the same branch. That ruling's reason was that a shape the spec's
 * own gate would reject is off-contract at the PRODUCER, so the adapter says no
 * instead of degrading leniently; the reason lands harder here, because a
 * silent drop is precisely the disposition it refused for `where`. Leaving one
 * key on this branch refusing while three others vanish without a word would be
 * harder to explain than the old behaviour.
 *
 * ⭐ AND THE DROP HERE IS WORSE THAN THE `where` HALF. `filter` is not the only
 * casualty: `field` and `function` are the analytics branch's whole measure, and
 * the spec-shape branch copies a measure only out of `aggregations`. So the
 * legacy shape `{ field, function, groupBy, filter }` whose `groupBy` happens to
 * be an ARRAY produced a `queryAst` carrying a `groupBy` and NO `aggregations`
 * at all — a grouping with no measure — with the author's predicate gone too.
 * The chart still rendered, the numbers were wrong, and there was nothing to
 * look at.
 *
 * HOW A LEGACY CALLER GETS HERE, measured in this repo on 2026-09-08.
 * `Array.isArray(params.groupBy)` is one of `looksLikeSpecShape`'s three
 * disjuncts, and `ObjectChart`'s `runAggregate` gates only on the STRUCTURED
 * node shape (`gb && typeof gb === 'object' && !Array.isArray(gb)`), so an
 * ARRAY `aggregate.groupBy` falls through to its legacy call — `{ field,
 * function, groupBy, filter }` — and that call lands here.
 * `ObjectMetricWidget.computeOne` forwards `aggregate.groupBy` the same way.
 * Both take the value from authored widget metadata across an `any` seam
 * (`isObjectProvider`'s `aggregate?: any`, `ds: any`), so the type system
 * cannot refuse it and this runtime refusal is what an author gets instead.
 *
 * ⛔ WHAT THIS DELIBERATELY DOES NOT DO. It does not ROUTE the legacy shape back
 * to the analytics branch: that is the tolerant-consumer direction AGENTS.md
 * §0.1 exists to stop, it is the option #6825 refused for `where`, and it could
 * not work anyway — the analytics branch posts `dimensions: [params.groupBy]`,
 * so an array `groupBy` would go out nested. It does not widen `AggregateParams`
 * (`@object-ui/types`), which is a separate contract question. And it does not
 * refuse a key that is present but nullish: `undefined`/`null` carries nothing
 * for the branch to drop, and both `ObjectChart` and `ObjectMetricWidget` build
 * their params by spreading possibly-absent authored values.
 *
 * Carries the `INVALID_FILTER` / 400 pair its siblings {@link MalformedFilterError}
 * and {@link UnloweredAggregateWhereError} carry, so `isMalformedFilterError()`
 * recognises it and a failed widget renders "this filter is malformed" rather
 * than "check your connection" (objectui#3066). One branch, one envelope: a
 * caller can catch `aggregate()`'s producer-side refusals with one predicate.
 */
export class AnalyticsKeysOnSpecShapeError extends Error {
  readonly code = 'INVALID_FILTER';
  readonly httpStatus = 400;
  /** The offending keys, in the order {@link ANALYTICS_ONLY_AGGREGATE_KEYS} lists them. */
  readonly keys: readonly AnalyticsOnlyAggregateKey[];
  /** What each offending key carried, so a producer is identifiable from a log. */
  readonly received: Record<string, unknown>;
  /** The object `aggregate()` was called for. */
  readonly resource: string;
  constructor(
    keys: readonly AnalyticsOnlyAggregateKey[],
    params: any,
    resource: string,
  ) {
    const received: Record<string, unknown> = {};
    for (const key of keys) received[key] = params?.[key];
    const named = keys.map((k) => `\`${k}\``).join(', ');
    const shown = keys
      .map((k) => `${k}=${JSON.stringify(params?.[k]) ?? String(params?.[k])}`)
      .join(', ');
    const why = specShapeSelectorReasons(params).join(' and ');
    const noMeasure = !Array.isArray(params?.aggregations)
      ? ' Because no `aggregations` was supplied either, the query this would '
        + 'have built is a grouping with NO MEASURE — the chart renders and its '
        + 'numbers mean nothing.'
      : '';
    super(
      `aggregate('${resource}'): the spec-shape branch received the analytics `
      + `branch's ${named} — ${shown} — and reads none of them. This call took the `
      + `spec-shape branch because ${why}; the branch posts only \`groupBy\`, `
      + '`aggregations`, `where` and `limit` to POST /data/:object/query, so those '
      + `keys would have been dropped in silence.${noMeasure} `
      + keys.map((k) => ANALYTICS_ONLY_KEY_ADVICE[k]).join(' ')
      + ' The two shapes are alternatives, not a mixture: the analytics branch '
      + '(`{ field, function, groupBy, filter }`, which lowers its filter for you) '
      + 'is reached only when NONE of an array `groupBy`, an array `aggregations` '
      + 'or a `where` key is present. Nothing was sent to the server, so no '
      + 'unfiltered numbers came back.',
    );
    this.name = 'AnalyticsKeysOnSpecShapeError';
    this.keys = keys;
    this.received = received;
    this.resource = resource;
  }
}

/**
 * Refuse the analytics branch's own keys when they reach the spec-shape branch.
 *
 * Presence is `!= null` on purpose, not `in`: a params object that spreads an
 * absent authored value (`filter: filterForRun` where nothing was authored)
 * carries the key with `undefined`, and there is nothing there to drop. Both
 * in-tree producers build their params exactly that way, so keying on `in`
 * would refuse calls that lose nothing.
 */
function assertNoAnalyticsKeysOnSpecShape(params: any, resource: string): void {
  const present = ANALYTICS_ONLY_AGGREGATE_KEYS.filter((key) => params?.[key] != null);
  if (present.length === 0) return;
  throw new AnalyticsKeysOnSpecShapeError(present, params, resource);
}

/**
 * An ARRAY `filter` that reached `aggregate()`'s ANALYTICS branch and that the
 * protocol's lowering sink cannot turn into a `FilterCondition` — an infix join
 * (`[condA, 'or', condB]`) above all.
 *
 * WHY A REFUSAL AND NOT A DROP (objectui#7752; maintainer ruling of 2026-09-05
 * on objectstack#15828, which reads that card as a frontend defect: the
 * protocol is right and the adapter was wrong). `parseFilterAST` answers
 * `undefined` for an array it cannot read, and `undefined` here would post a
 * body with NO `where` at all: the aggregate would then be computed over every
 * row and returned as a confident number, with the author's predicate gone and
 * nothing on the wire to say it went. That is the same silent over-fetch
 * {@link MalformedFilterError} exists to stop, one door further along.
 *
 * Deliberately NOT {@link UnloweredAggregateWhereError}, whose meaning is not
 * widened to cover this: that one guards the SPEC-SHAPE branch, whose `where`
 * is posted verbatim and must therefore have been lowered by its PRODUCER
 * (objectui#6825, ruling 2026-08-30 option A — refuse, never lower). This
 * branch's `filter` is authoring input and IS lowered here, at the door the
 * protocol names; this error covers only the input that sink cannot lower.
 *
 * Carries the `INVALID_FILTER` / 400 pair both siblings carry, so
 * `isMalformedFilterError()` recognises it and a failed widget renders "this
 * filter is malformed" rather than "check your connection" (objectui#3066).
 */
export class UnlowerableAnalyticsFilterError extends Error {
  readonly code = 'INVALID_FILTER';
  readonly httpStatus = 400;
  /** The filter as received, so a caller can log what its producer actually built. */
  readonly filter: unknown;
  /** The object `aggregate()` was called for. */
  readonly resource: string;
  constructor(filter: unknown, resource: string, detail?: string) {
    const shown = JSON.stringify(filter) ?? String(filter);
    super(
      `aggregate('${resource}'): the analytics branch received a \`filter\` array `
      + `that \`parseFilterAST\` cannot lower into a FilterCondition — ${shown}.`
      + (detail ? ` (${detail})` : '')
      + ' `where` on the analytics wire is a FilterCondition (`AnalyticsQuerySchema`, '
      + '@objectstack/spec data/analytics.zod.ts), and a FilterArray is input-only '
      + 'sugar lowered into one at the single sink `parseFilterAST` '
      + '(data/filter.zod.ts, objectstack#5158 ruling C). Lowerable shapes are a '
      + "comparison tuple (['stage','=','won']), a logical node (['and',[..],[..]]), "
      + 'an array of such nodes, and a ViewFilterRule[] this adapter translates '
      + "first. An infix join ([condA, 'or', condB]) is none of them. Nothing was "
      + 'sent to the server, so no unfiltered numbers came back.',
    );
    this.name = 'UnlowerableAnalyticsFilterError';
    this.filter = filter;
    this.resource = resource;
  }
}

/**
 * Refuse a rule entry whose case-insensitive-contains comparand is one of the
 * two shapes `@objectstack/spec`'s `FILTER_TEXT_CASES` declares REFUSED — an
 * empty string, or not a string at all (objectui#9048).
 *
 * The rule-entry form was the one dialect this adapter lowered that shape in.
 * The `$` dialect has refused it since objectui#9001 (the object branch of
 * {@link translateFilterToAST} delegates to `convertFiltersToAST`), and
 * `ValueDataSource` refuses it in every form it reads. So the SAME wire node
 * was refused when written `{ name: { $icontains: '' } }` and sent when written
 * `[{ field: 'name', operator: 'icontains', value: '' }]`: a result that turned
 * on the filter's shape rather than its meaning. One predicate and one reason,
 * both the spec's; this function is only the envelope.
 *
 * The reason is seated verbatim, since `mustMention` makes its bytes the
 * contract. It names the spelling that ARRIVED, never a canonical one put in
 * its place; the table's rows spell the operator in the `$` dialect, so the
 * tail names that twin rather than substituting it — the seating
 * `viewFilterRuleToNode` uses for the same vocabulary.
 *
 * No carve-out for an absent `value`. The stored-view lowering has one because
 * it emits a 2-tuple for a valueless operator; this translator always emits a
 * 3-tuple, and an absent value went out as JSON `null` — a non-string
 * comparand, which is the table's second row. `ValueDataSource` refuses the
 * same rule for the same reason.
 *
 * The envelope is an ordinary {@link MalformedFilterError} whose message is
 * replaced by the refusal sentence, so `instanceof`, `name`, `code` and
 * `httpStatus` are the class's own. The sentence is seated here, module-private,
 * rather than through a constructor parameter, because the class is published
 * and no consumer needs a way to pass one: the refusal is this module's, and
 * its public constructor stays exactly what it was. The shape advice the
 * constructor writes first is discarded; building it is BigInt-safe (see
 * `describeFilterEntry`), so a BigInt comparand still reaches this sentence.
 */
function refuseTextComparandEntry(
  entry: { readonly value?: unknown },
  index: number,
  field: string,
  arrived: string,
): never {
  const tail =
    `This is a { field, operator, value } rule entry, so it is refused as the filter is `
    + `translated rather than sent: the spelling @objectstack/spec's FILTER_TEXT_CASES `
    + `uses for this operator is the $-dialect '$icontains', which this form spells `
    + `'${arrived}'. Remove the entry, or give it a non-empty string value `
    + `(objectui#9048; the same refusal convertFiltersToAST and ValueDataSource already share).`;
  const error = new MalformedFilterError(entry, index);
  error.message =
    `Filter entry ${index} is refused. `
    + `The ${textComparandRefusalReason(field, arrived, entry.value)}. ${tail}`;
  throw error;
}

/**
 * One rule entry → one AST comparison tuple, or `null` when the entry is not a
 * usable rule. `index` is the entry's position in the array it was found in,
 * named by a refusal so the author can find the entry in the view config.
 */
function objectFilterEntryToAST(entry: any, index: number): [string, string, any] | null {
  if (!entry || typeof entry !== 'object') return null;
  // `field` only. A `?? entry.name` fallback lived here from the day the
  // function was written (4b93db4e6) and was unreachable for exactly as long:
  // the shape sniff below has always keyed on `field`, so a `name`-keyed entry
  // fell through to the "already AST" branch and shipped raw. The spec agrees
  // it is not a real shape — `ViewFilterRuleSchema.field` is required, so a
  // `name`-keyed rule cannot be saved as view metadata in the first place.
  const field = entry.field;
  const rawOp = entry.operator ?? entry.op ?? '=';
  const op = toAstFilterOperator(rawOp);
  if (!field || !op) return null;
  // Asked AFTER the fold, so every spelling `toAstFilterOperator` resolves to
  // `icontains` meets the door. `rawOp` is a string here: the fold answers
  // `null` for anything else, which returned above.
  if (op === 'icontains' && isRefusedTextComparand(entry.value)) {
    refuseTextComparandEntry(entry, index, String(field), rawOp);
  }
  return [String(field), op, entry.value];
}

/**
 * Which of the two array filter shapes is this — object entries or an AST node?
 *
 * One definition on purpose. This test used to be written out twice (here and
 * inline in `convertQueryParams`) and the copies had already drifted: the
 * inline one omitted the `!== null` guard, so a `$filter` of `[null]` threw a
 * TypeError on the plain `find()` path while the same value was handled on the
 * `$expand` path. Same stored view, different answer, decided by whether it
 * happened to expand a lookup.
 */
function isObjectFilterEntryForm(filter: readonly unknown[]): boolean {
  const first = filter[0];
  return filter.length > 0
    && typeof first === 'object'
    && first !== null
    && !Array.isArray(first)
    && (first as any).field !== undefined;
}

/**
 * Translate `[{ field, operator, value }, ...]` into a filter AST node. Every
 * entry must translate; see `MalformedFilterError` for why one that doesn't is
 * an error rather than an omission.
 */
function objectFilterEntriesToAST(entries: readonly unknown[]): unknown[] {
  const nodes = entries.map((entry, i) => {
    // An entry that is itself an array is already a node — a mixed array keeps
    // both conditions instead of losing one to a drop or the whole query to an
    // error.
    if (Array.isArray(entry)) return translateFilterChild(entry, i);
    const tuple = objectFilterEntryToAST(entry, i);
    if (!tuple) throw new MalformedFilterError(entry, i);
    return tuple;
  });
  return nodes.length === 1 ? (nodes[0] as unknown[]) : ['and', ...nodes];
}

/** Logical heads `parseFilterAST` recognizes (`data/filter.zod.ts`). No `not`. */
const LOGICAL_AST_HEADS = new Set(['and', 'or']);

/**
 * Translate a filter array at EVERY level, not just the top one.
 *
 * Translating only the top level left the commonest composite filter there is
 * shipping raw. A list whose view carries a stored filter and whose user adds
 * one in the panel produces `['and', <ViewFilterRule[]>, <AST tuples>]`; the
 * head is the string `and`, so the old top-level-only check called the whole
 * thing "already AST" and sent the rules on untouched.
 *
 * What the server does with that depends on its version, and both answers are
 * wrong:
 *
 * ```
 * const n = ['and', [{ field: 'stage', operator: 'eq', value: 'won' }], [['amount', '>', 1]]];
 * isFilterAST(n)    // false — a bare rule object is not an AST child
 * parseFilterAST(n) // { amount: { $gt: 1 } }   ← `stage = won` is simply GONE
 * ```
 *
 * Since objectstack#4121 the `isFilterAST` gate turns that into a 400 and the
 * list fails to load. Before it — or anywhere `parseFilterAST` is reached
 * without the gate — the view's own condition is dropped without a word and the
 * list shows records the view exists to exclude.
 */
function translateFilterArray(filter: unknown[]): unknown[] {
  if (isObjectFilterEntryForm(filter)) return objectFilterEntriesToAST(filter);
  const head = filter[0];
  if (typeof head === 'string' && LOGICAL_AST_HEADS.has(head.toLowerCase())) {
    return [head, ...filter.slice(1).map((child, i) => translateFilterChild(child, i + 1))];
  }
  // Legacy flat array of child nodes: [[...], [...]] — implicit AND.
  if (filter.every((child) => Array.isArray(child))) {
    return filter.map((child, i) => translateFilterChild(child, i));
  }
  // A comparison tuple, or a shape we do not recognize. Leave it alone; the
  // server decides, and since objectstack#4121 it says so with a 400.
  return filter;
}

/**
 * A child of a logical node: another array node, a bare rule object, or a value
 * we leave alone.
 *
 * The bare-rule case comes from producers that SPREAD a `ViewFilterRule[]` into
 * an `and` (`['and', ...rules, ...tuples]`) instead of wrapping it. That puts
 * rule objects where the AST expects nodes, and the server has no good answer:
 * `isFilterAST` rejects it (a 400 since objectstack#4121), while
 * `parseFilterAST` reads the rule as a MongoDB condition and filters on columns
 * literally named `field` / `operator` / `value` — three columns that do not
 * exist, so the honest-looking result is empty.
 *
 * Only rule-SHAPED objects are translated: a child with no `field` is a genuine
 * MongoDB condition (`{ status: 'active' }`) and must pass through untouched.
 * Same discriminator `isObjectFilterEntryForm` uses at the top level.
 *
 * A bare rule that does not translate is left for the server to refuse, but one
 * the contract REFUSES is not: {@link objectFilterEntryToAST} throws for it
 * here exactly as it does at the top level (objectui#9048). Translating it
 * would send the refused node, and leaving it raw would earn a refusal of its
 * SHAPE rather than of what it says. `index` is the child's position in its
 * parent array.
 */
function translateFilterChild(child: unknown, index: number): unknown {
  if (Array.isArray(child)) return child.length > 0 ? translateFilterArray(child) : child;
  if (child && typeof child === 'object' && (child as any).field !== undefined) {
    const tuple = objectFilterEntryToAST(child, index);
    if (tuple) return tuple;
  }
  return child;
}

/**
 * Translate any of the filter shapes accepted by ObjectUI into the AST format
 * understood by the ObjectStack server's `parseFilterAST()`.
 *
 * Accepted inputs:
 *   - `[{ field, operator, value }, ...]` — ViewFilterRule[] from view configs
 *   - `[field, op, value]`                — single AST tuple (passed through)
 *   - `['and'|'or', ...children]`         — logical AST node (passed through)
 *   - `[[...], [...]]`                    — legacy nested AST (passed through)
 *   - `{ field: value }` / `{ field: { $op: value } }` — MongoDB-style object
 *
 * Returns `undefined` when the input is empty/unrecognized so callers can
 * skip emitting `?filter=` entirely.
 */
function translateFilterToAST(filter: unknown): unknown | undefined {
  if (filter === undefined || filter === null) return undefined;

  if (Array.isArray(filter)) {
    if (filter.length === 0) return undefined;
    return translateFilterArray(filter);
  }

  if (typeof filter === 'object') {
    if (Object.keys(filter as Record<string, unknown>).length === 0) return undefined;
    // Same conversion `convertQueryParams` applies. This branch used to return
    // the object VERBATIM, so the two `find()` routes disagreed about the same
    // filter — decided, as ever, by whether the query happened to expand a
    // lookup. Measured across 21 operator shapes, four diverged; the one that
    // mattered is that `convertFiltersToAST`'s unknown-operator guard — added
    // expressly "to avoid silent failure" — never ran on this route, so a typo'd
    // operator threw on a plain read and shipped silently on an expanded one.
    return convertFiltersToAST(filter as Record<string, unknown>);
  }

  return undefined;
}

/**
 * Lower an analytics `filter` into the `where` the analytics wire declares.
 *
 * THE CONTRACT (objectstack#5158 ruling C, `data/filter.zod.ts`'s `FilterArray`
 * docblock, verbatim): "A `FilterArray` is not a storage shape and not a
 * protocol shape. It is lowered to a `FilterCondition` at the single sink
 * `parseFilterAST` (`@objectstack/spec/data`) the moment it arrives, and only
 * the lowered `FilterCondition` travels any further. `where` on a query is a
 * `FilterCondition` and stays one." A POST body is transport, not one of the
 * declared doors where an array may arrive (React block props, `FilterBuilder`,
 * the REST `$filter` query string) — so the lowering happens HERE, before the
 * body is built, and only a `FilterCondition` goes out.
 *
 * Three shapes, three answers:
 *
 * - A NON-array filter is already a `FilterCondition` — the MongoDB-style
 *   object this branch was written for, and what `AnalyticsQuerySchema.where`
 *   declares. Passed through untouched; translating it here would be a semantic
 *   change, not a fix.
 * - An EMPTY array is no filter, so no `where` key is posted at all. Decided
 *   here rather than inferred: `parseFilterAST([])` is `undefined`, and the
 *   in-process analytics door reads `[]` the same way ("`[]` is no filter",
 *   objectstack#5334). The two readings agree, and this pins that they do.
 * - Every other array is first normalised by `translateFilterArray` — the SAME
 *   function `find()` runs in `convertQueryParams`, so one stored filter cannot
 *   mean two things on two paths — and then lowered by the sink.
 *
 * Anything the sink cannot lower is refused, never posted and never dropped:
 * see {@link UnlowerableAnalyticsFilterError} for why `undefined` on the wire
 * would be the worst of the three possible answers.
 */
function lowerAnalyticsFilterForWire(filter: unknown, resource: string): unknown | undefined {
  if (!Array.isArray(filter)) return filter;
  if (filter.length === 0) return undefined;

  // Throws `MalformedFilterError` on an untranslatable rule entry, exactly as it
  // does on the `find()` path. Raised from here — outside `aggregate()`'s
  // analytics `try` — so the refusal reaches the caller as itself instead of
  // being classified as an unknown analytics failure and answered by the
  // client-side fallback.
  const ast = translateFilterArray(filter);

  // The spec's own predicate, not a shape sniff: an array it rejects is an array
  // the sink cannot read, and `parseFilterAST` would answer `undefined` for it.
  if (!isFilterAST(ast)) throw new UnlowerableAnalyticsFilterError(filter, resource);

  let lowered: unknown;
  try {
    lowered = parseFilterAST(ast);
  } catch (e) {
    // The sink's own refusal (a comparison tuple missing its comparand, say).
    // Re-dressed in this adapter's `INVALID_FILTER` / 400 envelope, its message
    // kept, so a widget can tell a malformed filter from a dead connection.
    throw new UnlowerableAnalyticsFilterError(
      filter, resource, e instanceof Error ? e.message : String(e),
    );
  }
  // Belt to the gate's braces: the gate said this array is a filter, so the sink
  // owes a condition. `undefined` here would post an unfiltered aggregate under
  // a filtered question, so it is a refusal rather than a value.
  if (lowered === undefined) {
    throw new UnlowerableAnalyticsFilterError(
      filter, resource, '`parseFilterAST` answered `undefined` for a non-empty filter',
    );
  }
  return lowered;
}

/**
 * Serialize a `$orderby` to the server's `sort` shorthand
 * (`field,-other_field`), for every shape `QueryParams['$orderby']` declares.
 *
 * The type declares four — `string`, `string[]`, `SortNode[]`,
 * `Record<field, direction>` — and the two `find()` routes each open-coded a
 * fold that handled three of them. The missing one was the bare string, and it
 * did not degrade quietly: `Object.entries('name asc')` enumerates a string's
 * character indices, so the request went out as `sort=0,1,2,3,4,5,6,7`. Against
 * a server that rejects an unreadable sort rather than ignoring it
 * (objectstack#4226), that is a `400 INVALID_SORT` and an empty list — so a
 * standalone `ObjectGrid` with a `sort` in its metadata, which is exactly the
 * shape it builds (`ObjectGrid.tsx`: `` `${field} ${order}` ``), failed to load
 * at all.
 *
 * One serializer for both routes, for the reason the filter path already has
 * one: two copies of a fold can only agree by inspection, and these two did not.
 *
 * Returns `undefined` when nothing is sortable, so callers skip the parameter
 * entirely rather than sending an empty one.
 */
export function serializeOrderBy(orderby: QueryParams['$orderby']): string | undefined {
  if (orderby === undefined || orderby === null) return undefined;

  // `field asc` / `-field` / a comma-separated list of either — already the
  // wire shorthand the server parses, so it rides through untouched.
  if (typeof orderby === 'string') {
    const trimmed = orderby.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const shorthand = (field: string, order?: unknown) =>
    String(order).toLowerCase() === 'desc' ? `-${field}` : field;

  if (Array.isArray(orderby)) {
    const parts = orderby
      .map((item) => (typeof item === 'string' ? item.trim() : shorthand(item.field, item.order)))
      .filter((s) => s.length > 0);
    return parts.length > 0 ? parts.join(',') : undefined;
  }

  if (typeof orderby === 'object') {
    const parts = Object.entries(orderby).map(([field, order]) => shorthand(field, order));
    return parts.length > 0 ? parts.join(',') : undefined;
  }

  return undefined;
}

// Module-level discovery cache. Multiple ObjectStackAdapter instances pointed
// at the same baseUrl (e.g. ConditionalAuthWrapper's throwaway adapter +
// AdapterProvider's main adapter) would otherwise each fire `/discovery`. By
// keying on baseUrl we collapse them to a single network round trip per origin.
/**
 * The one {@link MetadataCache} key for the published view list,
 * `GET /api/v1/meta/view` (objectui#13044).
 *
 * Three readers ask that one URL on a single list-page open: the app-shell
 * `MetadataProvider`'s eager `view` read (through {@link ObjectStackAdapter.getClient}),
 * {@link ObjectStackAdapter.listViews} and
 * {@link ObjectStackAdapter.listViewOverrides}. They share the request IN
 * FLIGHT under this key: whoever asks while one is on the wire joins it.
 *
 * The answer is also stored under it (objectui#13057, completing objectui#13044
 * ruling 6268839381 (a)-(c)). The client read still always asks the server; the
 * adapter's own two readers are answered from what it stored, so the console's
 * order (the eager read lands, then the object page reads the list and the
 * overrides) costs one request. The settled entry is dropped by every path that
 * should see a fresh list:
 *
 * - every view write: {@link ObjectStackAdapter.invalidateViewKeys}, the client
 *   write wrap in `installViewListShare`, and app-shell's console
 *   `MetadataClient` (`useMetadataClient`), which drops it after each of its
 *   view-capable write doors;
 * - a user refresh (app-shell `ObjectView`'s `refreshData`);
 * - an organization or session switch, and the publish pulse, which clear the
 *   whole cache (app-shell `MetadataProvider`).
 *
 * The draft-overlaid list (`listViews` with `previewDrafts`) is a different
 * request on a different client, and never fills this key.
 */
const VIEW_LIST_KEY = 'list:view';

const discoveryCache = new Map<string, Promise<unknown>>();

/**
 * Fetch the server `discovery` document once per (baseUrl) and reuse the
 * resulting Promise. Used by `ObjectStackAdapter.connect()` (and any caller
 * that wants the discovery payload without spinning up a new client).
 */
export async function getSharedDiscovery(
  baseUrl: string,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const key = baseUrl || '<default>';
  const cached = discoveryCache.get(key);
  if (cached) return cached;
  const p = fetcher().catch((err) => {
    // Allow retry on failure
    discoveryCache.delete(key);
    throw err;
  });
  discoveryCache.set(key, p);
  return p;
}

/** Test/dev helper to drop the cache (e.g. on logout or origin change). */
export function clearSharedDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * Read the cross-object atomic-batch capability from a `discovery` document
 * (objectstack-ai/objectstack#3298 / objectui #2693). The server advertises it hierarchically
 * under `capabilities.transactionalBatch.enabled`; the published
 * `@objectstack/client` also accepts the flat `capabilities.transactionalBatch:
 * boolean` form and normalizes the two — mirror that here so the adapter reads
 * the same bit regardless of which shape reaches it.
 *
 * Returns:
 *   - `true`  — the backend GUARANTEES an atomic `/batch` (declared === enforced,
 *     i.e. the route is mounted AND the runtime can honour a transaction): the
 *     client may drop its non-atomic fallback and treat any batch failure as a
 *     real error.
 *   - `false` — the backend explicitly does NOT (route absent, or a runtime that
 *     can't open a transaction).
 *   - `undefined` — the capability is absent, i.e. the backend predates objectstack-ai/objectstack#3298;
 *     the caller must keep the legacy runtime-probe fallback (we can't tell
 *     whether `/batch` exists without trying it).
 */
export function readTransactionalBatchCapability(
  discovery: unknown,
): boolean | undefined {
  const caps = (discovery as { capabilities?: unknown } | null | undefined)?.capabilities;
  if (!caps || typeof caps !== 'object') return undefined;
  const value = (caps as Record<string, unknown>).transactionalBatch;
  // Flat form: `{ transactionalBatch: true }`.
  if (typeof value === 'boolean') return value;
  // Hierarchical form: `{ transactionalBatch: { enabled: true } }`.
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { enabled?: unknown }).enabled === 'boolean'
  ) {
    return (value as { enabled: boolean }).enabled;
  }
  return undefined;
}

/**
 * Detect "missing resource" errors regardless of where they originate.
 *
 * The ObjectStack client decorates thrown errors with `httpStatus` (and a
 * machine-readable `code` such as `object_not_found`/`record_not_found`),
 * while raw `fetch()` callers may surface `status` or `statusCode`. Treat
 * any of these as a 404 so callers can degrade gracefully instead of
 * tripping on the property-name mismatch.
 */
export function is404Error(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  if (err.httpStatus === 404 || err.status === 404 || err.statusCode === 404) {
    return true;
  }
  const code = typeof err.code === 'string' ? err.code : '';
  return errorCodeIsAnyOf({ code }, ['OBJECT_NOT_FOUND', 'RECORD_NOT_FOUND']);
}

/**
 * The two denials the server derives from an object's `enable` block —
 * `apiAccessDenialFromEnable` (objectstack `packages/rest/src/rest-server.ts`).
 *
 *   - `OBJECT_API_DISABLED` (404) — `enable.apiEnabled: false`; the object is
 *     not exposed over the data API at all.
 *   - `OBJECT_API_METHOD_NOT_ALLOWED` (405) — the operation is absent from the
 *     `enable.apiMethods` whitelist.
 *
 * Both are **pure functions of the object's metadata**: no user, no permission,
 * no context, no request body. So neither is transient and neither is
 * per-user — when one happens it is a permanent property of that object, and
 * every retry of every persona gets the identical answer.
 *
 * That is exactly why they must not be degraded into "no data". A 404 from a
 * missing collection means *this backend doesn't have that table*, which the
 * optional-collection probes below legitimately read as "feature unavailable";
 * a 404 from `OBJECT_API_DISABLED` means *this page can never work*. Answering
 * the second with an empty result set renders "you have no records" over a
 * surface that is not allowed to have any (objectui#4408 — it also hid the
 * upstream defect objectstack#7544 for its entire life, because a merely
 * unpopulated page invites nobody to click through).
 */
export const API_ACCESS_DENIED_CODES = [
  'OBJECT_API_DISABLED',
  'OBJECT_API_METHOD_NOT_ALLOWED',
] as const;

/**
 * True when `error` is an `enable`-block API denial (see
 * {@link API_ACCESS_DENIED_CODES}).
 *
 * Discriminates on the ADR-0112 `code`, never on the status: 404 alone cannot
 * separate a disabled object from a missing collection, and 405 alone cannot
 * separate a withheld method from any other method rejection. The code survives
 * the transport — `@objectstack/client`'s fetch wrapper stamps `error.code`
 * from the response envelope, and both spellings are declared members of the
 * spec's `StandardErrorCode` — so no heuristic on status is needed or wanted.
 */
export function isApiAccessDeniedError(error: unknown): boolean {
  return errorCodeIsAnyOf(error, API_ACCESS_DENIED_CODES);
}

/**
 * What the by-name meta app route said about THIS session's access to an app
 * (objectui#4252 / objectstack#8013, widened by objectui#9262).
 *
 *  - `granted`     — the route served the app document.
 *  - `denied`      — the app EXISTS and the session lacks its
 *    `requiredPermissions`. The only verdict a caller may render as an
 *    authorization refusal.
 *  - `not_found`   — the route answered, and what it answered is that it has no
 *    app at this name for this session. WHICH absence it is — never created, a
 *    typo, an unpublished draft, an app gated by an absent optional service —
 *    is deliberately NOT distinguished: the control plane answers the same way
 *    for every app the caller may not see, and the 2026-08-12 ruling keeps it
 *    that way. A caller may say the app cannot be opened; it may never say why.
 *  - `unreachable` — the probe could not obtain an answer at all: the transport
 *    failed, the server erred, the request timed out. Says nothing about the
 *    app.
 *  - `unknown`     — nothing was measured, because nothing could be asked: a
 *    host DataSource that does not implement this probe (the console is
 *    protocol-agnostic — AGENTS #1), or no app name to ask about.
 *
 * ## Why `not_found` and `unreachable` are separate members (objectui#9262)
 *
 * They were one `unknown` before, and the screen above them therefore asserted
 * a transient publish state over both. The distinction is not new information
 * to obtain — it is already on the wire, and folding it away was the defect.
 * The maintainer ruling (2026-09-13) named the two members; this type is the
 * two-member widening that ruling declared.
 *
 * ⚠️ `unknown` no longer means "absent". A consumer that treats `unknown` as a
 * positive absence is reading a verdict that now means the opposite: that the
 * question was never put.
 */
export type AppAccessVerdict = 'granted' | 'denied' | 'not_found' | 'unreachable' | 'unknown';

/**
 * What {@link ObjectStackAdapter.probeMetaItemAccess} obtained about one item
 * of any type the by-name meta route gates per caller (objectui#12112). The
 * verdicts mean what they mean for an app ({@link AppAccessVerdict}).
 */
export interface MetaItemAccess {
  readonly verdict: AppAccessVerdict;
  /**
   * The refusal's own `message`, as the server wrote it — for a dashboard,
   * `You do not have permission to open the 'NAME' dashboard.` Only on
   * `denied`, and absent when the server wrote none.
   */
  readonly message?: string;
}

/**
 * The ADR-0112 standard catalog code the by-name meta app route answers with
 * when an app exists and the session lacks its `requiredPermissions`
 * (objectstack#8013, `sendError(res, 403, 'PERMISSION_DENIED', …)` in
 * `packages/rest/src/rest-server.ts`).
 *
 * Deliberately NOT a member of {@link API_ACCESS_DENIED_CODES}: those two are
 * pure functions of an object's `enable` metadata — permanent, identical for
 * every persona — whereas this one is a statement about the CALLER, and the same
 * request by a different session succeeds. Same word "denied", different
 * question, so a consumer that wants one must never match the other.
 */
export const APP_PERMISSION_DENIED_CODE = 'PERMISSION_DENIED';

/**
 * True when `error` is the by-name app route's permission denial.
 *
 * Discriminates on the ADR-0112 `code`, never on the status (objectui#4408): the
 * route answers 403 for this and 404 for absence today, but a status is a
 * transport fact many conditions share, while the code is the contract. The
 * console's whole reason to call this is to tell two REFUSALS apart, and both
 * are errors.
 */
export function isAppPermissionDeniedError(error: unknown): boolean {
  return errorCodeIs(error, APP_PERMISSION_DENIED_CODE);
}

/**
 * The ADR-0112 standard catalog code the metadata routes answer with when the
 * named item is not there for this caller (`sendError(res, 404,
 * 'RESOURCE_NOT_FOUND', …)` in `packages/rest/src/rest-server.ts`).
 *
 * One code covers every absence on purpose: a nonexistent name, an unpublished
 * app (ADR-0045 §3 keeps it externally unobservable), and an app gated by an
 * absent optional service (ADR-0057 D10 — nothing was denied to the CALLER) are
 * one answer by the 2026-08-12 ruling's design, not three that happen to
 * collide. Consumers may report the absence; they may not report a reason.
 */
export const META_ITEM_ABSENT_CODE = 'RESOURCE_NOT_FOUND';

/**
 * True when `error` is a metadata route's "not here for you" answer.
 *
 * Discriminates on the ADR-0112 `code`, never on the status, for the same
 * reason {@link isAppPermissionDeniedError} does (objectui#4408): a 404 is a
 * transport fact many conditions share — a mis-typed route, a proxy, an
 * appliance in front of the server — while the code is the contract. A 404 that
 * carries no declared code is NOT an absence: nobody said the item was missing,
 * so the honest reading is that no answer was obtained.
 */
export function isMetaItemAbsentError(error: unknown): boolean {
  return errorCodeIs(error, META_ITEM_ABSENT_CODE);
}

/**
 * Whether a `GET /api/v1/meta/:type/:name` envelope actually carried a document.
 *
 * ## Why this exists — measured, not assumed (objectui#9262)
 *
 * `GetMetaItemResponseSchema` (`@objectstack/spec`,
 * `packages/spec/src/api/protocol.zod.ts`) declares the answer as the envelope
 * `{ type, name, item, … }` with `item` a REQUIRED member: the document is what
 * "the route served it" means. Measured against a real server (showcase example
 * on `objectstack` 60b9955, API 17.4.0) a name that does not exist answers
 * **200 with that envelope MINUS its `item`** — not the `404 RESOURCE_NOT_FOUND`
 * this file used to assume, and not an error of any kind:
 *
 *     GET /api/v1/meta/app/no_such_app_xyz
 *     200 {"type":"app","name":"no_such_app_xyz","lock":"none","editable":true,…}
 *
 * In `rest-server.ts` both the 403 denial and the 404 absence sit inside
 * `if (isAppType && visible)`, and `visible` is the document — so for a name
 * that resolves to nothing the whole gate is skipped and the envelope falls
 * through to `res.json`. The 404 branch is reachable only for an app that
 * EXISTS and is withheld for a non-permission reason.
 *
 * ⇒ absence has to be read from the ENVELOPE, not inferred from the absence of
 * a thrown error. Reading `item` is not a lenient fallback around a malformed
 * shape (AGENTS #0.1): it is the declared member, and the previous code's "it
 * did not throw, so the app is there" was the reading that had no contract
 * behind it.
 *
 * Both dialects are honoured because this console is versioned separately from
 * the server it talks to: a server that answers the 404 is handled in the catch
 * (see {@link isMetaItemAbsentError}), a server that answers the item-less 200
 * is handled here, and both mean `not_found`.
 */
function metaEnvelopeCarriesItem(envelope: unknown): boolean {
  if (envelope == null || typeof envelope !== 'object') return false;
  return (envelope as { item?: unknown }).item != null;
}

/**
 * Thrown when the deployment has no analytics capability installed
 * (framework#3891 / objectstack-ai/objectstack#4019).
 *
 * The framework retired its degraded in-kernel analytics fallback — it dropped
 * the caller's RLS/tenant scope and ignored the contract filter, so it answered
 * 200 with over-broad numbers. `@objectstack/service-analytics` is now the
 * domain's only implementation, and a deployment without it answers:
 *
 *   - `POST /api/v1/analytics/query` → **404** (the routes aren't even mounted);
 *   - `POST /api/v1/analytics/dataset/query` → **501 NOT_IMPLEMENTED**.
 *
 * Neither is a bug to report as a stack trace: it is a deployment that hasn't
 * installed the capability. This error carries a message a UI can show as-is.
 */
export class AnalyticsNotInstalledError extends Error {
  readonly code = 'ANALYTICS_NOT_INSTALLED';
  /** The surface that was unavailable, for the message a host renders. */
  readonly surface: string;
  /**
   * The server's own ADR-0112 code — the field this branch was chosen BY, when
   * a producer named one (`NOT_IMPLEMENTED` from the mounted route with no
   * service behind it, `ROUTE_NOT_FOUND` from the dispatcher when the route is
   * not mounted at all). Absent for the no-code residual, where a bare
   * transport 404/501 is all there was to read.
   *
   * Additive (objectui#5663): carried so a reader can audit that the headline
   * and the quoted `detail` below came off the same answer.
   */
  readonly serverCode?: string;
  constructor(surface: string, detail?: string, serverCode?: string) {
    super(
      `Analytics capability is not installed on this deployment — ${surface} is unavailable. ` +
      'Install @objectstack/service-analytics and mount AnalyticsServicePlugin to enable it.' +
      (detail ? ` (server said: ${detail})` : ''),
    );
    this.name = 'AnalyticsNotInstalledError';
    this.surface = surface;
    this.serverCode = serverCode;
  }
}

/** True when `error` is an {@link AnalyticsNotInstalledError} (or its wire twin). */
export function isAnalyticsNotInstalledError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === 'ANALYTICS_NOT_INSTALLED';
}

/**
 * Thrown when the dataset route ANSWERED and said the dataset this query named
 * does not exist in this environment — `404` + ADR-0112 `NOT_FOUND`, the
 * `body.datasetName` lookup miss in `@objectstack/rest`'s
 * `registerAnalyticsEndpoints` (`Dataset "<name>" not found.`).
 *
 * A SIBLING of {@link AnalyticsNotInstalledError}, never a shade of it
 * (objectui#5663). Both conditions answer **404** — routes-not-mounted through
 * the runtime dispatcher's `ROUTE_NOT_FOUND`, an unknown dataset through this
 * route's own `NOT_FOUND` — so a `res.status === 404` test cannot separate
 * them, and the mapping that could not tell them apart reported EVERY unknown
 * dataset as a missing server capability.
 *
 * Measured live on a prod tenant: four HotCRM Executive Overview widgets told
 * the operator to install `@objectstack/service-analytics` and mount
 * `AnalyticsServicePlugin`, while the analytics service was installed and
 * answering the whole time. The real condition was an installed
 * `app.objectstack.hotcrm` pinned at 1.3.0 whose datasets ship in 2.2.2. The
 * remedy the banner named — install a server plugin — is the opposite corner of
 * the system from the remedy that works: upgrade the installed app. A wrong
 * diagnosis is not a smaller version of no diagnosis; it spends the operator's
 * time in the wrong subsystem.
 *
 * The `code` is the ONLY field that separates the two, which is why this branch
 * reads it and nothing else. See `readAnalyticsErrorEnvelope` below — the
 * module-private reader that pulls the code out of either declared envelope.
 */
export class AnalyticsDatasetNotFoundError extends Error {
  readonly code = 'ANALYTICS_DATASET_NOT_FOUND';
  /**
   * The dataset this query asked for, taken from the REQUEST rather than parsed
   * back out of the server's prose: the request is what we know for certain,
   * and re-reading the name out of a message would make the headline depend on
   * that message's WORDING — the coupling framework#5367 spent a whole issue
   * removing from the producing route.
   */
  readonly datasetName?: string;
  /** The server's own ADR-0112 code — the field this branch was chosen BY. */
  readonly serverCode?: string;
  /** The server's own message, quoted verbatim in the parenthetical. */
  readonly serverMessage?: string;
  constructor(opts: { datasetName?: string; serverCode?: string; serverMessage?: string }) {
    const subject = opts.datasetName ? `Dataset "${opts.datasetName}"` : 'The requested dataset';
    super(
      `${subject} is not defined in this environment — the app that defines it is missing or out of date. ` +
      'Analytics itself is installed and answering, so the fix is to upgrade the installed app, not to install a server plugin.' +
      (opts.serverMessage ? ` (server said: ${opts.serverMessage})` : ''),
    );
    this.name = 'AnalyticsDatasetNotFoundError';
    this.datasetName = opts.datasetName;
    this.serverCode = opts.serverCode;
    this.serverMessage = opts.serverMessage;
  }
}

/**
 * Thrown when the dataset query was refused before it ran because the session
 * is not authenticated — `401` + ADR-0112 `UNAUTHENTICATED`, the REST seam's
 * `ANONYMOUS_DENY_BODY` (`@objectstack/core`'s `security/anonymous-deny.ts`,
 * written verbatim by `enforceAuth`).
 *
 * The THIRD branch, and the one the reported card under-states (objectui#5663):
 * it recorded a live `POST /api/v1/analytics/dataset/query -> 401
 * UNAUTHENTICATED` and read it as evidence for the dataset-unknown branch. It
 * is neither of the other two. An expired session reported as "the deployment
 * is missing a capability" is the SAME defect wearing a different mask — an
 * operator sent to install a server plugin because their token lapsed — so the
 * separation is the point, not a nicety.
 *
 * Deliberately not left to the generic `Dataset query failed: 401 …` either:
 * that string names a transport status where a person needs an action, and
 * "sign in again" is an action.
 */
export class AnalyticsUnauthenticatedError extends Error {
  readonly code = 'ANALYTICS_UNAUTHENTICATED';
  /** The server's own ADR-0112 code — the field this branch was chosen BY. */
  readonly serverCode?: string;
  /** The server's own message, quoted verbatim in the parenthetical. */
  readonly serverMessage?: string;
  constructor(opts: { serverCode?: string; serverMessage?: string } = {}) {
    super(
      'Analytics query refused: this session is not authenticated. Sign in again and retry — ' +
      'the request was refused before it ran, so it says nothing about whether the analytics ' +
      'capability is installed.' +
      (opts.serverMessage ? ` (server said: ${opts.serverMessage})` : ''),
    );
    this.name = 'AnalyticsUnauthenticatedError';
    this.serverCode = opts.serverCode;
    this.serverMessage = opts.serverMessage;
  }
}

/**
 * Thrown when the dataset query was refused because this user may not READ an
 * object the dataset queries — `403` + ADR-0112 `PERMISSION_DENIED`, which
 * `@objectstack/service-analytics`' read admission (`readAdmissionDeniedError`)
 * answers with the same code and status the data API gives the same user for
 * the same object (objectui#10899).
 *
 * The FOURTH branch. It used to fall through to the generic
 * `Dataset query failed: 403 Forbidden — [Analytics] Access denied: …` string,
 * which a dashboard tile then rendered verbatim: a raw English exception where
 * the list view over the same object shows its localized "no access" state.
 * That generic string names a transport status where a person needs a fact
 * ("you can't see this data"), and it is the one case a renderer must be able
 * to tell apart — so it is typed, and it carries `httpStatus` + a `code` the
 * shared `classifyLoadError` reads as `forbidden` without any string matching.
 *
 * `serverMessage` is kept for diagnostics only. The producer deliberately
 * names the object and nothing else, but it is still platform prose, not text
 * addressed to the end user.
 */
export class AnalyticsForbiddenError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly httpStatus = 403;
  /** The server's own ADR-0112 code — the field this branch was chosen BY. */
  readonly serverCode?: string;
  /** The server's own message, verbatim (diagnostics only). */
  readonly serverMessage?: string;
  /** The dataset the refused query asked for, when it named one. */
  readonly datasetName?: string;
  constructor(opts: { serverCode?: string; serverMessage?: string; datasetName?: string } = {}) {
    super(
      `Analytics query refused: this user may not read the data behind ` +
      `${opts.datasetName ? `dataset "${opts.datasetName}"` : 'this dataset'}.` +
      (opts.serverMessage ? ` (server said: ${opts.serverMessage})` : ''),
    );
    this.name = 'AnalyticsForbiddenError';
    this.serverCode = opts.serverCode;
    this.serverMessage = opts.serverMessage;
    this.datasetName = opts.datasetName;
  }
}

/**
 * The ADR-0112 `code` + `message` an analytics REST error body declares.
 *
 * ONE url, TWO declared producers — which is why this reads two SHAPES, and why
 * it is not the tolerant `body.error?.code ?? body.error` chain that
 * `@objectstack/core`'s `anonymous-deny.ts` explicitly warns consumers off:
 *
 *  - **flat** `{ code, message }` — everything the route writes itself in
 *    `@objectstack/rest`'s `registerAnalyticsEndpoints` (`501 NOT_IMPLEMENTED`
 *    when no analytics service provides `queryDataset`, `404 NOT_FOUND` for an
 *    unknown `datasetName`, `400 VALIDATION_FAILED`, `500
 *    ANALYTICS_QUERY_FAILED`), plus `enforceAuth`'s `401` `ANONYMOUS_DENY_BODY`
 *    — `{ error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED', message: … }`,
 *    where `error` carries the CODE as a string.
 *  - **wrapped** `{ success: false, error: { code, message } }` — what answers
 *    when this route is not mounted at all: `@objectstack/runtime`'s dispatcher
 *    `404 ROUTE_NOT_FOUND`. The REST auth-gate `403` (`{ error: { code,
 *    message } }`) is the same shape.
 *
 * Both envelopes are live and sanctioned (ADR-0112's 2026-07-30 amendment
 * records the flat and wrapped families as the two live ones and assigns
 * converging them to the envelope-convergence line). Reading both here is not a
 * consumer inventing leniency: this ONE request genuinely has two possible
 * producers, and which one answered is itself part of the signal — the wrapped
 * `ROUTE_NOT_FOUND` means the route is absent, and only the route's own flat
 * envelope can mean the dataset is.
 *
 * They are told apart STRUCTURALLY — `typeof body.error === 'object'` — never
 * by trying one key and falling through to the other. A producer that regresses
 * its envelope therefore reads as "no code" here, which is the honest answer
 * and lands in the residual below, instead of being quietly absorbed.
 *
 * `message` is DISPLAY ONLY and never feeds classification. That split is what
 * makes the objectui#5663 contradiction structurally impossible: the headline
 * is a pure function of `code`, the parenthetical is a verbatim quote of
 * `message`, and both are read off the SAME response. If they ever disagree the
 * producer has a bug — whereas under the old mapping the CONSUMER did, because
 * the headline came from a status two conditions share while the quote came
 * from the one that had actually happened.
 */
function readAnalyticsErrorEnvelope(body: unknown): { code?: string; message?: string } {
  if (!body || typeof body !== 'object') return {};
  const flat = body as { code?: unknown; message?: unknown; error?: unknown };
  const wrapped =
    flat.error && typeof flat.error === 'object'
      ? (flat.error as { code?: unknown; message?: unknown })
      : undefined;
  const source = wrapped ?? flat;
  const code = typeof source.code === 'string' && source.code.length > 0 ? source.code : undefined;
  // Display-only fallback: the flat family's `error` key carries the MESSAGE in
  // some producers (`{ code: 'ANALYTICS_QUERY_FAILED', error: <text> }`) and the
  // CODE in others (`ANONYMOUS_DENY_BODY`). Harmless here precisely because
  // nothing downstream classifies on it — at worst the parenthetical quotes a
  // code string, which is still the server's own words about its own answer.
  const message =
    typeof source.message === 'string' && source.message.length > 0 ? source.message
    : typeof flat.error === 'string' && flat.error.length > 0 ? flat.error
    : undefined;
  return { code, message };
}

/**
 * Statuses that identify a condition ON THEIR OWN when the answer carries no
 * ADR-0112 `code` at all — a bare transport 404/501 from a proxy, a gateway, or
 * a host that never mounted the API, none of which any ObjectStack route wrote.
 *
 * NOT a re-entry for status-mapping (objectui#5663 exists because of it): these
 * are consulted only AFTER every code branch has declined, i.e. only when there
 * is no contract field to read at all. `404` is safe HERE and unsafe as a
 * primary test for exactly the same reason — the route's own `NOT_FOUND` always
 * ships a `code`, so a 404 WITHOUT one cannot be the unknown-dataset case.
 */
const ANALYTICS_ABSENT_STATUSES: readonly number[] = [404, 501];

/**
 * Thrown when the server REJECTED the analytics query body (HTTP 400 —
 * `VALIDATION_FAILED` since framework#4010 validates `/analytics/query` at the
 * entry against the canonical bare `AnalyticsQuery` shape).
 *
 * Distinct from {@link AnalyticsNotInstalledError} on purpose: this one is a
 * defect in what WE sent, so it must never be answered with the client-side
 * fallback. Numbers produced by a different code path would look plausible and
 * bury the contract violation — the misdirection framework#3878 documented.
 */
export class AnalyticsQueryRejectedError extends Error {
  readonly code = 'ANALYTICS_QUERY_REJECTED';
  /** The server's own error code (e.g. `VALIDATION_FAILED`), when it sent one. */
  readonly serverCode?: string;
  constructor(detail?: string, serverCode?: string) {
    super(
      `Analytics rejected the query: ${detail ?? 'the request body does not match the AnalyticsQuery contract'}`,
    );
    this.name = 'AnalyticsQueryRejectedError';
    this.serverCode = serverCode;
  }
}

/**
 * Thrown by `aggregate()` when `client.analytics.query` resolves to anything
 * other than the post-unwrap `AnalyticsResult` — concretely, when the value it
 * hands back has no `rows` array (objectui#7028).
 *
 * ONE SPELLING, BY RULING. `@objectstack/client` 17.3.0 converged
 * `analytics.query` on `unwrapResponse` (objectstack#13079, maintainer ruling
 * 2026-08-31, option A): the method resolves to the payload, and the caller
 * reads `result.rows`. The same ruling ordered this adapter's tolerant row
 * ladder tightened in the same wave, so that defensive code is not read as a
 * contract. The ladder also read a bare array, `data` as an array,
 * `data.data.rows` and `results`; `rows` is now the only spelling read, and
 * everything else lands here.
 *
 * WHY A THROW AND NOT `[]`. The ladder answered every shape it did not
 * recognise with an empty array, and an empty array is a RESULT: a KPI renders
 * a confident zero and a chart reads "no data" over a populated table — the
 * lie objectui#5954 removed on the failure side. The envelope arriving here
 * means the SDK in front of this call predates the convergence (it is older
 * than 17.3.0), or something between it and `POST /analytics/query` wraps the
 * payload a second time. Either way the adapter is handed a contract it no
 * longer reads, and saying so is the only answer that names the repair.
 *
 * WHY NOT THE CLIENT-SIDE FALLBACK. Analytics answered; this is not a
 * transport failure. Degrading would put plausible numbers from a different
 * code path over a contract violation — the misdirection
 * {@link AnalyticsQueryRejectedError} refuses for the same reason
 * (framework#3878) — so `aggregate()`'s catch rethrows this before it
 * classifies anything.
 */
export class AnalyticsResultShapeError extends Error {
  readonly code = 'ANALYTICS_RESULT_SHAPE_INVALID';
  /** The object `aggregate()` was called for. */
  readonly resource: string;
  /**
   * True when the value is the envelope the client stopped handing back at
   * 17.3.0 — `{ success, data: { rows } }`, or its `{ data: { rows } }` core.
   */
  readonly envelope: boolean;
  /** What the value was, so the producer is identifiable from a log. */
  readonly received: string;
  constructor(resource: string, result: unknown) {
    const value = result as { data?: { rows?: unknown } } | null | undefined;
    const envelope = Array.isArray(value?.data?.rows);
    const received =
      result === null ? 'null'
      : Array.isArray(result) ? 'an array'
      : typeof result !== 'object' ? typeof result
      : `an object with keys [${Object.keys(result as object).join(', ')}]`;
    super(
      envelope
        ? `aggregate('${resource}'): client.analytics.query resolved to the `
          + '`{ data: { rows } }` envelope, not to an AnalyticsResult. '
          + '@objectstack/client resolves this method to the payload itself '
          + 'since 17.3.0 (objectstack#13079), and this adapter reads `rows` '
          + 'only: an older client is installed beside it, or something between '
          + 'the client and POST /analytics/query wraps the payload a second '
          + 'time. Install @objectstack/client 17.3.0 or later.'
        : `aggregate('${resource}'): client.analytics.query resolved to `
          + `${received}, which has no \`rows\` array, so it is not an `
          + 'AnalyticsResult. This adapter reads `rows` only (objectui#7028).',
    );
    this.name = 'AnalyticsResultShapeError';
    this.resource = resource;
    this.envelope = envelope;
    this.received = received;
  }
}

/**
 * Classify a FAILED analytics call so the caller knows whether to degrade or
 * to surface the failure.
 *
 * `@objectstack/client`'s fetch wrapper throws on a non-2xx, decorating the
 * error with the semantic `code` string and the numeric `httpStatus` (the
 * ADR-0112 / framework#3842 shape this repo already reads elsewhere).
 *
 * ## The `code` is the contract; the status is a transport fact (objectui#5721)
 *
 * What stood here tested `status === 404 || status === 501` BEFORE the code
 * operands that followed them, so the status short-circuited every one of
 * them: any 404 on this face was `not-installed` whatever code it carried, and
 * `NOT_IMPLEMENTED` / `ROUTE_NOT_FOUND` were unreachable for the very
 * conditions they name. Three unrelated conditions answer 404 on this url —
 *
 *   route absent    404 `ROUTE_NOT_FOUND`  (runtime dispatcher, framework#4019)
 *   cube unknown    404 `CUBE_NOT_FOUND`   (service-analytics' inference gate)
 *   object unknown  404 `OBJECT_NOT_FOUND` (the `/data` fallback's own answer)
 *
 * — so a misspelled cube read as "this deployment has no analytics", told the
 * operator to install a server plugin, and re-answered the chart from a
 * different code path. Same defect as objectui#5663, arrived at from the other
 * direction: the mapping read a field it did not quote. Branch on the `code`;
 * consult the status only as a residual, when the answer declared no code at
 * all. Comparisons go through `errorCodeIs`/`errorCodeIsAnyOf` — the pre- and
 * post-ADR-0112 spellings both have to match (`@object-ui/types`).
 *
 * ### Both envelope families reach this function already decorated (MEASURED)
 *
 * `/analytics/query` exits through `@objectstack/runtime`'s
 * `dispatcher-plugin.errorResponseBase`, i.e. the **wrapped** `{ success:
 * false, error: { code, message } }` shape — not the flat one the dataset
 * route writes — and its 401 is `enforceAuth`'s **flat** `ANONYMOUS_DENY_BODY`.
 * The client's fetch wrapper flattens BOTH before throwing:
 * `errorBody?.code ?? errorBody?.error?.code` → `error.code`, plus
 * `error.httpStatus = res.status`. So no envelope reading belongs here; unlike
 * `queryDataset` (which owns its `fetch` and must read the body itself), this
 * function is handed the already-flattened error and reads one field.
 *
 * ## Each branch names ONE of the three outcomes the caller can take
 *
 *   - **`not-installed`** — *degrade LOUDLY*. The deployment has no analytics
 *     service: 501 `NOT_IMPLEMENTED` (route mounted, nothing behind it) or 404
 *     `ROUTE_NOT_FOUND` (framework#4019 stops mounting the routes at all).
 *     A client-side aggregate over a scoped `find()` answers the chart
 *     correctly, and the operator is told once that the semantic layer is off.
 *   - **`rejected`** — *THROW*. The server refused OUR body: 400
 *     `VALIDATION_FAILED` (framework#4010 validates `/analytics/query` at the
 *     entry) OR any other coded 400 (objectui#7755 — e.g. `service-analytics`
 *     ships its own 400 `INVALID_FILTER` on a filter shape it refuses). The
 *     status alone is decisive once it is 400: a producer that refuses the
 *     body and ships a code this consumer does not enumerate is refusing it
 *     exactly as hard as one that ships `VALIDATION_FAILED` — the refusal is
 *     in the transport fact, not in which code spells it. Degrading would
 *     answer our own contract violation with plausible numbers from a
 *     different code path (`find()`'s `$filter` accepts array shapes the
 *     analytics body does not) and bury it — the misdirection framework#3878
 *     documented.
 *   - **`unauthenticated`** — *THROW*. 401 `UNAUTHENTICATED`: the request was
 *     refused before it ran, so it is evidence about the SESSION and none at
 *     all about the capability. Degrading is not merely misleading here, it is
 *     futile: the fallback's `find()` carries the same lapsed token and is
 *     refused the same way, so the chart cannot be answered either. "Sign in
 *     again" is an action; "install @objectstack/service-analytics" is not.
 *   - **`cube-not-found`** — *THROW*. 404 `CUBE_NOT_FOUND`
 *     (`analytics-service.assertInferableCube`, framework#3867): analytics IS
 *     installed and answering — the NAME does not exist. That gate throws only
 *     when the name is neither a registered cube nor a registered object, and
 *     the fallback asks `/data/<the same name>`, which objectql's
 *     `assertObjectRegistered` (framework#3770) answers 404 `OBJECT_NOT_FOUND`.
 *     So degrading cannot produce numbers; it can only swap a message that
 *     names the fix ("Define a Cube in your stack, or check the object name")
 *     for a distant one, behind a warning that instructs the wrong repair.
 *   - **`unknown`** — *degrade SILENTLY*. Anything else (5xx, network, a code
 *     this consumer does not know): a transient failure, not a deployment
 *     missing a capability and not a request that named something absent.
 */
export function classifyAnalyticsFailure(
  error: unknown,
): {
  kind: 'not-installed' | 'rejected' | 'unauthenticated' | 'cube-not-found' | 'unknown';
  code?: string;
  message?: string;
} {
  const err = (error ?? {}) as Record<string, unknown>;
  // An empty-string `code` is "the producer declared nothing", not a code —
  // otherwise it would block the residual below while matching no branch.
  const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : undefined;
  const message = typeof err.message === 'string' ? err.message : undefined;
  const status =
    typeof err.httpStatus === 'number' ? err.httpStatus
    : typeof err.status === 'number' ? err.status
    : typeof err.statusCode === 'number' ? err.statusCode
    : undefined;

  // ① The capability really is absent, from either of its two producers.
  if (errorCodeIsAnyOf({ code }, ['NOT_IMPLEMENTED', 'ROUTE_NOT_FOUND'])) {
    return { kind: 'not-installed', code, message };
  }

  // ② The server refused the body WE sent.
  if (errorCodeIs({ code }, 'VALIDATION_FAILED')) return { kind: 'rejected', code, message };

  // ③ The request never ran — the session is anonymous or its token lapsed.
  if (errorCodeIs({ code }, 'UNAUTHENTICATED')) return { kind: 'unauthenticated', code, message };

  // ④ Analytics answered; the cube this query named is the thing that is missing.
  if (errorCodeIs({ code }, 'CUBE_NOT_FOUND')) return { kind: 'cube-not-found', code, message };

  // ⑤ A FLOOR beneath the four code branches above, not a fifth alongside them:
  //   any 400 is a refusal of the body WE sent, whether or not its code is one
  //   of the ones this function happens to enumerate (objectui#7755). Reading
  //   the status only in the code-less residual below let a coded-but-
  //   unrecognized 400 — `service-analytics` ships 400 `INVALID_FILTER` on a
  //   filter shape it refuses — fall through this whole ladder to `unknown`,
  //   and `aggregate()`'s catch has no `unknown` arm, so it silently answered
  //   the refusal with `aggregateViaFind`'s client-side numbers instead of
  //   throwing `AnalyticsQueryRejectedError`. This branch never fires for a
  //   400 the branches above already claimed more specifically — none of ①-④
  //   test the status, so none of them can be shadowed by moving this earlier.
  if (status === 400) return { kind: 'rejected', code, message };

  // ⑥ Residual — the answer declared NO ADR-0112 code, so no ObjectStack route
  //   wrote it (a proxy, a gateway, a host with no API mounted). Only here is
  //   the bare status the best signal available, and only because every code
  //   branch has already declined: this face's own 404s all ship a `code`, so a
  //   code-less 404 cannot be the unknown-cube case. (The 400 case that used to
  //   live here moved up to ⑤ so it applies whether or not a code is present;
  //   this residual would never have reached it anyway once ⑤ runs first.)
  if (code === undefined) {
    if (status !== undefined && ANALYTICS_ABSENT_STATUSES.includes(status)) {
      return { kind: 'not-installed', code, message };
    }
    if (status === 401) return { kind: 'unauthenticated', code, message };
  }

  return { kind: 'unknown', code, message };
}

/**
 * Thrown by `update()` / `delete()` when the server returns
 * `409 CONCURRENT_UPDATE` — i.e. the record was modified by someone else
 * between when the caller last read it and when they attempted to write.
 *
 * The error carries the current server-side `updated_at` version and the
 * full latest record so the UI can render an informed conflict-resolution
 * dialog (typically "Reload latest" / "Overwrite anyway" / "Cancel").
 *
 * Mirrors the {@link ConcurrentUpdateError} thrown by
 * `@objectstack/objectql`'s protocol; the wire shape is:
 * ```json
 * { "code": "CONCURRENT_UPDATE",
 *   "error": "<message>",
 *   "currentVersion": "<updated_at>",
 *   "currentRecord": { ...latest... } }
 * ```
 */
export class ConcurrentUpdateError extends Error {
  readonly code = 'CONCURRENT_UPDATE';
  readonly httpStatus = 409;
  readonly currentVersion: string | null;
  readonly currentRecord: unknown;
  /**
   * The refusal text the PRODUCER marked as addressed to the end user
   * (`ApiErrorSchema.userMessage`, objectstack `79c46da90`), or `null` when the
   * refusal carried no marking.
   *
   * Declared on the class because this error has no `details` bag: the shared
   * reader (`declaredUserMessage` in `@object-ui/react`) looks at the
   * top-level field first, so parking it here is what makes the marking
   * readable at the surface. The contract is status-agnostic — a 409 carries
   * it exactly like a 400 or a 403 does.
   */
  readonly userMessage: string | null;
  constructor(opts: {
    currentVersion: string | null;
    currentRecord: unknown;
    message?: string;
    userMessage?: string | null;
  }) {
    super(opts.message ?? 'Record was modified by another user');
    this.name = 'ConcurrentUpdateError';
    this.currentVersion = opts.currentVersion;
    this.currentRecord = opts.currentRecord;
    this.userMessage = opts.userMessage ?? null;
  }
}

/**
 * Detect "concurrent update" errors raised by the platform. The wire
 * shape is `409` + `code: 'CONCURRENT_UPDATE'`. The client surfaces
 * extra details on `error.details` (full response body).
 *
 * Accepts EITHER that wire `code` OR `name === 'ConcurrentUpdateError'`, and
 * reads `httpStatus` for neither. This paragraph exists because the doc used
 * to name only the wire shape, which left the `name` limb reading as drift
 * (objectui#6375). It is not drift: it is the deliberate cross-realm
 * duck-check — a host that bundles this package twice (or re-throws across a
 * worker boundary) ends up holding two copies of the class, `instanceof`
 * fails, and the `name` string is the only discriminator left. That host is out of tree by construction, so an in-repo
 * consumer census cannot see the case the limb was written for and is not
 * evidence against it; `@object-ui/plugin-form` and `@object-ui/plugin-detail`
 * each carry their own copy of the same two-limb check for adapters they must
 * not depend on.
 *
 * Deliberately WIDER than {@link normaliseClientError}'s re-wrap, which keys
 * on the wire `code` alone: an error carrying only the class name is
 * recognised here and passed through there. Both accepted sets are pinned in
 * `occ.test.ts`.
 */
export function isConcurrentUpdateError(error: unknown): error is ConcurrentUpdateError {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return e.code === 'CONCURRENT_UPDATE' || e.name === 'ConcurrentUpdateError';
}

/**
 * The one declared key this boundary carries, anchored to the contract rather
 * than to a string literal: `ApiError` is `z.input<typeof ApiErrorSchema>` in
 * `@objectstack/spec`, so a rename there fails this file at compile time
 * instead of silently going quiet. The same anchor `@object-ui/react`'s
 * reader uses.
 */
type MarkedRefusal = Pick<ApiError, 'userMessage'>;

/**
 * Lift the producer's user-facing marking off a client error.
 *
 * `userMessage` (`ApiErrorSchema.userMessage`, objectstack `79c46da90`) is the opt-in
 * channel an application author sets at throw time to say "this text is for
 * the end user". The contract states it **status-agnostic** — not a 403
 * special case, any refusal status may carry it — so this read is
 * deliberately gated on neither a status nor a code.
 *
 * Read from the same two places, under the same declared key, as the shared
 * reader `declaredUserMessage` in `@object-ui/react`: the error itself
 * (`@objectstack/client` lifts a marked body onto `err.userMessage`, from
 * either wire dialect) and `details`, which the client falls back to the WHOLE
 * response body — the identical pair the `fields[]` read below uses. The
 * predicate (non-empty after trimming, returned untrimmed) matches that reader
 * exactly, so a marking that survives this boundary is one the surface accepts.
 *
 * Deliberately not imported from `@object-ui/react`: that package depends on
 * THIS one, so the symbol cannot travel in this direction. The key is anchored
 * to the contract type rather than to either copy of the predicate.
 */
function liftUserMessage(
  e: Record<string, unknown>,
  details: Record<string, unknown>,
): MarkedRefusal['userMessage'] | null {
  if (typeof e.userMessage === 'string' && e.userMessage.trim()) return e.userMessage;
  if (typeof details.userMessage === 'string' && details.userMessage.trim()) {
    return details.userMessage;
  }
  return null;
}

/**
 * Convert any error thrown by the upstream client into a typed error when we
 * recognise its shape. Returns the original error untouched otherwise, so
 * callers can simply `throw normaliseClientError(err)` from their catch blocks.
 *
 * Two shapes are recognised:
 *   - `409` + `CONCURRENT_UPDATE` → {@link ConcurrentUpdateError};
 *   - `400` + `VALIDATION_FAILED` → {@link DataApiValidationError}, carrying the
 *     server's per-field entries so a form can mark the offending inputs
 *     instead of showing one undirected toast.
 *
 * Both re-wraps preserve the producer's `userMessage` marking (see
 * {@link liftUserMessage}). Re-wrapping used to drop it, which made the
 * marking unreadable at every surface downstream of this boundary — nothing
 * threw, the typed error was otherwise correct, and the user simply got a
 * generic string.
 */
export function normaliseClientError(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const e = error as Record<string, unknown>;
  // The client sets `details` to the parsed body's `details`, falling back to
  // the WHOLE body — and the validation envelope has no `details` key, so this
  // is where `fields[]` lands.
  const details = (e.details ?? {}) as Record<string, unknown>;
  // Status-agnostic on purpose: lifted before either branch decides a shape,
  // so a 400 and a 409 carry the marking identically.
  const userMessage = liftUserMessage(e, details);

  if (e.code === 'VALIDATION_FAILED' || e.name === 'ValidationError') {
    const rawFields = Array.isArray(details.fields)
      ? details.fields
      : Array.isArray((e as { fields?: unknown }).fields)
        ? ((e as { fields: unknown[] }).fields)
        : [];
    const validationErrors = rawFields
      .map((f) => {
        const rec = (f ?? {}) as Record<string, unknown>;
        const field = typeof rec.field === 'string' ? rec.field : undefined;
        if (!field) return null;
        const message =
          typeof rec.message === 'string' && rec.message.trim()
            ? rec.message
            : typeof rec.code === 'string'
              ? rec.code
              : '';
        return { field, message };
      })
      .filter((x): x is { field: string; message: string } => x !== null);

    return new DataApiValidationError(
      typeof e.message === 'string' ? e.message : 'Validation failed',
      validationErrors[0]?.field,
      validationErrors,
      // The marking rides the details bag exactly the way `fields` already
      // does, landing on `err.details.userMessage` — the second of the two
      // places the shared reader looks. Purely additive: `field`,
      // `validationErrors` and `fields` are untouched, so the per-field
      // marking a form already draws keeps working. Omitted entirely when
      // unmarked, so an unmarked refusal carries no empty key.
      userMessage === null ? { fields: rawFields } : { fields: rawFields, userMessage },
    );
  }

  // The wire `code` is the sole discriminator. A
  // `code !== 'CONCURRENT_UPDATE' && httpStatus !== 409` guard used to sit
  // directly above this line and could never decide an outcome: its condition
  // is strictly stronger, so everything it would have returned is returned
  // here anyway. Its `httpStatus !== 409` half advertised a second acceptance
  // path — a bare 409 still getting re-wrapped — that never existed, on the
  // one function whose whole job is deciding what gets re-wrapped
  // (objectui#6375). The truth table is pinned in `occ.test.ts`.
  if (e.code !== 'CONCURRENT_UPDATE') return error;
  return new ConcurrentUpdateError({
    currentVersion: typeof details.currentVersion === 'string' ? details.currentVersion : null,
    currentRecord: details.currentRecord ?? null,
    message: typeof e.message === 'string' ? e.message : undefined,
    userMessage,
  });
}

/**
 * Fold an @objectstack/client HTTP-failure `meta` bag into the log MESSAGE.
 *
 * The client already hands us everything worth knowing —
 * `logger.error("HTTP request failed", undefined, { method, url, status, error })`
 * — but it hands it as the THIRD argument. Everything that flattens a console
 * record to text (a headless/CDP console capture, a log shipper, a copied
 * DevTools line) keeps only the message and renders the rest as `[object
 * Object]` / `Object`, so a wall of failures carried no method, no URL and no
 * status: the reporter of objectui#4042 had to diff the network panel by hand
 * to find out that 30 red lines were all one benign pre-login burst.
 *
 * So the identifying fields go into the string itself, and the structured bag
 * is STILL passed alongside for DevTools to expand — text for the flatteners,
 * object for the inspectors, neither at the other's expense.
 *
 * Exported for tests. Returns `null` when `meta` carries none of the three
 * fields, so callers keep the original message rather than printing a husk.
 */
export function formatHttpFailureMessage(
  message: string,
  meta?: Record<string, any>,
): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const method = typeof meta.method === 'string' && meta.method ? meta.method : undefined;
  const url = typeof meta.url === 'string' && meta.url ? meta.url : undefined;
  const status =
    typeof meta.status === 'number'
      ? meta.status
      : typeof meta.statusCode === 'number'
        ? meta.statusCode
        : undefined;
  if (!method && !url && status === undefined) return null;

  // `code` is the ADR-0112 semantic error code. The client puts the parsed
  // body under `meta.error`; some call sites hoist the code to the top level.
  const errBody = meta.error && typeof meta.error === 'object' ? meta.error : undefined;
  const rawCode =
    (typeof meta.code === 'string' && meta.code) ||
    (errBody && typeof (errBody as Record<string, unknown>).code === 'string'
      ? ((errBody as Record<string, string>).code)
      : undefined);

  const parts = [method ?? 'GET', url ?? '<unknown url>'];
  parts.push(`-> ${status ?? 'no status'}`);
  if (rawCode) parts.push(`[${rawCode}]`);
  return `${message}: ${parts.join(' ')}`;
}

/**
 * Build a Logger compatible with @objectstack/client that (a) spells every
 * request failure out in the message — see {@link formatHttpFailureMessage} —
 * and (b) demotes expected 404 noise to console.debug. The client logs every
 * non-2xx response with
 * `logger.error("HTTP request failed", undefined, { method, url, status, error })`,
 * but 404s on optional collections (sys_presence, sys_activity, …) are part of
 * normal degraded operation when those plugins aren't installed on the
 * server — they should not surface as errors in the browser DevTools.
 *
 * NOTE the asymmetry, and keep it: 404-on-an-optional-collection is demoted
 * because it is an EXPECTED outcome of a request we still mean to make. No
 * other status is demoted — a 401 that survives the console's session gate
 * (objectui#4042: a mid-session expiry, say) is a real event and must stay a
 * visible, fully-identified error. The cure for doomed requests is not issuing
 * them, never hiding them once issued.
 *
 * Returned object is loosely typed because the spec's Logger interface lives
 * in a transitive package; using `any` keeps us decoupled.
 *
 * Exported so the console's log contract is testable, and so an app wiring its
 * own `ObjectStackClient` gets the same identified failures.
 */
export function createQuietHttpLogger(): any {
  const isExpected404 = (meta?: Record<string, any>): boolean => {
    if (!meta || typeof meta !== 'object') return false;
    if (meta.status === 404 || meta.statusCode === 404) return true;
    const errBody = meta.error;
    if (errBody && typeof errBody === 'object') {
      const code = (errBody as Record<string, unknown>).code;
      if (errorCodeIsAnyOf({ code }, ['OBJECT_NOT_FOUND', 'RECORD_NOT_FOUND'])) return true;
    }
    return false;
  };
  // objectui#4029 — this object IS the console binding for the spec Logger
  // interface, not leaked debug residue: every method here deliberately
  // forwards to the matching console.* method by design, so no-console's
  // blanket ban is disabled line-by-line for the methods outside its
  // warn/error allowlist.
  const logger: any = {
    debug: (message: string, meta?: Record<string, any>) =>
      // eslint-disable-next-line no-console -- objectui#4029, see comment above
      console.debug(message, meta ?? ''),
    info: (message: string, meta?: Record<string, any>) =>
      // eslint-disable-next-line no-console -- objectui#4029, see comment above
      console.info(message, meta ?? ''),
    warn: (message: string, meta?: Record<string, any>) =>
      console.warn(message, meta ?? ''),
    error: (message: string, error?: Error, meta?: Record<string, any>) => {
      if (isExpected404(meta)) {
        // eslint-disable-next-line no-console -- objectui#4029, see comment above
        console.debug(
          `[ObjectStack] ${formatHttpFailureMessage(message, meta) ?? message} (suppressed expected 404)`,
          meta,
        );
        return;
      }
      console.error(formatHttpFailureMessage(message, meta) ?? message, error ?? '', meta ?? '');
    },
    fatal: (message: string, error?: Error, meta?: Record<string, any>) =>
      console.error(formatHttpFailureMessage(message, meta) ?? message, error ?? '', meta ?? ''),
    // eslint-disable-next-line no-console -- objectui#4029, see comment above
    log: (message: string, ...args: any[]) => console.log(message, ...args),
    child: () => logger,
    withTrace: () => logger,
  };
  return logger;
}

/**
 * Connection state for monitoring. Declared once in `@object-ui/types`, which
 * `@object-ui/collaboration` re-exports too (objectui#6349, batch 10); this
 * package's entry keeps publishing it under the same name.
 */
export type { ConnectionState } from '@object-ui/types';

/**
 * Connection state change event
 */
export interface ConnectionStateEvent {
  state: ConnectionState;
  timestamp: number;
  error?: Error;
}

/**
 * Batch operation progress event
 */
export interface BatchProgressEvent {
  operation: 'create' | 'update' | 'delete';
  total: number;
  completed: number;
  failed: number;
  percentage: number;
}

/**
 * Event listener type for connection state changes
 */
export type ConnectionStateListener = (event: ConnectionStateEvent) => void;

/**
 * Event listener type for batch operation progress
 */
export type BatchProgressListener = (event: BatchProgressEvent) => void;

/**
 * One server-reported write-strip: caller-supplied fields the backend LEGALLY
 * removed from a write before persisting (a non-system caller cannot seed a
 * `readonly` field, a `readonlyWhen` predicate locked it, etc.).
 *
 * THE spec type, re-exported (objectui#3160, objectstack#4115 ledger batch 6).
 * Until then this was a hand copy whose comment said it "mirrors the framework
 * `DroppedFieldsEvent` (spec `DroppedFieldsEventSchema`) structurally so we
 * don't pin a client type version", with `reason` widened from the spec's
 * `'readonly' | 'readonly_when'` to bare `string` "for forward-compatibility
 * with reasons added server-side". Both halves of that reasoning are the
 * failure mode this ledger exists to remove: the spec IS the client type
 * version, and a consumer-side widening of a producer's enum is precisely the
 * lenient fallback AGENTS.md #12 bans — it deletes the only compile-time signal
 * that would tell `AdapterProvider`'s toast wording (which branches on
 * `readonly_when`) that a new reason had appeared.
 */
export type { DroppedFieldsEvent };

/**
 * The `reason` values THIS bundle's `@objectstack/spec` pin declares, read off
 * `DroppedFieldsEventSchema` rather than restated (objectui#4934).
 *
 * Derived, so a pin bump that adds an arm widens the accept set here on its own
 * — the alternative is a hand list that silently classifies a brand-new spec
 * reason as skew, which is the same drift in the other direction.
 */
const RECOGNIZED_DROP_REASONS: ReadonlySet<unknown> = new Set<unknown>(
  DroppedFieldsEventSchema.shape.reason.options,
);

/**
 * The `reason` of a write-strip this bundle's spec pin cannot name
 * (objectui#4934).
 *
 * Deliberately NOT a spec spelling: it is namespaced so it can never collide
 * with an arm `@objectstack/spec` adds later (a collision would merge real
 * reasons into the skew bucket — the failure this whole card is about, one level
 * up). `droppedFieldsReason.boundary.test.ts` pins that the installed spec does
 * not declare it.
 */
export const UNRECOGNIZED_DROP_REASON = 'objectui:unrecognized-drop-reason';

/**
 * The skew arm: one server-reported write-strip whose `reason` is outside the
 * enum this bundle's `@objectstack/spec` pin declares (objectui#4934).
 *
 * A deployed client normally runs BEHIND the server it talks to, so a reason
 * from the future is the expected skew direction, not a corrupt payload. The
 * boundary used to assert such an entry into {@link DroppedFieldsEvent} on shape
 * alone — `reason` was never read — so the interior was typed to trust a union
 * nothing had checked, and the next consumer to write an exhaustive-looking
 * table over `DroppedFieldsEvent['reason']` would have been handed a value that
 * type says is impossible.
 *
 * Three properties of this shape are load-bearing:
 *
 * - The entry is **kept**. Dropping it would tell the user nothing about fields
 *   the server really did strip — precisely the silence objectui#3484 removed.
 * - The wire value is **preserved verbatim** in {@link unrecognizedReason},
 *   never coerced or normalised onto a known arm: claiming `readonly` for a
 *   reason we cannot name is a false statement about the user's data, and it is
 *   also unfalsifiable once the original value is gone.
 * - `reason` carries {@link UNRECOGNIZED_DROP_REASON}, which is not assignable
 *   to `DroppedFieldsEvent['reason']`. That is what makes the skew case visible
 *   to `tsc` at every consumer instead of resting on N per-consumer
 *   disciplines — and it keeps the spec type as the canonical arm rather than
 *   widening the whole surface to `string` (objectui#3160).
 */
export interface UnrecognizedDropReasonEvent {
  object?: string;
  fields: string[];
  reason: typeof UNRECOGNIZED_DROP_REASON;
  /** Whatever the server sent, untouched — including a non-string or nothing at all. */
  unrecognizedReason: unknown;
}

/**
 * One entry of a write-warning: either the spec type (canonical arm) or the
 * named skew arm above. Narrow with `entry.reason === UNRECOGNIZED_DROP_REASON`.
 */
export type DroppedFieldsNotice = DroppedFieldsEvent | UnrecognizedDropReasonEvent;

/**
 * A `droppedFields` entry as it comes OFF THE WIRE: everything a structural
 * check can honestly claim about it, and no more. Every field is `unknown`
 * until something parses it — writing `DroppedFieldsEvent` for any of them here
 * is the exact assertion objectui#4934 exists to delete.
 *
 * It used to be `Omit<DroppedFieldsEvent, 'reason'> & { reason?: unknown }`,
 * which was honest about `reason` and dishonest about the other two
 * (`f75810e7c`). `Omit` carried the spec's `fields: string[]` and its
 * REQUIRED `object: string` through untouched, while the structural gate below
 * read neither: `fields: [42]` and an entry with no `object` at all both passed
 * and reached subscribers typed as if they had been checked. Required is what
 * makes `object` a gap here, not what closes it — an optional `object` would
 * have had nothing to over-claim.
 *
 * So the declaration now states exactly what {@link isWireDroppedFieldsEntry}
 * establishes and nothing else, and {@link asDroppedFieldsNotice} PARSES the
 * rest. The published surface — {@link DroppedFieldsNotice},
 * {@link WriteWarningEvent} — is unchanged: a subscriber's `fields: string[]`
 * stays `string[]` and is now TRUE rather than asserted.
 */
type WireDroppedFieldsEntry = { object?: unknown; fields: unknown[]; reason?: unknown };

/** Whether the wire's `reason` is an arm the installed spec pin declares. */
function isRecognizedDropReason(reason: unknown): reason is DroppedFieldsEvent['reason'] {
  return RECOGNIZED_DROP_REASONS.has(reason);
}

/**
 * The structural gate: is this wire value an entry that names at least one
 * field?
 *
 * `fields` must be an array (so `unknown[]` is established) carrying at least
 * one string (so the parsed notice below names something). An array holding no
 * string at all — `fields: [42]`, `fields: []` — reports no field name, and an
 * entry that names no field has nothing truthful to tell the user; the
 * pre-`f75810e7c` gate already dropped the empty case for exactly that
 * reason, and this is the same rule one level deeper.
 *
 * `object` and `reason` are deliberately NOT gated on. Nothing is dropped for
 * them: both are parsed afterwards, so a missing `object` or an unnameable
 * `reason` still reaches the user as the warning it is (objectui#3484's
 * silence is the worse failure).
 */
function isWireDroppedFieldsEntry(e: unknown): e is WireDroppedFieldsEntry {
  return (
    !!e &&
    typeof e === 'object' &&
    Array.isArray((e as { fields?: unknown }).fields) &&
    ((e as { fields: unknown[] }).fields).some((f) => typeof f === 'string')
  );
}

/**
 * Parse ONE wire entry into a notice (objectui#4934, `f75810e7c`).
 *
 * Three parses, one per field the gate above does not establish, and the
 * result is built rather than asserted — so the last cast in this seam is gone:
 *
 * - **`reason`** — checked against the spec enum; anything the installed pin
 *   cannot name goes to the explicit skew arm with the wire value preserved
 *   verbatim in `unrecognizedReason` (objectui#4934).
 * - **`fields`** — narrowed to its string elements. Deliberately NOT given a
 *   skew arm like `reason`: a reason from the future is the EXPECTED direction
 *   of version skew, whereas `fields` is `z.array(z.string())` in the spec and
 *   cannot grow a non-string element without a breaking change. A non-string
 *   element is off-spec input, so the contract-first answer (AGENTS.md #0.1) is
 *   to refuse it here and fix the producer — not to invent a rendering for it.
 *   Measured on the one reader (`app-shell`'s `writeWarningToast`): today such
 *   an element degrades to a wrong label — `42`, `[object Object]`, `true`, or
 *   an empty entry for `null` — never a throw, which is why this is repaired as
 *   an honesty defect rather than a crash.
 * - **`object`** — taken from the wire when it is a string, otherwise from
 *   `fallbackObject`, which is the object the adapter just wrote to. That is
 *   not a lenient alias: the caller KNOWS the resource, and the batch path has
 *   always healed the same hole this way for the event's `resource`. Narrowing
 *   the gate on `object` instead would drop the entry — and no reader depends
 *   on it (`writeWarningToast` names fields off `WriteWarningEvent.resource`),
 *   so dropping would trade a silent user-facing warning for nothing.
 *
 * Extra server-sent keys still ride along: the spread preserves them, and only
 * the three parsed keys are rewritten.
 */
function asDroppedFieldsNotice(
  entry: WireDroppedFieldsEntry,
  fallbackObject: string,
): DroppedFieldsNotice {
  const fields = entry.fields.filter((f): f is string => typeof f === 'string');
  const object = typeof entry.object === 'string' ? entry.object : fallbackObject;
  if (isRecognizedDropReason(entry.reason)) {
    return { ...entry, object, fields, reason: entry.reason };
  }
  return {
    ...entry,
    object,
    fields,
    reason: UNRECOGNIZED_DROP_REASON,
    unrecognizedReason: entry.reason,
  };
}

/**
 * What the batch path writes for `object` / `resource` when the response did
 * not let it attribute the strip to an operation (objectui#7160).
 *
 * {@link ObjectStackAdapter.notifyBatchDroppedFields} resolves the object a
 * cross-object strip is about from the wire entry's own `object`, else from the
 * operation its `index` addresses. When the wire named no object AND the index
 * addresses no operation in the request WE sent, nothing is left to name it
 * with: the adapter knows every operation in its own batch, so an index outside
 * that list cannot be healed the way a missing `object` is healed on the
 * single-record path (there the fallback is the resource the caller passed in,
 * which is always a real name).
 *
 * REACHABILITY — only from a response that is off-spec twice over. The spec's
 * `CrossObjectBatchDroppedFieldsSchema` declares BOTH `object: z.string()` and
 * `index: z.number()` REQUIRED, and the batch response documents `results` as
 * index-aligned with the request's `operations`. A conformant server therefore
 * cannot produce this entry; it takes one that omits (or non-strings) `object`
 * AND sends an index naming no operation, in the same entry. Nothing in this
 * repo emits that shape, and whether a deployed backend does is not answerable
 * from here. Unlike the exotic case on the card behind `f75810e7c`, this is not structurally
 * impossible — the payload arrives as parsed JSON, and a non-conformant server
 * can send it.
 *
 * WHY THE ENTRY IS STILL EMITTED rather than refused. Measured end to end
 * through the real chain (`onWriteWarning` into `app-shell`'s
 * `emitWriteWarning`, with the real `t` and the real `fieldLabel`): the user
 * still gets the whole warning — the save acknowledgement, the field list and
 * the reason sentence — with fields named by their api key instead of their
 * label. Refusing the entry would replace a truthful, useful warning with
 * silence for a strip the server really did report, which is objectui#3484's
 * failure and the reason neither `object` nor `reason` is gated on above.
 *
 * WHY IT IS NOT WIDENED AWAY EITHER. Letting the notice say "no object" means
 * making `object` optional on {@link DroppedFieldsNotice}, whose canonical arm
 * IS the spec's `DroppedFieldsEvent` (objectui#3160). That writes "servers may
 * omit `object`" into our published client type to accommodate a producer
 * violating two REQUIRED spec fields — the lenient consumer-side fallback
 * AGENTS.md #0.1 bans, fossilising the producer's bug into a second de-facto
 * contract. The contract-first repair for an off-spec response is at the
 * producer.
 *
 * So this is neither the skew arm's "tolerate" (objectui#4934 — a `reason` from
 * the future is the producer running AHEAD of us, expected version skew) nor
 * `fields`' "refuse" (`f75810e7c` — an off-spec element that would otherwise
 * reach a consumer typed as a field name). There is no producer value to keep
 * or drop here: the question is only what WE write when the response supplied
 * nothing. The answer is a DECLARED placeholder rather than a bare literal that
 * reads as a name.
 *
 * IT MUST STAY FALSY, and that is why it is not exported. The sole consumer
 * (`app-shell`'s `writeWarningToast`, reached through `AdapterProvider`) gates
 * label resolution on `adapter && ev.resource`, so an empty resource skips the
 * schema lookup and names fields by their api key — the truthful fallback. A
 * namespaced sentinel like {@link UNRECOGNIZED_DROP_REASON} would be TRUTHFUL
 * but TRUTHY, and would send that consumer to `getObjectSchema('objectui:...')`
 * and `fieldLabel('objectui:...', ...)`. No consumer should branch on this
 * value's identity; the falsiness check is the whole correct handling, and
 * `droppedFieldsUnattributed.boundary.test.ts` pins both halves.
 */
const UNATTRIBUTED_STRIP_OBJECT = '';

/**
 * Emitted after a create/update whose response carried `droppedFields`
 * (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455) or
 * `warnings` (objectui#12107). The write SUCCEEDED — this is a warning that
 * some supplied fields never landed, or that an advisory validation rule hit,
 * so the UI can tell the user rather than let it pass silently. Subscribe via
 * {@link ObjectStackAdapter.onWriteWarning}.
 *
 * `droppedFields` is the two-arm {@link DroppedFieldsNotice} and not
 * `DroppedFieldsEvent[]`: the wire is parsed here, and an entry whose `reason`
 * this bundle's spec pin cannot name arrives on the explicit skew arm rather
 * than being asserted into the union (objectui#4934). It stays REQUIRED and is
 * an empty array when the event exists only for `warnings`.
 *
 * `warnings` is the write answer's own key, typed by the spec's
 * `ValidateDataIssueSchema` (the element of `CreateDataResponseSchema` /
 * `UpdateDataResponseSchema`'s `warnings`) and parsed through it here. It is
 * present only when at least one entry parsed: an answer without the key —
 * including one from a runtime that predates it — leaves the event exactly as
 * it was.
 */
export interface WriteWarningEvent {
  operation: 'create' | 'update';
  resource: string;
  id?: string | number;
  droppedFields: DroppedFieldsNotice[];
  warnings?: ValidateDataIssue[];
}

/** Event listener type for write-warning (dropped-fields) events. */
export type WriteWarningListener = (event: WriteWarningEvent) => void;

/**
 * Codes that mean THE DOOR IS NOT THERE — the deployment never mounted the
 * `/meta` route this read goes through, so no answer about the kind it names
 * exists to be had (objectui#7741).
 *
 * Both are the runtime dispatcher's own words, and both are already read this
 * way one face over by {@link classifyAnalyticsFailure} for the same question:
 * `ROUTE_NOT_FOUND` (framework#4019 stops mounting a route at all) and
 * `NOT_IMPLEMENTED` (the route is mounted with nothing behind it).
 *
 * ⚠️ Neutrally named because it is a fact about the PLATFORM's dispatcher, not
 * about any one metadata kind, and both classifiers below now read it
 * ({@link classifyImportMappingsFailure}, {@link classifyViewsFailure}). One
 * platform fact, one spelling — a per-kind copy of the same two codes would be
 * a second dialect for one condition, which is what drifts (objectui#8151).
 */
const META_ROUTE_ABSENT_CODES = ['ROUTE_NOT_FOUND', 'NOT_IMPLEMENTED'] as const;

/**
 * The code the metadata LIST door answers with when `:type` names a kind this
 * deployment cannot serve (framework#9488 `refuseUnknownMetaListType`, in
 * `packages/rest/src/rest-server.ts`), paired with the status it ships it on.
 *
 * `mapping` became a declared kind only when the ADR-0088 admission test
 * accepted it (framework#2611; `metadata-plugin.zod.ts` lists it today), so a
 * server older than that promotion has it in neither the static contract nor
 * its live type set, and this is the refusal such a server writes. It is the
 * modern spelling of exactly the condition this method's docblock has always
 * promised to keep quiet — an older server without the `mapping` kind. (An
 * even older one, predating framework#9488, answered `200 {"items":[]}` and so
 * never reaches a `catch` at all; older still, with no `/meta` route, answers
 * on {@link META_ROUTE_ABSENT_CODES}.)
 *
 * ⛔ Deliberately NOT neutralized alongside its four siblings: this pair is the
 * one arm that is about the `mapping` kind SPECIFICALLY, and it is exactly the
 * arm {@link classifyViewsFailure} must not carry over — see that function's
 * reading for why the same shape on `view` cannot mean this (objectui#8151).
 *
 * Matched on the code AND the status together, deliberately narrower than the
 * code alone. `INVALID_REQUEST` is a general-purpose catalog code; what makes
 * it readable as "this kind is not served" HERE is that this request carries
 * nothing else to be invalid — `GET /meta/mapping`, no body, no query, one
 * path segment we chose. Requiring the 400 keeps the quiet arm keyed to the
 * one shape the framework documents rather than to a code that could arrive on
 * some other door's terms.
 */
const IMPORT_MAPPINGS_UNKNOWN_KIND_CODE = 'INVALID_REQUEST';
const IMPORT_MAPPINGS_UNKNOWN_KIND_STATUS = 400;

/**
 * Statuses that identify absence ON THEIR OWN when the answer carried no
 * ADR-0112 `code` at all — a bare transport 404/501 from a proxy, a gateway,
 * or a host that never mounted the API, none of which any ObjectStack route
 * wrote.
 *
 * NOT a re-entry for status-mapping: consulted only AFTER every code branch
 * has declined, i.e. only when there is no contract field to read. Same
 * residual, same reason, as {@link ANALYTICS_ABSENT_STATUSES} — this door's own
 * 404s all ship a `code`, so a code-less 404 cannot be a refusal it wrote.
 *
 * Neutrally named for the reason {@link META_ROUTE_ABSENT_CODES} records: a
 * code-less 404/501 is a fact about the HOST, identical whichever kind the URL
 * named, and both classifiers read it.
 */
const META_ABSENT_STATUSES: readonly number[] = [404, 501];

/**
 * Codes that mean the server ANSWERED and declined this caller. A fact about
 * the SESSION, not about any kind — read by both classifiers.
 */
const META_REFUSAL_CODES = ['UNAUTHENTICATED', 'PERMISSION_DENIED'] as const;

/**
 * Statuses that are a refusal on their own terms, whatever code rides them.
 * Also session-scoped, also shared.
 */
const META_REFUSAL_STATUSES: readonly number[] = [401, 403, 405];

/**
 * What a FAILED `listImportMappings` read actually was (objectui#7741).
 *
 *  - `not-served` — this deployment does not serve the `mapping` kind, or has
 *    no `/meta` door at all. QUIET: a real, supported deployment shape, and the
 *    empty list plus a hidden selector is the correct rendering of it.
 *  - `refused` — the server answered and declined THIS caller: anonymous,
 *    lapsed token, missing permission, method withheld. LOUD, and the remedy
 *    names a person: sign in again, or ask for the grant.
 *  - `unreadable` — the read could not be completed for any other reason: a
 *    5xx, a network failure, a code this consumer cannot name. LOUD, and the
 *    remedy is to retry or report.
 *
 * The last two are the same verdict for the user — *we could not find out* —
 * and they are separated because the sentence that helps differs. What they
 * share is what matters: neither is evidence that no mapping is registered.
 *
 * ⚠️ The three NAMES are shared by every classifier feeding
 * {@link MetadataReadWarningEvent}; the POPULATION each name covers is not, and
 * is decided per read door. `not-served` in particular is a strictly smaller
 * set on `view` than on `mapping` — see {@link classifyViewsFailure}.
 */
export type MetadataReadFailureKind = 'not-served' | 'refused' | 'unreadable';

/**
 * The published spelling of {@link MetadataReadFailureKind}, kept as the name
 * objectui#7741 shipped (`@object-ui/data-objectstack@17.2.0`).
 *
 * An ALIAS, not a second declaration: identical members, so every existing
 * consumer's assignability is unchanged in both directions. It was renamed
 * because the channel gained a second emitter (objectui#8151) and a type called
 * `ImportMappingsFailureKind` describing a `view` read would be a name that
 * lies; the old name stays because retiring a published one is not this card's
 * business.
 */
export type ImportMappingsFailureKind = MetadataReadFailureKind;

/**
 * Classify a FAILED `meta.getItems('mapping')` call so the caller knows whether
 * to stay quiet or to say something (objectui#7741).
 *
 * ## Why this function exists
 *
 * `listImportMappings` degrades every failure to `[]`, and the wizard hides its
 * saved-mapping selector on an empty list. So "the server served zero mappings"
 * and "the server never answered" rendered identically — the same UI, on every
 * deployment, with a `console.warn` as the only discriminator. That silence did
 * not merely hide a fault: it produced a confident WRONG diagnosis in a careful
 * reporter (objectstack#14026 was filed, routed and worked by two seats against
 * a repo whose wizard had been correct since `@object-ui/data-objectstack`
 * 17.1.0), and the misdiagnosis travelled further than the fault would have.
 *
 * This is the discrimination framework objectstack#13906 decision 1 option A already
 * adopted at the tenancy-posture seam — *a thing that could not be READ is not
 * a thing that is ABSENT* — applied here. It is not a new principle.
 *
 * ## It reads the ERROR, never the result
 *
 * The one thing this must never do is decide from "is the result an empty
 * array". An empty array is what BOTH conditions produce, so a test on it can
 * never fail and can never separate *served zero* from *did not serve* — a
 * reading that cannot fail is indistinguishable from a reading that passed.
 * Every branch below reads `err` itself: the ADR-0112 `code` first (the
 * contract), the status only where no code was declared (a transport fact many
 * conditions share). Same rule, same order, and for the same reasons as
 * {@link classifyAnalyticsFailure} (objectui#5663 / objectui#5721).
 *
 * `@objectstack/client`'s fetch wrapper hands both envelope families here
 * already flattened — `errorBody?.code ?? errorBody?.error?.code` onto
 * `error.code`, plus `error.httpStatus = res.status` — so no envelope reading
 * belongs in this function. Comparisons go through `errorCodeIs`/
 * `errorCodeIsAnyOf` so the pre- and post-ADR-0112 spellings both match.
 */
export function classifyImportMappingsFailure(error: unknown): {
  kind: ImportMappingsFailureKind;
  code?: string;
  status?: number;
  message?: string;
} {
  const err = (error ?? {}) as Record<string, unknown>;
  // An empty-string `code` is "the producer declared nothing", not a code —
  // otherwise it would block the code-less residual while matching no branch.
  const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : undefined;
  const message = typeof err.message === 'string' ? err.message : undefined;
  const status =
    typeof err.httpStatus === 'number' ? err.httpStatus
    : typeof err.status === 'number' ? err.status
    : typeof err.statusCode === 'number' ? err.statusCode
    : undefined;
  const found = { code, status, message };

  // ① The `/meta` door itself is absent — nothing here can be asked at all.
  if (errorCodeIsAnyOf({ code }, META_ROUTE_ABSENT_CODES)) {
    return { kind: 'not-served', ...found };
  }

  // ② The door is there and says this deployment carries no such kind.
  if (
    errorCodeIs({ code }, IMPORT_MAPPINGS_UNKNOWN_KIND_CODE) &&
    status === IMPORT_MAPPINGS_UNKNOWN_KIND_STATUS
  ) {
    return { kind: 'not-served', ...found };
  }

  // ③ The server answered and declined this caller.
  if (errorCodeIsAnyOf({ code }, META_REFUSAL_CODES)) {
    return { kind: 'refused', ...found };
  }
  if (status !== undefined && META_REFUSAL_STATUSES.includes(status)) {
    return { kind: 'refused', ...found };
  }

  // ④ Residual — the answer declared NO ADR-0112 code, so no ObjectStack route
  //   wrote it (a proxy, a gateway, a host with no API mounted). Only here is
  //   the bare status the best signal available, and only because every code
  //   branch has already declined.
  if (
    code === undefined &&
    status !== undefined &&
    META_ABSENT_STATUSES.includes(status)
  ) {
    return { kind: 'not-served', ...found };
  }

  // ⑤ Everything else could not be read, and an unreadable answer is not an
  //   empty one. Deliberately NOT a silent bucket: this is where a 500, a
  //   dropped connection and a code this consumer cannot name all land, and
  //   none of them is evidence that no mapping is registered.
  return { kind: 'unreadable', ...found };
}

/**
 * Classify a FAILED `view` metadata list read so {@link ObjectStackAdapter.listViews}
 * knows whether to stay quiet or to say something (objectui#8151).
 *
 * ## Why this is a SEPARATE reading and not a second caller of
 * {@link classifyImportMappingsFailure}
 *
 * The two methods share a defect and a remedy, not a population. The quiet arm
 * `listImportMappings` is built around — *an older server that does not serve
 * this kind* — has no members on `view`, and carrying it over would put a fresh
 * swallow into the method this card exists to un-swallow. Measured, on the
 * framework tree, three ways:
 *
 *  1. **`view` is in the platform's static spelling contract**, so the metadata
 *     LIST door's unknown-kind refusal is unreachable for it.
 *     `RestServer.refuseUnknownMetaListType` (framework#9488,
 *     `packages/rest/src/rest-server.ts`) returns without writing a refusal
 *     whenever `unrecognisedMetaTypeRefusal(urlType)` is `null`, and that
 *     predicate answers `null` for every spelling in the contract.
 *     `packages/spec/src/meta-spelling/meta-url-data.generated.ts` carries both
 *     `"views": "view"` and the canonical singular `view`. So a `400`
 *     `INVALID_REQUEST` on `GET /meta/view` is NEVER that door saying "this
 *     deployment carries no such kind" — it is some other refusal of the
 *     request, and reading it as kind-absence would silence a real one.
 *  2. **There is no "before" for `view` to be older than.** `mapping`'s quiet
 *     arm exists because `mapping` was PROMOTED into the declared set
 *     (framework#2611), so servers predating the promotion are a real, shipped
 *     population. `view` is the kind the metadata surface is built around — the
 *     compound-arity door `/meta/<object>/views/<name>`, the ADR-0017
 *     `ViewItem` discriminant this very method filters on.
 *  3. **A deployment that cannot serve `view` cannot render the caller.**
 *     `listViews` is reached only from `ObjectView`, whose `objectDef` came from
 *     `MetadataProvider`, which reads the SAME door and lists `view` among its
 *     `EAGER_TYPES` at mount (`packages/app-shell/src/providers/MetadataProvider.tsx`).
 *     A server that does not answer `/meta/view` has already failed that read
 *     before any object page exists.
 *
 * ## So the quiet set here is strictly SMALLER — it is the DOORLESS one only
 *
 * What survives as quiet is not about `view` at all: it is *this host mounted no
 * metadata door*. That stays silent for the reason objectui#7741 gave — a real,
 * supported deployment shape must not be turned into a visible fault — and it
 * costs nothing to keep silent here, because such a host has already failed
 * `MetadataProvider`'s eager `app`/`object`/`view` reads; a per-object toast
 * would be a fourth voice on one deployment fact, not a new one.
 *
 * Everything else is LOUD. In particular a `refused` (401/403/405,
 * `UNAUTHENTICATED`, `PERMISSION_DENIED`) is the condition this card was filed
 * for: a token that lapsed mid-session renders the object's view switcher as
 * though the user's own saved views did not exist.
 *
 * ## It reads the ERROR, never the result — and from BOTH of this method's doors
 *
 * `listViews` is fed by two transports, unlike its sibling's one, and they
 * decorate differently:
 *
 *   published  `client.meta.getItems('view')` -> `@objectstack/client`'s fetch
 *              wrapper: `error.code` (flattened from either envelope family)
 *              plus `error.httpStatus`.
 *   drafts     `MetadataClient.withPreviewDrafts(true).list('view')` (ADR-0037,
 *              `?preview=draft`) -> this package's own `parseError`:
 *              `err.code` plus **`err.status`**, with no `httpStatus` at all.
 *
 * The status ladder below therefore reads `httpStatus`, then `status`, then
 * `statusCode`, and is the reason a preview-mode failure classifies the same as
 * a published-mode one instead of falling through to the code-less residual.
 * What it must never read is "is the result an empty array": that is what BOTH
 * a served-zero and a refusal produce, so a test on it can never fail for the
 * condition it is supposed to be about. This is framework objectstack#13906 decision 1
 * option A — *a thing that could not be READ is not a thing that is ABSENT*.
 */
export function classifyViewsFailure(error: unknown): {
  kind: MetadataReadFailureKind;
  code?: string;
  status?: number;
  message?: string;
} {
  const err = (error ?? {}) as Record<string, unknown>;
  // An empty-string `code` is "the producer declared nothing", not a code —
  // otherwise it would block the code-less residual while matching no branch.
  const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : undefined;
  const message = typeof err.message === 'string' ? err.message : undefined;
  const status =
    typeof err.httpStatus === 'number' ? err.httpStatus
    : typeof err.status === 'number' ? err.status
    : typeof err.statusCode === 'number' ? err.statusCode
    : undefined;
  const found = { code, status, message };

  // ① The `/meta` door itself is absent — nothing here can be asked at all.
  //   The ONLY quiet arm on this face.
  if (errorCodeIsAnyOf({ code }, META_ROUTE_ABSENT_CODES)) {
    return { kind: 'not-served', ...found };
  }

  // ⛔ There is deliberately NO unknown-kind arm here. `classifyImportMappingsFailure`
  //   reads 400 `INVALID_REQUEST` as "this deployment carries no such kind";
  //   on `view` that shape cannot mean it (see this function's doc, point 1),
  //   so it falls through to ④ and is announced. Adding the arm back would
  //   re-create objectui#8151 inside its own fix.

  // ② The server answered and declined this caller. The card's headline case.
  if (errorCodeIsAnyOf({ code }, META_REFUSAL_CODES)) {
    return { kind: 'refused', ...found };
  }
  if (status !== undefined && META_REFUSAL_STATUSES.includes(status)) {
    return { kind: 'refused', ...found };
  }

  // ③ Residual — the answer declared NO ADR-0112 code, so no ObjectStack route
  //   wrote it (a proxy, a gateway, a host with no API mounted). Only here is
  //   the bare status the best signal available, and only because every code
  //   branch has already declined. Same doorless fact as ①, arriving codeless.
  if (
    code === undefined &&
    status !== undefined &&
    META_ABSENT_STATUSES.includes(status)
  ) {
    return { kind: 'not-served', ...found };
  }

  // ④ Everything else could not be read, and an unreadable answer is not an
  //   empty one: a 5xx, a dropped connection, a coded 4xx this consumer cannot
  //   name — including the 400 the sibling classifier keeps quiet. None of them
  //   is evidence that this object has no saved views.
  return { kind: 'unreadable', ...found };
}

/**
 * Emitted when a metadata READ was answered by the server with a failure that
 * is NOT the supported "this deployment does not serve that kind" shape, and
 * the adapter degraded it to an empty result anyway (objectui#7741).
 *
 * The degrade is deliberate and unchanged — the caller still receives `[]`, and
 * `listImportMappings`' published return type has not moved. This event is the
 * channel ALONGSIDE it: the fact that the empty result is an artefact of a
 * failed read, carried in a form a consumer can act on, instead of a
 * `console.warn` nothing in the UI points at.
 *
 * Subscribe via {@link ObjectStackAdapter.onMetadataReadWarning}. A sibling of
 * {@link WriteWarningEvent} and `MetadataSaveAdvisoryEvent` in SHAPE — one
 * long-lived instance, `subscribe → unsubscribe`, `AdapterProvider` wires it
 * once — and deliberately not a payload pushed down either of those: both of
 * them describe a write that SUCCEEDED, so carrying a failed read on one would
 * make the event lie about what happened.
 *
 * `operation` and `kind` are CLOSED unions on purpose. Every emitter is named
 * in them, so widening is an additive, reviewed change rather than something a
 * consumer's exhaustive switch discovers at runtime. (The same trade
 * `WriteWarningEvent`'s required `operation` documents, taken deliberately
 * here.)
 *
 * ## The widening this design was built for happened (objectui#8151)
 *
 * objectui#7741 shipped both fields as SINGLE-member unions and said in as many
 * words that a second emitter should arrive as a reviewed widening. It has:
 * `listViews` is the second, for the same defect one method over, and the
 * mechanism worked as designed — the consumer that renders these events
 * (`app-shell`'s `metadataReadWarningToast`) had a `switch` that named the one
 * operation, so adding the member turned "a views failure is toasted as an
 * import-mapping failure" into a COMPILE error instead of a runtime lie.
 *
 * ⚠️ The pair is the emitter's invariant, not the type's: `operation` and
 * `kind` are two independent unions, so nothing in the type stops
 * `{ operation: 'listViews', kind: 'mapping' }` being constructed. Each emitter
 * writes its own pair, one line apart, and every consumer branches on
 * `operation` — the adapter METHOD, which is what names the list the user is
 * actually looking at. Tightening this to a discriminated union would mean
 * turning a published `interface` into a type alias; that is a reviewable
 * change on its own terms and is deliberately not smuggled in here.
 */
export interface MetadataReadWarningEvent {
  /** The adapter method whose read failed. */
  operation: 'listImportMappings' | 'listViews';
  /** The metadata kind it asked for. */
  kind: 'mapping' | 'view';
  /** The object the read was scoped to. */
  objectName: string;
  /**
   * Which loud verdict this is — see {@link MetadataReadFailureKind}. Never
   * `'not-served'`: that arm is the supported deployment shape and is not
   * emitted at all, so a subscriber never has to filter it out. ⚠️ WHICH
   * failures fall in that un-emitted arm differs per `operation` — it is a
   * strictly smaller set on `listViews` (see {@link classifyViewsFailure}).
   */
  reason: Exclude<MetadataReadFailureKind, 'not-served'>;
  /** The server's own ADR-0112 code, when it declared one. */
  code?: string;
  /** The HTTP status, when the failure carried one. */
  status?: number;
  /** The server's own message, when it sent one. Rendered verbatim, not translated. */
  message?: string;
}

/** Event listener type for metadata read-warning events. */
export type MetadataReadWarningListener = (event: MetadataReadWarningEvent) => void;

// Re-export FileUploadResult from types for consumers
export type { FileUploadResult } from '@object-ui/types';

/**
 * Deterministic JSON.stringify with sorted object keys, used to build cache
 * keys for in-flight request coalescing. Produces identical output for
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` so callers that build params in
 * different orders still hit the same key.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Whether two values are the SAME as far as the wire is concerned — used to
 * tell a write-strip that lost something from one that lost nothing
 * (objectui#3484).
 *
 * Deliberately strict: `1` and `'1'` are NOT the same here. A false "these are
 * equal" silently swallows a warning about a value the user really did lose,
 * which is the worse of the two errors; a false "these differ" only warns
 * about a no-op. `null` and `undefined` both mean "empty" and do match.
 */
function sameWireValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  return stableStringify(a) === stableStringify(b);
}

/**
 * Read a single-record write answer's `warnings` — the advisory validation-rule
 * hits the spec declares on `CreateDataResponseSchema` /
 * `UpdateDataResponseSchema` (objectui#12107).
 *
 * Each entry is PARSED through the spec's `ValidateDataIssueSchema`, never
 * asserted into it: an entry the schema refuses is not shown, because what the
 * toast prints is the entry's `message` and nothing else establishes one. An
 * absent key, a non-array or an empty array all answer `[]`, so an answer from
 * a runtime that predates the key adds nothing.
 */
function readWriteWarnings(result: unknown): ValidateDataIssue[] {
  const raw = (result as { warnings?: unknown } | null | undefined)?.warnings;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ValidateDataIssue[] = [];
  for (const entry of raw) {
    const parsed = ValidateDataIssueSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Drop the fields whose strip changed nothing — the caller supplied exactly
 * the value the record already holds (objectui#3484).
 *
 * The server is not wrong to report those: the client DID send the key and the
 * engine DID refuse to write it, so `droppedFields` is an accurate account of
 * the request. But "was not saved" is only news when something was actually
 * lost, and the console's edit form used to round-trip the whole record —
 * including fields it had itself rendered as read-only text — so every save of
 * a state-locked record raised a warning listing fields the user never touched
 * and whose values never changed.
 *
 * A field is kept (still warned about) whenever the no-op cannot be PROVEN:
 * the response echoed no record, or that record does not carry the key.
 *
 * Returns entries with empty `fields` removed; an all-no-op event list comes
 * back empty, which suppresses the warning entirely.
 */
function withoutNoOpDrops(
  droppedFields: DroppedFieldsNotice[],
  sent: Record<string, unknown> | undefined | null,
  stored: Record<string, unknown> | undefined | null,
): DroppedFieldsNotice[] {
  if (!sent || !stored || typeof sent !== 'object' || typeof stored !== 'object') {
    return droppedFields;
  }
  const out: DroppedFieldsNotice[] = [];
  for (const e of droppedFields) {
    const kept = e.fields.filter((f) => {
      if (!Object.prototype.hasOwnProperty.call(sent, f)) return true;
      if (!Object.prototype.hasOwnProperty.call(stored, f)) return true;
      return !sameWireValue(
        (sent as Record<string, unknown>)[f],
        (stored as Record<string, unknown>)[f],
      );
    });
    if (kept.length > 0) out.push({ ...e, fields: kept });
  }
  return out;
}

/**
 * The console's round-trip keys the spec declares on the ViewItem RECORD — the
 * keys of `VIEW_CONSOLE_ROUND_TRIP_KEYS` whose members include `viewItem`
 * (objectui#11013). Derived, never hand-listed: the spec's record says which
 * keys the console writes onto a stored row and reads back, and on which
 * members each is declared; `_isOverride` is declared on the list overlay only,
 * so it is not one of these.
 *
 * {@link ObjectStackAdapter.listViews} carries exactly these off a record when
 * it flattens the record's `config` to the row the switcher reads. They live
 * at the record's TOP level: the pin toggle and the drag-reorder write them
 * through {@link ObjectStackAdapter.updateView}, which merges
 * `{ ...current, ...partial }`, and app-shell's view-config save carries them
 * forward beside the envelope's `config`. A flatten that kept only `config`
 * dropped them on the reload.
 */
const VIEW_ITEM_ROUND_TRIP_KEYS: readonly string[] = (
  Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS) as Array<keyof typeof VIEW_CONSOLE_ROUND_TRIP_KEYS>
).filter((key) => (VIEW_CONSOLE_ROUND_TRIP_KEYS[key] as readonly string[]).includes('viewItem'));

/**
 * Resolve which object a `type='view'` metadata item belongs to.
 *
 * The metadata index is name-only, not field-typed: `GET /api/v1/meta/view`
 * accepts `?package=` and `?preview=draft` and nothing else (measured on
 * framework `packages/rest/src/rest-server.ts` — the `GET /meta/:type`
 * handler — and on `client.meta.getItems(type, { packageId })`). So every
 * reader of the view namespace enumerates `type='view'` once and narrows to
 * one object HERE, client-side.
 *
 * ONE spelling, one place, deliberately: {@link ObjectStackAdapter.listViews}
 * and {@link ObjectStackAdapter.listViewOverrides} read the same rows out of
 * the same namespace, and two private copies of "which object is this?" is a
 * drift waiting to happen — the switcher showing a view whose override the
 * grid cannot find, or the reverse.
 *
 * `object` is the identity field the write path stamps (and that the
 * framework's overlay heals onto identity-less personalization rows —
 * objectstack#2555); `data.object` is the config's data-provider target.
 *
 * ⛔ No `objectName` leg (objectui#11013, ruling 甲 on objectstack#20051:
 * objectui reads a stored view row by the spec's declared spellings). The
 * spec declares `object` on every `view` member — required on the ViewItem
 * record and on both flattened overlays — and declares `objectName` on none,
 * so the metadata write door refuses a row that carries only `objectName`
 * (`viewItemObjectName.declaredSpelling-11013.test.ts` pins that door beside
 * this reader). Every write path in this package stamps `object` as well, so a
 * row the console wrote carries it; a row that carries ONLY the undeclared
 * spelling no longer matches any object here.
 *
 * **Exported** since objectui#4373, for the same one-spelling reason: a writer
 * outside this module that holds a view BODY but not its object name (app-shell's
 * `MetadataService`) needs the object to name the keys
 * {@link ObjectStackAdapter.invalidateViewKeys} drops, and a fourth private copy
 * of "which object is this?" is exactly the drift this accessor exists to
 * prevent. Identity only — it names no cache key.
 */
export function viewItemObjectName(item: any): string | undefined {
  // Handle both bare view spec and `{list: {...}}` artifact wrapper
  const spec = item?.list ?? item;
  return spec?.data?.object ?? spec?.object;
}

/**
 * The explicit discriminant the console's toolbar write stamped on the rows it
 * wrote for a **system**-view target, and {@link ObjectStackAdapter.listViews}
 * excludes on read (objectui#4227). It is the ONLY thing that classifies a row
 * as an overlay (objectui#10210, ruling B — see
 * {@link isPersonalizationOverlayRow}).
 *
 * That write was this adapter's `updateViewConfig`, whose one production
 * caller was `ObjectView`'s `persistViewPatch`, for the toolbar-driven density
 * / sort / hiddenFields / columnState toggles; it withheld the marker when the
 * toggle targeted a genuinely saved view's own row (`opts.isSavedView`,
 * objectui#4227 follow-up, PM review on PR #4713), so a saved view was never
 * flagged. Both are retired (objectui#12504): those toggles are the user's own
 * list state, and nothing writes a new overlay. The marked rows already at
 * rest are still read, which is why this constant and its readers stay. The
 * explicit "create/save a view" path ({@link ObjectStackAdapter.createView},
 * or the ADR-0034 metadata seam, `viewEnvelope` in app-shell) never stamped
 * it.
 *
 * Survives the round trip against a real server: the platform's `view`
 * metadata schema `.strip()`s its flattened-overlay members only for
 * VALIDATION (an unrecognised top-level key does not fail the parse), and
 * `saveMetaItem` persists the AUTHORED body verbatim — never the stripped
 * `parsed.data` — specifically so "Studio-only auxiliary fields" (its own
 * words for `isPinned`/`isDefault`/`sortOrder`) ride along on the stored
 * document. This marker rode through the same door, so the rows at rest carry
 * it.
 *
 * The value itself is org-wide, not per-user (objectstack#7494's ruling: the
 * overlay this row belongs to is shared view SETTINGS, not a personal
 * preference) — the marker's job is only to say WHAT KIND of row this is
 * (a settings overlay, not an independently addressable view), never WHO it
 * applies to.
 */
const VIEW_OVERLAY_MARKER = '_isOverride' as const;

/**
 * Whether a `view` row {@link ObjectStackAdapter.listViews} enumerated is a
 * personalization overlay rather than a saved view: the row carries
 * {@link VIEW_OVERLAY_MARKER}, on the item or on its `{list: …}` body. Nothing
 * else classifies a row. Both {@link ObjectStackAdapter.listViews} and
 * {@link narrowPersonalizationOverlay} ask this one predicate, so a row cannot
 * be a saved view for one reader and an overlay for the other.
 *
 * ## The shape guess is retired (objectui#10210, ruling B)
 *
 * This predicate used to answer `true` by SHAPE as well: a flat row (no nested
 * `config`) carrying `viewKind: 'list'`, the identity the platform's
 * `viewIdentityPatch` inherits onto a write addressed to a code-defined view.
 * That net was cast for toolbar overlays written before the marker existed
 * (objectui#4227). "Edit view config → Save" then wrote the same shape: the
 * flat panel draft, with `viewKind` inherited server-side. The net dropped the
 * user's own view out of `listViews()`, the tab was stamped read-only, and
 * publishing made that permanent. PR #10332 fixed that save going forward; the
 * rows it had already written stayed caught. The card measured both
 * populations shape-identical, so no narrower shape test exists.
 *
 * The maintainer ruled B (objectui#10210, ruling comment 5824008636): an overlay
 * is a row carrying the marker, nothing else. Both consequences are accepted
 * and pinned in `viewOverlayMarkerOnly-10210.test.ts`:
 *
 * - a row an earlier config save left flat reads as the saved view it is, so
 *   the view heals on read and keeps its edits;
 * - an overlay row written BEFORE the marker (objectui#4227, closed 2026-08-15)
 *   and never touched since also reads as a plain row, so its frozen `label`,
 *   `columns` and `filter` copy covers the code definition again. No
 *   deployment is named as holding one.
 *
 * ⛔ Do not bring a shape test back to win the second population back: a shape
 * that another writer can produce is not a discriminant. The marker is one: the
 * write side stamped it (`updateViewConfig`, retired in objectui#12504), and the
 * rows it marked are still at rest.
 */
function isPersonalizationOverlayRow(item: any, spec: any): boolean {
  return item?.[VIEW_OVERLAY_MARKER] === true || spec?.[VIEW_OVERLAY_MARKER] === true;
}

/**
 * The keys a personalization overlay row legitimately OWNS (objectui#5233).
 *
 * One per `persistViewPatch` call site in app-shell's `ObjectView` — the ONLY
 * production writer of these rows, read off the tree when it was written:
 * `rowHeight` (the density toggle, spec-canonical since #2890), `sort`,
 * `hiddenFields` and `columnState`. Plus `inlineEdit`, which no console call
 * site wrote after objectui#5144 (triage's ruling E: the inline-edit toggle
 * is session-only). That writer is retired (objectui#12504): no toolbar
 * control writes an overlay, and every key here is kept so an overlay an
 * earlier console wrote is still read; the rulings keep that data rather than
 * migrating it. Nothing else in
 * such a row is an opinion the user expressed; anything else it carries is a
 * COPY of the source view as it stood at write time, because
 * `persistViewPatch` USED TO send `{ ...baseViewDef, ...patch }` and this
 * adapter persists what it is given.
 *
 * That copy was the defect the maintainer ruled on (objectstack#7494, comment
 * 5261754173): an overlay written by a mere column drag froze the view's
 * effective `filter` — and its `columns`, `label`, `type`, `isDefault` … — as
 * of that moment, and because the display merge is `{ ...source, ...override }`
 * the frozen copy SHADOWED the source view forever. An admin then edited the
 * view's filter and every user who once resized a column kept the old one,
 * with nothing anywhere reporting it.
 *
 * Both halves of that ruling landed, and this adapter's behaviour was
 * unchanged by either — it persisted what it was given:
 *
 * - **read** (PR #5272, {@link narrowPersonalizationOverlay}): the consumer
 *   that MERGES an overlay over a source view contributes only these keys, so
 *   every already-stored fat row that carries the marker stops shadowing its
 *   source. A fat row written before the marker is no longer narrowed
 *   (objectui#10210, ruling B — see {@link isPersonalizationOverlayRow}).
 * - **write** (objectui#5233, unblocked by `columnState`'s admission to the
 *   view-metadata surface as a runtime-only overlay key — objectstack
 *   `d5552ca13`, released in `@objectstack/spec` 17.1.0): a *system view's*
 *   overlay was written as the patch alone from then on, and the whole write
 *   is retired since objectui#12504.
 *
 * A fat row is therefore a legacy shape, not a shape this product still
 * produces; the list below is still what a reader is allowed to trust from one.
 *
 * ⛔ Do not grow this list to make some other key "stick" through an overlay.
 * A key that belongs to the view belongs in the view; the overlay is a patch,
 * and a patch that carries the whole document is what this list exists to
 * stop. No writer of these rows is left (objectui#12504), so there is no new
 * key for an entry to answer; each entry is kept for reading the rows already
 * at rest — `inlineEdit` for rows written before objectui#5144, the other four
 * for rows written before objectui#12474 / objectui#12418.
 */
export const VIEW_OVERLAY_OWNED_KEYS = Object.freeze([
  'rowHeight',
  'sort',
  'hiddenFields',
  'columnState',
  'inlineEdit',
] as const);

/**
 * Identity, not content — kept so a narrowed row is still addressable and
 * still says what KIND of row it is.
 *
 * `label` is deliberately NOT here even though the platform stamps it onto
 * these rows: `viewIdentityPatch` (`@objectstack/metadata-protocol`, objectstack-ai/objectstack#2555)
 * inherits `viewKind`/`object`/`label` from the registry entry an overlay
 * shadows, so a stored `label` is a snapshot of the source view's label at
 * write time — content, and exactly the class of frozen key this narrowing
 * exists to stop shadowing the source.
 */
const VIEW_OVERLAY_IDENTITY_KEYS = Object.freeze([
  'name',
  'object',
  'viewKind',
  VIEW_OVERLAY_MARKER,
] as const);

/**
 * Reduce a personalization overlay row to the keys it owns — the read-side
 * half of objectui#5233, and the half that reaches rows ALREADY STORED.
 *
 * Rows written before this shipped carry the whole source view (see
 * {@link VIEW_OVERLAY_OWNED_KEYS}). Of the three dispositions the issue names
 * for them — strip on next write, migrate, tolerate on read — this is the
 * third, chosen deliberately and stated here rather than left implicit,
 * because it is the only one that is already true for every existing marked
 * row the moment it ships: strip-on-next-write heals a row only when its user happens
 * to touch that view again (and leaves the frozen filter live until then),
 * and a migration needs a runner this product does not have for `sys_metadata`
 * rows an operator may not even know exist. What the issue forbids is SILENT
 * tolerance; this is the explicit, pinned kind (`viewOverlayPatchOnly.test.ts`
 * in this package, `ObjectView.overlayPatchOnly.test.tsx` in app-shell).
 *
 * Applied by the consumer that MERGES an override over a source view
 * (app-shell's `sanitizeViewOverride`, the one seam both of
 * `loadViewOverrides`' read branches pass through), NOT by
 * {@link ObjectStackAdapter.listViewOverrides} / {@link ObjectStackAdapter.getView}:
 * those two answer with the stored DOCUMENT, their equality is itself pinned
 * ("same key space, same document" — `listViewOverrides.test.ts`), and
 * `InterfaceListPage` hydrates a hollow view out of that document. Narrowing
 * belongs where a row is read AS A PATCH, not where it is read as a row.
 *
 * Non-overlay rows — a genuine saved view's own body, which the same batch
 * read enumerates — are returned by REFERENCE, untouched: for those the row
 * IS the view, and every key on it is an opinion its author expressed.
 * Classification is {@link isPersonalizationOverlayRow}, the same predicate
 * {@link ObjectStackAdapter.listViews} excludes rows by, so a row cannot be a
 * saved view for one reader and an overlay for the other. It reads the marker
 * only (objectui#10210, ruling B): an unmarked row is returned by reference
 * whatever its shape, including a fat row written before the marker existed.
 */
export function narrowPersonalizationOverlay<T>(row: T): T {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const item = row as Record<string, any>;
  // Same unwrap the other readers of this namespace use — a `{list: {...}}`
  // artifact wrapper is a view CONTAINER, never an overlay, and
  // `isPersonalizationOverlayRow` reads both levels.
  const spec = item.list ?? item;
  if (!isPersonalizationOverlayRow(item, spec)) return row;
  const narrowed: Record<string, any> = {};
  for (const key of VIEW_OVERLAY_IDENTITY_KEYS) {
    if (item[key] !== undefined) narrowed[key] = item[key];
  }
  for (const key of VIEW_OVERLAY_OWNED_KEYS) {
    if (item[key] !== undefined) narrowed[key] = item[key];
  }
  return narrowed as T;
}

/**
 * Unwrap a `?state=draft` view read into its bare body, or `null` when there
 * is nothing pending (#4139).
 *
 * The framework answers EVERY single-item read — draft or published — in a
 * `{type, name, item}` envelope. `MetadataClient.get()` unwraps it at the
 * client boundary (objectui#4271) while `getDraft()` deliberately hands the
 * envelope back, so this helper stays tolerant of both: the call below reaches
 * it through `get()` and therefore already holds the body, and the passthrough
 * limb keeps it correct for an envelope arriving by any other route. An empty
 * body is normalized to `null` so the caller's "is this view draft-backed?"
 * test is a plain truthiness check. Mirrors app-shell's `unwrapDraftBody`
 * (ADR-0034 seam); the two live apart because the seam sits above this
 * adapter, not beside it.
 */
function unwrapViewDraft(resp: unknown): Record<string, any> | null {
  if (!resp || typeof resp !== 'object') return null;
  const env = resp as Record<string, any>;
  const raw = 'item' in env ? env.item : env;
  if (!raw || typeof raw !== 'object') return null;
  // Drop the framework's own read decorations (objectui#8181). `updateView`
  // MERGES this body and writes the result back, so without this the served
  // `_diagnostics` / `_draft` ride into a `save('view', ...)` — the same
  // round-trip `stripReadDecorations` exists to stop, and the same one
  // `extractDraftBody` closes on the `getDraft()` side. The key list is the
  // spec's; the ADR-0010 protection envelope is not on it and survives.
  // Applied to the ITEM, before the artifact wrapper below, because that is
  // the level `decorateMetadataItem` decorates.
  const body = stripReadDecorations(raw) as Record<string, any>;
  // Same `{list: {...}}` artifact wrapper the published read unwraps.
  const spec = body.list ?? body;
  if (!spec || typeof spec !== 'object') return null;
  return Object.keys(spec).length > 0 ? (spec as Record<string, any>) : null;
}

/**
 * `deleteView`'s receipt shapes, RE-EXPORTED from `@object-ui/types` (#4564).
 *
 * #4479 first declared both here, because this adapter is where the widened
 * receipt is produced. That left the shared `DataSource.deleteView?` unable to
 * describe it: the dependency runs this package -> `@object-ui/types` and never
 * the other way, so the interface kept the narrow `{ deleted: boolean }` and a
 * consumer reaching this adapter THROUGH `DataSource` was handed a type with
 * the per-home outcomes already discarded. Nothing failed to compile — a wider
 * return is assignable to a narrower declaration — which is precisely why the
 * gap was silent until #4564 measured it.
 *
 * So the canonical declarations now live beside the interface they belong to,
 * in `packages/types/src/data.ts`, and this package re-exports them under the
 * SAME names: every importer PR #4562 left pointing at
 * `@object-ui/data-objectstack` keeps compiling, and now gets the very type the
 * shared contract speaks rather than a structural twin of it. Pinned by
 * `deleteViewContract.types.test.ts`, which asserts type IDENTITY — mutual
 * assignability would have been satisfied by a copy that was already drifting.
 */
export type { DeleteViewResult, ViewHomeDeleteOutcome } from '@object-ui/types';

/**
 * Read one delete receipt into a {@link ViewHomeDeleteOutcome}.
 *
 * The `deleted ?? reset ?? true` ladder is carried over verbatim from the
 * single-call `deleteView` this replaced, so a server that answers a shape
 * with neither key is read exactly as it was before (#4479): the framework
 * sends `reset`, the SDK's typed metadata shape names `deleted`, and the
 * final `true` is the "it answered 2xx and said nothing" default.
 */
function readViewDeleteReceipt(result: unknown): ViewHomeDeleteOutcome {
  const r = (result ?? undefined) as Record<string, any> | undefined;
  return {
    removed: !!(r?.deleted ?? r?.reset ?? true),
    ...(typeof r?.reset === 'boolean' ? { reset: r.reset } : {}),
    ...(typeof r?.message === 'string' ? { message: r.message } : {}),
  };
}

/**
 * Merge a partial view patch onto the CURRENT view document.
 *
 * ADR-0005 overlay rows store the *full* view document, so a partial update is
 * a read-merge-write cycle and the merge must start from real current state —
 * merging onto `{}` yields a `{label, name, object}` fragment the server
 * rejects (422), which is exactly how a rename used to be lost (#4139).
 *
 * `name` is forced to the URL segment so the row key and `body.name` agree
 * (#2767 P1), and `object` falls back through the two spellings a stored view
 * may carry before defaulting to the caller's object.
 */
function mergeViewPatch(
  current: Record<string, any>,
  partial: Record<string, any>,
  viewName: string,
  objectName: string,
): Record<string, any> {
  return {
    ...current,
    ...partial,
    name: viewName,
    object: current?.object || current?.data?.object || objectName,
  };
}

/**
 * Whether a rejected fetch was cancelled by its own caller (an aborted
 * `signal`), as opposed to failing to reach the server. A cancellation says
 * nothing about reachability, so it must not move the connection state
 * (objectui#12295).
 */
function isCallerAbort(error: unknown, init?: RequestInit): boolean {
  if (init?.signal?.aborted) return true;
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * ObjectStack Data Source Adapter
 *
 * Bridges the ObjectStack Client SDK with the ObjectUI DataSource interface.
 * This allows Object UI applications to seamlessly integrate with ObjectStack
 * backends while maintaining the universal DataSource abstraction.
 * 
 * @example
 * ```typescript
 * import { ObjectStackAdapter } from '@object-ui/data-objectstack';
 * 
 * const dataSource = new ObjectStackAdapter({
 *   baseUrl: 'https://api.example.com',
 *   token: 'your-api-token',
 *   autoReconnect: true,
 *   maxReconnectAttempts: 5
 * });
 * 
 * // Monitor connection state
 * dataSource.onConnectionStateChange((event) => {
 *   console.log('Connection state:', event.state);
 * });
 * 
 * const users = await dataSource.find('users', {
 *   $filter: { status: 'active' },
 *   $top: 10
 * });
 * ```
 */
export class ObjectStackAdapter<T = unknown> implements DataSource<T> {
  private client: ObjectStackClient;
  private connected: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private metadataCache: MetadataCache;
  private connectionState: ConnectionState = 'disconnected';
  private connectionStateListeners: ConnectionStateListener[] = [];
  private batchProgressListeners: BatchProgressListener[] = [];
  private autoReconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private reconnectAttempts: number = 0;
  private baseUrl: string;
  private token?: string;
  /** One "analytics capability is missing" console line per adapter, not per widget. */
  private analyticsCapabilityWarned = false;
  private fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  // In-flight find() requests keyed by resource + serialized params.
  // Coalesces concurrent identical reads (e.g. React StrictMode double-mount,
  // multiple sibling components requesting the same dataset on first paint)
  // into a single network round trip.
  private inflightFinds = new Map<string, Promise<QueryResult<T>>>();
  // In-flight findOne() reads keyed by resource + record id + serialized
  // params, shared the same way (objectui#11699). Opening one record page
  // asked for the same record twice at once: `record:details`' DetailView
  // re-runs its load effect while its first read is still on the wire. A
  // write to a resource drops that resource's entries (see `emitMutation`),
  // so a read asked after a save is never answered by one sent before it.
  private inflightFindOnes = new Map<string, Promise<T | null>>();
  // Resources that have responded 404 at least once (collection not installed
  // on this backend). Subsequent find() calls short-circuit to an empty result
  // so optional collections like sys_presence don't hammer the server with
  // failing requests on every record open / panel render.
  private missingResources = new Set<string>();
  // Set once the server has told us it can't do a cross-object transactional
  // batch (the client SDK's data.batchTransaction threw HTTP 404/405/501). After
  // that, batchTransaction skips the SDK call and serves every call via the
  // client-side emulation — the non-atomic fallback lives HERE, isolated to the
  // one adapter that has to cope with a backend lacking server atomicity (#2679).
  private batchUnsupported = false;
  // The server's declared cross-object atomic-batch capability, read from
  // discovery at connect() (objectstack-ai/objectstack#3298 / objectui #2693). `true` → the
  // backend GUARANTEES an atomic `/batch`, so batchTransaction trusts it and
  // never degrades to the non-atomic emulation (any failure surfaces as a real
  // error). `false` or `undefined` (capability absent → backend predates objectstack-ai/objectstack#3298)
  // → keep the legacy runtime-probe + emulation fallback so a save is still
  // possible; dropping it there would turn "saves, less safe" into "no save
  // path" on older backends (#2679 compatibility constraint).
  private atomicBatchCapability: boolean | undefined;
  // Subscribers registered via onMutation(). Emitted after each successful
  // create/update/delete so data-bound views (ListView, ObjectView, kanban,
  // calendar) auto-refresh — the interface ListView relies on to reflect
  // inline-edit "Save All" writes without a manual reload.
  private mutationListeners = new Set<(event: DataSourceMutationEvent<T>) => void>();

  // Subscribers registered via onWriteWarning(). Emitted after a create/update
  // whose response carried `droppedFields` (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455) so the app
  // shell can surface a toast instead of the strip passing silently.
  private writeWarningListeners = new Set<WriteWarningListener>();

  // Subscribers registered via onSaveAdvisory(). Emitted after a metadata save
  // through THIS adapter's `ObjectStackClient` whose 200 carried a non-empty
  // `advisories` array (#4237; backend objectstack#7435). Sibling of the set
  // above in every respect except which door produced the event: that one is
  // record CRUD, this one is the metadata save door.
  private saveAdvisoryListeners = new Set<MetadataSaveAdvisoryListener>();

  // Subscribers registered via onMetadataReadWarning(). Emitted when a metadata
  // READ failed in a way that is NOT the supported "this deployment does not
  // serve that kind" shape, and was degraded to an empty result anyway
  // (objectui#7741). Third sibling of the two sets above: same seam shape, and
  // the opposite direction — those two describe a write that succeeded, this
  // one a read that did not happen.
  private metadataReadWarningListeners = new Set<MetadataReadWarningListener>();

  constructor(config: {
    baseUrl: string;
    token?: string;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    cache?: {
      maxSize?: number;
      ttl?: number;
    };
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
  }) {
    // objectui#12295 — ONE fetch carries every request this adapter makes: the
    // client's (data, metadata, analytics, and every caller of `getClient()`)
    // and the adapter's own raw reads alike. The exception is `uploadFile` /
    // `uploadFiles`, which call the global `fetch`, so an upload's outcome does
    // not move the connection state. This fetch is the single seam where "the
    // server answered" (a Response, whatever its status) can be told apart
    // from "no HTTP answer at all" (the fetch rejected), so the connection
    // state follows the requests the host already makes; see
    // `observeServerAnswer`.
    const transport = config.fetch || globalThis.fetch.bind(globalThis);
    this.fetchImpl = (input, init) =>
      this.observeServerAnswer(() => transport(input, init), init);
    // Inject a quiet logger that demotes expected 404s ("HTTP request failed"
    // from probing optional collections like sys_presence/sys_activity) to
    // debug() so they don't pollute the browser console. Other log levels are
    // forwarded to the standard console.
    this.client = new ObjectStackClient({
      ...config,
      fetch: this.fetchImpl,
      logger: createQuietHttpLogger(),
    });
    // #4237 — one emitter for every metadata save this adapter's client makes,
    // installed the moment the client exists so no save can precede it.
    this.installSaveAdvisoryInterceptor();
    this.metadataCache = new MetadataCache(config.cache);
    // objectui#13044 — after the cache, which the wrap reads.
    this.installViewListShare();
    this.autoReconnect = config.autoReconnect ?? true;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 3;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
    this.baseUrl = config.baseUrl;
    this.token = config.token;
  }

  /**
   * Ensure the client is connected to the server.
   * Call this before making requests or it will auto-connect on first request.
   *
   * With `autoReconnect`, a failed discovery read is retried up to
   * `maxReconnectAttempts` times with exponential backoff. The promise resolves
   * once discovery answers and rejects with the last `ConnectionError` once the
   * retries are spent (objectui#12318).
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    // Dedupe concurrent connect() calls — without this, every component
    // that mounts on first paint can trigger an independent discovery
    // request before the first one completes. The one promise covers the
    // attempt AND its retries, so a caller that arrives during the backoff
    // joins it instead of starting a discovery read of its own.
    if (this.connectPromise) return this.connectPromise;

    this.setConnectionState('connecting');
    this.connectPromise = this.attemptConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  /**
   * One discovery attempt, and the retry that follows it when it fails with
   * budget left. Runs inside the promise {@link connect} hands every caller.
   */
  private async attemptConnect(): Promise<void> {
    try {
      // Use the module-level discovery cache so multiple adapter instances
      // (or React StrictMode double-mounts) at the same baseUrl share a
      // single network round trip. We inject the result into the client's
      // private `discoveryInfo` field to avoid client.connect() re-fetching.
      const baseUrl = this.baseUrl || '';
      const discoveryUrl = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/api/v1/discovery`
        : '/api/v1/discovery';

      const data = await getSharedDiscovery(baseUrl, async () => {
        const res = await this.fetchImpl(discoveryUrl, {
          method: 'GET',
          headers: this.token
            ? { Authorization: `Bearer ${this.token}` }
            : undefined,
        });
        if (!res.ok) {
          throw new Error(`discovery ${res.status} ${res.statusText}`);
        }
        const body = await res.json();
        return body && typeof body.success === 'boolean' && 'data' in body
          ? body.data
          : body;
      });

      // Prime the underlying client's cached discovery so capability/route
      // helpers continue to work without a redundant fetch.
      (this.client as unknown as { discoveryInfo?: unknown }).discoveryInfo = data;

      // Record the declared cross-object atomic-batch capability (objectstack-ai/objectstack#3298) so
      // batchTransaction can decide declaratively at call time whether it may
      // trust server atomicity instead of runtime-probing 404/405/501.
      this.atomicBatchCapability = readTransactionalBatchCapability(data);

      this.connected = true;
      this.reconnectAttempts = 0;
      this.setConnectionState('connected');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect to ObjectStack server';
      const connectionError = new ConnectionError(
        errorMessage,
        undefined,
        { originalError: error }
      );

      this.setConnectionState('error', connectionError);

      // Attempt auto-reconnect if enabled
      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.attemptReconnect();
      } else {
        throw connectionError;
      }
    }
  }

  /**
   * Attempt to reconnect to the server with exponential backoff
   */
  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    this.setConnectionState('reconnecting');

    // Exponential backoff: delay * 2^(attempts-1)
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    await new Promise(resolve => setTimeout(resolve, delay));

    // A new attempt, never `connect()`: that returns the in-flight promise,
    // which is the one this retry runs inside, so the retry would await itself
    // and never settle (objectui#12318).
    await this.attemptConnect();
  }

  /**
   * Get the current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if the adapter is currently connected
   */
  isConnected(): boolean {
    return this.connected && this.connectionState === 'connected';
  }

  /**
   * Register a listener for connection state changes
   */
  onConnectionStateChange(listener: ConnectionStateListener): () => void {
    this.connectionStateListeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.connectionStateListeners.indexOf(listener);
      if (index > -1) {
        this.connectionStateListeners.splice(index, 1);
      }
    };
  }

  /**
   * Register a listener for batch operation progress
   */
  onBatchProgress(listener: BatchProgressListener): () => void {
    this.batchProgressListeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.batchProgressListeners.indexOf(listener);
      if (index > -1) {
        this.batchProgressListeners.splice(index, 1);
      }
    };
  }

  /**
   * Set connection state and notify listeners
   */
  private setConnectionState(state: ConnectionState, error?: Error): void {
    this.connectionState = state;
    
    const event: ConnectionStateEvent = {
      state,
      timestamp: Date.now(),
      error,
    };
    
    this.connectionStateListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in connection state listener:', err);
      }
    });
  }

  /**
   * Run one request through the adapter's fetch and let its outcome move the
   * connection state (objectui#12295). Before the first successful
   * {@link connect} this records nothing: `connect()` owns the state until
   * then, and its own discovery read passes through here too.
   *
   * - **Answered** — the fetch resolved with a Response, whatever its status.
   *   A 4xx or 5xx is an answer: the server is reachable, so it counts the
   *   same as a 200 and ends any outage.
   * - **Not answered** — the fetch rejected: no HTTP answer at all (refused,
   *   reset, DNS, an offline browser). A rejection the caller asked for by
   *   aborting is not evidence about the server and records nothing.
   *
   * The rejection or the Response reaches the caller unchanged.
   */
  private async observeServerAnswer(
    send: () => Promise<Response>,
    init?: RequestInit,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      if (!isCallerAbort(error, init)) this.noteServerUnanswered(error);
      throw error;
    }
    this.noteServerAnswered();
    return response;
  }

  /** An answered request after the first connect: the server is reachable. */
  private noteServerAnswered(): void {
    if (!this.connected) return;
    this.reconnectAttempts = 0;
    if (this.connectionState !== 'connected') this.setConnectionState('connected');
  }

  /**
   * An unanswered request after the first connect. It spends the adapter's own
   * retry window — the `autoReconnect` / `maxReconnectAttempts` budget that
   * {@link connect} grants a failed discovery — counted in the requests the
   * host already makes rather than in timed probes: while the budget lasts the
   * state is `reconnecting`, and the first unanswered request past it moves the
   * state to `error`. No timer and no request of the adapter's own is involved;
   * the next answered request, whenever it comes, restores `connected`.
   */
  private noteServerUnanswered(error: unknown): void {
    if (!this.connected || this.connectionState === 'error') return;
    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      if (this.connectionState !== 'reconnecting') this.setConnectionState('reconnecting');
      return;
    }
    this.setConnectionState(
      'error',
      new ConnectionError(
        error instanceof Error ? error.message : 'ObjectStack server did not answer',
        undefined,
        { originalError: error },
      ),
    );
  }

  /**
   * Emit batch progress event to listeners
   */
  private emitBatchProgress(event: BatchProgressEvent): void {
    this.batchProgressListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in batch progress listener:', err);
      }
    });
  }

  /**
   * Find multiple records with query parameters.
   * Converts OData-style params to ObjectStack query options.
   */
  async find(resource: string, params?: QueryParams): Promise<QueryResult<T>> {
    // Short-circuit when this resource has previously responded 404 — the
    // collection isn't installed on this backend. Callers (AppHeader,
    // RecordDetailView, …) treat empty data as "feature unavailable".
    if (this.missingResources.has(resource)) {
      return { data: [], total: 0 } as QueryResult<T>;
    }
    const key = `${resource}::${stableStringify(params)}`;
    return this.shareInFlight(this.inflightFinds, key, async () => {
      await this.connect();

      // When $expand is requested, use a raw GET request to the REST API with
      // `populate` as a URL query param. The server's REST plugin routes
      // GET /data/:object to protocol.findData({ object, query: req.query }),
      // which parses `populate` (comma-separated) into an array for lookup expansion.
      // We use a raw request because the client SDK's data.find() QueryOptions
      // interface does not include populate/expand fields.
      if ((params?.$expand && params.$expand.length > 0)
          || (params?.$search != null && String(params.$search).trim() !== '')) {
        // The client SDK's data.find() QueryOptions drops `$search`; route through
        // the raw GET so the term reaches protocol.findData → the metadata-driven
        // search executor (ADR-0061).
        const result = await this.rawFindWithPopulate(resource, params);
        return this.normalizeQueryResult(result, params);
      }

      const queryOptions = this.convertQueryParams(params);
      try {
        const result: unknown = await this.client.data.find<T>(resource, queryOptions);
        return this.normalizeQueryResult(result, params);
      } catch (err) {
        // An `enable`-block denial is NOT a missing collection. The object
        // exists and the server is deliberately refusing to expose it, forever
        // and for everyone — degrading that to an empty result set tells the
        // user "you have no records" about a page that can never hold any
        // (objectui#4408). Rethrow so the surface can say what happened; the
        // `missingResources` memo must not absorb it either, or the very first
        // denial would silently pin every later call to empty.
        if (!isApiAccessDeniedError(err) && is404Error(err)) {
          // Mark the resource so subsequent calls don't repeat the 404.
          this.missingResources.add(resource);
          return { data: [], total: 0 } as QueryResult<T>;
        }
        throw err;
      }
    });
  }

  /**
   * Share one in-flight read among concurrent callers asking the same
   * question: the first call for `key` issues `read()`, every call that
   * arrives while it is still pending gets that same promise, and the entry is
   * dropped the moment it settles — so nothing is cached past the round trip,
   * a rejection reaches every caller that shared it and is not remembered, and
   * the next call after settle issues a fresh read. Used by `find` and
   * `findOne` (objectui#11699).
   */
  private shareInFlight<R>(
    inflight: Map<string, Promise<R>>,
    key: string,
    read: () => Promise<R>,
  ): Promise<R> {
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = read();
    inflight.set(key, promise);
    // Use `.then(cleanup, cleanup)` instead of `.finally(cleanup)`. `.finally`
    // returns a new chained promise that re-raises the rejection, and because
    // we don't return that chain, Node/browsers see it as an unhandled
    // rejection — flooding DevTools when callers handle the original `promise`
    // via `.catch()` (e.g. AppHeader probing optional sys_presence/sys_activity).
    const cleanup = () => {
      // Only clear if the entry still points at this promise; a later call
      // that started after settle, or after a write dropped the entry, may
      // have already replaced it.
      if (inflight.get(key) === promise) {
        inflight.delete(key);
      }
    };
    promise.then(cleanup, cleanup);
    return promise;
  }

  /**
   * Full-text search across every searchable object in a single round-trip.
   *
   * Hits `GET /api/v1/search?q=`, the platform's global search endpoint served
   * by the registered search service (the pinyin full-text plugin) and backed
   * by `metadata-protocol`'s `searchAll`. Unlike `find(resource, { $search })`
   * — a per-object metadata-driven search (ADR-0061) — this consults the search
   * index and ranks hits across objects, so it surfaces records the per-object
   * fanout misses. Global affordances (⌘K command palette, search page) prefer
   * this path (objectstack-ai/objectstack#3371).
   *
   * Returns `{ query, hits }`. A backend without the search plugin installed
   * answers `404`; we treat that as "no global search here" and return an empty
   * hit set so callers can fall back to a per-object fanout rather than surface
   * an error.
   */
  async searchAll(
    query: string,
    options?: { limit?: number; objects?: string[] },
  ): Promise<GlobalSearchResult> {
    const trimmed = (query ?? '').trim();
    if (trimmed === '') return { query: '', hits: [] };

    await this.connect();

    const queryParams = new URLSearchParams();
    queryParams.set('q', trimmed);
    if (options?.limit != null && options.limit > 0) {
      queryParams.set('limit', String(options.limit));
    }
    if (options?.objects && options.objects.length > 0) {
      queryParams.set('objects', options.objects.join(','));
    }

    const baseUrl = (this.baseUrl || '').replace(/\/$/, '');
    // Avoid doubling /api/v1 when baseUrl already carries the version suffix.
    const hasApiVersionSuffix = /\/api\/v\d+$/i.test(baseUrl);
    const searchPath = hasApiVersionSuffix ? '/search' : '/api/v1/search';
    const url = `${baseUrl}${searchPath}?${queryParams.toString()}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await this.fetchImpl(url, { method: 'GET', headers });

    if (!res.ok) {
      // 404 → the search plugin isn't installed on this backend. Degrade to an
      // empty result so the caller can fall back instead of hard-failing.
      if (res.status === 404) return { query: trimmed, hits: [] };
      const errorBody = await res.json().catch(() => ({ message: res.statusText }));
      const envelope = readErrorEnvelope(errorBody);
      const err = new Error(envelope.message ?? res.statusText) as Error & {
        status?: number;
        code?: string;
      };
      err.status = res.status;
      err.code = envelope.code;
      throw err;
    }

    const body = await res.json();
    // Unwrap the standard `{ success, data }` envelope when present; the search
    // endpoint itself returns `{ query, hits }`.
    const payload =
      body && typeof body === 'object' && typeof body.success === 'boolean' && 'data' in body
        ? body.data
        : body;

    const rawHits: unknown[] = Array.isArray(payload?.hits)
      ? payload.hits
      : Array.isArray(payload)
        ? payload
        : [];

    const hits: GlobalSearchHit[] = [];
    for (const entry of rawHits) {
      if (!entry || typeof entry !== 'object') continue;
      const h = entry as Record<string, any>;
      const object = h.object ?? h.objectName ?? h.object_name;
      const id = h.id ?? h.record?.id ?? h.record?._id;
      if (typeof object !== 'string' || id == null) continue;
      hits.push({
        object,
        id: String(id),
        title: typeof h.title === 'string' ? h.title : undefined,
        snippet: typeof h.snippet === 'string' ? h.snippet : undefined,
        record: h.record && typeof h.record === 'object' ? h.record : undefined,
      });
    }

    return {
      query: typeof payload?.query === 'string' ? payload.query : trimmed,
      hits,
    };
  }

  /**
   * Find a single record by ID.
   *
   * Concurrent calls for the same resource, id and params share one request,
   * exactly as `find` does (objectui#11699); see {@link shareInFlight}.
   */
  async findOne(resource: string, id: string | number, params?: QueryParams): Promise<T | null> {
    const key = `${resource}::${JSON.stringify(String(id))}::${stableStringify(params)}`;
    return this.shareInFlight(this.inflightFindOnes, key, () => this.readOne(resource, id, params));
  }

  /** The one round trip behind {@link findOne}, unshared. */
  private async readOne(resource: string, id: string | number, params?: QueryParams): Promise<T | null> {
    await this.connect();

    // When $expand is requested, use a raw GET request with a filter by id
    // and populate. The installed server v3.0.10's getData() does not support
    // expand/populate, so we route through findData which does.
    if (params?.$expand && params.$expand.length > 0) {
      try {
        const findParams: QueryParams = {
          ...params,
          $filter: { id: String(id) },
          $top: 1,
        };
        const result = await this.rawFindWithPopulate(resource, findParams);
        // Handle array responses (some servers return data as flat arrays)
        if (Array.isArray(result)) {
          return result[0] || null;
        }
        const resultObj = result as { records?: T[]; value?: T[] };
        const records = resultObj.records || resultObj.value || [];
        return records[0] || null;
      } catch (error: unknown) {
        if (is404Error(error)) {
          return null;
        }
        // Fall through to direct GET without $expand — some servers don't
        // support the filter+populate API, so gracefully degrade to a
        // simple data.get() call below rather than failing with "Record not found".
      }
    }

    try {
      const result = await this.client.data.get<T>(resource, String(id));
      return result.record;
    } catch (error: unknown) {
      // If record not found, return null instead of throwing
      if (is404Error(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new record.
   */
  /**
   * Notify all mutation subscribers. A throwing listener must not break the
   * mutation or starve the other subscribers, so each is isolated.
   */
  private emitMutation(event: DataSourceMutationEvent<T>): void {
    // A record read still on the wire when a write to its resource lands was
    // asked before that write, so a caller asking after it — typically the
    // refetch a listener below triggers — must not join it (objectui#11699).
    // Dropped before the listeners run. The pending read still answers the
    // callers that already hold it.
    const prefix = `${event.resource}::`;
    for (const key of Array.from(this.inflightFindOnes.keys())) {
      if (key.startsWith(prefix)) this.inflightFindOnes.delete(key);
    }
    for (const listener of this.mutationListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('ObjectStackAdapter: mutation listener error', err);
      }
    }
  }

  /**
   * Subscribe to create/update/delete events on any resource. Returns an
   * unsubscribe function. Data-bound views use this to auto-refresh after a
   * mutation (e.g. inline-edit "Save All", which writes through `update` and
   * must repaint the list without a manual reload).
   */
  onMutation(callback: (event: DataSourceMutationEvent<T>) => void): () => void {
    this.mutationListeners.add(callback);
    return () => {
      this.mutationListeners.delete(callback);
    };
  }

  /**
   * Notify all write-warning subscribers. Isolated like {@link emitMutation}: a
   * throwing listener must not break the write or starve the others.
   */
  private emitWriteWarning(event: WriteWarningEvent): void {
    for (const listener of this.writeWarningListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('ObjectStackAdapter: write-warning listener error', err);
      }
    }
  }

  /**
   * Read `droppedFields` off a create/update response (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455)
   * and, when present, notify write-warning subscribers. Tolerant of a client
   * whose response type predates `droppedFields`: the field is read structurally
   * and validated, so an older client (or a backend that never drops) is a no-op.
   *
   * SHAPE decides whether an entry is an event at all (it must name at least one
   * field); `object`, `fields` and `reason` are then PARSED — an unrecognized
   * reason routed to the skew arm, a non-string field element refused, a missing
   * `object` healed from `resource` — never asserted into the union, and the
   * entry itself never dropped for them (objectui#4934, `f75810e7c`).
   *
   * The same answer's `warnings` (objectui#12107) rides this one event: it is
   * emitted when either list is non-empty, so a write whose only news is an
   * advisory rule hit still reaches the subscriber, with `droppedFields: []`.
   */
  private notifyDroppedFields(
    operation: 'create' | 'update',
    resource: string,
    result: unknown,
    id?: string | number,
    sent?: Record<string, unknown> | null,
  ): void {
    const dropped = (result as { droppedFields?: unknown } | null | undefined)?.droppedFields;
    let droppedFields: DroppedFieldsNotice[] = [];
    if (Array.isArray(dropped) && dropped.length > 0) {
      const valid = dropped
        .filter(isWireDroppedFieldsEntry)
        .map((e) => asDroppedFieldsNotice(e, resource));
      // A strip that changed nothing is not news — see withoutNoOpDrops (#3484).
      const stored = (result as { record?: Record<string, unknown> } | null | undefined)?.record;
      droppedFields = withoutNoOpDrops(valid, sent, stored);
    }
    const warnings = readWriteWarnings(result);
    if (droppedFields.length === 0 && warnings.length === 0) return;
    this.emitWriteWarning({
      operation,
      resource,
      ...(id !== undefined ? { id } : {}),
      droppedFields,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }

  /**
   * Same, for the cross-object transactional batch (objectstack-ai/objectstack#3794). Its
   * response hangs the events off a top-level `droppedFields` list, each tagged
   * with the `index` of the operation it came from — `results` entries are bare
   * record echoes with nowhere to hang a per-row list.
   *
   * This is the path that matters most for the warning: `batchTransaction` is
   * how the console's record form saves a master-detail record, so a
   * `readonlyWhen`-locked field edited in that form was stripped server-side
   * while the UI reported a plain success. The operation kind is taken from the
   * originating op so the toast doesn't call an update a create.
   */
  private notifyBatchDroppedFields(
    operations: BatchTransactionOperation[],
    payload: unknown,
  ): void {
    const dropped = (payload as { droppedFields?: unknown } | null | undefined)?.droppedFields;
    if (!Array.isArray(dropped) || dropped.length === 0) return;
    const results = (payload as { results?: unknown[] } | null | undefined)?.results;
    for (const entry of dropped) {
      // Same gate as the single-record path, so the two agree on what an entry
      // even is. The remaining cast adds only `index`, which this loop reads
      // and the gate has no opinion about (objectui#4934, `f75810e7c`).
      if (!isWireDroppedFieldsEntry(entry)) continue;
      const e = entry as WireDroppedFieldsEntry & { index?: number };
      const op = typeof e.index === 'number' ? operations[e.index] : undefined;
      // Which object this strip is about. The wire's own `object` wins; the
      // originating op is the fallback when the wire omitted it or sent a
      // non-string. ONE spelling, used for both the notice and the event's
      // `resource` — they used to be computed separately, so a wire entry with
      // a non-string `object` could put one value on the notice and another on
      // the event describing it.
      //
      // The last arm is NOT a name — see {@link UNATTRIBUTED_STRIP_OBJECT} for
      // what makes it reachable, why such a strip is still emitted rather than
      // refused, and why the placeholder is not widened away (objectui#7160).
      const object =
        typeof e.object === 'string'
          ? e.object
          : typeof op?.object === 'string'
            ? op.object
            : UNATTRIBUTED_STRIP_OBJECT;
      // Same no-op suppression as the single-record path (#3484). The echoed
      // row for the originating op is the "stored" side; when the batch echoed
      // nothing usable, `withoutNoOpDrops` keeps every field.
      const stored =
        typeof e.index === 'number' && Array.isArray(results)
          ? (results[e.index] as Record<string, unknown> | undefined)
          : undefined;
      // `object`, `fields` and `reason` are parsed here too — the batch path
      // used to re-assert all three into the union via the cast above
      // (objectui#4934, `f75810e7c`). `index` is deliberately not carried onto
      // the notice: it addresses an operation in THIS response, not the strip,
      // which is why the entry is rebuilt rather than spread.
      const [live] = withoutNoOpDrops(
        [asDroppedFieldsNotice({ fields: e.fields, reason: e.reason }, object)],
        op?.data as Record<string, unknown> | undefined,
        stored,
      );
      if (!live) continue;
      // An op carrying any action other than `create` reads as an update:
      // `delete` never drops fields, so that is the truthful default for a
      // batch that echoed a strip.
      //
      // An entry whose `index` resolved to NO operation has no action to read
      // at all, and lands on `create` — a claim nothing establishes, the same
      // trigger as `UNATTRIBUTED_STRIP_OBJECT` one field over. It is tracked
      // separately (objectui#7170) rather than repaired here: unlike the object
      // name there is no correct value to fall back to, and `operation` is
      // REQUIRED `'create' | 'update'` on the published `WriteWarningEvent`, so
      // saying "unattributed" would move that surface. Today's sole consumer
      // does not read `operation`, and the boundary suite pins the current
      // value so a change to it cannot land unnoticed.
      const operation: 'create' | 'update' = (op?.action ?? 'create') === 'create' ? 'create' : 'update';
      this.emitWriteWarning({
        operation,
        resource: object,
        ...(op?.id !== undefined && op?.id !== null ? { id: op.id } : {}),
        droppedFields: [live],
      });
    }
  }

  /**
   * Subscribe to write-warning events (a create/update dropped caller-supplied
   * fields — objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455). Returns an unsubscribe function. The app shell uses
   * this to toast the user; the write itself already succeeded.
   */
  onWriteWarning(callback: WriteWarningListener): () => void {
    this.writeWarningListeners.add(callback);
    return () => {
      this.writeWarningListeners.delete(callback);
    };
  }

  /**
   * Subscribe to metadata save-advisory events — the runtime authoring gate's
   * advisory findings on a save that SUCCEEDED (#4237; backend
   * objectstack#7435). Returns an unsubscribe function.
   *
   * Deliberately the same seam as {@link onWriteWarning} (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455), which
   * is what {@link MetadataSaveAdvisoryEvent}'s own declaration already said it
   * was modelled on. It is a SIBLING of that channel rather than a second
   * payload pushed down it: `WriteWarningEvent` is a closed shape whose
   * `droppedFields` is required and means "fields the write legally stripped",
   * so carrying advisories on it would either force every existing
   * `onWriteWarning` consumer to grow a branch or make the event lie about what
   * happened. The seam's SHAPE is what is reused here — a long-lived instance
   * with a `subscribe → unsubscribe` registration that `AdapterProvider` wires
   * once — not its event type.
   *
   * Why here and not on the config, which is how the other client class does it
   * (#4133/#4236): `MetadataClient` is minted per component by
   * `useMetadataClient`, so it has no instance to subscribe to and its sink
   * rides the factory. `ObjectStackAdapter` is the opposite — one long-lived
   * instance per app, already carrying this exact subscription pattern.
   */
  onSaveAdvisory(callback: MetadataSaveAdvisoryListener): () => void {
    this.saveAdvisoryListeners.add(callback);
    return () => {
      this.saveAdvisoryListeners.delete(callback);
    };
  }

  /**
   * Notify all save-advisory subscribers. Isolated exactly like
   * {@link emitWriteWarning}: a throwing listener must neither break the save
   * nor starve the others.
   */
  private emitSaveAdvisory(event: MetadataSaveAdvisoryEvent): void {
    for (const listener of this.saveAdvisoryListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('ObjectStackAdapter: save-advisory listener error', err);
      }
    }
  }

  /**
   * Subscribe to metadata read-warning events — a metadata READ that could not
   * be answered and was degraded to an empty result anyway (objectui#7741).
   * Returns an unsubscribe function. The app shell uses this to toast the user;
   * the caller has already been handed the empty result.
   *
   * Deliberately the same seam as {@link onWriteWarning} and
   * {@link onSaveAdvisory}, and a SIBLING of them rather than a payload pushed
   * down either: both of those announce a write that SUCCEEDED, and an event
   * saying "this read did not happen" carried on one of them would make it lie
   * about what occurred. What is reused is the seam's SHAPE — one long-lived
   * instance with a `subscribe -> unsubscribe` registration that
   * `AdapterProvider` wires once — not its event type.
   *
   * ⛔ Nothing here changes what a caller RECEIVES. `listImportMappings` still
   * answers `[]` on every failure, including the loud ones; this channel is
   * added ALONGSIDE that return, which is why it is not a change to a surface
   * published since `@object-ui/data-objectstack@17.1.0`.
   */
  onMetadataReadWarning(callback: MetadataReadWarningListener): () => void {
    this.metadataReadWarningListeners.add(callback);
    return () => {
      this.metadataReadWarningListeners.delete(callback);
    };
  }

  /**
   * Notify all metadata read-warning subscribers. Isolated exactly like
   * {@link emitWriteWarning}: a throwing listener must neither break the caller
   * nor starve the others.
   */
  private emitMetadataReadWarning(event: MetadataReadWarningEvent): void {
    for (const listener of this.metadataReadWarningListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('ObjectStackAdapter: metadata read-warning listener error', err);
      }
    }
  }

  /**
   * Install the ONE emitter for the metadata save door (#4237).
   *
   * ## Why this seam, and what it covers
   *
   * `ObjectStackClient.meta.saveItem` is the second client class that writes
   * through `PUT /api/v1/meta/:type/:name`, and every one of its callers reaches
   * it through an adapter this class constructed — the three inside this file
   * (the two view paths, `updateDashboard`) via
   * `this.client`, and every caller outside it via {@link getClient}, which
   * hands back this same instance: `MetadataService` (app-shell, five saves),
   * `useNavigationSync`, and plugin-designer's Create/EditAppPage. Wrapping the
   * method once here therefore covers all of them WITHOUT a per-site edit, which
   * is the whole point — a toast copied into a dozen call sites is the shape
   * #4133 rejected for the other client class and it is no better here.
   *
   * `meta` is an own, writable property assigned per instance in the SDK's
   * constructor (`this.meta = { … }`), and the client this adapter builds is
   * never shared, so the wrap is bounded to an object this adapter owns for its
   * whole lifetime. It is not a prototype or global patch.
   *
   * ## Response shape — measured, not assumed
   *
   * The two client classes' envelopes coincide at the top level, which is what
   * makes `readSaveAdvisories` reusable unchanged across both. `SaveMetaItem-
   * ResponseSchema` puts `advisories` at the body's top level next to
   * `success` / `version` / `seq` / `state`, and the SDK's `unwrapResponse`
   * strips its `{ success, data }` envelope only when the body actually HAS a
   * `data` key — this body does not, so it is returned verbatim. So the same
   * reader that `MetadataClient.save` uses reads this response correctly, and
   * the pins in `onSaveAdvisory.test.ts` drive a real SDK client through a fake
   * `fetch` rather than stubbing `meta`, so that continues to be measured.
   *
   * ## Draft-door honesty (D1)
   *
   * Drafts are NEVER gated: the framework returns at its D1 early-return
   * (`if (args.state !== 'active') return null`) before running a rule, so a
   * draft save produces no findings to withhold. `mode` on the emitted event is
   * derived from the response's own `state`, not from the caller's options:
   * `'draft'` when the server says the row landed as a draft, `'publish'`
   * otherwise. The server's answer is the one that says which door the write
   * took, so the event cannot claim a door the request only asked for.
   *
   * ## Every argument is forwarded (objectui#12300)
   *
   * The SDK's `saveItem(type, name, item, options?)` carries the write's scope
   * in its fourth argument, `SaveMetaItemOptions`: `packageId` (`?package=`),
   * `force`, `mode` and `ifMatch`. This wrapper used to name three parameters
   * and call the original with three, so that bag was dropped before the SDK
   * saw it. Every caller reaching the SDK through {@link getClient} got a bare
   * `PUT` whatever it passed, while the declared signature still accepted the
   * bag, so nothing at the call site could tell. The wrapper now takes and
   * passes the original's own parameter list, so it forwards whatever the SDK
   * declares, today's bag and any later member, without naming one.
   */
  private installSaveAdvisoryInterceptor(): void {
    const meta = this.client.meta;
    const original = meta.saveItem.bind(meta);
    meta.saveItem = async (...args: Parameters<typeof original>) => {
      const [type, name] = args;
      const result = await original(...args);
      // Everything below is best-effort by construction: the row is already
      // committed server-side, so nothing the advisory channel does may change
      // what this call returns or whether it throws.
      try {
        const advisories = readSaveAdvisories(result);
        if (advisories.length > 0) {
          this.emitSaveAdvisory({
            type,
            name,
            // #5026 — this interceptor wraps `meta.saveItem`, the SAVE door
            // (`PUT /meta/:type/:name`) and only that one. The SDK's publish
            // door (`meta.publishItem`) has no caller in this repo, so wiring
            // it here would be a surface with no consumer; `MetadataClient` is
            // where the publish door is actually taken.
            door: 'save',
            mode: (result as { state?: string } | null | undefined)?.state === 'draft' ? 'draft' : 'publish',
            advisories,
          });
        }
      } catch (err) {
        /* an advisory must never turn a committed save into a thrown error */
        console.warn('ObjectStackAdapter: save-advisory read error', err);
      }
      return result;
    };
  }

  /**
   * Route this adapter's client's published view-list read through the one
   * {@link VIEW_LIST_KEY} (objectui#13044).
   *
   * The app-shell `MetadataProvider` reads `client.meta.getItems('view')`
   * through {@link getClient}; {@link listViews} and {@link listViewOverrides}
   * read the same `GET /api/v1/meta/view`. Each used to put its own request on
   * the wire, so one list-page open asked the server three times for one URL.
   *
   * A caller of the client keeps its contract, "ask the server": it is never
   * answered from a settled entry. It joins a request already in flight for
   * the same URL instead of sending a second one, and its answer is stored
   * under {@link VIEW_LIST_KEY} (see {@link MetadataCache.share}), which is
   * what {@link readViewList} answers this adapter's own readers from
   * (objectui#13057). Only the bare call is routed: any argument after the
   * type changes the URL, so such a call goes straight to the SDK.
   *
   * Every caller gets its own copy of the answer. Before this, every reader
   * got its own parsed response, so a reader that changed what it was handed
   * changed nothing anyone else read; a shared answer must not change that.
   *
   * Same wrap shape and the same bound as `installSaveAdvisoryInterceptor`:
   * `meta` is an own property of a client this adapter built and never shares.
   */
  private installViewListShare(): void {
    const meta = this.client.meta;
    const original = meta.getItems.bind(meta);
    meta.getItems = ((...args: Parameters<typeof original>) => {
      if (args[0] !== 'view' || args.length > 1) return original(...args);
      return this.metadataCache
        .share(VIEW_LIST_KEY, () => original(...args))
        .then((answer) => structuredClone(answer));
    }) as typeof meta.getItems;

    // A write to a `view` row through this client, from any caller (a page
    // that saves a view with `getClient().meta.saveItem` directly, not only
    // through {@link invalidateViewKeys}), drops the stored list and detaches
    // the list request in flight once it settles, so a read asked after the
    // write is never answered by a list read before it.
    for (const door of ['saveItem', 'deleteItem', 'publishItem', 'rollbackItem'] as const) {
      const write = meta[door] as ((...args: any[]) => Promise<unknown>) | undefined;
      if (typeof write !== 'function') continue;
      const bound = write.bind(meta);
      (meta as any)[door] = (...args: any[]) => {
        if (args[0] !== 'view') return bound(...args);
        return bound(...args).finally(() => this.metadataCache.invalidate?.(VIEW_LIST_KEY));
      };
    }
  }

  /**
   * The published view list for this adapter's own readers
   * ({@link listViews}, {@link listViewOverrides}): the answer stored under
   * {@link VIEW_LIST_KEY} while it holds one (objectui#13057), else the
   * client's read, which joins the request in flight for that key or starts
   * one, and stores its answer (objectui#13044). Always a copy the caller may
   * keep. Every path that should see a fresh list drops the key first; the
   * list is in {@link VIEW_LIST_KEY}'s doc.
   */
  private readViewList(): Promise<any> {
    const settled = this.metadataCache.getCachedSync(VIEW_LIST_KEY);
    if (settled !== undefined) return Promise.resolve(structuredClone(settled));
    return this.client.meta.getItems('view');
  }

  async create(resource: string, data: Partial<T>): Promise<T> {
    await this.connect();
    try {
      const result = await this.client.data.create<T>(resource, data);
      this.emitMutation({ type: 'create', resource, record: { ...result.record } });
      this.notifyDroppedFields(
        'create',
        resource,
        result,
        (result.record as { id?: string | number } | undefined)?.id,
        data as Record<string, unknown>,
      );
      return result.record;
    } catch (err) {
      // `update` has always normalised; `create` did not, so a rejected insert
      // reached callers as the raw client error — no typed shape to branch on,
      // and its `fields[]` unreachable. A create is the path that most often
      // trips required-field validation, so it needs this more, not less.
      throw normaliseClientError(err);
    }
  }

  /**
   * Update an existing record.
   *
   * Optional `opts.ifMatch` enables Optimistic Concurrency Control: the
   * server compares the supplied token (typically the `updated_at` value
   * the caller previously read) against the record's current version
   * and throws a {@link ConcurrentUpdateError} on mismatch (HTTP 409).
   *
   * Requires `@objectstack/client@>=4.2.0`, which forwards `opts.ifMatch`
   * as an `If-Match` HTTP header.
   */
  async update(
    resource: string,
    id: string | number,
    data: Partial<T>,
    opts?: { ifMatch?: string },
  ): Promise<T> {
    await this.connect();
    try {
      const result = await this.client.data.update<T>(
        resource,
        String(id),
        data,
        opts?.ifMatch ? { ifMatch: opts.ifMatch } : undefined,
      );
      // String, as sent on the wire above (objectui#10078): the event states
      // the protocol id, whatever this method's wider parameter admitted.
      this.emitMutation({ type: 'update', resource, id: String(id), record: { ...result.record } });
      this.notifyDroppedFields('update', resource, result, id, data as Record<string, unknown>);
      return result.record;
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /**
   * Delete a record.
   *
   * Optional `opts.ifMatch` enables Optimistic Concurrency Control —
   * see {@link update} for details. On 409 the call rejects with
   * a {@link ConcurrentUpdateError}.
   */
  async delete(
    resource: string,
    id: string | number,
    opts?: { ifMatch?: string },
  ): Promise<boolean> {
    await this.connect();
    try {
      const result = await this.client.data.delete(
        resource,
        String(id),
        opts?.ifMatch ? { ifMatch: opts.ifMatch } : undefined,
      );
      // `success`, not `deleted` (objectstack#5638). `DeleteDataResult.deleted`
      // was a key no schema ever declared and no server path ever returned on
      // `DELETE /data/:object/:id` — the client's interface was a wrong CLAIM
      // about the response body, and `@objectstack/client` 17.0.0-rc.5
      // corrected it to the schema's `success`.
      //
      // This was live here, not cosmetic: `result.deleted` compiled and read
      // `undefined` at runtime, so the guard below never fired — a successful
      // delete emitted NO mutation event, leaving every subscriber's cache
      // stale — and this method, declared `Promise<boolean>`, actually resolved
      // `undefined`. Following the rename is what restores both.
      if (result.success) {
        this.emitMutation({ type: 'delete', resource, id: String(id) });
      }
      return result.success;
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /**
   * Apply the same patch to many records in a single round-trip.
   *
   * Sends one `POST /api/v1/data/:object/updateMany` request whose body
   * is `{ records: ids.map(id => ({id, data: patch})), options: { continueOnError: true }}`.
   * The server iterates server-side (still N engine writes) but the
   * client only pays for ONE HTTP/auth/RLS round-trip — the relevant
   * perf win for inbox / list-toolbar "mark all read" / "archive
   * selected" interactions where N can easily be in the hundreds.
   *
   * Falls back to a sequential per-id loop when the connected client
   * does not expose `updateMany` (older clients / offline adapters).
   * In that case `continueOnError` semantics are emulated locally so
   * callers see the same return shape.
   */
  async bulkUpdate(
    resource: string,
    ids: ReadonlyArray<string | number>,
    patch: Partial<T>,
  ): Promise<number> {
    await this.connect();
    if (!ids || ids.length === 0) return 0;
    const records = ids.map((id) => ({ id: String(id), data: patch as any }));

    // Notify subscribers once for the whole batch (not per-id) so a single
    // "mark all read"/"archive selected" refreshes bound views exactly once.
    const emitBulk = (count: number): number => {
      if (count > 0) this.emitMutation({ type: 'update', resource });
      return count;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateMany = (this.client.data as any).updateMany;
    if (typeof updateMany === 'function') {
      try {
        const res = await updateMany(resource, records, { continueOnError: true });
        // The server returns BatchUpdateResponse { succeeded, failed, ... };
        // fall back to ids.length on adapters that return a bare array.
        if (res && typeof res === 'object' && typeof (res as any).succeeded === 'number') {
          return emitBulk((res as any).succeeded as number);
        }
        if (Array.isArray(res)) return emitBulk((res as any[]).length);
        return emitBulk(ids.length);
      } catch (err) {
        throw normaliseClientError(err);
      }
    }

    // Fallback: sequential per-id updates, tolerating failures.
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.client.data.update<T>(resource, String(id), patch);
        succeeded++;
      } catch {
        // continueOnError semantics — swallow per-row errors
      }
    }
    return emitBulk(succeeded);
  }

  /**
   * Single-call bulk delete. Mirrors the bulkUpdate contract: prefers
   * the server's `deleteMany` primitive when the client supports it;
   * otherwise emulates `continueOnError` by looping `delete` per id and
   * swallowing per-row failures. Returns the count of rows reported
   * deleted by the server (or successfully deleted in fallback mode).
   */
  async bulkDelete(
    resource: string,
    ids: ReadonlyArray<string | number>,
  ): Promise<number> {
    await this.connect();
    if (!ids || ids.length === 0) return 0;
    const strIds = ids.map((id) => String(id));

    // Notify subscribers once for the whole batch (see bulkUpdate).
    const emitBulk = (count: number): number => {
      if (count > 0) this.emitMutation({ type: 'delete', resource });
      return count;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteMany = (this.client.data as any).deleteMany;
    if (typeof deleteMany === 'function') {
      try {
        const res = await deleteMany(resource, strIds, { continueOnError: true });
        if (res && typeof res === 'object' && typeof (res as any).succeeded === 'number') {
          return emitBulk((res as any).succeeded as number);
        }
        if (Array.isArray(res)) return emitBulk((res as any[]).length);
        // deleteMany historically returns void on success — assume all hit.
        return emitBulk(strIds.length);
      } catch (err) {
        throw normaliseClientError(err);
      }
    }

    // Fallback: sequential per-id deletes, tolerating failures.
    let succeeded = 0;
    for (const id of strIds) {
      try {
        await this.client.data.delete(resource, id);
        succeeded++;
      } catch {
        // continueOnError semantics — swallow per-row errors
      }
    }
    return emitBulk(succeeded);
  }

  /**
   * Bulk operations with optimized batch processing and error handling.
   * Emits progress events for tracking operation status.
   * 
   * @param resource - Resource name
   * @param operation - Operation type (create, update, delete)
   * @param data - Array of records to process
   * @returns Promise resolving to array of results
   */
  /**
   * Cross-object transactional batch (objectstack-ai/objectstack#1604 / ADR-0034 item 4).
   * Runs the operations in ONE server transaction — commit all or roll back
   * all. A field value of `{ $ref: <earlier op index> }` resolves to that op's
   * created id, so a child can reference its parent created earlier in the same
   * batch (master-detail).
   *
   * Transport: the published `@objectstack/client` SDK method
   * `data.batchTransaction` (objectstack-ai/objectstack#3271; shipped since client v16, our
   * dependency floor). Per AGENTS.md §7 data always flows through the client —
   * never a hand-rolled `fetch('/api/v1/batch')`.
   *
   * Fallback decision — declarative capability negotiation (objectstack-ai/objectstack#3298 /
   * objectui #2693). At connect() we read `capabilities.transactionalBatch`
   * from discovery:
   *   - Declared `true` → the backend GUARANTEES atomicity (declared ===
   *     enforced). We TRUST it: any batch failure — including 404/405/501 —
   *     surfaces as a real error. No non-atomic client-side compensation. This
   *     is the path modern backends take.
   *   - Declared `false`, or ABSENT (backend predates objectstack-ai/objectstack#3298) → we can't rely on
   *     server atomicity, so we keep the legacy behaviour: on 404/405 (no
   *     endpoint) or 501 (runtime without transactions) degrade to the
   *     client-side, NON-atomic {@link emulateBatchTransaction} so a save is
   *     still possible. Removing that here would regress older backends from
   *     "saves, less safe" to "no save path" (#2679 compatibility constraint).
   *     The non-atomic fallback stays isolated to THIS adapter.
   */
  async batchTransaction(
    operations: BatchTransactionOperation[],
  ): Promise<{ results: any[] }> {
    // Ensure discovery (and thus the objectstack-ai/objectstack#3298 capability) is loaded so the
    // decision below is declarative, not "fire a batch and read the status".
    await this.connect();

    // When the backend declares atomic batch support we never degrade: a
    // failure is a real error, not a cue to fall back. Otherwise (declared
    // false, or capability absent on a pre-objectstack-ai/objectstack#3298 backend) the emulation
    // fallback below stays active.
    const guaranteed = this.atomicBatchCapability === true;

    // Already degraded on a non-declaring backend — skip the SDK call.
    // (Unreachable once `guaranteed`: that path never sets `batchUnsupported`.)
    if (!guaranteed && this.batchUnsupported) {
      return emulateBatchTransaction(this, operations);
    }

    try {
      // Typed SDK method — guaranteed present by the `@objectstack/client@^16`
      // dependency floor (objectstack-ai/objectstack#3271). No hand-rolled POST /api/v1/batch.
      const payload = await this.client.data.batchTransaction(operations);
      this.emitBatchMutations(operations, payload?.results);
      this.notifyBatchDroppedFields(operations, payload);
      return payload;
    } catch (err) {
      // On a non-declaring backend, endpoint missing (404/405) or a runtime that
      // can't do transactions (the framework rest-server answers 501
      // "Transactional batch not supported by this runtime") → degrade to the
      // non-atomic client emulation so the save still goes through. When the
      // backend DECLARED support (`guaranteed`), even these are hard errors — a
      // server that advertised the capability must honour it. Every other status
      // (400 validation, 401/403 auth, 409 conflict, 500 fault) is a real error
      // the caller must see — never silently retried.
      const status = this.errorStatusOf(err);
      if (!guaranteed && this.batchStatusUnsupported(status)) {
        return this.fallbackToEmulation(operations, status);
      }
      throw err;
    }
  }

  /** True for statuses that mean "this backend can't do a transactional batch". */
  private batchStatusUnsupported(status: number | undefined): boolean {
    return status === 404 || status === 405 || status === 501;
  }

  /** Best-effort HTTP status extraction from a thrown SDK/client error. */
  private errorStatusOf(err: unknown): number | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const e = err as Record<string, unknown>;
    const s = e.httpStatus ?? e.status ?? e.statusCode;
    return typeof s === 'number' ? s : undefined;
  }

  /** Mark the endpoint unsupported (warn once) and serve via emulation. */
  private fallbackToEmulation(
    operations: BatchTransactionOperation[],
    status: number | undefined,
  ): Promise<{ results: any[] }> {
    if (!this.batchUnsupported) {
      this.batchUnsupported = true;
      console.warn(
        `ObjectStackAdapter: POST /api/v1/batch unavailable (HTTP ${status ?? '?'}) — ` +
          'falling back to non-atomic client-side batch emulation. Cross-object ' +
          'saves on this backend are best-effort, not transactional.',
      );
    }
    return emulateBatchTransaction(this, operations);
  }

  /**
   * Emit one DataSourceMutationEvent per committed operation so the invalidation bus
   * (#2269) sees writes that went through /batch exactly like single
   * create/update/delete calls — master-detail ModalForm saves otherwise leave
   * related lists and count badges stale (#2582). `results` is index-aligned
   * with `operations`; creates take id/record from the server echo.
   *
   * Only called on the server-committed paths. The emulation branch drives the
   * adapter's own create/update/delete primitives, which already emit — so it
   * must NOT be routed through here, or events would double-fire.
   */
  private emitBatchMutations(
    operations: BatchTransactionOperation[],
    rawResults: unknown,
  ): void {
    const results = Array.isArray(rawResults) ? rawResults : [];
    operations.forEach((op, i) => {
      const action = op.action ?? 'create';
      const echo = results[i];
      if (action === 'create') {
        this.emitMutation({ type: 'create', resource: op.object, record: echo });
      } else if (action === 'update') {
        this.emitMutation({ type: 'update', resource: op.object, id: op.id ?? echo?.id ?? echo?._id, record: echo });
      } else if (action === 'delete') {
        this.emitMutation({ type: 'delete', resource: op.object, id: op.id });
      }
    });
  }

  async bulk(resource: string, operation: 'create' | 'update' | 'delete', data: Partial<T>[]): Promise<T[]> {
    await this.connect();

    if (!data || data.length === 0) {
      return [];
    }

    const total = data.length;
    let completed = 0;
    let failed = 0;

    const emitProgress = () => {
      this.emitBatchProgress({
        operation,
        total,
        completed,
        failed,
        percentage: total > 0 ? (completed + failed) / total * 100 : 0,
      });
    };

    try {
      switch (operation) {
        case 'create': {
          emitProgress();
          const created = await this.client.data.createMany<T>(resource, data);
          completed = created.length;
          failed = total - completed;
          emitProgress();
          // One resource-level event for the whole batch (same contract as
          // bulkUpdate/bulkDelete) so bound views refresh after subform child
          // rows are created through this path (#2582).
          if (completed > 0) this.emitMutation({ type: 'create', resource });
          return created;
        }
        
        case 'delete': {
          const ids = data.map(item => (item as Record<string, unknown>).id).filter(Boolean) as string[];
          
          if (ids.length === 0) {
            // Track which items are missing IDs
            const errors = data.map((_, index) => ({
              index,
              error: `Missing ID for item at index ${index}`
            }));
            
            failed = data.length;
            emitProgress();
            
            throw new BulkOperationError('delete', 0, data.length, errors);
          }
          
          emitProgress();
          await this.client.data.deleteMany(resource, ids);
          completed = ids.length;
          failed = total - completed;
          emitProgress();
          // One resource-level event per batch — see the create branch.
          if (completed > 0) this.emitMutation({ type: 'delete', resource });
          return [] as T[];
        }
        
        case 'update': {
          // Check if client supports updateMany
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof (this.client.data as any).updateMany === 'function') {
            try {
              emitProgress();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const updateMany = (this.client.data as any).updateMany;
              const updated = await updateMany(resource, data) as T[];
              completed = updated.length;
              failed = total - completed;
              emitProgress();
              // One resource-level event per batch — see the create branch.
              if (completed > 0) this.emitMutation({ type: 'update', resource });
              return updated;
            } catch {
              // If updateMany is not supported, fall back to individual updates
              // Silently fallback without logging
            }
          }
          
          // Fallback: Process updates individually with detailed error tracking and progress
          const results: T[] = [];
          const errors: Array<{ index: number; error: unknown }> = [];
          
          for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const id = (item as Record<string, unknown>).id;
            
            if (!id) {
              errors.push({ index: i, error: 'Missing ID' });
              failed++;
              emitProgress();
              continue;
            }
            
            try {
              const result = await this.client.data.update<T>(resource, String(id), item);
              results.push(result.record);
              completed++;
              emitProgress();
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push({ index: i, error: errorMessage });
              failed++;
              emitProgress();
            }
          }
          
          // Rows that DID persist must still reach subscribers, even when the
          // batch as a whole reports failure below (continueOnError semantics
          // — the successful writes are not rolled back).
          if (completed > 0) this.emitMutation({ type: 'update', resource });

          // If there were any errors, throw BulkOperationError
          if (errors.length > 0) {
            throw new BulkOperationError(
              'update',
              results.length,
              errors.length,
              errors,
              { resource, totalRecords: data.length }
            );
          }

          return results;
        }
        
        default:
          throw new ObjectStackError(
            `Unsupported bulk operation: ${operation}`,
            'UNSUPPORTED_OPERATION',
            400
          );
      }
    } catch (error: unknown) {
      // Emit final progress with failure
      emitProgress();
      
      // If it's already a BulkOperationError, re-throw it
      if (error instanceof BulkOperationError) {
        throw error;
      }
      
      // If it's already an ObjectStackError, re-throw it
      if (error instanceof ObjectStackError) {
        throw error;
      }
      
      // Wrap other errors in BulkOperationError with proper error tracking
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errors = data.map((_, index) => ({
        index,
        error: errorMessage
      }));
      
      throw new BulkOperationError(
        operation,
        0,
        data.length,
        errors,
        { resource, originalError: error }
      );
    }
  }

  /**
   * Bulk-import raw spreadsheet rows in a single server round-trip via
   * `POST /api/v1/data/:object/import`. The server performs all value coercion
   * (booleans, numbers, dates→ISO, select label→code, lookup name→id) from the
   * object's field metadata, so this method forwards the request verbatim and
   * returns the aggregate + per-row result untouched.
   *
   * Requires `@objectstack/client` with `data.import` (server `/import` route).
   * Callers should feature-detect (`typeof dataSource.importRecords`) and fall
   * back to a per-row `create` loop when unavailable.
   */
  async importRecords(
    resource: string,
    request: ImportRequestOptions,
  ): Promise<ImportRecordsResult> {
    await this.connect();
    const importFn = (this.client.data as { import?: unknown }).import;
    if (typeof importFn !== 'function') {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support data.import(). ' +
          'Upgrade the client, or import via a per-row create fallback.',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      const result = await (importFn as (
        object: string,
        req: ImportRequestOptions,
      ) => Promise<ImportRecordsResult>).call(this.client.data, resource, request);
      return result;
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /**
   * Feature-detect the async import-job API on the connected client. Older
   * clients/servers lack these routes; callers fall back to {@link importRecords}.
   */
  private importJobApi(): {
    createImportJob: (object: string, req: ImportRequestOptions) => Promise<CreateImportJobResult>;
    getImportJobProgress: (jobId: string) => Promise<ImportJobProgressInfo>;
    getImportJobResults: (jobId: string) => Promise<ImportJobResultsInfo>;
    listImportJobs: (query: ListImportJobsOptions) => Promise<ImportJobSummaryInfo[]>;
    cancelImportJob: (jobId: string) => Promise<{ success: boolean }>;
    undoImportJob: (jobId: string) => Promise<ImportJobUndoResult>;
  } | undefined {
    const d = this.client.data as Record<string, unknown>;
    if (typeof d.createImportJob !== 'function') return undefined;
    return d as any;
  }

  /**
   * Start an asynchronous import job — the large-file counterpart to
   * {@link importRecords}. Posts the whole payload once; the server processes
   * rows in the background. Requires an `@objectstack/client` new enough to
   * expose `data.createImportJob` (server `/import/jobs` route). Callers should
   * feature-detect (`typeof dataSource.createImportJob`) and fall back to the
   * synchronous path when unavailable.
   */
  async createImportJob(
    resource: string,
    request: ImportRequestOptions,
  ): Promise<CreateImportJobResult> {
    await this.connect();
    const api = this.importJobApi();
    if (!api) {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support async import jobs (data.createImportJob). ' +
          'Upgrade the client, or use the synchronous importRecords() path.',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      return await api.createImportJob.call(this.client.data, resource, request);
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /** Poll an import job's progress. Requires {@link createImportJob} support. */
  async getImportJobProgress(jobId: string): Promise<ImportJobProgressInfo> {
    await this.connect();
    const api = this.importJobApi();
    if (!api) {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support async import jobs.',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      return await api.getImportJobProgress.call(this.client.data, jobId);
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /** Fetch an import job's capped per-row results. */
  async getImportJobResults(jobId: string): Promise<ImportJobResultsInfo> {
    await this.connect();
    const api = this.importJobApi();
    if (!api) {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support async import jobs.',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      return await api.getImportJobResults.call(this.client.data, jobId);
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /** List recent import jobs (history), newest first. */
  async listImportJobs(options: ListImportJobsOptions = {}): Promise<ImportJobSummaryInfo[]> {
    await this.connect();
    const api = this.importJobApi();
    if (!api) {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support async import jobs.',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      return await api.listImportJobs.call(this.client.data, options);
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /** Cancel a pending/running import job (cooperative). */
  async cancelImportJob(jobId: string): Promise<void> {
    await this.connect();
    const api = this.importJobApi();
    if (!api) {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support async import jobs.',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      await api.cancelImportJob.call(this.client.data, jobId);
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /**
   * Logically roll back a finished import job — delete the records it created
   * and restore the records it updated to their pre-import values. Requires an
   * `@objectstack/client` new enough to expose `data.undoImportJob`, and a job
   * the server captured an undo log for (see {@link ImportJobProgressInfo.undoable}).
   */
  async undoImportJob(jobId: string): Promise<ImportJobUndoResult> {
    await this.connect();
    const api = this.importJobApi();
    if (!api || typeof (api as { undoImportJob?: unknown }).undoImportJob !== 'function') {
      throw new ObjectStackError(
        'The connected @objectstack/client does not support undoing import jobs (data.undoImportJob).',
        'UNSUPPORTED_OPERATION',
        400,
      );
    }
    try {
      return await api.undoImportJob.call(this.client.data, jobId);
    } catch (err) {
      throw normaliseClientError(err);
    }
  }

  /**
   * Normalize the result from data.find() or data.query() into a consistent QueryResult.
   */
  private normalizeQueryResult(result: unknown, params?: QueryParams): QueryResult<T> {
    // Handle legacy/raw array response (e.g. from some mock servers or non-OData endpoints)
    if (Array.isArray(result)) {
      return {
        data: result,
        total: result.length,
        page: 1,
        pageSize: result.length,
        hasMore: false,
      };
    }

    const resultObj = result as { records?: T[]; total?: number; value?: T[]; count?: number; hasMore?: boolean };
    const records = resultObj.records || resultObj.value || [];
    const total = resultObj.total ?? resultObj.count ?? records.length;
    // Prefer the server's `hasMore` (real server-side pagination, framework
    // issue objectstack-ai/objectstack#2212). Fall back to the page-local estimate (a full page implies
    // there may be more) only when the server doesn't report it.
    const hasMore = typeof resultObj.hasMore === 'boolean'
      ? resultObj.hasMore
      : (params?.$top ? records.length === params.$top : false);
    return {
      data: records,
      total,
      // Calculate page number safely
      page: params?.$skip && params.$top ? Math.floor(params.$skip / params.$top) + 1 : 1,
      pageSize: params?.$top,
      hasMore,
    };
  }

  /**
   * Make a raw GET request to the data API with `populate` as a URL query param.
   * Used when $expand is needed, since the client SDK's data.find() does not
   * support populate/expand. The server's REST API routes GET /data/:object
   * to findData({ object, query: req.query }) which processes `populate`.
   */
  private async rawFindWithPopulate(resource: string, params: QueryParams): Promise<unknown> {
    const queryParams = new URLSearchParams();

    // Populate: comma-separated field names for lookup expansion
    if (params.$expand && params.$expand.length > 0) {
      queryParams.set('populate', params.$expand.join(','));
    }

    // Pagination
    if (params.$top !== undefined) {
      queryParams.set('top', String(params.$top));
    }
    if (params.$skip !== undefined) {
      queryParams.set('skip', String(params.$skip));
    }

    // Full-text search (ADR-0061). The server resolves which fields to match
    // from object metadata; the client only sends the term (+ optional override).
    if (params.$search != null && String(params.$search).trim() !== '') {
      queryParams.set('search', String(params.$search).trim());
    }
    if (params.$searchFields && params.$searchFields.length > 0) {
      queryParams.set('searchFields', params.$searchFields.join(','));
    }

    // Selection — always include `id` to ensure records can be identified
    // for navigation/selection even when callers omit it from $select.
    if (params.$select && params.$select.length > 0) {
      const selectFields = params.$select.includes('id')
        ? params.$select
        : ['id', ...params.$select];
      queryParams.set('select', selectFields.join(','));
    }

    // Sorting
    const sortStr = serializeOrderBy(params.$orderby);
    if (sortStr) queryParams.set('sort', sortStr);

    // Filter — translate ViewFilterRule[] (`[{field, operator, value}]`)
    // and other shapes into AST tuples the server understands. Without this,
    // server-driven views (e.g. `at_risk_accounts`, `hot_leads`) ship raw
    // `[{field,operator,value}]` arrays which `parseFilterAST` silently
    // discards, returning every record instead of the filtered subset.
    if (params.$filter !== undefined && params.$filter !== null) {
      const translated = translateFilterToAST(params.$filter);
      if (translated !== undefined) {
        queryParams.set('filter', JSON.stringify(translated));
      }
    }

    const baseUrl = this.baseUrl.replace(/\/$/, '');
    const qs = queryParams.toString();
    // Avoid doubling /api/v1 if baseUrl already includes it
    const hasApiVersionSuffix = /\/api\/v\d+$/i.test(baseUrl);
    const dataPath = hasApiVersionSuffix ? '/data' : '/api/v1/data';
    const url = `${baseUrl}${dataPath}/${resource}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await this.fetchImpl(url, { method: 'GET', headers });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ message: res.statusText }));
      const envelope = readErrorEnvelope(errorBody);
      const err = new Error(envelope.message ?? res.statusText) as any;
      err.status = res.status;
      // Carry the ADR-0112 envelope, not just the status. This branch bypasses
      // `@objectstack/client` — whose fetch wrapper stamps `code`/`httpStatus`
      // from the error body — so dropping the code here made THIS path (the one
      // taken whenever the view expands a lookup or runs a search) the only list
      // fetch on which a semantic denial arrives indistinguishable from any
      // other 404/405, leaving the surface nothing to discriminate on
      // (objectui#4408). Same precedence as the client's wrapper: the top-level
      // `code` first, then the nested envelope's.
      err.code = envelope.code;
      err.httpStatus = res.status;
      throw err;
    }

    const body = await res.json();
    // Unwrap standard response envelope { success, data }
    if (body && typeof body.success === 'boolean' && 'data' in body) {
      return body.data;
    }
    return body;
  }

  /**
   * Synchronously download a server-streamed export (csv / json / xlsx).
   *
   * Hits `GET /api/v1/data/:object/export`, which streams matching rows in the
   * requested format, formats values for readability (lookup → name, select →
   * label, boolean → 是/否, dates formatted) and enforces permissions. The
   * filter / sort are translated the same way as `rawFindWithPopulate` so the
   * exported file mirrors the active list view. Returns the file as a Blob;
   * the caller triggers the browser download.
   */
  async exportDownload(resource: string, request: ExportDownloadRequest = {}): Promise<Blob> {
    const queryParams = new URLSearchParams();

    const format = request.format === 'xlsx' ? 'xlsx' : request.format === 'json' ? 'json' : 'csv';
    queryParams.set('format', format);

    if (request.fields && request.fields.length > 0) {
      queryParams.set('fields', request.fields.join(','));
    }
    if (request.limit && request.limit > 0) {
      queryParams.set('limit', String(request.limit));
    }
    if (request.includeHeaders === false) {
      queryParams.set('header', 'false');
    }
    // Sort → server `orderby` shorthand: "field:dir,field2:dir".
    if (request.sort && request.sort.length > 0) {
      const orderby = request.sort
        .filter(s => s && s.field)
        .map(s => `${s.field}:${s.direction === 'desc' ? 'desc' : 'asc'}`)
        .join(',');
      if (orderby) queryParams.set('orderby', orderby);
    }
    // Filter → AST tuples, same translation the list GET path uses.
    if (request.filter !== undefined && request.filter !== null) {
      const translated = translateFilterToAST(request.filter);
      if (translated !== undefined) {
        queryParams.set('filter', JSON.stringify(translated));
      }
    }
    // Search — the other half of what a list is showing. Without it an export
    // taken while a search is active returns the unsearched superset
    // (objectstack#4230). Servers predating that ignore the param.
    const searchTerm = typeof request.search === 'string' ? request.search.trim() : '';
    if (searchTerm) {
      queryParams.set('search', searchTerm);
      if (request.searchFields && request.searchFields.length > 0) {
        queryParams.set('searchFields', request.searchFields.join(','));
      }
    }

    return this.fetchExportBlob(resource, queryParams);
  }

  /**
   * Download the server's import template:
   * `GET /api/v1/data/:object/export?template=true` (objectui#9600).
   *
   * Same route as {@link exportDownload}, with the server's template switch. It
   * sends only `template=true`: the server refuses the export's row parameters
   * on a template request, and its answer is always an xlsx workbook.
   *
   * The server writes the template's labels in the request's locale, and the
   * import accepts a translated label only in its own request's locale. The
   * import request goes through `@objectstack/client`, which stamps
   * `Accept-Language` with the client's locale when one is set (and the host's
   * `fetch` stamps its own otherwise). This request bypasses the client, so it
   * stamps the client's locale the same way. Both requests then carry the same
   * locale.
   */
  async downloadImportTemplate(resource: string): Promise<Blob> {
    const locale = this.client.getLocale();
    return this.fetchExportBlob(
      resource,
      new URLSearchParams({ template: 'true' }),
      locale ? { 'Accept-Language': locale } : undefined,
    );
  }

  /**
   * GET `/api/v1/data/:object/export` with the given query and answer the body
   * as a Blob. A failure throws an `Error` that carries the server's `status`
   * and its ADR-0112 `code`. The one request path {@link exportDownload} and
   * {@link downloadImportTemplate} share.
   */
  private async fetchExportBlob(
    resource: string,
    queryParams: URLSearchParams,
    extraHeaders?: Record<string, string>,
  ): Promise<Blob> {
    const baseUrl = this.baseUrl.replace(/\/$/, '');
    // Avoid doubling /api/v1 if baseUrl already includes the version suffix.
    const hasApiVersionSuffix = /\/api\/v\d+$/i.test(baseUrl);
    const dataPath = hasApiVersionSuffix ? '/data' : '/api/v1/data';
    const url = `${baseUrl}${dataPath}/${encodeURIComponent(resource)}/export?${queryParams.toString()}`;

    const headers: Record<string, string> = { ...this.getAuthHeaders(), ...extraHeaders };
    // `credentials: 'include'` carries the session cookie for the browser
    // console (which authenticates by cookie, not a bearer token).
    const res = await this.fetchImpl(url, { method: 'GET', headers, credentials: 'include' });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ message: res.statusText }));
      const envelope = readErrorEnvelope(errorBody);
      const err = new Error(envelope.message ?? res.statusText) as any;
      err.status = res.status;
      err.code = envelope.code;
      throw err;
    }
    return await res.blob();
  }

  /**
   * Convert ObjectUI QueryParams to ObjectStack QueryOptions.
   * Maps OData-style conventions to ObjectStack conventions.
   */
  private convertQueryParams(params?: QueryParams): ObjectStackQueryOptions {
    if (!params) return {};

    const options: ObjectStackQueryOptions = {};

    // Selection — always include `id` so records remain identifiable for
    // navigation/selection even when callers omit it from $select.
    if (params.$select) {
      options.select = params.$select.includes('id')
        ? params.$select
        : ['id', ...params.$select];
    }

    // Filtering - convert to ObjectStack FilterNode AST format. Treat empty
    // arrays/objects as "no filter" to avoid emitting `filter=[]` over the wire.
    if (params.$filter !== undefined && params.$filter !== null) {
      const isEmpty = Array.isArray(params.$filter)
        ? params.$filter.length === 0
        : typeof params.$filter === 'object' && Object.keys(params.$filter).length === 0;
      if (!isEmpty) {
        if (Array.isArray(params.$filter)) {
          // Two array shapes are accepted from upstream:
          //   1. AST tuples:  [field, op, value]                 — pass through.
          //   2. Object form: [{ field, operator, value }, ...]  — server-driven
          //      view configs (lead.view.ts etc.) use this. Translate each
          //      entry into the AST tuple shape and map human-readable
          //      operator names (`greater_than_or_equal`, `in`, `contains`,
          //      …) to the canonical symbols the server understands.
          // Shared with `translateFilterToAST` so the two `find()` routes — this
          // one and the `$expand`/`$search` raw GET — cannot disagree about the
          // same stored filter.
          options.filters = translateFilterArray(params.$filter);
        } else {
          // `undefined` means the filter constrains nothing — a filter that is
          // nothing but TRUE-identity combinators (`{ $and: [] }`,
          // objectui#8770). The slot is SKIPPED rather than assigned, the same
          // answer the raw-GET route's `if (translated !== undefined)` gives,
          // so the client emits no `filter` parameter and the server returns
          // every row. Assigning it would be harmless today (the client tests
          // `filterValue` for truthiness) but would make this route's contract
          // depend on that, and the two `find()` routes must not disagree about
          // one filter.
          const lowered = convertFiltersToAST(params.$filter);
          if (lowered !== undefined) options.filters = lowered;
        }
      }
    }

    // Sorting — the same serializer the raw GET route uses, so the two `find()`
    // paths cannot disagree about one stored sort. The client SDK's
    // `QueryOptions.sort` accepts the shorthand string directly.
    const sort = serializeOrderBy(params.$orderby);
    if (sort) options.sort = sort;

    // Pagination
    if (params.$skip !== undefined) {
      options.skip = params.$skip;
    }

    if (params.$top !== undefined) {
      options.top = params.$top;
    }

    if (params.$search != null && String(params.$search).trim() !== '') {
      (options as Record<string, unknown>).search = String(params.$search).trim();
    }
    if (params.$searchFields && params.$searchFields.length > 0) {
      (options as Record<string, unknown>).searchFields = params.$searchFields;
    }

    return options;
  }

  /**
   * Get object schema/metadata from ObjectStack.
   * Uses caching to improve performance for repeated requests.
   * 
   * @param objectName - Object name
   * @returns Promise resolving to the object schema
   */
  async getObjectSchema(objectName: string): Promise<unknown> {
    await this.connect();
    
    try {
      // Use cache with automatic fetching. The cache is keyed by object name
      // only (locale-independent); a language switch wipes it wholesale via
      // `clearCache()` so the next read re-fetches in the new locale — see the
      // shell's locale remount (issue objectstack-ai/objectstack#1319). Keeping the key locale-free here
      // means a metadata *write* still invalidates the single entry it knows
      // about, without having to fan out across every cached locale.
      // Read through a cache-revalidating fetch (see fetchObjectSchemaFresh):
      // the server marks single-object metadata `public, max-age=3600`, so a
      // plain fetch would keep serving the pre-publish schema from the browser
      // HTTP cache for up to an hour — and the create/edit form (which reads
      // getObjectSchema) would never show a field added + published in this
      // session. The list endpoint is uncached, which is why list views already
      // refresh on publish.
      const schema = await this.metadataCache.get(objectName, () =>
        this.fetchObjectSchemaFresh(objectName),
      );

      // Canonicalize the relational-target key onto `reference`, the only
      // spelling the spec declares and ObjectUI's readers read (objectui#11070
      // round 4): a stored def that still spells a legacy `reference_to` /
      // `referenceTo` is folded here — the choke point every schema read goes
      // through — so no consumer needs a dual-key fallback. `reference_to` is
      // never stamped. Idempotent on the cached object.
      normalizeSchemaReferenceKeys(schema);

      return schema;
    } catch (error: unknown) {
      // Check if it's a 404 error
      const errorObj = error as Record<string, unknown>;
      if (is404Error(errorObj)) {
        throw new MetadataNotFoundError(objectName, { originalError: error });
      }
      
      // For other errors, wrap in ObjectStackError if not already
      if (error instanceof ObjectStackError) {
        throw error;
      }
      
      throw createErrorFromResponse(errorObj, `getObjectSchema(${objectName})`);
    }
  }

  /**
   * Fetch a single object's schema while always revalidating the browser cache.
   *
   * The server serves `GET /api/v1/meta/object/:name` with
   * `Cache-Control: public, max-age=3600`, so the default `fetch` the SDK uses
   * keeps returning the same response from the browser HTTP cache for up to an
   * hour without contacting the origin. Because the create/edit form reads the
   * object schema through {@link getObjectSchema}, a field added + published in
   * the same session never appears in the form even though it is live (the LIST
   * endpoint, `/meta/object`, is uncached — which is why list views update).
   *
   * Issuing the read with `cache: 'no-cache'` forces a conditional revalidation
   * (`If-None-Match`): a changed ETag returns the fresh schema, an unchanged one
   * still gets a cheap `304`. We go through `fetchImpl` (the adapter's
   * authenticated fetch) rather than `client.meta.getItem` because the SDK does
   * not expose the request cache mode.
   */
  private async fetchObjectSchemaFresh(objectName: string): Promise<unknown> {
    const baseUrl = (this.baseUrl || '').replace(/\/$/, '');
    // Avoid doubling /api/v1 when baseUrl already carries the version suffix
    // (mirrors rawFindWithPopulate).
    const hasApiVersionSuffix = /\/api\/v\d+$/i.test(baseUrl);
    const metaPath = hasApiVersionSuffix ? '/meta' : '/api/v1/meta';
    const url = `${baseUrl}${metaPath}/object/${encodeURIComponent(objectName)}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Bearer (server-to-server) callers configure `this.token`; cookie/console
    // auth is injected by `fetchImpl` (the authenticated fetch wrapper).
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers,
      // Revalidate instead of serving the stale `max-age` body (see doc above).
      cache: 'no-cache',
    });

    if (!res.ok) {
      const errBody: any = await res.json().catch(() => ({ message: res.statusText }));
      const envelope = readErrorEnvelope(errBody);
      const err: any = new Error(envelope.message ?? res.statusText);
      err.status = res.status;
      err.code = envelope.code;
      throw err;
    }

    const body: any = await res.json();
    // Unwrap defensively across server/SDK response shapes: the standard
    // `{ success, data }` envelope, an `{ item }` wrapper, or the bare item.
    const data = body && typeof body === 'object' && 'success' in body && 'data' in body ? body.data : body;
    const item = data && typeof data === 'object' && 'item' in data ? data.item : data;
    // [#5729] Carry the ENVELOPE's per-column sortability projection
    // (objectstack#10235) across the unwrap that just discarded it.
    //
    // This line is the whole reason the signal was invisible to the grid: the
    // platform serves `sortability` BESIDE `item` — deliberately, since the
    // document is parsed `strict` server-side and the key must stay
    // un-authorable — and the unwrap above returns `item` alone, so every
    // consumer downstream saw a document with no signal on it and could only
    // conclude the platform had sent nothing.
    //
    // Re-attached under a symbol key, so it survives to the renderer without
    // becoming a document property: invisible to `JSON.stringify`, to
    // `Object.keys` and to a spread, which is what keeps a schema that is ever
    // handed back to a metadata write endpoint from carrying it into a body the
    // server would reject by name. No-op when the envelope carried no
    // projection (a backend older than the upstream change), so such a
    // deployment is left exactly as it was rather than being told, falsely,
    // that nothing is sortable.
    return attachObjectSortability(item, data && typeof data === 'object' ? (data as any).sortability : undefined);
  }

  /**
   * List every registered object (code- and DB-defined) from the metadata
   * registry — `GET /api/v1/meta/object`. Returns lightweight `{ name, label }`
   * headers for object-picker widgets (e.g. the sharing-rule `object-ref`
   * field). The list endpoint is uncached server-side, so no cache-busting
   * dance is needed. Returns `[]` on any failure so callers degrade gracefully.
   */
  async getObjects(): Promise<Array<{ name: string; label?: string }>> {
    try {
      await this.connect();
      const baseUrl = (this.baseUrl || '').replace(/\/$/, '');
      // Avoid doubling /api/v1 when baseUrl already carries the version suffix
      // (mirrors fetchObjectSchemaFresh).
      const hasApiVersionSuffix = /\/api\/v\d+$/i.test(baseUrl);
      const metaPath = hasApiVersionSuffix ? '/meta' : '/api/v1/meta';
      const url = `${baseUrl}${metaPath}/object`;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

      const res = await this.fetchImpl(url, { method: 'GET', headers });
      if (!res.ok) return [];
      const body: any = await res.json();
      // Unwrap the `{ success, data }` envelope, the `{ type, items }` list
      // shape, or a bare array.
      const data =
        body && typeof body === 'object' && 'success' in body && 'data' in body ? body.data : body;
      const items: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : [];
      return items
        .map((it: any) => ({
          name: String(it?.name ?? ''),
          label: it?.label != null ? String(it.label) : undefined,
        }))
        .filter((it) => it.name);
    } catch {
      return [];
    }
  }

  /**
   * List the items one metadata registry type declares —
   * `GET /api/v1/meta/:type`, through the client's `meta.getItems` — as
   * `{ name, label }` headers for the `position-ref` / `permission-ref` field
   * widgets (objectui#7611).
   *
   * Unlike {@link getObjects}, a failure REJECTS (the `DataSource` contract):
   * the transport's own error propagates, and an answer without the spec's
   * `items` list is refused rather than read as an empty registry, so a
   * failed load can never reach the widget as "this registry declares
   * nothing". Uncached, like `getObjects`: an item authored in Studio is
   * listed on the next form that opens.
   *
   * An item without a string `name` is not listed (the widget stores the
   * name, so there is nothing to store); a `label` that is not a string is
   * left off rather than coerced.
   */
  async listMetadataItems(type: string): Promise<Array<{ name: string; label?: string }>> {
    await this.connect();
    const result: { items?: unknown } | null | undefined = await this.client.meta.getItems(type);
    if (!Array.isArray(result?.items)) {
      throw new Error(`GET /meta/${type} answered without an items list`);
    }
    const out: Array<{ name: string; label?: string }> = [];
    for (const it of result.items as unknown[]) {
      const name = (it as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || !name) continue;
      const label = (it as { label?: unknown }).label;
      out.push(typeof label === 'string' && label ? { name, label } : { name });
    }
    return out;
  }

  /**
   * Get access to the underlying ObjectStack client for advanced operations.
   */
  getClient(): ObjectStackClient {
    return this.client;
  }

  /**
   * Get the discovery information from the connected server.
   * Returns the capabilities and service status of the ObjectStack server.
   * 
   * Note: This accesses an internal property of the ObjectStackClient.
   * The discovery data is populated during client.connect() and cached.
   * 
   * @returns Promise resolving to discovery data, or null if not connected
   */
  async getDiscovery(): Promise<unknown | null> {
    try {
      // Ensure we're connected first
      await this.connect();
      
      // Access discovery data from the client
      // The ObjectStackClient caches discovery during connect()
      // This is an internal property, but documented for this use case
      // @ts-expect-error - Accessing internal discoveryInfo property
      return this.client.discoveryInfo || null;
    } catch {
      return null;
    }
  }

  /**
   * **The one place that knows which cache keys a view-row write invalidates.**
   *
   * Two reads are cached under view-shaped keys, and both go stale when any
   * writer touches a view row for `objectName`:
   *
   * | reader                     | key                        |
   * |----------------------------|----------------------------|
   * | {@link getView}            | `view:{object}:{viewName}` |
   * | {@link listViewOverrides}  | `view-overrides:{object}`  |
   *
   * Every writer routes here rather than restating that pair. The repo has now
   * paid twice for restatement: objectui#3778 removed five copies of a key
   * (`views:{object}`) that no reader had ever populated, and objectui#4363
   * fixed four copies that named only half the live set — and objectui#4373 is
   * the measured proof that the failure recurs by default, because the console's
   * real create/publish flow writes these same rows through the ADR-0034
   * metadata seam and never learned the key list at all. A pin suite can only
   * guard the writers that exist; a mandatory seam makes the next writer
   * structurally unable to forget.
   *
   * The rule is uniform per WRITE, not per branch: a write to a view row drops
   * both keys, in that order. Draft-addressed writes over-invalidate on purpose
   * — both readers enumerate PUBLISHED rows, so a draft write stales neither —
   * because the costs are not symmetric. An unnecessary invalidation costs one
   * refetch; a missed one costs up to the cache's 5-minute TTL of stale
   * overrides, and "which half am I in?" is not a question a future writer
   * should have to re-answer to stay correct.
   *
   * Public because the writers are not all in this class: app-shell's ADR-0034
   * seam (`runtime-metadata-persistence.ts`) and `MetadataService` write the
   * same rows through `client.meta` / the `/meta` draft-publish API, and they
   * reach this adapter as the `dataSource` they were already handed.
   *
   * @param objectName - Object the view belongs to (the `{object}` in both keys)
   * @param viewName - The view's canonical `name` — the identity
   *   {@link getView} reads back by and {@link listViewOverrides} keys its map
   *   with. Callers that hold a qualified `<object>.<key>` name pass it as-is:
   *   it is the row key, not a path to be split.
   */
  invalidateViewKeys(objectName: string, viewName: string): void {
    // Ordered per-view key first, then the object's map — the order the pin
    // suite records, so a reordering is a visible decision rather than drift.
    this.metadataCache.invalidate?.(`view:${objectName}:${viewName}`);
    this.metadataCache.invalidate?.(`view-overrides:${objectName}`);
    // The list both readers derive from (objectui#13044, objectui#13057): a
    // read asked after this write is answered neither by the stored list nor
    // by a list request sent before it.
    this.metadataCache.invalidate?.(VIEW_LIST_KEY);
  }

  /**
   * Batch-fetch all persisted view overrides for an object.
   *
   * Per-view runtime overrides (density, column widths, sort, hidden
   * columns, inlineEdit …) live in the SAME metadata namespace the view
   * writes use: `type='view'`, `name=<viewId>` (see {@link createView} /
   * {@link updateView}; the toolbar's `updateViewConfig` wrote overlays there
   * until objectui#12504 retired it). Loading them per-view fires N HTTP GETs
   * that 404 for every view the user never customized — console noise on
   * every page load. This batch method performs a single
   * `GET /api/v1/meta/view` (returns `{type, items}`) and narrows the
   * result to `objectName` client-side, exactly as {@link listViews}
   * does over the same rows (shared accessor: {@link viewItemObjectName}).
   *
   * objectui#3774 — this used to enumerate `GET /api/v1/meta/<objectName>`,
   * putting the OBJECT name in the metadata TYPE slot. That key space is
   * disjoint from the one the write path lands in, so the batch map came
   * back empty for every object, forever, and every saved personalization
   * read back as "setting didn't save".
   *
   * FAILURES REJECT — they are not answered as `{}`. An empty map is an
   * authoritative "this object has no overrides" (callers may trust it and
   * skip the per-view reads); a transport/permission failure is "I could
   * not tell", and reporting the two as the same value is what made
   * ObjectView's per-view {@link getView} fallback unreachable code. When
   * we cannot tell, we do not pretend we can. Rejections are not cached
   * (the cache stores on success only), so a transient failure does not
   * pin an empty answer for the TTL.
   *
   * Result is cached identically to {@link getView}, and EVERY view write —
   * on this adapter and above it — invalidates it through the one seam,
   * {@link invalidateViewKeys}. For a long time only `updateViewConfig` (since
   * retired, objectui#12504) did (objectui#4363), which left the other three
   * adapter paths stale for the cache's 5-minute TTL. That gap does not self-heal: the consumer
   * (`loadViewOverrides`, app-shell `ObjectView`) treats a RESOLVED map as
   * authoritative and deliberately does not re-probe per view — objectui#3774,
   * and correct, since re-probing reinstates the 404 flurry the batch read
   * exists to remove. So a stale map here is served in full, and the per-view
   * {@link getView} fallback that would have masked it never runs.
   *
   * @param objectName - Object name (e.g. 'lead')
   * @returns Map keyed by view name with the persisted override config
   * @throws whatever the metadata transport throws — callers that have a
   *   per-view fallback should catch and use it.
   */
  async listViewOverrides(objectName: string): Promise<Record<string, any>> {
    await this.connect();

    const cacheKey = `view-overrides:${objectName}`;
    return await this.metadataCache.get(cacheKey, async () => {
      const result: any = await this.readViewList();
      const items: any[] = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result) ? result : [];
      const out: Record<string, any> = {};
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        if (viewItemObjectName(it) !== objectName) continue;
        // Keyed by the item's canonical `name` — the SAME identity the view
        // writes save under and `getView` reads back by, which
        // is what makes this a drop-in substitute for the per-view fetch.
        // No `?? id ?? _name` alias chain: those are not view identities on
        // any route (`/meta/view/:name` is name-addressed), and a batch map
        // keyed by something no caller can ask for is dead weight.
        const key = it.name;
        if (typeof key === 'string' && key) out[key] = it;
      }
      return out;
    });
  }

  /**
   * Get a view definition for an object.
   * Attempts to fetch from the server metadata API.
   * Falls back to null if the server doesn't provide view definitions,
   * allowing the consumer to use static config.
   * 
   * @param objectName - Object name
   * @param viewId - View identifier
   * @returns Promise resolving to the view definition or null
   */
  async getView(objectName: string, viewId: string): Promise<unknown | null> {
    await this.connect();

    try {
      const cacheKey = `view:${objectName}:${viewId}`;
      return await this.metadataCache.get(cacheKey, async () => {
        // Views are an independent metadata type (ADR-0017) — the first
        // getItem argument is the metadata TYPE, not the object name.
        // (Passing objectName here hit /meta/<object>/<view> and always 404ed.)
        const result: any = await this.client.meta.getItem('view', viewId);
        if (result && result.item) return result.item;
        return result ?? null;
      });
    } catch {
      // Server doesn't support view metadata — return null to fall back to static config
      return null;
    }
  }

  /**
   * List user-created views for a given object via the metadata overlay
   * API (ADR-0005). Replaces the legacy `find('sys_view', {...})` path
   * that wrote to a physical `sys_view` table whose columns no longer
   * match the view spec shape.
   *
   * Returns view spec objects with their canonical `name` as identifier.
   * Narrows to one object client-side via {@link viewItemObjectName} —
   * the metadata index is name-only, not field-typed, so the route has no
   * `?object=` to push the filter down into. {@link listViewOverrides}
   * reads the same rows through the same accessor.
   *
   * ## Every failure still degrades to an empty list — and now says which kind
   * ## of failure it was (objectui#8151)
   *
   * The degrade is unchanged and deliberate, exactly as it is one method over
   * in {@link listImportMappings}: a host with no metadata door keeps answering
   * `[]` rather than breaking the page. What changed is that the OTHER failures
   * no longer render as that one.
   *
   * This method's empty list is read as *this object has no saved views*, and
   * that reading reaches the user in two places measured on this tree: the list
   * view switcher simply shows fewer tabs, and `@object-ui/core`'s
   * `elementDataSourceViewNotFoundMessage` states it outright. So a session
   * whose token lapsed mid-read was shown an object that appears to have no
   * saved views AT ALL — including ones the user created — with a
   * `console.warn` as the only discriminator, in a console nothing in the UI
   * points at. That is the silence objectui#7741 removed from the sibling after
   * it produced a confident wrong diagnosis in objectstack#14026.
   *
   * The `catch` now asks {@link classifyViewsFailure} what the failure WAS,
   * reading the error's own ADR-0112 `code` and status — never "is the result
   * empty", which is what both conditions produce and so can never tell them
   * apart — and anything that is not the doorless shape is announced on
   * {@link onMetadataReadWarning}.
   *
   * ⛔ That classifier is a SEPARATE reading, not a second caller of the
   * sibling's: `view`'s quiet set is strictly smaller, because the arm
   * `listImportMappings` is built around (*an older server without this kind*)
   * has no members here. See {@link classifyViewsFailure} for the measurement.
   *
   * ⛔ The RETURN is untouched. This method has answered `Promise<any[]>`, never
   * throwing, since `@object-ui/data-objectstack@17.1.0`; a consumer that reads
   * nothing new sees exactly what it saw before, including on the loud arms.
   * Applying framework objectstack#13906 decision 1 option A — *a thing that could not be
   * READ is not a thing that is ABSENT* — is done by ADDING a channel, not by
   * moving that contract.
   */
  async listViews(
    objectName: string,
    options?: { previewDrafts?: boolean },
  ): Promise<any[]> {
    await this.connect();
    try {
      let items: any[];
      if (options?.previewDrafts) {
        // ADR-0037 + #2767 (P2/P3): a SINGLE `?preview=draft` request already
        // returns the active+draft OVERLAID list — draft wins by name,
        // draft-only views surface, each draft tagged `_draft: true`. So we
        // REPLACE the published list wholesale (never fetch both and append,
        // which double-lists a draft that edits a published view). Route it
        // through `MetadataClient` rather than a hand-rolled fetch so the
        // metadata route + any environment scoping stay in one place.
        const draftItems = await this.metadataClient()
          .withPreviewDrafts(true)
          .list<any>('view');
        items = Array.isArray(draftItems) ? draftItems : [];
      } else {
        const result: any = await this.readViewList();
        items = Array.isArray(result?.items)
          ? result.items
          : Array.isArray(result) ? result : [];
      }
      // This feeds the list-view switcher (ViewTabBar), so it must return
      // LIST-family views only. The backend now exposes each view as an
      // independent ViewItem carrying a `viewKind` discriminant (ADR-0017);
      // form-family views (`form`/`detail`) are record forms, not list tabs,
      // and must be excluded — otherwise e.g. `crm_activity.default` (a form)
      // leaks in as a spurious switcher tab. Bare specs without `viewKind`
      // (legacy artifacts / saved views) are kept as list views.
      const FORM_FAMILY = new Set(['form', 'detail']);
      return items.filter((v: any) => {
        if (!v) return false;
        // Handle both bare view spec and `{list: {...}}` artifact wrapper
        const spec = v.list ?? v;
        if (viewItemObjectName(v) !== objectName) return false;
        const viewKind = v.viewKind ?? spec?.viewKind;
        if (viewKind && FORM_FAMILY.has(viewKind)) return false;
        // Personalization overlays (density/sort/hiddenFields/columnState/
        // inlineEdit — written by the retired `updateViewConfig`, still at
        // rest) are NOT saved views:
        // returning one here is what let a system view's override row read
        // back as user-created and gain Rename/Delete/Set-default/Pin
        // (objectui#4227). Only a row carrying the marker is excluded: the
        // shape guess that also caught unmarked flat rows is retired
        // (objectui#10210, ruling B) — see {@link isPersonalizationOverlayRow}.
        if (isPersonalizationOverlayRow(v, spec)) return false;
        return true;
      }).map((v: any) => {
        const spec = v.list ?? v;
        // Preserve the draft provenance flag so the switcher can badge an
        // unpublished view (ADR-0037). The overlay tags the item, not its
        // nested spec, so read from either.
        const isDraft = v._draft === true || spec?._draft === true;
        // Canonical ViewItem (ADR-0017) carries its body under `config`;
        // the display `type` (grid/kanban/gallery/…) lives at `config.type`,
        // and only the list/form *family* sits at the top level (`viewKind`).
        // Flatten `config` up to the legacy NamedListView shape the switcher +
        // ObjectView consume — mirroring MetadataProvider.mergeViewsIntoObjects
        // so the two paths don't drift. Without this an un-flattened item has
        // no top-level `type`, so ObjectView's saved-view normalization defaults
        // it to 'grid' and overrides the metadata entry — a kanban/gallery/
        // calendar view then silently renders as a plain table.
        //
        // objectui#11013 — the flattened row also carries the record's declared
        // members the console reads back off it: its bound `object`, and the
        // round-trip keys the spec declares on the record
        // (`VIEW_ITEM_ROUND_TRIP_KEYS`: `isPinned`, `sortOrder`, `visibility`,
        // `columnState`, and `isDefault`, coerced to a boolean as before). The
        // switcher sorts saved views by the `sortOrder` it reads off THIS row,
        // and nothing else restored it, so a reordered record lost its place
        // on the reload. Each is copied only when the record carries it, and
        // after `config`, so a record-level key wins over a config key of the
        // same name. (MetadataProvider's `applyViewItem` still flattens to
        // `config` + identity: the tab it feeds is merged with the stored
        // record through `loadViewOverrides`, which is where that path gets
        // these keys back. The sort reads this row, not the tab.)
        if (spec && spec.config && typeof spec.config === 'object') {
          const row: Record<string, unknown> = {
            ...spec.config,
            name: spec.name ?? spec.config.name,
            label: spec.label ?? spec.config.label,
          };
          if (spec.object !== undefined) row.object = spec.object;
          for (const key of VIEW_ITEM_ROUND_TRIP_KEYS) {
            if (spec[key] !== undefined) row[key] = spec[key];
          }
          row.isDefault = !!spec.isDefault;
          if (isDraft) row._draft = true;
          return row;
        }
        return isDraft ? { ...spec, _draft: true } : spec;
      });
    } catch (err) {
      // Kept verbatim, on every arm. The console breadcrumb was never the
      // problem — being the ONLY discriminator was — so it is not moved, not
      // re-levelled, and not made conditional.
      console.warn('[OBJECTSTACKDataSource] listViews failed:', err);
      const failure = classifyViewsFailure(err);
      if (failure.kind !== 'not-served') {
        this.emitMetadataReadWarning({
          operation: 'listViews',
          kind: 'view',
          objectName,
          reason: failure.kind,
          ...(failure.code !== undefined ? { code: failure.code } : {}),
          ...(failure.status !== undefined ? { status: failure.status } : {}),
          ...(failure.message !== undefined ? { message: failure.message } : {}),
        });
      }
      return [];
    }
  }

  /**
   * Build a {@link MetadataClient} bound to this adapter's server + auth. Used
   * by draft-aware reads (`listViews({ previewDrafts })`) so the `/meta` route,
   * `?preview=draft` flag, and environment scoping live in the SDK rather than
   * being hand-assembled at each call site (#2767 P3).
   */
  private metadataClient(): MetadataClient {
    return new MetadataClient({
      baseUrl: this.baseUrl,
      fetch: this.fetchImpl,
      ...(this.token ? { headers: { Authorization: `Bearer ${this.token}` } } : {}),
    });
  }

  /**
   * List registered import `mapping` artifacts targeting a given object
   * (objectstack-ai/objectstack#2611). Reads the `mapping` metadata kind via the overlay API
   * and filters by `targetObject` client-side (the metadata index is
   * name-only). Feeds the import wizard's "saved mapping" selector.
   *
   * ## Every failure still degrades to an empty list — and now says which kind
   * ## of failure it was (objectui#7741)
   *
   * The degrade is unchanged and deliberate: an older server without the
   * `mapping` kind must not break the wizard, so it keeps answering `[]` and
   * the selector simply doesn't appear. That is a real, supported deployment
   * shape and it stays quiet.
   *
   * What changed is that the OTHER failures no longer render as that one. A
   * refused door and a broken one used to be indistinguishable, in the UI, from
   * "no mapping is registered" — both were an empty list behind a
   * `console.warn` nothing pointed at — and that silence produced a confident
   * wrong diagnosis in a careful reporter (objectstack#14026 was filed, routed
   * and worked by two seats against a wizard that had been correct since
   * 17.1.0). So the `catch` now asks {@link classifyImportMappingsFailure} what
   * the failure WAS, reading the error's own ADR-0112 `code` and status —
   * never "is the result empty", which is what both conditions produce and so
   * can never tell them apart — and anything that is not the supported
   * kind-absent shape is announced on {@link onMetadataReadWarning}.
   *
   * ⛔ The RETURN is untouched. This method has answered `Promise<any[]>`, never
   * throwing, since `@object-ui/data-objectstack@17.1.0`; a consumer that reads
   * nothing new sees exactly what it saw before, including on the loud arms.
   * Applying framework objectstack#13906 decision 1 option A — *a thing that could not be
   * READ is not a thing that is ABSENT* — is done by ADDING a channel, not by
   * moving that contract.
   */
  async listImportMappings(objectName: string): Promise<any[]> {
    await this.connect();
    try {
      const result: any = await this.client.meta.getItems('mapping');
      const items: any[] = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result) ? result : [];
      return items.filter((m: any) => m && m.targetObject === objectName);
    } catch (err) {
      // Kept verbatim, on both arms. The console breadcrumb was never the
      // problem — being the ONLY discriminator was — so it is not moved, not
      // re-levelled, and not made conditional.
      console.warn('[OBJECTSTACKDataSource] listImportMappings failed:', err);
      const failure = classifyImportMappingsFailure(err);
      if (failure.kind !== 'not-served') {
        this.emitMetadataReadWarning({
          operation: 'listImportMappings',
          kind: 'mapping',
          objectName,
          reason: failure.kind,
          ...(failure.code !== undefined ? { code: failure.code } : {}),
          ...(failure.status !== undefined ? { status: failure.status } : {}),
          ...(failure.message !== undefined ? { message: failure.message } : {}),
        });
      }
      return [];
    }
  }

  /**
   * Create a new overlay view for an object. The view's `name` is the
   * stable identifier — must be unique within the project scope. Returns
   * the persisted view spec (or undefined when the server doesn't echo).
   *
   * Generates a snake_case name if `spec.name` is not provided by appending
   * a short timestamp suffix to the source-name hint.
   *
   * Invalidates through {@link invalidateViewKeys}, like every other writer —
   * see {@link listViewOverrides} for why the batch map is the one that cannot
   * heal itself (objectui#4363).
   */
  async createView(
    objectName: string,
    spec: Record<string, any>,
  ): Promise<Record<string, any> | void> {
    await this.connect();
    let name = String(spec?.name || '').trim();
    if (!name) {
      let base = String(spec?.label || objectName || 'view')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      // Spec requires snake_case starting with a letter or underscore.
      // Labels like "表格 1" collapse to "1" after non-ascii stripping, so we
      // need a fallback / prefix to keep the identifier valid.
      if (!base || /^[0-9]/.test(base)) {
        base = base ? `view_${base}` : 'view';
      }
      const suffix = Date.now().toString(36);
      name = `${base}_${suffix}`;
    }
    const fullSpec = {
      ...spec,
      name,
      object: spec?.object || objectName,
      data: spec?.data || { provider: 'object', object: objectName },
    };
    const result: any = await this.client.meta.saveItem('view', name, fullSpec);
    // `saveItem` is an UPSERT: an explicit `spec.name` that already exists
    // overwrites the published row, which a prior `getView` may hold. (A
    // generated name cannot collide, and a miss is a `Map.delete` on an absent
    // key, so the uniform rule costs nothing on the create-a-new-row path.)
    this.invalidateViewKeys(objectName, name);
    if (result && result.item) return result.item;
    return fullSpec;
  }

  /**
   * Apply a partial update to an existing overlay view. Reads the current
   * document, merges, and writes it back. ADR-0005 overlay rows store the
   * *full* view document, so partial updates require a read-merge-write cycle.
   *
   * **Both halves address the same row (#4139).** A view has two possible
   * homes and the read must resolve the one the write will target:
   *
   * - a pending per-item **draft** (`?state=draft` / `?mode=draft`) — where
   *   ADR-0034 stages every runtime-created view, so a view made from the `+`
   *   tab lives ONLY here until an explicit Publish;
   * - the **published** overlay (`client.meta.getItem` / `saveItem`).
   *
   * The draft is probed FIRST, and a hit is merged and written straight back
   * as a draft. Two things that ordering buys, both load-bearing:
   *
   * 1. A draft-only view is no longer invisible to the read. It used to 404,
   *    and a `catch {}` labelled "treat missing as create-equivalent"
   *    substituted `current = {}` — so a rename merged onto nothing and went
   *    out as a `{label, name, object}` partial the server rejects (422),
   *    while the draft row the UI reads back through `?preview=draft` kept the
   *    old label. The edit was lost with no error surfaced to the user.
   * 2. A draft is never bypassed. Writing the published row while a draft is
   *    pending would put the edit somewhere the draft shadows — and Publish
   *    would then overwrite it with the pre-edit body, losing the change a
   *    second time, later, where nothing connects it to this call.
   *
   * A draft edit stays a draft: `mode: 'draft'` keeps ADR-0037's guarantee
   * that nothing the preview shows goes live until Publish. Renaming a
   * *published* view (no draft pending) is unchanged — it writes the
   * published overlay, as before.
   *
   * **Both halves invalidate through {@link invalidateViewKeys}** (objectui#4363,
   * #4373) — same call, same key set, so the draft half's deliberate
   * over-invalidation is the seam's uniform rule rather than a per-branch
   * decision this method has to keep re-making.
   *
   * @throws when the view resolves in neither home, or when either read fails
   *   for any other reason (network, permission). Both used to be swallowed
   *   and converted into the bad partial write above; a caller that wants a
   *   view created should call {@link createView}, which is the operation that
   *   actually means "create".
   */
  async updateView(
    objectName: string,
    viewName: string,
    partial: Record<string, any>,
  ): Promise<Record<string, any> | void> {
    await this.connect();

    // ── Draft-addressed path ────────────────────────────────────────────
    // `MetadataClient.get` answers `null` on 404 (no draft pending) and throws
    // on anything else, so a transport failure here is NOT read as "published".
    const metaClient = this.metadataClient();
    const draft = unwrapViewDraft(
      await metaClient.get('view', viewName, { state: 'draft' }),
    );
    if (draft) {
      const mergedDraft = mergeViewPatch(draft, partial, viewName, objectName);
      await metaClient.save('view', viewName, mergedDraft, { mode: 'draft' });
      this.invalidateViewKeys(objectName, viewName);
      return mergedDraft;
    }

    // ── Published-overlay path (unchanged addressing) ────────────────────
    let current: any;
    try {
      const r: any = await this.client.meta.getItem('view', viewName);
      current = (r && (r.item || r)) || {};
      // Some endpoints return the bare item; others wrap as {type,name,item}
      if (current?.list) current = current.list;
    } catch (err) {
      if (is404Error(err)) {
        // Not a draft, not published, not an artifact — there is nothing to
        // merge onto. Fail loudly instead of emitting the partial write.
        throw Object.assign(
          new Error(
            `updateView: view "${viewName}" not found on object "${objectName}"` +
              ' — no pending draft and no published overlay. Use createView() to create one.',
          ),
          { cause: err },
        );
      }
      // Network / permission / server fault: surface it. Degrading to a
      // create-equivalent write here is what corrupted the row before.
      throw err;
    }

    const merged = mergeViewPatch(current, partial, viewName, objectName);
    const result: any = await this.client.meta.saveItem('view', viewName, merged);
    this.invalidateViewKeys(objectName, viewName);
    if (result && result.item) return result.item;
    return merged;
  }

  /**
   * Delete an overlay view — from **every home it has**.
   *
   * A view has two possible homes, the same two {@link updateView} addresses:
   * the pending per-item **draft** (`DELETE /meta/view/:name?state=draft`) and
   * the **published** overlay (`DELETE /meta/view/:name`). This method used to
   * issue only the second, and the three cases came out like this (#4479):
   *
   * | case               | before                                              |
   * |--------------------|-----------------------------------------------------|
   * | draft-only view    | BUG — the published delete answered `reset:false` /  |
   * |                    | "nothing to delete", the draft survived, and the tab |
   * |                    | was still there after reload                        |
   * | published-only     | correct — `reset:true`, tab gone                     |
   * | published + draft  | ACCIDENTALLY correct — the published row went, so    |
   * |                    | the tab went; the orphan draft stayed behind        |
   *
   * **Why this is not the mechanical mirror of #4139.** `updateView` probes
   * the draft first and writes back to whichever home the read resolved, and
   * that is right for an update in all three cases. Copying it here would be
   * wrong in the third: `persistRuntimeMetadata` (app-shell) stages EVERY
   * runtime edit as a draft, so "publish a view, then edit it" routinely
   * produces a pair — and a draft-first-only delete on a pair discards the
   * draft and leaves the published row serving the view. That is not Delete
   * view, it is **Discard draft**, a deliberately different operation that
   * already exists (`discardRuntimeDraft`, documented as "the published
   * overlay is untouched"). The clean statement of the asymmetry: for an
   * update, one home is the right home; for a delete, "remove this view" is
   * satisfied only when NO home is left serving it.
   *
   * So both homes are deleted, **draft first**. The order is load-bearing on
   * the failure path: a fault between the two calls leaves the PUBLISHED
   * overlay intact, so the view is still served and the operation is cleanly
   * retryable. The reverse order would strand a draft-only view — which is
   * precisely the bug shape above.
   *
   * **Two blind calls, no probe.** The framework's `deleteMetaItem` answers a
   * missing home with a **200** carrying `reset:false` (`"No pending draft
   * for view/x."` / `"No view 'x' found — nothing to delete."`), never a 404,
   * so there is nothing for a probe to protect against. `updateView` needs its
   * probe for a different reason — its read must resolve the row the merge
   * writes back to — and that reason has no counterpart for a delete.
   *
   * **One transport, one error contract.** Both halves go through
   * {@link MetadataClient} (`reset`), the transport that can express the
   * `?state=` qualifier and the one `updateView`'s draft half already uses.
   * The published half used to go through `client.meta.deleteItem`; measured,
   * that issues the byte-identical request (`DELETE
   * {baseUrl}/api/v1/meta/view/:name`, no environment scoping is configured on
   * this adapter), so routing it here costs no addressing change and buys a
   * single `MetadataError` shape across both calls instead of two.
   *
   * @returns `deleted` is true only when no home is left serving the view AND
   *   at least one actually held a row. A view that existed in neither home
   *   still answers `false`, unchanged. The per-home outcomes are additive:
   *   a partial result is observable rather than rounded up to `true`.
   * @throws when either delete fails, matching {@link updateView}'s
   *   convention of surfacing the fault rather than degrading. A failure of
   *   the PUBLISHED half after the draft was discarded carries the partial
   *   state on the error's `outcome` — "draft gone, overlay left" is exactly
   *   what the old `{ deleted: boolean }` could not express.
   *   Its message is the adapter's "NOT fully removed" sentence followed, on
   *   the next line, by the server's own reason (objectui#12416), so
   *   `formatMetadataError(err)` shows the remedy a refusal names; the
   *   original error stays on `cause`.
   *
   * Invalidates through {@link invalidateViewKeys}: the deleted row leaves the
   * batch override map too, and a ghost entry there is what the object page
   * would keep applying (objectui#4363). Fired in a `finally`, so it happens
   * once per call on EVERY outcome including the throw — after a half-failure
   * the draft row really is gone, and #4363's asymmetry decides it: an
   * unnecessary invalidation costs one refetch, a missed one costs the cache's
   * full 5-minute TTL of stale overrides.
   */
  async deleteView(
    objectName: string,
    viewName: string,
  ): Promise<DeleteViewResult> {
    await this.connect();
    const metaClient = this.metadataClient();
    try {
      // ── Draft home, first ────────────────────────────────────────────────
      const draft = readViewDeleteReceipt(
        await metaClient.reset('view', viewName, { state: 'draft' }),
      );

      // ── Published home ───────────────────────────────────────────────────
      let published: ViewHomeDeleteOutcome;
      try {
        published = readViewDeleteReceipt(await metaClient.reset('view', viewName));
      } catch (err) {
        const outcome: DeleteViewResult = {
          deleted: false,
          draft,
          published: { removed: false },
        };
        // objectui#12416 — the server's reason travels on the error's OWN
        // message, after the adapter's sentence, so the one reader callers
        // use (`formatMetadataError(err)`) shows it; on `cause` alone it was
        // invisible to that reader, and the toast told the user to retry a
        // delete a `409` had already said how to fix. The reason is rendered
        // by that same reader (issue lines when the refusal carries them,
        // else the served message verbatim), never parsed. "Retry" is said
        // only when the failure is not a 4xx refusal: a refusal's own
        // sentence names its remedy, and repeating the same request cannot
        // succeed.
        const status = (err as { status?: unknown } | null | undefined)?.status;
        const refused = typeof status === 'number' && status >= 400 && status < 500;
        throw Object.assign(
          new Error(
            `deleteView: view "${viewName}" on object "${objectName}" is NOT fully removed` +
              ` — the draft home was ${draft.removed ? 'discarded' : 'already absent'},` +
              ' but deleting the published overlay failed. The published row is still' +
              ` serving the view${refused ? '.' : '; retry the delete.'}\n` +
              formatMetadataError(err),
          ),
          { cause: err, outcome },
        );
      }

      return { deleted: draft.removed || published.removed, draft, published };
    } finally {
      this.invalidateViewKeys(objectName, viewName);
    }
  }


  /**
   * Get an application definition by name or ID.
   * Attempts to fetch from the server metadata API.
   * Falls back to null if the server doesn't provide app definitions,
   * allowing the consumer to use static config.
   * 
   * @param appId - Application identifier
   * @returns Promise resolving to the app definition or null
   */
  async getApp(appId: string): Promise<unknown | null> {
    await this.connect();

    try {
      const cacheKey = `app:${appId}`;
      return await this.metadataCache.get(cacheKey, async () => {
        const result: any = await this.client.meta.getItem('app', appId);
        if (result && result.item) return result.item;
        return result ?? null;
      });
    } catch {
      // Server doesn't support app metadata — return null to fall back to static config
      return null;
    }
  }

  /**
   * Ask the by-name meta app route WHY an app is not in this session's app list
   * (objectui#4252).
   *
   * The app LIST is the generic metadata list route `GET /api/v1/meta/:type`,
   * requested with the singular type segment `app` — the same address this
   * method appends a name to below, and the one `MetadataProvider` reads its
   * items from. The server filters that list per session in `filterAppForUser`
   * (`packages/rest/src/rest-server.ts`, applied inside the `:type` list handler
   * once the type segment resolves to `app`), so an app withheld by
   * `requiredPermissions` and an app
   * that does not exist are byte-identical there: both are simply absent. A
   * console reading only that list has one fact and two conditions, and it
   * renders its copy for the wrong one — "it may still be publishing" over a
   * permanent authorization decision, which cost a downstream acceptance round
   * two test batches spent chasing a platform defect that was a missing
   * permission-set binding.
   *
   * The maintainer ruling (2026-08-12) put the answer on the BY-NAME route
   * rather than in the list, so the enumeration surface is not widened past what
   * a by-name probe already implies (objectstack#8013 / PR objectstack-ai/objectstack#8135): an app that
   * exists and whose `requiredPermissions` the session lacks answers `403` with
   * `PERMISSION_DENIED` in the declared envelope, and absence — a nonexistent
   * name, an unpublished app, an app gated by an absent optional service — is
   * one undifferentiated answer.
   *
   * ⚠️ That absence is NOT uniformly a `404`, which this docstring asserted
   * until objectui#9262 measured it: the 404 covers an app that EXISTS and is
   * withheld for a non-permission reason, while a name that resolves to nothing
   * answers `200` with an envelope carrying no `item`. Both are absence and both
   * read as `not_found`; see {@link metaEnvelopeCarriesItem} for the measurement.
   *
   * ## Why this is a separate method and not a flavour of {@link getApp}
   *
   *  - `getApp` degrades EVERY failure to `null`, which is exactly the
   *    conflation this exists to undo; changing it would silently re-point its
   *    own callers' fallback-to-static-config path.
   *  - `getApp` memoises in `metadataCache`. A verdict about the CALLER must not
   *    be cached beside a document about the APP — one grant, and a cached
   *    denial outlives the session it described.
   *
   * Nothing here throws: every outcome is a verdict the caller renders a screen
   * from, never a catch block. Only the measured `code` produces `denied` —
   * never a status, never a message (objectui#4408).
   *
   * ## objectui#9262 — what this method stopped folding away
   *
   * It used to answer `granted` whenever the call did not throw, and `unknown`
   * for everything that did. Both halves were wrong in the same direction, and
   * the first was measured on a real server before this change landed:
   *
   *  - **an app that does not exist answers `200` with the envelope minus its
   *    `item`**, so "did not throw" reported `granted` for a name with nothing
   *    behind it — the shape issue objectui#9262 listed as cause 8 and expected
   *    to be structural. It is the ordinary case: every typo, every never-created
   *    app and every unpublished draft took it. See
   *    {@link metaEnvelopeCarriesItem} for the measurement and the server-side
   *    mechanism.
   *  - a 404 absence and an unreachable server were one `unknown`, though the
   *    transport had already told them apart.
   *
   * The verdicts now say only what was obtained: a served document, a refusal
   * naming permission, an answer that there is no such app here, or no answer
   * at all. `unknown` is left for the one case where nothing was asked.
   *
   * @param appName - the app name as it appears in the URL segment
   */
  async probeAppAccess(appName: string): Promise<AppAccessVerdict> {
    // Singular `app`, the address objectstack#8013 pinned its cases against,
    // and the same one `MetadataProvider` reads items by.
    return (await this.probeMetaItemAccess('app', appName)).verdict;
  }

  /**
   * {@link probeAppAccess} for any metadata type whose by-name read refuses a
   * caller (objectui#12112): why `name` is not in this session's list of
   * `type`, plus the server's own sentence when it refused.
   *
   * Since objectstack#22731 a dashboard and a list view carry the app's gate:
   * `GET /api/v1/meta/dashboard` and `/meta/view` list only what the caller may
   * open, so a withheld item and a missing one are the same absence there, and
   * the by-name read of one the caller does not hold answers `403`
   * `PERMISSION_DENIED`, "the app arm's whole refusal (same emitter, same
   * envelope)". The verdicts are therefore read exactly as for an app.
   *
   * `message` is the refusal's `message`, as the server wrote it: the one
   * sentence that names the item and says it was refused. Only on `denied`.
   *
   * Nothing here throws, and nothing is cached: a verdict about the CALLER
   * must not outlive a grant.
   *
   * @param type - the singular metadata type (`app`, `dashboard`, `view`)
   * @param name - the item's name, as the by-name route addresses it
   */
  async probeMetaItemAccess(type: string, name: string): Promise<MetaItemAccess> {
    // Nothing was asked, so nothing was measured. `AppContent` never reaches
    // here with an empty name (`requestedAppMissing` requires one), so this is
    // the contract for a direct caller rather than a live path.
    if (!type || !name) return { verdict: 'unknown' };
    try {
      // No `connect()` first: this route is only ever asked after the type's
      // LIST has already loaded through this same client, and the client's
      // route resolution falls back to the conventional `/api/v1/meta`
      // regardless — so a discovery round trip here could only add a failure
      // mode.
      const envelope = await this.client.meta.getItem(type, name);
      return { verdict: metaEnvelopeCarriesItem(envelope) ? 'granted' : 'not_found' };
    } catch (err) {
      if (isAppPermissionDeniedError(err)) {
        const message = (err as { message?: unknown } | null)?.message;
        return typeof message === 'string' && message.trim()
          ? { verdict: 'denied', message }
          : { verdict: 'denied' };
      }
      // The other declared answer this route gives. Ordered after the denial so
      // a server that ever carried both codes still reports the permission
      // fact, which is the one a caller may act on.
      if (isMetaItemAbsentError(err)) return { verdict: 'not_found' };
      // 5xx, offline, a timeout, a transport that ate the envelope, a 404 with
      // no declared code. None of them said anything about the item.
      return { verdict: 'unreachable' };
    }
  }

  /**
   * Get a page definition from ObjectStack.
   * Uses the metadata API to fetch page layouts.
   * Returns null if the server doesn't support page metadata.
   */
  async getPage(pageId: string): Promise<unknown | null> {
    await this.connect();

    try {
      const cacheKey = `page:${pageId}`;
      return await this.metadataCache.get(cacheKey, async () => {
        const result: any = await this.client.meta.getItem('page', pageId);
        if (result && result.item) return result.item;
        return result ?? null;
      });
    } catch {
      // Server doesn't support page metadata — return null to fall back to static config
      return null;
    }
  }

  /**
   * Update (upsert) a dashboard definition.
   *
   * Dashboards are control-plane metadata, not data records. Persist via
   * `client.meta.saveItem('dashboard', name, schema)` which routes to
   * `PUT /api/v1/meta/dashboard/:name`. After save, invalidates the
   * relevant metadata cache entry so the next dashboard read reflects
   * the new payload.
   *
   * @param dashboardName - Dashboard identifier (e.g. 'crm_overview_dashboard')
   * @param schema - Full dashboard schema (widgets, layout, etc.)
   */
  async updateDashboard(
    dashboardName: string,
    schema: Record<string, any>
  ): Promise<Record<string, any> | void> {
    await this.connect();
    const result: any = await this.client.meta.saveItem(
      'dashboard',
      dashboardName,
      schema
    );
    // Invalidate dashboards list and any cached dashboard read so the
    // next render reflects the change.
    this.metadataCache.invalidate?.('dashboards');
    this.metadataCache.invalidate?.(`dashboard:${dashboardName}`);
    if (result && result.item) return result.item;
    return result ?? undefined;
  }

  /**
   * Perform server-side aggregation via the ObjectStack analytics API.
   * Uses `this.client.analytics.query()` from @objectstack/client to leverage
   * the SDK's built-in auth, headers, and fetch configuration.
   * Falls back to client-side aggregation via find() if the analytics endpoint
   * is not available. Throws {@link AnalyticsResultShapeError} when it answers
   * with anything but an `AnalyticsResult` carrying `rows`.
   */
  async aggregate(resource: string, params: any): Promise<any[]> {
    await this.connect();

    // Spec-shape aggregation: `{ groupBy: GroupByNode[], aggregations: AggregationNode[], where?, limit? }`
    // per spec/data/query.zod.ts. Sent directly to the server's POST
    // /data/:object/query endpoint, which routes through engine.aggregate
    // and returns bucketed rows with the requested aliases.
    const looksLikeSpecShape =
      params != null &&
      (Array.isArray((params as any).groupBy) ||
        Array.isArray((params as any).aggregations) ||
        (params as any).where !== undefined);
    if (looksLikeSpecShape) {
      const queryAst: Record<string, unknown> = {};
      if (Array.isArray(params.groupBy)) queryAst.groupBy = params.groupBy;
      if (Array.isArray(params.aggregations)) queryAst.aggregations = params.aggregations;
      if (params.where !== undefined) {
        // STRICT, deliberately — objectui#6825, maintainer ruling 2026-08-30
        // (option A). Unlike the analytics branch below, this one does NOT lower:
        // it refuses. `where` here is the spec Query DSL's `where`, and an array
        // the spec's AST gate rejects (an unlowered `ViewFilterRule[]`, say) is
        // off-contract at the PRODUCER. Lowering it here was option B and was
        // refused; see `UnloweredAggregateWhereError` for the full ruling and
        // for why the two carve-outs (non-array, empty array) are carve-outs.
        assertSpecShapeWhereIsFilterAst(params.where, resource);
        queryAst.where = params.where;
      }
      // The other half of the same ruling — `503cd8b89`. `where` above is the
      // key this branch DOES read and refuses when unlowered; `filter`, `field`
      // and `function` are the analytics branch's keys, which this branch reads
      // not at all and used to drop without a word. Same disposition, applied to
      // the rest of the branch, so it has ONE answer for off-contract params
      // rather than two.
      //
      // ORDER IS DELIBERATE: this runs AFTER the `where` gate, so no input that
      // already refused changes which error it gets — the addition is strictly
      // additive over #6825's behaviour. Both refusals are producer-side and
      // nothing has been sent at this point either way.
      assertNoAnalyticsKeysOnSpecShape(params, resource);

      if (typeof params.limit === 'number') queryAst.limit = params.limit;
      const result: any = await this.client.data.query(resource, queryAst as any);
      // client.data.query returns { object, records, total, hasMore }
      if (Array.isArray(result)) return result;
      if (Array.isArray(result?.records)) return result.records;
      if (Array.isArray(result?.data)) return result.data;
      return [];
    }

    // Lowered BEFORE the `try` below, deliberately. A filter this adapter
    // refuses is a defect in the request we were asked to build, not an
    // analytics failure: raised inside the `try`, it would be handed to
    // `classifyAnalyticsFailure`, come back `unknown`, and be answered by the
    // client-side fallback — which would re-read the same rows through `find()`
    // and hand the caller plausible numbers for a question the adapter had
    // already decided it could not ask.
    const analyticsWhere = params.filter
      ? lowerAnalyticsFilterForWire(params.filter, resource)
      : undefined;

    try {
      // Build measure name in the format expected by the backend analytics
      // service (memory-analytics / cube).  For 'count' the measure key is
      // simply 'count'; for other aggregation functions it follows the
      // convention `${field}_${function}` (e.g. 'amount_sum').
      const measureName = params.function === 'count'
        ? 'count'
        : `${params.field}_${params.function}`;
      // The column the caller expects the value under — the raw `field`, or the
      // literal `count` when a count names no field (framework#3701). Reading
      // `params.field` directly here keyed the row `undefined` for a fieldless
      // count and deleted the `count` the server sent, so the chart plotted
      // nothing.
      const valueKey = this.aggregateValueKey(params);

      const payload: Record<string, unknown> = {
        cube: resource,
        measures: [measureName],
        // When groupBy is '_all' no dimensions are needed (single-bucket).
        dimensions: params.groupBy && params.groupBy !== '_all' ? [params.groupBy] : [],
      };
      // `where` is a `FilterCondition` here, always — see
      // `lowerAnalyticsFilterForWire`, which did the lowering above. Dashboard
      // widgets already emit one (spec/ui/dashboard.zod.ts) and it passes
      // through; an authored array is lowered through `parseFilterAST`, the
      // single sink the protocol names, so what leaves this method is what
      // `AnalyticsQuerySchema.where` declares.
      //
      // This branch used to post the array itself, normalised into filter AST
      // but not lowered, and named `lowerAnalyticsWhere` as its door. That was
      // the wrong hop: `lowerAnalyticsWhere` (`@objectstack/service-analytics`,
      // objectstack#5334) is the door for IN-PROCESS callers, and objectui#6302's
      // gate measured that function. The wire's door is one hop earlier —
      // `POST /analytics/query` parses the body with `AnalyticsQueryRequestSchema`
      // before any normalisation runs — and it answered `400 Invalid
      // AnalyticsQuery body: where: ...` to every array shape, so an
      // `element:number` (array-only since objectstack#12039) rendered into its
      // error state on any deployment served through the runtime route
      // (objectui#7752, objectstack#15828).
      //
      // `undefined` means "no filter to send", not "send nothing meaningful":
      // only a filter that was absent or empty reaches here as `undefined`, and
      // an array the sink cannot lower was refused above rather than dropped.
      if (analyticsWhere !== undefined) payload.where = analyticsWhere;

      const contractResult = await this.client.analytics.query(payload);

      // ONE spelling: `rows` on the post-unwrap `AnalyticsResult`, which is
      // what `client.analytics.query` resolves to since `@objectstack/client`
      // 17.3.0 converged it on `unwrapResponse` (objectstack#13079). The
      // ruling on that card ordered this read tightened in the same wave
      // (objectui#7028); the question the previous ladder deferred was which
      // SDK it still had to read for, and it was never a server question —
      // every 17.x server answers the same `{ success, data }` envelope, and
      // only the client decides whether it is unwrapped. Any other shape
      // throws instead of degrading to `[]`: see `AnalyticsResultShapeError`.
      if (!Array.isArray(contractResult?.rows)) {
        throw new AnalyticsResultShapeError(resource, contractResult);
      }
      const rawRows = contractResult.rows;

      // Defensive guard: if the backend silently dropped the requested measure
      // (e.g. it doesn't recognise the `${field}_${function}` alias and the
      // canonical measure is named differently), the rows come back without
      // any measure value. Detect this and fall back to client-side
      // aggregation so charts still render.
      //
      // "Missing" means the KEY is absent, never that its value is `null`
      // (objectui#12812). A served `null` is the server's answer — the max or
      // min over rows whose field is all NULL is NULL — and it reaches the
      // caller as `null`. Reading it as a dropped measure re-read every row
      // through `find()` only to compute the same `null` client-side. The
      // analytics service writes a measure key only when the engine row
      // carries it, so an unsupported measure surfaces as an absent key (or
      // a refusal), not as a `null` value.
      const measureMissing = rawRows.length > 0 && rawRows.every((row: any) =>
        row == null || (!(measureName in row) && !(valueKey in row)),
      );
      if (measureMissing) {
        return await this.aggregateViaFind(resource, params);
      }

      // Map measure keys back to the object-bound result column so consumers
      // (ObjectChart, DashboardRenderer, …) read values by the name the
      // convention promises: `field`, or `count` for a fieldless count
      // (framework#3701). This includes count → field (e.g. 'count' →
      // 'amount'), matching aggregateClientSide()'s output.
      return rawRows.map((row: any) => {
        const mapped = { ...row };
        if (measureName !== valueKey && measureName in mapped) {
          mapped[valueKey] = mapped[measureName];
          delete mapped[measureName];
        }
        return mapped;
      });
    } catch (e) {
      // Raised by the row read above, not by the transport: analytics answered
      // with a shape this adapter does not read, so there is no failure for
      // the classifier to route and no fallback that would be honest.
      if (e instanceof AnalyticsResultShapeError) throw e;

      const failure = classifyAnalyticsFailure(e);

      // The server refused OUR body — that is a defect in this adapter's
      // request, not a deployment without the capability. Answering it with
      // the client-side path would produce plausible numbers and bury the
      // contract violation, the misdirection framework#3878 documented.
      if (failure.kind === 'rejected') {
        throw new AnalyticsQueryRejectedError(failure.message, failure.code);
      }

      // The session, not the deployment (401 `UNAUTHENTICATED`). Reusing the
      // error the dataset face already throws, because the sentence is the
      // same one on both faces: the request was refused before it ran, so it
      // says nothing about whether the capability is installed. The fallback
      // would send the SAME lapsed token to `find()` and be refused again, so
      // this is a chart that cannot be answered — not one that degrades.
      if (failure.kind === 'unauthenticated') {
        throw new AnalyticsUnauthenticatedError({
          serverCode: failure.code,
          serverMessage: failure.message,
        });
      }

      // Analytics answered; the cube this query named does not exist
      // (framework#3867). Rethrown VERBATIM, deliberately: the producer's own
      // message already names both repairs ("Define a Cube in your stack, or
      // check the object name"), and rethrowing keeps `code` =
      // `CUBE_NOT_FOUND` on the error so a caller can still branch on the
      // contract field — a wrapper of ours would restate the server's words
      // less well and add a published error type nothing has asked for. The
      // fallback is not an option to weigh here: it re-reads the SAME name
      // through `/data`, which framework#3770 answers 404 `OBJECT_NOT_FOUND`.
      if (failure.kind === 'cube-not-found') {
        throw e;
      }

      // The capability is absent (`ROUTE_NOT_FOUND` — framework#4019 stops
      // mounting the routes when no analytics service is registered — or
      // `NOT_IMPLEMENTED`, or a code-less 404/501 no ObjectStack route wrote).
      // Say so ONCE so an operator sees a missing capability rather than
      // charts that quietly read from a slower path forever.
      if (failure.kind === 'not-installed') {
        this.warnAnalyticsCapabilityOnce(failure.message);
      }

      // Degrade to find() + client-side aggregation. `aggregateViaFind`
      // forwards the same filter, so the fallback aggregates over the SAME row
      // set the server-side query would have — and `find()` is server-scoped,
      // so RLS still applies.
      return await this.aggregateViaFind(resource, params);
    }
  }

  /**
   * Answer a grouped list view's GROUP HEADER query (objectui#7189) — see
   * `DataSource.queryGroupHeaders` in `@object-ui/types` for the contract.
   *
   * The compiled query rides the platform's EXISTING data door verbatim:
   * `client.data.query()` posts it to `POST /data/:object/query`, whose
   * `findData` routes a body carrying `groupBy` / `aggregations` to
   * `engine.aggregate` and answers the header rows as `records` (the door the
   * spec half of objectstack#14556 names, pinned platform-side by
   * objectstack#15330). No new route, no new wire shape.
   *
   * ⛔ No fallback, deliberately — unlike {@link aggregate}. A header query that
   * degraded to bucketing a fetched page would answer page slices under a name
   * that promises the query's own numbers, which is the defect this member
   * exists to end. A failure is thrown to the caller, and a body without a
   * `records` array is refused rather than read as "no groups".
   */
  async queryGroupHeaders(
    resource: string,
    query: EngineAggregateOptions,
  ): Promise<ListViewGroupHeaderRow[]> {
    await this.connect();
    const result: unknown = await this.client.data.query(resource, query as any);
    const records = (result as { records?: unknown } | null)?.records;
    if (!Array.isArray(records)) {
      throw new Error(
        `queryGroupHeaders('${resource}'): POST /data/${resource}/query answered without a `
        + '`records` array, so no group header can be read from it. The header query was '
        + 'sent verbatim; nothing was approximated from a page of rows.',
      );
    }
    return records as ListViewGroupHeaderRow[];
  }

  /**
   * Client-side aggregation over a server-scoped `find()` — the fallback used
   * whenever the analytics endpoint cannot answer (capability absent, network
   * failure, or a result whose measure came back missing).
   *
   * Forwarding `params.filter` is load-bearing: without it the fallback
   * aggregates the whole table while the caller believes it applied a filter,
   * which is the "KPI silently sums everything" failure this adapter has
   * guarded against since the widget filter was threaded through.
   */
  private async aggregateViaFind(resource: string, params: any): Promise<any[]> {
    const result = await this.find(
      resource as any,
      params.filter ? ({ $filter: params.filter } as any) : undefined,
    );
    const records = result.data || [];
    if (records.length === 0) return [];
    return this.aggregateClientSide(records, params);
  }

  /**
   * Say "the analytics capability isn't installed" ONCE per adapter, not once
   * per widget: a dashboard fans out one aggregate() per KPI, and N identical
   * console lines read like N different failures.
   */
  private warnAnalyticsCapabilityOnce(detail?: string): void {
    if (this.analyticsCapabilityWarned) return;
    this.analyticsCapabilityWarned = true;
    console.warn(
      '[OBJECTSTACKDataSource] analytics capability unavailable — aggregating client-side ' +
      'from a scoped find(). Numbers stay correct but the semantic layer (cubes, joins, ' +
      'server-side rollups) is off. Install @objectstack/service-analytics to enable it.' +
      (detail ? ` Server said: ${detail}` : ''),
    );
  }

  /**
   * Run a semantic-layer `dataset` (ADR-0021) and return chart-ready rows.
   *
   * Posts to `POST /api/v1/analytics/dataset/query` (see `@objectstack/rest`
   * `registerAnalyticsEndpoints`). Accepts either a saved dataset name or an
   * inline draft definition — the inline form is what the Studio dataset
   * editor sends to preview an unsaved draft. The adapter's bearer token is
   * forwarded so tenant/RLS scoping (ADR-0021 D-C) is enforced server-side.
   *
   * Unlike {@link aggregate}, this does NOT fall back to client-side
   * aggregation: cross-object joins can only run on the server, so a failure
   * is surfaced to the caller (the preview panel shows the error) rather than
   * silently returning wrong numbers.
   *
   * @param dataset - An inline dataset definition (draft) OR a saved dataset name.
   * @param selection - The spec's {@link DatasetSelection} — dimension/measure
   *   names to project plus runtime directives. This parameter IS the spec type
   *   by reference, never a local restatement of it (objectui#3613): a hand
   *   copy of a contract is a second dialect of it, and the copy this replaced
   *   had already drifted three ways from `@objectstack/spec` — it required
   *   `compareTo.dimension` (optional since objectstack#5011, and resolved by
   *   the EXECUTOR, so requiring it pushed callers into exactly the
   *   consumer-side dimension guess AGENTS.md #0.1 forbids), it widened
   *   `timeDimensions` to `unknown[]` and `runtimeFilter` to
   *   `Record<string, unknown>`, and it had never grown `dateGranularity` at
   *   all. Pinned in `queryDataset.test.ts`.
   */
  async queryDataset(
    dataset: Record<string, unknown> | string,
    selection: DatasetSelection,
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    /**
     * Column metadata — the spec's `AnalyticsResult.fields[]` element BY
     * REFERENCE, never a local restatement of it (objectui#3752). Read
     * `@objectstack/spec` for what a column carries; this comment deliberately
     * does not re-list the keys, because the enumeration it replaced was the
     * bug: it named five (`name`/`type`/`label`/`format`/`currency`) and stopped
     * at the contract of the day it was written, so it never grew
     * `percentScale` — the server's answer to whether a percentage column is a
     * 0–1 fraction or already percentage points. The spec says a renderer that
     * receives it "must scale by it instead of guessing from the value"
     * (objectui#3136), so a declaration that hides the key steers a typed
     * consumer into exactly the guess-by-magnitude the issue banned. Pinned in
     * `queryDataset.test.ts`.
     *
     * Only this element is spec-owned: the envelope around it (`object` /
     * `dimensionFields` / `drillRawRows`) is ADR-0021 D2 drill metadata the REST
     * route adds on top of `AnalyticsResult`, and this method never returns the
     * result's `sql`, so the whole envelope is NOT an `AnalyticsResult`.
     */
    fields: Array<AnalyticsResult['fields'][number]>;
    /** ADR-0021 D2 drill-through: the dataset's base object (records to drill into). */
    object?: string;
    /** Drillable dimension NAME → underlying object FIELD name. */
    dimensionFields?: Record<string, string>;
    /** Raw grouped values per row (aligned to `rows` by index) for drill filters. */
    drillRawRows?: Array<Record<string, unknown>>;
    /**
     * Half-open date-range drill scope per row (framework#1752), aligned to
     * `rows` by index: dimension NAME → the field and `[gte, lt)` bounds of that
     * row's time bucket. The RANGE companion to `drillRawRows`, which handles
     * equality dims only — a `dateGranularity` dimension groups a SPAN of
     * records into one bucket, so the server excludes date dims from
     * `dimensionFields`/`drillRawRows` and sends this sidecar instead.
     *
     * The entry type is `@object-ui/core`'s `DatasetDrillRange` BY REFERENCE,
     * not a local restatement of it (objectui#3613/#3752 discipline): the same
     * declaration is what `buildDatasetDrillFilter` — the single consumer that
     * turns these bounds into an ObjectQL `{ $gte, $lt }` — accepts, and what
     * `DatasetWidget` / `DatasetReportRenderer` type their state with. Nothing
     * in `@objectstack/spec` owns this shape yet (the server's own
     * `AnalyticsResultWithDrill` is local to `service-analytics`), so the shared
     * in-repo interface is the one contract available; restating it here would
     * make a third dialect of it. Like `drillRawRows`, only the ARRAY is
     * validated below — the bounds are unvalidated payload, which is exactly why
     * `DatasetDrillRange` declares them `unknown`.
     */
    drillRanges?: Array<Record<string, DatasetDrillRange>>;
    /** Server-computed marginal aggregates, one entry per requested grouping. */
    totals?: Array<{ dimensions: string[]; rows: Array<Record<string, unknown>> }>;
  }> {
    await this.connect();
    const base = (this.baseUrl || '').replace(/\/$/, '');
    const url = `${base}/api/v1/analytics/dataset/query`;
    // ADR-0037 P3 — draft data preview. Preview mode is URL-keyed by design
    // (`?preview=draft` flips the whole document, incl. the Live Canvas
    // iframe), so the adapter reads it straight off the location rather than
    // threading a React context down through every widget package. When set,
    // the server overlays the pending seed draft's rows on the dataset query
    // and resolves draft-overlaid dataset definitions.
    const previewDrafts =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('preview') === 'draft';
    const requestBody = typeof dataset === 'string'
      ? { datasetName: dataset, selection, ...(previewDrafts ? { previewDrafts: true } : {}) }
      : { dataset, selection, ...(previewDrafts ? { previewDrafts: true } : {}) };

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      let errBody: unknown;
      try { errBody = await res.json(); } catch { /* non-JSON error body */ }
      const { code: serverCode, message: serverMessage } = readAnalyticsErrorEnvelope(errBody);
      // The generic branch's tail, and ONLY the generic branch's: it falls back
      // to the raw body so an unclassifiable failure still shows an operator
      // something the server actually sent. Every classified branch below
      // quotes `serverMessage` instead — a message the producer DECLARED — so a
      // parenthetical is never a JSON dump dressed up as the server speaking.
      const detail = serverMessage || (errBody === undefined ? '' : JSON.stringify(errBody));
      const surface = 'POST /analytics/dataset/query';
      // The dataset this query asked for, read off OUR request. `queryDataset`
      // accepts either a saved dataset by name or an inline draft; only the
      // by-name form can miss, but the inline form still carries `name`, so the
      // subject of the sentence is known in both.
      const requestedDatasetName =
        typeof dataset === 'string' ? dataset
        : typeof (dataset as { name?: unknown })?.name === 'string' ? String((dataset as { name?: unknown }).name)
        : undefined;

      /* ── objectui#5663 — branch on the server's ADR-0112 `code`, never on
       * "the endpoint errored" ────────────────────────────────────────────────
       *
       * What stood here tested `res.status === 501 || res.status === 404` and
       * called all of it "the analytics capability is not installed". TWO
       * unrelated conditions answer 404 on this url, and the mapping could not
       * see the difference:
       *
       *   route absent      404 `ROUTE_NOT_FOUND` (runtime dispatcher)
       *   dataset unknown   404 `NOT_FOUND`       (this route's own lookup miss)
       *
       * So a HotCRM tenant whose installed app was too old to define
       * `opportunity_metrics` was told to install a server plugin — while the
       * server printed `Dataset "opportunity_metrics" not found.` inside the
       * SAME banner, in the parenthetical the headline was contradicting. The
       * evidence was in the payload the whole time; the mapping was reading a
       * different field from the one it quoted.
       *
       * The status is not a contract here and never was: it is a transport fact
       * several conditions share, which is the same reason `isApiAccessDenied`
       * and `isAppPermissionDeniedError` above discriminate on `code` (see
       * objectui#4408). The `code` is the contract, it is what ADR-0112 exists
       * to make readable, and the framework declares a distinct one for every
       * condition this call can land in. Branch on it.
       */

      // ① The capability really is absent, from either of its two producers:
      //    the route is mounted with no analytics service behind it (501
      //    `NOT_IMPLEMENTED`, `registerAnalyticsEndpoints`), or the route was
      //    never mounted and the dispatcher answered (404 `ROUTE_NOT_FOUND`).
      //    One remedy — install and mount the service — so one copy.
      if (errorCodeIsAnyOf({ code: serverCode }, ['NOT_IMPLEMENTED', 'ROUTE_NOT_FOUND'])) {
        throw new AnalyticsNotInstalledError(surface, serverMessage, serverCode);
      }

      // ② The route answered; the DATASET is the thing that is missing (404
      //    `NOT_FOUND`). A package problem in the environment, not a missing
      //    server capability — the remedy is upgrading the installed app.
      if (errorCodeIs({ code: serverCode }, 'NOT_FOUND')) {
        throw new AnalyticsDatasetNotFoundError({
          datasetName: requestedDatasetName,
          serverCode,
          serverMessage,
        });
      }

      // ③ The request never ran: the session is anonymous or its token lapsed
      //    (401 `UNAUTHENTICATED`, `enforceAuth`). Nothing about it is evidence
      //    for or against the capability being installed.
      if (errorCodeIs({ code: serverCode }, 'UNAUTHENTICATED')) {
        throw new AnalyticsUnauthenticatedError({ serverCode, serverMessage });
      }

      // ③a The request ran into a READ refusal: this user may not read an
      //    object the dataset queries (403 `PERMISSION_DENIED`, the analytics
      //    read admission — objectui#10899). Typed so a tile can render the
      //    same localized "no access" state the list view does, instead of
      //    the generic string below.
      if (errorCodeIs({ code: serverCode }, 'PERMISSION_DENIED')) {
        throw new AnalyticsForbiddenError({
          serverCode,
          serverMessage,
          datasetName: requestedDatasetName,
        });
      }

      // ④ Residual — the answer declared NO ADR-0112 code, so no ObjectStack
      //    route wrote it (a proxy, a gateway, a host with no API mounted).
      //    Only here is the bare status the best signal available, and only
      //    because every code branch has already declined: this route's own
      //    `NOT_FOUND` always ships a `code`, so a code-less 404 cannot be the
      //    unknown-dataset case.
      if (serverCode === undefined) {
        if (ANALYTICS_ABSENT_STATUSES.includes(res.status)) {
          throw new AnalyticsNotInstalledError(surface, detail || undefined);
        }
        if (res.status === 401) {
          throw new AnalyticsUnauthenticatedError({ serverMessage });
        }
      }

      // ⑤ Everything that named itself and is none of the above — a compile
      //    error like "relationship not declared in include" (400
      //    `DATASET_INVALID`), a `CUBE_NOT_FOUND`, a 5xx — is a real failure
      //    with a real server detail, and keeps it. Note that a 404
      //    `CUBE_NOT_FOUND` used to land in the capability-missing branch too,
      //    by the same status collision; it now reads as what it is.
      throw new Error(`Dataset query failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
    }

    const payload = await res.json();
    // Unwrap the standard `{ success, data }` envelope when present.
    const data = payload && typeof payload === 'object' && 'success' in payload && 'data' in payload
      ? (payload as { data: unknown }).data
      : payload;
    const rows = Array.isArray((data as any)?.rows)
      ? (data as any).rows
      : (Array.isArray(data) ? (data as any) : []);
    const fields = Array.isArray((data as any)?.fields) ? (data as any).fields : [];
    // Drill-through metadata (ADR-0021 D2): the server exposes the dataset's
    // base object + drillable dimension→field mapping, plus a parallel array of
    // RAW grouped values (the rows themselves carry display labels), so a host
    // can build an exact-match filter from a clicked bucket.
    const object = typeof (data as any)?.object === 'string' ? (data as any).object : undefined;
    const dimensionFields =
      (data as any)?.dimensionFields && typeof (data as any).dimensionFields === 'object'
        ? ((data as any).dimensionFields as Record<string, string>)
        : undefined;
    const drillRawRows = Array.isArray((data as any)?.drillRawRows) ? (data as any).drillRawRows : undefined;
    // framework#1752 — the date-range sidecar. Dropping it here (objectui#3813)
    // made date-bucket drill-through impossible through the only real adapter:
    // a widget grouped ONLY by a date dimension gets no `dimensionFields` (the
    // server excludes date dims from the equality drill), so `drillRanges` is
    // the ONLY thing that can make `canDrill` true — with the key hand-picked
    // away, the whole drill entry point disappeared, and a mixed grouping
    // drilled to a superset (every bucket, not the clicked one).
    const drillRanges = Array.isArray((data as any)?.drillRanges) ? (data as any).drillRanges : undefined;
    const totals = Array.isArray((data as any)?.totals) ? (data as any).totals : undefined;
    return { rows, fields, object, dimensionFields, drillRawRows, drillRanges, totals };
  }

  /** Client-side aggregation fallback */
  /**
   * The result column an object-bound `aggregate` projects its value under
   * (framework#3701, `chartAggregateValueKey` in `@objectstack/spec/ui`): the
   * raw `field` name — no `sum_`-style decoration, unlike a dataset measure —
   * or the literal `count` when a count names no field.
   */
  private aggregateValueKey(params: { field?: string; function?: string }): string {
    return params.field || params.function || 'count';
  }

  private aggregateClientSide(records: any[], params: { field?: string; function: string; groupBy: string }): any[] {
    const { field, function: aggFn, groupBy } = params;
    const valueKey = this.aggregateValueKey(params);
    const groups: Record<string, any[]> = {};

    for (const record of records) {
      const key = String(record[groupBy] ?? 'Unknown');
      if (!groups[key]) groups[key] = [];
      groups[key].push(record);
    }

    return Object.entries(groups).map(([key, group]) => {
      const values = field ? group.map(r => Number(r[field]) || 0) : [];
      let result: number;

      switch (aggFn) {
        case 'count': result = group.length; break;
        case 'avg': result = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
        case 'min': result = values.length > 0 ? Math.min(...values) : 0; break;
        case 'max': result = values.length > 0 ? Math.max(...values) : 0; break;
        case 'sum': default: result = values.reduce((a, b) => a + b, 0); break;
      }

      return { [groupBy]: key, [valueKey]: result };
    });
  }

  /**
   * Get multiple metadata items from ObjectStack.
   * Uses v3.0.0 metadata API pattern: getItems for batch retrieval.
   */
  async getItems(category: string, names: string[]): Promise<unknown[]> {
    await this.connect();
    
    const results = await Promise.all(
      names.map(async (name) => {
        const cacheKey = `${category}:${name}`;
        return this.metadataCache.get(cacheKey, async () => {
          const result: any = await this.client.meta.getItem(category, name);
          if (result && result.item) return result.item;
          return result;
        });
      })
    );
    
    return results;
  }

  /**
   * Get cached metadata if available, without triggering a fetch.
   * Uses v3.0.0 metadata API pattern: getCached for synchronous cache access.
   */
  getCached(key: string): unknown | undefined {
    return this.metadataCache.getCachedSync(key);
  }

  /**
   * Get cache statistics for monitoring performance.
   */
  getCacheStats() {
    return this.metadataCache.getStats();
  }

  /**
   * Invalidate metadata cache entries.
   * 
   * @param key - Optional key to invalidate. If omitted, invalidates all entries.
   */
  invalidateCache(key?: string): void {
    this.metadataCache.invalidate(key);
  }

  /**
   * Clear all cache entries and statistics.
   */
  clearCache(): void {
    this.metadataCache.clear();
  }

  /**
   * Upload a single file to a resource.
   * Posts the file as multipart/form-data to the ObjectStack server.
   *
   * @param resource - The resource/object name to attach the file to
   * @param file - File object or Blob to upload
   * @param options - Additional upload options (recordId, fieldName, metadata)
   * @returns Promise resolving to the upload result (file URL, metadata)
   */
  async uploadFile(
    resource: string,
    file: File | Blob,
    options?: {
      recordId?: string;
      fieldName?: string;
      metadata?: Record<string, unknown>;
      onProgress?: (percent: number) => void;
    },
  ): Promise<FileUploadResult> {
    await this.connect();

    const formData = new FormData();
    formData.append('file', file);

    if (options?.recordId) {
      formData.append('recordId', options.recordId);
    }
    if (options?.fieldName) {
      formData.append('fieldName', options.fieldName);
    }
    if (options?.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const url = `${this.baseUrl}/api/data/${encodeURIComponent(resource)}/upload`;

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        ...(this.getAuthHeaders()),
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText }));
      // #9594 - share the DIALECT READING only. This site's envelope is not the
      // four ladders': a different error class, a hard-coded `UPLOAD_ERROR`
      // code, and its own last rung, all of which stay exactly as they were.
      const envelope = readErrorEnvelope(errorBody);
      throw new ObjectStackError(
        envelope.message ?? `Upload failed with status ${response.status}`,
        'UPLOAD_ERROR',
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Upload multiple files to a resource.
   * Posts all files as a single multipart/form-data request.
   *
   * @param resource - The resource/object name to attach the files to
   * @param files - Array of File objects or Blobs to upload
   * @param options - Additional upload options
   * @returns Promise resolving to array of upload results
   */
  async uploadFiles(
    resource: string,
    files: (File | Blob)[],
    options?: {
      recordId?: string;
      fieldName?: string;
      metadata?: Record<string, unknown>;
      onProgress?: (percent: number) => void;
    },
  ): Promise<FileUploadResult[]> {
    await this.connect();

    const formData = new FormData();
    files.forEach((file, idx) => {
      formData.append(`files`, file, (file as File).name || `file-${idx}`);
    });

    if (options?.recordId) {
      formData.append('recordId', options.recordId);
    }
    if (options?.fieldName) {
      formData.append('fieldName', options.fieldName);
    }
    if (options?.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const url = `${this.baseUrl}/api/data/${encodeURIComponent(resource)}/upload`;

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        ...(this.getAuthHeaders()),
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText }));
      // #9594 - share the DIALECT READING only. This site's envelope is not the
      // four ladders': a different error class, a hard-coded `UPLOAD_ERROR`
      // code, and its own last rung, all of which stay exactly as they were.
      const envelope = readErrorEnvelope(errorBody);
      throw new ObjectStackError(
        envelope.message ?? `Upload failed with status ${response.status}`,
        'UPLOAD_ERROR',
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Cancel (recall) the active pending approval request for a given record.
   *
   * Looks up the most recent `sys_approval_request` for the (object, record)
   * pair whose status is `pending` or `in_approval`, then issues a POST to
   * `/api/v1/approvals/requests/:id/recall`. The submitter is the only role
   * permitted to recall on the server — non-submitters will receive a 403.
   *
   * On success, the backend mirrors `approval_status = 'recalled'` onto the
   * source record so the lock badge disappears on next fetch.
   */
  async cancelPendingApproval(
    objectName: string,
    recordId: string,
  ): Promise<{ requestId: string; status: string }> {
    await this.connect();

    // Use the approvals service REST endpoint directly. The generic
    // `/api/v1/data/sys_approval_request` route applies record-sharing
    // ACLs that the approvals collection isn't always registered for,
    // so prefer the cross-cutting `/approvals/requests` endpoint which
    // is owned by the approvals service itself.
    const listUrl = `${this.baseUrl}/api/v1/approvals/requests?recordId=${encodeURIComponent(recordId)}&object=${encodeURIComponent(objectName)}`;
    const listRes = await this.fetchImpl(listUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
    });
    if (!listRes.ok) {
      throw new ObjectStackError(
        `Failed to look up approval requests (status ${listRes.status})`,
        'APPROVAL_LOOKUP_FAILED',
        listRes.status,
      );
    }
    const listBody: any = await listRes.json().catch(() => ({}));
    const rows: any[] = Array.isArray(listBody) ? listBody : (listBody?.data ?? []);
    const pending = rows.find(
      (r) => r?.status === 'pending' || r?.status === 'in_approval',
    );
    if (!pending?.id) {
      throw new ObjectStackError(
        'No pending approval request found for this record',
        'NO_PENDING_REQUEST',
        404,
      );
    }

    const url = `${this.baseUrl}/api/v1/approvals/requests/${encodeURIComponent(pending.id)}/recall`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      throw new ObjectStackError(
        err?.error || err?.message || `Recall failed with status ${response.status}`,
        err?.code || 'APPROVAL_RECALL_FAILED',
        response.status,
      );
    }
    const body: any = await response.json().catch(() => ({}));
    return { requestId: pending.id, status: body?.data?.request?.status ?? 'recalled' };
  }

  /**
   * Get authorization headers from the adapter config.
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }
}

/**
 * Factory function to create an ObjectStack data source.
 *
 * The declared return is `ObjectStackAdapter<T>`, not the shared
 * `DataSource<T>` interface: the object this hands back is an
 * `ObjectStackAdapter`, and the adapter-only members the package README
 * documents — `getClient`, the metadata-cache controls, the connection-state
 * and batch-progress subscriptions — live on the class, not on `DataSource`.
 * Declaring the interface here narrowed all of them
 * away from the factory while leaving them on the value (objectui#7323), so
 * `createObjectStackAdapter(...)` and `new ObjectStackAdapter(...)` — the two
 * documented ways to obtain the same object — handed back different type
 * surfaces. ⛔ Do not narrow this back to `DataSource<T>`: a caller who wants
 * the narrow surface writes `const ds: DataSource = createObjectStackAdapter(…)`
 * and gets it, because a wider return is assignable to the narrower annotation;
 * the reverse is not recoverable at the call site without a cast.
 * `adapterFactoryReturn.types.test.ts` pins both directions.
 * 
 * @example
 * ```typescript
 * const dataSource = createObjectStackAdapter({
 *   baseUrl: process.env.API_URL,
 *   token: process.env.API_TOKEN,
 *   cache: { maxSize: 100, ttl: 300000 },
 *   autoReconnect: true,
 *   maxReconnectAttempts: 5
 * });
 * ```
 */
export function createObjectStackAdapter<T = unknown>(config: {
  baseUrl: string;
  token?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  cache?: {
    maxSize?: number;
    ttl?: number;
  };
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}): ObjectStackAdapter<T> {
  return new ObjectStackAdapter<T>(config);
}

// Export error classes for error handling
export {
  ObjectStackError,
  MetadataNotFoundError,
  BulkOperationError,
  ConnectionError,
  AuthenticationError,
  DataApiValidationError,
  createErrorFromResponse,
  isObjectStackError,
  isErrorType,
} from './errors';

// Export cache types
export type { MetadataCacheStats } from './cache/MetadataCache';

// User-scoped persistence adapter (favorites / recent items / …)
export {
  createObjectStackUserStateAdapter,
  createObjectStackUserPreferenceFamily,
  PREFERENCE_FAMILY_ROW_LIMIT,
} from './userState';
export type {
  ObjectStackUserStateAdapterOptions,
  ObjectStackUserPreferenceFamilyOptions,
  UserDataAdapter,
  UserPreferenceFamily,
} from './userState';

// Metadata API client — read/write protocol metadata via /api/v1/meta/*.
// Used by plugin-designer to back the Setup-app Object Manager and Field
// Designer surfaces; kept separate from ObjectStackAdapter so callers
// can use it without the full data-source surface.
export { MetadataClient, readSaveAdvisories } from './metadata-client';
// The one draft-envelope reader (objectui#8181). Exported beside the
// `getDraft` that produces the envelope, because the unwrap-and-strip is part
// of that method's contract rather than a detail of any one view.
export { extractDraftBody } from './draft-envelope';
// objectui#12725 - the reader of the same envelope's per-key provenance
// (`draftChanges`, objectstack#24298): which surface last changed a key of the
// pending draft. One reader, so the longest-prefix rule is spelled once.
export { readDraftChanges, governingDraftChange, draftChangesUnder } from './draft-envelope';
export type { DraftChange } from './draft-envelope';
// objectui#10202 / objectui#11692 - the served -> authored conversion of a
// picklist-bound field, exported for the WRITERS that seed an object PUT from a
// served read (the read answers `picklist` beside the resolved `options`, and the
// authoring door refuses the pair). ⛔ Never applied inside `MetadataClient.save`:
// a door cannot tell a served copy from an authored pair, and the second must
// stay the server's loud refusal. See the module's docblock.
export { dropServedPicklistOptions } from './picklist-binding';
// objectui#11302 - the one reader of a failed metadata save, exported beside the
// `MetadataError.issues` it reads so every surface that saves through this
// client renders the per-field prescription the same way.
export { formatMetadataError, formatMetadataIssue } from './metadata-error';
// objectui#8676 - the object-metadata write invariant, exported so the two DOORS
// that do not run through `MetadataClient.save` can apply the same one. It is
// exported for DOORS, not for writers: a writer that calls it by hand is a
// writer that can forget to, which is the enumeration failure this closes.
// `scripts/check-object-metadata-write-doors.mjs` derives the door set and
// fails when a door does not reach this function.
export {
  assertObjectMetadataWritable,
  RELATIONSHIP_TYPES_REQUIRING_REFERENCE,
  CHOICE_TYPES_REQUIRING_OPTIONS,
  OBJECT_METADATA_TYPE,
} from './object-metadata-write-guard';
export type {
  RuntimeAuthoringIssue,
  MetadataSaveAdvisoryEvent,
  MetadataSaveAdvisoryListener,
  MetadataClientConfig,
  MetadataListOptions,
  MetadataListAnswer,
  MetadataDraftHeader,
  MetadataClientSaveOptions,
  MetadataGetOptions,
  MetadataDeleteOptions,
  MetadataHistoryOptions,
  MetadataError,
  MetadataValidationIssue,
  MetadataLayered,
  MetadataLockState,
  MetadataOverlayScope,
  MetadataReference,
  MetadataDiagnostics,
  MetadataDiagnosticsOptions,
  MetadataDiagnosticsEntry,
  MetadataDiagnosticsSummary,
  MetadataAuditEntry,
  MetadataAuditResponse,
} from './metadata-client';
