---
"@objectstack/spec": minor
"@objectstack/runtime": minor
---

Seed data: first-class identity binding + loud failures (fixes #1389)

Records seeded via `defineDataset` / `defineStack({ data })` can now bind to a
platform user with `cel\`os.user.id\`` (and to the org with `cel\`os.org.id\``),
which previously never resolved at boot.

- **`os.user` / `os.org` now actually resolve.** The runtime provisions a
  deterministic, non-loginable system user (`usr_system`, role `system`)
  *before* any seed runs and binds it to `os.user`, so identity-derived seed
  values resolve even on a fresh boot — before the first human sign-up. The
  human login admin remains a separate better-auth identity and need not own
  seed data. Exposed as the canonical `SystemUserId.SYSTEM` constant.
- **New `SeedLoaderConfig.identity`** carries the `os.user` / `os.org` subject
  into CEL evaluation (`@objectstack/spec`).
- **Failures are loud, not silent.** A record whose CEL value can't resolve
  (e.g. a required `cel\`os.user.id\`` with no identity) — or that fails to
  write — is now counted as an error, marks the load unsuccessful, and logs an
  actionable message, instead of being silently dropped.
