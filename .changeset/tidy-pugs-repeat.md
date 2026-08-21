---
---

Stop a `console.log` that outlives its test file from failing an otherwise-green
`@objectstack/example-showcase` run. vitest 4's worker forwards console output to the main
thread over RPC and discards the promise, so a log emitted inside the teardown window is
rejected with `EnvironmentTeardownError` that nobody handles — and vitest fails a run on an
unhandled error even with zero failed assertions, which dequeued three merge-queue PRs in one
afternoon. The suite now runs with vitest's own `disableConsoleIntercept`, which removes the
RPC the race needs, and a pin drives a deliberately leaking fixture through both legs so the
guard cannot be removed silently. Test harness only; no published package changes behaviour.
