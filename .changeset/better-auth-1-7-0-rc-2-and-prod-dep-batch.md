---
"@objectstack/plugin-auth": major
"@objectstack/platform-objects": major
"@objectstack/client": major
"@objectstack/cli": patch
"create-objectstack": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/hono": patch
---

chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
production-dependency batch from #3517

**better-auth 1.7.0-rc.1 → 1.7.0-rc.2** across the family (`better-auth`,
`@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/sso`, and the
adapter/telemetry overrides). `@better-auth/scim` deliberately stays on
1.7.0-rc.1 — rc.2 replaces its whole model (code-defined connections; the
`scimProvider` model and the generate-token endpoint are gone), which is a
feature migration, not a version bump. Its peer range accepts rc.2 core, and the
advisory that forced the original pin (GHSA-j8v8-g9cx-5qf4) is still fixed.

**BREAKING — account identity.** better-auth renamed `account.accountId` to
`account.providerAccountId` and added a REQUIRED `account.issuer`; sign-in now
resolves accounts by `(issuer, providerAccountId)`.

- FROM `fields: { accountId: 'account_id' }` → TO
  `fields: { issuer: 'issuer', providerAccountId: 'account_id' }`. The provider
  account id keeps its `account_id` column — only the better-auth-side name
  moved — and `sys_account` gains an `issuer` column.
- FROM `internalAdapter.createAccount({ providerId, accountId, … })` → TO
  `createAccount({ providerId, issuer, providerAccountId, … })`. A local
  password account carries the issuer better-auth mints for itself,
  `local:credential`.
- FROM `client.auth.accounts.unlink({ providerId, accountId })` → TO
  `unlink({ accountId })`, where `accountId` is now the account ROW id (the `id`
  from `accounts.list()`), matching better-auth's narrowed body.
  `accounts.list()` returns `issuer` + `providerAccountId` in place of
  `accountId`.

**Existing deployments:** rows written before 1.7 have no issuer and are
invisible to sign-in until stamped. The auth plugin now runs an idempotent
boot-time backfill that stamps what it can derive — `local:credential` for
password accounts, `local:oauth:<providerId>` for configured social providers,
and the registered IdP's real `iss` from `sys_sso_provider` for federated ones.
Accounts from a federated IdP that is no longer registered cannot be derived;
they are logged with their provider id and row count rather than guessed, and
those users cannot sign in through that provider until the row is stamped with
the IdP's issuer or removed so a fresh login re-links it.

**Also required by 1.7:** `SecondaryStorage` gained two mandatory methods, both
now implemented over the kernel cache service — `getAndDelete` (single-use
verification values) and `increment` (fixed-window rate-limit counter;
`rateLimit.storage: 'secondary-storage'` throws at boot without it).

The rest of #3517's production-dependency batch rides along: `@oclif/core`
4.13.0, `@hono/node-server` 2.0.12, `hono` 4.12.32, `tar` 7.5.22, `jose` 6.2.4,
`pinyin-pro` 3.28.2, plus the private docs app's fumadocs/next/react bumps.
