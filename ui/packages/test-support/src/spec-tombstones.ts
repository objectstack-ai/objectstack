/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0087 D2 TOMBSTONE RECOGNITION — one judge for every gate that asks
 * "does the contract accept this key?" (objectui#3809).
 *
 * ## The fact every caller here needs
 *
 * Retiring an authorable key in `@objectstack/spec` does NOT delete it from the
 * Zod object. `packages/spec/src/shared/retired-key.ts` replaces the member with
 *
 *     z.never({ error: () => guidance }).optional().describe(`[REMOVED] …`)
 *
 * on purpose: a deleted key would be SILENTLY STRIPPED by a non-strict parse,
 * while a `never` member fails `tsc` at the authoring site and raises the
 * upgrade prescription itself on parse (upstream objectstack-ai/objectstack#3855 / ADR-0104). The removal
 * has to be audible, so the entry stays.
 *
 * The consequence for a consumer is the whole reason this module exists: a
 * tombstone is STILL a member of `.shape`, so `Object.keys(shape)` reports a key
 * the contract rejects BY NAME as though it were an authoring surface. Every
 * gate that derived "the keys the spec accepts" from raw `Object.keys` was
 * therefore answering a different question than the one its name claimed, and
 * the error is not symmetric — it lands as a FALSE GREEN or a FALSE RED
 * depending on which side of the subtraction the key falls:
 *
 *   - `declared − listed` (does this repo publish a key the spec refuses?) puts
 *     the tombstone on the "accepted" side: a block may publish a retired key
 *     and the gate stays GREEN;
 *   - `listed − declared` (is every spec key discoverable?) puts it on the
 *     "declared" side: the gate goes RED demanding that a block publish a key
 *     the contract refuses — and a repo that obeys then fails the first check.
 *
 * Two directions, one root cause, one fix: ask this module instead of
 * `Object.keys`.
 *
 * ## Why it lives in `@object-ui/test-support`
 *
 * Because the same judgement was being written out by hand in four places, and
 * the copies had already drifted: two carried the structural criterion only,
 * one carried none at all (which is objectui#3809's false green), and none of
 * them carried the description channel below. That is the exact condition this
 * private package exists for — see the README. Nothing shipped imports it.
 *
 * ## Two channels, deliberately OR-ed
 *
 * A tombstone is recognised when EITHER holds:
 *
 *   1. STRUCTURAL — the member, unwrapped past `.optional()`, is a `never`
 *      type. This is the criterion with teeth: it is what makes the parse
 *      reject every value, so it cannot be true of a live key;
 *   2. DESCRIPTIVE — the member's own description opens with the marker
 *      `retiredKey()` stamps on it (`RETIRED_DESCRIPTION_PREFIX`).
 *
 * Either channel alone identifies today's tombstones (measured: all eight in
 * `@objectstack/spec@17.0.0`'s `ComponentPropsMap` satisfy both — the same eight
 * the preceding `17.0.0-rc.6` carried), so the OR is not about coverage — it is
 * about which channel a future change breaks. A Zod internals rework can silence
 * (1) without touching the contract; a tombstone hand-written without
 * `retiredKey()` silences (2). Recognition that
 * needs both would go quietly permissive on either event, and "quietly
 * permissive" is the failure this module was written to end. Callers that want
 * to know the channels AGREE — a drift pin worth having — ask
 * `tombstoneEvidence` and compare them; the recognition itself never requires
 * agreement.
 *
 * ## The premise these callers stand on, and how it dies
 *
 * All of the above is true only while retirement KEEPS the member. If upstream
 * ever switches to deleting keys outright, every tombstone filter here narrows
 * nothing — and would keep passing, silently, as dead code. So a gate that
 * consumes this module owes one assertion that the premise still holds: some
 * key is still LISTED and NOT authorable. `listedShapeKeys` exists for that
 * assertion as much as for the subtraction itself.
 */

/** The prefix `retiredKey()` puts at the front of a tombstone's description. */
export const RETIRED_DESCRIPTION_PREFIX = '[REMOVED]';

/** The two `.shape` spellings, plus the `lazySchema()` thunk. */
interface ShapeCarrier {
  shape?: unknown;
  def?: { shape?: unknown };
  _def?: { shape?: unknown };
}

/** A Zod node, as far as the questions below need to see it. */
interface MemberNode {
  unwrap?: () => unknown;
  description?: unknown;
  def?: { type?: unknown; description?: unknown };
  _def?: { type?: unknown; description?: unknown };
}

/**
 * Resolve a props schema's `.shape`, or `null` when it does not resolve.
 *
 * Three spellings, because `ComponentPropsMap` carries all three: a plain
 * `z.object` exposes `.shape`; a `lazySchema()`-wrapped entry (every
 * `element:*`) exposes it as a THUNK that must be called; and Zod's internals
 * are reachable as either `def` or `_def` depending on the version. Reaching
 * into internals is confined to this module so that a gate never has to.
 *
 * `null` rather than `{}` on failure: "this schema has no keys" and "this reader
 * broke" are different facts, and a caller that cannot tell them apart turns a
 * broken probe into a green run over nothing.
 */
export function resolvePropsShape(schema: unknown): Record<string, unknown> | null {
  const carrier = schema as ShapeCarrier | undefined;
  const shape = carrier?.shape ?? carrier?.def?.shape ?? carrier?._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => unknown)() : shape;
  return resolved && typeof resolved === 'object' ? (resolved as Record<string, unknown>) : null;
}

/**
 * Every key the schema still LISTS — tombstones INCLUDED.
 *
 * This is raw `Object.keys(shape)` and it is exported under a name that says so,
 * because the answer is genuinely wanted in two places: pinning that the
 * tombstone premise still holds, and asking "did this pin of the spec ever hear
 * of this key" (a question about the RELEASE, not about the authoring surface —
 * a retired key must answer YES there, or an exemption for it reads as dormant
 * and escapes every staleness check).
 *
 * `[]` for a schema that does not resolve, which every caller in-tree relies on
 * for keys their pin does not carry at all; pair it with a non-vacuity
 * assertion, never with a bare "it came back empty, fine".
 */
export function listedShapeKeys(schema: unknown): string[] {
  const shape = resolvePropsShape(schema);
  return shape ? Object.keys(shape) : [];
}

/** One member of the shape, unwrapped past `.optional()` when it is wrapped. */
function unwrapMember(member: unknown): MemberNode | undefined {
  const node = member as MemberNode | undefined;
  return (typeof node?.unwrap === 'function' ? (node.unwrap() as MemberNode) : node) ?? undefined;
}

/**
 * The Zod type name of one member, unwrapped past `.optional()`.
 *
 * `undefined` means the probe could not read it — which is a broken reader, not
 * a live key. Callers pin it against a key they know is live (see
 * `tombstoneEvidence`'s note on non-vacuity).
 */
export function shapeMemberTypeName(schema: unknown, key: string): string | undefined {
  const shape = resolvePropsShape(schema);
  if (!shape) return undefined;
  const inner = unwrapMember(shape[key]);
  const type = inner?._def?.type ?? inner?.def?.type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * Both channels' verdicts on ONE already-resolved member.
 *
 * Takes the member rather than `(schema, key)` so the bulk functions below can
 * resolve the shape once and walk it, instead of re-resolving per key inside a
 * predicate — which for a `lazySchema()` entry means re-running the thunk for
 * every key it declares. That is the AGENTS.md §测试纪律 note about whole-set
 * computations inside `.filter()` (`all-locales-key-parity`, 7.51s to 25ms),
 * applied before it can bite.
 *
 * The description is read from the member AS GIVEN, not from the unwrapped inner
 * type: `retiredKey()` applies `.describe()` last, after `.optional()`, so the
 * marker sits on the outer optional wrapper. Unwrapping first would find nothing
 * and silently disarm the descriptive channel.
 */
function memberEvidence(member: unknown): { typedNever: boolean; describedRemoved: boolean } {
  const node = member as MemberNode | undefined;
  const inner = unwrapMember(member);
  const type = inner?._def?.type ?? inner?.def?.type;
  const description = node?.description ?? node?.def?.description ?? node?._def?.description;
  return {
    typedNever: type === 'never',
    describedRemoved:
      typeof description === 'string' && description.startsWith(RETIRED_DESCRIPTION_PREFIX),
  };
}

/**
 * The verdict, in ONE place — the OR every export below routes through.
 *
 * Deliberately not re-spelled at each call site, and the reason is a mutation
 * test rather than tidiness: while the single-key predicate and the bulk
 * partition each carried their own `typedNever || describedRemoved`, disabling
 * recognition in one left the other still narrowing — so a mutation could
 * silence half the judge while the consuming gates' premise pins stayed green.
 * One choke point means any change to what counts as a tombstone moves every
 * consumer at once, which is what those pins exist to detect.
 */
const isTombstone = (evidence: { typedNever: boolean; describedRemoved: boolean }): boolean =>
  evidence.typedNever || evidence.describedRemoved;

/**
 * What each recognition channel says about one key — the evidence, unreduced.
 *
 * Exposed separately from the verdict so a gate can pin the two channels
 * AGREEING on today's tombstones. That pin is what turns a single-channel drift
 * (a Zod rework, a hand-rolled retirement) into a red line naming the channel
 * that moved, instead of a silent narrowing of what the gate can see.
 *
 * `listed` is part of the evidence because a key absent from the shape is
 * neither authorable nor tombstoned — it simply is not in this release, and a
 * caller that cannot tell those apart mis-reports a pin difference as a
 * retirement.
 */
export function tombstoneEvidence(
  schema: unknown,
  key: string,
): { listed: boolean; typedNever: boolean; describedRemoved: boolean } {
  const shape = resolvePropsShape(schema);
  if (!shape || !Object.prototype.hasOwnProperty.call(shape, key)) {
    return { listed: false, typedNever: false, describedRemoved: false };
  }
  return { listed: true, ...memberEvidence(shape[key]) };
}

/**
 * Is this key an ADR-0087 D2 tombstone — still listed, but rejected by name?
 *
 * A key the shape does not list at all is NOT a tombstone: it is absent, and
 * `listedShapeKeys` is the question to ask about that.
 */
export function isShapeKeyTombstoned(schema: unknown, key: string): boolean {
  return isTombstone(tombstoneEvidence(schema, key));
}

/** One pass over the shape, splitting its keys by the tombstone verdict. */
function partitionShapeKeys(schema: unknown): { authorable: string[]; tombstoned: string[] } {
  const shape = resolvePropsShape(schema);
  const authorable: string[] = [];
  const tombstoned: string[] = [];
  for (const [key, member] of Object.entries(shape ?? {})) {
    (isTombstone(memberEvidence(member)) ? tombstoned : authorable).push(key);
  }
  return { authorable, tombstoned };
}

/** The listed keys that are tombstones — what the narrowing below removes. */
export function tombstonedShapeKeys(schema: unknown): string[] {
  return partitionShapeKeys(schema).tombstoned;
}

/**
 * The keys that are a real authoring surface: listed, minus the tombstones.
 *
 * This is the set a parity gate means when it says "the keys the spec accepts",
 * in BOTH subtraction directions — publish-side and discoverability-side alike.
 */
export function authorableShapeKeys(schema: unknown): string[] {
  return partitionShapeKeys(schema).authorable;
}
