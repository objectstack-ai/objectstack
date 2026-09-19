// Types for the git-environment strip `git-env.mjs` publishes to the gates and
// fixtures that import it (#16644).
//
// The module itself stays `.mjs`, for the reason its three sibling mirrors
// state: `pre-commit`, the merge driver and every `check:*` gate invoke these
// root scripts with bare `node`, and every root script here is authored that
// way. What needed the declaration is the other direction — two TypeScript
// fixtures under `packages/spec/scripts/` now import the strip
// (`build-schemas-check-mode.test.ts`, `sharded-artifacts.test.ts`), and since
// #5475 that directory is inside a tsc program (`tsconfig.scripts.json`), where
// an untyped `.mjs` import is TS7016. Left untyped, `gitFreeEnv` silently
// becomes `any`, and the mistake that costs the most here — `env: gitFreeEnv`
// instead of `env: gitFreeEnv()`, which hands the child a FUNCTION where an
// environment belongs — type-checks clean.
//
// Declared rather than inferred (no `allowJs`) because the module sits at the
// repo root, outside the consuming program's `rootDir`.
//
// PARTIAL on purpose, the `check-regen-pending.d.mts` / `invoked-as.d.mts`
// shape: the module also exports `withoutGitEnv`, `gitEnvKeys`,
// `sharedGitConfigVerdict`, `formatSharedGitConfigAlarm`, `selfTest` and two
// string constants, and omitting them cannot fail green — a consumer importing
// an undeclared name gets TS2305, which is loud and immediate. Every one of
// those is reached today from `.mjs` callers, which need no declaration at all,
// so declaring them would grow a hand-maintained surface nothing is asking for.
// Keep this file in step with the module by hand; `check:declaration-mirrors`
// asserts the name, kind and required arity of each entry — never the types,
// which stay yours.

/**
 * A copy of `base` with every `GIT_`-prefixed key removed.
 *
 * Returns a NEW object; `process.env` is not mutated. Pass the result as the
 * `env` option of every `git` child that must operate on the repository its
 * `cwd` and arguments name ALONE.
 *
 * ⛔ Not for a child that talks to a remote: `GIT_CONFIG_*` and `GIT_SSL_*`
 * carry the transport configuration, and the module's header carries the
 * measurement behind that boundary.
 *
 * @param base Defaults to `process.env`.
 */
export function gitFreeEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
