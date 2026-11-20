// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D4, Q2 as ruled] The explainer's record pass over a FIXED-READ
 * LEAF (`@objectstack/spec/data`'s `isFixedReadLeaf`: `SharedRecordIds`) in the
 * sharing service's read filter: **the leaf is resolved at the record.**
 *
 * The record pass matches the read filter against the judged record in
 * process and publishes it as the sharing layer's `rowFilter`. A leaf is a
 * set the database holds ("the records of X shared with this user"), so the
 * pass asks it ONE question per explanation: which of the record ids it
 * judges does the leaf's fixed inner read hold? That is one indexed read
 * under the leaf's own fixed predicate (`fixedInnerReadOf`), keyed by those
 * ids, the read `checkEdit` makes for one (`{@link FixedReadLeafRecordResolver}`,
 * wired by the plugin). ⛔ No predicate restated by hand.
 *
 * Each leaf is then replaced, in a copy of the filter, by what it holds of the
 * judged record: `[recordId]` when a grant admits it, and nothing otherwise.
 * "Nothing" leaves the share arm out of the `$or` it sits in, and an `$or`
 * left with one arm is that arm, so the published filter has the two shapes
 * today's filter has for a caller with one grant on the record and with none
 * (ADR-0155 Q2 costs). Anywhere an arm cannot be left out (under `$and` or
 * `$not`) the empty list stays, which matches no record, as the leaf would.
 * ⛔ The published `rowFilter` never carries the leaf: its brand is a symbol
 * no JSON keeps, so it would cross the wire as an ordinary-looking object.
 *
 * What it does not resolve is refused, in ADR-0139 D3's envelope
 * (`INTERNAL_ERROR` / 500, logged at `error` once per evaluator), ⛔ never read
 * as an ordinary comparand: a leaf anywhere but the `$in` comparand of `id` on
 * the explained object, a leaf in its write form (a read filter carries the
 * read form, ③ ruled A), and any leaf where the host wired no resolver.
 */

import { describeFixedReadLeaf, refuseFixedReadLeafOnce, type ReadableIdsRefusalLog } from '@objectstack/core';
import { isComposedReadableIds, isFixedReadLeaf, type FixedReadLeaf } from '@objectstack/spec/data';

/** The evaluator the explainer's refusals name. */
export const EXPLAIN_FIXED_READ_LEAF_EVALUATOR = 'plugin-security explain';

/**
 * Of `recordIds`, the ids `leaf`'s fixed inner read holds: one read under the
 * leaf's own description, keyed by the ids. A rejection is the read failing.
 */
export type FixedReadLeafRecordResolver = (leaf: FixedReadLeaf, recordIds: readonly string[]) => Promise<ReadonlySet<string>>;

/** Where the explainer's refusal is logged, once per log. */
const LOGGED = new WeakMap<object, { logged: boolean }>();

function flagOf(log: ReadableIdsRefusalLog | undefined): { logged: boolean } {
  if (log === undefined) return { logged: true };
  let flag = LOGGED.get(log);
  if (flag === undefined) LOGGED.set(log, (flag = { logged: false }));
  return flag;
}

/** A plain object or a list: what a filter is built from. */
function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Does `filter` carry a fixed-read leaf anywhere (a composed `ReadableIds` scope included)? */
export function carriesFixedReadLeaf(filter: unknown): boolean {
  const onPath = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (isFixedReadLeaf(value)) return true;
    if (isComposedReadableIds(value)) return visit(value.scope);
    if (!isPlainContainer(value) || onPath.has(value)) return false;
    onPath.add(value);
    try {
      return (Array.isArray(value) ? value : Object.values(value)).some(visit);
    } finally {
      onPath.delete(value);
    }
  };
  return visit(filter);
}

/** The explainer's refusal of `leaf` at `at`, thrown by the caller. */
function refusal(at: string, leaf: unknown, object: string, why: string, log: ReadableIdsRefusalLog | undefined): Error {
  return refuseFixedReadLeafOnce(
    EXPLAIN_FIXED_READ_LEAF_EVALUATOR,
    `the sharing read filter of '${object}': ${describeFixedReadLeaf(at, leaf)}${why} The explanation was NOT ` +
      'produced, rather than match the leaf as an ordinary comparand or publish it.',
    log,
    flagOf(log),
    object,
  );
}

/**
 * Every leaf `filter` carries where the record pass resolves one, `{ id: { $in: leaf } }`
 * on `object`, in its read form; any other leaf is refused.
 */
function resolvableLeavesOf(filter: unknown, object: string, log: ReadableIdsRefusalLog | undefined): Set<FixedReadLeaf> {
  const leaves = new Set<FixedReadLeaf>();
  const onPath = new Set<object>();
  const visit = (value: unknown, at: string, inIdMembership: boolean): void => {
    if (isFixedReadLeaf(value)) {
      if (!inIdMembership || value.object !== object) {
        throw refusal(
          at, value, object,
          ', where the record pass resolves none: a fixed-read leaf sits only as the $in comparand of id on the ' +
            'object it names (ADR-0155 D1). Place it as { id: { $in: leaf } }.',
          log,
        );
      }
      if (value.accessLevels !== undefined) {
        throw refusal(
          at, value, object,
          ' in its WRITE form, which only a predicate update carries (ADR-0155 ③ ruled A). A read filter carries ' +
            'SharedRecordIds.read(object, recipient).',
          log,
        );
      }
      leaves.add(value);
      return;
    }
    if (isComposedReadableIds(value)) {
      visit(value.scope, `${at}.scope`, false);
      return;
    }
    if (!isPlainContainer(value) || onPath.has(value)) return;
    onPath.add(value);
    try {
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${at}[${i}]`, false));
        return;
      }
      for (const key of Object.keys(value)) {
        const item = value[key];
        // `{ id: { $in: leaf } }`: the one position a leaf resolves in.
        if (key === 'id' && isPlainContainer(item) && !Array.isArray(item)) {
          onPath.add(item);
          try {
            for (const op of Object.keys(item)) visit(item[op], `${at}.id.${op}`, op === '$in');
          } finally {
            onPath.delete(item);
          }
          continue;
        }
        visit(item, `${at}.${key}`, false);
      }
    } finally {
      onPath.delete(value);
    }
  };
  visit(filter, 'rowFilter', false);
  return leaves;
}

/** `{ <field>: { $in: [] } }` with nothing else: the arm a leaf that holds nothing leaves behind. */
function isEmptiedArm(arm: unknown): boolean {
  if (!isPlainContainer(arm) || Array.isArray(arm)) return false;
  const keys = Object.keys(arm);
  if (keys.length !== 1 || keys[0]!.startsWith('$')) return false;
  const spec = arm[keys[0]!];
  if (!isPlainContainer(spec) || Array.isArray(spec)) return false;
  const ops = Object.keys(spec);
  return ops.length === 1 && ops[0] === '$in' && Array.isArray(spec.$in) && spec.$in.length === 0;
}

/**
 * A copy of `value` with each resolved leaf replaced by its members, and each
 * emptied `$or` arm left out. Copy-on-write: a subtree that carries no leaf
 * (another branded leaf among them) is kept by reference.
 */
function substitute(value: unknown, held: ReadonlyMap<FixedReadLeaf, readonly string[]>): unknown {
  if (isFixedReadLeaf(value)) return [...(held.get(value) ?? [])];
  if (!isPlainContainer(value) || !carriesFixedReadLeaf(value)) return value;
  if (Array.isArray(value)) return value.map((item) => substitute(item, held));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = substitute(value[key], held);
  if (Array.isArray(out.$or)) {
    const arms = out.$or.filter((arm, i) => !(isEmptiedArm(arm) && carriesFixedReadLeaf((value.$or as unknown[])[i])));
    // Every arm emptied is the empty set, which `$in: []` keeps saying.
    if (arms.length > 0) out.$or = arms;
    if (arms.length === 1 && Object.keys(out).length === 1) return arms[0];
  }
  return out;
}

/**
 * [ADR-0155 D4, Q2 as ruled] `filter` with every fixed-read leaf resolved at
 * `recordId` (see the module note), or `filter` itself, by reference, when it
 * carries none.
 *
 * Two failures, kept apart on purpose: the refusal for a leaf it does not
 * resolve is THROWN, synchronously, before any read, so it propagates as the
 * fault it is; the resolver's rejection REJECTS the returned promise, which
 * the record pass reads as the read filter failing, as it reads the sharing
 * service's own rejection.
 */
export function resolveFixedReadLeavesAtRecord(
  filter: unknown,
  object: string,
  recordId: string,
  resolve: FixedReadLeafRecordResolver | undefined,
  log: ReadableIdsRefusalLog | undefined,
): Promise<unknown> {
  if (!carriesFixedReadLeaf(filter)) return Promise.resolve(filter);
  const leaves = resolvableLeavesOf(filter, object, log);
  if (resolve === undefined) {
    const [first] = leaves;
    throw refusal(
      'rowFilter', first, object,
      ' with no reader of its fixed inner read wired for the record pass (resolveFixedReadLeaf).',
      log,
    );
  }
  return (async () => {
    const held = new Map<FixedReadLeaf, readonly string[]>();
    for (const leaf of leaves) {
      const ids = await resolve(leaf, [recordId]);
      held.set(leaf, ids.has(recordId) ? [recordId] : []);
    }
    return substitute(filter, held);
  })();
}

/**
 * [#29112] A resolver for a batch of `recordIds`: the first question about a
 * leaf reads it once, keyed by every id of the batch, and every later question
 * about that leaf is answered from that read. The batch shares one read filter
 * per (object, context), so its leaves are the same objects for every record.
 */
export function batchedFixedReadLeafResolver(recordIds: readonly string[]): (
  resolve: FixedReadLeafRecordResolver,
) => FixedReadLeafRecordResolver {
  const reads = new Map<FixedReadLeaf, Promise<ReadonlySet<string>>>();
  const batch = [...new Set(recordIds)];
  return (resolve) => (leaf, ids) => {
    let read = reads.get(leaf);
    if (read === undefined) reads.set(leaf, (read = resolve(leaf, [...new Set([...batch, ...ids])])));
    return read;
  };
}
