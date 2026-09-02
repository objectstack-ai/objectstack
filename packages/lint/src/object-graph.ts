// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared resolution: what does a `relationship[.relationship].field` path
 * address in this stack's object graph? (issue #14105)
 *
 * Three rules in this package need the same answer to the same question — "does
 * this dotted field path resolve to a real column, through real joins?" — and
 * they ask it at different positions: a dataset's `dimensions[].field` /
 * `measures[].field` / filter keys (#14105), a widget's filter keys and
 * `sortBy` (#14148), and a list view's field positions (#14107). The
 * subtree-finding half of the same family already lives in `filter-walk.ts`
 * (#3574/#5330); this file is the RESOLUTION half, written from that file's
 * argument: with N copies of a hop-walker the next author fixes one of N and
 * the survivors keep the old verdict.
 *
 * ## What is shared, and what deliberately is NOT
 *
 * The MECHANISM is shared: index the objects once, walk a dotted path hop by
 * hop through the declared relationship fields, and return a VERDICT. The
 * JUDGEMENT is the caller's — this module emits no findings, holds no rule ids
 * and decides no severities, because the same verdict means different things at
 * different positions (a dataset dimension's dangling path renders an empty
 * chart; a list view's renders a blank column). {@link FieldPathVerdict} is
 * deliberately a discriminated union rather than a boolean for exactly that
 * reason: a caller that cannot distinguish "the head hop is not a
 * relationship" from "the leaf field does not exist" cannot write the
 * prescription an author needs.
 *
 * ## The three skips, matching every field-existence rule in this package
 *
 * Verdicts are `unknowable` — never a miss — when the graph cannot answer
 * (ADR-0072 D1: one dead finding and authors stop trusting the linter):
 *
 *   1. An object this stack does not define. It may come from another package
 *      — the shipped `system.datasets.ts` is five datasets over `sys_*`
 *      objects that live in `plugin-audit` and the cloud runtime, so a stack
 *      compiling plugin-auth alone genuinely cannot see them.
 *   2. An object that declares no readable field map — ADR-0015 `external` and
 *      datasource-introspected schemas whose columns resolve at runtime.
 *   3. Registry-injected system columns, which exist at runtime and never
 *      appear in authored `fields`. Resolved per object through
 *      {@link injectedColumnsFor}, never the object-independent
 *      `SYSTEM_FIELDS` union — the two differ exactly where it matters (on
 *      `ownership: 'none'` the platform injects no `owner_id`, so a reference
 *      to it there is a real defect). The shipped
 *      `showcase_task_metrics.created_at` dimension is skip 3's live case.
 */

import { injectedColumnsFor } from './system-fields.js';

/** Any plain metadata record. */
type AnyRec = Record<string, unknown>;

/**
 * Field types that address ANOTHER object, so a `.<hop>` through one is a join
 * the query compiler derives rather than a column read.
 *
 * `user` and `tree` are members alongside the two obvious ones for the reason
 * `validate-flow-template-paths.ts` lists them: both store a foreign key and
 * both are traversed the same way. A dataset `include` naming one is joinable
 * exactly as a `lookup` is.
 */
export const RELATIONSHIP_FIELD_TYPES: ReadonlySet<string> = new Set([
  'lookup',
  'master_detail',
  'user',
  'tree',
]);

/** The slice of one field this module reads. */
export interface GraphField {
  /** Declared `type`, when the author wrote one. */
  type?: string;
  /**
   * The object a relationship field addresses.
   *
   * `reference` is the ONLY spelling `FieldSchema` declares — `referenceTo` /
   * `relatedTo` / `target` / `targetObject` / `lookupObject` are REJECTED
   * aliases the strict error map maps back to it (#5017), so a field spelling
   * one of them does not parse at all. Re-admitting an alias here would be the
   * tolerant consumer Prime Directive #12 refuses, so only `reference` is read.
   */
  reference?: string;
  /**
   * The declared `multiple: true` flag, when the author wrote one.
   *
   * Read here because the dotted-path verdict a caller may reach for
   * ({@link classifyDottedFilterHead} in `@objectstack/spec/data`) is a
   * function of BOTH `type` and `multiple`: an array-valued head is
   * deliberately unjudged there, since a numeric-index dotted path genuinely
   * reaches into it on two of three backends. A caller handed only `type`
   * would have to re-derive the flag from the raw stack, which is the second
   * copy this module exists to prevent. Additive (#14282): every existing
   * consumer that ignores the key keeps its verdicts byte-for-byte.
   */
  multiple?: boolean;
}

/**
 * One object's resolvable surface. `null` in the index marks an object that
 * declares no readable field map, keeping "declared nothing" distinguishable
 * from "not in this stack" — the same distinction
 * {@link indexObjectSearchTargets} draws for the search axis.
 */
export interface GraphObject {
  /** Authored field names. */
  names: ReadonlySet<string>;
  /** name → the slice above. */
  fields: ReadonlyMap<string, GraphField>;
  /** Registry-injected columns addressable on THIS object (skip 3). */
  injected: ReadonlySet<string>;
}

/** object name → its resolvable surface, or `null` (skip 2). */
export type ObjectGraph = ReadonlyMap<string, GraphObject | null>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Read one object's declared field map into the graph slice, or `null`. */
function graphObjectOf(obj: AnyRec): GraphObject | null {
  const declared = obj.fields;
  if (!declared || typeof declared !== 'object') return null;
  const names = new Set<string>();
  const fields = new Map<string, GraphField>();
  for (const f of asArray(declared)) {
    const n = strName(f.name);
    if (!n) continue;
    names.add(n);
    fields.set(n, {
      type: typeof f.type === 'string' ? f.type : undefined,
      reference: strName(f.reference),
      multiple: f.multiple === true ? true : undefined,
    });
  }
  if (names.size === 0) return null;
  return { names, fields, injected: injectedColumnsFor(obj) };
}

/**
 * Index a stack's objects once. Callers that resolve many paths build this a
 * single time and hand it to every {@link resolveFieldPath} call.
 */
export function indexObjectGraph(stack: unknown): ObjectGraph {
  const graph = new Map<string, GraphObject | null>();
  if (!stack || typeof stack !== 'object') return graph;
  for (const obj of asArray((stack as AnyRec).objects)) {
    const name = strName(obj.name);
    if (name) graph.set(name, graphObjectOf(obj));
  }
  return graph;
}

/** What a path resolved to, or precisely how it failed. */
export type FieldPathVerdict =
  /**
   * Every hop and the leaf resolved. `object` is the object the LEAF lives on.
   * `injected` marks a leaf resolved through skip 3 — a registry-injected
   * column, real at runtime, whose TYPE and relationship target are
   * registry-owned and invisible here. A caller asking a second question about
   * the leaf (is it a relationship? is it materialised?) must treat an
   * `injected` leaf as unanswerable rather than assume the absence of a
   * declared type means the absence of the property.
   */
  | { kind: 'ok'; object: string; field: string; meta?: GraphField; injected?: true }
  /**
   * The graph cannot answer — one of the three skips. Never report this: it is
   * the absence of a judgement, not a passing one.
   */
  | { kind: 'unknowable'; reason: 'object-not-in-stack' | 'no-field-map' | 'injected-hop'; object: string }
  /**
   * A hop names nothing on the object it was written against. `at` is the
   * 0-based segment index, `object` the object the hop was resolved against.
   */
  | { kind: 'hop-unknown'; at: number; segment: string; object: string; candidates: ReadonlySet<string> }
  /**
   * A hop resolves to a real field that is NOT a relationship, so there is
   * nothing to traverse through — the author wrote `amount.total` where
   * `amount` is a number.
   */
  | { kind: 'hop-not-relationship'; at: number; segment: string; object: string; type?: string }
  /**
   * A relationship hop resolves but declares no `reference`, so the target
   * object is unknown and the rest of the path cannot be judged. Treated as a
   * SKIP by callers for the same reason as `unknowable`.
   */
  | { kind: 'hop-untargeted'; at: number; segment: string; object: string }
  /** Every hop resolved; the LEAF names nothing on the object it landed on. */
  | { kind: 'field-unknown'; object: string; field: string; candidates: ReadonlySet<string> };

/**
 * Resolve `path` against `objectName` in `graph`.
 *
 * A bare `field` is the one-segment case and resolves against the root object
 * directly. A dotted `a.b.field` walks `a`, then `b`, as to-one relationship
 * hops, and resolves the leaf on whatever object the last hop landed on.
 *
 * ⛔ This function answers EXISTENCE only. Whether a hop was DECLARED joinable
 * — an ADR-0021 dataset joins only what `Dataset.include` names — is a second
 * question the caller owns, because only the caller knows which declaration
 * governs the position. Conflating them here would make the seam unusable at
 * the positions that have no `include` (a list view's field path, #14107).
 */
export function resolveFieldPath(
  graph: ObjectGraph,
  objectName: string | undefined,
  path: string,
): FieldPathVerdict | undefined {
  const root = strName(objectName);
  const raw = strName(path);
  if (!root || !raw) return undefined; // nothing to resolve

  const segments = raw.split('.');
  let current = root;

  // Every segment but the last is a relationship hop.
  for (let i = 0; i < segments.length - 1; i++) {
    if (!graph.has(current)) return { kind: 'unknowable', reason: 'object-not-in-stack', object: current };
    const obj = graph.get(current);
    if (!obj) return { kind: 'unknowable', reason: 'no-field-map', object: current };

    const segment = segments[i];
    const meta = obj.fields.get(segment);
    if (!meta) {
      // An injected system column is REAL and some of them are relationships
      // (`owner_id` is a lookup at the registry), but their type and target are
      // registry-owned and invisible here — so `owner.name` is unanswerable,
      // not a miss. Reporting it would be the false positive skip 3 exists to
      // avoid; assuming it resolves would be the fail-open on the other side.
      if (obj.injected.has(segment)) {
        return { kind: 'unknowable', reason: 'injected-hop', object: current };
      }
      return { kind: 'hop-unknown', at: i, segment, object: current, candidates: obj.names };
    }
    if (!meta.type || !RELATIONSHIP_FIELD_TYPES.has(meta.type)) {
      return { kind: 'hop-not-relationship', at: i, segment, object: current, type: meta.type };
    }
    if (!meta.reference) {
      return { kind: 'hop-untargeted', at: i, segment, object: current };
    }
    current = meta.reference;
  }

  if (!graph.has(current)) return { kind: 'unknowable', reason: 'object-not-in-stack', object: current };
  const obj = graph.get(current);
  if (!obj) return { kind: 'unknowable', reason: 'no-field-map', object: current };

  const leaf = segments[segments.length - 1];
  if (obj.names.has(leaf)) return { kind: 'ok', object: current, field: leaf, meta: obj.fields.get(leaf) };
  if (obj.injected.has(leaf)) return { kind: 'ok', object: current, field: leaf, injected: true };
  return { kind: 'field-unknown', object: current, field: leaf, candidates: obj.names };
}

/**
 * The relationship prefixes a document declared as joinable.
 *
 * ADR-0021: *"Declaring `a.b` implicitly includes the intermediate `a`."* So
 * every PREFIX of every declared path is joinable, not only the paths as
 * written — which is why this expands rather than reading `include` verbatim.
 *
 * Here rather than in a rule because the SAME `include` governs positions two
 * different rules judge: a dataset's own `dimensions[].field` / `measures[].field`
 * / filter keys (#14105), and a dashboard widget's `filter` keys (#14148), whose
 * condition is ANDed into that same dataset's compiled query as `runtimeFilter`.
 * Two copies of the prefix expansion would let the two positions drift apart on
 * a clause that is one sentence of one ADR.
 */
export function joinablePrefixes(include: unknown): ReadonlySet<string> {
  const prefixes = new Set<string>();
  if (!Array.isArray(include)) return prefixes;
  for (const entry of include) {
    if (typeof entry !== 'string' || !entry) continue;
    const segments = entry.split('.');
    for (let i = 1; i <= segments.length; i++) {
      prefixes.add(segments.slice(0, i).join('.'));
    }
  }
  return prefixes;
}

/** The two halves of a rendered verdict: the finding's message, and its detail. */
export interface FieldPathAccount {
  /** What is wrong, in prose, carrying the "did you mean" when there is one. */
  message: string;
  /** The supporting field list, for the finding's hint. */
  detail: string;
}

/**
 * Turn a resolution verdict into the message half of an existence finding, or
 * `undefined` when the verdict is one no rule may report.
 *
 * Shared by every position that resolves a field PATH — a dataset dimension, a
 * measure, a dataset filter key (#14105), a widget filter key (#14148) — so
 * they cannot drift into N different accounts of the same miss. The caller
 * supplies `subject` (how the position is named in prose) and owns the rule id,
 * the severity, the path and the hint's prescription; this function holds none
 * of them, matching the rest of this module.
 */
export function describeFieldPathVerdict(
  verdict: FieldPathVerdict,
  path: string,
  subject: string,
): FieldPathAccount | undefined {
  switch (verdict.kind) {
    case 'ok':
    case 'unknowable':
    case 'hop-untargeted':
      return undefined;
    case 'hop-unknown':
      return {
        message:
          `${subject} "${path}" traverses "${verdict.segment}", which is not a field on object ` +
          `"${verdict.object}".${suggestName(verdict.segment, verdict.candidates)}`,
        detail: `Fields on "${verdict.object}": ${listNames(verdict.candidates)}.`,
      };
    case 'hop-not-relationship':
      return {
        message:
          `${subject} "${path}" traverses "${verdict.segment}", which is a` +
          `${verdict.type ? ` \`${verdict.type}\`` : 'n ordinary'} field on object ` +
          `"${verdict.object}" and not a relationship — there is nothing to join through.`,
        detail:
          `Only ${[...RELATIONSHIP_FIELD_TYPES].sort().join(' / ')} fields are traversable ` +
          `(ADR-0021 derives every join from the object graph; you never write an ON clause).`,
      };
    case 'field-unknown':
      return {
        message:
          `${subject} "${path}" is not a field on object "${verdict.object}".` +
          `${suggestName(verdict.field, verdict.candidates)}`,
        detail: `Fields on "${verdict.object}": ${listNames(verdict.candidates)}.`,
      };
  }
}

/**
 * True when the verdict is one no rule may report — the graph could not answer.
 * Callers spell the skip through this predicate rather than re-listing the
 * kinds, so a future verdict added to the union defaults to being reported
 * loudly (a missed skip is a visible false positive; a missed report is
 * silence, which is the failure mode this whole family exists to end).
 */
export function isUnjudgeable(verdict: FieldPathVerdict | undefined): boolean {
  return !verdict || verdict.kind === 'unknowable' || verdict.kind === 'hop-untargeted';
}

/**
 * Nearest declared name for a typo'd reference, or `undefined` when nothing is
 * close enough. The budget — `max(2, floor(len/3))` — is the one
 * `validate-sortable-fields.ts` and `validate-object-references.ts` already
 * use, restated here rather than imported from either because neither exports
 * it; consolidating the three copies is recorded as a follow-up rather than
 * done under this card's scope.
 */
export function nearestName(target: string, known: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const d = distance(target, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  return best && bestScore <= Math.max(2, Math.floor(target.length / 3)) ? best : undefined;
}

/** ` Did you mean "x"?`, or the empty string — the platform's message shape. */
export function suggestName(target: string, known: Iterable<string>): string {
  const best = nearestName(target, known);
  return best ? ` Did you mean "${best}"?` : '';
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** A readable field list for a hint, or `(none)`. */
export function listNames(names: Iterable<string>): string {
  const arr = [...names].sort();
  return arr.length > 0 ? arr.join(', ') : '(none)';
}
