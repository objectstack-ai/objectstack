// Types for the three `workspace-enumerator.mjs` exports a gate under
// `packages/spec/scripts/` consumes — the same problem, and the same fix, as
// `check-regen-pending.d.mts` and `js-comment-mask.d.mts` next door (#5475).
//
// The module itself stays `.mjs`: it is imported by root gates that run under
// bare `node`, and it is deliberately NOT a gate of its own (see its header —
// being one is exactly what it must not be). What changed is that
// `check-duration-unit-keys.ts` now imports it (#15682, when that gate's
// population widened from `packages/spec/src/**` to every workspace package's
// `src/`), and since #5475 that directory sits inside a tsc program
// (`tsconfig.scripts.json`), where an untyped `.mjs` import is TS7016 — the
// enumeration silently becomes `any`, and a misspelled export would type-check
// clean while resolving to `undefined` at runtime.
//
// PARTIAL BY DESIGN, the shape `check-regen-pending.d.mts` already takes and
// `check:declaration-mirrors` explicitly sanctions: the module exports twelve
// names and this declares the THREE this repo's TypeScript consumers use.
// Importing an undeclared name from here is `TS2305` — loud, red and immediate
// — never a silent `any`. Declared rather than inferred (no `allowJs`) because
// the module sits at the repo root, outside the consuming program's `rootDir`.
// Keep this file in step with the module by hand; `check:declaration-mirrors`
// holds the names, kinds and required arities.

/**
 * The `packages:` globs of the workspace rooted at `root`.
 *
 * A MISSING `pnpm-workspace.yaml` is this function's refusal, not an empty
 * answer — callers for whom "no workspace here" is ordinary test with
 * `existsSync` first.
 */
export function readWorkspaceGlobs(root: string): string[];

/** Whether a glob is a pnpm exclusion (`!pattern`), which enumerates nothing. */
export function isExclusionGlob(glob: string): boolean;

/**
 * Every workspace member that actually holds a `package.json`, as repo-relative
 * POSIX directories, sorted.
 */
export function workspacePackageDirs(root: string): string[];
