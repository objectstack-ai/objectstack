# ObjectStack — AGENTS.md

Primary AI instruction file for this repo — and the human contributors' source of truth.
Read natively by Claude Code, GitHub Copilot (coding agent + CLI), and other agents — no
separate `.github/copilot-instructions.md` mirror needed. When any other instruction file
in this repo (including `.claude/skills/**`) conflicts with this one, **AGENTS.md wins**.

> **v5.0 breaking rename: `project` → `environment`** everywhere (CLI `-e`, `/api/v1/environments/:id`, header `X-Environment-Id`, `OS_ENVIRONMENT_ID`, DB column `environment_id` [control-plane tables; on the metadata tables since deprecated in favour of `organization_id`, ADR-0006 v4]). No aliases. See ADR-0006. "Project" now only means the npm/monorepo sense.

This file carries principles, binding rules and lookup tables — rules only. A rule states
what to do and what never to do, in one executable sentence; it carries no incident
narrative, no ruling date or quotation, and no issue-number citation
(`pnpm check:pm-skill-id-lint`) — a rule's provenance lives in the PR that landed it. Where
a hook or CI gate enforces a rule mechanically, the rule is stated once here and the
script's own header is the authority on detail.

---

## Communication

语言规则分两件事:**和维护者说话用什么语言**,与**留在 GitHub 上的产物用什么语言**。
一条规则一个通道,互不重叠。

- **在 Claude Code 中与维护者对话一律使用中文**(对话回复、轮次报告等聊天通道里的内容)。
- **GitHub 产物一律使用英文**:issue 与 PR 的标题、正文、评论。
- **引用中文裁决时保持原文、不翻译**,即使承载它的 issue/PR 正文通篇是英文——改写引文
  就是改写裁决。
- 代码、标识符、提交信息(commit messages)、ADR/文档正文等仓库产物保持现有语言惯例(以英文
  为主),不要因本节而改写。

---

## Build & Test

```bash
pnpm install          # deps
pnpm setup            # first-time: install + build spec
pnpm build            # turbo build (excludes docs)
pnpm test             # turbo test
pnpm typecheck        # turbo typecheck — per-package `tsc --noEmit`; tsup/vitest never type-check
pnpm docs:dev         # docs site
```

**No formatter of record — `pnpm lint` is the only style authority** (eslint, `eslint.config.mjs`).
Prettier is deliberately absent: no `.prettierrc*`, no `format` script, nothing invokes or installs
it. ⛔ Never `prettier --write` a file you touch — its double-quote default against this
single-quoted codebase rewrites every string literal. Its `--check` verdict is no second opinion on
your edit either: it warns on pristine `main` content, and passes over zero files at an
out-of-repo path.

**⛔ Push a WIP commit before every step that takes minutes** — a build, a full test run, a
gate sweep, an ablation — because the working tree is otherwise the only copy of your work.

Type-check coverage and its debt counts are ratcheted in CI
(`pnpm check:type-check-coverage`, `pnpm check:type-check-debt`; the script headers are
the authority on detail): every package declares a `typecheck` script or carries a
measured, shrink-only DEBT/EXEMPT ledger entry; new packages arrive covered; a package
that graduates deletes its entry in the same PR; when a re-measure forces a count up,
rewrite the entry's `note` too — a note naming only the old errors reads as "nearly
graduated" to the next author.

Three principles the ratchet's invariants encode:

- **A package's `tsconfig.json` reaches every `*.test.ts` / `*.spec.ts` in it** —
  `tsc --noEmit` reads that config, so a test it misses is hidden from the very check
  the `typecheck` script advertises. `check:type-check-coverage` fails both spellings
  per file: an `exclude` naming it, an `include` that never does. A sibling
  `tsconfig.test.json` named in the `typecheck` script may carry its own *module*
  semantics for vitest, never its own *strictness*.
- **A `@ts-expect-error` in a file no tsc program compiles is a phantom check** — it
  evaluates never, and deleting it leaves every gate just as green. Before writing
  one, check the file is compiled. Test-layer residue lives in the per-file,
  shrink-only `<package>/test-typecheck-debt.json` (regenerate with
  `pnpm --filter <package> gen:test-typecheck-debt`); the shared gate is
  `scripts/check-test-typecheck.mts --package <dir>` — onboard by wiring, never by
  copying.
- **A pile of TS7006 "implicitly any" is usually one broken import upstream**, not a
  package that needs annotations: under `moduleResolution: NodeNext` a relative import
  missing its `.js` extension does not resolve and every symbol it names becomes
  `any`. Fix the extension first and re-measure.

### A test that reads outside its own package must be spelled so the gate can see it

`pnpm check:cross-package-test-inputs` keeps CI's idea of a test's inputs equal to its
real inputs: a test whose reads escape its package is invisible to both
`turbo ls --affected` and the `test` task's input hashing, so a pin written to catch
cross-package drift sits green through exactly the drift it exists to catch. The gate
finds those tests by scanning source text, so it sees only the spellings it knows, and an
unrecognised one produces no flag — no declaration, silently. Seed from
`import.meta.url`, `__dirname` or a `findUp` walk, and write the escaping path as one of:

```ts
const HERE = dirname(fileURLToPath(import.meta.url));   // seed (ESM)
const HERE = __dirname;                                  // seed (CJS)
const HERE = import.meta.dirname;       // and dirname(import.meta.filename)
const HERE = resolve(fileURLToPath(import.meta.url), '..');  // seed, walked
                                        // from the FILE instead of named;
                                        // import.meta.filename works too
const P = resolve(HERE, '<rel>');       // join() and the path.* forms too
const P = fileURLToPath(new URL('<rel>', import.meta.url));
const P = new URL('<rel>', import.meta.url);
readFileSync(resolve(HERE, '<rel>'))    // the same expressions in argument
readFileSync(new URL('<rel>', import.meta.url))              // position
const PKG = findUp((dir) => JSON.parse(readFileSync(join(dir, 'package.json'))).name
                           === '<the name of THIS package>');   // -> package root
const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));
                                        // -> repo root
  ⛔ NOT a manifest name belonging to some OTHER package -- that root cannot
     be located from here, so the escape is flagged and the path is NOT named
```

The gate prints this list in its failure text, and `check-published-list-mirrors` holds
the block above equal to it; this file is governed, so that gate can only ever go red.
Need a spelling that is not here? **Extend the detector, add a `--self-test` case, and
correct the block in the same edit** — ⛔ never route around it.

Two things it deliberately does not flag: a path that climbs out and lands in
`node_modules` (an installed dependency is not a repo source input), and a path that
climbs out and comes straight back in. What it does flag is judged on the **shallowest**
point a path reaches, not where it ends.

Clocked windows measure behaviour, never loading — a test that boots a real plugin chain
pays its first load at module top; `pnpm check:test-source-alias` gates it.

### Running the dev server

| Scenario | Command | Notes |
|:---|:---|:---|
| **Frontend debug** (UI in `../objectui` calls backend) | `PORT=3000 pnpm dev` | `pnpm dev` = the **showcase** kitchen-sink app (default; best for exercising the platform). Port **must** be 3000 (UI hard-wired); persistent state; leave running. For the minimal CRM app instead: `PORT=3000 pnpm dev:crm`. |
| **Backend-only debug** | `pnpm dev -- --fresh -p <random>` | Random high port; ephemeral tempdir; **you must kill it** when done |

`--fresh`: ephemeral tempdir (auto-deleted on exit) + `--seed-admin` (POSTs sign-up, prints creds — default
`admin@objectos.ai` / `admin123`, override via `--admin-email`/`--admin-password`). The seeded admin is auto-promoted to
**platform admin** (the system seed identity `usr_system` is skipped), so Setup/Studio are reachable on first login.

Rules: never run two backends on port 3000; for backend tasks pick a random port and tear it down; **never kill a
server you didn't start** (see Multi-agent discipline §8); always use a `pnpm dev`/`dev:crm`/`dev:showcase` script,
not raw `pnpm --filter`. pnpm forwards the `--` separator itself into the child's argv, so this spelling only works
where the receiving CLI tolerates a leading `--`. ⛔ Do not carry it over to test commands — vitest silently
discards everything after a bare `--` (`.claude/agents/os-dev.md` → Toolchain traps).

```bash
pnpm dev:crm -- --fresh -p 38421   # start; debug via curl
kill $(lsof -ti tcp:38421)         # tear down — tempdir auto-deletes
```

### Frontend (Studio UI) — sibling repo `../objectui`

This repo ships **backend only**. All Studio/Console UI work happens in `../objectui` (separate repo, checked out next
to `framework/`). Workflow: edit + commit + push in `../objectui`, then in `framework/` run `pnpm objectui:refresh` to
pull its build into `packages/console/`.

Other scripts: `objectui:bump` (pull only), `objectui:build`, `objectui:clean`. ⛔ Never hand-edit
`packages/console/dist/` or `.cache/objectui-*/` — regenerated.

**Moving the pin has a second half: `pnpm sdui:manifest`.** ADR-0082 D4's spec↔registry declaration-parity ratchet
reads objectui's `sdui.manifest.json`, which changes only when `.objectui-sha` moves — so the pin bump is the
ratchet's trigger, and its only one. It is an **on-demand gate by decision**, never a CI job; `objectui:bump` and
`objectui:refresh` both print the reminder. Needs Playwright chromium. Full procedure: `docs/releases-maintenance.md`
→ "After the pin moves".

**Fast iteration on `../objectui` src (no commit/refresh loop):** run objectui's own console dev server —
`cd ../objectui && pnpm --filter @object-ui/console dev` (Vite on **:5180**, HMR). Its `/api` proxy targets
`DEV_PROXY_TARGET || http://localhost:3000`, so **run the backend you're testing on :3000** (`PORT=3000 pnpm dev` for
showcase) and browse `:5180`. Note `:3001/_console` (or whatever the backend serves) is the **published** console, not
your `../objectui` src — only `:5180` reflects local UI edits. See `../objectui/AGENTS.md` for the app-id /
localStorage / auth gotchas.

---
## Prime Directives

1. **Zod First.** All schemas start as Zod. Types via `z.infer<typeof X>`. JSON Schemas generated from Zod.
2. **No business logic in `packages/spec`.** Spec = schemas/types/constants only. Runtime logic goes in `core`,
   `runtime`, or `services/*`.
3. **Naming:**
   - TS config keys → `camelCase` (`maxLength`, `defaultValue`)
   - Machine names (data values) → `snake_case` (`name: 'first_name'`)
   - Error codes → `SCREAMING_SNAKE` (`PERMISSION_DENIED`) — machine constants, not data values; scope and rationale
     in [ADR-0112](./docs/adr/0112-error-code-vocabulary-and-ledger.md). Not a general license to deviate.
   - Metadata type names → **singular** (`'agent'`, `'view'`, `'flow'`) — matches `MetadataTypeSchema` in
     `packages/spec/src/kernel/metadata-plugin.zod.ts`
   - REST endpoints → plural (`/api/v1/ai/agents`)
4. **Imports:** Use `@objectstack/spec` namespaces or subpaths. Never relative `../../packages/spec`.
5. **No workarounds.** Adopt sustainable, well-architected solutions — not temporary patches.
6. **Object name = table name.** The object `name` is the canonical id everywhere (API, ObjectQL, REST, SDK, DB table).
   **Never** set `namespace` (deprecated) or `tableName` (always equals `name`). For module prefixes, embed in the name
   (`sys_user`, `ai_conversations`).
7. **One Zod source per metadata type.** Each type (`view`, `flow`, `agent`, …) has exactly one schema in
   `packages/spec/src/{domain}/`. Org overlay opt-in lives only in `allowOrgOverride` on
   `DEFAULT_METADATA_TYPE_REGISTRY` — no parallel whitelists. See ADR-0005.
8. **North Star alignment.** Read `content/docs/concepts/north-star.mdx` before structural changes. If a change doesn't
   advance §7 Built, shrink Drift, or unlock Missing — it probably shouldn't ship.
9. **`OS_` env-var prefix + structure.** All ObjectStack-owned env vars MUST start with `OS_`, then follow
   **`OS_{DOMAIN}_{FEATURE}[_QUALIFIER]`** where `DOMAIN` is the subsystem (`AUTH`, `SEARCH`, `CORS`, `CLOUD`,
   `DATABASE`, `CLUSTER`, `MCP`, `SSO`, …) so related vars group together (cf. `OS_AUTH_*`, `OS_CORS_*`). Pick the
   shape by what the var *is*:
   - **Boolean feature flag** → suffix **`_ENABLED`**, default-off / opt-in: `OS_{DOMAIN}_{FEATURE}_ENABLED`
     (`OS_SSO_ENABLED`, `OS_SCIM_ENABLED`, `OS_SEARCH_PINYIN_ENABLED`). Never a bare `OS_PINYIN_SEARCH` — bare names
     read as config, not toggles.
   - **Config value** (URL / path / secret / level / count) → `OS_{DOMAIN}_{NAME}` (`OS_CLOUD_URL`, `OS_DATABASE_URL`,
     `OS_LOG_LEVEL`, `OS_AUTH_SECRET`).
   - **Escape hatch / dangerous override** → **`OS_ALLOW_{X}`** — deliberately ungrouped and scary-looking
     (`OS_ALLOW_MAIN_EDITS`, `OS_ALLOW_MEMORY_CLUSTER_MULTINODE`).
   - **Opt-out** → `OS_SKIP_{X}` / `OS_DISABLE_{X}`. **Test/CI-only** → `OS_TEST_*` / `OS_EXPECT_*`.
   - Pre-existing vars that don't fit (`OS_METADATA_WRITABLE`, `OS_EAGER_SCHEMAS`, `OS_SERVER_TIMING`) are **debt, not
     precedent** — new vars follow this rule; rename old ones via the deprecation helper below when touched.

   When renaming a legacy var, use `readEnvWithDeprecation('OS_NEW', 'LEGACY')` from `@objectstack/types` (keeps legacy
   working one release). Third-party exceptions kept as-is: `NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
   `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`, `AI_GATEWAY_*`, `SMTP_*`.
10. **File an issue for a reproducible defect, a contract violation, or a metadata-authoring trap; note everything
    else in the PR's acceptance notes — never expand scope, never bury a defect.** A card names its evidence (repro,
    contract text or trap); the reviewer files a note that is one. Corollary: **never advertise or demo a capability the
    runtime doesn't actually deliver** (declared ≠ enforced) — fix it, trim it, or file an issue, but don't fake
    coverage. Trim what can never be enforced, implement the rest, and keep the claim as narrow as the enforcement:
    a `case` label is not enforcement; check every **call site**, bulk paths included.
11. **Worktree-first — never edit on the shared `main` checkout.** This repo is edited by **multiple agents at once**;
    the shared tree has its HEAD switched and reset *under you*, silently clobbering uncommitted work — a feature
    branch on the *shared* checkout is **not** enough. Before your **first file edit**, be in a dedicated worktree on
    a feature branch: `git fetch origin main && git worktree add --no-track ../objectstack-<task> -b <branch>
    origin/main && cd ../objectstack-<task> && pnpm install`. Two PreToolUse hooks **enforce** this —
    `.claude/hooks/guard-main-checkout.sh` blocks `Edit`/`Write`/`NotebookEdit`, and
    `.claude/hooks/guard-main-checkout-bash.sh` blocks the identical write arriving through **Bash** (`>`/`>>`
    redirection, `sed -i`, `perl -i`, `tee`, `cp`, `mv`, `rm`, `touch`) — and both check the **target file's own
    repo**, so sibling repos (`objectui`/`cloud`) you touch are covered too (deliberate non-task override:
    `OS_ALLOW_MAIN_EDITS=1`, one switch for both). The Bash guard is precision-first: it never blocks reads, and any
    shape it cannot resolve with confidence (`bash -c …`, `xargs`, `node -e`, a `$VAR`/glob target) is allowed through
    — the rule still outranks the hook. **A worktree isolates neither the stash nor the build cache** — the
    third hook (`guard-shared-stash.sh`, `OS_ALLOW_STASH=1`) and the replacements live in Multi-agent discipline below.
12. **Contract-first — fix the metadata, not the runtime.** `packages/spec` is the one contract between metadata
    *producers* and the runtime/renderers that *consume* it. When a piece of metadata "doesn't work," ask **first**:
    *is it spec-compliant? is this the long-term-correct direction?* If the metadata is wrong, fix it at the
    **producer** and **reject it at authoring/publish** (validation / lint) so the error surfaces loudly — ⛔ never
    add a lenient alias or `??` fallback in a consumer (a node executor, the REST layer, a renderer) to tolerate
    off-spec input: one strict contract beats N dialects, and this is an **internal** contract (we own both ends), so
    "be liberal in what you accept" does **not** apply. Change the **spec** only when the spec itself is genuinely
    wrong, and then deliberately (edit the Zod schema + migrate). When an alias must be tolerated at all, declare it
    as an **ADR-0087 conversion-layer entry** (never a bare `??`, no executor shims) so it is declared, loud, tested,
    and *removable on a schedule*. Stored `sys_metadata` rows are covered from the other side: every rehydration seam
    replays the **full** conversion chain — retired entries included — via `applyConversionsToStoredItem` (ADR-0087
    addendum), so a consumer never needs its own accommodation for a legacy stored shape either. Strengthens #5.
13. **An accepted ADR binds until a superseding ADR says otherwise.** Reversing a recorded decision is itself a
    decision: it needs a **new ADR** (or an amended status line on the old one), not a changeset that quietly does the
    opposite. Before changing behaviour in `docs/adr/`-governed territory, **grep the ADRs for the surface you are
    touching** — the file you are editing may not name the decisions that govern it. Corollary: when you implement an
    ADR's decision, **leave its id in the code**, and anchor load-bearing spots in `scripts/adr-anchors/`
    (`pnpm check:adr-anchors`) — **one new JSON file per anchor, named for the path it anchors; there is no index to
    register it in**. A decision nobody can find is a decision that will be reversed.
    **An ADR lives in the repository whose code it governs.** Decisions that draw the open/closed or commercial
    boundary live in `objectstack-ai/cloud` and are cited from this repo as `cloud ADR-NNNN` — ⛔ never as a bare
    number, which `scripts/check-adr-anchors.mjs` resolves against *this* registry (the two number independently).
    When a cloud decision's **mechanism half** governs open code here, this repo carries its own ADR — own number, a
    `## Provenance` section naming the cloud record and its date, the commercial half left in cloud — and the cloud
    record gains a one-line pointer. Files never move between registries and numbers are never reassigned.
14. **⛔ A governed surface is confirmed and merged by the maintainer, by hand — no AI seat merges, queues, or arms
    auto-merge on a PR whose diff touches one.** The governed surfaces are `docs/adr/**`, `.claude/**` (agents, hooks
    and settings — not only skills), `skills/**`, `AGENTS.md` and `CLAUDE.md` — the file you are reading is one
    — and a mixed diff is governed whole on a single path hit. The register is the `GOVERNED_SURFACES` table in
    `scripts/pm/check-governed-merges.mjs`; adding a surface is an edit *there*, never here, and `pnpm
    check:pm-governed-prose` reds per-PR when this paragraph names fewer surfaces than the register — or more. When
    it reds, name the surface **in this paragraph**. Print today's set rather than trusting this paragraph:
    `node -e "import('./scripts/pm/check-governed-merges.mjs').then(m=>console.log(m.GOVERNED_SURFACES.map(s=>s.glob).join(' · ')))"`

    **Authoring stays open to every seat** — drafting the ADR, the skill or the instruction edit, pushing the
    branch, opening the PR, revising it under review. What is reserved is the **landing**: on any PR whose diff
    touches a governed surface, ⛔ never merge it, ⛔ never add it to the merge queue, ⛔ never call
    `enable_pr_auto_merge`, ⛔ never flip it out of draft to make any of those possible. Judge it on the PR's **file
    list**, not on its description, and a **mixed diff is not a proportion question** — one path hit is enough; if
    the rest needs to land, split the governed files into their own PR. **Those four lift only for an authorized
    APPROVED review** — by an account in `GOVERNED_APPROVERS` (`scripts/pm/check-governed-queue-guard.mjs`), on ANY
    commit; the queue then lands it. A later push does not expire that approval, and this gate does not re-review it.
    Hand-authored governed content needs that approval; a PR whose only governed paths are register rows the queue leg
    regenerates byte-exact clears with zero approvals — an uncertified recompute, drift or a hand-authored sibling
    keeps it governed. Unapproved, the bypass direct merge (人工直合) is the only landing. ⛔ **No agent seat
    submits an approving review on a governed-surface PR, under any account** — an authorized account is
    agent-operated too. Nothing else substitutes — "CI is green" carries no information about a governance change.

    **Already armed or queued when you read this?** Converting the PR back to **draft** is the only action that
    reliably removes it from the merge queue; `disable_pr_auto_merge` alone drops the arming but **not** queue
    membership. Do both, then confirm from the remote that it is in neither the queue nor `origin/main` (§7's
    draft-flip re-arm note, run backwards). **Do not read draft as a barrier that holds by itself — the barrier is
    this directive**, and a human merge IS the review record — ⛔ not a relaxation. Behind the directive sit
    prevention and detection: the queue guard refuses an unpinned governed diff in the queue; `docs/adr/` in
    CODEOWNERS routes review requests — the *only* governed surface routed there, so on the other four nothing
    summons the maintainer automatically; the report-only post-merge audit (`scripts/pm/check-governed-merges.mjs`)
    lists every governed-surface merge with its approver and merger for the PM round report — a merger the
    maintainer does not recognise, or any agent approval, is a seat violation, filed and rolled back. The rule has no
    exception for a seat to judge.

15. **⛔ A version release is performed by the maintainer, by hand — no AI seat publishes, tags, cuts a Release, or
    triggers a release workflow, and none merges the Version Packages PR.** A rule that binds every seat lives here,
    not only in a lane-specific skill file. **Release-adjacent work stays open to every seat**: the release board,
    `.objectui-sha` pin bumps, version reconciliation, writing changesets, compiling release notes when asked, and
    *verifying* release state (`npm view`, `git ls-remote --tags`) are ordinary tasks. What is reserved is the
    **release act itself**: ⛔ running `changeset publish` / `pnpm run release`, ⛔ pushing a version tag, ⛔
    cutting a GitHub Release, ⛔ pushing a runtime image, ⛔ `workflow_dispatch`-ing `release.yml` or any other
    publish-capable workflow, ⛔ **approving a pending `release` environment deployment** (ADR-0125: that click IS
    the publish authorisation, and a deployment waiting for hours is the system working, not a state you clear), and
    ⛔ merging — or queueing, or arming auto-merge on — the **Version Packages** PR (`chore: version packages`).
    That PR is bot-authored and standing-open by design: it is regenerated six-hourly by `release.yml`'s `version-pr`
    job — never on a push to `main`; push drives the publish lane — so "green, current, and nobody has objected"
    is its permanent resting state, not a signal that it is due. When you find a publish nobody ordered — a tag or
    an npm version that simply appeared — ⛔ do not "repair" it with a counter-publish: file it as an incident for
    the maintainer.

    **The existence of a path to a release is not authorization to walk it, and the YAML is not a barrier that
    holds against you.** The publish job is triggered by the **push that lands the Version Packages PR** and held at
    `environment: release` until a required reviewer approves — a **repo setting** no file here can assert. So
    merging `chore: version packages` is the release trigger: it **queues a deployment in the maintainer's name** —
    the single most load-bearing prohibition in this directive.

---
## Multi-agent working discipline

This repo is worked on by **multiple agents in parallel**, one worktree per task —
mandatory, hook-enforced, and specified in **Prime Directive #11**. What it does not cover:

**⛔ `git stash` is the sharpest thing the worktree does NOT isolate — never run a bare
`git stash push`/`pop`.** `refs/stash` lives in the **common** `.git` directory, so every
linked worktree pushes onto and pops off **one shared LIFO stack**: your `pop` restores
another agent's changes, your own work stays on the stack for them to take, and `pop`
reports success — the only symptom is another agent's files in your `git status`, and a
following `git add -A` commits their work into your PR. A PreToolUse hook
(`.claude/hooks/guard-shared-stash.sh`; details and the `OS_ALLOW_STASH=1` escape in its
header, self-test alongside) blocks the mutating forms — including `stash@{N}`, a
*position* in a stack you don't own — allows `list`/`show`/`create` and `apply`/`store`
pinned to a literal hex object id, and fails open on shapes it cannot parse, so the rule
still outranks the hook. The collision-free replacements, all inside your own worktree:

```
git diff > /tmp/wip.patch && git checkout -- <paths>    # then: git apply /tmp/wip.patch
git commit -am wip                          # then: git reset --soft HEAD~1
git worktree add ../objectstack-<task>-cmp <ref>        # a second tree to compare against
```

**⛔ The stash is one CASE — a worktree isolates your checkout and exactly four ref
namespaces (`HEAD`, `refs/bisect`, `refs/worktree`, `refs/rewritten`) and NOTHING else:**
not the object store, not `.git/config`, not any other ref. **`refs/remotes/*` is shared**
— a sibling's fetch advances **your** `origin/main`, so `git checkout origin/main -- <paths>`
restores wherever that ref points **now**, possibly newer than your base: another agent's
merged work entering your tree under the name of a "revert", and **staged** on arrival by
the rule below. **`FETCH_HEAD` is per CHECKOUT — the last fetch in this checkout wins**
(a linked worktree has its own; the hazard is the shared primary checkout). It fails by
**absence**, not wrong content: split from its `git fetch` by any intervening fetch,
`git diff …FETCH_HEAD` **exits 0 printing nothing** — a confidently wrong "the change isn't
there", worst for **reviewing** seats. Practices: pin `BASE=$(git rev-parse HEAD)` at
worktree creation and restore against that commit, never a moving ref name; verify a
named remote-tracking ref's content by occurrence counts on disk; fetch into a ref you
own (`git fetch origin <branch>:refs/<ns>/<id> -f`) and read that; diff restored paths
against `BASE` before staging. ⛔ **No hook backs the moving-ref half** — safe and unsafe
spellings are both ordinary `git checkout` / `git fetch`, so a mechanical block would fire
on correct usage.

**A reading you cite is a count plus the tree it was taken against — repository and
commit — or it is not a reading.** "Measured over the corpus" names `examples/app-crm` at
its sha, never an application it is not; a moving ref is not an anchor, for a corpus
exactly as for a `git diff`.

**⛔ Nor the build cache** — turbo resolves the repo root through the **common** dir, so every
worktree replays ONE `.turbo/cache`. Symptom: a typecheck failing on a package your diff never
touched, unrepaired by a plain rebuild because that rebuild is a cache **HIT** — force-rebuild
that package. Ablating a build tool is a sanctioned producer; `--force` writes the whole closure.

**Doing reverse verification ("revert the fix, watch the diagnostics")? Commit the fix
FIRST.** Committed, restoring is `git checkout <your-branch> -- <path>`, out of a commit
that really exists. Against an **uncommitted** edit there is no restore point at all: the
working tree is the only copy, the stash is banned above, and discarding local
modifications is a normal, silent, exit-0 operation. Prove any retyped change identical
with `git diff` against a saved patch or `git hash-object <path>` (a matching `--stat`
insertion count is **not** byte-identity), then re-run from the committed state so your
red/green numbers are trustworthy.

**⛔ And `git checkout <ref> -- <path>` STAGES what it retrieves — putting the file back
with `cp` undoes only half of it.** It writes the **index** as well as the working tree,
so the index holds the ref's content while the tree holds yours: `git status --porcelain`
shows `MM` and `git show :<path>` reads back the ref's copy, but `git diff HEAD` is
**clean** (it compares tree with HEAD and never consults the index), the tests pass
because they read the tree, and a bare `git commit` builds from the **index** — a commit
that deletes your own fix, in a PR whose body accurately describes a change it does not
contain. Restore with `git checkout HEAD -- <path>` or
`git restore --source=HEAD --staged --worktree <path>` — both reset index *and* tree —
read `git status --porcelain` before you commit, and ⛔ never trust `git diff HEAD` alone
after a checkout-from-ref. Better still, don't stage it at all:
`git restore --source=<ref> -- <path>` (no `--staged`) writes the tree only, a lone
unstaged `M`.

**A windowed history question ("how many commits on `<ref>` in `<window>`") goes through
`scripts/pm/git-history.mjs` — answer, or REFUSE.** A shallow clone answers windowed
`git log`/`rev-list` questions from truncated history at exit 0 with no warning; the tool
proves the window is covered first. `historyHorizon()` is the read-only predicate for
tools that answer their own question.

**Claim the issue BEFORE you write any code.** Every agent here shares one GitHub identity, so
the assignee field is only a presence bit; the identity record is the `Claim:` comment — first
line beginning `Claim:`, then the session ID and the branch (`claude/issue-<n>-<slug>`). Ownership
is written by role. The session that OWNS a card performs both acts: a seat picking a card for
itself takes only an unassigned card, assigns itself and posts the claim before any other action;
a PM dispatch sets the assignee (step 1) and posts the `Claim:` naming the dev's branch (step 2),
both on the dev's behalf. A dispatched executor inherits both records: it verifies that the
newest `Claim:` names its branch (on a mismatch it stops and reports), posts no second claim —
the dispatch's `Claim:` is its identity and its own record is the report comment — and it ⛔ never
writes the assignee and ⛔ never yields a card it was dispatched to. Before writing code, re-read
the comments — the comments decide, not the field: a `Claim:` from another session or branch
(other than the dispatch that sent you) means taken whatever the field says — pick another or
ask, ⛔ never reassign; a bare assignee with no `Claim:` under it is a dispatch's step 1, not a
foreign claim — not taken for the executor it was dispatched to, and not free for a seat picking
for itself. Release is an explicit act: whoever moves a card out of ownership clears the assignee
and posts a `Release:` line. Findings are filed unassigned; assign at the moment you start. The
maintainer's own work under the shared account carries no claim comment and is indistinguishable
from a dispatch — an accepted blind spot; per-seat identities are not introduced.

**State on your PR that you did not set belongs to another actor — ask, never "correct"
it.** Under one shared identity every other participant's write arrives unsigned: the PM
flipping your draft to ready and arming auto-merge, a bot re-labelling, the platform
rewriting your body. A rewritten body is evidence about the body and of nothing else —
⛔ never extend it to the draft flag, which flipped back destroys auto-merge and queue
membership at once (§7's draft-flip re-arm note), invisibly. Read the timeline event's
actor, or ask; undo only once you know who set it and why.

**Write the attribution footer in the form the surface keeps — blank line, rule, ONE footer line:**

```text
---                                                                  ← under a blank line; the block is the form
_Generated by [Claude Code](https://claude.ai/code)_                 ← bare: use in COMMENTS
_Generated by [Claude Code](https://claude.ai/code/session_<id>)_    ← session-URL: use in PR BODIES
```

**PR body:** `create_pull_request` keeps the session-URL form and rewrites bare into it. On EDIT
(`update_pull_request` or a REST PATCH, measured in this repository) the session-URL footer
survives verbatim and the platform APPENDS a bare footer block under whatever you send — so
send an edited body with no footer of your own, read it back, and treat the appended block as
the platform's; ⛔ never re-send a body that already carries an appended footer. Durable
attribution lives in body prose or a comment. **Issue comment:** the platform APPENDS that
block — blank line, `---`, bare footer — and recognises only that shape (MCP
`add_issue_comment` and direct REST agree: per-surface, not per-tool): a bare footer UNDER the
rule line is stored byte-identical, one footer; a bare footer with NO rule line above it is not
recognised and the whole block lands under it, leaving two; the session-URL form survives
verbatim and a bare one lands under it, leaving two. ⛔ A tail bare footer on a comment is the
platform's, not your form downgraded. Which layer does this is unknown; don't go establishing
it. **Commit message:** an agent commit ends with the model-free trailer pair
`Claude-Session: https://claude.ai/code/session_<id>` and
`Co-authored-by: Claude <noreply@anthropic.com>`; no model identifier lands in a PR title or
body, a comment, a changeset, a doc or a code comment — the harness-written `Co-Authored-By`
trailer (with its session link) is the one exemption.

**GitHub mutates body BYTES — spell poison-shaped tokens out in words, never literally.**
Regex literals and script-tag-shaped tokens go in fenced code with the dangerous character
spelled out, or are described in words (fences do NOT protect them); after writing any
less-than fragment, read the body back and verify it survived. The two measured mutation
shapes and their triggers live in pm-dispatch `references/platform-readings.md`. ⛔ A body
reading short only through the API is probably intact — check the rendered page before
"repairing" it; a rewrite destroys a correct card.

Even inside your own worktree, operate defensively:

1. **Only touch the files your task needs.** Don't "fix" unrelated diffs, reverts, or
   other agents' in-flight edits, and don't try to manage the whole working tree. If a
   file you didn't change shows as modified, leave it.
2. **One feature branch + one PR per task.** Branch off `main`. **Never commit task work
   straight to `main`.** Name the branch after the issue it fixes: `claude/issue-<n>-<slug>`.
   The issue number is what makes in-flight work *discoverable* — `git ls-remote --heads
   origin | grep issue-<n>` is a one-command pre-check, and the Duplicate Fix Guard
   workflow warns on fix PRs whose branch names no declared issue.
3. **Never `git push --force` / `--force-with-lease`, and never push `main`.** A
   force-push can clobber a parallel agent's work; `main` is shared — land all via PR.
4. **Verify the current branch before every commit/push**
   (`git rev-parse --abbrev-ref HEAD`). HEAD may have been switched by another agent —
   if it isn't your feature branch, stop and re-checkout before pushing.
5. **Shared files (barrels/registries like `builtin/index.ts`): edit → `git add` →
   commit atomically, then confirm the commit really contains your lines**
   (`git show HEAD:<file> | grep <yourChange>`). A concurrent edit can revert your
   working-tree change between the edit and the commit. On a real conflict, re-apply
   only *your* lines and let the PR merge integrate the rest.
6. **Don't rebase or force-update shared branches** to tidy other agents' commits.
7. **Land through the merge queue: arm auto-merge on a PR that is already green,
   accepted and non-draft, then let the queue merge it.** The queue rebuilds your PR
   *as merged onto the current `main`*, re-runs the subscribing workflows on that
   rebuilt generation, and lands it only if the required ones pass — the §10
   re-verification, done by the platform, race-free. **Arm only what is already green
   and accepted.**

   ⛔ **Two classes of PR never enter this path, however green:** (a) a diff touching any
   **governed surface** (**Prime Directive #14**, which names them and holds the current
   list — **this file and `CLAUDE.md` are on it**, so re-read it rather than recalling
   it); (b) the **Version Packages** PR, or any PR whose merge performs a release
   (**Prime Directive #15**). Read the PR's file list (`get_files`) **and its author**
   before you arm anything.

   **Green means the gate-carrying jobs' `conclusion` is `success`** — not "no failure
   yet"; `in_progress` is not a pass. Arming a red PR does not queue it, it hides it:
   every poll then misreads "not on `main` yet" as "queued". Always read *two* things:
   the queue branch **and** `origin/main`. And **the queue enforces only the required
   set** — six contexts block: `Lint & Repo Gates` (all `check:*` gates),
   `TypeScript Type Check`, `Test Core`, `Dogfood Regression Gate`, `Build Core` and
   `Temporal Conformance (live PG + MySQL)`. A check outside those six is advisory and
   rides through, and an advisory red that lands rides `main`'s merge ref into every later
   PR until stanched. A required context is matched by check-run name, so a rename
   detaches its gate silently — treat those six names as contract.

   **Re-arm awareness** — none of these is a reason to avoid the queue; all are reasons to
   confirm a PR is still *in* it: a red queue build **ejects** your entry and drops
   auto-merge, often on a package your PR never touched (the queue runs the full suite; the
   PR ran affected-only) — diagnose against `merge-queue-triage.yml`'s comment, recognise a
   known-flaky signature, then re-arm once, never reflexively; **collateral eviction is
   silent** (triage comments only on `failure`, so an entry cancelled because something
   *ahead* failed gets nothing) — neither on `main` nor in the queue means dropped, re-arm;
   **flipping back to draft drops auto-merge and queue membership at once**, and neither
   returns by itself — ready *first*, arm *second*. One non-fix: **a stale red does not
   clear by re-running** — `rerun_failed_jobs` reuses the original run's commit and merge
   ref, so a fix that landed on `main` since is invisible to it; only a new commit
   (`git merge origin/main`) helps. Whether a direct `gh pr merge` is refused here is
   deliberately unmeasured — do not establish it by attempting one.

   **Fallback, when the queue is unavailable:** merge serially, only after remote CI is
   fully green, rebasing other open branches before merging the next. It loses badly
   under load, which is why the queue is the default path, not an optimisation.
8. **Testing needs a server? Start your own temporary one — never stop someone else's.**
   A running dev server you didn't start probably belongs to another agent or the user;
   killing it (or its port) breaks their in-flight work. Spin up your own instance on a
   random high port (`pnpm dev -- --fresh -p <random>`) and **shut it down yourself when
   the task is done** (`kill $(lsof -ti tcp:<port>)`). Don't leave orphan servers behind.
9. **After pulling `main` into a long-lived worktree, refresh its build state before you
   trust a single test or gate.** A worktree open across several merges accumulates
   artefacts stale relative to the source, and every one of them fails **as if your change
   broke something** — naming other people's exports, other packages' files, or config you
   never touched:

   | stale artefact | how it presents | why it lies |
   |---|---|---|
   | `packages/spec/dist` | `check:api-surface` reports *other people's* exports as "N breaking (removed/narrowed)"; `check:i18n-coverage` rejects an example config for a value the spec allows | both read the built `.d.ts`, not `src/` |
   | `node_modules` | a package fails to resolve a dependency it plainly declares (`Cannot find package 'hono'`) | the merge moved `pnpm-lock.yaml` |
   | `packages/runtime/.objectstack/` | `datasource-autoconnect` sees each row 6× | gitignored fixture state accumulating across runs |
   | `.cache/objectui-*` | `pnpm lint` reports dozens of errors in files you have never opened | a full objectui checkout left by `build-console.sh`, linted as if it were ours |

   So after any `git merge origin/main`:
   `pnpm install --frozen-lockfile && pnpm build && rm -rf packages/runtime/.objectstack`
   (add `rm -rf .cache` if you have run the console build). Note `OS_SKIP_DTS=1` keeps
   a build fast but leaves no `.d.ts`, so `gen:api-surface` cannot run at all under it —
   that one needs a real build. None of this is CI-visible (CI checks out fresh). Only
   the first row has a gate: `check:dev-prereqs` refuses `pnpm dev` on a stale
   `packages/spec/dist` (content-hash, never mtime); for every other row the prescription
   above is the whole remedy — the gate's own pass line says "existence, not freshness"
   so its green cannot be read as vouching for them.
10. **A clean merge is not a working merge — but scope the re-check to the overlap.**
   Git conflicts on overlapping lines; nothing warns you when two changes are
   individually fine and jointly wrong. **Before opening a PR, pull `main`, refresh build
   state (§9), and run the full suite once.** For the *subsequent* pre-merge merges of
   `main` — the ones you do only because `main` moved again while CI ran — scope it:
   - **Always:** rebuild what the merge touched, and if `packages/spec` moved on either
     side, `pnpm --filter @objectstack/spec build && pnpm --filter @objectstack/spec
     check:generated` — generated snapshots (`api-surface`, baselines) are the classic
     jointly-wrong artifact, and only a rebuild of the merged source can validate them
     (never trust git's textual merge of a generated file). Then assert your branch's
     *delta vs `main`* is still exactly what your PR intends (e.g. "N removed / 0
     added").
   - **Full `pnpm typecheck && pnpm test` again only when** the incoming commits touch
     the same packages or the same behavior your diff does, or a conflict occurred
     outside trivially-mechanical files.
   - CI on the PR, and then the merge queue on its rebuilt generation (§7), validates the
     merge commit itself — that second CI round is where joint breakage surfaces.
11. **Generated artifacts don't text-merge — a driver defers them and `pre-commit`
   collects the debt.** §10's "never trust git's textual merge of a generated file" is
   mechanical: `.gitattributes` routes the generator-owned artifacts to `merge=os-regen`
   (the list is the `.gitattributes` entries themselves; `pnpm check:merge-driver`
   reconciles both directions), so a merge stops only on the hand-written files that
   actually need you. The driver does **not** regenerate — git runs merge drivers while
   the worktree still holds pre-merge sources, so a generator run there would describe a
   half-merged tree; instead it records each path in `$GIT_DIR/os-regen-pending` and
   `pre-commit` refuses the commit until those artifacts check clean. Sequence after a
   merge unchanged from §9: rebuild, then `check:generated --fix`. Worth knowing:
   - **The MERGE commit itself is the one exemption, and it is a deferral, not a pass.**
     `scripts/pm/os-regen-merge.sh` is the in-repo authority for landing one of these
     branches, and its step 3 commits the merge **before** regenerating on purpose: the
     driver exits 0 while silently dropping one side, so only a separate regeneration
     commit on a known-good base lets a reviewer read "what main brought" apart from
     "what the change produces". `pre-commit` records that merge as a deferral and then
     holds you to it — the immediately following commit must discharge it (every commit
     until then is refused, and a second merge cannot defer on top of an outstanding
     one), and `.githooks/pre-push` refuses a push that still owes one. ⛔ So this step
     never needs `--no-verify`, which skips *every* pre-commit check rather than this one.
   - **The driver is a LOCAL facility** — the merge queue rebuilds server-side where no
     custom driver runs, so the three hottest artifacts are **sharded** per category/entry
     (`authorable-surface/`, `json-schema.manifest/`, `api-surface/`) to keep parallel
     spec PRs textually disjoint; every gate reads the whole directory as one set, so
     ratchet semantics are unchanged (`packages/spec/scripts/lib/sharded-artifacts.ts`).
   - **Registration is per clone** (`pnpm install` → `prepare` →
     `scripts/setup-git-hooks.mjs`); an unregistered clone falls back to git's default
     text merge — older behaviour, not breakage.
   - **The ratchet baselines are deliberately excluded**: recomputing a shrink-only
     ratchet can *widen* it, laundering a new exemption in as merge noise — those
     conflicts are yours to read (`NOT_DRIVER_MANAGED` in `scripts/regen-artifacts.mjs`
     says why, per path).

---
## Monorepo Layout

```
packages/
  spec/           # 🏛️ Protocol schemas, types, constants (Zod source of truth)
  core/           # ⚙️ ObjectKernel, DI, EventBus
  types/          # 📦 Shared TS utilities
  metadata/       # 📋 Metadata loading & persistence
  objectql/       # 🔍 Query engine
  runtime/        # 🏃 Bootstrap (Driver/App plugins)
  rest/           # 🌐 Auto-generated REST layer
  client/         # 📡 Framework-agnostic SDK
  client-react/   # ⚛️ React hooks
  cli/            # 🖥️ CLI
  create-objectstack/  # 🚀 Scaffolding
  adapters/       # 🔌 express/fastify/hono/nestjs/nextjs/nuxt/sveltekit
  plugins/        # 🧱 Official plugins & drivers
  services/       # 🔧 Kernel-managed services
apps/docs/        # 📖 Fumadocs site
examples/         # 📚 Reference implementations
skills/           # 🤖 Domain skill definitions
content/docs/     # 📝 Docs content
```

---

## Protocol Domains (`packages/spec/src/`)

| Namespace | Path | Responsibility |
|:---|:---|:---|
| `Data` | `data/` | Object, Field, FieldType, Query, Filter, Sort |
| `UI` | `ui/` | App, View (grid/kanban/calendar/gantt), Dashboard, Report, Action |
| `System` | `system/` | Manifest, Datasource, API endpoints, Translation (i18n) |
| `Automation` | `automation/` | Flow, Workflow, Trigger registry |
| `AI` | `ai/` | Agent, Tool, Skill, RAG, Model registry |
| `API` | `api/` | REST/GraphQL contract, Endpoint, Realtime |
| `Identity` | `identity/` | User, Organization, Profile |
| `Security` | `security/` | Permission, Role, Policy |
| `Kernel` | `kernel/` | Plugin lifecycle (PluginContext) |
| `Cloud` | `cloud/` | Multi-tenant, deployment, environment |
| `QA` | `qa/` | Test, validation |
| `Contracts` | `contracts/` | Cross-package interfaces |
| `Integration` | `integration/` | External integrations |
| `Studio` | `studio/` | Studio UI metadata |
| `Shared` | `shared/` | Error maps, normalization utilities |

Root also exports: `defineStack`, `composeStacks`, `defineView`, `defineApp`, `defineFlow`, `defineAgent`, `defineTool`,
`defineSkill`.

---

## Kernel

| Kernel | Use For |
|:---|:---|
| `ObjectKernel` | Default production runtime. Full DI / EventBus / Plugin lifecycle. |
| `LiteKernel` | Tests (vitest), serverless, edge (Workers). |

`EnhancedObjectKernel` is deprecated — do not use.

---

## Documentation Guardrails

| Path | Type | Rule |
|:---|:---|:---|
| `content/docs/references/` | **AUTO-GEN** | ❌ Never hand-edit. Regenerated by `packages/spec/scripts/build-docs.ts`. |
| `content/docs/releases/` | **RELEASE-OWNED** | ❌ Never edit in a code PR. Release notes are written **centrally at release time**, compiled from changesets + the ADR-0087 registries — never accreted a row per PR. Your PR's input is its **changeset**; for spec removals also the D2/D3 registry entries. Factual error on a releases page → dedicated docs-only PR or an issue, never a rider on code changes. |
| `**/translations/*.generated.ts` (nine packages — `platform-objects`, five plugins, three services) | **AUTO-GEN** | ❌ Never hand-edit the file *structure*. Regenerate all nine with `node scripts/check-i18n-bundles.mjs --write` (merge mode keeps every existing **translated-locale** value; the default locale `en` is rewritten from the source on every run, so hand-edits to `en.*.generated.ts` do not survive and belong in the source metadata); `pnpm i18n:extract` still covers `platform-objects` alone. Translated-locale *values* (`zh-CN` / `ja-JP` / `es-ES`) are hand-written: editing one of those strings is fine, adding or dropping keys is drift. `pnpm check:i18n` gates all nine in CI, and `pnpm check:i18n-coverage` ratchets untranslated declared labels. |
| `content/docs/<tree>/` — every tree except `references/` and `releases/` above | hand-written | ✅ Update that tree's own `meta.json` when adding a page: each is an explicit ordered `pages` array with no rest-spread, so a page you add but never list is absent from the nav. |

### Touched `packages/spec`? Regenerate its artifacts BEFORE pushing

`packages/spec` has **eight** checked-in generated artifacts, each with its own CI
gate. All of them live in one job — `TypeScript Type Check` in `lint.yml`, which is
required and has no paths filter, so no gate can go dormant on the PR that breaks it.
That job runs its gates **sequentially**, so the first stale artifact masks every one
behind it. Match the change to the gate and regenerate up front:

| You changed | Gate that fails | Regenerate with `pnpm --filter @objectstack/spec …` |
|:---|:---|:---|
| A `.describe()` / TSDoc on any schema | `check:docs` | `gen:schema && gen:docs` |
| A public export (added / removed / renamed) | `check:api-surface` | `gen:api-surface` |
| An authorable key on a metadata schema | `check:authorable-surface` | `gen:schema` |
| An ADR-0087 conversion / migration registry | `check:spec-changes`, `check:upgrade-guide` | `gen:spec-changes`, `gen:upgrade-guide` |
| A `SKILL.md` (frontmatter or body) | `check:skill-docs`, `check:skill-refs` | `gen:skill-docs`, `gen:skill-refs` |
| The react-blocks contract | `check:react-blocks` | `gen:react-blocks` |

A `.describe()` string counts — it lands in `content/docs/references/`. Adding one
export counts — it lands in `api-surface/`. Don't match by hand — one command runs
**every** gate and reports **all** stale artifacts at once:

```bash
pnpm --filter @objectstack/spec build             # REQUIRED first — see the dist caveat
pnpm --filter @objectstack/spec check:generated   # every gate; the first failure does not stop the rest
pnpm --filter @objectstack/spec check:generated --fix   # regenerate ONLY the ones it proved stale
```

Principles the wrapper encodes (its own output is the authority on detail):

- **`--fix` is deliberately narrow.** Regenerating the whole set on principle rewrites
  artifacts whose staleness you never saw, so a real semantic change lands silently
  inside a mechanical diff. Let the check say which are stale, regenerate those.
- **No `check:` script regenerates anything** — a gate that regenerates edits your
  working tree and reports nothing. Generation belongs to the **caller** (`pnpm build`,
  or the `check:authorable-surface` gate whose `--check` mode writes only the
  gitignored tree). Consequence: `check:docs` is not self-sufficient — run the `build`
  line first; `build-docs.ts` refuses loudly on a missing or stale tree.
- **The gate → generator ledger self-reconciles against `package.json`** on every run
  and on every PR (`--reconcile-only` in lint.yml's required typecheck job): a new
  `check:`/`gen:` script nobody classified fails its own PR instead of quietly dropping
  out of coverage.
- **`check:api-surface` and `check:exported-any` read the built `dist/*.d.ts`, not
  `src/`.** A stale `dist` makes the first report *other people's* exports as
  **removed** ("N breaking (removed/narrowed)") when nothing was removed at all —
  rebuild before you believe it, and before you file a bug about `main` being red.
- **The pure source audits** (`check:liveness`, `check:empty-state`,
  `check:skill-examples`, `check:exported-any`, `check:dual-source-exports`) have no
  generator — a failure there is a real finding to fix, never an artifact to
  regenerate; `check:generated` names them as deliberately not run, so its "all up to
  date" never reads as "everything passed". `check:exported-any` exists because the
  `api-surface/` snapshot records that an export *exists*, never what it *resolves to*
  — a recursive Zod schema annotated `z.ZodType<any>` compiles, validates, and silently
  throws the type away; annotate with the real type (`QueryAST` in
  `src/data/query.zod.ts` is the pattern). `check:dual-source-exports` asks whether a
  name on two entries is one declaration re-exported (fine) or two declarations sharing
  a name, with accepted cases in the shrink-only, hand-edited
  `dual-source-exports.baseline.json`.

**`check:react-declaration-parity` compares two DECLARATIONS, not a declaration against
an implementation** — the props the spec zod schema declares vs the inputs the objectui
registry config declares. A prop both sides declare and no renderer reads is, to this
gate, perfect agreement. Its `spec-only` / `registry-only` / `missing` signals are real;
just don't read it as proof anything renders. It is also the one gate `check:generated`
cannot run at all (`EXTERNAL_INPUT_REQUIRED`): its right-hand side is objectui's
`sdui.manifest.json`, produced only by `pnpm sdui:manifest` driving a real browser over
objectui built at `.objectui-sha`, and it **exits 1** with no usable manifest — "could not
run" is a failure, not a skip (Route & surface ownership §3). The manifest comes **not
from CI**: it is an on-demand gate whose trigger is the **objectui pin bump**
(`docs/releases-maintenance.md` carries the procedure). ⛔ Do not "fix" the red by
re-adding a skip, and do not wire the gate into a workflow either.

Two generators have **no** gate at all — `gen:openapi` and `gen:sbom`. Nothing verifies
their output is current; the wrapper reports that each run rather than staying silent.

---
## Context Routing — apply the right role per path

| Path | Role | Key Constraints |
|:---|:---|:---|
| `**/objectstack.config.ts` | Project Architect | `defineStack`, driver/adapter selection |
| `packages/spec/src/data/**` | Data Architect | Zod-first, snake_case, TSDoc every prop |
| `packages/spec/src/ui/**` | UI Protocol Designer | View types, SDUI patterns |
| `packages/spec/src/automation/**` | Automation Architect | Flow/Workflow state machines |
| `packages/spec/src/ai/**` | AI Protocol Designer | Agent/Tool/Skill schemas |
| `packages/spec/src/system/**` | System Architect | Manifest, datasource, i18n |
| `packages/spec/src/kernel/**` | Kernel Engineer | Plugin lifecycle, PluginContext |
| `packages/spec/src/security/**` | Security Architect | RBAC, policies |
| `packages/core/**` | Kernel Engineer | Runtime logic OK here |
| `packages/runtime/**` | Runtime Engineer | Bootstrap, plugin registration |
| `packages/rest/**` | API Engineer | Route gen, middleware |
| `packages/plugins/**` | Plugin Developer | Implements spec contracts |
| `packages/services/**` | Service Engineer | Kernel-managed services |
| `packages/adapters/**` | Integration Engineer | Framework bindings, zero business logic |
| `packages/client*/**` | SDK Engineer | Public API, DX, type safety |
| `apps/docs/**` | Docs Engineer | Fumadocs + Next.js, MDX |
| `examples/**` | Example Author | Minimal, runnable, uses `defineStack`. App or platform, on any tree: could this be written from the metadata alone, with no knowledge of this company? No ⇒ the app; yes ⇒ the platform, and a **gap** until it does — `.claude/skills/pm-dispatch/references/app-platform-boundary.md` |
| `content/docs/**` | Technical Writer | Respect auto-gen boundaries |
| `../objectui/**` (sibling repo) | Studio UI Engineer | React + Shadcn + Tailwind, dark mode default |

---

## Skills (`skills/`)

Two roots; **the filesystem is the catalog**. Consult the matching `SKILL.md` when
working in its domain — browse the directory, never a hand-written list here:

- `skills/` — the **published** catalog (it ships to customer projects).
- `.claude/skills/` — repo-internal agent playbooks; every entry must carry
  `metadata.internal: true`.

⛔ **Both roots are governed surfaces** — human-merge only, or queued under **Prime Directive #14**'s pinned-approval
path; no per-PR check holds it: the queue guard refuses an unpinned governed diff at queue time.

---

## Patterns

**Zod schema:**
```ts
export const FieldSchema = z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name (snake_case)'),
  label: z.string().describe('Display label'),
  type: FieldTypeSchema,
  maxLength: z.number().optional(),
  defaultValue: z.any().optional(),
});
export type Field = z.infer<typeof FieldSchema>;
```

**Plugin** (the kernel contract is `init`/`start`/`destroy` — `packages/core/src/types.ts`;
there are no `onInstall`/`onEnable`/`onDisable` hooks):
```ts
export class MyPlugin implements Plugin {
  name = 'plugin.my-feature';
  async init(ctx: PluginContext)  { /* register services, schemas, routes */ }
  async start(ctx: PluginContext) { /* begin work that needs every service up */ }
  async destroy()                 { /* cleanup */ }
}
```

---

## Route & surface ownership

Five rules. They matter more than usual here because this repo is largely written by
agents, and every one of them is a trap that reads as reasonable code.

**1. One route, one owner.** Never add a second implementation of a path that another
package already serves, however convenient. A shadowed duplicate is code that `grep`
finds and the runtime never runs — dead code an agent reasons confidently from — and it
silently forks every future invariant, because whoever fixes the real owner never knows
about the copy.

**2. Explicit composition over default magic.** A capability that appears because of a
default nobody wrote down is invisible at every call site — and call sites are the
primary evidence an agent reasons from (the classic misdiagnosis checks *who passes the
option* and misses *who relies on the default*). If a host should get a surface, it
should mount it.

**3. Absence must be loud.** A composition that legitimately serves nothing should say
so once at boot, naming the remedy — never leave a bare 404 to be diagnosed. The same
rule applies to tooling: a verifier that silently degrades (reusing a stale build,
skipping a check it could not run) is worse than no verifier, because it reports
success. Prefer failing to falling back.

**4. Machine-readable surfaces must not lie.** `/discovery` and friends are read by
SDKs, codegen and AI clients. Advertise only what is actually mounted, and mount
everything advertised (ADR-0076 D12) — a wrong answer here propagates into everything
built on top of it.

**5. A new REST route declares its CLOSED query-parameter set on the day it lands.** The
closed set is REST ingress policy, adopted incrementally — ⛔ never as one big batch.
Open the handler with `refuseUnknownQueryParams(req, res, <EXPORTED_PARAMS>)`
(`packages/rest/src/query-allowlist.ts` — its header is the authority on detail) so an
unrecognised name gets a located `400` instead of being dropped. A handler that reads
the keys it knows and ignores the rest fails **undetectably in both directions**: a
dropped *filter* returns the full set, a dropped key inside `where` returns `200` with
zero rows, and no status, header or field distinguishes either from a real answer — an
AI caller cannot see it at all. This is review-enforceable: a PR adding a `GET` route
that reads `req.query` without declaring a closed set is incomplete.

Three things to get right:

- ⛔ **Measure the set from the handler's ACTUAL read points, never from the docs or
  the card.** It is not "the filters" — it is paging, ordering, format, alias spellings
  and anything middleware reads. **Forgetting `limit` trades a silent-widening bug for
  a loud pagination outage**, which is worse than the defect. **Read the helpers the
  handler calls, not just the handler**: a parameter such as the export route's
  `?locale=` is read a frame down (`extractLocale`), never in the handler body. Pin
  **both halves** per route: a refusal pin (status + nested `error.code` + **the service
  was never called**) beside a preservation pin (**the arguments the service actually
  received**). Neither half is optional, and a bare status assertion is not a pin —
  "still 200" is exactly what the defect looked like.
- ⛔ **Routes whose parameter set is genuinely OPEN are excluded, by name.**
  `GET /data/:object` hands its whole query to the normalizer, which lowers every
  leftover key into an implicit field filter (`?status=open` *is* the filter) — the
  valid names are the object's own fields, so any list here would be wrong. It is
  already gated one layer down, against the right authority: an unknown **field** is
  refused there with `400 INVALID_FIELD`, judged against the object's real field map
  (the registry's, including the audit/tenant/owner columns it injects — not the
  author's declaration). The test: *if an unrecognised name has a defined meaning on
  this route, the set is open* — gate it where the authority for the name lives.
- **Existing routes convert per lane, ⛔ never as one sweep** (data read routes first).

Recognition runs **before** the arity gate (`refuseRepeatedQueryParams`); both answer
the same nested ADR-0112 `VALIDATION_ERROR`, so composing them adds no dialect.

**Verifying any of this:** "who serves this path" is a question about the composed,
*provisioned* runtime — not about which plugin declares it, not about registration
order, and not about a minimal harness that merely boots. Boot the real composition with
its real services, or do not claim an answer.

---

## Degradation log levels — `warn` vs `error`

Nearly every `catch` in this repo is a best-effort degradation logged at `warn`; for one
recurring class that level is silent data loss. Decide the level with **one question**,
not with an adjective:

> **After the degradation, does the system still look "normal" from the outside,
> while something it claims is persisted has not actually landed?**
> **Yes → `error`. No → `warn`/`info` is right.**

- **Functional degradation → `warn` / `info`.** A screen is missing, a trigger is not
  armed, a capability is not enabled, an optional service never showed up. The system
  is *visibly* smaller than it should be, and the next person to use the missing thing
  finds out. `ScheduleTriggerPlugin: job service not available — scheduled flows will
  not run until one is registered` is exactly right at `warn`.
- **Durability / data-consistency degradation → `error`.** A write that claims to
  persist does not, DDL that was supposed to run did not, persisted state and runtime
  state disagree. Nothing looks broken; the loss surfaces a release later, to someone
  who cannot connect it to this line. It is the failure Prime Directive #10 names —
  advertising a capability (durability) the runtime does not deliver — and the instinct
  of "Absence must be loud" above: **prefer failing to falling back**, and when you must
  fall back, say what was lost.

**An `error` here owes two things**, both, in the first line it prints
(`packages/services/service-automation/src/plugin.ts` `start()` is the reference text):
① the **consequence**, concretely — *what* is not durable, and that the system will
keep looking healthy anyway; ② the **fix** — the composition/config change that
restores durability, or the explicit opt-out that makes the degradation deliberate
(`suspendedRunStore: 'memory'`, `OS_SKIP_SCHEMA_SYNC`). Say it **once**, at the first
degradation, not once per failed write.

**Do not over-apply it.** Escalating a functional degradation to `error` trains
everyone to skim `error`. An `if (!service)` composition branch is usually functional
and belongs at `warn`; a `catch` around a write, a DDL call, or a store initialization
is where this rule bites. **And a failure handed to the CALLER is not a degradation at
all** — the third legal answer: a `catch` that answers `errorFromThrown(e, 400)`, or a
batch whose contract IS a per-item outcome report, does not look normal from the
outside — the requester was told. Do **not** bolt a `logger.error` onto such a site;
declare **how it delivers** instead — `FAILURE_PROPAGATION_CALLEES` (repo-wide names)
or the function-scoped `FAILURE_PROPAGATION_SITES` in the checker, which then proves
structurally that *every* path out of the `catch` delivers.

**It has teeth**: `pnpm check:durability-log-level`
(`scripts/check-durability-degradation-log-level.mjs`; its header is the authority)
walks the AST for `catch` blocks guarding a declared vocabulary of durability-critical
operations and fails when one logs below `error` without rethrowing. It is deliberately
narrow — it cannot *discover* a new seam, only stop known ones from regressing; found a
new one, add it to `DURABILITY_CRITICAL_CALLEES` in the same PR that fixes it. Its
baseline (`scripts/durability-degradation.baseline.json`) is shrink-only and currently
**empty — its intended steady state**: an entry means a real unfixed degradation, never
a site the gate cannot classify; a caller-propagating seam is declared via the
propagation vocabulary, not baselined.

**The same command has a SECOND set of teeth — the read-seam invention rule.** The
log-level axis is structurally blind to reads: `catch { return []; }` has no log to
grade. The second rule asks — **the read did not happen; did you make an answer up
anyway, and tell nobody?** — and goes red only when every part holds: the `try`
performs a storage read (`IDataDriver` read methods or a same-file wrapper), the
`catch` logs nothing at any level, some path out of it returns an **invented answer**
(an empty/zero value, or an enclosing function's own parameter handed straight back —
for an enrichment function the un-enriched input is byte-identical to a successful
read with nothing to hydrate), and that path was never reached by discriminating the
error's **type**. What it protects is DISTINGUISHABILITY, not the spelling of the
returned value: fix by asking the error's type or reporting the failure once — never
by inventing a different empty. Its scan surface is deliberately narrow —
`packages/metadata/src`, `packages/metadata-protocol/src`, `packages/objectql/src`
only: the persistence layer first, widening is its own issue — which is also what
lets names as generic as `find`/`findOne`/`count` mean "a storage seam" at all.
Benign read failures are proven by the declared `READ_FAILURE_DISCRIMINATORS`
predicates (today `isMissingTableError`) — a hand-rolled `if (e.code === '42P01')` is
flagged on purpose; ask the shared predicate rather than growing a second vocabulary.
Reviewed-legitimate seams go in this rule's OWN shrink-only ledger,
`scripts/durability-read-invention.baseline.json` (**not** the empty one above); its
steady state is *not* empty — read the entries and their reasons, never the count.
The two rules share one script, one CI step and one AST pass, and share no vocabulary,
no baseline and no verdict.

---

## Startup registry reads — never record a verdict the boot can still contradict

A boot fills its registries incrementally. Asking a registry "is X there?" while it is
still filling is fine — the answer is simply not final yet. Turning that not-yet into a
**verdict and recording the verdict** is the defect, because the provider registers a
moment later and nothing goes back to undo the record.

Decide with **one question**, the counterpart of the degradation-log-level one:

> **At the moment this code concludes "X is not registered", can a provider still
> register X during this same boot? And is that conclusion RECORDED anywhere that
> outlives the moment?**
> **Yes and yes → defect.**

Three parts, all three or it is not a finding:

1. a read of a registry that is still filling — the service registry during `init()`,
   or a plugin-extensible capability registry before it is sealed;
2. a terminal conclusion drawn from "absent";
3. that conclusion **recorded** — cached in an instance field or module binding,
   asserted in a `warn`, or persisted.

Part 3 is what makes this a rule and not noise. **A read-only probe is completely
legal**: `AutomationEngine.getUnknownNodeTypeAudit()` reads the executor registry on
every call, records nothing, and is correct.

**The three cures, in preference order:**

1. **Resolve where it is used, not where you start.** A lazy accessor or a
   `kernel:ready` hook sees a provider that registered later —
   `createLazyCacheRateLimitStorage()` in plugin-auth is the reference.
2. **Declare the ordering (ADR-0116).** `dependencies` / `optionalDependencies` /
   `requiresServices` make the kernel hoist the provider ahead or assert it registered,
   which makes "absent" a *fact*. Tolerance belongs in the plugin's own declaration,
   where the kernel enforces it — not in a checker's ledger.
3. **Seal the vocabulary, then judge.** For a registry that is open by contract
   (ADR-0018 flow node types), the host declares the moment it can no longer grow —
   `AutomationEngine.sealNodeTypeVocabulary()`, called at `kernel:bootstrapped` — and
   only then is an absence worth reporting.

**It has teeth**: `pnpm check:startup-registry-verdict` walks the AST for that
three-part shape and fails on it; accepted exceptions live in the shrink-only,
hand-edited `scripts/startup-registry-verdict.baseline.json`. Found a new open
registry? Add it to `OPEN_CAPABILITY_REGISTRIES` in the same PR that fixes it.

---

## Post-Task Checklist

1. `pnpm test` — verify nothing broke. Touched a type-check-covered package? `pnpm typecheck` too.
2. **Land it — don't leave passing work in the working tree.** Once tests pass, create
   a feature branch, commit, push, open a PR, and — once remote CI is fully green and
   the PR is accepted — arm auto-merge so the queue lands it (Multi-agent discipline
   §7: never straight to `main`; never arm a PR that isn't green yet). A finished task
   = a merged PR, not a dirty working tree. ⛔ **Except a diff touching a governed
   surface** (Prime Directive #14 names them — more than ADRs): push it, open the PR,
   and stop there, landing it is the maintainer's, by hand. For that class, a
   finished task = a PR left visibly awaiting a human merge.
3. **Add a changeset for anything that publishes.** Feature, functional improvement or fix — run `pnpm changeset`
   (or add a `.changeset/*.md` entry) describing it before committing. A bug fix in a released package takes a
   **`patch`** changeset — never none, and ⛔ never `skip-changeset`: that label is for a diff that publishes
   nothing from any released package.
   **Breaking changesets must carry their migration.** If the change removes or renames anything an author can write (a
   spec key, an export, a config field), the changeset body must state the FROM → TO mapping and the one-line fix —
   this text ships to consumers as `CHANGELOG.md` inside the npm package and is what an upgrading agent greps after the
   tombstone error. Removing an authorable spec key also requires a tombstone so the rejection itself carries the
   prescription — `retiredKey()` (`packages/spec/src/shared/retired-key.ts`) on a non-strict schema, or an entry in
   the relevant `UNKNOWN_KEY_GUIDANCE` / `*_RETIRED_KEY_GUIDANCE` map (see `object.zod.ts`, `ai/tool.zod.ts`) when the
   schema is `.strict()`. The changeset is one of fourteen surfaces a retirement touches — follow the
   `spec-property-retirement` skill (`.claude/skills/`) rather than reconstructing the kit, and note the two routes
   imply **opposite** liveness-ledger dispositions.
   **A breaking changeset must also state its ADR-0087 disposition, in writing.** Add exactly one marker to the
   changeset body — `pnpm check:adr-0087-registration` enforces it, and the CI step is *Require an ADR-0087
   disposition on a declared-breaking changeset*:
   ```
   <!-- adr-0087: registered SOME-MIGRATION-ID -->
   <!-- adr-0087: not-required (unpublished) why -->
   <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->
   <!-- adr-0087: not-required (no-migration-prescription) why -->
   ```
   The gate prints the argument when it fails — that output is the authority.
4. **A removal that breaks the pinned sibling checkout ships together with the sibling fix and the pin bump — or it
   does not ship.** The `Console Pin Gate` job builds objectui at the pinned `.objectui-sha` against **current** `main`,
   so a removal or rename the pinned sibling still imports turns `main` red for every PR in the repo the moment it
   merges — "retire the surface" and "leave the sibling untouched" cannot both hold. A ruling that authorizes such a
   removal therefore implicitly authorizes the objectui-side fix and the pin bump as part of the same landing (the
   bump's `sdui:manifest` second half included — see the Frontend section). Pre-merge check for any removal or rename
   of an exported surface: does the pinned sibling import what you are removing? `git grep` it in `../objectui` at the
   pinned SHA before merging.
5. **Touched `packages/spec`? Regenerate and commit its artifacts before pushing** — § *Touched `packages/spec`*
   above is the authority; note `OS_SKIP_DTS=1` greens `check:api-surface` locally and reds it in CI.
6. Update `ROADMAP.md` if user-facing or architectural.
7. **Delete temporary artifacts** — screenshots, traces, scratch logs, `.playwright-mcp/`, throwaway `tmp*.ts`, ad-hoc
   scripts. Repo must look identical to before, minus intended changes.

---

## Edit Sizing

Keep single `edit`/`create` payloads under ~20KB. Split larger changes into multiple sequential edits.
