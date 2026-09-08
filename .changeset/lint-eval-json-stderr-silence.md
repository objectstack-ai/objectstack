---
"@objectstack/cli": patch
---

`os lint --eval --json` no longer leaks esbuild's own diagnostics to stderr while loading a `--generator` module.

A `--json` invocation is a machine face, and its stdout document was already well-formed — but the `--generator` load runs through `bundleRequire`, and esbuild's logger writes straight to stderr from inside that call, before anything throws. The `catch` that builds the one-key `{error}` document therefore never got a chance to suppress it, and a caller who asked for JSON got an internal bundler's diagnostic on the human channel alongside it.

Measured on `bin/run-dev.js` with `NO_COLOR=1`, two runs that both leaked:

- an unresolvable `--generator` path: exit 1, a well-formed `{error}` on stdout, and `✘ [ERROR] Could not resolve "<path>"` on stderr;
- a generator that bundles and loads *successfully* but makes esbuild warn: exit 0, the full live eval report on stdout, and 340 bytes of `▲ [WARNING] …` on stderr. Nothing throws on this path at all, so no error handling was ever involved.

The load now passes `esbuildOptions: { logLevel: 'silent' }`, scoped to that one call site and applied only when `--json` is set.

- **The refusal is unchanged.** `logLevel` governs whether esbuild *prints*; it still throws its `BuildFailure` with `errors` populated, and that text already forms the tail of the `{error}` string on stdout. Both stdout documents above are byte-identical before and after.
- **The human face is untouched**, by construction rather than by restating a default: without `--json` no `esbuildOptions` is passed at all. `os lint --eval --generator <bad>` still prints esbuild's line on stderr exactly as before.
- **What is suppressed beyond the leak itself:** under `--json`, an esbuild *warning* on a generator that loads fine now reaches nothing. A warning is not thrown, so no handler carries it onto stdout. This is inside the defect rather than beyond it — the machine face is not a place for human-channel output — but a `--json` consumer that was reading stderr for bundler warnings will no longer see them.
- The other `bundleRequire` callers in the CLI (`os serve` / `os dev`, config loading, scaffold validation) are not affected and keep their diagnostics.
