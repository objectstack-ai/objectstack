# create-objectstack

## 17.0.0-rc.6

## 17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- 8d41998: fix(create-objectstack): scaffolding a remote template no longer produces a project that cannot build (#4926)

  `npx create-objectstack@latest my-app -t todo` (and `compliance`, `content`,
  `contracts`, `procurement`) generated a project that failed `objectstack build`
  immediately — 5 of the 6 offered templates. Only the bundled `blank` worked.

  The scaffolder read the template's original namespace from
  `objectstack.manifest.json`, and that filename names two different documents.
  The bundled template's is app-shaped and carries `namespace`; a remote
  template's is the template-registry document
  (`$schema: …/template-manifest.json`) and carries none — its namespace lives
  only in `objectstack.config.ts`. So the value came back `undefined` for every
  remote template and the object-name rewrite was skipped, while the config's
  `namespace:` was rewritten anyway. The result was `namespace: 'my_app'` sitting
  next to `name: 'todo_task'`, which the `${namespace}_${shortName}` rule rejects.
  Across the five templates, 74 object names were left unrewritten.

  `objectstack.config.ts` is now the authority for the template namespace (it
  holds the very literal the scaffolder overwrites, so the two cannot disagree),
  with the manifest as fallback. The rewrite also verifies itself: any surviving
  stale prefix throws at the scaffold, naming the files and lines, instead of
  surfacing as a build failure on the user's first command.

## 17.0.0-rc.2

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

- 7309c81: chore(cli,create-objectstack): scaffolds no longer name a driver (#4065)

  `os init` and the `create-objectstack` blank template both listed
  `@objectstack/driver-memory` in the generated `dependencies`. It was the only
  driver named, which read as an endorsement — "this is the driver your app runs
  on" — when it is in fact the **last-resort rung** of the dev step-down (native
  `better-sqlite3` → WASM SQLite → mingo). A new project's first impression of the
  data layer should not be the engine that enforces no primary keys, no
  uniqueness, no `NOT NULL` and no column types.

  It was also redundant: `@objectstack/runtime` already depends on `driver-sql`,
  `driver-sqlite-wasm` and `driver-memory`, and every script in both scaffolds runs
  through the CLI, which carries all four. Removing the line changes nothing a
  generated project can do — `objectstack dev` still resolves SQLite by default,
  and `OS_DATABASE_URL` still selects Postgres / MySQL / MongoDB.

  Docs updated to match: the "packages you depend on" table in _Your first project_
  no longer lists a driver row (it now says where drivers come from), and the
  Memory Driver section of _Database Drivers_ documents the opt-in persistence
  default, carries a migration callout for the old `'auto'` behaviour, and points
  test authors at in-memory SQLite. That section also claimed "Data is lost when
  the process exits", which was simply false while `'auto'` was the default — it
  wrote a file into the working directory.

## 17.0.0-rc.0

### Major Changes

- e47b342: feat!: require Node.js 22 — promise the runtime we actually test (#3825)

  Every published package declared `engines.node: ">=18.0.0"`. **Node 18 reached
  end-of-life on 2025-04-30 and Node 20 on 2026-04-30**, so the compatibility
  promise covered two runtimes nobody patches — and, after #3830 moved CI to Node
  22, two runtimes nothing in this repo verifies.

  That left the promise and the evidence with **no overlap at all**:

  |                                                                                                 | Node version |
  | ----------------------------------------------------------------------------------------------- | ------------ |
  | What CI validates every PR on                                                                   | **22**       |
  | What `release.yml` publishes from                                                               | **22**       |
  | What every shipped Docker image runs (`docker/Dockerfile`, `blank` template, self-hosting docs) | **22**       |
  | What `engines.node` promised users                                                              | **>=18**     |

  `engines.node` is now `>=22.0.0` across all 50 manifests. This is the honest
  floor: it is the only runtime the packages are built, tested and shipped on.

  ## Migration

  **If you are on Node 22 or newer, nothing changes.** Node 24 (Active LTS since
  2025-10-28) and Node 26 both satisfy the new range.

  If you are on Node 18 or 20, upgrade to Node 22+. Both are past end-of-life and
  receive no security patches:

  ```bash
  nvm install 22 && nvm use 22
  ```

  npm and pnpm surface an unsatisfied `engines` as an **`EBADENGINE` warning**, not
  a hard failure, so an existing install will not break the moment you upgrade —
  but the package is no longer tested on that runtime, and the failures are the
  kind that do not announce themselves. #3812 is the worked example: a native
  dependency whose `engines` required a newer Node loaded anyway on the older one
  and then killed the test worker at the process level, with no JS error and a
  summary that still said "passed".

  If your CI pins Node, pin it to 22 as well — running your gates on a runtime
  your dependencies no longer support is exactly the split this change closes.

  ## Also updated

  The "Node 18+" prerequisite was restated in ten user-facing places
  (`README.md`, `CONTRIBUTING.md`, the getting-started and deployment docs, the
  todo example, and the `objectstack-platform` skill's `compatibility` field).
  All now say 22. Changelogs and ADRs are historical records and were left alone.

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

- 4e9e184: chore(deps): OSV security batch — bump tar to ^7.5.21 (GHSA-r292-9mhp-454m) and
  js-yaml to ^5.2.2 (GHSA-pm4m-ph32-ghv5)

  Both are declared-range bumps to the patched releases, so downstream installs
  resolve the fixed versions from the published manifests, not just this
  workspace's lockfile. The same batch clears the remaining transitive advisories
  (next 16.2.11 in apps/docs; workspace overrides for brace-expansion, sharp,
  react-router, @sveltejs/kit, @hono/node-server) — those live in pnpm-workspace.yaml
  and the private docs app, which do not ship.

## 16.1.0

## 16.0.0

### Minor Changes

- 3f218e4: feat(create-objectstack): the blank scaffold ships the three generic connector executors by default

  `npm create objectstack` now generates an `objectstack.config.ts` that wires the
  `rest`, `openapi`, and `mcp` connector executor plugins (ADR-0022/0023/0024 +
  ADR-0097) into `plugins:`, alongside `requires: ['automation']`. This closes the
  last authoring gap in the ADR-0097 promise that integrations are expressible
  **and executable** as pure metadata: an author (human or AI) can now add a
  declarative `connectors:` entry naming `provider: 'rest' | 'openapi' | 'mcp'`
  and have it materialize into a live, dispatchable connector at boot — with no
  host-code edit.

  - `plugins:` — `new ConnectorRestPlugin()`, `new ConnectorOpenApiPlugin()`,
    `new ConnectorMcpPlugin()` (zero-arg = contribute the provider factory only).
  - `requires: ['automation']` — the automation service performs the
    materialization and owns the registry the executors register into. It is also
    a hard dependency of the connector plugins, so a scaffold that lists them in
    `plugins:` without it fails boot; automation ships transitively via
    `@objectstack/cli`.
  - deps — `@objectstack/connector-rest`, `@objectstack/connector-openapi`,
    `@objectstack/connector-mcp`.
  - Security (#3055): declarative `mcp` stdio transports stay denied by default —
    opt in per host with `new ConnectorMcpPlugin({ declarativeStdio: ['node'] })`.

  Brand connectors (Slack, …) remain marketplace/opt-in.

### Patch Changes

- 83e8f7d: feat(mcp): decouple the stdio auto-start switch from the HTTP surface + surface the MCP endpoint on `os dev` boot (#3167)

  The MCP HTTP surface (`/api/v1/mcp`) and the long-lived stdio transport used to
  share one env var: `OS_MCP_SERVER_ENABLED=true` turned the HTTP surface on **and**
  silently auto-started the stdio transport — which bridges the raw metadata service

  - data engine with no per-request principal (unscoped). An operator setting it to
    "make sure MCP is on" got an unscoped transport as a side effect.

  * **`@objectstack/types`** — new `resolveMcpStdioAutoStart()`. Stdio auto-start is
    now its own switch, `OS_MCP_STDIO_ENABLED` (default off); `OS_MCP_SERVER_ENABLED`
    governs only the HTTP surface. The legacy `OS_MCP_SERVER_ENABLED=true` trigger
    still starts stdio for one release, flagged as deprecated. `=false` is unchanged
    (it only ever gated HTTP).
  * **`@objectstack/mcp`** — `MCPServerPlugin.start()` gates stdio on the new switch
    and logs a one-time deprecation warning when started via the legacy alias.
  * **`@objectstack/cli`** — `os dev` now prints the MCP endpoint, the agent-skill
    URL, and a ready-to-paste `claude mcp add` command on boot (gated on the HTTP
    surface being on), so the "an agent operates the app it's building" loop is
    discoverable at dev time.
  * **`create-objectstack`** — the blank scaffold README documents that the app is
    itself an MCP server (the serve side), distinct from the consume-side connector.

- 3b6ef8a: Scaffolded projects ship with a `.gitignore` again — `npx create-objectstack` produced none, leaving `node_modules/` and `.env` un-ignored for every new user.

  `npm pack` / `pnpm pack` strip `.gitignore` from a tarball unconditionally, at every depth. The blank template committed one at `src/templates/blank/.gitignore` and the build faithfully copied it to `dist/templates/blank/.gitignore`, but `files: ["dist"]` publishing dropped it on the way to the registry — so the file was present in the repo, present in every local build, and absent from all 11 files of a real scaffold. Verified against the published 15.1.1 tarball, which ships `dist/templates/blank/.dockerignore` and no `.gitignore`.

  The template is now committed as `_gitignore` (a name npm does not strip) and restored to `.gitignore` when the template is copied, via a `TEMPLATE_FILE_ALIASES` map in the new `template-copy.ts`. Only `.gitignore` is aliased: the strip list is `.gitignore` and `.npmrc`, not "every dotfile" — `.dockerignore` packs fine and stays literal.

  The restored ignore rules also cover `.env` / `.env.*`, which they never did. The template README has users write `OS_AUTH_SECRET` and `OS_SECRET_KEY` into a `.env`, and `docker-compose.yml` calls that file "never committed" — but only the prose said so, and `.dockerignore` was the only file that listed it.

  A packing ratchet in `template-consistency.test.ts` guards both halves: it packs the real package, scaffolds from the extracted tarball with the real copy logic, and asserts every template file lands under its intended name. Source-level assertions cannot see this class of bug — the file only vanishes at publish.

- 3a8ce9d: fix(create-objectstack): the blank scaffold declares pnpm build approvals, so a fresh `pnpm install` no longer exits 1 on pnpm 11

  pnpm 11 turned an unapproved dependency build script from a warning into a hard
  error. The blank template declared no build approvals, so the very first command
  a new user runs failed on any current pnpm:

  ```
  npx create-objectstack myapp && cd myapp && pnpm install
  # [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: better-sqlite3@12.11.1, esbuild@0.28.1
  # exit 1
  ```

  The scaffold now ships a `pnpm-workspace.yaml` approving the two packages it
  actually depends on building — `better-sqlite3` (the native sqlite driver behind
  `@objectstack/driver-sql`) and `esbuild` (compiles `objectstack.config.ts`).

  Both approval keys are present because pnpm reads them by version, and neither
  alone covers the supported range:

  - `allowBuilds` (a package → boolean map) — the only key pnpm 11 honors, and
    understood back to pnpm 10.31. `onlyBuiltDependencies` alone still errors.
  - `onlyBuiltDependencies` (a list) — pnpm 10.0–10.30, which ignore `allowBuilds`.

  npm and yarn ignore the file, so the npm install path is unaffected. Both
  packages ship prebuilt binaries, so this was an install-time hard stop rather
  than a runtime defect — the project ran fine once installed.

  This is the #3091 failure class (in-repo settings masking what users resolve)
  and was caught by the publish smoke gate added in #3100, which installs the
  release candidate the way a user does — on whatever pnpm corepack hands a fresh
  machine.

- 809214f: Stop leaking repo-internal skills into scaffolded projects. The scaffolder (and the docs) advertised `npx skills add objectstack-ai/objectstack --all`, and the skills CLI's `--all` implies `--skill '*'` — which includes even `metadata.internal` skills — so repo-internal tooling like `.claude/skills/dogfood-verification` landed in every new project's `.agents/skills/`. All install commands are now scoped to the published catalog via the `/skills` subpath (`npx skills add objectstack-ai/objectstack/skills --all`), the internal skill is additionally marked `metadata.internal: true` to hide it from interactive discovery, and a template-consistency ratchet plus a scaffold-e2e assertion keep the boundary from regressing.

## 16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 3f218e4: feat(create-objectstack): the blank scaffold ships the three generic connector executors by default

  `npm create objectstack` now generates an `objectstack.config.ts` that wires the
  `rest`, `openapi`, and `mcp` connector executor plugins (ADR-0022/0023/0024 +
  ADR-0097) into `plugins:`, alongside `requires: ['automation']`. This closes the
  last authoring gap in the ADR-0097 promise that integrations are expressible
  **and executable** as pure metadata: an author (human or AI) can now add a
  declarative `connectors:` entry naming `provider: 'rest' | 'openapi' | 'mcp'`
  and have it materialize into a live, dispatchable connector at boot — with no
  host-code edit.

  - `plugins:` — `new ConnectorRestPlugin()`, `new ConnectorOpenApiPlugin()`,
    `new ConnectorMcpPlugin()` (zero-arg = contribute the provider factory only).
  - `requires: ['automation']` — the automation service performs the
    materialization and owns the registry the executors register into. It is also
    a hard dependency of the connector plugins, so a scaffold that lists them in
    `plugins:` without it fails boot; automation ships transitively via
    `@objectstack/cli`.
  - deps — `@objectstack/connector-rest`, `@objectstack/connector-openapi`,
    `@objectstack/connector-mcp`.
  - Security (#3055): declarative `mcp` stdio transports stay denied by default —
    opt in per host with `new ConnectorMcpPlugin({ declarativeStdio: ['node'] })`.

  Brand connectors (Slack, …) remain marketplace/opt-in.

### Patch Changes

- 83e8f7d: feat(mcp): decouple the stdio auto-start switch from the HTTP surface + surface the MCP endpoint on `os dev` boot (#3167)

  The MCP HTTP surface (`/api/v1/mcp`) and the long-lived stdio transport used to
  share one env var: `OS_MCP_SERVER_ENABLED=true` turned the HTTP surface on **and**
  silently auto-started the stdio transport — which bridges the raw metadata service

  - data engine with no per-request principal (unscoped). An operator setting it to
    "make sure MCP is on" got an unscoped transport as a side effect.

  * **`@objectstack/types`** — new `resolveMcpStdioAutoStart()`. Stdio auto-start is
    now its own switch, `OS_MCP_STDIO_ENABLED` (default off); `OS_MCP_SERVER_ENABLED`
    governs only the HTTP surface. The legacy `OS_MCP_SERVER_ENABLED=true` trigger
    still starts stdio for one release, flagged as deprecated. `=false` is unchanged
    (it only ever gated HTTP).
  * **`@objectstack/mcp`** — `MCPServerPlugin.start()` gates stdio on the new switch
    and logs a one-time deprecation warning when started via the legacy alias.
  * **`@objectstack/cli`** — `os dev` now prints the MCP endpoint, the agent-skill
    URL, and a ready-to-paste `claude mcp add` command on boot (gated on the HTTP
    surface being on), so the "an agent operates the app it's building" loop is
    discoverable at dev time.
  * **`create-objectstack`** — the blank scaffold README documents that the app is
    itself an MCP server (the serve side), distinct from the consume-side connector.

- 3b6ef8a: Scaffolded projects ship with a `.gitignore` again — `npx create-objectstack` produced none, leaving `node_modules/` and `.env` un-ignored for every new user.

  `npm pack` / `pnpm pack` strip `.gitignore` from a tarball unconditionally, at every depth. The blank template committed one at `src/templates/blank/.gitignore` and the build faithfully copied it to `dist/templates/blank/.gitignore`, but `files: ["dist"]` publishing dropped it on the way to the registry — so the file was present in the repo, present in every local build, and absent from all 11 files of a real scaffold. Verified against the published 15.1.1 tarball, which ships `dist/templates/blank/.dockerignore` and no `.gitignore`.

  The template is now committed as `_gitignore` (a name npm does not strip) and restored to `.gitignore` when the template is copied, via a `TEMPLATE_FILE_ALIASES` map in the new `template-copy.ts`. Only `.gitignore` is aliased: the strip list is `.gitignore` and `.npmrc`, not "every dotfile" — `.dockerignore` packs fine and stays literal.

  The restored ignore rules also cover `.env` / `.env.*`, which they never did. The template README has users write `OS_AUTH_SECRET` and `OS_SECRET_KEY` into a `.env`, and `docker-compose.yml` calls that file "never committed" — but only the prose said so, and `.dockerignore` was the only file that listed it.

  A packing ratchet in `template-consistency.test.ts` guards both halves: it packs the real package, scaffolds from the extracted tarball with the real copy logic, and asserts every template file lands under its intended name. Source-level assertions cannot see this class of bug — the file only vanishes at publish.

- 3a8ce9d: fix(create-objectstack): the blank scaffold declares pnpm build approvals, so a fresh `pnpm install` no longer exits 1 on pnpm 11

  pnpm 11 turned an unapproved dependency build script from a warning into a hard
  error. The blank template declared no build approvals, so the very first command
  a new user runs failed on any current pnpm:

  ```
  npx create-objectstack myapp && cd myapp && pnpm install
  # [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: better-sqlite3@12.11.1, esbuild@0.28.1
  # exit 1
  ```

  The scaffold now ships a `pnpm-workspace.yaml` approving the two packages it
  actually depends on building — `better-sqlite3` (the native sqlite driver behind
  `@objectstack/driver-sql`) and `esbuild` (compiles `objectstack.config.ts`).

  Both approval keys are present because pnpm reads them by version, and neither
  alone covers the supported range:

  - `allowBuilds` (a package → boolean map) — the only key pnpm 11 honors, and
    understood back to pnpm 10.31. `onlyBuiltDependencies` alone still errors.
  - `onlyBuiltDependencies` (a list) — pnpm 10.0–10.30, which ignore `allowBuilds`.

  npm and yarn ignore the file, so the npm install path is unaffected. Both
  packages ship prebuilt binaries, so this was an install-time hard stop rather
  than a runtime defect — the project ran fine once installed.

  This is the #3091 failure class (in-repo settings masking what users resolve)
  and was caught by the publish smoke gate added in #3100, which installs the
  release candidate the way a user does — on whatever pnpm corepack hands a fresh
  machine.

- 809214f: Stop leaking repo-internal skills into scaffolded projects. The scaffolder (and the docs) advertised `npx skills add objectstack-ai/objectstack --all`, and the skills CLI's `--all` implies `--skill '*'` — which includes even `metadata.internal` skills — so repo-internal tooling like `.claude/skills/dogfood-verification` landed in every new project's `.agents/skills/`. All install commands are now scoped to the published catalog via the `/skills` subpath (`npx skills add objectstack-ai/objectstack/skills --all`), the internal skill is additionally marked `metadata.internal: true` to hide it from interactive discovery, and a template-consistency ratchet plus a scaffold-e2e assertion keep the boundary from regressing.

## 15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(protocol): complete ADR-0087 — load-seam handshake, chain backfill 12–15, release artifacts (#2643)

  Closes the remaining ADR-0087 gaps (see the ADR's as-built Addendum):

  - **P0 load seams (D1).** The protocol handshake now runs on the boot-time
    durable-package rehydration path (`@objectstack/service-package` refuses an
    incompatible `sys_packages` row with the structured `OS_PROTOCOL_INCOMPATIBLE`
    diagnostic and keeps booting) and on `AppPlugin` for code-defined stacks
    (fail-fast before the manifest is decomposed). `objectstack lint` gains
    `protocol/missing-engines-range` (warning + fix-it) and the
    `create-objectstack` blank template stamps `engines: { protocol: '^<major>' }`
    (re-stamped at version time by `scripts/sync-template-versions.mjs`) — the
    two ends of the grandfathering ratchet.
  - **Chain backfill (D2/D3).** `MetadataConversion.retiredFromLoadPath`
    implements the load-window's second half (retired entries replay only via
    `migrate meta` / fixture CI). Steps 12–15 land: the `api.requireAuth` flip
    (semantic), the ADR-0090 wave (3 retired conversions + 5 semantic TODOs), the
    `BookAudience` rename (retired conversion), and the ADR-0089 visibility
    unification (`visibleOn`/`visibility` → `visibleWhen` as LIVE load-window
    conversions) + the `.strict()` flip (semantic). The protocol-11
    `compactLayout` → `highlightFields` rename is backfilled as a retired step-11
    conversion. `migrate meta --from 10` now reaches protocol 15.
  - **Release artifacts (D4).** `spec-changes.json` is generated from the
    registries (`gen:spec-changes`, CI drift-checked), ships in the npm artifact
    together with `api-surface.json`, and is attached to each `@objectstack/spec`
    GitHub Release with `added[]`/`removed[]` filled from the api-surface diff
    against the previously published release. The upgrade guide
    (`docs/protocol-upgrade-guide.md`) is generated from the same registries and
    CI drift-checked — a projection that cannot drift.

- f531a26: Scaffolded projects are now container-ready out of the box: the `blank` template ships a `Dockerfile` (two-stage build onto the official `ghcr.io/objectstack-ai/objectstack` runtime image), a `docker-compose.yml` (app + Postgres single-host stack), and a `.dockerignore`, plus a Deploy section in the project README. `docker build -t my-app .` works immediately after `npm create objectstack`.

## 15.0.0

## 14.8.0

### Patch Changes

- eaff014: Scaffolded projects now install the current framework release instead of a stale major. The bundled `blank` template had `^6.0.0` ranges frozen in while the registry was publishing 14.x, so `npm create objectstack` produced a project eight majors behind the docs — and the template's code no longer compiled against 14.x anyway (`Field.longText` removed, `api.rest` no longer a `defineStack` key, `sharingModel` now required by the ADR-0090 security gate). The template is updated to the current API, and the scaffolder now rewrites every `@objectstack/*` range in the generated `package.json` to `^<its own version>` (all packages version in lockstep), so generated projects track the release even if the committed template drifts again. A consistency test ratchets the template's major and the README's template table against the registry. The template README also documents the seeded dev-admin sign-in that data-API curls need.

## 14.7.0

## 14.6.0

## 14.5.0

## 14.4.0

## 14.3.0

## 14.2.0

## 14.1.0

## 14.0.0

## 13.0.0

## 12.6.0

## 12.5.0

## 12.4.0

## 12.3.0

## 12.2.0

## 12.1.0

## 12.0.0

## 11.10.0

## 11.9.0

## 11.8.0

## 11.7.0

## 11.6.0

## 11.5.0

## 11.4.0

## 11.3.0

## 11.2.0

## 11.1.0

## 11.0.0

## 10.3.0

## 10.2.0

## 10.1.0

### Minor Changes

- 7cf283a: Make `os validate` the author-time verification gate and steer scaffolds toward it.

  - **`os validate`** now runs the same CEL/predicate gate as `os build`/`os compile`
    (ADR-0032): every `visible`/`disabled`/`requiredWhen`/validation/flow/sharing
    predicate is checked for CEL syntax and `record.<field>` existence on the target
    object. It already ran the protocol schema and widget-binding checks; the
    expression gate closes the gap so a bare field ref (`done` instead of
    `record.done`) — which silently hides an action on every record at runtime
    (#2183/#2185) — fails validation instead of shipping. `os validate` is now a
    read-only superset of the build's checks (no artifact emitted).
  - **`create-objectstack`** now emits an `AGENTS.md` (and `.github/copilot-instructions.md`)
    into every generated project instructing coding agents to run `npm run validate`
    after editing metadata, aligns the blank template's `dev`/`start` scripts with the
    example apps (`objectstack dev`/`objectstack start`), and sharpens the post-create
    "Next steps" output.

## 10.0.0

## 9.11.0

## 9.10.0

## 9.9.1

## 9.9.0

## 9.8.0

## 9.7.0

## 9.6.0

## 9.5.1

## 9.5.0

## 9.4.0

## 9.3.0

## 9.2.0

## 9.1.0

## 9.0.1

## 9.0.0

## 8.0.1

## 8.0.0

## 7.9.0

## 7.8.0

## 7.7.0

## 7.6.0

## 7.5.0

## 7.4.1

## 7.4.0

## 7.3.0

## 7.2.1

## 7.2.0

## 7.1.0

## 7.0.0

## 6.9.0

## 6.8.1

## 6.8.0

## 6.7.1

## 6.7.0

## 6.6.0

## 6.5.1

## 6.5.0

## 6.4.0

### Patch Changes

- 15fc484: Upgrade `@object-ui/*` packages to **v6.0**.

  - `@objectstack/cli`: `@object-ui/console` and `@object-ui/studio` from `^5.4.2` → `^6.0.0` — bundled Studio + Console assets now ship the v6 UI shell (new design language, refreshed sidebar, redesigned record header).
  - `@objectstack/account`: `@object-ui/i18n` from `^5.4.2` → `^6.0.0` — i18n runtime now matches the v6 console/studio API.
  - Root devDependency `@object-ui/console` from `^5.4.2` → `^6.0.0` so workspace scripts and the docs build pick up v6.
  - `create-objectstack`: `tar` from `^7.4.3` → `^7.5.15` (security + perf fixes when unpacking remote templates).

  **Heads-up for consumers:** `@object-ui/*` v6 is a major release of the bundled UI; pages rendered through the CLI's `studio` / `console` mounts may look different from v5. The protocol surface is unchanged.

## 6.3.0

## 6.2.0

## 6.1.1

## 6.1.0

## 6.0.0

## 5.2.0

## 5.1.0

## 5.0.0

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

## 4.0.3

## 4.0.2

## 4.0.0

## 3.3.1

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

## 3.2.1

## 3.2.0

## 3.1.1

## 3.1.0

## 3.0.11

## 3.0.10

## 3.0.9

## 3.0.8
