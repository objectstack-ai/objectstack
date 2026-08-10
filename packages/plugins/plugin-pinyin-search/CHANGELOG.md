# @objectstack/plugin-pinyin-search

## 17.0.0-rc.6

### Patch Changes

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [debe2f6]
- Updated dependencies [ad878e7]
- Updated dependencies [3028326]
- Updated dependencies [ddd075a]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
- Updated dependencies [ea1d916]
- Updated dependencies [10c4ea9]
- Updated dependencies [2ef1807]
- Updated dependencies [55da611]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [b127c8b]
- Updated dependencies [92a67f2]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [55011af]
- Updated dependencies [3f8817a]
- Updated dependencies [53ef057]
- Updated dependencies [d6d1a50]
- Updated dependencies [c804f19]
- Updated dependencies [dbe92a7]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [1507ba3]
- Updated dependencies [bf42e76]
- Updated dependencies [bfe689b]
- Updated dependencies [d0d5205]
- Updated dependencies [de43f94]
- Updated dependencies [28d1eb7]
- Updated dependencies [3fb42d2]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [91cefb8]
- Updated dependencies [9bc846b]
- Updated dependencies [4fedb11]
- Updated dependencies [d13f627]
- Updated dependencies [a841151]
- Updated dependencies [1788e19]
- Updated dependencies [1f6ed16]
- Updated dependencies [d86815e]
- Updated dependencies [e13fd91]
- Updated dependencies [2bd4e5e]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [ee3bde1]
- Updated dependencies [1363084]
- Updated dependencies [148d451]
  - @objectstack/objectql@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- Updated dependencies [28ad90e]
- Updated dependencies [64cd010]
- Updated dependencies [29c6c9d]
- Updated dependencies [c497d26]
- Updated dependencies [bbdbf28]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [1b49eaf]
- Updated dependencies [b746aa0]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [eda599e]
- Updated dependencies [2b63a00]
- Updated dependencies [afa6aa5]
- Updated dependencies [afb83d3]
- Updated dependencies [c7406b0]
- Updated dependencies [08f93bc]
- Updated dependencies [eb3e650]
- Updated dependencies [290d944]
- Updated dependencies [02dc076]
- Updated dependencies [7f1a635]
- Updated dependencies [5d3ced9]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1eadac0]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b26699]
- Updated dependencies [46365ab]
- Updated dependencies [1c625ca]
- Updated dependencies [c5adfe1]
- Updated dependencies [1cae606]
- Updated dependencies [b9cc17d]
- Updated dependencies [0d24078]
- Updated dependencies [5b8f95b]
- Updated dependencies [2ddba89]
- Updated dependencies [37a8f2b]
- Updated dependencies [441d79f]
- Updated dependencies [2680cd3]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [23dba62]
- Updated dependencies [d56bcdb]
- Updated dependencies [488b66c]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [2b52bc8]
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/objectql@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- Updated dependencies [ce5242c]
- Updated dependencies [257d97a]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [20b1a9e]
- Updated dependencies [f2445c9]
- Updated dependencies [462b713]
- Updated dependencies [63b33e6]
- Updated dependencies [a52e2ef]
- Updated dependencies [4c45be1]
- Updated dependencies [ce92674]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [b25a116]
- Updated dependencies [127f091]
- Updated dependencies [833b512]
- Updated dependencies [071d0dc]
- Updated dependencies [1ee48bc]
- Updated dependencies [26bb053]
- Updated dependencies [50185a8]
- Updated dependencies [d6bd5a1]
- Updated dependencies [ad5fe25]
  - @objectstack/objectql@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- Updated dependencies [48fcf70]
- Updated dependencies [3ec8186]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [32ccb23]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [8d895ff]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [3c628ce]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [91f4c78]
- Updated dependencies [45dc446]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [39eb01b]
- Updated dependencies [55bbefc]
- Updated dependencies [7ce02eb]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [77fadbf]
- Updated dependencies [5c13368]
- Updated dependencies [857a6cf]
- Updated dependencies [d5749d7]
- Updated dependencies [d92c72d]
- Updated dependencies [5d21a48]
- Updated dependencies [e4c2dc8]
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

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
