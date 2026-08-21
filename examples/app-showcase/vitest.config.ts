import { defineConfig, configDefaults } from 'vitest/config';
import path from 'node:path';

/**
 * Unit tests only. The Playwright browser smoke under `e2e/` also uses
 * `*.spec.ts`, so exclude it here — otherwise vitest tries to run it and chokes
 * on the `@playwright/test` import. Run the smoke with `pnpm test:smoke`.
 */
export default defineConfig({
  resolve: {
    // `test/action-predicate-sparse-face.test.ts` (#8990) drives this app's
    // authored predicates through the CEL engine itself, because the whole
    // point of that pin is what the ENGINE answers on a sparse list row — a
    // fault versus a considered `false`, which are the same pixel to the user.
    // Unaliased, `@objectstack/formula` resolves through the workspace link to
    // `dist/` — a build artifact — so the verdict would be a function of build
    // state rather than of the source in this checkout. The loud half (a
    // missing export) is the mild one; a dist merely BEHIND runs the suite
    // GREEN against the engine's OLD null/absence semantics, which is exactly
    // the behaviour these assertions exist to pin. `pnpm check:test-source-alias`
    // is the gate. Mirrors examples/app-crm's identical rule.
    //
    // ANCHORED regex, array form, deliberately: a bare string `find` matches by
    // PREFIX, so with a FILE replacement it would also swallow any subpath and
    // resolve it to `…/formula/src/index.ts/<sub>` — `ENOTDIR` at run time,
    // from a config that reads as correct.
    //
    // `test/email-template-locale.test.ts` resolves this app's declared email
    // templates through plugin-email's real `sys_email_template` loader and its
    // real column mapping. Through the workspace link that package resolves to
    // `dist/` — a build artifact — so a stale dist would grade the declarations
    // against an OLD locale ladder, which is the one thing those assertions
    // exist to measure. `pnpm check:test-source-alias` is the gate, and its
    // registry is shrink-only: the alias is the sanctioned remedy, never a new
    // registry entry.
    alias: [
      { find: /^@objectstack\/formula$/, replacement: path.resolve(__dirname, '../../packages/formula/src/index.ts') },
      { find: /^@objectstack\/plugin-email$/, replacement: path.resolve(__dirname, '../../packages/plugins/plugin-email/src/index.ts') },
    ],
  },
  test: {
    // `test/fixtures/**` holds the deliberately-broken inputs that
    // `test/vitest-console-teardown-race.test.ts` spawns vitest against. They
    // are `*.test.ts` on purpose — that pin runs them with vitest's DEFAULT
    // include and this very config, only with the fixture directory as `root`,
    // at which point this exclude no longer matches them (it is evaluated
    // against the path relative to the root in use). Collecting them here
    // instead would import a leaked-console-log fixture into the app's own
    // suite, i.e. arm the exact flake the pin exists to keep disarmed.
    exclude: [...configDefaults.exclude, '**/e2e/**', 'test/fixtures/**'],

    // ⛔ Do not remove without reading `test/vitest-console-teardown-race.test.ts`
    // — that pin fails when this is off, and its ablation leg is what proves it.
    //
    // THE DEFECT (#10293, mechanism in #10374). vitest 4's worker replaces
    // `console` with one that ships every write to the main thread over RPC.
    // In `packages/vitest/dist/chunks/console.*.js`:
    //
    //     state().rpc.onUserConsoleLog({ type, content, taskId, ... });
    //
    // — the returned promise is DISCARDED. Teardown, in
    // `packages/vitest/dist/chunks/init.*.js`, then does
    // `await rpcDone()` followed by `$rejectPendingCalls(...)`, and `rpcDone()`
    // awaits a SNAPSHOT (`Array.from(promises)`) taken when it is called. A
    // console RPC created after that snapshot is still pending when
    // `$rejectPendingCalls` runs, is rejected with `EnvironmentTeardownError`,
    // and — because nobody kept the promise — surfaces as an UNHANDLED
    // rejection. vitest fails a run on an unhandled error even when every
    // assertion passed, so the observed signature is a green suite that exits
    // 1: `Test Files 21 passed (21) / Tests 342 passed (342) / Errors 1 error`.
    // Measured cost when it lands in the merge queue: the PR is dequeued and
    // every speculative build behind it rebuilds.
    //
    // WHY THE WINDOW IS LOAD-DEPENDENT, which is why it reads as a flake: the
    // window is the duration of `rpcDone()`, i.e. the time to complete the RPC
    // round-trips already in flight. Idle that is ~1ms; on a saturated runner
    // it is long enough for a leaked timer or poll to log inside it. Nothing
    // about the code under test changes.
    //
    // WHY THIS SETTING AND NOT A QUIETER SUITE. Turning the interception off is
    // vitest's own supported option, and it removes the MECHANISM rather than
    // narrowing the trigger: with no RPC there is no pending call to reject, so
    // no leak in any future test can redden a green run this way. It is also
    // not a silencing: vitest's non-TTY default reporter sets
    // `silent: 'passed-only'`, so today this app's console output from passing
    // tests is discarded AFTER paying the round-trip. Written straight to the
    // worker's stdout it is visible for the first time. Measured on this suite:
    // 72 `onUserConsoleLog` calls per run — each carrying a batched buffer, so
    // 285 lines — every one of them discarded before this change. That is the
    // honest cost too: this app's share of a Test Core log grows by those 285
    // lines (~0.9% of a 31,839-line shard log), most of it `[Registry]`
    // registration chatter. Quieting THAT is a separate question about
    // `@objectstack/objectql`'s own default log level, not about this setting.
    //
    // WHAT IT COSTS. Console output loses vitest's `stdout | file > test`
    // attribution header and its per-task buffering, so it interleaves in
    // arrival order across forks — which is already how the bulk of this app's
    // test output behaves, because ObjectQL's logger writes to `process.stdout`
    // directly and never went through this path at all.
    disableConsoleIntercept: true,
  },
});
