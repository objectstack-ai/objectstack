# create-objectstack

## 17.2.0

### Minor Changes

- 5a616d5: `create-objectstack` now closes with a "Created files" summary derived from a
  walk of the finished project directory, so it names everything the run wrote —
  including the files written after the template copy (#10323).
  
  The old summary was the template copy's own list, printed before
  `<pm> install` and before `npx skills add`. Measured against published
  `create-objectstack@17.1.0` (`create-objectstack demo-app`, then a full walk of
  the result): 12 entries printed, 18,045 paths on disk, **18,033 of them
  unreachable from the summary** — `AGENTS.md`, `.github/copilot-instructions.md`,
  `pnpm-lock.yaml`, `skills-lock.json`, `node_modules/`, and two ~968 KB trees of
  agent instructions at `.agents/skills/` and `agent/skills/`.
  
  That mattered because the same run ends with the `skills` CLI printing *"Review
  skills before use; they run with full agent permissions."* Advice to review
  files the run never named, at paths it never showed, is advice a newcomer
  cannot act on — the wrong failure direction for a security-flavoured warning.
  
  The list could not have been correct where it stood: two of the three write
  phases belong to other processes, and the `skills` installer's destination set
  moves with **its** releases, not ours. Reading the directory afterwards makes
  the summary self-correcting instead. Large directories collapse to one line
  carrying their path, entry count and size, so the bulk stays reviewable without
  18,000 lines of output, and the paths the skills installer created are marked
  `⚠ skills` with the permissions warning tied to them.
  
  Same run, after the change: 20 entries printed, **0 written paths unreachable**.

### Patch Changes

- cec9d23: Fix `create-objectstack`'s startup banner hardcoding `◆ Create ObjectStack v6.x`
  regardless of the package's real, released version — eleven majors stale, on
  the first line of output a newcomer ever sees (#10325). The banner now calls
  `readCliVersion()`, the same reader `.version()` already used, instead of a
  literal string.
  
  Dropping the real version in without recomputing the box's padding would have
  reintroduced the same defect one line later — the border is a fixed run of
  `═` computed for the 4-character `v6.x`, and a longer real version (`v17.1.0`
  is 7 characters) would push the right border out of alignment (the sibling
  bug fixed in #10322, one function away in the same file). The box now derives
  its width from the version string's plain length and widens the frame — never
  truncates — for a version long enough to need more room; ordinary versions
  still render at the historical box size.
  
  No behaviour change beyond the printed banner.
- 3a3f209: Tell a newcomer that the `blank` starter ships no app, so an empty Console
  reads as the intended starting point rather than a broken install (#10317).
  
  Measured on a real scaffold-and-boot (`create-objectstack my-app -t blank`,
  published 17.1.0 packages, `objectstack dev --ui`): `GET /api/v1/meta/app`
  returns the two platform apps (Setup, Account) and nothing of the project's
  own, while `GET /api/v1/data/my_app_note` serves the scaffolded object the
  whole time. The template ships `src/objects/` only — deliberately, as every
  scaffolder template in this repo does — but nothing the newcomer could reach
  said so, and `pnpm dev` advertises the Console URL on every boot.
  
  Documentation only: a new "The Console" section in the generated `README.md`
  naming the Console path, the consequence, and `src/apps/*.app.ts` as the
  remedy. No change to what the scaffolder writes into `src/`.
- 7bf3fb7: Point every documentation link in these packages' published READMEs — and in
  the project `create-objectstack` scaffolds — at the canonical docs origin
  `https://objectstack.ai`, replacing the `docs.objectstack.ai` spelling.
  
  Both spellings reach the same pages (the alias redirects to the apex,
  path-preserving), so no link was broken. The reason it needs a release rather
  than an in-repo fix alone: a README ships inside the npm tarball, so the
  version already on npm keeps showing the old host to every reader of the
  package page until a new one is published.
- 675ab57: **First-run polish:** a brand-new scaffold's very first `pnpm install` no longer reports two unmet peer dependencies (#10326).
  
  Reproduced on a clean scaffold from published `create-objectstack@17.1.0` — no lockfile, `node_modules` removed, nothing configured by the user — and again on the second scaffold path, `objectstack init`. Both printed the same two:
  
  ```
  ✕ unmet peer better-call
    Installed: 1.4.0
    Wanted:
      1.3.7:
        @better-auth/scim@1.7.0-rc.1
  
  ✕ unmet peer better-sqlite3
    Installed: 13.0.3
    Wanted:
      ^12.0.0:
        better-auth@1.7.1
  ```
  
  Nothing was broken — but it is the first screen a newcomer sees, and there is nothing they did to cause it or can do about it.
  
  **`better-sqlite3`: the pin is right and the upstream range is stale — so it is widened, not corrected.** better-auth 1.7.1 declares `better-sqlite3` as an **optional** peer at `^12.0.0`, and it governs exactly one configuration: a raw better-sqlite3 `Database` handed to better-auth's `database` option, which its Kysely dialect then drives. ObjectStack never takes that path — `AuthManager.createDatabaseConfig()` returns `createObjectQLAdapterFactory(dataEngine)`, and every `better-sqlite3` use under `plugin-auth` is knex's `client: 'better-sqlite3'` beneath ObjectQL. Measured anyway on the configuration the range *does* govern: better-auth 1.7.1 with `database: new Database(':memory:')`, running `getMigrations().runMigrations()`, `signUpEmail`, `signInEmail` and adapter `findOne`/`update`/`delete`, is green on **better-sqlite3 13.0.3** and byte-for-byte equivalent on **12.11.1**. The same probe with `Database.prototype.prepare` neutered fails, so that green is the driver's and not an unexercised path. Pinning our own `^13.0.3` declarations back to `^12` would downgrade a native module across the platform to satisfy a range measurement shows is simply behind.
  
  **`@better-auth/scim`: the rc pin stays, and one `better-call` copy is the correct tree.** `npm view @better-auth/scim dist-tags` reads `latest: '1.7.1'`, but stable 1.7.x ships the rc.2 whole-model rewrite, so adopting it is a separate migration rather than a version bump; the exact `1.7.0-rc.1` pin is deliberate. The rc peers an exact `better-call@1.3.7` while better-auth 1.7.1 depends on `1.4.0` — and a better-auth plugin has to share the **host's** better-call instance, so the single 1.4.0 copy every install already resolves is right, not a skew to repair. This declaration retires together with the rc pin.
  
  **What changed, and what deliberately did not.** Both remedies are pnpm `peerDependencyRules.allowedVersions` entries, scoped `<declaring package>><peer>` so each widens exactly one declaration. They ship *inside* the scaffold — the bundled `pnpm-workspace.yaml` template and the one `objectstack init` renders — because a block in this repo's own workspace file does not travel with published packages. `allowedVersions` changes what pnpm **reports**, never what it resolves: measured on both scaffold paths, the lockfile is byte-identical with and without it (0 lines of diff), and no dependency version, range or resolution moved anywhere. This repo's own resolutions are untouched.
- e85182d: Converge the blank scaffold template's `README.md` docs links on the ruled
  canonical origin, `https://objectstack.ai` (maintainer ruling, 2026-08-21:
  「这个仓的文档站规范 URL 是 https://objectstack.ai」; enforced by
  `CANONICAL_DOCS_ORIGIN` in `scripts/check-published-readme-links.mjs`). The
  template previously linked the accepted-but-unratified `docs.objectstack.ai`
  alias in three places, which disagreed with the root `README.md`'s already-
  canonical spelling — so a single `npm create objectstack@latest` run handed
  the user two different hostnames for the same docs site.
- aea1e64: Fix the declared bin (`bin/create-objectstack.js`) being tracked non-executable
  in git. It carries a `#!/usr/bin/env node` shebang and is pnpm's link target
  for the `create-objectstack` command, but was committed `100644` instead of
  `100755` — matching the sibling declared bin `packages/cli/bin/run.js`, which
  was already tracked executable.
  
  Patch bump: this is a packaging-mode correction with no content, API or
  behavior change (the blob hash is identical) — it only fixes how the file is
  tracked in git and therefore how it is packed for npm.
- 818e027: Fix `objectstack init`'s closing "Created files" summary omitting `pnpm-lock.yaml` / `package-lock.json` and `node_modules/` (#10557).
  
  The summary used to be printed from a list accumulated while the template
  files were written — before `<pm> install` ran — so it could never name what
  the package manager wrote. `init` now prints it after the install attempt
  (succeeded or failed) from a walk of the finished project directory, reusing
  `create-objectstack`'s `created-summary.ts` (now published as the
  `create-objectstack/created-summary` subpath) instead of a second copy of the
  same renderer.
- 568de19: Scaffolded projects declare an explicit empty `packages: []` in their
  `pnpm-workspace.yaml` (#10933). Both scaffold paths render it —
  `renderPnpmWorkspaceYaml` in `objectstack init`, and the bundled `blank`
  template `npx create-objectstack` copies.
  
  The file was deliberately keyless so it would act purely as a settings file.
  That intent is now written down rather than inferred from a missing key, and
  writing it down is what fixes a first-command failure: pnpm 9.x and 10.0–10.4
  parse `pnpm-workspace.yaml` **before** they read `engines`, so they refused a
  brand-new project outright with
  
  ```
   ERROR  packages field missing or empty
  ```
  
  naming a file the user never wrote and giving no hint that the cause is their
  pnpm version — and no `engines.pnpm` floor could reach them, because they never
  got as far as the engines check. Measured, one clean install per pnpm version,
  each with its own store:
  
  | pnpm | before | after |
  |---|---|---|
  | 9.15.9, 10.0.0, 10.4.0 | `ERROR packages field missing or empty` | `ERR_PNPM_UNSUPPORTED_ENGINE`, naming `>=10.15` |
  | 10.5.0–10.14.0 | `ERR_PNPM_UNSUPPORTED_ENGINE` | unchanged |
  | 10.15.0, 10.34.5, 11.22.0 | installs | installs, byte-identical `pnpm-lock.yaml` |
  
  So every unsupported pnpm now reports the same actionable cause, and supported
  pnpm is unaffected: the empty key was measured equivalent to omission on
  10.15.0, 10.34.5 and 11.22.0 — identical lockfile bytes, identical
  `node_modules/.modules.yaml` once the run-local `prunedAt`/`storeDir` fields are
  dropped, identical `pnpm ls -r --depth -1`, and an identical second-install
  "Already up to date".
  
  The declaration is an **empty** list on purpose. `packages: ['.']` satisfies the
  same parsers but declares the project root a workspace *member* — a monorepo
  root — which a single-package scaffold is not, and which reads to the next
  author (human or AI) as an invitation to add member packages to an app.
  
  `engines.pnpm` is unchanged at `>=10.15`.
- 8d21f7a: Fix `create-objectstack`'s closing "Next steps" and install-failure remedy
  hardcoding `npm` regardless of which package manager the run actually used
  (#10322). `detectPackageManager()` already prefers `pnpm` and falls back to
  `npm` only when `pnpm` is unreachable — confirmed still true at HEAD, and
  confirmed empirically: a real run with `pnpm` on `PATH` installs with `pnpm`
  (`pnpm-lock.yaml`, "Done in … using pnpm vX") and then told the newcomer to
  run `npm run dev` / `npm run validate` next, a package manager the run never
  touched. The detected package manager is now read once, up front, and reused
  consistently for the install command, the install-failure remedy, and every
  line of "Next steps" — so the printed guidance always names the tool the run
  actually used, in both the `pnpm` and the `npm`-fallback case.
  
  Also names `validate` — the step the generated `AGENTS.md` calls
  unskippable — in the "Getting started" section of the generated `blank`
  template's README, not only in its later "Verify your changes" section, so a
  newcomer reading top-to-bottom sees it at first touch.
  
  No install behaviour changes: the scaffolder still installs by default and
  still supports `--skip-install`; this is a messaging-only fix.
- 9d101d2: Declare a pnpm floor (`engines.pnpm: ">=10.15"`) in the `package.json` both
  scaffolders write, so an unsupported pnpm reports its own version instead of an
  error about a file the user never wrote.
  
  Both scaffold paths emit a settings-only `pnpm-workspace.yaml` with no
  `packages:` key. Early pnpm 10 refuses that file outright — `pnpm install` exits
  1 with `ERROR packages field missing or empty` before resolving a single
  dependency, so a brand-new project could not be installed at all. Measured on
  the rendered shape, one clean install per pnpm version, each with its own store:
  
  | pnpm | before | after |
  | --- | --- | --- |
  | 10.0.0 – 10.4.0 | `packages field missing or empty` | unchanged — see below |
  | 10.5.0 – 10.14.0 | `packages field missing or empty` | `ERR_PNPM_UNSUPPORTED_ENGINE`, naming the expected range |
  | >= 10.15.0 | installs | installs |
  
  The floor is a diagnosis, not a repair: pnpm 10.0.0–10.4.0 parse
  `pnpm-workspace.yaml` *before* they read `engines`, so they still print the raw
  workspace error. Closing that remaining sliver requires deciding what a
  single-package scaffold should declare under `packages:`, which is tracked
  separately and deliberately not decided here.
  
  `engines.pnpm` rather than a `packageManager` stamp: npm, yarn and bun ignore
  `engines.pnpm` entirely, so the scaffold keeps working for all four package
  managers `objectstack init` hands off to. A `packageManager: "pnpm@x.y.z"` stamp
  would declare the project pnpm-only (corepack-driven yarn refuses to run in such
  a project) and pin one exact version that goes stale on every pnpm release — and
  it buys nothing on 10.0–10.4, which reach the workspace error before reading
  that field either.
  
  No existing project is affected; this only changes what a newly scaffolded
  `package.json` contains.
- 6d441e4: Correct the pnpm boundary the blank template states for `allowBuilds`, and gate
  the two scaffold paths against each other (#10498, #10499).
  
  `packages/create-objectstack/src/templates/blank/pnpm-workspace.yaml` is copied
  verbatim into every scaffolded project, so its header comment is prose that
  ships **inside the user's own repository**. It said `allowBuilds` needs
  pnpm >= 10.31 and that `onlyBuiltDependencies` covers pnpm 10.0–10.30. Measured
  on a probe depending on `esbuild@0.28.2`, with a workspace file carrying only
  `allowBuilds`, one clean install per pnpm version and each with its own
  `--store-dir` (isolation matters — pnpm's side-effects cache will otherwise hand
  a later run a build an earlier run performed, and it reads as "the key worked"):
  
  | pnpm | `allowBuilds` alone |
  |:--|:--|
  | 10.15.0 – 10.25.0 | ignored — build not run |
  | **10.26.0** | **honoured — build ran** |
  | 10.28.0 – 10.33.0 | honoured — build ran |
  
  So the floor is 10.26.0 and the older-key band is 10.0–10.25. A user on pnpm
  10.28 was being told by the file in front of them that their pnpm cannot read
  the key it is in fact reading. Both load-bearing claims in that comment were
  correct and are unchanged: both keys are needed, and pnpm 11 reads only
  `allowBuilds`. No setting, no assertion and no install behaviour changes — the
  rendered `onlyBuiltDependencies` / `allowBuilds` values are byte-identical.
  
  The reason it was wrong for so long is the second half of this change.
  `objectstack init` renders the same file from `renderPnpmWorkspaceYaml()` in
  `packages/cli`, it was corrected to the measured numbers separately, and each
  package's ratchets are package-local — so neither could ever fail for the other
  file's regression, and the two scaffold paths shipped contradictory prose about
  the same rule with every gate green. `packages/cli/test/scaffold-workspace-consistency.test.ts`
  now compares the two **rendered outputs**: the packages each key actually grants
  a build to, and the pnpm versions each file actually names for each key. It was
  confirmed failing against the live divergence before this correction landed.
  
  Bumped `patch` rather than left out: the corrected text is user-visible — it is
  delivered into every new project — while nothing executable moves.
- ecd06f6: Rewrite the scaffolded project's starter comments so a newcomer can actually
  follow them (#10324). `objectstack.config.ts` and `src/objects/note.object.ts`
  are the first two files opened after scaffolding, and between them they cited
  four ADR identifiers, one bare issue number and the path of a release-time
  script in this monorepo — none of which ship in, or are linked from, a
  scaffolded project. `// per ADR-0097` read as a reference the reader was
  failing to follow rather than as the context it was meant to be.
  
  The explanations are kept and made self-contained; only the dead ends are
  gone. Each now states the fact the identifier stood for — the protocol range
  is checked before anything loads and was stamped to match the installed
  version rather than hand-tuned; `automation` must stay whenever `plugins:`
  lists a connector or the executors have nowhere to register; a declarative
  `mcp` stdio transport is denied by default; the org-wide default is required
  so the baseline is an authored decision — and points at the public docs page
  that covers it in full. The blank `Dockerfile` likewise stops pointing at a
  file in this repo and points at the self-hosting guide it already links.
  
  A pin (`starter-comments-self-contained.test.ts`) keeps it that way from both
  sides: no shipped template file may cite an ADR identifier, a bare issue
  number or a repo script path, and the facts those references carried must
  still be stated — so the comments cannot be "fixed" by deleting them. It also
  resolves every canonical-origin docs URL in the shipped tree against
  `content/docs`, because a link that 404s is the same defect one level out.

## 17.1.0

### Minor Changes

- 1eb28a1: Retire the five remote content templates from the scaffolder's catalog.
  
  `todo`, `compliance`, `content`, `contracts` and `procurement` were delisted
  from the official ObjectStack template marketplace and are no longer
  maintained, but the CLI carried its own hardcoded catalog and never learned
  that: `--help` recommended all five by name with marketing descriptions, and
  the `Available:` line on a bad `-t` offered them too.
  
  - `blank` (bundled, offline) is now the whole catalog, so the help text
    advertises only what is actually supported.
  - Asking for one of the five by name — `-t todo` in an old script or tutorial —
    is refused with a message that says the template was retired, instead of the
    generic "Unknown template" error that reads as a typo.
  - The GitHub tarball-fetch path that served the remote templates is removed
    along with its `tar` dependency; nothing else reached it.
  
  Note this corrects the catalog at HEAD only. Already-published versions keep
  advertising the retired templates until a new version of `create-objectstack`
  is released.

### Patch Changes

- 4906c90: Fix scaffolded projects describing themselves as the blank template (#9263)
  
  `rewriteProjectIdentity` rewrote `id` / `namespace` / `name` in both
  `objectstack.config.ts` and `objectstack.manifest.json` from the project name,
  but left `description` untouched — every scaffolded project carried the blank
  template's own line verbatim ("Minimal ObjectStack environment — a clean
  slate for building."), confidently wrong rather than empty, and printed by
  the first command the getting-started flow tells people to run (`os
  validate`).
  
  The scaffolder now drops `description` from both files instead of rewriting
  it. There is nothing but the project name to derive a replacement from, and a
  name-derived sentence (e.g. "Support Desk — an ObjectStack environment.")
  would be a bare restatement of the `name`/`displayName` row already shown —
  worse than no sentence at all. `os validate` already omits the description
  line entirely when the field is unset, so a freshly scaffolded project now
  prints cleanly:
  
  ```
    Support Desk v0.1.0
  ```
  
  instead of
  
  ```
    Support Desk v0.1.0
    Minimal ObjectStack environment — a clean slate for building.
  ```
- f2f09e4: fix(create-objectstack): the scaffolded Dockerfile pins the runtime image to the CLI that builds the artifact, instead of `latest` under a comment saying to pin (#9017)
  
  `src/templates/blank/Dockerfile` shipped `FROM ghcr.io/objectstack-ai/objectstack:latest`
  directly beneath a comment instructing the reader to "pin the tag to the
  `@objectstack/cli` version in your package.json so the runtime matches the CLI that built
  the artifact" — an instruction the scaffold itself did not follow. Every app made with
  `npx create-objectstack` shipped that contradiction from day one, and `docker/README.md`'s
  tag table already scopes `latest` to quick starts while documenting `X.Y.Z` as the
  production pin.
  
  Measured on scaffolded output rather than the template's bytes, before the fix:
  
  ```
  emitted package.json cli range : ^17.0.0
  emitted Dockerfile FROM        : FROM ghcr.io/objectstack-ai/objectstack:latest
  agreement (tag vs cli range)   : DISAGREE
  ```
  
  **The tag is resolved after `install`, from the installed CLI — not from the generated
  `package.json`.** That file carries a caret RANGE, and the two are not interchangeable:
  npm resolves `^17.0.0` to the newest 17.x, so pinning the range's floor would ship a
  runtime image *older* than the CLI that built the artifact — breaking the same promise in
  a new way. The rolling `:17` tag does match the range's float window but is exactly what
  the tag table tells production not to use. The resolved version is the only value that
  makes the sentence true, and it is the rule the repo already applies for this purpose in
  `.github/workflows/scaffold-e2e.yml` ("Pin the runtime's CLI to the SAME version the
  generated project actually resolved to — NOT a hardcoded `latest`").
  
  **Both halves move together.** Pinning the line while leaving an imperative to pin by hand
  would relocate the contradiction rather than remove it, so the comment above the `FROM`
  line is replaced in the same rewrite. With `--skip-install` there is no resolved version:
  the tag stays `latest` and the comment keeps telling the reader to pin — which is true on
  that path, because there the user really must do it by hand.
  
  The regression proof asserts on **scaffolded output**, never on the template: it scaffolds
  with the real copy/sync/pin path, plants an installed CLI whose version is deliberately
  *not* the range's floor (the normal case, and the one that a package.json-derived tag
  would get wrong), and checks the emitted `FROM` tag against the emitted `package.json`
  range with a satisfies-check rather than equality.
  
  `.github/workflows/scaffold-e2e.yml` now reads the tag it builds its local runtime image
  under **out of the generated Dockerfile** instead of hardcoding `:latest`. Those were two
  hand-matched literals; had they skewed, Docker would have quietly pulled the last
  published image instead of the one built from this checkout, and the job's own stated
  hermeticity would have been false while it stayed green.
- 0a5adba: fix(create-objectstack): the blank template's `specVersion` stops shipping eleven majors stale, and the version-time sync covers every declared surface on every template (#9264)
  
  The one bundled template declared the platform it targets in **two** places that
  disagreed by eleven majors:
  
  | file | key | was |
  |:--|:--|:--|
  | `objectstack.manifest.json` | `specVersion` | `^6.0.0` |
  | `objectstack.config.ts` | `engines.protocol` | `^17` |
  
  `scripts/sync-template-versions.mjs` re-stamped the config key and the template's
  `@objectstack/*` dependency ranges, and **never opened the manifest at all**. So
  `engines.protocol` tracked every major bump while `specVersion` sat at the value
  it held when the script was written — and a green `sync-template-versions` run
  was never evidence about it, because the script's failure mode was loud for the
  keys it covered and mute for the key it did not.
  
  **This is not confined to the registry contract.** `create-objectstack` copies
  the manifest into every scaffolded project, rewriting `name`, `displayName` and
  `namespace` and dropping `description` — it has never touched `specVersion`. So
  every project scaffolded since v7 was stamped with a `^6.0.0` spec range while
  installing `@objectstack/spec@^17.0.0`.
  
  **The two keys are two facts, and the fix keeps them apart.** `engines.protocol`
  is the ADR-0087 D1 runtime handshake range and carries the protocol major
  (`^17`). `specVersion` is documented by `TemplateManifestSchema` as the
  "Compatible `@objectstack/spec` semver range" and carries the package range
  (`^17.0.0`) — the same value the script already writes into the template's own
  `@objectstack/spec` dependency, so the manifest and the `package.json` now state
  one fact once. They agree on the major only because the spec package's major and
  the protocol major are kept in lockstep; they are stamped from two different
  values.
  
  Deleting the key was not available: `specVersion` is **required** by
  `TemplateManifestSchema`, and every shipped manifest is parsed against it by
  `check:template-manifests`.
  
  **Two structural changes, because one-key-one-file coverage is what let this
  sit:**
  
  - the sync script's file list is now **discovered**, not hard-coded — templates
    are found by walking `src/templates/`, the same way `check-template-manifests`
    finds the manifests it parses, so a second template is covered on the day it
    lands;
  - **every stamp is required**. A template whose file is missing, whose stamp is
    absent, or whose `package.json` declares no `@objectstack/*` dependency is a
    hard failure naming the path — never a skip. A skipped stamp is
    indistinguishable from a synced one in the log, which is the invisibility this
    fixes.
  
  The manifest is rewritten as **text** rather than parsed and re-serialized:
  `objectstack.manifest.json` keeps `scaffold.variables` compact on one line, and
  `JSON.stringify(…, null, 2)` would reformat unrelated structure on every release.
  
  CI coverage lands as four per-template ratchets in `template-consistency.test.ts`,
  generalized off `blank` onto the same directory walk — including the invariant
  that catches this exact class: the manifest's `specVersion` must equal the
  `@objectstack/spec` range the template actually installs. Either file alone can
  be self-consistently stale; only comparing them catches a stamp that covered one
  and not the other.

## 17.0.0

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

- 4e9e184: chore(deps): OSV security batch — bump tar to ^7.5.21 (GHSA-r292-9mhp-454m) and
  js-yaml to ^5.2.2 (GHSA-pm4m-ph32-ghv5)

  Both are declared-range bumps to the patched releases, so downstream installs
  resolve the fixed versions from the published manifests, not just this
  workspace's lockfile. The same batch clears the remaining transitive advisories
  (next 16.2.11 in apps/docs; workspace overrides for brace-expansion, sharp,
  react-router, @sveltejs/kit, @hono/node-server) — those live in pnpm-workspace.yaml
  and the private docs app, which do not ship.

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
