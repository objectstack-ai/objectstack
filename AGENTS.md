# ObjectStack — AGENTS.md

Primary AI instruction file for this repo. Read natively by Claude Code, GitHub Copilot (coding agent + CLI, since Aug 2025), and other agents — no separate `.github/copilot-instructions.md` mirror needed.

> **v5.0 breaking rename: `project` → `environment`** everywhere (CLI `-e`, `/api/v1/environments/:id`, header `X-Environment-Id`, `OS_ENVIRONMENT_ID`, DB column `environment_id`). No aliases. See ADR-0006. "Project" now only means the npm/monorepo sense.

---

## Communication

语言规则分两件事:**和维护者说话用什么语言**,与**留在 GitHub 上的产物用什么语言**。
它们可分,并且就在这里分开。

- **在 Claude Code 中与维护者对话一律使用中文**(对话回复、轮次报告等聊天通道里的内容)。
- **GitHub 产物一律使用英文**:issue 与 PR 的标题、正文、评论。维护者裁决
  (2026-08-08,#6692),原文引用、未翻译:

  > issue 和 PR 必须用英文，在 claude code 中和我讨论可以用中文。

  这条裁决推翻的是本节此前的写法——它把上面两件事并成一句,并把「PR/issue 讨论中的
  解释性文字」一并划给中文。代价实测过:同一天、同一身份下的 PR 正文一半中文一半英文
  (#6556 中文 / #6691 英文),因为 agent 手里同时握着两条相反的指令(#6692)。
- **引用中文裁决时保持原文、不翻译**,即使承载它的 issue/PR 正文通篇是英文——改写引文
  就是改写裁决。上面那段引用即是一例:它是维护者的原话,一个字未动。
- 代码、标识符、提交信息(commit messages)、ADR/文档正文等仓库产物保持现有语言惯例(以英文为主),不要因本节而改写。

---

## Build & Test

```bash
pnpm install          # deps
pnpm setup            # first-time: install + build spec
pnpm build            # turbo build (excludes docs)
pnpm test             # turbo test
pnpm typecheck        # turbo typecheck — per-package `tsc --noEmit`; tsup/vitest never type-check (#4311)
pnpm docs:dev         # docs site
```

Type-check coverage is ratcheted (`pnpm check:type-check-coverage`, CI-gated): every
workspace package declares a `typecheck` script or carries a measured DEBT/EXEMPT entry
in `scripts/check-type-check-coverage.mjs`. New packages must arrive covered; a package
that graduates deletes its ledger entry in the same PR.

The ledger numbers are ratcheted too (`pnpm check:type-check-debt`, run in the same CI
job after its build step): every DEBT/TEST_DEBT count is re-run through `tsc --noEmit`,
and a count ABOVE its recorded number fails. Below is only an informational
"can be lowered" line — improvements never owe CI a bookkeeping edit. Before #5278 the
gate asserted only that *some* positive number was written down, so the real counts had
drifted up to 2.25x while it reported success. When a re-measure makes you raise an
entry, rewrite its `note` as well: the composition drifts too, and a note that still
names only the old errors reads as "nearly graduated" to the next author.

**Do not `exclude` `*.test.ts` / `*.spec.ts` from a package's `tsconfig.json`.** `tsc
--noEmit` reads that config, so an exclusion there hides the tests from the check the
`typecheck` script advertises — a green gate over source nothing read, which is the
#4311 defect itself. The ratchet's `TESTS_COVERED` invariant fails on any new exclusion;
the packages that already had one carry a measured `TEST_DEBT` entry and graduate by
dropping the exclusion — or, when the build config must keep the exclusion (ci.yml gates
that no test file reaches the published artifact), by adding a **sibling
`tsconfig.test.json` and naming it in the `typecheck` script**, which is what
`packages/spec` does since #5286. The sibling may carry its own *module* semantics to
match how vitest executes the files (`module: esnext`, `moduleResolution: bundler`) —
never its own *strictness*: `strict` and friends are inherited, untouched.

**A `@ts-expect-error` in a file no tsc program compiles is a phantom check** — the
`PINS_CHECKED` invariant of the same ratchet, repo-wide. `@ts-expect-error` is the
"tsc is the best sweeper" channel the spec-property-retirement playbook leans on: the
directive is meant to go red the day a removed key comes back. Outside a program it
evaluates never, and *deleting the directive leaves every gate just as green* — which is
how spec's 17 retirement pins across 5 files were found (#5286), and the repo-wide sweep
that followed found the eighteenth in `packages/client` (#5449). Before writing one,
check the file is compiled. A package whose test layer still carries residue holds it in
a per-file, exactly-measured, shrink-only ledger next to its `tsconfig.test.json`
(`<package>/test-typecheck-debt.json`, regenerated with
`pnpm --filter <package> gen:test-typecheck-debt`): a file not listed there may have no
type errors at all. The gate behind both is one shared script,
`scripts/check-test-typecheck.mts --package <dir>` — onboard a package by wiring its
`typecheck` script to it, never by copying it.

One trap worth knowing before you read any of these counts: under `moduleResolution:
NodeNext` a relative import missing its `.js` extension does not resolve, every symbol it
names becomes `any`, and the callbacks over those symbols then report TS7006 "implicitly
any". A pile of TS7006 is usually one broken import upstream, not a package that needs
type annotations — fix the extension first and re-measure.

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

**Moving the pin has a second half: `pnpm sdui:manifest`.** ADR-0082 D4's spec↔registry declaration-parity ratchet reads objectui's `sdui.manifest.json`, which changes only when `.objectui-sha` moves — so the pin bump is the ratchet's trigger, and its only one. It is an **on-demand gate by decision** (#5960), never a CI job; `objectui:bump` and `objectui:refresh` both print the reminder. Needs Playwright chromium. Full procedure: `docs/releases-maintenance.md` → "After the pin moves".

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

   When renaming a legacy var, use `readEnvWithDeprecation('OS_NEW', 'LEGACY')` from `@objectstack/types` (keeps legacy working one release). Third-party exceptions kept as-is: `NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`, `AI_GATEWAY_*`, `SMTP_*`. See #1382.
10. **File issues for out-of-scope findings — don't silently expand scope or leave them buried.** When you hit a bug, gap, or unenforced capability that's unrelated to the current task, or too large to fix in scope, open a GitHub issue (`gh issue create`) with a clear repro/decision and link it from your PR. Corollary: **never advertise or demo a capability the runtime doesn't actually deliver** (declared ≠ enforced) — fix it, trim it, or file an issue, but don't fake coverage. Example: the spec once declared 9 validation-rule types while the write-path validator enforced only 3 (`state_machine`/`script`/`cross_field`); the gap was filed as #1475 rather than demoed in the showcase, then closed by **trimming** what could never be enforced (`unique`/`async`/`custom`) and **implementing** the rest — the spec now declares 6 and `rule-validator.ts` handles all 6. Note how narrow that claim stayed even so: the evaluator was wired into insert and single-id update only, so a bulk `updateMany` silently skipped every rule — a second `declared ≠ enforced` gap one layer down, at the **call site** rather than the `switch`; filed as #3106 and closed by evaluating the bulk match set per row. A `case` label is not enforcement; check the **call site**.
11. **Worktree-first — never edit on the shared `main` checkout.** This repo is edited by **multiple agents at once**; the shared `main` tree has its HEAD switched and reset *under you*, silently clobbering uncommitted work. Before your **first file edit**, you MUST be in a dedicated worktree on a feature branch: `git worktree add ../objectstack-<task> -b <branch> main && cd ../objectstack-<task> && pnpm install`. Two PreToolUse hooks **enforce** this — `.claude/hooks/guard-main-checkout.sh` blocks `Edit`/`Write`/`NotebookEdit`, and `.claude/hooks/guard-main-checkout-bash.sh` blocks the identical write arriving through **Bash** (`>`/`>>` redirection, `sed -i`, `perl -i`, `tee`, `cp`, `mv`, `rm`, `touch`) — unless the target is in a dedicated **worktree** — a feature branch on the *shared* checkout is **not** enough (it still gets switched under you) — and both check the **target file's own repo**, so sibling repos (`objectui`/`cloud`) you touch are covered too (override for a deliberate non-task fix with `OS_ALLOW_MAIN_EDITS=1`, one switch for both). The Bash guard is precision-first: it never blocks reads, and any shape it cannot resolve with confidence (`bash -c …`, `xargs`, `node -e`, a `$VAR`/glob target) is allowed through — the rule still outranks the hook. **The one thing a worktree does *not* isolate is the stash**: `refs/stash` lives in the **common** `.git`, so a bare `git stash push`/`pop` operates on a LIFO stack shared with every other worktree — objectui#3430 swapped two agents' in-flight changes through it, silently. A third hook (`guard-shared-stash.sh`, `OS_ALLOW_STASH=1`) blocks the mutating forms; the collision-free replacements are in the discipline section below. Full playbook below.
12. **Contract-first — fix the metadata, not the runtime.** This is a metadata-driven framework: `packages/spec` is the one contract between metadata *producers* and the runtime/renderers that *consume* it. When a piece of metadata "doesn't work," ask **first**: *is it spec-compliant? is this the long-term-correct direction?* If the metadata is wrong, fix it at the **producer** and **reject it at authoring/publish** (validation / lint) so the error surfaces loudly — do **not** add a lenient alias or `??` fallback in the consumer (a node executor, the REST layer, a renderer) to tolerate off-spec input. A tolerant fallback fossilizes the wrong convention into a second de-facto contract, dilutes the spec, and hides the producer's bug — one strict contract beats N dialects. This is an **internal** contract (we own both ends), so "be liberal in what you accept" (Postel) does **not** apply — that's for untrusted boundaries. Change the **spec** only when the spec itself is genuinely wrong, and then deliberately (edit the Zod schema + migrate), never by accreting consumer-side fallbacks. The `cfg.filter ?? cfg.filters` / `cfg.objectName ?? cfg.object` fallbacks the flow executors once carried are **debt to pay down, not a pattern to copy** — and the way they are being paid down is the pattern to copy. `filters` → `filter` has **graduated** into the ADR-0087 D2 conversion layer (`flow-node-crud-filter-alias`): rewritten to the canonical key at load, including the `AutomationEngine.registerFlow` rehydration seam, so the CRUD executors read `cfg.filter` directly and no consumer-side fallback survives. `object` → `objectName` and the six open-coded stragglers #3796 tracked (notify `to`/`subject`/`body`/`url`, script `functionName`/`input`) graduated the same way at protocol 17 (`flow-node-crud-object-alias`, `flow-node-notify-config-aliases`, `flow-node-script-config-aliases`), emptying the `readAliasedConfig` executor shim — deleted with them. When you must tolerate an alias at all, declare it as a conversion-layer entry (never a bare `??`, and no new executor shims) so it is declared, loud, tested, and *removable on a schedule*. Stored `sys_metadata` rows (data at rest) are covered from the other side: every rehydration seam replays the **full** conversion chain — retired entries included — via `applyConversionsToStoredItem` (#3903, ADR-0087 addendum), so a consumer never needs its own accommodation for a legacy stored shape either. *Worked example:* an AI-authored `create_record` used `fieldValues` / `today()` / `{{trigger.record.id}}` while the executor reads `fields` / `{TODAY()}` / `{record.id}` → the fix was correcting the authoring skill + a publish-gate lint that rejects the wrong shape (cloud#688), **not** a `cfg.fields ?? cfg.fieldValues` runtime alias (framework#2419, rejected). Strengthens #5.
13. **An accepted ADR binds until a superseding ADR says otherwise.** Reversing a recorded decision is itself a decision: it needs a **new ADR** (or an amended status line on the old one), not a changeset that quietly does the opposite. Before changing behaviour in `docs/adr/`-governed territory, **grep the ADRs for the surface you are touching** — the decision is often older and broader than the code comment in front of you. *Worked example:* three accepted ADRs said `sys_member.role` must never carry RBAC authority (ADR-0057 D4 "never as the authority for RBAC", ADR-0090 D3's word ban "distribution = `position`", ADR-0095 D3 "no enforcement-time code path may consult the better-auth role"). A patch-level changeset made app-declared names storable there anyway; a follow-up made it automatic in every host; the reversal held for a day and the tracking issue was closed, reopened and rewritten three times while the cause moved (#3723 → ADR-0108). The mechanism was not carelessness — **the file being edited never named the ADRs that governed it**, so the author could not have known. Hence the corollary: when you implement an ADR's decision, **leave its id in the code**, and anchor load-bearing spots in `scripts/adr-anchors.json` (`pnpm check:adr-anchors`) so the next author is told which decision they are standing on. A decision nobody can find is a decision that will be reversed.
14. **⛔ An ADR is confirmed and merged by the maintainer, by hand — no AI seat merges, queues, or arms auto-merge on a `docs/adr/**` PR.** Maintainer ruling, 2026-08-08 (#6741), verbatim and untranslated:

    > **adr 只能由维护者自己确认,人工合并,ai 不得擅自合并。**

    **Authoring stays open to every seat.** Drafting an ADR, pushing the branch, opening the PR, revising it under review — all permitted, and none of it is what this directive touches. What is reserved is the **landing**: on any PR whose diff touches `docs/adr/**`, ⛔ never merge it, ⛔ never add it to the merge queue, ⛔ never call `enable_pr_auto_merge`. Judge it on the PR's **file list**, not on its description, and a **mixed diff is not a proportion question** — one path hit is enough; if the rest needs to land, split the ADR into its own PR. **Reviewed + approved + fully green does not override this.** Under #13 an accepted ADR *is* the decision, so merging one is the act of adopting a governance position — the one class of change about which "CI is green" carries no information at all. *Worked example:* #6668 — a thorough, fully-green, correctly-measured ADR draft for a capability **nobody had asked for**, closed by the maintainer on demand grounds no gate could have evaluated. Structurally identical to the version-release prohibition (maintainer 2026-08-07, #6170): in both, the existence of a mechanical path — a queue button, an `auto_merge` call — is not authorization to use it.

    **Already armed or queued when you read this?** ⚠️ Converting the PR back to **draft** is the only action that reliably removes it from the merge queue; `disable_pr_auto_merge` alone drops the arming but **not** queue membership. Do both, then confirm from the remote that it is in neither the queue nor `origin/main` (§7's third re-arm situation, run backwards).

    ⚠️ **And do not read draft as a barrier.** Measured on **#6732**: `draft: true` on the PR that was nevertheless merged at 14:38:56Z on 2026-08-08 — *after* exactly that disable-plus-draft reversal. Draft is a speed bump; the barrier is machine enforcement (**#6785** — `docs/adr/` in CODEOWNERS plus a required check that stays red unless the maintainer's own account has approved). Why that gate exists is this directive's own failure record: within one hour of the ruling, two **different** AI seats merged ADR PRs — #6671 at 14:23:32Z by `os-zhuang`, #6732 at 14:38:56Z by `os-project-manager`. The maintainer confirmed neither was theirs and ratified both retroactively — those two only, explicitly setting no precedent. So a seat that has read this far is not thereby licensed to judge an exception; the rule has no exception to judge.

---

## Multi-agent working discipline

This repo is worked on by **multiple agents in parallel**. **Use one git
worktree per agent/task** (`git worktree add ../objectstack-<task> -b <branch>`;
run `pnpm install` in the new tree) so file systems are physically isolated —
this is mandatory, not a preference (Prime Directive #11), and a PreToolUse hook
blocks edits made while on the shared `main` branch. Working in the shared `main`
checkout is *not* a supported fallback: branches get switched and shared files —
including ones you just wrote — get reset *under you* mid-task (a full session's
work was silently reverted twice before this rule was enforced).

**⛔ `git stash` is the one thing the worktree does NOT isolate — never run a bare
`git stash push`/`pop`.** The worktree gives you your own working tree and your own
HEAD; it does **not** give you your own stash. `refs/stash` and its reflog live in the
**common** `.git` directory, so every linked worktree pushes onto and pops off **one
shared LIFO stack**. Two agents stashing at the same time swap entries: A's `pop`
restores B's changes into A's worktree, A's own work stays on the stack for B to take,
and **`pop` reports success** — the only symptom is another agent's files appearing in
your `git status`, after which a `git add -A` commits their half-finished work into your
PR. Not hypothetical: objectui#3430 (2026-08-06) did exactly this to two parallel dev
agents mid reverse-verification, and both changesets survived only as unreachable commits
whose SHAs happened to still be in scrollback — once the stack empties, `refs/stash` and
`logs/refs/stash` are gone (`git reflog refs/stash` → `fatal: ambiguous argument`) and a
`git gc` in between makes the loss permanent. Reverse verification ("revert the fix, watch
the diagnostics") is the workflow every dev agent runs, which is exactly why the collision
window is wide. Use one of these instead — no shared state, all inside your own worktree:

```
git checkout origin/main -- <path>          # then: git checkout <your-branch> -- <path>
git diff > /tmp/wip.patch && git checkout -- <paths>    # then: git apply /tmp/wip.patch
git commit -am wip                          # then: git reset --soft HEAD~1
git worktree add ../objectstack-<task>-cmp <ref>        # a second tree to compare against
```

A third PreToolUse hook (`.claude/hooks/guard-shared-stash.sh`, mirrored from objectui
after that incident — #5742) enforces this on the `Bash` matcher: it blocks the mutating
forms (`push`/`pop`/`save`/`drop`/`clear`/`branch`, including `stash@{N}` positions, which
are positions in a stack you don't own) and allows what cannot take another agent's entry
— `git stash list`/`show`/`create`, and `apply`/`store` pinned to a **literal hex object
id**. It fails open on shapes it cannot parse (`bash -c …`, `xargs`), so the rule still
outranks the hook. Deliberate exception when the stack really is yours alone:
`OS_ALLOW_STASH=1`. Changing the hook? Re-run `.claude/hooks/guard-shared-stash.selftest.sh`.

**Claim the issue BEFORE you write any code.** Assign it to yourself
(`gh issue edit <n> --add-assignee @me`, or the `issue_write` MCP tool with
`assignees`) as the *first* action of the task — before the worktree, before the
first read. An unassigned issue reads as an open invitation, and several agents
work this repo at once: two that both start on it burn the same hours twice and
then race to land conflicting shapes for the same problem, which is worse than
either one alone. If it is already assigned to someone else it is taken — pick
another, or say so and ask; never reassign it to yourself.

Because every agent here shares one GitHub identity, the assignee field alone
cannot answer "is this claim *mine*?" — seeing your own shared name on an issue
is exactly what another session's claim looks like. So a claim is two acts, not
one: assign, **and leave a claim comment carrying your session ID and branch
name** (`claude/issue-<n>-<slug>`). Before writing code, re-read the issue's
comments; an earlier claim comment with a different session ID or branch means
the issue is taken no matter what the assignee field seems to say. Skipping
this read is how #4551 got implemented twice in one morning (#4555 and #4559 —
post-mortem in #4588), and misreading shared-identity state is also how a
maintainer's manual ready-flip got reverted by an agent that assumed its own
write had failed.

**State on your PR that you did not set belongs to another actor — ask, never
"correct" it.** That is the same misread one step on, and the more expensive
half. Under one shared identity every other participant's write arrives
unsigned: the PM flipping your draft to ready and arming auto-merge, a bot
re-labelling, the platform rewriting your body. #6567 is the worked example —
a dev read its own PR body back, found the trailing `Generated by [Claude
Code]` footer in a form it had never typed, correctly concluded *something is
rewriting my PR*, then carried that conclusion to the **draft flag** and
flipped the PM's ready PR back to draft. That drops auto-merge and queue
membership at once (§7's third re-arm situation), and `pull_request_read`
reports neither, so the agent could not see what it had destroyed. The
observation was right; the second inference did not follow from it — body
rewriting is a known platform behaviour and is **evidence of nothing else**.
So when state you did not write changes under you: read the timeline event's
actor, or ask the PM. Undo it only once you know who set it and why.

**Write the attribution footer in its session-URL form** — that is the half of
the above you can act on directly. Measured on PR #6556 and recorded in #6567:

```text
_Generated by [Claude Code](https://claude.ai/code)_                       ← stripped on edit
_Generated by [Claude Code](https://claude.ai/code/session_<id>)_          ← survives
```

A body ending in the bare form loses the **whole** footer, `---` separator
included, on every `update_pull_request` edit (reproduced twice, including with
a blank line before the separator), while the session-URL form survives both
write paths — #6556 still carries it. `create_pull_request` does not
strip; it *rewrites* the bare form into the session form, which is precisely
how a body comes back in a shape nobody typed. **Which layer does this is
unknown** — platform sanitizer, MCP tool layer, or a workflow's body
post-processing — and the guidance does not depend on the answer, so nobody
should spend a session establishing it. Comments are a different path and are
unaffected: the bare form survives untouched in issue and PR comments,
including the two on #6567 itself.

The claim is also what makes the *finding* rule (Prime Directive #10) safe to
follow. Once out-of-scope discoveries become issues, the issue list is a real
queue other agents read, and a claim is the only thing separating "someone is on
this" from "nobody has looked yet". File it unassigned when you are merely
recording a finding; assign it at the moment you actually start.

Even inside your own worktree, operate defensively:

1. **Only touch the files your task needs.** Don't "fix" unrelated diffs,
   reverts, or other agents' in-flight edits, and don't try to manage the whole
   working tree. If a file you didn't change shows as modified, leave it.
2. **One feature branch + one PR per task.** Branch off `main`. **Never commit
   task work straight to `main`.** Name the branch after the issue it fixes:
   `claude/issue-<n>-<slug>`. The issue number in the name is what makes
   in-flight work *discoverable* — `git ls-remote --heads origin | grep
   issue-<n>` is a one-command pre-check, and the Duplicate Fix Guard workflow
   warns on fix PRs whose branch names no declared issue. The #4555/#4559
   duplicate (#4588) stayed invisible partly because one branch carried the
   issue number and the other didn't.
3. **Never `git push --force` / `--force-with-lease`, and never push `main`.** A
   force-push can clobber a parallel agent's work; `main` is shared — land
   everything via PR.
4. **Verify the current branch before every commit/push**
   (`git rev-parse --abbrev-ref HEAD`). HEAD may have been switched by another
   agent — if it isn't your feature branch, stop and re-checkout before pushing.
5. **Shared files (barrels/registries like `builtin/index.ts`): edit → `git add`
   → commit atomically, then confirm the commit really contains your lines**
   (`git show HEAD:<file> | grep <yourChange>`). A concurrent edit can revert
   your working-tree change between the edit and the commit. On a real conflict,
   re-apply only *your* lines and let the PR merge integrate the rest.
6. **Don't rebase or force-update shared branches** to tidy other agents' commits.
7. **Land through the merge queue: arm auto-merge on a PR that is already
   green, accepted and non-draft, then let the queue merge it.** Arming is how
   you enter the queue, and the queue is what makes arming safe — it rebuilds
   your PR *as merged onto the current `main`*, re-runs the subscribing
   workflows on that rebuilt generation, and lands it only if the required ones
   pass. That is the §10 re-verification, done by the platform, race-free.

   ⛔ **One class of PR never enters this path, however green: a diff that
   touches `docs/adr/**`.** Do not merge it, do not queue it, do not arm it —
   read the PR's file list (`get_files`) before you arm anything, and see
   **Prime Directive #14** for the ruling, for why "accepted and green" is not
   an exception, and for how to get an already-queued one back out.

   **What "the queue validates" means here, measured** (`origin/main`,
   2026-08-07): three of this repo's 22 workflows carry an `on: merge_group:`
   trigger — `ci.yml`, `lint.yml`, `spec-liveness-check.yml` — and the Actions
   API reports **2742** `merge_group` runs, the most recent 30 all on
   `gh-readonly-queue/main/pr-<n>-<sha>` refs, all three workflows, all green.
   A fourth workflow, `merge-queue-triage.yml`, is *not* a subscriber: it
   watches those runs through `workflow_run` and comments the diagnosis on the
   PR when a queue build goes red (#4859).

   **This supersedes the older "never `gh pr merge --auto`" ban.** Its premise —
   auto-merge lands a still-red PR on shared `main` (#1475) — is inverted by
   rebuild-then-land, and the ban forbade what is now the sanctioned path. Its
   *true half* survives, as a precondition rather than a prohibition: **arm only
   what is already green and accepted**, where green means the gate-carrying
   jobs' `conclusion` is `success`, not "no failure yet" — `in_progress` is not
   a pass. Arming a red PR does not queue it, it hides it: #4852 sat armed from
   10:15 for **100 minutes** without ever entering the queue, every poll
   misreading "not on `main` yet" as "queued". So always read *two* things when
   checking on a landing: the queue branch **and** `origin/main`.

   **The queue enforces only the required set; everything else is advisory and
   rides through.** #6067's final queue generation
   (`gh-readonly-queue/main/pr-6067-db0d53c2…`) had `Lint & Type Check` at
   `completed/failure` — run 31136745851, concluded 01:12:11Z — and merged at
   01:13Z regardless; the `check:slot-lookup` red it carried then rode `main`'s
   merge ref into every following PR's ESLint job until it was stanched (#6100,
   the same shape as #5584 → #5601 → hot-fix #5615). Governance half: **#5617**,
   under which the maintainer on 2026-08-07 added **ESLint** and **TypeScript
   Type Check** to both `main`'s required-status-check set and the queue's check
   set, so those two now block — the audit archived on that issue also lists
   which other jobs can and cannot safely join them. A gate outside that set
   stops nothing, which is why "arm only on green" is a rule and not a
   formality.

   **Three re-arm situations this repo has actually hit.** None of them is a
   reason to avoid the queue; all are reasons to confirm a PR is still *in* it:
   - **A red queue build ejects your entry and drops the auto-merge.** The
     failure is often in a package your PR never touched, because the queue runs
     the *full* suite while the PR ran affected-only. #6059 was ejected at
     01:03:02Z on a known flaky (`datasource-pool-support.test.ts`, #6044),
     diagnosed against the triage comment, re-armed at 01:04:15Z and landed at
     01:25:00Z. Recognise the signature first, then re-arm once — never re-queue
     reflexively.
   - **Collateral eviction is silent by design.** `merge-queue-triage.yml`
     comments only on `conclusion == failure`; an entry cancelled because
     something *ahead* of it failed gets nothing, since that outcome says
     nothing about your PR. A PR that is neither on `main` nor in the queue was
     dropped — re-arm it.
   - **Flipping back to draft drops auto-merge and queue membership at once, and
     neither returns by itself.** The order is therefore fixed: ready *first*,
     arm *second*. (This one is the repo's standing operating note —
     `.claude/skills/pm-dispatch/SKILL.md` note 1 — not an API measurement.)

   And one non-fix: **a stale red does not clear by re-running.**
   `rerun_failed_jobs` reuses the original run's commit and merge ref, so it
   cannot see a fix that landed on `main` since. Compare the fix's merge time
   against the run's creation time; if the fix is later, only a new commit
   (`git merge origin/main`) helps — #4852's red was byte-identical across a
   rerun until #4856 landed.

   **Not measured here:** whether a direct, non-auto `gh pr merge` is refused
   with `405 Changes must be made through the merge queue`. Establishing that
   would mean actually attempting a merge on a live PR, which is not an
   experiment worth running. objectui returns 405; that is **not** extrapolated
   to this repo (objectui#3243) — separate rulesets, and #5617's cross-repo
   audit found the two configured differently.

   **Fallback, when the queue is unavailable:** the old manual protocol — merge
   serially, only after remote CI is fully green, rebasing other open branches
   before merging the next one. It is a fallback because it loses under load:
   `main` can land a PR every few minutes at peak while a manual merge–reverify
   loop takes ~25 minutes, so one PR went three full green cycles without
   managing to land. That is a livelock, not a discipline failure — and it is
   why the queue is the default path rather than an optimisation.
8. **Testing needs a server? Start your own temporary one — never stop someone
   else's.** A running dev server you didn't start probably belongs to another
   agent or the user; killing it (or its port) breaks their in-flight work. Spin
   up your own instance on a random high port (`pnpm dev -- --fresh -p <random>`)
   and **shut it down yourself when the task is done**
   (`kill $(lsof -ti tcp:<port>)`). Don't leave orphan servers behind.
9. **After pulling `main` into a long-lived worktree, refresh its build state
   before you trust a single test or gate.** A worktree that has been open across
   several merges accumulates artefacts that are stale relative to the source, and
   every one of them fails **as if your change broke something** — naming other
   people's exports, other packages' files, or config you never touched:

   | stale artefact | how it presents | why it lies |
   |---|---|---|
   | `packages/spec/dist` | `check:api-surface` reports *other people's* exports as "N breaking (removed/narrowed)"; `check:i18n-coverage` rejects an example config for a value the spec allows | both read the built `.d.ts`, not `src/` |
   | `node_modules` | a package fails to resolve a dependency it plainly declares (`Cannot find package 'hono'`) | the merge moved `pnpm-lock.yaml` |
   | `packages/runtime/.objectstack/` | `datasource-autoconnect` sees each row 6× | gitignored fixture state accumulating across runs |
   | `.cache/objectui-*` | `pnpm lint` reports dozens of errors in files you have never opened | a full objectui checkout left by `build-console.sh`, linted as if it were ours |

   So after any `git merge origin/main`:
   `pnpm install --frozen-lockfile && pnpm build && rm -rf packages/runtime/.objectstack`
   (add `rm -rf .cache` if you have run the console build). Note `OS_SKIP_DTS=1`
   keeps a build fast but leaves no `.d.ts`, so `gen:api-surface` cannot run at
   all under it — that one needs a real build.

   None of this is CI-visible: CI checks out fresh and installs clean. It costs
   only *your* time, which is exactly why it is worth recognising in one step
   rather than re-diagnosing per gate.
10. **A clean merge is not a working merge — but scope the re-check to the
   overlap.** Git conflicts on overlapping lines; nothing warns you when two
   changes are individually fine and jointly wrong. Real examples from one
   branch's lifetime: a test asserting a response body's exact shape landed
   while that shape was being changed elsewhere (merged clean, failed CI); a
   domain file was deleted while another agent's guard still declared it.
   **Before opening a PR, pull `main`, refresh build state (§9), and run the
   full suite once.** For the *subsequent* pre-merge merges of `main` — the
   ones you do only because `main` moved again while CI ran — the full suite is
   usually re-proving what three identical runs already proved, at ~15 minutes
   per lap while `main` lands a PR every few. Scope it instead:
   - **Always:** rebuild what the merge touched, and if `packages/spec` moved
     on either side, `pnpm --filter @objectstack/spec build && pnpm --filter
     @objectstack/spec check:generated` — generated snapshots (`api-surface`,
     baselines) are the classic jointly-wrong artifact, and only a rebuild of
     the merged source can validate them (never trust git's textual merge of a
     generated file). Then assert your branch's *delta vs `main`* is still
     exactly what your PR intends (e.g. "N removed / 0 added").
   - **Full `pnpm typecheck && pnpm test` again only when** the incoming
     commits touch the same packages or the same behavior your diff does, or a
     conflict occurred outside trivially-mechanical files.
   - CI on the PR, and then the merge queue on its rebuilt generation (§7),
     validates the merge commit itself — that second CI round is where joint
     breakage surfaces, and
     the guards in `scripts/check-*.mjs` exist largely because this class of
     breakage is invisible to `git merge`.
11. **Generated artifacts don't text-merge — a driver defers them and
   `pre-commit` collects the debt.** §10's "never trust git's textual merge of a
   generated file" is now mechanical (#4675). `.gitattributes` routes the
   generator-owned artifacts (`spec-changes.json`, `authorable-surface/**`,
   `authorable-surface.base.json`, `api-surface/**`,
   `api-surface-signatures.json`, `json-schema.manifest/**`,
   `docs/protocol-upgrade-guide.md`, `content/docs/references/**`) to
   `merge=os-regen`, so a merge that used to stop on conflicts across all of
   them now stops only on the hand-written files that actually need you.

   **The driver is a LOCAL facility, and #5837 is where that bound showed.** The
   GitHub merge queue rebuilds each PR server-side, where no custom merge driver
   runs — so two PRs that both touched `authorable-surface.json` (a 310KB sorted
   array every spec PR rewrites) were a plain textual conflict there and the
   second was evicted, capping the spec lane at one PR at a time. The three
   hottest artifacts are therefore **sharded**: `authorable-surface/<category>.json`,
   `json-schema.manifest/<category>.json`, `api-surface/<entry>.json`. PRs
   touching different categories now touch disjoint files, and the driver keeps
   the residue (two PRs in the same category). Every gate reads the whole
   directory as one set, so the ratchet semantics are unchanged — see
   `packages/spec/scripts/lib/sharded-artifacts.ts`. Deliberately still single
   files: `spec-changes.json` (keyed by version), `api-surface-signatures.json`
   (1.3KB) and `authorable-surface.base.json` (written only by an explicit
   `--update-base`, so never on the churn path).

   The driver does **not** regenerate. Git runs merge drivers *while* it merges,
   in index order, so the worktree still holds pre-merge sources — a generator
   run there would describe a half-merged tree and write a confidently wrong
   artifact, which is strictly worse than the conflict it replaced. Instead it
   records each path in `$GIT_DIR/os-regen-pending`, and `pre-commit` refuses the
   commit until those artifacts check clean. So the sequence after a merge is
   unchanged from §9 — rebuild, then `check:generated --fix` — you just cannot
   forget it.

   Two things worth knowing:
   - **Registration is per clone.** `pnpm install` does it (`prepare` →
     `scripts/setup-git-hooks.mjs`). A clone where that never ran falls back to
     git's default text merge — pre-#4675 behaviour, not breakage — so nothing
     depends on every machine being set up.
   - **The ratchets are deliberately excluded**
     (`docs-import-surface.baseline.json`, `dual-source-exports.baseline.json`,
     the hand-written `migrations`/`conversions` registries, `variant-docs.json`).
     Recomputing a shrink-only ratchet can *widen* it, which would launder a new
     exemption in as merge noise. Those conflicts are yours to read. See
     `NOT_DRIVER_MANAGED` in `scripts/regen-artifacts.mjs` for why, per path.

   Related: `check:generated --fix` now **refuses** to run `gen:api-surface` on a
   stale `dist` rather than warning about it (§9's trap, made unsurvivable on the
   one path that writes).

   `pnpm check:merge-driver` reconciles `.gitattributes` against that table in
   both directions and proves the driver end to end against real git.

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
| `**/translations/*.generated.ts` (nine packages — `platform-objects`, five plugins, three services) | **AUTO-GEN** | ❌ Never hand-edit the file *structure*. Run `node scripts/check-i18n-bundles.mjs --write` to regenerate all nine (merge mode — every existing translation is preserved); `pnpm i18n:extract` still covers `platform-objects` alone. Translation *values* are hand-written and expected to be: the gate compares against a merge-mode extract, so editing a string is fine, while adding or dropping keys is drift. `pnpm check:i18n` gates all nine in CI, and `pnpm check:i18n-coverage` ratchets untranslated declared labels. |
| `content/docs/guides/` | hand-written | ✅ Update `meta.json` when adding pages. |
| `content/docs/concepts/` | hand-written | ✅ |
| `content/docs/getting-started/` | hand-written | ✅ |
| `content/docs/protocol/` | hand-written | ✅ |

### Touched `packages/spec`? Regenerate its artifacts BEFORE pushing

`packages/spec` has **eight** checked-in generated artifacts, each with its own CI gate.
All of them live in one job — `TypeScript Type Check` in `lint.yml`, which is required and
has no paths filter, so no gate can go dormant on the PR that breaks it (#4291 retired the
filtered `Check Generated Artifacts` job for exactly that reason). That job runs its gates
**sequentially**, so the first stale artifact masks every one behind it, and you get one
red build per artifact instead of one for all of them. Match the change to the gate and
regenerate up front:

| You changed | Gate that fails | Regenerate with `pnpm --filter @objectstack/spec …` |
|:---|:---|:---|
| A `.describe()` / TSDoc on any schema | `check:docs` | `gen:schema && gen:docs` |
| A public export (added / removed / renamed) | `check:api-surface` | `gen:api-surface` |
| An authorable key on a metadata schema | `check:authorable-surface` | `gen:schema` |
| An ADR-0087 conversion / migration registry | `check:spec-changes`, `check:upgrade-guide` | `gen:spec-changes`, `gen:upgrade-guide` |
| A `SKILL.md` (frontmatter or body) | `check:skill-docs`, `check:skill-refs` | `gen:skill-docs`, `gen:skill-refs` |
| The react-blocks contract | `check:react-blocks` | `gen:react-blocks` |

A `.describe()` string counts — it is not "just a comment", it lands in
`content/docs/references/`. Adding one export counts — it lands in `api-surface/`.
Both were learned the hard way in #4040: two separate red builds, neither a logic error.

Don't match by hand — one command runs **every** gate and reports **all** stale
artifacts at once, which is precisely what CI cannot do:

```bash
pnpm --filter @objectstack/spec build             # REQUIRED first — see the dist caveat
pnpm --filter @objectstack/spec check:generated   # every gate; the first failure does not stop the rest
pnpm --filter @objectstack/spec check:generated --fix   # regenerate ONLY the ones it proved stale
```

`--fix` is deliberately narrow. Regenerating the whole set on principle destroys the
signal: it rewrites artifacts whose staleness you never saw, so a real semantic change
lands silently inside a mechanical diff. Let the check tell you which are stale, then
regenerate those.

**No `check:` script regenerates anything — that is the point of the split, not an
oversight.** `check:docs` used to begin with `pnpm gen:schema`, which rewrites two
*tracked* files (`json-schema.manifest/`, `authorable-surface/`) whenever they
are behind: running the gate edited your working tree and reported nothing, so a
`check:generated` run on a stale manifest printed a red `check:authorable-surface`
over a file the gate two lines below had already quietly fixed (#4711, #4723). The
generation belongs to the **caller** now — `pnpm build`, or the
`check:authorable-surface` gate that runs before `check:docs` in both CI and
`check:generated`, whose `--check` mode writes the gitignored `json-schema/` tree and
refuses to touch a tracked one. Consequence for you: **`check:docs` is not
self-sufficient**. Run the `build` line above first (it is already required for the
`dist` caveat below) — `build-docs.ts` refuses on a missing or stale tree and names
the command, so the failure is loud, never a wrong verdict.

The script carries its own ledger of gate → generator and **reconciles it against
`package.json` on every run**, in both directions. A new `check:`/`gen:` script that
nobody classified fails the run rather than quietly dropping out of coverage — the
failure mode a hardcoded list here would have had. (It caught its own `package.json`
entry on the very first run.) CI runs the same reconciliation on every PR
(`--reconcile-only`, in lint.yml's required typecheck job), so an unclassified script
fails its own PR instead of landing on `main` and turning this wrapper red for
everyone else — which happened twice before the CI step existed (#4203, #4232).

⚠️ **`check:api-surface` reads the built `dist/*.d.ts`, not `src/`.** A stale `dist`
makes it report exports as **removed** — "N breaking (removed/narrowed)" — when nothing
was removed at all: the snapshot is simply newer than your build. Rebuild before you
believe it, and before you file a bug about `main` being red. (Two phantom "breaking
removals" this way while writing this section; `check:generated` now prints this caveat
inline when that gate is the one failing.)

`check:liveness`, `check:empty-state`, `check:skill-examples`, `check:exported-any` and
`check:dual-source-exports` are
pure checks with no generator — a failure there is a real finding to fix, not an artifact
to regenerate. `check:generated` names them as deliberately not run, so its "all up to
date" never reads as "everything passed". The last one asks the third question about the
export surface (#4446): `api-surface/` shows a name on two entries but not whether
that is one declaration re-exported (fine) or two declarations sharing a name — the #4411
trap, judged by symbol identity against the built dist, with the accepted cases in the
shrink-only `dual-source-exports.baseline.json` (hand-edited under review, never
generated: a `gen:` would admit a new dual-source via "run the fix command").

⚠️ **`check:react-declaration-parity` compares two DECLARATIONS, not a declaration against
an implementation.** Left: the props a block's spec zod schema declares. Right: the inputs
the objectui *registry config* declares. Both are declarations — `manifestFromConfigs`
copies `config.inputs` verbatim — so a prop **both sides declare and no renderer reads**
is, to this gate, perfect agreement. It was named `check:react-conformance` and opened by
claiming it confirmed the components "ACTUALLY implement" the spec props; it never could,
and #4413 shipped four dead blocks straight through a green run of it. Renamed and
re-scoped in #4472. The gate is still worth having (`spec-only`, `registry-only` and
`missing` are real signals) — just don't read it as proof anything renders.

⚠️ **It is also the one gate `check:generated` cannot run at all**, and it says so in its
own bucket (`EXTERNAL_INPUT_REQUIRED`, "cannot run here") rather than beside the source
audits that are merely *deliberately* not run. Its right-hand side is objectui's
`sdui.manifest.json`, and nothing here can produce one: the registry is a browser app, so
the manifest exists only after `pnpm sdui:manifest` builds objectui at `.objectui-sha` and
enumerates it in a real browser — `packages/console/dist/` is gitignored, the console
build deliberately does not dump one, and the published `@objectstack/console` carries
none either. Until #4690 that combined with a manual run that printed `⚠ manifest
unavailable` and **exited 0**, so no path existed on which this gate could go red; it now
**exits 1** when it has no usable manifest, because "could not run" is a failure, not a
skip (Route & surface ownership §3, *Absence must be loud*). Run it the one way that
works: `pnpm sdui:manifest` (or `OBJECTUI_ROOT=../objectui pnpm objectui:build` first),
which dumps the manifest and runs the ratchet against it. Where the manifest comes from is
**settled** (#5960, maintainer ruling 2026-08-07): **not from CI**. It is an on-demand
gate whose trigger is the **objectui pin bump** — `.objectui-sha` is the only thing that
moves the manifest, so `scripts/bump-objectui.sh` and `scripts/build-console.sh` print the
`pnpm sdui:manifest` step and `docs/releases-maintenance.md` carries the procedure.
Producing it here was rejected outright: the sole producer drives Playwright chromium over
objectui's built console, so a CI-side dump means a full objectui build plus a browser
download on every matching PR. So: do not "fix" the red by re-adding a skip, and do not
"fix" it by wiring the gate into a workflow either — run it where it belongs, at the pin
bump.

`check:exported-any` is the one of those that also reads the built `dist/*.d.ts`, so the
stale-`dist` caveat above applies to it too. It asks the other half of the
`api-surface/` question: that snapshot records an export *exists*, never what it
*resolves to*, which is how five exported symbols sat at `any` for a whole major with
every gate green (#4171). A recursive Zod schema needs an annotation to break its
circular inference, and `z.ZodType<any>` compiles, validates correctly, and silently
throws the type away — annotate with the type instead (`QueryAST` in
`src/data/query.zod.ts` is the pattern).

Two generators have **no** gate at all — `gen:openapi` and `gen:sbom`. Nothing verifies
their output is current; the script reports that each run rather than staying silent
about it.

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
`packages/core/src/types.ts`; the old `onInstall`/`onEnable`/`onDisable`
example described hooks nothing ever called, retired in #4212):
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

Four rules, each paid for by a real bug. They matter more than usual here because
this repo is largely written by agents, and every one of them is a trap that
reads as reasonable code.

**1. One route, one owner.** Never add a second implementation of a path that
another package already serves, however convenient. A shadowed duplicate is code
that `grep` finds and the runtime never runs — the exact input that makes an
agent (or a human) reason confidently from dead code. It also silently forks
every future invariant: the retired hono `/data` surface had to re-learn the
anonymous-deny gate (#2567), honest batch capability reporting (#3298) and
discovery accuracy (#4018), each after the fact, each because someone fixed the
real owner and never knew about the copy. Retired in #4073.

**2. Explicit composition over default magic.** A capability that appears
because of a default nobody wrote down is invisible at every call site — and
call sites are the primary evidence an agent reasons from. #4073's own first
analysis checked *who passes the option* and missed *who relies on the default*;
the correction is in that issue's opening paragraph. If a host should get a
surface, it should mount it.

**3. Absence must be loud.** A composition that legitimately serves nothing
should say so once at boot, naming the remedy — never leave a bare 404 to be
diagnosed. The same rule applies to tooling: a verifier that silently degrades
(reusing a stale build, skipping a check it could not run) is worse than no
verifier, because it reports success. Prefer failing to falling back.

**4. Machine-readable surfaces must not lie.** `/discovery` and friends are read
by SDKs, codegen and AI clients. Advertise only what is actually mounted, and
mount everything advertised (ADR-0076 D12) — a wrong answer here propagates into
everything built on top of it.

**Verifying any of this:** "who serves this path" is a question about the
composed, *provisioned* runtime — not about which plugin declares it, not about
registration order, and not about a minimal harness that merely boots. #4073 was
answered wrongly three times, once per each of those shortcuts. Boot the real
composition with its real services, or do not claim an answer.

---

## Degradation log levels — `warn` vs `error`

Nearly every `catch` in this repo is a best-effort degradation, and nearly every
one of them logs `warn`. That default is wrong for a specific, recurring class,
and the cost of getting it wrong is not noise — it is silent data loss. Decide
the level with **one question**, not with an adjective:

> **After the degradation, does the system still look "normal" from the outside,
> while something it claims is persisted has not actually landed?**
> **Yes → `error`. No → `warn`/`info` is right.**

- **Functional degradation → `warn` / `info`.** A screen is missing, a trigger is
  not armed, a capability is not enabled, an optional service never showed up.
  The system is *visibly* smaller than it should be, and the next person to use
  the missing thing finds out. `ScheduleTriggerPlugin: job service not available
  — scheduled flows will not run until one is registered` is exactly right at
  `warn`.
- **Durability / data-consistency degradation → `error`.** A write that claims
  to persist does not, DDL that was supposed to run did not, persisted state and
  runtime state disagree. Nothing looks broken; the loss surfaces a release
  later, to someone who cannot connect it to this line.

**Why this is a rule and not a preference.** #4420: the durable suspended-run
store attached to a table that was never created, every write failed into a
`warn` nobody read, and every restart dropped all in-flight approvals — the
symptom surfaced a release after the cause. #4460 raised that one site to
`error`; #4632 made it the rule, because the *class* is what recurs. It is the
same failure Prime Directive #10 names — advertising a capability (here:
durability) the runtime does not deliver — and the same instinct as "Absence must
be loud" above: **prefer failing to falling back**, and when you must fall back,
say what was lost.

**An `error` here owes two things**, both, in the first line it prints
(`packages/services/service-automation/src/plugin.ts` `start()` is the reference
text):

1. the **consequence**, concretely — *what* is not durable, and that the system
   will keep looking healthy anyway;
2. the **fix** — the composition/config change that restores durability, or the
   explicit opt-out that makes the degradation deliberate (`suspendedRunStore:
   'memory'`, `OS_SKIP_SCHEMA_SYNC`).

Say it **once**, at the first degradation, not once per failed write.

**Do not over-apply it.** Escalating a functional degradation to `error` is the
mirror-image failure: it trains everyone to skim `error`, which is what made the
#4420 `warn` unreadable in the first place. In particular, an `if (!service)`
composition branch is usually functional and usually belongs at `warn`; a `catch`
around a write, a DDL call, or a store initialization is where this rule bites.

**A failure handed to the CALLER is not a degradation at all** — this is the
third legal answer, and forgetting it is how the mirror-image failure gets
written. Ask the judgment question honestly: a `/meta` PUT whose `catch` answers
`errorFromThrown(e, 400)`, or a batch whose contract IS a per-item outcome report
and whose `catch` writes the failure into it, does **not** look normal from the
outside — the requester was told, per item, that the write did not land. That is
already louder than a log line. Do **not** bolt a `logger.error` onto such a
site: the common case on a validation path is an author submitting an off-spec
body, so you would emit one durability `error` per rejected keystroke, which is
exactly what makes `error` unreadable. Declare **how it delivers** instead —
`FAILURE_PROPAGATION_CALLEES` (repo-wide names like `errorFromThrown`) or the
function-scoped `FAILURE_PROPAGATION_SITES` (local report sinks, whose names mean
nothing repo-wide) in the checker, which then proves structurally that *every*
path out of the `catch` delivers. #5241 added it after #4754 was forced to park
three correct sites in the baseline for want of a way to say this.

**It has teeth** (a rule this repo only writes down is the very "declared ≠
enforced" shape it keeps paying to fix): `pnpm check:durability-log-level` walks
the AST for `catch` blocks guarding a declared vocabulary of durability-critical
operations and fails when one logs below `error` without rethrowing. It is
deliberately narrow — it cannot *discover* a new durability seam, only stop the
known ones from regressing. Found a new one? Add it to
`DURABILITY_CRITICAL_CALLEES` in `scripts/check-durability-degradation-log-level.mjs`
in the same PR that fixes it. Accepted exceptions live in
`scripts/durability-degradation.baseline.json`, hand-edited with a reason and
shrink-only — and that file is currently **empty**, which is its intended steady
state: an entry there means a real degradation nobody has fixed yet, never a site
the gate merely cannot classify. If a red seam turns out to hand its failure to
the caller, declare the propagation vocabulary above; do not baseline correct
code.

**The same command has a SECOND set of teeth** — the read-seam invention rule
(#5186; family #4728 → #4825 → #5108 → #6116). Everything above grades *how loud
the catch is*, which is the right axis for a write or a DDL seam and structurally
blind to a read: `catch { return []; }` has no log to grade at all, and a read's
callees are `find` / `findOne` / `count`, names far too generic to declare
repo-wide. So the second rule asks a different question — **the read did not
happen; did you make an answer up anyway, and tell nobody?** — and goes red only
when every part holds: the `try` performs a storage read (the `IDataDriver` read
methods, or a same-file wrapper over one), the `catch` logs *nothing* at any
level (same-file helpers followed), some path out of it returns an **invented
answer** — an empty/zero value for that method (`[]`, `null`, `false`, `0`, `1`,
…), or one of the enclosing function's own parameters handed straight back
(#6451, from #6116: for an enrichment function the un-enriched input is the very
same bytes a successful read with nothing to hydrate returns) — and that path was
never reached by discriminating the error's **type**. What it protects is
DISTINGUISHABILITY, not the spelling of the returned value: the fix is to ask the
error's type, or to report the failure once — never to invent a different empty.

Its scan surface is deliberately narrower than the log-level rule's:
`packages/metadata/src`, `packages/metadata-protocol/src` and
`packages/objectql/src` only. That is the maintainer's 2026-08-06 ruling —
「裁 3 —— 收窄先行」: prove the false-positive surface on the metadata/persistence
layer first, and evaluate widening as its own issue. It is also the only honest
way to afford `find`/`findOne`/`count` as a vocabulary at all — the names are
generic, so the SCOPE is what makes them mean "a storage seam" rather than "any
data read anywhere". Like its sibling it is a ratchet, not a proof: it cannot see
a read outside the `try`, nor an empty answer wrapped in a result envelope.

**Found a new read seam?** The symmetric answer to `DURABILITY_CRITICAL_CALLEES`
above is `READ_FAILURE_DISCRIMINATORS`, in the same script: the declared
predicates that prove a read failure is benign (today `isMissingTableError`,
`packages/metadata/src/errors.ts`), which is why a hand-rolled `if (e.code ===
'42P01')` is flagged on purpose — ask the shared predicate instead of growing a
second vocabulary of "which driver errors are benign" (#5841). A reviewed,
genuinely legitimate seam goes in this rule's OWN ledger,
`scripts/durability-read-invention.baseline.json` — **not** the empty
`durability-degradation.baseline.json` named above. The two rules share this
file, one CI step and one AST pass, and share no vocabulary, no baseline and no
verdict: a seam red under one is untouched by the other. That ledger is
shrink-only, hand-edited and fails on a stale entry exactly like its sibling, but
its steady state is *not* "empty": an entry is either a real unfixed instance
(`unfixed-degradation`, carrying the issue that tracks it) or a
`reviewed-legitimate` seam whose empty value is a declared "could not determine"
that a syntactic rule cannot see. Read the entries and the reasons they give —
never the count.

---

## Startup registry reads — never record a verdict the boot can still contradict

A boot fills its registries incrementally. Asking a registry "is X there?" while
it is still filling is fine — the answer is simply not final yet. Turning that
not-yet into a **verdict and recording the verdict** is the defect, because the
provider registers a moment later and nothing goes back to undo the record.

Decide with **one question**, the counterpart of the degradation-log-level one:

> **At the moment this code concludes "X is not registered", can a provider
> still register X during this same boot? And is that conclusion RECORDED
> anywhere that outlives the moment?**
> **Yes and yes → defect.**

Three parts, all three or it is not a finding:

1. a read of a registry that is still filling — the service registry during
   `init()`, or a plugin-extensible capability registry before it is sealed;
2. a terminal conclusion drawn from "absent";
3. that conclusion **recorded** — cached in an instance field or module binding,
   asserted in a `warn`, or persisted.

Part 3 is what makes this a rule and not noise. **A read-only probe is
completely legal**: `AutomationEngine.getUnknownNodeTypeAudit()` reads the
executor registry on every call, records nothing, and is correct.

**Why this is a rule and not a preference.** One showcase cold start on
2026-08-03 produced three instances, in three unrelated subsystems, written by
three people at three times: plugin-auth froze an `undefined` cache handle into
its config for the life of the process, so rate-limit counters never reached the
shared store and the printed warning sent operators to provision Redis for a
problem they did not have (#4772); service-automation asserted that eight
approval flows "will fail at execution time" 0.8s before the executor that runs
them was registered, and a deployment that genuinely lacked the plugin emitted
the identical eight, so the signal could not tell the two apart (#4771); objectql
wrote an ADR-0104 attestation into `sys_migration` during the same boot that was
still seeding rows contradicting it, so the next restart rejected its
predecessor's data (#4769). Whether the kernel contract itself should be
tightened further is #4776.

**The three cures, in preference order:**

1. **Resolve where it is used, not where you start.** A lazy accessor or a
   `kernel:ready` hook sees a provider that registered later —
   `createLazyCacheRateLimitStorage()` in plugin-auth is the reference.
2. **Declare the ordering (ADR-0116).** `dependencies` / `optionalDependencies`
   / `requiresServices` make the kernel hoist the provider ahead or assert it
   registered, which makes "absent" a *fact*. Tolerance belongs in the plugin's
   own declaration, where the kernel enforces it — not in a checker's ledger.
3. **Seal the vocabulary, then judge.** For a registry that is open by contract
   (ADR-0018 flow node types), the host declares the moment it can no longer
   grow — `AutomationEngine.sealNodeTypeVocabulary()`, called at
   `kernel:bootstrapped` — and only then is an absence worth reporting.

**It has teeth**: `pnpm check:startup-registry-verdict` walks the AST for that
three-part shape and fails on it; accepted exceptions live in the shrink-only,
hand-edited `scripts/startup-registry-verdict.baseline.json`. Like
`check:durability-log-level` it is deliberately narrow — it cannot *discover* a
new seam, only stop known ones from regressing, and it under-matches on purpose
rather than risk a false positive: `getService('cache')` is visible, a
`resolveCacheOrFallback()` three layers down another package is not, and #4769's
"registry" is a database table it can never see. Found a new open registry? Add
it to `OPEN_CAPABILITY_REGISTRIES` in the same PR that fixes it.

---

## Post-Task Checklist

1. `pnpm test` — verify nothing broke. Touched a type-check-covered package? `pnpm typecheck` too.
2. **Land it — don't leave passing work in the working tree.** Once tests pass,
   create a feature branch, commit, push, open a PR, and — once remote CI is
   fully green and the PR is accepted — arm auto-merge so the queue lands it
   (Multi-agent discipline §7: never straight to `main`; never arm a PR that
   isn't green yet). A finished task = a merged PR, not a dirty working tree.
   ⛔ **Except a diff touching `docs/adr/**`**: push it, open the PR, and stop
   there — landing it is the maintainer's, by hand (Prime Directive #14). For
   that one class, a finished task = a PR left visibly awaiting a human merge.
3. **Add a changeset for feature work.** When the change is a feature or functional improvement, run `pnpm changeset` (or add a `.changeset/*.md` entry) describing it before committing. Pure bug fixes do **not** require a changeset.
   **Breaking changesets must carry their migration.** If the change removes or renames anything an author can write (a spec key, an export, a config field), the changeset body must state the FROM → TO mapping and the one-line fix — this text ships to consumers as `CHANGELOG.md` inside the npm package and is what an upgrading agent greps after the tombstone error. Removing an authorable spec key also requires a tombstone so the rejection itself carries the prescription — `retiredKey()` (`packages/spec/src/shared/retired-key.ts`) on a non-strict schema, or an entry in the relevant `UNKNOWN_KEY_GUIDANCE` / `*_RETIRED_KEY_GUIDANCE` map (see `object.zod.ts`, `ai/tool.zod.ts`) when the schema is `.strict()`. The changeset is one of fourteen surfaces a retirement touches — follow the `spec-property-retirement` skill (`.claude/skills/`) rather than reconstructing the kit, and note the two routes imply **opposite** liveness-ledger dispositions.
   **A breaking changeset must also state its ADR-0087 disposition, in writing.** Add exactly one marker to the changeset body — `pnpm check:adr-0087-registration` enforces it, and the CI step is *Require an ADR-0087 disposition on a declared-breaking changeset*:
   ```
   <!-- adr-0087: registered SOME-MIGRATION-ID -->
   <!-- adr-0087: not-required (unpublished) why -->
   <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->
   <!-- adr-0087: not-required (no-migration-prescription) why -->
   ```
   Why it is asked of you at all: the two ADR-0087 gates (`check:spec-changes`, `check:upgrade-guide`) pin ledger ↔ **artifact synchrony**, and the artifacts are a pure projection of the registry — so a retirement whose entry was **never written** leaves the two perfectly consistent and every gate in the repo green. PR #6048 removed `ctx.user.roles` that way and only a human comparing by eye caught it (#6011, backfilled by PR #6138). Ledger entries are the sole data source for `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide, and for a surface with **no spec schema** (`ctx.user` is only a runtime TS interface) there is no tombstone and no schema rejection either — the ledger entry is the *only* channel that reaches an upgrader. Measured: roughly **1 declared-breaking change in 7** needs an entry, so `not-required` is the ordinary answer and costs one line. Three of the four dispositions are re-verified mechanically on every run, and the fourth is refused when the changeset's own body carries a FROM → TO prescription — a changeset that ships migration instructions cannot also claim nobody must migrate (#6148).
4. **Added or removed a `packages/spec` export? Run `pnpm --filter @objectstack/spec gen:api-surface` and commit the result.** The `TypeScript Type Check` job diffs spec's built export surface against `api-surface/` (one shard per entry point since #5837); a new export makes the snapshot stale and turns the job red. It reads the **built `dist` declarations**, so `OS_SKIP_DTS=1` — the flag you reach for to make local builds fast — skips exactly the artifact the gate inspects, and the check passes locally while failing in CI. Same shape for the other generated-artifact gates in that job (`check:docs`, `check:skill-refs`, `check:react-blocks`), which read `src/` and so do reproduce locally.
5. Update `CHANGELOG.md` / `ROADMAP.md` if user-facing or architectural.
6. **Delete temporary artifacts** — screenshots, traces, scratch logs, `.playwright-mcp/`, throwaway `tmp*.ts`, ad-hoc scripts. Repo must look identical to before, minus intended changes.

---

## Edit Sizing

Keep single `edit`/`create` payloads under ~20KB. Split larger changes into multiple sequential edits.
