// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-BRANCH JSON-Schema projection — option (a) of #16431.
 *
 * ## The gap this closes
 *
 * `build-schemas.ts` projects each exported `z.ZodType` with
 * `z.toJSONSchema()`, and Zod refuses a whole schema the moment ONE node in it
 * has no JSON form. The refusal is per SCHEMA, so a union of four comparand
 * shapes — three of them plain JSON — publishes nothing because the fourth is a
 * `z.date()`. That is how `$gt` / `$gte` / `$lt` / `$lte` / `$between` reached
 * no reference row at all: `orderingComparandSchema` is
 * `z.union([z.number(), z.date(), z.string(), FieldReferenceSchema])`.
 *
 * ## What is actually true about a `z.date()` branch, and why dropping it is
 * not a narrowing
 *
 * These artifacts describe **JSON documents** — what an author writes in
 * `.yml` / `.json` metadata and what travels on the wire. A JSON document
 * cannot carry a `Date` INSTANCE; the ordering docblock in
 * `src/data/filter.zod.ts` states the same thing from the runtime side ("the
 * DRIVER only ever sees ISO date / timestamp strings"). So the set of JSON
 * documents the `z.date()` branch admits is EMPTY, and an empty branch of an
 * `anyOf` contributes nothing to the union's accept set. Removing it changes
 * which JSON documents validate by exactly nothing, while the difference
 * between publishing and not publishing is the whole reference section.
 *
 * The same argument holds for every other unprojectable node in a direct union
 * position — a `z.function()` member of a `functions:` entry union is a live
 * callable, and no JSON document is one.
 *
 * ⛔ It does NOT hold for an unprojectable node anywhere else. An object
 * property typed `z.function()` is REQUIRED of every document the object
 * accepts, so dropping it would publish a shape no runtime value has. This
 * module therefore prunes **only direct members of `anyOf` / `oneOf`** and
 * refuses the projection entirely when a marked node survives anywhere else —
 * in which case the caller skips the export exactly as it does today, with
 * today's message.
 *
 * ## Why the mechanism is `unrepresentable: 'any'` + `override`, and not the
 * `io: 'input'` retry the card guessed at
 *
 * #16431 hypothesised that the existing `io: 'input'` fallback would project a
 * date branch if it were applied per branch rather than per schema, because an
 * author writes an ISO string. Measured against zod 4.4.3, that is false and
 * the reason is structural: `dateProcessor`
 * (`zod/v4/core/json-schema-processors`) reads only `ctx.unrepresentable` and
 * never `ctx.io`, so `z.toJSONSchema(z.date(), { io: 'input' })` throws exactly
 * as the output direction does — at any granularity, branch or schema. The
 * only switch Zod offers is `unrepresentable: 'any'`, which turns EVERY
 * unrepresentable node into `{}`.
 *
 * ⛔ A bare `{}` is the dangerous answer, not the safe one: inside an `anyOf`
 * it accepts every JSON value, so a build that simply set `unrepresentable:
 * 'any'` would publish universally-permissive schemas for the 23 exports that
 * are skipped today and report nothing. This module uses that mode only as a
 * VEHICLE: every node that came back with no structural keyword is marked,
 * marked members of a union are dropped, and a mark surviving anywhere else
 * fails the projection. Nothing is ever emitted with a `{}` standing in for a
 * type Zod refused.
 */
import { z } from 'zod';

/**
 * Temporary marker key written onto a node Zod could not project. It never
 * reaches an emitted file: a marked node is either dropped with its union
 * branch, or its survival fails the whole projection.
 */
export const UNPROJECTABLE_MARK = 'x-os-unprojectable';

/**
 * Keys that annotate a schema without constraining any value. A node carrying
 * only these constrains nothing — which for anything but `z.any()` /
 * `z.unknown()` means the processor produced no projection for it.
 *
 * `.describe()` lands on the node BEFORE `override` runs, so a
 * `z.date().describe('…')` comes back as `{ description: '…' }` — non-empty,
 * and it would escape a plain `Object.keys().length === 0` test.
 */
const ANNOTATION_ONLY_KEYS: ReadonlySet<string> = new Set([
  '$comment',
  '$id',
  '$schema',
  'default',
  'deprecated',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

/** The union keywords whose members are alternatives, and so are droppable. */
const UNION_KEYWORDS = ['anyOf', 'oneOf'] as const;

/** One union branch this projection dropped, and what it was. */
export interface PrunedBranch {
  /** JSON Pointer to the branch in the UNPRUNED projection. */
  readonly at: string;
  /** The Zod type that has no JSON form, e.g. `date`, `function`. */
  readonly type: string;
}

/** A successful per-branch projection. */
export interface BranchProjection {
  /** The emitted JSON Schema, with every marked branch removed. */
  readonly schema: Record<string, unknown>;
  /** Which `io` direction produced it — `output` is preferred, as elsewhere. */
  readonly io: 'output' | 'input';
  /** Every dropped branch, in document order. Never empty. */
  readonly pruned: readonly PrunedBranch[];
}

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when a node carries at least one keyword that constrains a value. */
function hasStructuralKeyword(json: JsonObject): boolean {
  return Object.keys(json).some(
    (key) => !ANNOTATION_ONLY_KEYS.has(key) && !key.startsWith('x-'),
  );
}

/**
 * Ask Zod itself whether one node has a projection, in the SAME direction the
 * enclosing run uses.
 *
 * Asked only of a node that came back with no structural keyword, which is
 * either a type with no JSON form or one that genuinely accepts any JSON value
 * — and `z.toJSONSchema(node, { unrepresentable: 'throw' })` is the only
 * authority on which. ⛔ A hard-coded list of unrepresentable type names is
 * NOT that authority: it is written against one Zod version, and the direction
 * it fails in is the dangerous one — a type it fails to name is emitted as `{}`
 * and accepts every JSON value.
 *
 * Anything but a clean conversion counts as "no projection", including a
 * message this repo has never seen: a node this function cannot vouch for must
 * not become a `{}` in a published artifact.
 */
function projectsUnderStrictMode(node: z.ZodType, io: 'output' | 'input'): boolean {
  try {
    z.toJSONSchema(node, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
      ...(io === 'input' ? { io } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the `override` callback that marks every node Zod produced no
 * projection for.
 *
 * Two signals, in this order, because each alone is wrong:
 *
 *   - **Emitted keywords**, not a type-name list, so a Zod release that adds an
 *     unrepresentable type is marked without this file being edited.
 *   - **A strict re-conversion of the node**, because "emitted no keyword" also
 *     describes `z.any()` and `z.unknown()`, which accept any JSON value
 *     legitimately — and describes them through wrappers too. `FieldOperators`'
 *     `$eq` is `z.any().optional().describe(…)`: it comes back as
 *     `{ description }`, exactly like an unprojectable `z.date().describe(…)`,
 *     and marking it would have refused the whole projection for the enforced
 *     half of the filter contract.
 */
export function markUnprojectableNodes(io: 'output' | 'input') {
  return (ctx: { zodSchema: unknown; jsonSchema: JsonObject }): void => {
    if (hasStructuralKeyword(ctx.jsonSchema)) return;
    const node = ctx.zodSchema as z.ZodType & { _zod: { def: { type: string } } };
    if (projectsUnderStrictMode(node, io)) return;
    ctx.jsonSchema[UNPROJECTABLE_MARK] = node._zod.def.type;
  };
}

/** JSON Pointer escaping (RFC 6901). */
const escapeToken = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Drop every marked member of every `anyOf` / `oneOf`, depth-first so a nested
 * union that loses ALL its branches is itself marked before its parent decides.
 *
 * Mutates `node`. Records what it dropped, with the pointer the branch had
 * BEFORE any sibling was removed, so the record names a location that existed.
 */
export function pruneMarkedUnionBranches(
  node: unknown,
  at: string,
  pruned: PrunedBranch[],
): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => pruneMarkedUnionBranches(item, `${at}/${index}`, pruned));
    return;
  }
  if (!isObject(node)) return;

  for (const [key, value] of Object.entries(node)) {
    pruneMarkedUnionBranches(value, `${at}/${escapeToken(key)}`, pruned);
  }

  for (const keyword of UNION_KEYWORDS) {
    const branches = node[keyword];
    if (!Array.isArray(branches)) continue;

    const kept: unknown[] = [];
    branches.forEach((branch, index) => {
      const mark = isObject(branch) ? branch[UNPROJECTABLE_MARK] : undefined;
      if (typeof mark === 'string') {
        pruned.push({ at: `${at}/${keyword}/${index}`, type: mark });
        return;
      }
      kept.push(branch);
    });

    if (kept.length === branches.length) continue;
    if (kept.length === 0) {
      // Every alternative was unprojectable, so the union itself admits no JSON
      // document. Mark it and let the parent drop it — or, if there is no union
      // above it, fail the projection.
      delete node[keyword];
      node[UNPROJECTABLE_MARK] = 'union';
      continue;
    }
    node[keyword] = kept;
  }
}

/** The pointer of the first surviving mark, or `null` when there is none. */
export function findSurvivingMark(node: unknown, at = '#'): string | null {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const found = findSurvivingMark(item, `${at}/${index}`);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  if (typeof node[UNPROJECTABLE_MARK] === 'string') return at;
  for (const [key, value] of Object.entries(node)) {
    const found = findSurvivingMark(value, `${at}/${escapeToken(key)}`);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Project `value` by dropping union branches Zod cannot represent.
 *
 * Returns `null` when that does not produce a faithful projection — a marked
 * node survived outside a union, or nothing needed dropping — and the caller
 * then skips the export exactly as before, with the message Zod threw. That
 * `null` is what keeps this change unable to alter the skip message, and so the
 * recorded `cause` of any entry still in `unemitted-schemas.baseline.json`.
 *
 * BOTH directions are projected and the one that drops FEWER branches wins,
 * `output` breaking a tie. ⛔ Not "output first, input only on failure", which
 * is right for the strict passes and wrong here: a `.transform()` branch has no
 * OUTPUT form but a perfectly good input one, so an output-first rule would
 * quietly DELETE an authorable shape and publish the narrower schema — the
 * measured case is `Data.HookSchema`, where output drops the deprecated
 * `z.custom` handler AND a `pipe`, while input drops only the `z.custom`.
 * Fewest drops is the most faithful projection available, and the `x-io` flag
 * already tells a reader which shape they are looking at (#2967 / #2978).
 */
export function projectByPruningUnionBranches(
  value: z.ZodType,
  options: { readonly target: 'draft-2020-12' },
): BranchProjection | null {
  const candidates: BranchProjection[] = [];

  for (const io of ['output', 'input'] as const) {
    let schema: JsonObject;
    try {
      schema = z.toJSONSchema(value, {
        target: options.target,
        unrepresentable: 'any',
        override: markUnprojectableNodes(io),
        ...(io === 'input' ? { io } : {}),
      }) as JsonObject;
    } catch {
      // `unrepresentable: 'any'` removes the unrepresentable-type throws, so
      // anything left (a `cycles: 'throw'` refusal, a generator bug) is not a
      // projection question — try the other direction, then give up.
      continue;
    }

    const pruned: PrunedBranch[] = [];
    pruneMarkedUnionBranches(schema, '#', pruned);
    // A mark that survived is a node with no JSON form OUTSIDE a union — an
    // object property, a record value, an array item — where dropping it would
    // publish a shape no runtime value has. Refuse the direction.
    if (findSurvivingMark(schema) !== null) continue;
    // Nothing to drop, yet a strict pass refused this schema: whatever that is,
    // it is not the case this module exists for. Leave the export as it was.
    if (pruned.length === 0) continue;
    candidates.push({ schema, io, pruned });
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) =>
    candidate.pruned.length < best.pruned.length ? candidate : best,
  );
}
