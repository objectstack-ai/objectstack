# ObjectStack — AGENTS.md

Primary AI instruction file for this repo — and the human contributors' source of truth.
Read natively by Claude Code, GitHub Copilot (coding agent + CLI), and other agents — no
separate `.github/copilot-instructions.md` mirror needed. When any other instruction file
in this repo (including `.claude/skills/**`) conflicts with this one, **AGENTS.md wins**.

> **v5.0 breaking rename: `project` → `environment`** everywhere (CLI `-e`, `/api/v1/environments/:id`, header `X-Environment-Id`, `OS_ENVIRONMENT_ID`, DB column `environment_id`). No aliases. See ADR-0006. "Project" now only means the npm/monorepo sense.

This file carries principles, binding rules and lookup tables. Lessons from past
incidents are distilled in place — failure mode, discipline, boundary — without
issue-number citations (maintainer ruling, 2026-08-12: 「处理 issue 时犯的错应该总结成
经验,保留 issue id没有意义」); maintainer rulings keep their date and verbatim quote.
Where a hook or CI gate enforces a rule mechanically, the rule is stated once here and
the script's own header is the authority on detail.

---

## Communication

语言规则分两件事:**和维护者说话用什么语言**,与**留在 GitHub 上的产物用什么语言**。
它们可分,并且就在这里分开。

- **在 Claude Code 中与维护者对话一律使用中文**(对话回复、轮次报告等聊天通道里的内容)。
- **GitHub 产物一律使用英文**:issue 与 PR 的标题、正文、评论。维护者裁决
  (2026-08-08),原文引用、未翻译:

  > issue 和 PR 必须用英文，在 claude code 中和我讨论可以用中文。

- **引用中文裁决时保持原文、不翻译**,即使承载它的 issue/PR 正文通篇是英文——改写引文
  就是改写裁决。上面那段引用即是一例:它是维护者的原话,一个字未动。
- 代码、标识符、提交信息(commit messages)、ADR/文档正文等仓库产物保持现有语言惯例(以英文为主),不要因本节而改写。

The rules are split per channel because a merged rule was measured to fail: an agent
holding one instruction that claimed explanatory PR text for Chinese and another
demanding English produced half-Chinese, half-English PR bodies on the same day. One
rule per channel, no overlap.

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

Type-check coverage and its debt counts are ratcheted in CI
(`pnpm check:type-check-coverage`, `pnpm check:type-check-debt`; the script headers are
the authority on detail): every package declares a `typecheck` script or carries a
measured, shrink-only DEBT/EXEMPT ledger entry; new packages arrive covered; a package
that graduates deletes its entry in the same PR; when a re-measure forces a count up,
rewrite the entry's `note` too — a note naming only the old errors reads as "nearly
graduated" to the next author.

Three principles the ratchet's invariants encode, worth knowing before you fight them:

- **Never `exclude` `*.test.ts` / `*.spec.ts` from a package's `tsconfig.json`** —
  `tsc --noEmit` reads that config, so the exclusion hides the tests from the very
  check the `typecheck` script advertises (a green gate over source nothing read). When
  the build config must keep the exclusion, add a sibling `tsconfig.test.json` and name
  it in the `typecheck` script (the `packages/spec` pattern); the sibling may carry its
  own *module* semantics to match vitest, never its own *strictness*.
- **A `@ts-expect-error` in a file no tsc program compiles is a phantom check** — it
  evaluates never, and deleting it leaves every gate just as green (a repo-wide sweep
  once found seventeen retirement pins in that state in one package alone). Before
  writing one, check the file is compiled. Test-layer residue lives in the per-file,
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
real inputs. A test whose reads escape its package is invisible to **both**
`turbo ls --affected` and the `test` task's input hashing, so a pin written to catch
cross-package drift sits green through exactly the drift it exists to catch — on `main`,
with every PR reporting green. The gate finds those tests by **scanning source text**,
deliberately: a detector with no dependencies cannot itself fail to resolve in CI.

The price of a source scan is that it sees only the spellings it knows, and an
unrecognised one produces no flag — which means no declaration, **silently**. So the
recognised list is published rather than left inside the implementation. Seed from
`import.meta.url` or `__dirname`, and write the escaping path as one of:

```ts
const HERE = dirname(fileURLToPath(import.meta.url));   // seed (ESM)
const HERE = __dirname;                                 // seed (CJS)
const HERE = import.meta.dirname;                       // and dirname(import.meta.filename)
const HERE = resolve(fileURLToPath(import.meta.url), '..');  // seed walked from the
                                                        // FILE rather than named;
                                                        // import.meta.filename too
const P = resolve(HERE, '<rel>');                       // join() and path.* too
const P = fileURLToPath(new URL('<rel>', import.meta.url));
const P = new URL('<rel>', import.meta.url);
readFileSync(resolve(HERE, '<rel>'))                    // the same expressions
readFileSync(new URL('<rel>', import.meta.url))         // in argument position
```

The gate prints this list in its failure text too, and `--self-test` pins every entry.
Reaching for a spelling that is not here? **Extend the detector and add a `--self-test`
case in the same edit** — never route around it. An unseen read is the defect above, not
a style question, and a newly recognised shape with no pin is the next silent regression.

Two things it deliberately does not flag: a path that climbs out and lands in
`node_modules` (an installed dependency is not a repo source input, and no turbo glob can
name it), and a path that climbs out and comes straight back in. What it *does* flag is
judged on the **shallowest** point a path reaches, not where it ends — a literal that
climbs past the package root and then descends into a sibling ends at a positive depth
while addressing another package entirely.

### Running the dev server

| Scenario | Command | Notes |
|:---|:---|:---|
| **Frontend debug** (UI in `../objectui` calls backend) | `PORT=3000 pnpm dev` | `pnpm dev` = the **showcase** kitchen-sink app (default; best for exercising the platform). Port **must** be 3000 (UI hard-wired); persistent state; leave running. For the minimal CRM app instead: `PORT=3000 pnpm dev:crm`. |
| **Backend-only debug** | `pnpm dev -- --fresh -p <random>` | Random high port; ephemeral tempdir; **you must kill it** when done |

`--fresh`: ephemeral tempdir (auto-deleted on exit) + `--seed-admin` (POSTs sign-up, prints creds — default `admin@objectos.ai` / `admin123`, override via `--admin-email`/`--admin-password`). The seeded admin is auto-promoted to **platform admin** (the system seed identity `usr_system` is skipped), so Setup/Studio are reachable on first login.

Rules: never run two backends on port 3000; for backend tasks pick a random port and tear it down; **never kill a server you didn't start** (other agents/the user may be using it — see Multi-agent discipline §8); always use a `pnpm dev`/`dev:crm`/`dev:showcase` script (flags after `--` are forwarded), not raw `pnpm --filter`.

```bash
pnpm dev:crm -- --fresh -p 38421   # start; debug via curl
kill $(lsof -ti tcp:38421)         # tear down — tempdir auto-deletes
```

### Frontend (Studio UI) — sibling repo `../objectui`

This repo ships **backend only**. All Studio/Console UI work happens in `../objectui` (separate repo, checked out next to `framework/`). Workflow: edit + commit + push in `../objectui`, then in `framework/` run `pnpm objectui:refresh` to pull its build into `packages/console/`.

Other scripts: `objectui:bump` (pull only), `objectui:build`, `objectui:clean`. ⚠️ Never hand-edit `packages/console/dist/` or `.cache/objectui-*/` — regenerated.

**Moving the pin has a second half: `pnpm sdui:manifest`.** ADR-0082 D4's spec↔registry declaration-parity ratchet reads objectui's `sdui.manifest.json`, which changes only when `.objectui-sha` moves — so the pin bump is the ratchet's trigger, and its only one. It is an **on-demand gate by decision**, never a CI job; `objectui:bump` and `objectui:refresh` both print the reminder. Needs Playwright chromium. Full procedure: `docs/releases-maintenance.md` → "After the pin moves".

**Fast iteration on `../objectui` src (no commit/refresh loop):** run objectui's own console dev server — `cd ../objectui && pnpm --filter @object-ui/console dev` (Vite on **:5180**, HMR). Its `/api` proxy targets `DEV_PROXY_TARGET || http://localhost:3000`, so **run the backend you're testing on :3000** (`PORT=3000 pnpm dev` for showcase) and browse `:5180`. Note `:3001/_console` (or whatever the backend serves) is the **published** console, not your `../objectui` src — only `:5180` reflects local UI edits. See `../objectui/AGENTS.md` for the app-id / localStorage / auth gotchas.

---

## Prime Directives

1. **Zod First.** All schemas start as Zod. Types via `z.infer<typeof X>`. JSON Schemas generated from Zod.
2. **No business logic in `packages/spec`.** Spec = schemas/types/constants only. Runtime logic goes in `core`, `runtime`, or `services/*`.
3. **Naming:**
   - TS config keys → `camelCase` (`maxLength`, `defaultValue`)
   - Machine names (data values) → `snake_case` (`name: 'first_name'`)
   - Error codes → `SCREAMING_SNAKE` (`PERMISSION_DENIED`) — machine constants, not data values; scope and rationale in [ADR-0112](./docs/adr/0112-error-code-vocabulary-and-ledger.md). Not a general license to deviate.
   - Metadata type names → **singular** (`'agent'`, `'view'`, `'flow'`) — matches `MetadataTypeSchema` in `packages/spec/src/kernel/metadata-plugin.zod.ts`
   - REST endpoints → plural (`/api/v1/ai/agents`)
4. **Imports:** Use `@objectstack/spec` namespaces or subpaths. Never relative `../../packages/spec`.
5. **No workarounds.** Adopt sustainable, well-architected solutions — not temporary patches.
6. **Object name = table name.** The object `name` is the canonical id everywhere (API, ObjectQL, REST, SDK, DB table). **Never** set `namespace` (deprecated) or `tableName` (always equals `name`). For module prefixes, embed in the name (`sys_user`, `ai_conversations`).
7. **One Zod source per metadata type.** Each type (`view`, `flow`, `agent`, …) has exactly one schema in `packages/spec/src/{domain}/`. Org overlay opt-in lives only in `allowOrgOverride` on `DEFAULT_METADATA_TYPE_REGISTRY` — no parallel whitelists. See ADR-0005.
8. **North Star alignment.** Read `content/docs/concepts/north-star.mdx` before structural changes. If a change doesn't advance §7 Built, shrink Drift, or unlock Missing — it probably shouldn't ship.
9. **`OS_` env-var prefix + structure.** All ObjectStack-owned env vars MUST start with `OS_`, then follow **`OS_{DOMAIN}_{FEATURE}[_QUALIFIER]`** where `DOMAIN` is the subsystem (`AUTH`, `SEARCH`, `CORS`, `CLOUD`, `DATABASE`, `CLUSTER`, `MCP`, `SSO`, …) so related vars group together (cf. `OS_AUTH_*`, `OS_CORS_*`). Pick the shape by what the var *is*:
   - **Boolean feature flag** → suffix **`_ENABLED`**, default-off / opt-in: `OS_{DOMAIN}_{FEATURE}_ENABLED` (`OS_SSO_ENABLED`, `OS_SCIM_ENABLED`, `OS_SEARCH_PINYIN_ENABLED`). Never a bare `OS_PINYIN_SEARCH` — bare names read as config, not toggles.
   - **Config value** (URL / path / secret / level / count) → `OS_{DOMAIN}_{NAME}` (`OS_CLOUD_URL`, `OS_DATABASE_URL`, `OS_LOG_LEVEL`, `OS_AUTH_SECRET`).
   - **Escape hatch / dangerous override** → **`OS_ALLOW_{X}`** — deliberately ungrouped and scary-looking (`OS_ALLOW_MAIN_EDITS`, `OS_ALLOW_MEMORY_CLUSTER_MULTINODE`).
   - **Opt-out** → `OS_SKIP_{X}` / `OS_DISABLE_{X}`. **Test/CI-only** → `OS_TEST_*` / `OS_EXPECT_*`.
   - Pre-existing vars that don't fit (`OS_METADATA_WRITABLE`, `OS_EAGER_SCHEMAS`, `OS_SERVER_TIMING`) are **debt, not precedent** — new vars follow this rule; rename old ones via the deprecation helper below when touched.

   When renaming a legacy var, use `readEnvWithDeprecation('OS_NEW', 'LEGACY')` from `@objectstack/types` (keeps legacy working one release). Third-party exceptions kept as-is: `NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`, `AI_GATEWAY_*`, `SMTP_*`.
10. **File issues for out-of-scope findings — don't silently expand scope or leave them buried.** When you hit a bug, gap, or unenforced capability that's unrelated to the current task, or too large to fix in scope, open a GitHub issue (`gh issue create`) with a clear repro/decision and link it from your PR. Corollary: **never advertise or demo a capability the runtime doesn't actually deliver** (declared ≠ enforced) — fix it, trim it, or file an issue, but don't fake coverage. The recurring shape: a spec declaring more rule types than the write-path validator enforced was closed by **trimming** what could never be enforced and **implementing** the rest — and even then the claim had to stay narrow, because the evaluator was wired into insert and single-id update while bulk update silently skipped every rule: the same declared-≠-enforced gap one layer down, at the **call site** rather than the `switch`. A `case` label is not enforcement; check the **call site**.
11. **Worktree-first — never edit on the shared `main` checkout.** This repo is edited by **multiple agents at once**; the shared tree has its HEAD switched and reset *under you*, silently clobbering uncommitted work — a feature branch on the *shared* checkout is **not** enough (it still gets switched under you). Before your **first file edit**, be in a dedicated worktree on a feature branch: `git worktree add ../objectstack-<task> -b <branch> main && cd ../objectstack-<task> && pnpm install`. Two PreToolUse hooks **enforce** this — `.claude/hooks/guard-main-checkout.sh` blocks `Edit`/`Write`/`NotebookEdit`, and `.claude/hooks/guard-main-checkout-bash.sh` blocks the identical write arriving through **Bash** (`>`/`>>` redirection, `sed -i`, `perl -i`, `tee`, `cp`, `mv`, `rm`, `touch`) — and both check the **target file's own repo**, so sibling repos (`objectui`/`cloud`) you touch are covered too (deliberate non-task override: `OS_ALLOW_MAIN_EDITS=1`, one switch for both). The Bash guard is precision-first: it never blocks reads, and any shape it cannot resolve with confidence (`bash -c …`, `xargs`, `node -e`, a `$VAR`/glob target) is allowed through — the rule still outranks the hook. **The one thing a worktree does *not* isolate is the stash** — `refs/stash` lives in the **common** `.git`, shared by every worktree; a third hook (`guard-shared-stash.sh`, `OS_ALLOW_STASH=1`) blocks the mutating forms, and the collision-free replacements are in Multi-agent discipline below.
12. **Contract-first — fix the metadata, not the runtime.** This is a metadata-driven framework: `packages/spec` is the one contract between metadata *producers* and the runtime/renderers that *consume* it. When a piece of metadata "doesn't work," ask **first**: *is it spec-compliant? is this the long-term-correct direction?* If the metadata is wrong, fix it at the **producer** and **reject it at authoring/publish** (validation / lint) so the error surfaces loudly — do **not** add a lenient alias or `??` fallback in a consumer (a node executor, the REST layer, a renderer) to tolerate off-spec input. A tolerant fallback fossilizes the wrong convention into a second de-facto contract, dilutes the spec, and hides the producer's bug — one strict contract beats N dialects. This is an **internal** contract (we own both ends), so "be liberal in what you accept" (Postel) does **not** apply — that's for untrusted boundaries. Change the **spec** only when the spec itself is genuinely wrong, and then deliberately (edit the Zod schema + migrate), never by accreting consumer-side fallbacks. When an alias must be tolerated at all, declare it as an **ADR-0087 conversion-layer entry** (never a bare `??`, and no executor shims) so it is declared, loud, tested, and *removable on a schedule* — the `cfg.filter ?? cfg.filters`-style fallbacks the flow executors once carried were all paid down exactly that way, emptying and deleting the executor shim that read them. Stored `sys_metadata` rows (data at rest) are covered from the other side: every rehydration seam replays the **full** conversion chain — retired entries included — via `applyConversionsToStoredItem` (ADR-0087 addendum), so a consumer never needs its own accommodation for a legacy stored shape either. *Worked example:* an AI-authored flow node used wrong key names and template syntax for what the executor reads → the fix was correcting the authoring skill + a publish-gate lint that rejects the wrong shape, **not** a runtime alias in the executor (that alias was proposed and rejected). Strengthens #5.
13. **An accepted ADR binds until a superseding ADR says otherwise.** Reversing a recorded decision is itself a decision: it needs a **new ADR** (or an amended status line on the old one), not a changeset that quietly does the opposite. Before changing behaviour in `docs/adr/`-governed territory, **grep the ADRs for the surface you are touching** — the decision is often older and broader than the code comment in front of you. A reversal of three accepted ADRs once landed as a patch-level changeset and held for a day; the mechanism was not carelessness — **the file being edited never named the ADRs that governed it**, so the author could not have known. Hence the corollary: when you implement an ADR's decision, **leave its id in the code**, and anchor load-bearing spots in `scripts/adr-anchors/` (`pnpm check:adr-anchors`) — **one new JSON file per anchor, named for the path it anchors; there is no index to register it in** — so the next author is told which decision they are standing on. A decision nobody can find is a decision that will be reversed.
14. **⛔ A governed surface is confirmed and merged by the maintainer, by hand — no AI seat merges, queues, or arms auto-merge on a PR whose diff touches one.** Two maintainer rulings, verbatim and untranslated; the second extends the first from ADRs to skills:

    > **adr 只能由维护者自己确认,人工合并,ai 不得擅自合并。** (2026-08-08)

    > **所有 skills 的更新和 adr 类似,需要人工审核** (2026-08-11)

    **Which surfaces — and where that list actually lives.** Three prefixes as of 2026-08-18: `docs/adr/**`; `.claude/skills/**`, the repo-internal playbooks every *later* dispatch reads; and `skills/**`, the catalog published outward to customer projects. ⚠️ **Read that as a reading aid, not as the register.** The set grew twice in two days and no gate ties this prose to it, so a stale count here is a silent, permanent lie. The register is the `GOVERNED_SURFACES` table in `scripts/check-adr-merge-approval.mjs`, reported by the required check **`ADR maintainer approval`** — print today's set rather than trusting the sentence above, and add a fourth surface *there*, never here: `node -e "import('./scripts/check-adr-merge-approval.mjs').then(m=>console.log(m.governedGlobs().join(' · ')))"`

    **Authoring stays open to every seat** — drafting the ADR or the skill, pushing the branch, opening the PR, revising it under review. What is reserved is the **landing**: on any PR whose diff touches a governed prefix, ⛔ never merge it, ⛔ never add it to the merge queue, ⛔ never call `enable_pr_auto_merge`. Judge it on the PR's **file list**, not on its description, and a **mixed diff is not a proportion question** — one path hit is enough; if the rest needs to land, split the governed files into their own PR. **Reviewed + approved + fully green does not override this.** Under #13 an accepted ADR *is* the decision, so merging one is the act of adopting a governance position — the one class of change about which "CI is green" carries no information at all (a thorough, fully-green ADR draft has been closed by the maintainer on demand grounds no gate could evaluate). The two skill prefixes are reserved for a different reason of the same shape: the internal playbooks are the operating protocol every later dispatch reads, and the published catalog lands in codebases this repo cannot see, so a bad merge propagates into work nobody has started yet — and green says nothing about whether it should propagate.

    **Already armed or queued when you read this?** ⚠️ Converting the PR back to **draft** is the only action that reliably removes it from the merge queue; `disable_pr_auto_merge` alone drops the arming but **not** queue membership. Do both, then confirm from the remote that it is in neither the queue nor `origin/main` (§7's draft-flip re-arm note, run backwards). ⚠️ **And do not read draft as a barrier that holds by itself** — a drafted ADR PR has nevertheless been merged, twice, by two different AI seats within one hour of the first ruling above (both ratified retroactively, explicitly setting no precedent), and a skill PR whose own body said it was awaiting a human merge was flipped ready by an unidentified seat and landed by the merge queue with zero reviews of any kind. **The barrier is machine enforcement — and know exactly how much of it there is.** The required check `ADR maintainer approval` covers all three prefixes and stays red while the PR has no standing APPROVED review **or** has auto-merge armed (armed is red whether or not it is approved: auto-merge is a standing instruction to merge later, and the unattended merge happens in the armed-and-approved state). What it does **not** do is read actors, by ruling — maintainer, 2026-08-12, verbatim: 「不要指定具体的人」. Any account with review rights satisfies it, an AI seat included, and no check can see who presses merge. CODEOWNERS routes `docs/adr/` to the maintainer and **nothing routes the two skill prefixes**, so on those the automatic request for his review does not exist either. The machine narrows the hole; this directive is the part that closes it. A seat that has read this far is not thereby licensed to judge an exception; the rule has no exception to judge.

15. **⛔ A version release is performed by the maintainer, by hand — no AI seat publishes, tags, cuts a Release, or triggers a release workflow, and none merges the Version Packages PR.** Maintainer ruling, 2026-08-07, verbatim and untranslated:

    > **刚才我也没提出要求,是哪个ai自己替我发了 rc.4,版本发布必须是人工的。这个要写入规范。**

    Its last sentence is this directive's warrant: 「这个要写入规范」. A rule that binds every seat has to be readable by every seat — which is why it lives here, not only in a lane-specific skill file. **Release-adjacent work stays open to every seat.** The release board, `.objectui-sha` pin bumps, version reconciliation, writing changesets, compiling release notes when asked, and *verifying* release state (`npm view`, `git ls-remote --tags`) are ordinary tasks. What is reserved is the **release act itself**: ⛔ running `changeset publish` / `pnpm run release`, ⛔ pushing a version tag, ⛔ cutting a GitHub Release, ⛔ pushing a runtime image, ⛔ `workflow_dispatch`-ing `release.yml` or any other publish-capable workflow, and ⛔ merging — or queueing, or arming auto-merge on — the **Version Packages** PR (`chore: version packages`). That PR is bot-authored and standing-open by design: it is regenerated on every push to `main`, so "green, current, and nobody has objected" is its permanent resting state, not a signal that it is due. When you find a publish nobody ordered — a tag or an npm version that simply appeared — ⛔ do not "repair" it with a counter-publish: file it as an incident for the maintainer.

    **The precedent is that the mechanical channel fires with nobody deciding to use it.** The release workflow's `on: push` lane once shipped a full release candidate end to end — 69 packages to npm, tags, GitHub Releases, runtime image — with **no human, no dispatch, no seat clicking anything**, twice in one week. So the existence of a path to a release is not authorization to walk it — the same sentence #14 makes about the queue button. ⚠️ **And do not read "the human lane" as a barrier that holds against you.** The publish job is now gated on `workflow_dispatch` behind `environment: release`, and the file's own comment calls that the guarantee because no push, merge-queue landing, bot token or schedule can synthesise the event. True for those four — **an authenticated seat calling the Actions API is not among them.** A `workflow_dispatch` is precisely the event an agent *can* synthesise, and whether the environment carries required reviewers is a repo-Settings fact this file cannot assert. The YAML stops the machine; this directive is the part that stops you.

---

## Multi-agent working discipline

This repo is worked on by **multiple agents in parallel**. **Use one git worktree per
agent/task** (`git worktree add ../objectstack-<task> -b <branch>`; run `pnpm install`
in the new tree) so file systems are physically isolated — mandatory, not a preference
(Prime Directive #11), and hook-enforced. Working in the shared `main` checkout is *not*
a supported fallback: branches get switched and shared files — including ones you just
wrote — get reset *under you* mid-task (full sessions of work were silently reverted
this way before the rule was enforced).

**⛔ `git stash` is the one thing the worktree does NOT isolate — never run a bare
`git stash push`/`pop`.** `refs/stash` lives in the **common** `.git` directory, so
every linked worktree pushes onto and pops off **one shared LIFO stack**. Two agents
stashing at the same time swap entries — your `pop` restores the other agent's changes,
your own work stays on the stack for them to take, and **`pop` reports success**; the
only symptom is another agent's files in your `git status`, after which a `git add -A`
commits their half-finished work into your PR. It has really happened to two parallel
agents mid reverse-verification, both changesets recoverable only as unreachable
commits. A PreToolUse hook (`.claude/hooks/guard-shared-stash.sh`; details and the
`OS_ALLOW_STASH=1` escape in its header, self-test alongside) blocks the mutating forms
— including `stash@{N}`, a *position* in a stack you don't own — and allows
`list`/`show`/`create` and `apply`/`store` pinned to a literal hex object id. It fails
open on shapes it cannot parse, so the rule still outranks the hook. The collision-free
replacements, all inside your own worktree:

```
git diff > /tmp/wip.patch && git checkout -- <paths>    # then: git apply /tmp/wip.patch
git commit -am wip                          # then: git reset --soft HEAD~1
git worktree add ../objectstack-<task>-cmp <ref>        # a second tree to compare against
```

**Doing reverse verification ("revert the fix, watch the diagnostics")? Commit the fix
FIRST.** Committed, restoring is `git checkout <your-branch> -- <path>` — pulling the
file back out of a commit that really exists. Against an **uncommitted** edit,
`git checkout origin/main -- <path>` leaves no restore point at all: the working tree
is the only copy, the stash is banned above, and discarding local modifications is a
normal, silent, exit-0 operation. The change is simply gone — it has happened
repeatedly across the sibling repos, and every recovery depended on the change still
being in the session transcript. If you ever retype a lost change, prove identity with
`git diff` against a saved patch or `git hash-object <path>` — a matching `--stat`
insertion count is **not** byte-identity — then re-run the reverse verification from
the committed state, so the red/green numbers you report are trustworthy.

**⛔ And `git checkout <ref> -- <path>` STAGES what it retrieves — putting the file
back with `cp` undoes only half of it.** It writes the **index** as well as the working
tree, so after `git checkout origin/main -- <path>` … `cp` your copy back, the index
holds `main`'s content while the tree holds yours. Measured here:
`git status --porcelain` shows `MM` (staged *and* unstaged modifications on one path)
and `git show :<path>` reads back `main`'s copy — but `git diff HEAD` is **clean** (it
compares the tree with HEAD and never consults the index), the tests pass because they
read the tree, and a bare `git commit` builds from the **index**: a commit that deletes
your own fix, in a PR whose body accurately describes a change it does not contain (one
real PR had 157 such deletions staged, caught only by the `MM`). Restore with
`git checkout HEAD -- <path>` or `git restore --source=HEAD --staged --worktree <path>`
— both reset index *and* tree — and read `git status --porcelain` before you commit;
⛔ never trust `git diff HEAD` alone after a checkout-from-ref. Better still, don't
stage it at all: `git restore --source=<ref> -- <path>` (no `--staged`) writes the tree
only — porcelain shows a lone unstaged `M`, not `MM` — so prefer it when standing
another ref's version up for a counterfactual.

**Claim the issue BEFORE you write any code.** Assign it to yourself
(`gh issue edit <n> --add-assignee @me`, or `issue_write` with `assignees`) as the
*first* action of the task — before the worktree, before the first read. An unassigned
issue reads as an open invitation: two agents that both start on it burn the same hours
twice, then race to land conflicting shapes for one problem. Already assigned to
someone else? It is taken — pick another or ask; never reassign it to yourself. And
because every agent here shares one GitHub identity, the assignee field alone cannot
answer "is this claim *mine*?" — a claim is two acts: assign, **and a claim comment
carrying your session ID and branch name** (`claude/issue-<n>-<slug>`). Before writing
code, re-read the issue's comments; an earlier claim with a different session ID or
branch means the issue is taken no matter what the assignee field seems to say —
skipping that read is how one issue got implemented twice in one morning. The claim is
also what makes the *finding* rule (Prime Directive #10) safe: once findings become
issues, the list is a real queue other agents read — file unassigned when merely
recording; assign at the moment you actually start.

**State on your PR that you did not set belongs to another actor — ask, never
"correct" it.** Under one shared identity every other participant's write arrives
unsigned: the PM flipping your draft to ready and arming auto-merge, a bot
re-labelling, the platform rewriting your body. The worked failure: a dev found its PR
footer in a form it had never typed, correctly concluded *something is rewriting my
PR*, then extended that to the **draft flag** and flipped the PM's ready PR back to
draft — destroying auto-merge and queue membership at once (§7's draft-flip re-arm
note), invisibly (`pull_request_read` reports neither). The observation was right;
the inference did not follow — body rewriting is a known platform behaviour and is
evidence of nothing else. When state you did not write changes under you: read the
timeline event's actor, or ask. Undo it only once you know who set it and why.

**Write the attribution footer in its session-URL form** — the half of the above you
can act on directly:

```text
_Generated by [Claude Code](https://claude.ai/code)_                       ← stripped on edit
_Generated by [Claude Code](https://claude.ai/code/session_<id>)_          ← survives
```

A body ending in the bare form loses the **whole** footer, `---` separator included, on
every `update_pull_request` edit; the session-URL form survives both write paths.
`create_pull_request` does not strip; it *rewrites* the bare form into the session form
— which is precisely how a body comes back in a shape nobody typed. Which layer does
this is unknown, and the guidance does not depend on the answer — do not spend a
session establishing it. Comments are a different path and unaffected.

Even inside your own worktree, operate defensively:

1. **Only touch the files your task needs.** Don't "fix" unrelated diffs, reverts, or
   other agents' in-flight edits, and don't try to manage the whole working tree. If a
   file you didn't change shows as modified, leave it.
2. **One feature branch + one PR per task.** Branch off `main`. **Never commit task
   work straight to `main`.** Name the branch after the issue it fixes:
   `claude/issue-<n>-<slug>`. The issue number in the name is what makes in-flight work
   *discoverable* — `git ls-remote --heads origin | grep issue-<n>` is a one-command
   pre-check, and the Duplicate Fix Guard workflow warns on fix PRs whose branch names
   no declared issue. A duplicated implementation once stayed invisible partly because
   one branch carried the issue number and the other didn't.
3. **Never `git push --force` / `--force-with-lease`, and never push `main`.** A
   force-push can clobber a parallel agent's work; `main` is shared — land everything
   via PR.
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
   re-verification, done by the platform, race-free. This sanctioned path supersedes
   the older blanket auto-merge ban; the ban's true half survives as the precondition:
   **arm only what is already green and accepted.**

   ⛔ **Two classes of PR never enter this path, however green:** (a) a diff touching
   any **governed surface** (**Prime Directive #14**, which names them and holds the
   current list) — that list is longer than `docs/adr/**` and has grown twice in two
   days, so re-read it rather than recalling it; (b) the **Version Packages** PR, or any PR whose merge performs
   a release (**Prime Directive #15**). Read the PR's file list (`get_files`) **and
   its author** before you arm anything.

   **Green means the gate-carrying jobs' `conclusion` is `success`** — not "no failure
   yet"; `in_progress` is not a pass. Arming a red PR does not queue it, it hides it:
   every poll then misreads "not on `main` yet" as "queued". Always read *two* things
   when checking a landing: the queue branch **and** `origin/main`. And **the queue
   enforces only the required set** — **Lint & Repo Gates** (the whole `check:*` gate
   family, formerly published under a name that described only one of its steps) and
   **TypeScript Type Check** block by maintainer decision (2026-08-07); everything else
   is advisory and rides through, and an advisory red that lands rides `main`'s merge ref
   into every following PR until stanched. A required context is matched by check-run
   name, so a job rename detaches its gate silently — treat those names as contract.
   That is why "arm only on green" is a rule, not a formality.

   **Re-arm awareness** — none of these is a reason to avoid the queue; all are reasons
   to confirm a PR is still *in* it: a red queue build **ejects** your entry and drops
   auto-merge, often on a package your PR never touched (the queue runs the full suite;
   the PR ran affected-only) — diagnose against `merge-queue-triage.yml`'s comment,
   recognise a known-flaky signature, then re-arm once, never reflexively; **collateral
   eviction is silent** (triage comments only on `failure`, so an entry cancelled
   because something *ahead* failed gets nothing) — neither on `main` nor in the queue
   means dropped, re-arm; **flipping back to draft drops auto-merge and queue
   membership at once**, and neither returns by itself — ready *first*, arm *second*.
   One non-fix: **a stale red does not clear by re-running** — `rerun_failed_jobs`
   reuses the original run's commit and merge ref, so a fix that landed on `main` since
   is invisible to it; only a new commit (`git merge origin/main`) helps. Whether a
   direct `gh pr merge` is refused here is deliberately unmeasured — do not establish
   it by attempting one.

   **Fallback, when the queue is unavailable:** merge serially, only after remote CI is
   fully green, rebasing other open branches before merging the next. It loses under
   load (`main` lands a PR every few minutes at peak; a manual merge–reverify loop
   takes ~25) — which is why the queue is the default path, not an optimisation.
8. **Testing needs a server? Start your own temporary one — never stop someone
   else's.** A running dev server you didn't start probably belongs to another agent or
   the user; killing it (or its port) breaks their in-flight work. Spin up your own
   instance on a random high port (`pnpm dev -- --fresh -p <random>`) and **shut it
   down yourself when the task is done** (`kill $(lsof -ti tcp:<port>)`). Don't leave
   orphan servers behind.
9. **After pulling `main` into a long-lived worktree, refresh its build state before
   you trust a single test or gate.** A worktree that has been open across several
   merges accumulates artefacts that are stale relative to the source, and every one of
   them fails **as if your change broke something** — naming other people's exports,
   other packages' files, or config you never touched:

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
   that one needs a real build. None of this is CI-visible (CI checks out fresh), which
   is exactly why it is worth recognising in one step rather than re-diagnosing per
   gate. Only the first row has a gate: `check:dev-prereqs` refuses `pnpm dev` on a
   stale `packages/spec/dist` (content-hash, never mtime); for every other row the
   prescription above is the whole remedy — the gate's own pass line says "existence,
   not freshness" so its green cannot be read as vouching for them.
10. **A clean merge is not a working merge — but scope the re-check to the overlap.**
   Git conflicts on overlapping lines; nothing warns you when two changes are
   individually fine and jointly wrong (a test asserting a response body's exact shape
   has landed while that shape was being changed elsewhere — merged clean, failed CI; a
   domain file has been deleted while another agent's guard still declared it).
   **Before opening a PR, pull `main`, refresh build state (§9), and run the full suite
   once.** For the *subsequent* pre-merge merges of `main` — the ones you do only
   because `main` moved again while CI ran — the full suite is usually re-proving what
   three identical runs already proved, at ~15 minutes per lap while `main` lands a PR
   every few. Scope it instead:
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
   - CI on the PR, and then the merge queue on its rebuilt generation (§7), validates
     the merge commit itself — that second CI round is where joint breakage surfaces,
     and the guards in `scripts/check-*.mjs` exist largely because this class of
     breakage is invisible to `git merge`.
11. **Generated artifacts don't text-merge — a driver defers them and `pre-commit`
   collects the debt.** §10's "never trust git's textual merge of a generated file" is
   mechanical: `.gitattributes` routes the generator-owned artifacts to
   `merge=os-regen` (the list is the `.gitattributes` entries themselves; `pnpm
   check:merge-driver` reconciles both directions), so a merge stops only on the
   hand-written files that actually need you. The driver does **not** regenerate — git
   runs merge drivers while the worktree still holds pre-merge sources, so a generator
   run there would describe a half-merged tree; instead it records each path in
   `$GIT_DIR/os-regen-pending` and `pre-commit` refuses the commit until those
   artifacts check clean. Sequence after a merge unchanged from §9: rebuild, then
   `check:generated --fix` — you just cannot forget it. Worth knowing:
   - **The MERGE commit itself is the one exemption, and it is a deferral, not a
     pass** (maintainer ruling 2026-08-12). `scripts/pm/os-regen-merge.sh` is the
     in-repo authority for landing one of these branches, and its step 3 commits
     the merge **before**
     regenerating on purpose: the driver exits 0 while silently dropping one side, so
     only a separate regeneration commit on a known-good base lets a reviewer read
     "what main brought" apart from "what the change produces". `pre-commit` records
     that merge as a deferral and then holds you to it — the immediately following
     commit must discharge it (every commit until then is refused, and a second merge
     cannot defer on top of an outstanding one), and `.githooks/pre-push` refuses a
     push that still owes one. ⛔ So this step never needs `--no-verify`, which was
     the old spelling and skips *every* pre-commit check rather than this one.
   - **The driver is a LOCAL facility** — the merge queue rebuilds server-side where no
     custom driver runs, so the three hottest artifacts are **sharded** per
     category/entry (`authorable-surface/`, `json-schema.manifest/`, `api-surface/`) to
     keep parallel spec PRs textually disjoint; every gate reads the whole directory as
     one set, so ratchet semantics are unchanged
     (`packages/spec/scripts/lib/sharded-artifacts.ts`).
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

Studio UI: `../objectui` (sibling repo).

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

Root also exports: `defineStack`, `composeStacks`, `defineView`, `defineApp`, `defineFlow`, `defineAgent`, `defineTool`, `defineSkill`.

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
| `content/docs/releases/` | **RELEASE-OWNED** | ❌ Never edit in a code PR. Release notes are written **centrally at release time**, compiled from changesets + the ADR-0087 registries — not accreted a row per PR. Per-PR appends made `releases/v<major>.mdx` the repo's hottest conflict magnet (three PRs raced the same table inside one afternoon), and every manual resolution risks dropping someone else's row. Your PR's input is its **changeset**; for spec removals also the D2/D3 registry entries. Factual error on a releases page → dedicated docs-only PR or an issue, never a rider on code changes. |
| `**/translations/*.generated.ts` (nine packages — `platform-objects`, five plugins, three services) | **AUTO-GEN** | ❌ Never hand-edit the file *structure*. Run `node scripts/check-i18n-bundles.mjs --write` to regenerate all nine (merge mode preserves every existing **translated-locale** value; the default locale `en` is rewritten from the source on every run — it is a copy of the source, not a translation: when the extractor merged `en` too, a stale bundle entry always beat an edited source string, so the served text drifted from the source silently under a green gate. Hand-edits to `en.*.generated.ts` therefore do not survive and belong in the source metadata instead); `pnpm i18n:extract` still covers `platform-objects` alone. Translated-locale *values* (`zh-CN` / `ja-JP` / `es-ES`) are hand-written and expected to be: the gate compares against a merge-mode extract, so editing one of those strings is fine, while adding or dropping keys is drift. `pnpm check:i18n` gates all nine in CI, and `pnpm check:i18n-coverage` ratchets untranslated declared labels. |
| `content/docs/guides/` | hand-written | ✅ Update `meta.json` when adding pages. |
| `content/docs/concepts/` | hand-written | ✅ |
| `content/docs/getting-started/` | hand-written | ✅ |
| `content/docs/protocol/` | hand-written | ✅ |

### Touched `packages/spec`? Regenerate its artifacts BEFORE pushing

`packages/spec` has **eight** checked-in generated artifacts, each with its own CI
gate. All of them live in one job — `TypeScript Type Check` in `lint.yml`, which is
required and has no paths filter, so no gate can go dormant on the PR that breaks it.
That job runs its gates **sequentially**, so the first stale artifact masks every one
behind it, and you get one red build per artifact instead of one for all of them. Match
the change to the gate and regenerate up front:

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
**every** gate and reports **all** stale artifacts at once, which is precisely what CI
cannot do:

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
- ⚠️ **`check:api-surface` and `check:exported-any` read the built `dist/*.d.ts`, not
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

⚠️ **`check:react-declaration-parity` compares two DECLARATIONS, not a declaration
against an implementation** — the props the spec zod schema declares vs the inputs the
objectui registry config declares. A prop both sides declare and no renderer reads is,
to this gate, perfect agreement (dead blocks have shipped through a green run under its
earlier, over-claiming name). Its `spec-only` / `registry-only` / `missing` signals are
real; just don't read it as proof anything renders. It is also the one gate
`check:generated` cannot run at all (`EXTERNAL_INPUT_REQUIRED`): its right-hand side is
objectui's `sdui.manifest.json`, produced only by `pnpm sdui:manifest` driving a real
browser over objectui built at `.objectui-sha`, and it **exits 1** with no usable
manifest — "could not run" is a failure, not a skip (Route & surface ownership §3).
Where the manifest comes from is **settled** (maintainer ruling 2026-08-07): **not from
CI** — it is an on-demand gate whose trigger is the **objectui pin bump**
(`docs/releases-maintenance.md` carries the procedure). Do not "fix" the red by
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
| `examples/**` | Example Author | Minimal, runnable, uses `defineStack` |
| `content/docs/**` | Technical Writer | Respect auto-gen boundaries |
| `../objectui/**` (sibling repo) | Studio UI Engineer | React + Shadcn + Tailwind, dark mode default |

---

## Skills (`skills/`)

Consult the matching `SKILL.md` when working in its domain: `objectstack-platform`, `objectstack-data`, `objectstack-query`, `objectstack-api`, `objectstack-ui`, `objectstack-automation`, `objectstack-ai`, `objectstack-i18n`, `objectstack-formula` (CEL).

`skills/` is the **published** catalog (it ships to customer projects). Repo-internal
agent playbooks live in `.claude/skills/` and must carry `metadata.internal: true`:
`dogfood-verification` (boot and drive the real app in a browser) and
`spec-property-retirement` (ADR-0049 enforce-or-remove — the full retirement kit).

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

**Plugin** (the kernel contract is `init`/`start`/`destroy` —
`packages/core/src/types.ts`; an older `onInstall`/`onEnable`/`onDisable` example
described hooks nothing ever called, and was retired for it):
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

Five rules, each paid for by a real bug. They matter more than usual here because this
repo is largely written by agents, and every one of them is a trap that reads as
reasonable code.

**1. One route, one owner.** Never add a second implementation of a path that another
package already serves, however convenient. A shadowed duplicate is code that `grep`
finds and the runtime never runs — the exact input that makes an agent (or a human)
reason confidently from dead code. It also silently forks every future invariant: a
retired duplicate data surface had to re-learn the anonymous-deny gate, honest batch
capability reporting and discovery accuracy, each after the fact, each because someone
fixed the real owner and never knew about the copy.

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

**5. A new REST route declares its CLOSED query-parameter set on the day it lands.**
Maintainer ruling, 2026-08-12, verbatim and untranslated:

> **裁定:政策 YES —— 闭合查询参数集成为 REST ingress 政策;采纳方式为增量,⛔ 不打大包。**

Open the handler with `refuseUnknownQueryParams(req, res, <EXPORTED_PARAMS>)`
(`packages/rest/src/query-allowlist.ts` — its header is the authority on detail) so an
unrecognised name gets a located `400` instead of being dropped. A handler that reads
the keys it knows and ignores the rest fails **undetectably in both directions**: a
dropped *filter* returns the full set, a dropped key inside `where` returns `200` with
zero rows, and no status, header or field distinguishes either from a real answer — an
AI caller cannot see it at all. This is review-enforceable: a PR adding a `GET` route
that reads `req.query` without declaring a closed set is incomplete.

Three things to get right, all of them measured rather than assumed:

- ⛔ **Measure the set from the handler's ACTUAL read points, never from the docs or
  the card.** It is not "the filters" — it is paging, ordering, format, alias spellings
  and anything middleware reads. **Forgetting `limit` trades a silent-widening bug for
  a loud pagination outage**, which is worse than the defect. ⚠️ **Read the helpers the
  handler calls, not just the handler**: the export route's `?locale=` never appears in
  its body — it is read a frame down, by `extractLocale` behind the call that localises
  the header row — so a set measured from the handler alone would have 400'd every
  localised export that works today. Pin **both halves** per route: a refusal pin
  (status + nested `error.code` + **the service was never called**) beside a
  preservation pin (**the arguments the service actually received**). Neither half is
  optional, and a bare status assertion is not a pin — "still 200" is exactly what the
  defect looked like, and the refusal's whole point is that the service never ran.
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
  A broad wave with thin pins is the failure mode the ruling rejected.

Recognition runs **before** the arity gate (`refuseRepeatedQueryParams`); both answer
the same nested ADR-0112 `VALIDATION_ERROR`, so composing them adds no dialect.

**Verifying any of this:** "who serves this path" is a question about the composed,
*provisioned* runtime — not about which plugin declares it, not about registration
order, and not about a minimal harness that merely boots. The question has been
answered wrongly three times in one investigation, once per each of those shortcuts.
Boot the real composition with its real services, or do not claim an answer.

---

## Degradation log levels — `warn` vs `error`

Nearly every `catch` in this repo is a best-effort degradation, and nearly every one of
them logs `warn`. That default is wrong for a specific, recurring class, and the cost of
getting it wrong is not noise — it is silent data loss. Decide the level with **one
question**, not with an adjective:

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
  who cannot connect it to this line.

**Why this is a rule and not a preference.** The founding incident: a durable
suspended-run store attached to a table that was never created, every write failed into
a `warn` nobody read, and every restart dropped all in-flight approvals — the symptom
surfaced a release after the cause. It is the same failure Prime Directive #10 names —
advertising a capability (here: durability) the runtime does not deliver — and the same
instinct as "Absence must be loud" above: **prefer failing to falling back**, and when
you must fall back, say what was lost.

**An `error` here owes two things**, both, in the first line it prints
(`packages/services/service-automation/src/plugin.ts` `start()` is the reference text):
① the **consequence**, concretely — *what* is not durable, and that the system will
keep looking healthy anyway; ② the **fix** — the composition/config change that
restores durability, or the explicit opt-out that makes the degradation deliberate
(`suspendedRunStore: 'memory'`, `OS_SKIP_SCHEMA_SYNC`). Say it **once**, at the first
degradation, not once per failed write.

**Do not over-apply it.** Escalating a functional degradation to `error` trains
everyone to skim `error` — which is what made the founding incident's `warn` unreadable
in the first place. An `if (!service)` composition branch is usually functional and
belongs at `warn`; a `catch` around a write, a DDL call, or a store initialization is
where this rule bites. **And a failure handed to the CALLER is not a degradation at
all** — the third legal answer: a `catch` that answers `errorFromThrown(e, 400)`, or a
batch whose contract IS a per-item outcome report, does not look normal from the
outside — the requester was told. Do **not** bolt a `logger.error` onto such a site
(on a validation path that emits one durability `error` per rejected keystroke);
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
only (maintainer ruling 2026-08-06, 「裁 3 —— 收窄先行」: prove the false-positive
surface on the persistence layer first; widening is its own issue) — which is also
what lets names as generic as `find`/`findOne`/`count` mean "a storage seam" at all.
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

**Why this is a rule and not a preference.** One showcase cold start produced three
instances in three unrelated subsystems, written by three people at three times: an
auth plugin froze an `undefined` cache handle into its config for the life of the
process (the printed warning sent operators to provision Redis for a problem they did
not have); the automation service asserted eight flows "will fail at execution time"
0.8s before their executor registered — indistinguishable from a deployment that
genuinely lacked the plugin; and the query engine persisted a schema attestation the
same boot was still contradicting, so the next restart rejected its predecessor's
data.

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
hand-edited `scripts/startup-registry-verdict.baseline.json`. Like its durability
sibling it is deliberately narrow and under-matches on purpose rather than risk a false
positive — it cannot discover a new seam, only stop known ones from regressing. Found a
new open registry? Add it to `OPEN_CAPABILITY_REGISTRIES` in the same PR that fixes it.

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
3. **Add a changeset for feature work.** When the change is a feature or functional improvement, run `pnpm changeset` (or add a `.changeset/*.md` entry) describing it before committing. Pure bug fixes do **not** require a changeset.
   **Breaking changesets must carry their migration.** If the change removes or renames anything an author can write (a spec key, an export, a config field), the changeset body must state the FROM → TO mapping and the one-line fix — this text ships to consumers as `CHANGELOG.md` inside the npm package and is what an upgrading agent greps after the tombstone error. Removing an authorable spec key also requires a tombstone so the rejection itself carries the prescription — `retiredKey()` (`packages/spec/src/shared/retired-key.ts`) on a non-strict schema, or an entry in the relevant `UNKNOWN_KEY_GUIDANCE` / `*_RETIRED_KEY_GUIDANCE` map (see `object.zod.ts`, `ai/tool.zod.ts`) when the schema is `.strict()`. The changeset is one of fourteen surfaces a retirement touches — follow the `spec-property-retirement` skill (`.claude/skills/`) rather than reconstructing the kit, and note the two routes imply **opposite** liveness-ledger dispositions.
   **A breaking changeset must also state its ADR-0087 disposition, in writing.** Add exactly one marker to the changeset body — `pnpm check:adr-0087-registration` enforces it, and the CI step is *Require an ADR-0087 disposition on a declared-breaking changeset*:
   ```
   <!-- adr-0087: registered SOME-MIGRATION-ID -->
   <!-- adr-0087: not-required (unpublished) why -->
   <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->
   <!-- adr-0087: not-required (no-migration-prescription) why -->
   ```
   Why it is asked of you at all: the ADR-0087 gates pin ledger ↔ **artifact synchrony**, and the artifacts are a pure projection of the registry — a retirement whose entry was **never written** leaves everything perfectly consistent and every gate green (a removal has shipped that way, caught only by a human comparing by eye). Ledger entries are the sole channel that reaches an upgrader (`objectstack migrate meta`, `spec-changes.json`, the upgrade guide) — for a surface with no spec schema there is no tombstone or schema rejection either. Roughly 1 declared-breaking change in 7 needs an entry, so `not-required` is the ordinary answer and costs one line; the markers are re-verified mechanically, and `no-migration-prescription` is refused when the changeset's own body carries a FROM → TO prescription.
4. **Added or removed a `packages/spec` export? Run `pnpm --filter @objectstack/spec gen:api-surface` and commit the result.** The `TypeScript Type Check` job diffs spec's built export surface against `api-surface/` (one shard per entry point); a new export makes the snapshot stale and turns the job red. It reads the **built `dist` declarations**, so `OS_SKIP_DTS=1` — the flag you reach for to make local builds fast — skips exactly the artifact the gate inspects, and the check passes locally while failing in CI. Same shape for the other generated-artifact gates in that job (`check:docs`, `check:skill-refs`, `check:react-blocks`), which read `src/` and so do reproduce locally.
5. Update `CHANGELOG.md` / `ROADMAP.md` if user-facing or architectural.
6. **Delete temporary artifacts** — screenshots, traces, scratch logs, `.playwright-mcp/`, throwaway `tmp*.ts`, ad-hoc scripts. Repo must look identical to before, minus intended changes.

---

## Edit Sizing

Keep single `edit`/`create` payloads under ~20KB. Split larger changes into multiple sequential edits.
