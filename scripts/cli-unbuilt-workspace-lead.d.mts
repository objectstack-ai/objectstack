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

/**
 * The two lines to print when oclif's "command … not found" was really a
 * workspace package with no usable build output — or `undefined` when the
 * failure is not that one, which is every ordinary invocation error and every
 * command that genuinely does not exist.
 *
 * @param error the error `run()` rejected with; only its string form is read.
 * @param moduleLoadFailures `detail` of each warning oclif emitted while
 *   loading its command table, in emission order.
 * @param prefix the CLI's own name, which every line it prints starts with
 *   (`INVOCATION_PREFIX` in `packages/cli/src/utils/invocation.ts`).
 */
export function unbuiltWorkspaceLines(error: unknown, moduleLoadFailures: readonly string[], prefix: string): [string, string] | undefined;
