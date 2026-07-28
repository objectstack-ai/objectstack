# @objectstack/plugin-pinyin-search

## 17.0.0-rc.0

### Patch Changes

- 9f060e5: chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
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

- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [a749273]
- Updated dependencies [fdb4f50]
- Updated dependencies [879ea13]
- Updated dependencies [840ee4b]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [b949059]
- Updated dependencies [c5ff96d]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [32d3800]
- Updated dependencies [a227ed7]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [4cca74c]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
- Updated dependencies [030125b]
- Updated dependencies [8e08bc3]
- Updated dependencies [0c302a7]
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
  - @objectstack/objectql@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [b20201f]
  - @objectstack/core@16.1.0
  - @objectstack/objectql@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [22013aa]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [fdc244e]
- Updated dependencies [dd9f223]
- Updated dependencies [2ea08ee]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [86d30af]
- Updated dependencies [2018df9]
  - @objectstack/objectql@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [674457a]
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [22013aa]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [fdc244e]
- Updated dependencies [dd9f223]
- Updated dependencies [2ea08ee]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [86d30af]
- Updated dependencies [2018df9]
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/objectql@15.1.1

## 15.1.0

### Minor Changes

- f531a26: Generic pinyin search recall (#2486, ADR-0098): a locale-gated
  `OS_SEARCH_PINYIN_ENABLED` switch (auto-on when the stack configures any
  `zh-*` locale) provisions a hidden `__search` companion column for each
  object's display/name field at compile time, the new
  `@objectstack/plugin-pinyin-search` fills it with full pinyin + initials
  ("张伟" → "zhangwei zw") on before-save (plus boot backfill and a
  `rebuildSearchCompanion` reconcile entry), and `$search` ORs the column in at
  query time — so lookup pickers, list quick-search and ⌘K transparently match
  `zhangwei` / `zw` against CJK names. Purely additive: `resolveSearchFields`,
  `searchableFields`, drivers and non-Chinese deployments are untouched; FLS
  restricted / secret / PII fields never feed the companion.

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
  - @objectstack/objectql@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0
