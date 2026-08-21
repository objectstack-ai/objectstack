// Types for the two freshness predicates `check-regen-pending.mjs` exports to
// other gates (#5475).
//
// The module itself stays `.mjs`: `pre-commit` and `check:merge-driver` invoke
// it with bare `node`, and every root script here is authored that way. What
// changed is that three files under `packages/spec/scripts/` import from it —
// `build-docs.ts`, `check-generated.ts` and `schema-tree-freshness.test.ts` —
// and since #5475 those are inside a tsc program (`tsconfig.scripts.json`),
// where an untyped `.mjs` import is TS7016: the predicate silently becomes
// `any`, and `if (distIsStale)` — the missing call, the exact mistake this
// guard exists to prevent — would type-check clean.
//
// Declared rather than inferred (no `allowJs`) because the module sits at the
// repo root, outside the consuming program's `rootDir`. The surface is three
// functions with one optional argument; keep this file in step with them by
// hand, and keep it small enough that doing so stays trivial.

/**
 * Is `packages/spec/dist` older than the sources it claims to describe?
 * Missing counts as stale.
 *
 * @param specDir Absolute path to the spec package; defaults to this repo's.
 */
export function distIsStale(specDir?: string): boolean;

/**
 * Is `packages/spec/json-schema` older than the sources it was generated from?
 * Missing counts as stale.
 *
 * @param specDir Absolute path to the spec package; defaults to this repo's.
 */
export function schemaTreeIsStale(specDir?: string): boolean;

/**
 * Are `packages/spec`'s emitted JS bundles (`dist/**\/*.mjs`, `*.js`) older than
 * the sources — or than `tsup.config.ts` — they were bundled from? Missing
 * counts as stale.
 *
 * A DIFFERENT axis from `distIsStale`, which measures the `.d.ts` half: the
 * package's second build pass refreshes declarations without re-emitting any
 * bundle, so `.d.ts` freshness does not imply bundle freshness. Read the
 * function's own docblock before reusing it.
 *
 * @param specDir Absolute path to the spec package; defaults to this repo's.
 */
export function bundlesAreStale(specDir?: string): boolean;
