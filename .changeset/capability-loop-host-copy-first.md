---
"@objectstack/cli": patch
---

Stop claiming the `os serve` capability loop loads a "host copy first" (#10909).
Two module-header comments in `packages/cli/src/commands/serve.ts` — above the
`@objectstack/plugin-email` and `@objectstack/service-sms` imports — described
the capability loop (`Serve.CAPABILITY_PROVIDERS`, the `for (const cap of
requires)` block) as resolving `EmailServicePlugin`/`SmsServicePlugin` "host
copy first". Measured at head, the loop does a bare `await import(spec.pkg)` /
`await import(ex.pkg)` — no `importFromHost` in either path — which Node ESM
resolves against **this CLI's own** realpath, so the CLI's bundled copy always
wins; the host app's copy is never consulted. The comments described a
behaviour the code does not have.

The corrected comments also name the contrast the file now actually contains:
`Serve.importConfigPlugin` (the served app's own `plugins: [...]` entries) IS
host-anchored — an app-declared package wins there — while the capability
loop is not. Making that split legible is the point of the fix, so the next
reader does not assume one resolution rule governs the whole file.

Comment-only: no runtime path, resolution order, or accepted specifier changes.
All 21 `CAPABILITY_PROVIDERS` packages remain CLI-declared, so bare resolution
still finds every one of them today — this only corrects what the comment
claims about *how* that resolution happens.
