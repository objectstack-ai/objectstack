// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14921] The refusal a metadata source tree earns by naming one item twice.
 *
 * ## The invariant this restores
 *
 * *What is listed is what is loadable.* `FilesystemLoader` derives a metadata
 * name by stripping the extension from a flat file's basename, and resolves a
 * name back to a file under a FIXED extension precedence (`.json` → `.yaml` →
 * `.yml` → `.ts` → `.js`). Two files sharing a stem therefore produced one name
 * TWICE in `list()` while only the first-precedence file was reachable through
 * any name at all: the listed set and the addressable set stopped being the
 * same set, and `loadMany()` kept returning both bodies. The loser was
 * invisible — not missing, not reported, just never served.
 *
 * The failure is silent in the direction that matters for authoring, and the
 * trigger is a move authors (human and AI) make constantly: convert
 * `twin.json` to `twin.yaml` and leave the old file behind, or land one from
 * each of two packages. Today the JSON one is served forever with no
 * diagnostic anywhere, and `MetadataManager.admitLoaderItems()`'s documented
 * "keep the first and say nothing" absorbs the collision a second time.
 *
 * ## The ruling (maintainer, via the director seat on #14921, 2026-09-05)
 *
 * Option 1 of three: **refuse the ambiguous stem loudly at list time.** Two
 * files sharing a stem across the registered extensions is an AUTHORING ERROR,
 * reported with both paths named, never resolved by precedence. Not taken:
 * option 2 (keep the precedence and log at `warn` — with zero instances in any
 * measured tree, nobody reads that log, and the invariant stays broken) and
 * option 3 (make the extension part of the name for the non-first file — a
 * naming rule invented for an error state, grown into the contract).
 *
 * The narrowing is cheap for the reason the grade records: no measured
 * production or example tree carries two files with one stem, so no existing
 * tree goes red. It is a narrowing with almost no migration account.
 *
 * ## Why a brand and a predicate rather than bare `instanceof`
 *
 * `MetadataManager`'s plural reads catch per loader on purpose (#5108/#14423):
 * a storage outage must degrade to a short-but-served list rather than take the
 * whole enumeration down. This refusal is the opposite kind of fact — an
 * author's tree is malformed and no retry fixes it — so those seams have to
 * re-raise THIS error while still absorbing every other one. A predicate over
 * a `Symbol.for` brand is the discrimination that survives duplicate copies of
 * this module in a consumer's dependency graph, where `instanceof` does not.
 * Same shape, and for the same reason, as `@objectstack/core`'s
 * `isAuthzStoreUnavailableError`.
 */

/** ADR-0112 wire code for the refusal. */
export const AMBIGUOUS_METADATA_STEM_CODE = 'AMBIGUOUS_METADATA_STEM' as const;

/**
 * HTTP status a transport should answer.
 *
 * 500, deliberately: the REQUEST is well formed and no caller can fix it by
 * sending something else — the deployment's own metadata source tree is
 * ambiguous. Not 503 (nothing is transient here; a retry answers identically
 * until a file is deleted or renamed) and not 4xx (the caller did nothing
 * wrong).
 */
export const AMBIGUOUS_METADATA_STEM_STATUS = 500 as const;

const AMBIGUOUS_METADATA_STEM_BRAND = Symbol.for('objectstack.metadata.ambiguousStem');

/**
 * Thrown when one metadata name is derived from more than one file among a
 * loader's REGISTERED extensions.
 *
 * The message names every colliding path and the metadata type, because those
 * are exactly the two things an author needs and neither is recoverable from
 * the name alone: a bare "duplicate `twin`" sends them looking through a tree
 * for something they already believe they deleted.
 */
export class AmbiguousMetadataStemError extends Error {
  /** Brand — see the module doc on why this is not `instanceof`. */
  readonly [AMBIGUOUS_METADATA_STEM_BRAND] = true as const;
  /** ADR-0112 wire code. */
  readonly code = AMBIGUOUS_METADATA_STEM_CODE;
  /** HTTP status a transport should answer. */
  readonly status = AMBIGUOUS_METADATA_STEM_STATUS;
  /** The metadata type whose directory holds the collision (e.g. `object`). */
  readonly type: string;
  /** The one name both files derive to. */
  readonly stem: string;
  /** Every colliding file, absolute, sorted — never just the winner. */
  readonly paths: readonly string[];

  constructor(type: string, stem: string, paths: readonly string[]) {
    const sorted = [...paths].sort();
    super(
      `Ambiguous metadata name \`${stem}\` for type \`${type}\`: ${sorted.length} files ` +
        `resolve to the same name — ${sorted.map(p => `\`${p}\``).join(', ')}. ` +
        `Only the first would ever be served (extension precedence: .json, .yaml, .yml, .ts, .js), ` +
        `so the others are listed and unreachable. Delete or rename all but one.`,
    );
    this.name = 'AmbiguousMetadataStemError';
    this.type = type;
    this.stem = stem;
    this.paths = sorted;
  }
}

/**
 * True when `err` is the ambiguous-stem refusal above.
 *
 * The predicate every catch-and-degrade seam uses to re-raise THIS one without
 * loosening its handling of anything else — a storage outage still degrades, an
 * author's malformed tree does not.
 */
export function isAmbiguousMetadataStemError(err: unknown): err is AmbiguousMetadataStemError {
  return (
    typeof err === 'object'
    && err !== null
    && (err as Record<symbol, unknown>)[AMBIGUOUS_METADATA_STEM_BRAND] === true
  );
}
