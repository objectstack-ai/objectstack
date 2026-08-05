// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The registry for alias tables that reach {@link strictUnknownKeyError}
 * **directly** — the pre-`strictObject` wiring (#5483).
 *
 * ## Why a second registry
 *
 * `strictObject` records `{ options, shape }` at construction, so
 * `alias-integrity.test.ts` can judge a table against the **shape** it makes
 * claims about. The 44 call sites that predate the helper have no shape to
 * offer: they hand `strictUnknownKeyError` a hand-transcribed `knownKeys`
 * array. That is a weaker instrument — the array can drift from the schema it
 * describes and nothing here can see it — and mixing the two into one registry
 * would quietly relabel that weakness as shape-backed coverage.
 *
 * So they are kept apart, and the difference is the point:
 *
 * | claim | `strictObject` registry | this registry |
 * |:--|:--|:--|
 * | alias key is not a declared key | judged vs `.shape` | judged vs `knownKeys` |
 * | alias target is a declared key | judged vs `.shape` (+ tombstone check) | judged vs `knownKeys` |
 * | no two alias keys share a probe | judged | judged — **identically** |
 *
 * The third claim (#5481) is the one that loses nothing: `aliasProbe`
 * collisions are a property of the table *alone*, so judging them here is the
 * same measurement the covered surfaces get, not an approximation of it. That
 * is what made the transitional guard worth shipping ahead of the migration —
 * before it, those 44 tables were **unmeasured** on collisions, not clean.
 *
 * Retiring this registry is the migration in #5593: every call site that moves
 * to `strictObject` leaves here and arrives there, shape-backed, and the last
 * one takes this file with it.
 *
 * ## Not part of the package contract
 *
 * Deliberately **not** re-exported from `shared/index.ts`, like
 * `strict-object.ts` and `alias-probe.ts`: it is an internal seam the gate
 * reaches by relative path. Adding it to the barrel would publish a mutable
 * process-global as API.
 */

import type { StrictUnknownKeyErrorOptions } from './suggestions.zod';

/** One alias table recorded as its owning error map was built. */
export interface DirectAliasTableDeclaration {
  /** The authoring metadata the error map was built from. */
  readonly options: StrictUnknownKeyErrorOptions;
}

/**
 * Upper bound on recorded tables.
 *
 * `strictObject` is internal, so its registry can only ever grow with the
 * schemas this repo declares. `strictUnknownKeyError` is **published** (it is
 * in `api-surface.json` under `./shared`), and a consumer is free to build one
 * error map per tenant, per request, in a loop — a registry that recorded every
 * one of those would be an unbounded retainer in someone else's process for the
 * sole benefit of a test in ours.
 *
 * The cap makes the failure mode a *measurement* problem rather than a memory
 * one, and `overflowed()` makes even that loud: the gate asserts it is zero, so
 * if this repo ever declares more tables than fit, the check fails instead of
 * silently judging a prefix. In-repo occupancy is ~52 of 512.
 */
const CAPACITY = 512;

const DECLARATIONS: DirectAliasTableDeclaration[] = [];
let overflow = 0;
let suppression = 0;

/**
 * Record a table built by a direct {@link strictUnknownKeyError} call.
 *
 * Called from the factory itself rather than from the 44 call sites, which is
 * the whole reason the transitional guard costs no call-site edits.
 */
export function registerDirectAliasTable(options: StrictUnknownKeyErrorOptions): void {
  if (suppression > 0) return;
  if (DECLARATIONS.length >= CAPACITY) {
    overflow++;
    return;
  }
  DECLARATIONS.push({ options });
}

/**
 * Run `build` with registration turned off — for `strictObject`, whose tables
 * are already recorded **with their shape** in the richer registry.
 *
 * Without this, a `strictObject` surface would land in both registries the
 * moment its deferred error map got built (which the gate's forcing pass does
 * deliberately, and any parse failure does incidentally), and this registry's
 * population would depend on whether some earlier test had rejected a key.
 * A count that moves with unrelated test ordering is not a measurement.
 *
 * Depth-counted rather than a boolean because the suppressed callback is free
 * to build another map; synchronous throughout, so there is no interleaving to
 * lose track of.
 */
export function withoutDirectAliasTableRegistration<T>(build: () => T): T {
  suppression++;
  try {
    return build();
  } finally {
    suppression--;
  }
}

/** Every direct table built **so far in this process** (#5483). */
export function directAliasTables(): readonly DirectAliasTableDeclaration[] {
  return DECLARATIONS;
}

/** How many tables were dropped for want of {@link CAPACITY}. Asserted zero. */
export function directAliasTableOverflow(): number {
  return overflow;
}
