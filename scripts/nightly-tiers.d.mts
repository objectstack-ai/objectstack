// Types for the `nightly-tiers.mjs` exports a TypeScript consumer reads -- the
// same problem, and the same fix, as `js-comment-mask.d.mts` next door (#5475).
//
// The module itself stays `.mjs`: it carries a `--self-test` / `--packages` /
// `--check` / `--failing-files` CLI run with bare `node` from the nightly
// workflow, and every root script here is authored that way. What needs the
// declaration is the other direction -- `packages/cli/vitest-tiers.ts` imports
// the switch from inside a tsc program (`tsconfig.test.json`), where an untyped
// `.mjs` import is TS7016 and `readTierMode` silently becomes `any`.
//
// PARTIAL BY DESIGN, the `check-regen-pending.d.mts` shape: the module exports
// more names than this declares, and importing an undeclared one is `TS2305`
// -- loud, red and immediate -- never a silent `any`. Keep this file in step
// with the module by hand; `check:declaration-mirrors` holds the names, kinds
// and required arities.

/** The two tiers the switch moves off the per-PR and merge-queue runs. */
export const NIGHTLY_TIERS: readonly string[];

/** The two legal spellings of `OS_TEST_TIERS`. */
export const TIER_MODES: readonly string[];

/** The environment variable the switch is read from. */
export const TIER_ENV: string;

/** A test file in one of the nightly tiers, judged on its basename. */
export const NIGHTLY_TIER_FILE_RE: RegExp;

export function isNightlyTierFile(relPath: string): boolean;

/**
 * The switch's value: `queue` when unset or empty, else exactly `queue` or
 * `nightly`; any other spelling throws.
 */
export function readTierMode(env?: Record<string, string | undefined>): 'queue' | 'nightly';

/**
 * The files `mode` selects out of `files`: under `queue` everything NOT in a
 * nightly tier, under `nightly` exactly what is. Order preserved.
 */
export function selectTierFiles(files: string[], mode: 'queue' | 'nightly'): string[];
