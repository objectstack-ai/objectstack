---
"@objectstack/rest": patch
---

`packages/rest`'s fault logging gains a **declared level seam**, `OS_REST_LOG`, with the **shipped default unchanged**. At the default — and an unset or unrecognised value *is* the default — a reported fault still prints the whole `Error`: message, `cause` chain and stack frames, exactly as before. ⛔ No wire byte moves, no published payload gains a key, and no existing log line changes shape.

What is new is that the loud/quiet choice is now **declared and machine-read** instead of implicit in whether an author happened to pass `error` or `error.message`:

- **`OS_REST_LOG`** accepts `debug` / `info` / `warn` / `error` / `silent` — deliberately the same vocabulary and the same `'info'` default as `@objectstack/objectql`'s `OS_REGISTRY_LOG`, so the two are one logging contract with two populations rather than a second ad-hoc environment variable. Documented for operators in this package's README.
- **`scripts/check-rest-log-declared.mjs`** enforces it: the seam is located by its environment read (never a hardcoded path), the vocabulary is read from `REST_LOG_LEVELS` rather than copied, the two seams' vocabularies are held equal, a harness declaration must name a level the seam actually recognises — an unrecognised one resolves to the default *silently* — and every inline vitest project must carry its own declaration, because a root-level `env` is inert for project runs.
- **The shipped default is gated, not just documented.** Lowering `REST_LOG_DEFAULT_LEVEL` to `error` or `silent` is a finding, because at those levels this package stops reporting faults it is the only reporter of.

**Why the default does not move.** Measured on one green `packages/rest` run: 2,095 indented `at ` frame lines, 36.7% of captured output, 100% of them arriving through this one shim. They are not dead weight. When a 5xx is withheld from the client, the log is the only copy of the driver text, and that text lives on `error.cause` — printed only because a whole `Error` object, not a summary, reaches `console.error`. Four assertions across `rest-5xx-message-sanitization.test.ts` and `rest-expected-error-logging.test.ts` pin that by asserting the **identity** of the error that arrives, one of them carrying an explicit do-not-delete warning aimed at exactly this repair.

Operators: nothing to do. A deployment that wants the REST layer quieter can now say so — `OS_REST_LOG=error` drops the warning half, `silent` drops both — but doing so discards diagnostics that have no second copy anywhere, and the README says so at the seam.
