// Types for the lead line `cli-unbuilt-workspace-lead.mjs` publishes to the one
// TypeScript consumer that reads it — `packages/cli/test/unbuilt-workspace-lead.test.ts`,
// which sits inside `@objectstack/cli`'s hidden test layer, where an untyped
// `.mjs` import is TS7016 (measured: `error TS7016: Could not find a declaration
// file for module …`). That layer's ledger entry in
// `scripts/check-type-check-coverage.mjs` is recorded EXACTLY — "the first new
// error in it should go red rather than be absorbed" — so the declaration is
// what keeps a new test from spending someone else's budget.
//
// The module itself stays `.mjs` for the reason its two sibling mirrors state:
// the gates invoke these scripts with bare `node`, and `check:declaration-mirrors`
// `import()`s this one to compare it against this file. That is also why the
// module takes the CLI's name as a PARAMETER rather than importing
// `INVOCATION_PREFIX` from a `.ts` — see the module header.
//
// COMPLETE rather than partial, unlike `invoked-as.d.mts`: the module exports
// exactly one thing. Keep this file in step with the module by hand; the mirror
// gate checks name, kind and required arity, never types.
//
// ⚠️ `resolveSpecifier` is OPTIONAL, and that is load-bearing for this file
// rather than a style choice: the mirror gate compares REQUIRED arity against
// the module's `fn.length`, and a parameter declared required here while the
// module leaves it optional is exactly the drift that gate exists to catch.
// Optional on both sides is also the honest signature — a caller that cannot
// answer where a specifier resolved gets the pre-#16547 answer.

/**
 * Where a specifier resolved, as the CALLER's own loader answers it.
 *
 * The diagnostic uses it to tell "this package's build output is stale" apart
 * from "this package's build output was never consulted", which are different
 * facts with opposite remedies (#16547). `undefined` means the caller cannot
 * answer, and is read as no evidence of a redirect.
 */
export type ResolveSpecifier = (specifier: string) => string | undefined;

/**
 * The two lines to print when oclif's "command … not found" was really a
 * workspace package whose build output could not serve the import — or
 * `undefined` when the failure is not that one, which is every ordinary
 * invocation error and every command that genuinely does not exist.
 *
 * @param error the error `run()` rejected with; only its string form is read.
 * @param moduleLoadFailures `detail` of each warning oclif emitted while
 *   loading its command table, in emission order.
 * @param prefix the CLI's own name, which every line it prints starts with
 *   (`INVOCATION_PREFIX` in `packages/cli/src/utils/invocation.ts`).
 * @param resolveSpecifier the caller's loader, asked whether the failing
 *   specifier reached build output at all. Omitted, the answer is the one this
 *   module gave before #16547.
 */
export function unbuiltWorkspaceLines(
  error: unknown,
  moduleLoadFailures: readonly string[],
  prefix: string,
  resolveSpecifier?: ResolveSpecifier,
): [string, string] | undefined;
