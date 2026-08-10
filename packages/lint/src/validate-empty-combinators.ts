// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5330 — a LITERAL empty combinator in authored metadata is refused at
 * authoring time, with a per-shape prescription.
 *
 * ## The runtime is not changing, and this file changes nothing about it
 *
 * #5322 (maintainer ruling, 2026-08-04) settled the RUNTIME semantics of the
 * four empty shapes as the boolean identity reduction, and #5659/PR #6528 made
 * that reduction one implementation — `reduceFilterVerdict` in
 * `@objectstack/spec/data`, proven against `FILTER_LOGIC_CASES` and consumed by
 * every backend. This rule touches no translate or evaluation path. It asks the
 * SAME predicate what a shape is worth and reports it; a stack that ignores the
 * finding runs exactly as it ran before.
 *
 * ### History note, so the next reader is not misled
 *
 * `service-analytics`' `filter-normalizer.ts` used to REFUSE `{$and: []}` and
 * `{$or: []}` at compile time, and its error argued, verbatim:
 *
 *   > An empty combinator has no defensible reading — dropping it widens the
 *   > query, and treating it as "match nothing" silently empties a chart.
 *
 * That wording is GONE from the runtime. #5322 overruled it (only a reduction
 * can evaluate a nested tree — a rejection must first reduce to judge `$and: []`
 * as the third branch of a `$or`, which concedes the point; and `{$or: []}` =
 * zero rows is fail-closed exactly where it matters, #5134), and PR #5365
 * replaced the throw with the identity. The sentiment survives here, one layer
 * earlier and with the one thing the runtime version could never have: a
 * prescription. If you are reading this because you saw that sentence quoted
 * somewhere, the runtime does **not** throw on an empty combinator any more —
 * `filter-normalizer.ts`'s own `buildNode` records the same history at its
 * combinator branch.
 *
 * ## The literal-vs-programmatic boundary — this rule's own decision
 *
 * #5322 kept the runtime identity *because* a programmatic producer needs it: a
 * read scope whose disjunct list loops to zero items must fail CLOSED
 * (`{$or: []}` = zero rows) rather than expose the table. So the rejection may
 * not reach that producer, and the boundary has to be exact.
 *
 * It is **structural, not heuristic**. This rule reads the AUTHORED METADATA
 * GRAPH — the stack a config file declares, and the item the runtime publish
 * gate is about to persist. Every value it sees is already in the metadata. A
 * value a producer CONSTRUCTS while serving a request never enters that graph
 * and therefore never reaches this rule: `objectql-strategy.ts` building
 * `{$not: {}}` from a CEL literal, `cel-to-filter` lowering an RLS predicate, a
 * client assembling a query — all of them hand a filter straight to a driver,
 * where #5322's identity is the single semantics. There is no predicate to get
 * wrong here, because a lint rule cannot see those values at all.
 *
 * The dividing line is therefore "did this value reach the metadata graph", NOT
 * "did a human type it". A TS config that computes a filter at `defineStack`
 * time and produces `{$or: []}` has produced authored metadata and is judged as
 * such — which is the direction that helps, since that author can still see it
 * before publishing, and the alternative (a scope that silently returns zero
 * rows in production) is the #5134 defect itself.
 *
 * ## Why `error`, per the severity bar this package states
 *
 * Gate when no reading of the metadata behaves as written. All five reported
 * shapes qualify — a combinator whose operand list is empty, and an empty node
 * standing where a condition belongs, both read as "a filter is applied here"
 * and apply nothing (or, for `$or: []` / `$not: {}`, apply the OPPOSITE of what
 * the shape suggests to a reader who has not memorised the identity table).
 * That is the ADR-0049 declared-but-not-enforced shape, and Prime Directive #12
 * puts the refusal at the producer rather than tolerance at the consumer.
 *
 * The asymmetry is the whole reason the prescriptions are per shape:
 * `{$and: []}` and `{}` reduce to TRUE (match EVERY row), `{$or: []}` and
 * `{$not: {}}` reduce to FALSE (match NO row). A generic "empty combinator, fix
 * it" message teaches the wrong fix half the time. #5388 holds a live instance
 * of exactly that confusion one package over (`plugin-sharing`'s
 * `isMatchAllCriteria` labels `{$or: []}` "match-all"), so the vocabulary here
 * is written to be quoted.
 *
 * ## What this rule deliberately does NOT judge
 *
 *  - **`{ field: {} }`** — a field constrained by zero operators. #5240 ruled
 *    it REJECTED and #5327 gated the backends; it is a different shape with a
 *    different fix, and the walk below never descends into a field key's value
 *    for that reason. A comparand is data.
 *  - **A non-array `$and`/`$or`, or a non-object `$not` operand.** The schema
 *    and the drivers refuse those by name (`assertNodeList` / `assertNode` in
 *    `filter-verdict.ts`); inventing a second complaint here would describe a
 *    run that never happens.
 *  - **The ARRAY authoring shape** (`filter: [{ field, operator, value }]`,
 *    `filter: []`). That is `FilterArray`, lowered by `parseFilterAST`, and it
 *    is not one of the four shapes #5322 ruled on. Judging it would need its
 *    own conformance evidence, so it is out of scope rather than guessed at.
 *  - **An absent `filter` key.** That is the canonical spelling of "no filter"
 *    and this rule's own prescription for three of the five shapes.
 *
 * ## Relationship to `flow-multi-write-unfiltered` (#5482)
 *
 * `lint-flow-patterns.ts` WARNS when a `multi: true` CRUD node is bounded by a
 * filter that reduces to TRUE, and it deliberately does not gate: the engine's
 * dispatch case-set grants a whole-object write on purpose, so the shape has a
 * legitimate reading. That is not in tension with the gate here, because the two
 * judge different facts and the canonical spelling of the legitimate intent —
 * omitting the key — is untouched by this rule. On `{ $and: [] }` + `multi` both
 * fire, and they are sequential rather than duplicate: delete the `$and` as this
 * rule prescribes and the write is still unbounded, so #5482's warning is still
 * the right next thing for the author to read.
 */

import { reduceFilterVerdict, type FilterVerdict } from '@objectstack/spec/data';

import { walkAuthoredFilters, type FilterSurface } from './filter-walk.js';

/** A literal `$and: []` / `$or: []` / `$not: {}` — a combinator with no operands. */
export const FILTER_EMPTY_COMBINATOR = 'filter-empty-combinator';
/** A literal `{}` where a filter node is authored — the whole filter, or a branch. */
export const FILTER_EMPTY_NODE = 'filter-empty-node';

export type EmptyCombinatorSeverity = 'error' | 'warning';

export interface EmptyCombinatorFinding {
  /** Always `error` — see the severity note in this module's header. */
  severity: EmptyCombinatorSeverity;
  /** Diagnostic rule id (`filter-empty-combinator` / `filter-empty-node`). */
  rule: string;
  /** Human-readable location, e.g. `dashboard "sales" · widget "my_deals"`. */
  where: string;
  /** Config path, e.g. `dashboards[0].widgets[2].filter.$or`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/**
 * The collections whose authored filters this rule judges.
 *
 * The seven presentation surfaces `validate-filter-tokens.ts` scans, plus
 * `flows`: a CRUD node's `config.filter` is authored metadata like any other,
 * and it is the surface where an empty combinator has the largest blast radius
 * (`{$or: []}` on a `delete_record` deletes nothing and reports `acted: 0`,
 * which reads as "there was nothing to purge").
 */
const EMPTY_COMBINATOR_SURFACES: readonly FilterSurface[] = [
  { key: 'dashboards', kind: 'dashboard' },
  { key: 'objects', kind: 'object' },
  { key: 'views', kind: 'view' },
  { key: 'reports', kind: 'report' },
  { key: 'datasets', kind: 'dataset' },
  { key: 'pages', kind: 'page' },
  { key: 'apps', kind: 'app' },
  { key: 'flows', kind: 'flow' },
];

/**
 * Is `value` a Filter Protocol NODE — a plain object, the shape
 * `FilterConditionSchema` declares for a `$and`/`$or` element and for the
 * operand of `$not`?
 *
 * The prototype check mirrors `filter-verdict.ts`'s `isFilterNode` and is
 * load-bearing for the same reason, in the mirror direction: a `Date`, a `Map`
 * or a class instance enumerates to zero own keys, and reading one as "an empty
 * node" would report a shape the author did not write. A filter node arrives as
 * JSON or as a config module's plain object, so requiring one costs nothing.
 */
function isFilterNode(value: unknown): value is AnyRec {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Where an empty node was authored — the axis the prescription turns on. */
type EmptyNodePosition = 'root' | 'and-branch' | 'or-branch';

/**
 * What the shared reduction says each reported shape is worth.
 *
 * Derived, never asserted: the words "matches EVERY row" / "matches NO row" in
 * every message below come from `reduceFilterVerdict` — the same function the
 * five backends execute — so a message cannot drift from the ruling it quotes.
 * `verdict-agrees-with-the-shared-reduction` in the tests pins that the four
 * probes still answer what the prose claims.
 */
const VERDICT_OF = {
  $and: reduceFilterVerdict({ $and: [] }),
  $or: reduceFilterVerdict({ $or: [] }),
  $not: reduceFilterVerdict({ $not: {} }),
  node: reduceFilterVerdict({}),
  /** One TRUE disjunct absorbs its `$or`: the sibling branches stop mattering. */
  orWithEmptyBranch: reduceFilterVerdict({ $or: [{ status: 'open' }, {}] }),
} as const;

/** Render a verdict as the row set it selects, for a message an author can act on. */
function rows(verdict: FilterVerdict): string {
  if (verdict === 'true') return 'matches EVERY row';
  if (verdict === 'false') return 'matches NO row';
  // Unreachable for the four literal shapes; kept honest rather than asserted.
  return 'carries a real predicate';
}

/**
 * The one spelling of "match no row" that is a declared predicate rather than
 * an identity nobody can read: an empty `$in` list.
 *
 * Not invented here — `packages/objectql/src/filter-comparand-shape.ts` names
 * `$in: []` / `$nin: []` as "a legitimate, declared predicate — matches nothing
 * and matches everything respectively", and deliberately does not refuse them.
 */
const MATCH_NONE_SPELLING =
  'If you really do want a predicate that selects nothing, `{ <field>: { $in: [] } }` is the declared ' +
  'spelling for it (an empty `$in` list matches nothing, on every backend) — it says so where an empty ' +
  'combinator only implies it.';

/** The prescription every shape shares: an absent key IS "no filter". */
const OMIT_THE_KEY =
  'To express "no filter", DELETE the key — an absent `filter` and a filter that reduces to TRUE run ' +
  'identically, and only the absent key says so to the next reader (and to the next AI author that ' +
  'copies this metadata).';

interface Ctx {
  where: string;
  out: EmptyCombinatorFinding[];
}

function emitEmptyCombinator(key: '$and' | '$or' | '$not', path: string, ctx: Ctx): void {
  const spelling = key === '$not' ? '`$not: {}`' : `\`${key}: []\``;

  const message =
    key === '$and'
      ? '`$and: []` is a conjunction of ZERO conditions. Under the #5322 identity ruling it ' +
        `${rows(VERDICT_OF.$and)} — the key is authored, and it constrains nothing, so this surface ` +
        'reads as filtered and is not.'
      : key === '$or'
        ? '`$or: []` is a disjunction of ZERO branches. Under the #5322 identity ruling it ' +
          `${rows(VERDICT_OF.$or)}: this surface renders permanently empty, and on a read scope it hides ` +
          'every row (fail-closed by design — #5134).'
        : '`$not: {}` negates an EMPTY node. An empty node is TRUE and NOT TRUE is FALSE, so it ' +
          `${rows(VERDICT_OF.$not)} — the opposite of the "no filter" an empty operand looks like.`;

  const hint =
    key === '$and'
      ? `${OMIT_THE_KEY} To express a constraint, put the conditions in the array. ${MATCH_NONE_SPELLING}`
      : key === '$or'
        ? 'If you meant "no filter", this is its OPPOSITE: emptying the array does not relax the filter, ' +
          `it closes it. ${OMIT_THE_KEY} If you meant to offer alternatives, put the branches in the ` +
          `array. ${MATCH_NONE_SPELLING}`
        : 'Put the condition you are negating inside `$not` (`{ $not: { status: \'closed\' } }`). ' +
          `${OMIT_THE_KEY} ${MATCH_NONE_SPELLING}`;

  ctx.out.push({
    severity: 'error',
    rule: FILTER_EMPTY_COMBINATOR,
    where: ctx.where,
    path,
    message: `${message} A literal ${spelling} is not an authoring surface (#5330).`,
    hint:
      `${hint} A PROGRAMMATIC producer that loops to zero operands keeps the runtime identity ` +
      'unchanged — this rule judges only what is written in the metadata.',
  });
}

function emitEmptyNode(position: EmptyNodePosition, path: string, ctx: Ctx): void {
  if (position === 'root') {
    ctx.out.push({
      severity: 'error',
      rule: FILTER_EMPTY_NODE,
      where: ctx.where,
      path,
      message:
        'An EMPTY filter node (`{}`) is authored here. Under the #5322 identity ruling an empty node is ' +
        `TRUE — it ${rows(VERDICT_OF.node)}, exactly as if the key were absent — so a filter is declared ` +
        'and enforces nothing.',
      hint:
        `${OMIT_THE_KEY} If you meant to constrain something, write the condition into the node. ` +
        `${MATCH_NONE_SPELLING}`,
    });
    return;
  }

  if (position === 'or-branch') {
    ctx.out.push({
      severity: 'error',
      rule: FILTER_EMPTY_NODE,
      where: ctx.where,
      path,
      message:
        'An EMPTY branch (`{}`) of a `$or`. An empty node is TRUE, and one TRUE disjunct ABSORBS the ' +
        `whole disjunction (\`{ $or: [{ status: 'open' }, {}] }\` ${rows(VERDICT_OF.orWithEmptyBranch)}), ` +
        'so every branch you wrote beside it is dead.',
      hint:
        'Delete the empty branch — the `$or` then means what it looks like. If it was meant to carry a ' +
        'condition, write it. (A compiler that DROPPED the empty branch instead would silently NARROW ' +
        'the scope to the surviving branches, which is why the runtime absorbs rather than filters — ' +
        '#5297.)',
    });
    return;
  }

  ctx.out.push({
    severity: 'error',
    rule: FILTER_EMPTY_NODE,
    where: ctx.where,
    path,
    message:
      'An EMPTY branch (`{}`) of a `$and`. An empty node is TRUE — the AND identity — so the branch ' +
      'contributes no condition and the conjunction means whatever its other branches mean.',
    hint:
      'Delete the empty branch, or write the condition it was meant to carry. A branch that constrains ' +
      'nothing is indistinguishable from one whose condition was lost in an edit.',
  });
}

/** Recurse into a node whose emptiness has already been decided by the caller. */
function scanNodeKeys(node: AnyRec, path: string, ctx: Ctx): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === '$and' || key === '$or') {
      // A non-array operand is refused BY NAME at the schema and at every
      // driver (`assertNodeList`); it is not this rule's complaint to make.
      if (!Array.isArray(value)) continue;
      if (value.length === 0) {
        emitEmptyCombinator(key, `${path}.${key}`, ctx);
        continue;
      }
      value.forEach((element, index) => {
        scanBranch(element, `${path}.${key}[${index}]`, key === '$and' ? 'and-branch' : 'or-branch', ctx);
      });
      continue;
    }

    if (key === '$not') {
      if (!isFilterNode(value)) continue;
      if (Object.keys(value).length === 0) {
        emitEmptyCombinator('$not', `${path}.$not`, ctx);
        continue;
      }
      scanNodeKeys(value, `${path}.$not`, ctx);
      continue;
    }

    // A field key. Its value is a comparand or an operator object, never a
    // node — `{ field: {} }` is #5240's surface and is judged there, not here.
  }
}

/** A node standing where emptiness is itself the authored evidence. */
function scanBranch(value: unknown, path: string, position: EmptyNodePosition, ctx: Ctx): void {
  if (!isFilterNode(value)) return;
  if (Object.keys(value).length === 0) {
    emitEmptyNode(position, path, ctx);
    return;
  }
  scanNodeKeys(value, path, ctx);
}

/**
 * Reject literal empty combinators across an authored stack.
 *
 * Pure `(stack) => Finding[]`; no I/O. Tolerates both authoring tiers — a
 * filter subtree survives the Zod parse unchanged, and no filter key in the
 * spec carries a `.default({})`, so a `{}` seen here was authored, never filled
 * in by a schema.
 */
export function validateEmptyCombinators(
  stack: Record<string, unknown> | undefined | null,
): EmptyCombinatorFinding[] {
  if (!stack || typeof stack !== 'object') return [];
  const out: EmptyCombinatorFinding[] = [];

  walkAuthoredFilters(stack, EMPTY_COMBINATOR_SURFACES, ({ value, path, where }) => {
    scanBranch(value, path, 'root', { where, out });
  });

  return out;
}
