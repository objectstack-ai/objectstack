---
title: CI/CD Pipeline
description: Overview of the ObjectUI continuous integration and deployment workflows.
---

# CI/CD Pipeline

ObjectUI automates testing, quality checks, releases, and repository maintenance with GitHub Actions. All workflow files live in `.github/workflows/`.

This page deliberately states **no workflow count**. It used to open with "11 GitHub Actions
workflows"; the directory held 12 when [#3212](https://github.com/objectstack-ai/objectui/issues/3212)
was filed and 13 by the time it was fixed. A hand-maintained number drifts by construction, and a
stale one still reads as authoritative. What is pinned instead is the *set*:
`scripts/__tests__/ci-cd-pipeline-doc.test.ts` fails `pnpm test` when a file in
`.github/workflows/` has no section on this page, **and** when this page names a `.yml` that is not
in that directory. Adding a workflow without documenting it is a red test, not a silent omission.

## Workflow Inventory

Every workflow, the name it appears under in the checks list (they are not the same string —
`performance-budget.yml` shows up as **Bundle Analysis**), and whether it can block a merge. Each
one has its own section below.

| Workflow file | Appears as | Runs on | Blocks a PR? |
|---|---|---|---|
| `ci.yml` | CI | Push / PR to `main`, `develop`; merge-queue builds; hourly `schedule` on `main` | **Yes** — every job but the two coverage-lane jobs (`test-coverage` and `coverage-report`, push and schedule only) runs on PRs and on queue builds |
| `lint.yml` | Lint | Push / PR to `main`, `develop`; merge-queue builds; manual | **Yes** — ESLint **errors** only |
| `changeset-guard.yml` | Changeset Bump Policy, Changeset Overwrite Report | PR / push touching `.changeset/**` or either gate itself | **Yes** — the bump policy job only; the overwrite job is report-only |
| `changeset-presence.yml` | Changeset Declaration | PR to `main`, `develop` — **no path filter**; merge-queue builds | **Yes** — when a released package's `src/` changed and no changeset was added |
| `repo-gates.yml` | Repo Gates | Push / PR to `main`, `develop` — **no path filter**; merge-queue builds; manual | **Yes** — fifteen gates as steps of one job ([#12214](https://github.com/objectstack-ai/objectui/issues/12214)); the job is red when any step is, and `scripts/dependabot-merge-gate.mjs` declares the context in `REQUIRED_CONTEXTS` |
| `line-citation-gate.yml` | Line Citation Gate | PR to `main`, `develop` — **no path filter**; manual | No — **report-only** while it beds in; it exits 0 whatever it finds, and exits 1 only when one of its own synthetic controls fails. It declares no `merge_group` trigger, so it cannot be a required context in its current state |
| `governed-surface-guard.yml` | Governed Surface Queue Guard | PR to `main`, `develop` (incl. `ready_for_review`) — **no path filter**; merge-queue builds | **Yes on a queue build only** — a governed-surface diff with no authorized approval record (on any commit) is refused there, and so is any merge group whose queued pull requests still carry `needs:contract-review`; on the pull request itself it is deliberately green and prints an early warning |
| `performance-budget.yml` | Bundle Analysis | Push / PR touching `packages/**`, `apps/console/**`, `pnpm-lock.yaml` | **Yes** — the console entry gzip budget |
| `lockfile-integrity.yml` | Lockfile Integrity Check | PR to `main`, `develop` touching `pnpm-lock.yaml` or the gate's own two files; manual | No — **deliberately not a blocking context** ([#8326](https://github.com/objectstack-ai/objectui/issues/8326)); it names the packages and the Dependabot merge gate classifies it `NOT_A_GATE` |
| `lockfile-dedupe.yml` | Lockfile Dedupe Check | PR to `main`, `develop` touching `pnpm-lock.yaml` or the gate's own runtime closure; manual | **Yes, when it runs** — classified `OPTIONAL_CONTEXTS`, so a red stops a Dependabot auto-merge ([#8333](https://github.com/objectstack-ai/objectui/issues/8333)) |
| `live-e2e.yml` | Live E2E (informational) | PR to `main`, `develop` (code paths); nightly cron `30 6 * * *`; manual | No — informational lane: not in the required-check set, and it declares no `merge_group` trigger |
| `labeler.yml` | Auto Label PRs | PR `opened`, `synchronize`, `reopened` | No |
| `dependabot-auto-merge.yml` | Dependabot Auto-merge | PR to `main`/`develop` authored by `dependabot[bot]` | No — but it gates *its own* merge, and goes red instead of merging when the check set is not green |
| `cross-repo-issue-closer.yml` | Cross-repo Issue Closer | PR `closed` (acts only when merged) | No — runs after merge |
| `changeset-release.yml` | Changeset Release | Push to `main` (publish half); 6-hourly cron `0 */6 * * *`; manual (version-PR refresh half) | n/a |
| `changelog.yml` | Auto Changelog | Manual dispatch only — nothing triggers it automatically | n/a |
| `shadcn-check.yml` | Check Shadcn Components | Weekly cron `0 9 * * 1`; manual | n/a |
| `check-links.yml` | Check Links | Weekly cron `17 4 * * 0`; manual | n/a — reports, never gates |
| `docs-deploy.yml` | Docs Deploy | 6-hourly cron `43 5,11,17,23 * * *`; manual | n/a — it deploys objectui.org and gates nothing. It goes **red** whenever the docs did not ship |
| `published-dist-gate.yml` | Published Dist Tooling Scan | Nightly cron `41 3 * * *`; push to `main` touching the gate; manual | No — the blocking copy runs on the publish path, not here |
| `spec-range-floors.yml` | Spec Range Floor Scan | Nightly cron `11 4 * * *`; push to `main` touching the gate; manual | No — the blocking copy runs on the publish path, not here |
| `node-esm-load-gate.yml` | Node ESM Load Scan | Nightly cron `17 4 * * *`; push to `main` touching the gate; manual | No — the per-PR half is `pnpm check:esm-specifiers` in **Type Check** |
| `half-state-patrol.yml` | Half-State Patrol | 6-hourly cron `37 1,7,13,19 * * *`; manual; PR touching the workflow | No — **report-only**; it fails only when the sweep could not run, or a *configured* anchor could not be written |
| `board-snapshot.yml` | Snapshot the board to the archive branch | 6-hourly cron `14 2,8,14,20 * * *`; manual; PR touching the workflow | No — it is path-filtered, so it does not report on most PRs; **blocking when it does run** |
| `merge-queue-head-patrol.yml` | Merge queue head patrol | Every 15 minutes (cron `7,22,37,52 * * * *`); manual | No — it gates no branch and blocks no queue, but it **goes red on a finding**: a merge-queue head with no `merge_group` build is a live repo-wide block |
| `required-check-set-patrol.yml` | Required check set patrol | Daily (cron `23 5 * * *`); manual | No — it gates no branch and blocks no queue, but it **goes red on a finding**: a merge queue whose required set has lost `Type Check` validates nothing that a type error would fail |
| `hook-selftests.yml` | Hook Self-Tests | PR / push touching `.claude/hooks/**` or the workflow | **Yes** |
| `test-shard-timings-refresh.yml` | Regenerate the per-file test timings | Weekly cron `47 6 * * 1`; manual; PR touching the workflow or the two scripts it loads | No — it is path-filtered, so it does not report on most PRs; **blocking when it does run**. Its scheduled run opens a pull request as the fleet App, so that pull request runs CI, and gates nothing |

The path filters explain most "why did nothing run on my PR?" questions:

- `ci.yml` and `lint.yml` both list `**/*.md`, `content/**`, `docs/**` and `.changeset/**` under
  `paths-ignore` (`ci.yml` also ignores `apps/site/**`) — but **only on their `push` trigger**.
  Their `pull_request` trigger carries no filter at all since
  [#3523](https://github.com/objectstack-ai/objectui/issues/3523): every pull request starts both workflows, and the same list decides *inside
  each job* whether the expensive steps run. A docs-only PR therefore still installs nothing and
  builds nothing, while **Lint**, **Type Check**, **Test**, **Build & E2E** and
  **Changeset Fixed Group Check** all appear in the checks list and all report. That difference is
  the whole point: a check that is never *created* cannot be a required check — it leaves the PR
  pending rather than failing it — so while the filter sat on the trigger, none of these could be
  required at all.
- `changeset-guard.yml` carries the inverse filter — it runs *only* when `.changeset/**` changes
  (plus its own YAML and `scripts/check-changeset-no-major.mjs`, so a change to the gate itself is
  exercised by the PR that makes it — objectui#6321), which is precisely why it is a separate
  workflow instead of a job inside `ci.yml`.
- `changeset-presence.yml` is that guard's mirror image and the reason there are two: a PR which
  *forgot* its changeset does not touch `.changeset/**`, so the inverse filter guarantees the one
  check that could notice never runs. It therefore carries **no** filter and decides from the diff
  inside its script.
- `repo-gates.yml` carries **no** filter of any kind, which is equally deliberate: its gates guard
  markdown among the rest (the Control Byte Scan and the Internal Docs Link Check first of all), and
  a gate that a markdown-only PR cannot start is no gate on the change most likely to trip it. Its
  install-free gates cost one `node` call each, on one runner.
- Its Docs Route Eager Closure Check carries **no** filter for the opposite reason — not that its
  subject is invisible to a filter, but that a filter naming everything it reads would be
  indistinguishable from having none. Its inputs are the whole `/docs/[[...slug]]` module graph:
  `apps/site/**`, `content/docs/**` (the compiled MDX modules are most of that graph) and
  `packages/**` — a refactor dropping an import from `packages/plugin-view/src/ObjectView.tsx` is
  exactly what turns a free declaration into a new graph — plus the gate's own closure under
  `scripts/`. A filter that then *missed* one of those directories could not be exercised by the
  pull request that changed it, which is the defect
  [#6321](https://github.com/objectstack-ai/objectui/issues/6321) records. It too costs a checkout
  plus one `node` call.

## Merge Queue

`main` sits behind an **enforced merge queue**: a direct push is rejected with
405 `Changes must be made through the merge queue`. The queue takes each approved pull request,
rebuilds it on top of whatever `main` has become in the meantime, and merges it only if the
checks it requires are green **on that rebuilt commit**. Those runs are a distinct event,
`merge_group`, on a throwaway `gh-readonly-queue/**` branch — a workflow that does not subscribe
to that event simply does not run there.

Which workflows subscribe is deliberately not listed here, and is not maintained by hand anywhere
either: `scripts/__tests__/merge-queue-reporting.test.ts` derives the floor from
`REQUIRED_CONTEXTS` — every workflow producing a check that list declares blocking must subscribe,
and an assertion fails the moment one of them does not. `MUST_SUBSCRIBE_MERGE_GROUP` in the same
file records *why* particular members are requirable; a further assertion holds it to being a
subset of the derived floor, so the two cannot drift apart. A copy of the list on this page would
be right the day it was written and quietly wrong after the next subscriber landed, which is
exactly what this paragraph used to do
([#4154](https://github.com/objectstack-ai/objectui/issues/4154)). What is worth knowing here is
the rule that decides membership, not the instances: a gate that carries no path filter reports on
every pull request and is therefore requirable — and a requirable context that skips the queue
build does not fail it, it stalls it.

That rule was learned the expensive way. `ci.yml`, `lint.yml` and the control-byte and docs-link
gates did not subscribe at all until
[#3523](https://github.com/objectstack-ai/objectui/issues/3523), and the consequence was not subtle. A queue whose required set
is empty validates nothing: it rebuilds the PR, sees no failing required check because there are
no required checks, and merges. On 2026-08-07 three pull requests
([#3503](https://github.com/objectstack-ai/objectui/issues/3503), [#3510](https://github.com/objectstack-ai/objectui/issues/3510), [#3516](https://github.com/objectstack-ai/objectui/issues/3516)) merged with **Type Check** at
`conclusion=failure`, onto a `main` that [#3498](https://github.com/objectstack-ai/objectui/issues/3498) had left with a type error;
[#3505](https://github.com/objectstack-ai/objectui/issues/3505) hot-fixed the result.

**The three steps have to happen in this order**, and reversing them deadlocks the repository:

1. Subscribe the workflows to `merge_group`. Pure addition — nothing about pull requests changes.
2. Make the contexts report on *every* pull request, by moving path filtering out of
   `on.pull_request.paths-ignore` and into the jobs.
3. Only then may a maintainer add context names to the branch-protection and merge-queue required
   sets. This is a **repository-settings** change and nothing in this repository can *do* it:
   `GET /repos/{owner}/{repo}/branches/{branch}/protection` answers
   `403 Resource not accessible by integration` to an Actions token, so enrolling a context is a
   maintainer action. The current state, by contrast, **can** be read — and is, on a schedule.
   ⛔ This page does not restate it. Run `pnpm check:required-check-set`, or read
   [Required Check Set Patrol](#required-check-set-patrol-required-check-set-patrolyml) below for
   what that gate does with the answer. A membership copied into prose is exactly what
   [#9502](https://github.com/objectstack-ai/objectui/issues/9502) had to repair: the sentence that
   stood here said nothing could read it, which was true when written and stopped being true when
   the ruleset was edited.

Step 3 before step 1 is the deadlock: a required context that never reports does not fail a queue
build, it stalls it until the ruleset's 60-minute status-check timeout assumes failure — every
queued PR burns an hour and fails, with nothing red to point at.

Two things follow for anyone editing this directory:

- **A workflow producing a context that could ever be required must subscribe `merge_group`.**
  Nothing has to be added to a list for that to be enforced: name the context in
  `REQUIRED_CONTEXTS` (`scripts/dependabot-merge-gate.mjs`), which is where this repository already
  writes down that a check is blocking and reports on every pull request, and the workflow is
  inside the derived floor from that moment. "May this context be required?" is not the question
  step 3 points the gate at: a live reading says which contexts **are** required, never which ones
  *ought to be*, and no test in a checkout reads either one. `REQUIRED_CONTEXTS` is a human's answer
  to the normative half, and deriving from that answer beats writing it down a second time and
  watching the copies drift ([#6160](https://github.com/objectstack-ai/objectui/issues/6160)). A gate that carries no path filter
  *precisely so that it can be required* is the mirror image of the bullet below, and the sequence
  matters there too: name its context in `REQUIRED_CONTEXTS` and subscribe `merge_group` in the
  same commit that creates the workflow, rather than acquiring either afterwards
  ([#6316](https://github.com/objectstack-ai/objectui/issues/6316) is a worked example — see its
  own section for which gate that was).
- **Some contexts can never be required, structurally**, and no amount of triggering changes
  that. Each line below is blocked by a *different* property, which is why they are all worth
  reading; they are examples rather than a census, so a further workflow carrying any of these
  shapes is just as unrequirable without appearing here.
  - **Changeset Bump Policy** (`changeset-guard.yml`) — an **inverse** path filter: its
    `pull_request` trigger declares
    `paths: ['.changeset/**', '.github/workflows/changeset-guard.yml', 'scripts/check-changeset-no-major.mjs', 'scripts/check-changeset-overwrite.mjs']`,
    so on a PR that touches none of those four neither of its contexts is created at all.
  - **Bundle Analysis** (`performance-budget.yml`) — an ordinary path filter on the same
    trigger, with the same consequence for every PR that matches none of its paths.
  - **Live E2E (informational)** (`live-e2e.yml`) — an **exclusion** path filter:
    `paths-ignore:` on the same trigger, declaring `**/*.md`, `content/**`, `docs/**`,
    `apps/site/**` and `.changeset/**`, so a docs-only or changeset-only pull request never
    creates the context at all and a required one would wait for it forever.
  - **Close issues referenced in other repositories** (`cross-repo-issue-closer.yml`) — its only
    trigger is `pull_request_target` with `types: [closed]`, and the job additionally requires
    `github.event.pull_request.merged == true`, so it runs only *after* a merge.

  Each of those properties is pinned against the YAML in
  `scripts/__tests__/ci-cd-pipeline-doc.test.ts`: change one of them without editing its line
  here and that test fails, naming the workflow
  ([#4170](https://github.com/objectstack-ai/objectui/issues/4170)). The `live-e2e.yml` line has
  already outlived one property: it used to quote `continue-on-error: true` on that job, and
  [#8084](https://github.com/objectstack-ai/objectui/issues/8084) took the flag off after
  measuring that it left the job and its check run red and inverted only the run conclusion —
  so it had never been what made the context unrequirable. Removing it did **not** promote the
  lane, so the line was re-pointed at the property that still blocks it. Retire a line here only
  when its workflow carries no such property at all, and delete its entry in that test with it;
  do not soften it in place.

## Core CI Workflow (`ci.yml`)

**Triggers:** **Every** PR to `main`/`develop` (no path filter), every merge-queue build
(`merge_group`), and pushes to `main`/`develop` unless the change touches only `**/*.md`,
`content/**`, `docs/**`, `apps/site/**` or `.changeset/**` (`paths-ignore`, kept on the push
trigger only — see [#3523](https://github.com/objectstack-ai/objectui/issues/3523) and the **Merge Queue** section below).

The path list did not go away, it moved. `type-check`, `test` and `e2e` each open with a
`Decide whether this change needs a full run` step that diffs the PR against its merge base with
exactly that list excluded, and every following step carries
`if: steps.relevant.outputs.should_run == 'true'`. The job always runs and always reports; the
paths decide only whether it does any work. The `docs` job has worked this way since
[#3450](https://github.com/objectstack-ai/objectui/pull/3450) and is where the shape comes from.
The gate fails **open** — if the diff cannot be computed the job runs everything, rather than
reporting green having built nothing.

**Two speeds** ([#12214](https://github.com/objectstack-ai/objectui/issues/12214), the doctrine of
[objectstack#22998](https://github.com/objectstack-ai/objectstack/issues/22998)). A pull request or a
merge-queue build runs the *affected* test files: `scripts/select-affected-tests.mjs` names the
packages the change sits in and every package that depends on them, plus the test files the package
graph cannot place (tests outside every package, tests whose relative imports read the disk or leave
their package, tests that import a package their own does not depend on), and answers "run
everything" when the change reaches something every test runs through — a `package.json`, a
`tsconfig*.json`, a vitest or vite config, a root install or toolchain file, a file the root vitest
config imports, or a package a broad setup file imports. A `push` to `main` and the hourly `schedule`
run are the *full battery*: every test file, plus the coverage lane. Nothing was deleted; the whole
suite moved to `main`, where every merge and every hour runs it, and whatever the fast set misses
turns `main` red there. The selector's header states the rules and the edges it cannot see; this page
does not restate its measurements.

**Type Check** has the same two speeds ([#12222](https://github.com/objectstack-ai/objectui/issues/12222)).
On a pull request or a merge-queue build, `scripts/select-type-check-scope.mjs` answers either the
*affected* packages — turbo's own `--filter=...[<base>]`, the packages the change sits in and every
package that depends on them — or the whole workspace, when the change reaches a root file the package
graph cannot see: the lockfile, `pnpm-workspace.yaml`, the root `package.json`, `turbo.json`, `.npmrc`,
a root `tsconfig*.json`, `patches/`, and — read out of `turbo.json` on every run — every `$TURBO_ROOT$`
input of the `type-check` and `build` tasks, every `globalDependencies` entry and the program of the root
e2e task every package's type-check depends on. Either way, a package whose turbo hash did not move is
replayed from the restored `.turbo/cache`. A `push` to `main` and the hourly `schedule` are the full
battery: every package with `TURBO_FORCE`, so no verdict is replayed there, and those runs write the
cache the fast runs read. A selector that cannot decide means the whole workspace, never a skip.

Most jobs run in parallel. Two `needs:` edges exist and both point at an aggregator: `coverage-report`
waits on the eight coverage shards ([#5403](https://github.com/objectstack-ai/objectui/issues/5403);
four until [#12256](https://github.com/objectstack-ai/objectui/issues/12256)),
and `test-aggregate` waits on the sixteen test shards and the dist-pin job
([#9499](https://github.com/objectstack-ai/objectui/issues/9499)). Nothing else waits for anything.
As with the workflow
inventory above, this page states **no job count**: the table *is* the list, and
`scripts/__tests__/ci-cd-pipeline-doc.test.ts` pins its first column against `ci.yml`'s `jobs:`
keys in both directions, so a job added or removed without touching this table is a red test.
(This section used to open with a hard-coded count and list a seventh job, `dev-server`, that had
been deleted three months earlier — [#3451](https://github.com/objectstack-ai/objectui/issues/3451).)

The **What it runs** column is pinned one level further down, by command
([#3653](https://github.com/objectstack-ai/objectui/issues/3653)): every first-party command a job
runs — a `node scripts/*.mjs` invocation, a root `package.json` script, or a `turbo run` task — must
be named in that job's row, and a row may not name one its job does not run. Until that pin landed
this page was judged job by job only, so a `run:` step added to an existing job left every check on
it green — which is how two of `type-check`'s gates came to be missing from this column.

| Job key | Appears as | What it runs | When |
|---|---|---|---|
| `changeset-check` | Changeset Fixed Group Check | `scripts/check-changeset-fixed.mjs` — every workspace package must be in the changeset `fixed` group or explicitly ignored. It checks group *membership*; it does **not** check whether the PR added a changeset. | Every run |
| `type-check` | Type Check | `scripts/check-type-check-coverage.mjs`, then `scripts/objectstack-pin.mjs` (restores or builds the pinned `@objectstack/*` before the install, objectui#12957), then `pnpm check:phantom-deps`, then `pnpm check:self-import`, then `pnpm check:unreferenced-sources`, then `pnpm check:doc-example-readers`, then `pnpm check:handler-key-reads`, then `pnpm check:metadata-write-doors`, then `pnpm check:published-tsconfig-exclude`, then `pnpm check:side-effects-array`, then `pnpm check:element-data-source-declaration`, then `pnpm check:esm-specifiers`, then `pnpm check:spec-symbols`, then `pnpm check:action-forward-parity`, then `pnpm check:designer-field-key-parity`, then `pnpm check:icon-record-names`, then `pnpm check:i18n-keys`, then `pnpm check:i18n-drift`, then `pnpm check:i18n-designer-parity`, then `pnpm type-check:scripts`, then `pnpm type-check:vitest-config`, then `scripts/select-type-check-scope.mjs`, then `pnpm type-check`, then — on the affected speed only — `turbo run build` of the packages the root setup program imports, then `pnpm type-check:vitest-setup`, then — bookkeeping only, after the verdict — `scripts/report-turbo-cache.mjs`. The coverage guard runs first because turbo silently skips packages that have no `type-check` script, so a package without one would otherwise read as passing (#2911). `pnpm check:phantom-deps` fails when a released package imports a bare specifier its own `package.json` does not declare — a *phantom dependency*, invisible locally because the workspace root's `devDependencies` sit on the upward resolution path from every package directory and on no consumer's, so `require.resolve('react', { paths: ['packages/core/src'] })` succeeds while `@object-ui/core` declares react in no field at all ([#4394](https://github.com/objectstack-ai/objectui/issues/4394)). `pnpm check:self-import` runs next because it reuses that gate's parser: it fails when a file inside a package names its OWN package, a specifier that resolves through the package's `exports` map to `dist/` while `type-check` waits on `^build` — the *dependencies'* builds, never the package's own — so on a cold cache the declarations do not exist yet and the file fails with `TS2307`. Locally it is always green, because every local workflow builds before it type-checks and leaves a `dist/` behind; PR #4789's first run was red on exactly one such line ([#4801](https://github.com/objectstack-ai/objectui/issues/4801)). `pnpm check:unreferenced-sources` runs next, reusing the same parser again: it fails when a covered package ships a source file that nothing reaches — not the package's declared entry, and not its build config. Until [#7515](https://github.com/objectstack-ai/objectui/issues/7515) no gate here could see one: `check-dist-completeness` asks whether `dist/` holds what `tsc` emits, `check-readme-exports` compares documented exports against shipped ones, and a file that is in the tarball while being reachable from nothing is outside both — so the detection mechanism was a human reading unrelated code, which is how both instances found in one week were found ([#7319](https://github.com/objectstack-ai/objectui/issues/7319), [#7397](https://github.com/objectstack-ai/objectui/issues/7397)). The hazard is not the bytes: the file #7319 removed carried the same export name as a live engine one package over and evaluated no predicate, so name-completion alone could have wired a silently wrong renderer into a published package. Reachability has TWO roots, and the second is the whole difficulty — `packages/components` reaches its two `use-sync-external-store` shims only through `vite.config.ts` `resolve.alias` entries whose importer is a bundled dependency no source file names, so a walk that skips that leg reports exactly those two live files as dead on its first run, and a gate that cries wolf gets switched off rather than fixed. Scope is DECLARED per package in `COVERED_PACKAGES` and the uncovered remainder is printed as a count derived from the workspace on every run, because the alias mechanisms differ per package and a gate that covers one package correctly beats one that covers forty with false positives. An alias expression it cannot evaluate is a FINDING rather than a skip, since skipping one would make it accuse whatever file that alias points at. `pnpm check:doc-example-readers` runs next, on the same parser again: it fails when an exported symbol's own JSDoc `@example` hand-spells a resolution that its REAL call sites obtain by calling a shared reader. A doc comment is what the next call site is copied from, so prose that outlives the ruling it encoded re-seeds every later copy — measured at two cards and three copied call sites, both cards closed by pointing the prose at `resolveRecordSourceObjectName` (`b041b9c0c`, `2ce2612df`). Nothing here could see either one, and `check-spec-symbol-derivation` was credited with the class twice — in the second card's body and then in the dispatch that repeated it — while its rule 4 judges `@objectstack/spec` citations at member granularity and says nothing about prose prescribing a LOCAL spelling ([#7652](https://github.com/objectstack-ai/objectui/issues/7652)). It fires on four conditions at once — the example calls the symbol it documents, a real call site fills the same argument slot by calling an exported single-`return` reader, the example does not, and what the example writes there is that reader's own return expression or one of the rungs it resolves between — which is what keeps it off the literals and placeholders an example legitimately carries. It does NOT judge whether a prescribed spelling is correct: on the day either card was filed the prose and every copy of it agreed, and no gate reading only the tree can know a ruling. What it catches is the state right after, when the call sites move and the prose does not. `pnpm check:handler-key-reads` runs next, on the same parser again: it fails when an `on*` handler key that a REGISTERED renderer reads off the authored document is not a declared member of the zod arm for the type it is registered under. `BaseSchema` is `.passthrough()`, so an undeclared key is not refused — it stops being judged and the value is KEPT, then reaches the renderer that reads it; measured on the built dist, `{ type: 'kanban', columns: [], onCardClick: { action: 'toast' } }` went from REFUSED to ACCEPTED with the object surviving into the parsed output ([#7664](https://github.com/objectstack-ai/objectui/issues/7664)). Every gate stayed green, because the [#6124](https://github.com/objectstack-ai/objectui/issues/6124) ledger's population is two hand-written arrays of tuples and that change re-keyed the arm by SUBSTITUTION — so its length assertion held, and a count ratchet would have been green too, which is why `72498f257`, the commit that landed this gate, rejected that option on the instance itself. This gate derives BOTH populations: the arms from every `type: z.literal(…)` in `packages/types/src/zod`, and the read sites from every real `ComponentRegistry.register(…)` call — read off the AST, because one types file NAMES that call in prose eleven times and registers nothing. It follows the document one component at a time rather than every JSX child, because most children are handed a DIFFERENT document (a dashboard's widgets each get their own), and the chain it must reach is four hops long: `register('kanban', ObjectKanbanRenderer)` names a component, that component is an HOC, the document arrives at `ObjectKanban` through a render-prop parameter and at `KanbanRenderer` through an object spread. It says nothing about keys that reach a renderer only through a `{...props}` spread onto a Radix root or a DOM listener slot — there is no read site to derive from — nor about the ledger's `?: never` tombstones, which have no read site by construction; `KNOWN_UNDECLARED_READS` is an exemption list that only shrinks, each row naming the card that owns the fix, and a row whose read site the gate can no longer find fails it. It lives in `scripts/` because the read sites are spread across `@object-ui/plugin-*` and `packages/components`, which `@object-ui/types` may not import — `check:phantom-deps` rejects it and it would close a cycle. `pnpm check:metadata-write-doors` runs next, on the same parser again: it fails when an in-repo DOOR that can PUT an object-metadata document does not apply the object-metadata write guard. [#7714](https://github.com/objectstack-ai/objectui/issues/7714) ruled one client behaviour — a half-filled relationship is held client-side and the PUT body never carries one without a non-empty `reference` — and its PR implemented that ruling by ENUMERATING the writers it knew of, which were two. The identical defect was then reproduced on a THIRD writer neither guard covered, in that card's own required dogfood (recorded in `9662aca56`, the commit that landed this gate), and [#8676](https://github.com/objectstack-ai/objectui/issues/8676) swept and found nine more. The half that outlives the count is that the sweep the question is naturally asked in cannot see its own subject: `git grep 'client\.save('` returns ZERO over the file that third writer lives in, because the call is `client.save<any>(type, …)` and the generic argument sits between the name and the paren — and a hand-rolled `fetch` PUT to `/api/v1/meta/object/:name` is not that spelling at all. So this gate enumerates DOORS, never writers: the writer set is OPEN and nobody has to announce a new member, while the transport set is CLOSED and this repository owns it, so guarding the doors covers every writer past and future without a list anywhere. It derives every call carrying a `method: 'PUT'` literal whose URL RESOLVES to a `/meta` path — resolved through templates, fields and helper return values rather than read, because the repo's central door spells its URL three hops from the call and says nothing at the call site — plus every call to the SDK's `meta.saveItem`, which lives in a package this repo does not own and so cannot be guarded from the inside. A door whose type is a string literal other than `object` is exempt; a door whose type is a runtime value is judged CAPABLE, which is the fail-closed direction. It answers COVERAGE only — whether a guarded door's body is correct is the guard's own pins — and it refuses to report OK unless it found at least one door of each kind and at least one guarded door, so a renamed transport turns it red rather than green. Same placement rationale as the gates around it: it parses the sources with `typescript`, so it needs the install and nothing built. `pnpm check:published-tsconfig-exclude` follows, config reads only: it fails when a published package's build `tsconfig.json` excludes tooling by FILE NAME (`*.test.ts`) without also excluding the tooling DIRECTORIES (`**/__tests__/**` and its two siblings, derived from `TOOLING_FILE` rather than retyped). A name-only exclude stops the files that happen to be named that way and nothing else, so the first shared helper added to a `__tests__/` directory becomes a program input and an emitting program writes it into the published `dist` — three times so far, each found by a human and never by a gate ([#4006](https://github.com/objectstack-ai/objectui/issues/4006), [#4836](https://github.com/objectstack-ai/objectui/issues/4836), and a third in the same package as the first, all three recorded in `6aeba673c`, the commit that landed this gate). [#7212](https://github.com/objectstack-ai/objectui/issues/7212) measured the standing exposure — 29 published packages carrying the name form with ZERO offending files, green because nobody had added such a helper yet — and the gate landed together with their conversion so `main` was green on merge. It reads `exclude` arrays and nothing else: no build, no artifact, no emit model, which is the narrower scope that keeps it clear of the modelling [#4846](https://github.com/objectstack-ai/objectui/issues/4846) declined for the artifact-level gate. Six published packages are named carve-outs, each re-proving its own reason on every run: `cli`, `create-plugin` and `data-objectstack` emit from a `tsup` entry graph, `plugin-charts` keeps its tooling exclude in the `dts()` options, and `console` and `runner` are Vite applications with `noEmit: true` and no `dts()` plugin. `pnpm check:side-effects-array` runs next, sources only and no build: it fails when a package's `sideEffects` ARRAY and its module bodies disagree in either direction — a module that registers something at load time and is not named (a bundler drops it, and the registration is gone from a *consumer's* app with no error, no warning and exit 0), or a name whose module no longer registers anything. `@object-ui/app-shell` declares such an array because both simpler answers are measurably wrong for it: omitting the field makes the whole package unshakeable, and `"sideEffects": false` silently drops three live SDUI widget registrations to zero chunks ([#6535](https://github.com/objectstack-ai/objectui/issues/6535), [#6683](https://github.com/objectstack-ai/objectui/issues/6683)). The enumeration is re-derived from the module bodies on every run rather than listed, so there is no second copy to rot. The artifact half of the same contract — do those registrations survive a real bundler — cannot run in this job at all: it needs a built console, so it lives in the SDUI registration pin step of `performance-budget.yml`. `pnpm check:element-data-source-declaration` runs next, sources only and no build: it fails when a source that consumes `ElementDataSourceGate` does not also pass through `elementDataSourceBlock()`, the seam that declares the `dataSource` key the gate reads. A block that wraps the gate off-seam publishes an authoring surface missing the one key its own runtime honours, and the html tier reports that key with the same `unknown-prop` warning it gives the spellings that do nothing ([#6678](https://github.com/objectstack-ai/objectui/issues/6678)). `pnpm check:esm-specifiers` follows it for the same reason — sources only, no build: it fails when a published package whose build preserves import specifiers (a bare emitting `tsc`, which never rewrites them) writes a relative specifier with no file extension. Node's ESM resolver does not extension-search relative specifiers, so such a specifier makes the published entry unloadable outside a bundler; `@object-ui/react`'s entry died with `ERR_MODULE_NOT_FOUND` while every bundler-based consumer, the whole test suite and CI stayed green ([#4538](https://github.com/objectstack-ai/objectui/issues/4538)). The half that actually *imports* each built entry needs a full build and runs in `node-esm-load-gate.yml`. `pnpm check:action-forward-parity` fails when an action renderer's forward whitelist drops a key the action runtime reads — the class that shipped six times one key at a time, each time green, because the key parses and publishes while the payload is dropped one hop before the runner ([#4050](https://github.com/objectstack-ai/objectui/issues/4050)). `pnpm check:designer-field-key-parity` fails when one of the field designers' statically declared payload shapes (`FieldMetadataPayload`, `ServerFieldSchema`, `DesignerFieldDefinition`) declares a key the installed `@objectstack/spec` `FieldSchema` refuses by NAME. Such a key makes `PUT /api/v1/meta/object/:name` return a hard 422 `INVALID_METADATA` that blocks *every subsequent save* of that object, and the author cannot tell from the designer UI which key did it — the class had been filed three times, each closed with a per-key tombstone written after the instance was found in production, with nothing detecting the next one ([#4644](https://github.com/objectstack-ai/objectui/issues/4644) `indexed`, [#4687](https://github.com/objectstack-ai/objectui/issues/4687) `distance_metric`, [#4676](https://github.com/objectstack-ai/objectui/issues/4676) `placeholder`, gated by [#5761](https://github.com/objectstack-ai/objectui/issues/5761)). It reads the accept set off the schema itself rather than from a list, and it covers a deliberately documented *subset* of the write path: a key that reaches the payload only through a `patchDef` spread or an index signature is outside its reach, and the boundary is stated in the script's own docblock. Its draft-I/O half — the `readFields`/`writeFields` round-trip, which has no declared shape to read — runs in the test suite as `object-fields-io.spec-keys.test.ts`. Same placement rationale as the gates around it: it parses the sources with `typescript` and imports the installed spec, so it needs the install and nothing built. `pnpm check:icon-record-names` fails when an authored icon NAME that reaches a resolver reading lucide's runtime `icons` record is not a live key of that record. lucide retires a spelling by dropping it from that record while keeping it as a deprecated named export, so the retired name still imports, still type-checks and still renders wherever it is used as a *component* — `Edit === SquarePen` is true — and resolves to nothing wherever it is used as a *string*: nothing goes red in either direction, which is why the class was repaired twice in two packages before anyone gated it ([#5586](https://github.com/objectstack-ai/objectui/issues/5586), [#5622](https://github.com/objectstack-ai/objectui/issues/5622), [#5633](https://github.com/objectstack-ai/objectui/issues/5633)). It carries no list of retired spellings — the record itself is the judgement — and it re-discovers the resolver population from source on every run, which is how its first pass found four record-reading resolvers nobody had catalogued. It sits here because it parses the sources with `typescript` and reads the installed lucide: the install, and nothing built. The three locale gates sit in the middle because all of them parse the sources with `typescript`: they need the install and nothing built. `pnpm check:i18n-keys` fails when a `t()` call site asks for a key the `en` pack does not define ([#3530](https://github.com/objectstack-ai/objectui/issues/3530)); `pnpm check:i18n-drift` fails when a change to an `en` string is not accompanied by the nine translation packs ([#3650](https://github.com/objectstack-ai/objectui/issues/3650)), and it is why this job's checkout sets `fetch-depth: 0` — it diffs against the merge base, which a depth-1 clone cannot resolve. `pnpm check:i18n-designer-parity` fails when the metadata-admin designer's own module-local string tables come apart — an `en` row with no `zh` row, or a shared row whose two values carry different `{placeholders}` ([#8834](https://github.com/objectstack-ai/objectui/issues/8834)). The two gates before it are blind to that file by construction — the first classifies the module `module-local table` by declaration and skips it, the second read only the ten locale packs and this table is not one of them — so the same card also gave `pnpm check:i18n-drift` that table as a SECOND population, which is the half that catches a changed `en` value whose `zh` row did not follow. `pnpm type-check:scripts` (`tsconfig.scripts.json`) covers `scripts/**/*.ts`, which `pnpm type-check` cannot reach at all — `scripts/` has no package.json, so turbo never walks it, and the coverage guard decides coverage per *package*. Until [#3494](https://github.com/objectstack-ai/objectui/issues/3494) that left the pin tests in `scripts/__tests__/` — including the one pinning this very page — compiled by nothing. `pnpm type-check:vitest-config` runs `apps/console/tsconfig.node.json` directly — the program that already lists `../../vitest.config.mts` and `apps/console/vitest.config.ts` ([#3476](https://github.com/objectstack-ai/objectui/issues/3476)) — because until [#7328](https://github.com/objectstack-ai/objectui/issues/7328) the only thing that ran it was the console's own `type-check` script, reached through the task runner, whose `type-check` task waits on `^build`. (Named in prose rather than as a code span on purpose: the pin below reads this cell as this job's gate list, so spelling that invocation out would credit the job with a command it does not run.) The cheapest compiler that reads the root Vitest config was therefore reachable only through the most expensive job here, and PR #7291 paid for it: a conditionally spread `dist` project whose literal `extends: true` widened to `boolean` degraded the whole `projects` array to `never[]`, every gate its author ran was green, and CI reported three errors, two of them at `../../vitest.config.mts`. It sits in the cheap half beside `pnpm type-check:scripts` for the same measured reason — nothing in its program imports an `@object-ui/*` package, so it needs the install and nothing built. `pnpm type-check:vitest-setup` (`tsconfig.vitest-setup.json`) closes the same gap for the four repo-root `vitest.setup.*` files, uncovered until [#3515](https://github.com/objectstack-ai/objectui/issues/3515); it runs *last*, after `pnpm type-check`, because `vitest.setup.dom.tsx` side-effect-imports four `@object-ui/*` packages and resolves them through the declarations that turbo's `^build` produces. On the affected speed that run may build none of them — a change outside every package selects no package at all — so a step between the two builds them with `turbo run build`, naming the packages `scripts/select-type-check-scope.mjs --root-builds` reads out of `tsconfig.vitest-setup.json`'s `paths` on every run, and replaying each from the restored cache when its hash did not move ([#12272](https://github.com/objectstack-ai/objectui/issues/12272)). `scripts/select-type-check-scope.mjs` decides how much of the workspace `pnpm type-check` covers on a pull request or a queue build — the affected packages, or every package when a root file the package graph cannot see changed — as the two-speeds paragraph above describes; it fails open to the whole workspace, and `push` and `schedule` never ask it. `scripts/report-turbo-cache.mjs` checks nothing: `pnpm type-check` runs with `TURBO_RUN_SUMMARY=true`, and the script reads that run summary and prints, per task, what the restored `.turbo/cache` replayed and what re-ran — each re-run task with the tasks it depends on, since a task's hash folds theirs in — and emits the counts as one `::notice` annotation, which the check-runs API serves to readers who cannot open the job log ([#12222](https://github.com/objectstack-ai/objectui/issues/12222)). It runs after the last checking step, bounded and `continue-on-error`, like the cache save after it. On `push` and `schedule` only, the same script runs again with `--prune` and deletes every `.turbo/cache` entry the run did not use, and only those two events save the cache. On this job's first measured pull-request run the restore step's bare `turbo-Linux-` key matched another job's cache, saved minutes earlier on the same pull request (about 2 GB, most of it unused), and `actions/cache` tries every key on the run's own ref before it looks at `main` — so `main`'s type-check cache was never reached. The restore step now keeps only the job's own `turbo-Linux-type-check-` prefix, pull requests and queue builds save nothing, and the cache is written by the forced full battery alone, holding exactly the current verdicts and build outputs that every pull request and queue build restores ([#12222](https://github.com/objectstack-ai/objectui/issues/12222)). | Every run; on a PR the steps short-circuit when only ignored paths changed. `pnpm type-check` covers the affected packages (or, on a root change, the workspace) on pull requests and merge-queue builds, replaying unchanged ones from the cache; every package, nothing replayed, on `push` and the hourly `schedule` |
| `test` | Test (shard N/16) | Before its install, `scripts/objectstack-pin.mjs` restores or builds the pinned `@objectstack/*` (objectui#12957). When a pull request changed nothing outside the exclusion list, the decision step runs `scripts/markdown-test-inputs.mjs` before anything else, and the job runs in full when the answer is yes ([#8861](https://github.com/objectstack-ai/objectui/issues/8861)). The exclusions drop every markdown path, and a markdown document can be a TEST'S INPUT: [#8857](https://github.com/objectstack-ai/objectui/issues/8857) changed one package README, this job reported success in ten seconds having run nothing, and the merge-queue build then failed the same shard in 907 seconds and dequeued it. That script carries the derived class — which documents a test reads, and which test reads each — and audits itself against the tree. It is this job's stage only, because this is the job that runs those tests. [#9096](https://github.com/objectstack-ai/objectui/issues/9096) then added `scripts` to that scan, because the gate tests under `scripts/__tests__` read this repository's documentation as data and run in these same shards — measured by running all 46 of them under an fs trace, **every** tracked markdown file in the tree is opened by at least one of them. ⇒ for this job the markdown half of the exclusion list is now inert: **any markdown-only pull request runs the shards**. Priced over the 513 first-parent commits available then: 36 reached this stage, 21 already ran, and the widening moves 14 of the remaining 15 from skip to run. The rest of the exclusion list still pays — a non-markdown change under `content/**`, `docs/**` or `apps/site/**` skips as before. On a pull request or a queue build the job then runs `scripts/select-affected-tests.mjs` against the event's base sha and, when it answers `mode=affected`, `vitest run` over the filters it wrote, sharded the same way; a selector that cannot decide means the full suite, never a skip ([#12214](https://github.com/objectstack-ai/objectui/issues/12214)). Otherwise — and always on `push` and `schedule` — `pnpm test --shard=N/16` across a 16-runner matrix with `fail-fast: false`, so every shard reports its own failures. No coverage instrumentation — v8 adds 40–100% overhead. **4 → 8 shards, and the built-artifact pin step moved out of this job entirely, in [#9499](https://github.com/objectstack-ai/objectui/issues/9499).** At four shards this job had grown into its own `timeout-minutes: 20`: measured over the 14 most recent `merge_group` runs and the 14 most recent `pull_request` runs, the longest *succeeding* shard-1 job was 1199 s against the 1200 s ceiling — a one-second margin — and two runs crossed it and were **cancelled**, one of them dequeuing a pull request whose tests had passed, because the merge queue cannot tell `cancelled` from `failure`. The ceiling is **not** raised, no test is skipped and the exclusion list is not widened; the work is spread over twice the runners, and the one step that was never sharded at all is now the `test-dist-pins` job below. **8 → 12 shards in [#12208](https://github.com/objectstack-ai/objectui/issues/12208)** (its first pull request, folded into [#12214](https://github.com/objectstack-ai/objectui/issues/12214)'s): at eight the job was back against the same ceiling — 14.4 min median, 17.4 min p95 and 20.3 min max over the 1,728 shard jobs of one week, measured on that card — and the same three refusals hold: the ceiling is not raised, no test is skipped, the relevance gate is not widened. **12 → 16 shards in [#12384](https://github.com/objectstack-ai/objectui/issues/12384)**, by the same ruling's width rule (the width derived from the total measured duration at about 10 minutes per shard): balanced, the twelve legs ran 11.3 min median and 12.6 min p99, but in the 50 hours after the balanced plan landed the ceiling cancelled legs in 12 of 279 runs, with no hang, each on a VM that ran every file 1.6x to 2.0x slower than a normal one — episodically, and with no runner label that tells such a VM apart. Twelve legs left a p99 leg 1.59x of slack under the ceiling; sixteen carry 0.75 of the load each and move that to about 2.1x. The same three refusals hold, and no runner is pinned. Both speeds use the same legs. No shard is a required context any more — `test-aggregate` reports for all of them. **Which files a leg runs is decided by measured per-file duration** ([#12208](https://github.com/objectstack-ai/objectui/issues/12208)'s second pull request): vitest's own `--shard` hashed each path and cut equal *file counts*, so which leg drew the heavy files was luck. The root vitest config's `sequence.sequencer` (the `test-shard-sequencer` module beside this job's scripts, not a command this job runs) bin-packs the files heaviest first from the committed `scripts/test-shard-timings.json`; a file the dataset does not name is weighed at its median. On the full speed the job also passes `scripts/test-file-timings.mjs` as a third reporter (beside `default` and `github-actions`, which a CLI `--reporter` would otherwise displace), which records each file's whole time on its worker, and `push` and `schedule` runs upload it as the `test-file-timings-N` artifact that the weekly refresh reads. | Every event: the affected set on pull requests and merge-queue builds, the whole suite on `push` and the hourly `schedule`; steps short-circuit on a PR that changed only ignored paths |
| `test-dist-pins` | Test (dist pins) | Before its install, `scripts/objectstack-pin.mjs` restores or builds the pinned `@objectstack/*` (objectui#12957). The same decision step as `test` above, `scripts/markdown-test-inputs.mjs` stage included — deliberately verbatim, because this lane used to run whenever that job's gate said run, and a narrower gate here would silently stop running the built-artifact pins on the markdown-only pull requests [#9096](https://github.com/objectstack-ai/objectui/issues/9096) brought into scope. Then `pnpm test:dist` — the built-artifact lane ([#7183](https://github.com/objectstack-ai/objectui/issues/7183)). It delegates to a turbo task scoped to the one package that holds built-artifact pins; that task depends on the package's OWN build (`dependsOn: ["build"]`, not `^build`), so the bundle exists before the pins read it, and then runs the `dist` vitest project, whose pins import a package's BUILT bundle instead of its `src` — a claim the source-aliased suite above is structurally unable to make, since the root config aliases every workspace package to `src`. **Why it is a job and not a step on shard 1** ([#9499](https://github.com/objectstack-ai/objectui/issues/9499)): it was never sharded, so it made shard 1 structurally the longest leg of a matrix bounded by a 20-minute ceiling, and in **both** observed ceiling kills the job died in this step with the test step already green — the tests passed and the check reported `cancelled`. Measured across 28 full CI runs it costs 31–58 s (median ≈53 s); a separate job pays for one more runner and takes the asymmetry out of the matrix without touching a budget. | Every event (the `push` guard went with the shard matrix's in [#12214](https://github.com/objectstack-ai/objectui/issues/12214)); steps short-circuit on a PR that changed only ignored paths |
| `test-aggregate` | Test | `scripts/check-test-shard-results.mjs` — the **single required test context** ([#9499](https://github.com/objectstack-ai/objectui/issues/9499), director ruling letter C). It `needs` the shard matrix and `test-dist-pins`, and runs `if: always()` so a red, skipped or cancelled shard still produces a verdict here instead of skipping this job — a skipped required context counts as *success* in branch protection, which on the one context that speaks for the whole lane is the failure mode itself. ⛔ It does **not** gate on `needs.test.result`: a matrix job's `needs.<job>.result` is a single rollup over every leg, and a rollup reads `success` when some legs succeeded and the rest were **skipped**, so an aggregator built on that expression is a check reporting success having run nothing — [#8857](https://github.com/objectstack-ai/objectui/issues/8857) and [#3523](https://github.com/objectstack-ai/objectui/issues/3523) in one line of YAML. The gate reads this run's own job list from the Actions API instead (`actions: read`, nothing written) and asserts each shard **by name and by its own conclusion**; `skipped` is not a pass. It fails closed — an unreadable answer is exit 2 and a red context — and refuses any verdict over a job list that does not contain this very job, which is the control that the reading reached the right run at all. A shard the jobs API serves present but **without a conclusion** is re-read a bounded number of times ([#10931](https://github.com/objectstack-ai/objectui/issues/10931), [#13064](https://github.com/objectstack-ai/objectui/issues/13064)), and is also read from **its own check run**, `GET /check-runs/{id}` with the job's own id, because the jobs API has gone on serving finished shards without a conclusion for longer than the gate's whole budget ([#13327](https://github.com/objectstack-ai/objectui/issues/13327)). That check run's conclusion counts only when its id, name, app and page are the job's own, so a re-run shard can never be judged by the attempt before it; an answer the jobs API already gave is never replaced, and a check run with no conclusion either leaves the shard to the re-reads, which end red. Every run also reads this job's own check run once, so a check-run reader that cannot read reds every run at once rather than only during the next lag. The dist-pin job is asserted from `needs` directly, since a non-matrix job's result is its own. **Why one name:** naming the legs made the shard *count* a member of a repository-settings surface no workflow edit can reach — widening the matrix renamed four live required contexts at once. Last, `scripts/shard-headroom.mjs` prints the longest shard's wall against the `test` job's `timeout-minutes` and the width this run's measured total implies at a 10-minute target per shard ([#12208](https://github.com/objectstack-ai/objectui/issues/12208)). It is **report-only**: `if: always()` and `continue-on-error: true`, it exits 0 whatever it reads, and an unreadable job list prints NOT MEASURED rather than a number. `scripts/__tests__/shard-headroom.test.ts` pins its `--shards` and `--cap-minutes` to the matrix and the job it reads. | Every event — on `push` and `schedule` it is the full battery's test verdict |
| `test-coverage` | Test (coverage shard N/8) | Before its install, `scripts/objectstack-pin.mjs` restores or builds the pinned `@objectstack/*` (objectui#12957). `pnpm test:coverage --reporter=blob --reporter=default --reporter=github-actions --shard=N/8` across an 8-runner matrix with `fail-fast: false`. Each shard writes `.vitest-reports/blob-N-8.json` — raw coverage and test results in one file — and uploads it as an artifact even when the shard is red (vitest deletes `coverage/` on a red run unless `coverage.reportOnFailure` is set, [#5402](https://github.com/objectstack-ai/objectui/issues/5402)). The two reporters after the blob are what keep a red shard *readable*: a CLI `--reporter` replaces the default reporter set rather than adding to it, so `--reporter=blob` on its own ended a failing shard's log at `blob report written to …` with no test name and no assertion text, leaving the download-only artifact as the only copy of the failure ([#9177](https://github.com/objectstack-ai/objectui/issues/9177)); `--reporter=default` restores the log and `--reporter=github-actions` restores the per-test `::error` annotation. The flags are pinned by `scripts/__tests__/coverage-shard-reporter-readability.test.ts`. The configured coverage thresholds are neutralised on the shard legs, because a slice of the suite judged against a whole-suite threshold is not a defect signal; they are enforced once, on the merged report, by the job below ([#5403](https://github.com/objectstack-ai/objectui/issues/5403)). **4 → 8 shards in [#12256](https://github.com/objectstack-ai/objectui/issues/12256)** (folded into [#12208](https://github.com/objectstack-ai/objectui/issues/12208)): at four, a shard was cancelled at this job's 40-minute ceiling on 7 of 25 `push` runs measured on that card, and every shard of the runs that finished sat within one to three minutes of it. The width is derived from those walls at a 20-minute target per shard; the ceiling is not raised, no test is skipped, and the thresholds are unchanged. The width is spelled in this job's matrix, name and `--shard` flag and in `coverage-report`'s `COVERAGE_SHARDS`, and `scripts/__tests__/coverage-shard-width.test.ts` holds every spelling to the matrix. Its legs are split by the same duration-balanced sequencer as `test`. | **Push and the hourly schedule only** |
| `coverage-report` | Test (coverage) | Before its install, `scripts/objectstack-pin.mjs` restores or builds the pinned `@objectstack/*` (objectui#12957). Downloads every shard's blob report, refuses to continue unless all of them arrived (the count it expects is the job's `COVERAGE_SHARDS`), merges them with `pnpm test:coverage --merge-reports` into one complete report — which is where the configured coverage thresholds are enforced, over the whole merged map, the shard legs having overridden them to zero — and publishes that report as the `coverage-report` artifact (kept 7 days, the same as the blobs it is derived from). Its last step runs on every path and states the outcome: the job is **red, with an error annotation**, whenever the gate did not run for the commit — before [#5403](https://github.com/objectstack-ai/objectui/issues/5403) the final step carried the implicit `success()` and was silently skipped by 311 of 373 coverage jobs, which is how four days of a 100%-failing coverage job went unnoticed. A breach of the thresholds is reported *separately* from a lane that never delivered, because the two call for opposite actions. ⛔ It never merges a report from fewer than every shard: a wrong coverage number is worse than a missing one. The Codecov upload this job used to carry was retired by [#5436](https://github.com/objectstack-ai/objectui/issues/5436) — `CODECOV_TOKEN` was never set, so it failed on every push; the trend dashboard and PR coverage comments are gone with it, the gate is not. Before the verdict, `scripts/shard-headroom.mjs` prints the longest coverage shard's wall against the 40-minute cap and the width the run's measured total implies at a 20-minute target per shard. It is report-only in the same way as in `test-aggregate`. On a red lane it reads `scripts/` through a sparse checkout of its own, because the main checkout is skipped there. | **Push and the hourly schedule only** |
| `e2e` | Build & E2E | Before its install, `scripts/objectstack-pin.mjs` restores or builds the pinned `@objectstack/*` (objectui#12957). Builds the console with `vite build` (`VITE_BASE_PATH=/console/`), verifies the artifact, then `pnpm test:e2e --project=chromium`. On failure it uploads `test-results/` — the screenshots, traces and `error-context.md` Playwright writes for failing specs — as the `e2e-failure-artifacts` upload; the `github` reporter this lane runs on CI writes annotations, so there is no HTML report in it. | Every run; on a PR the steps short-circuit when only ignored paths changed |
| `docs` | Build Docs | Before its install, `scripts/objectstack-pin.mjs` restores or builds the pinned `@objectstack/*` (objectui#12957). `turbo run build --filter='@object-ui/site'`. On a PR it first diffs against the base and skips the build only when nothing that build consumes changed. ⛔ The path set is **not enumerated here**, deliberately: it is derived rather than curated — from the workspace packages turbo builds on the way to `@object-ui/site`, the root-level inputs `turbo.json` declares for the `build` task, and the workspace manifests, plus the workflow file itself so a change to this gate is validated by the gate — and a path list copied into prose is a stale list the moment the closure moves, which is the class [#8629](https://github.com/objectstack-ai/objectui/issues/8629) and [#7448](https://github.com/objectstack-ai/objectui/issues/7448) each record. `scripts/__tests__/docs-build-trigger.test.ts` re-derives all three populations on every PR and executes the step's own shell against them, so the live answer is the pathspec in the step and a red test is what happens when it stops covering them. Until [#8647](https://github.com/objectstack-ai/objectui/issues/8647) the filter named the site's **output** surface only — the docs content and the site app — while its **input** surface is everything turbo builds before `next build` runs, so a pull request touching only `packages/**` skipped the build and still reported `success`, and a skipped build and a passed build are the same green to every reader downstream. The merge-queue leg always built, so what the filter cost was early detection rather than the guarantee at merge time. Then `scripts/check-doc-expression-carriage.mjs`, which is **report-only**: it censuses every `json` fence on the surface `check:doc-types` walks (`content/docs/**`, every `apps/<app>/docs/**` tree, and the root `README.md` — widened from `content/docs/**` alone in `59a3a233d`) for a `${…}` authored on a key `SchemaRenderer` never evaluates — the class that reached `main` four times under green gates, because `check:doc-types` judges the `type` literal only and `check:doc-snippets` compiles the ts/tsx blocks only ([#7851](https://github.com/objectstack-ai/objectui/issues/7851)). It prints its findings and **exits 0 regardless**, so it can block no merge; it exits 1 only when the instrument itself is broken — a derivation that matched nothing, a missing `@objectstack/spec` artifact, or a failed built-in control — because a check that runs, goes green and looked at nothing is worse than none. Report-only is a ruling, not an oversight: three cards of the class it reports ([#7440](https://github.com/objectstack-ai/objectui/issues/7440), [#7444](https://github.com/objectstack-ai/objectui/issues/7444), [#7838](https://github.com/objectstack-ai/objectui/issues/7838)) are open and each fixes its own sites. Then — bookkeeping only, after the verdict — `scripts/report-turbo-cache.mjs`, which posts the restored cache key and what the build replayed as one notice, and on `push` and `schedule` prunes the cache to what the build used before it is saved; a pull request or queue build restores `main`'s entry under this job's own key prefix and saves nothing ([#12276](https://github.com/objectstack-ai/objectui/issues/12276)). It does **not** check docs links any more — that moved to a workflow of its own (#3448), because this workflow's `paths-ignore` then hid exactly the docs-only PRs a link check needs to see — today the Internal Docs Link Check step of `repo-gates.yml` (#12214). #3523 has since removed that filter from the `pull_request` trigger, but the check stays out of this job: `repo-gates.yml` still runs where this workflow does not (a docs-only push to `main`), and one gate with one home was the point of #3448. | Every run (build itself conditional) |

Uses: Node 22.x, pnpm via `corepack`, `actions/cache` over `.turbo/cache`.

### What is *not* in `ci.yml`

Three job names this page has carried at one time or another are absent from `ci.yml`, and looking
for them there is a dead end:

- **Lint** is not a `ci.yml` job, and never was. ESLint runs in its own workflow, `lint.yml` (next
  section), and shows up as a separate **Lint** check on the PR.
- **Build Core** does not exist, and never did. `ci.yml` builds only the console SPA that Playwright
  consumes; building the packages and measuring their size belongs to the Bundle Analysis workflow
  (`performance-budget.yml`), as the comment on the `e2e` job states.
- **Dev-server fixture build** (`dev-server`) is the one that *did* exist, and it is the cautionary
  tale behind the pin above. It was added on 2026-05-24 to run
  `pnpm --filter @object-ui/dev-server build` against an in-repo `apps/dev-server`. That app was
  removed two days later, on 2026-05-26 — after which the filter matched no package and the job
  exited 0 without building anything. It stayed green by vacuity for over two months; was then
  *documented in that state* by
  [#3253](https://github.com/objectstack-ai/objectui/pull/3253) on 2026-08-03, whose table row
  claimed a fixture-drift guard that had not run since May; and was finally deleted from `ci.yml`
  by [#3325](https://github.com/objectstack-ai/objectui/pull/3325) on 2026-08-04, which left the
  row behind ([#3451](https://github.com/objectstack-ai/objectui/issues/3451)). **Today there is no
  `apps/dev-server` and no such job** — nothing in the repository is being left unguarded by its
  absence. The intent it was meant to serve, proving this console still works against a real
  `@objectstack` backend, is carried by `live-e2e.yml`, informationally.

  Both halves of that history are the reason the job table is pinned. A row can be wrong because
  the job was deleted under it, and a row can be wrong the day it is written, because the job it
  describes was already doing nothing. Understating a gate is annoying; advertising a guardrail CI
  does not have is worse than no doc, because people trust it and stop checking.

## Lint (`lint.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Triggers:** **Every** PR to `main`/`develop` (no path filter), every merge-queue build, pushes
to `main`/`develop` under the same `paths-ignore` as `ci.yml` minus `apps/site/**`, plus manual
dispatch. As in `ci.yml`, the path list moved into the job ([#3523](https://github.com/objectstack-ai/objectui/issues/3523)): the `Lint`
context now reports on every pull request, and short-circuits to no install and no lint when only
ignored paths changed.

This is a **real PR gate**, and it is easy to miss because it is not part of CI — it is its own
**Lint** entry in the checks list.

The bullets below are this job's gate list, in the order it runs them. Everything above
`pnpm lint` runs **before the install**: each of those reads sources with nothing beyond node
builtins and a local module, so none of what they need lives in `node_modules` — and placed there,
a failed install cannot make them green. Where a gate ships a `--self-test`, the job runs that
first, which is what stops a scanner that recognises nothing from reporting a clean tree forever.

- `scripts/check-lint-coverage.mjs` runs first: every package must run ESLint or be declared a
  known gap. turbo skips scriptless packages silently, so without this guard a package reads as
  clean because nothing ever linted it.
- `scripts/check-entry-guard.mjs` — every `scripts/**` CLI must answer "did node run me, or did
  something import me?" through one shared predicate. node resolves symlinks for the module graph
  but leaves `process.argv[1]` as the caller typed it, so a hand-typed guard reached through a
  symlink compares two different paths, answers no, and the script does **nothing** — exit 0, no
  output, and the wrapper that spawned it reads a green gate. Measured on a real blocking gate
  here: `check-skills-paths.mjs` run directly on a deliberately broken tree exits 1 naming the dead
  path; through a symlink, on the same tree, it exits 0 in silence
  ([#6092](https://github.com/objectstack-ai/objectui/issues/6092)). (Named without its `scripts/`
  path on purpose: this section reads as the `lint` job's gate list, and that script runs in
  `repo-gates.yml`, so spelling the path here would credit this job with a gate it does not run.)
- `scripts/check-bash32-floor.mjs` — this repository's own shell must run on bash 3.2, which is what
  macOS ships and what CI never exercises. Under bash 5 a `mapfile`, a `declare -A` or an unguarded
  `$EPOCHSECONDS` in a hand-run script is invisible: the defect *and* its repair both read green,
  and the only reader who ever meets the failure is a contributor on a Mac at the moment they most
  need the script to work. Its scan roots are `scripts/**`, `.claude/hooks/**` and `e2e/**` — the
  third is the point rather than a detail, since two of the four shell files this repository wrote
  itself live under `e2e/live/ci/`
  ([#7692](https://github.com/objectstack-ai/objectui/issues/7692)).
- Then `pnpm lint`.
- Then `scripts/check-vi-mock-override-shape.mjs` — a `vi.mock` factory that overrides a typed
  export must hand back the shape that export declares. Its two siblings run in
  `repo-gates.yml`'s Inert vi.mock Specifier Check and judge different properties of the same call sites: whether a relative
  specifier resolves, and whether the factory inherits the real module. Neither judges what the
  override is **worth**, and `tsc` never looks — a `vi.mock` factory is untyped, so the compiler
  never compares a stub against the export's type. Measured rather than argued: thirteen
  `RecordDetailView` stubs returned `{ viewers, others }` where `useRecordPresence` is declared
  `PresenceUser[]`, and with all thirteen back on disk both existing gates printed a **byte-identical
  verdict line and exit 0** ([#8083](https://github.com/objectstack-ai/objectui/issues/8083), repaired
  by [#8902](https://github.com/objectstack-ai/objectui/pull/8902)). The failure mode is the
  asymmetric one: when the stubbed contract moves, the files that stubbed it correctly go red and the
  drifted ones stay green. It runs **after** the install rather than beside its siblings because it
  reads declared return types with the TypeScript parser, and every pre-install gate's import graph is
  held to node builtins plus local modules
  ([#8903](https://github.com/objectstack-ai/objectui/issues/8903)).
- Then `scripts/check-test-path-roots.mjs` — a test that reads the filesystem inside an assertion
  must root its paths on **its own file**, never on `process.cwd()`. The cwd is not one place here:
  a package's own `test` script moves Vitest's root up to the repository root and leaves
  `process.cwd()` down in the package directory, so a path assembled from the cwd reads a
  **different tree** depending on which invocation started it, and a single assertion reaches two
  verdicts — measured at `7 passed` from the repository root and `2 failed / 5 passed` from the
  package directory, cwd the only variable
  (`223b1e4a3`). Root `AGENTS.md` had taught
  that rule with nothing behind it, and what a taught-only rule costs is also measured:
  [#7799](https://github.com/objectstack-ai/objectui/issues/7799) repaired thirteen instances of the
  class in a single day without closing it, and `gridArrayArmOrderby-8973.test.tsx` — written
  **after** that sweep — arrived carrying the same defect
  ([#8953](https://github.com/objectstack-ai/objectui/issues/8953)). It is deliberately not a
  `process.cwd` grep, because one of those thirteen was invisible to the census regex that found the
  other twelve: it spelled the read through a `globalThis` cast, to dodge a browser `process` shim.
  So the scan starts at the **filesystem call** and resolves what its path argument is rooted at
  through the file's own bindings — which catches a root laundered through a `const`, on a line that
  holds no `cwd` at all — and it decides what counts as a filesystem call by **import provenance**
  rather than by name, because a test that declares its own `writeFile` into a temporary directory
  is twelve false positives for anything reading the spelling. Across the tree, name-matching
  produced 28 violations and provenance produces 8.
- ⚠️ **Read that gate's green for what it is: it declares its own blind spot on every run.** The
  census line ends with `N root(s) NOT CLASSIFIED` — 376 as this was written, enumerated by
  `--blind` — because root resolution stops at the module edge, so a root arriving as a function
  parameter or from an import is invisible to it. That is the largest gap and it is structural: one
  of the three files repaired alongside the gate handed `process.cwd()` straight to a helper that
  did the reads, and was found by a human reading the file, not by the gate. A clean run is a
  verdict on the roots this gate can classify, never a clean bill of health for the class — which is
  the same over-reading the card itself is about.
- Then `scripts/check-cross-repo-closer-outcome.mjs` — it extracts the ~250 lines of inline
  `github-script` out of `cross-repo-issue-closer.yml` with a real parser, never a retyped copy,
  runs it under doubles the way `actions/github-script` does, and pins each exit's outcome: which
  of `setFailed` / `warning` / job summary fires, and which API calls were made. That workflow runs
  only on a merge, its conclusion is required by nothing, and every run of it so far has been
  green — which is the problem rather than the reassurance, since its close loop has had a live
  target roughly one and a half times a day and taken the same `already closed -- skipping` exit
  every time ([#5261](https://github.com/objectstack-ai/objectui/issues/5261)).
- Then `pnpm check` — this repository's own tree run through `objectui check`, the command the CLI
  ships. The step builds the CLI and its workspace dependency closure first, through pnpm rather
  than turbo: the root script executes `packages/cli/dist/`, this job installs without building, and
  a turbo cache hit can replay a build that writes no `dist/` at all — either way the step would
  then fail for a reason that has nothing to do with the tree being checked. Nothing ran this
  command until
  [#5246](https://github.com/objectstack-ai/objectui/issues/5246) — it had been exiting 1 on `main`
  for as long as any `tsconfig.json` carried a comment
  ([#5237](https://github.com/objectstack-ai/objectui/issues/5237)), and no gate ever asked.
- Then — bookkeeping only, after the verdict — `scripts/report-turbo-cache.mjs`: one notice naming
  the restored cache key and how many package `lint` tasks the cache replayed, and on `push` a prune
  to what the run used before the cache is saved. A pull request or queue build restores `main`'s
  entry under this job's own key prefix and saves nothing. The replay depends on `turbo.json` giving
  the root `//#lint:root` task the inputs it lints: every package's `lint` depends on it, so with no
  inputs it hashed the whole repository and no package's lint could replay
  ([#12276](https://github.com/objectstack-ai/objectui/issues/12276)).

**It gates errors, not warnings.** `--max-warnings` is deliberately unset: the repository carries
thousands of warnings (overwhelmingly `no-explicit-any`, plus React Compiler rules the config
downgrades on purpose), and failing on those would make the gate unusable. What must stay clean are
the rules [`eslint.config.js`](https://github.com/objectstack-ai/objectui/blob/main/eslint.config.js)
sets to `error` — including the custom `object-ui/*` ratchets, each of which carries the ADR or
issue it came from in a comment beside the rule itself. Until #2923 this workflow was
`workflow_dispatch`-only, so every one of those `error` ratchets was inert: each was written
specifically to fail CI, and nothing ran them.

The `pnpm check` step splits the same way, and by the command's own behaviour rather than by a flag
set here: `objectui check` exits non-zero on parse errors only, while its unknown-schema-type
warnings print and leave the exit code alone. This gate neither promotes those warnings to failures
nor suppresses them from the log — [#5127](https://github.com/objectstack-ai/objectui/issues/5127)
owns that arm and is open.

## Performance Budget (`performance-budget.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Triggers:** Push and PR when changes touch `packages/`, `apps/console/`, or `pnpm-lock.yaml`.
Its display name in the checks list is **Bundle Analysis**.

### Enforced limits

The `Check console performance budget` step makes **three** measurements and returns one verdict.
All run before any of them may fail the step, and **any one can fail it** — this is not a single
enforced number with two advisory readings beside it:

| Bundle | Max gzip size | Enforced |
|--------|---------------|----------|
| Console main entry (`apps/console/dist/assets/index-*.js`) | **350 KB** (`MAX_ENTRY_GZIP_KB`) | Yes — the step exits non-zero when the entry chunk exceeds it |
| Eager closure — every chunk the entry reaches through **static** imports, i.e. everything the browser must fetch and parse before the app renders | ⛔ Deliberately not restated here. The ceiling lives in `scripts/check-eager-closure-budget.mjs` beside the argument that produced it, and `pnpm check:eager-closure` prints the measured payload, the ceiling and the headroom together in one verdict line | Yes — the step captures that gate's exit code and exits non-zero on it |
| Locale-catalogue composition — WHICH of the ten `@object-ui/i18n` catalogues that eager closure holds, measured by `pnpm check:eager-locale-catalogues` ([#7479](https://github.com/objectstack-ai/objectui/issues/7479)). Exactly one may be eager, and it must be the resident `en` | Not a size at all — a membership verdict | Yes — the step captures that gate's exit code and exits non-zero on it |

The third measurement exists because the second one cannot state it. The catalogues could return
to the eager closure **one at a time**, each arrival small enough to fit inside a ceiling's
headroom, and every byte verdict would be green until the last one; and they could be routed into a
chunk with more room without a single byte leaving the browser's request list, which
[#7399](https://github.com/objectstack-ai/objectui/issues/7399) named and refused. A byte ceiling
cannot tell "left the closure" from "moved somewhere roomier"; a membership verdict can.

Measurement 1 alone was the whole budget until
[#5324](https://github.com/objectstack-ai/objectui/issues/5324): `advancedChunks` routes vendor and
workspace code into named chunks on purpose, so most regressions land **outside** `index-*.js` where
the entry-chunk line cannot see them.

> The 350 KB above is **pinned to the workflow**, not retyped from memory:
> `scripts/__tests__/ci-cd-pipeline-doc.test.ts` reads `MAX_ENTRY_GZIP_KB` out of
> `.github/workflows/performance-budget.yml` and fails `pnpm test` if this page
> disagrees with it. Change one and you must change the other — the number cannot
> drift silently again ([#3197](https://github.com/objectstack-ai/objectui/issues/3197)).

- Builds the workspace packages with `turbo run build` (filtered to `packages/*`), then builds the console app, and measures bundle sizes.
- Posts a PR comment with the budget report and pass/fail status — but **only when the bundle was actually measured**. A run that was cancelled (a second push supersedes the first via `cancel-in-progress`) posts nothing, and a run whose build never produced a bundle posts a neutral "not measured" note instead of a verdict. A `FAIL` verdict therefore always carries the measured size that exceeded the budget.
- The comment is rendered by `scripts/render-budget-comment.mjs` (unit-tested), not by logic inlined in YAML.
- Runs `pnpm check:sdui-registration-pins` in a step of its own, after the budget step. This is the **artifact** half of the `sideEffects` contract: the static gate in `ci.yml` proves the array agrees with the module bodies, but only a real bundler run proves the SDUI widget registrations still reach a chunk. The step declares no `continue-on-error`, so a dropped registration fails this workflow — a size win bought by silently deleting a feature must not read as a size win.
- Then — bookkeeping only, after the verdict — `scripts/report-turbo-cache.mjs`: one notice naming the restored cache key and what the package build replayed, and on `push` a prune to what the build used before the cache is saved. A pull request restores `main`'s entry under this job's own key prefix and saves nothing ([#12276](https://github.com/objectstack-ai/objectui/issues/12276)).

**If it fails:** the step prints `BUDGET EXCEEDED: Main entry is <n> KB gzip (limit: 350 KB)`
and the PR comment carries the same two numbers, so the log already tells you the size and the
overshoot. Read the package size report appended to that comment next: the entry chunk is
`apps/console`'s own code plus everything it imports eagerly, so a jump usually traces to one
new eager import pulling a dependency in. Fix it at that import. Raising `MAX_ENTRY_GZIP_KB`
is a deliberate decision, not a workaround for a red check — and it cannot be done quietly,
because the pin above fails until this page states the new number too.

**If the eager-closure half fails:** the same step reports it, and the gate's two non-zero exit
codes are different verdicts on purpose. `1` is a verdict about the **bundle** — the closure is over
its ceiling. `2` is a verdict about the **gauge** — the report could not be read, or a ceiling has
drifted out of range of the regression it exists to catch, or it was replaced on the base branch
after this checkout was made. The step turns a `2` into a failing run carrying a message that says
so, because a run that measured nothing is not a passing budget and is not a size regression either.
Run `pnpm check:eager-closure` locally to see which it is; the step log names the half that spoke.

**If the composition half fails:** `pnpm check:eager-locale-catalogues` reads the same three exit
codes the same way — `1` names the catalogues that became eager, `2` says it could not weigh them
(no built report, a catalogue emitted under no chunk of its own, or the resident catalogue missing
from the eager closure, which is what a broken graph walk looks like). ⛔ Raising a byte ceiling is
never the remedy for a `1` here: the verdict is about composition, and the fix is at the import that
made a catalogue statically reachable.

### Package size report — advisory, not a gate

The same workflow's `Generate package size report` step writes a markdown table of every
`packages/*/dist/*.js` file with its raw and gzipped size, and that table is appended to the
PR comment. The report is generated only from a **complete** package build, so it is never a
truncated table that looks complete.

The step **never compares a measured size against a limit and never exits non-zero** — it
`echo`s the three tiers below into the report as explanatory text. They are guidance for
reviewers; exceeding any of them turns no check red and blocks no merge:

| Package category | Advisory target (gzip) | Enforced |
|------------------|------------------------|----------|
| Core packages | < 50 KB | **No** — advisory only |
| Component packages | < 100 KB | **No** — advisory only |
| Plugin packages | < 150 KB | **No** — advisory only |

> **There is no separate size-check workflow**, and there never has been one in this
> repository — the package size report has always been a step inside
> `performance-budget.yml`. This page used to document one as its own workflow file,
> enforcing the three tiers above; both claims were false, which is worse than no
> documentation because it advertises a guardrail that does not exist. If you want
> these tiers enforced, add the comparison to the workflow — do not describe it as
> enforced here.

## Live E2E (`live-e2e.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Trigger:** PRs to `main` / `develop` (same code-path filter as `ci.yml` — docs-only and
changeset-only PRs skip it), a nightly cron (`30 6 * * *`) on `main`, and manual dispatch.

**Blocks a merge: no** — because the job is not in the required-check set and `live-e2e.yml`
declares no `merge_group` trigger, so a queue build never waits on it and it cannot eject a PR
from the queue. Do not add it to required checks until the nightly record proves the lane
stable; see the header comment in the workflow file (#2835).

**Advisory, and honest about it: the run conclusion agrees with the job conclusion.** The job
carries no `continue-on-error`, so a failing spec fails the workflow run as well as the job. It
used to carry `continue-on-error: true`, and that flag moved neither the job nor its check run —
both stayed red — while flipping the run and check-suite conclusions to `success`. Three
consecutive nightlies reported `success` at the run level with a red job inside one of them, so
every monitor, digest and agent reading run-level conclusions was told the negation of what had
happened, and the backend outage underneath ran a day unseen
([#8084](https://github.com/objectstack-ai/objectui/issues/8084)). Advisory and honest are
different axes: this lane is the first without giving up the second, and nothing may re-add that
flag to buy back a green aggregate.

What it does: runs an allowlist of the live specs (`pnpm test:e2e:live:ci`) against a real
`objectstack dev` backend booted from **published** `@objectstack/*` packages serving the
showcase app, catching the class of bug only a real browser against a real backend can see.
Failures still surface as a red step, a job summary, and a `live-e2e-artifacts` upload.

**What that upload actually contains — and what it does not.** It carries `test-results/` (the
failure screenshots and videos the config's `use.screenshot` / `use.video` settings write) plus
`backend.log` and `console-preview.log`. It carries **no Playwright HTML report**:
`playwright.live.config.ts` declares `reporter: [['list']]`, and the `list` reporter writes to
stdout, so nothing in that config ever produces a `playwright-report/` directory. The durable
record of what the specs did is the `Run live E2E allowlist` step's own log. This page and the
workflow header both promised an "uploaded Playwright report" for as long as the lane has
existed, and no run could ever have produced one (objectui#8238) — so if you want a report to
open, the reporter list in `playwright.live.config.ts` is the one line that decides it, and it
must move together with this paragraph and the workflow's upload glob.

⚠️ **The upload step is gated `if: ${{ !cancelled() && failure() }}`.** On a **green** lane it
does not run at all, so there is no artifact and nothing to count. Any acceptance criterion
phrased over this artifact's contents — "the uploaded artifact has more than N files", "a
directory X appears in it" — is therefore readable **only on a run that failed**. Phrase checks
about this lane against the `Run live E2E allowlist` step's log instead, which exists in both
outcomes.

**Which specs are in the allowlist:** whatever the `test:e2e:live:ci` script in `package.json`
names — that script is the single source of truth, and this page deliberately does not repeat
the list. The lane grows the allowlist a few proven specs at a time (see the workflow's header
comment), so every promotion would stale a hand-copied enumeration here; it already did
(objectui#3488).

Backend pins live in `e2e/live/ci/backend.env` and must match the `@objectstack/spec` version the
pinned build in `pnpm-lock.yaml` declares — bump both in the same PR, or the run proves nothing.
Since objectui#12957 the lockfile resolves `@objectstack/spec` to a directory built from the commit
`.objectstack-sha` names (`.objectstack-pin/spec`), and the version is the one that
directory's committed `package.json` carries (objectui#13008). ⚠️ objectstack moves that string only when it releases, so a
pin between two releases matches the earlier release's backend by number while the console carries
later commits; this lane still runs the published backend, and nothing here closes that gap.

`OBJECTSTACK_VERSION` is the only `@objectstack` value that file declares, and moving it is the
only move. The showcase-app commit the lane sparse-checks-out is **derived**, not pinned:
`start-backend.sh` resolves the `@objectstack/cli@$OBJECTSTACK_VERSION` release tag at boot
(`git ls-remote --tags`, peeled sha) and refuses to start when it does not resolve. It used to be
a second key, `OBJECTSTACK_REF`, moved by hand under a MUST that nothing could check — the same
shape as the version drift above, and retired for the same reason (objectui#7964). Deriving it
means the app source and the published packages it runs on come from one release by construction.

The published manifests decide what the backend's install puts on disk, which is the pair the
lane exists to test. **One** transitive override is written, and only because npm 10 cannot
install the published graph without it: `start-backend.sh` adds a root `overrides.vitest`
(its `VITEST_OVERRIDE`) to the rewritten showcase manifest. Without it npm 10 — the npm Node 22
ships, so the npm the runner installs with — dies building the ideal tree with
`Cannot read properties of null (reading 'edgesOut')` on an optional `vitest` peer in the
published graph ([#12649](https://github.com/objectstack-ai/objectui/issues/12649)). Nothing
put vitest into the `18.0.0-next.2` install, so there the override steered the resolver and changed no
package the backend runs — a one-off reading on that issue, which nothing here re-derives.
The script carries the reason and the condition for removing it, and its stamp carries the
value, so a cached fixture prepared under another install recipe is rebuilt instead of reused
(the fixture cache key hashes `backend.env` alone, so it cannot see a recipe change made in the
script). ⚠️ What the cache still hides: a cold install broken by the registry moving under
unchanged pins — which is how this one broke — stays out of sight until `OBJECTSTACK_VERSION`
moves, because only then does the key miss.

`backend.env` used to carry a **second** pin, `BETTER_AUTH_VERSION`, with
`e2e/live/ci/better-auth-pin.mjs` as its guard. It was a
workaround for a break inside the published packages: `@objectstack/plugin-auth` imported an
export `@better-auth/core@1.7.3` removed in a patch release, so the lane held the family at 1.7.2
(objectstack#16186, objectui#8084). Both were retired together in the 17.5.0 bump, as their own
text prescribed (objectui#11073, the maintainer's ruling on objectui#11111): `plugin-auth` 17.5.0
declares the whole family at exactly 1.7.3 and no longer imports that export, so holding 1.7.2
on it made the lane test a combination nobody ships, and the seeded sign-in never answered.

## Repo Gates (`repo-gates.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**. **Appears as:** Repo Gates.

One job, one checkout, one setup, fifteen checks
([#12214](https://github.com/objectstack-ai/objectui/issues/12214), the two-speed doctrine of
[objectstack#22998](https://github.com/objectstack-ai/objectstack/issues/22998)). Each check below
used to be a workflow of its own, paying its own runner, checkout and Node setup on every pull
request, push and queue build, to run a gate that mostly takes seconds. They were folded into one
job, and nothing was weakened in the fold:

- every check runs the same command on the same events, with no path filter, as it did alone;
- every check keeps its name — each step is named `<check> — <step>`, where `<check>` is the job
  name it used to report under — so a red **Repo Gates** context names the gate in its step list;
- every gate step runs `if: ${{ !cancelled() }}` (or on the install or build it needs), so one red
  gate never hides another.

**What moved:** the check runs. None of the fifteen was a required context of the merge queue —
`scripts/check-required-check-set.mjs` reads the live set — which is also why `changeset-presence.yml`
(**Changeset Declaration**), the Spec Main Shape Gate and `governed-surface-guard.yml` were not
folded: their contexts were required when the fold landed, and a step inside a job is not a check run
(the spec gate's has since left the set, by
[#12240](https://github.com/objectstack-ai/objectui/issues/12240), and its workflow was deleted by
[#12352](https://github.com/objectstack-ai/objectui/issues/12352) when the gate
[moved to objectstack](#spec-shape-gate--moved-to-objectstack)). The one in-tree
reader of the old names, `REQUIRED_CONTEXTS` in `scripts/dependabot-merge-gate.mjs`, now waits for
the one context this job produces.

**The order is install-free gates, then the install, then the build.** The install-free gates read
the checkout with `node:fs` and nothing else, and run *before* `pnpm install` — which is what keeps
them inside the population `scripts/check-pre-install-import-graph.mjs` derives and holds to an
import graph free of `node_modules`. The three gates that judge the *published* type surface share
one build: `turbo run build` over every package under `packages/` (the README export check reads
each package's declared type entry), in union with the closures the two snippet gates derive with
`--build-filter`. ⛔ It is never an unfiltered workspace build, and a derived filter that names no
package is refused at the step that derives it. That build restores this job's own turbo cache
(key prefix `turbo-<os>-repo-gates-`, [#13348](https://github.com/objectstack-ai/objectui/issues/13348)):
pull-request and queue runs restore and never save; a push saves it after pruning it to what the
run used, and every run reports what it replayed — bookkeeping only, after the verdict —
with `scripts/report-turbo-cache.mjs`.

The sections below are the fifteen gates, each under the name its step carries.

### Control Bytes — the Control Byte Scan step

**Triggers:** Push and PR to `main`/`develop`, plus manual dispatch — with **no path filter at
all**, which is the point of the workflow. It runs as the **Control Byte Scan** step of the **Repo Gates** job.

Runs `scripts/check-control-bytes.mjs`, which reads `git ls-files` and rejects raw control
characters in every tracked **text** file: the C0 range apart from tab, line feed and carriage
return, plus U+007F. No install, no build — a checkout and one `node` call.

**Why it blocks a merge.** A single raw U+0000 makes grep and ripgrep classify the *entire* file
as binary: they print `binary file matches` and no matching line, so the file silently drops out
of code search and out of every grep-based lint. Nothing else catches it — git decides
binary-ness from the first 8000 bytes only, so a control byte past that offset keeps diffing as
ordinary text, and review cannot see a character that renders as nothing. objectui had no such
guard until objectstack#5425, by which time five files had accumulated the defect.

The two byte classes carry different harms and the report says which:

| Byte | Harm | Measured behaviour |
|---|---|---|
| U+0000 | Code-search outage | GNU grep 3.11 and ripgrep 14 both refuse to print matching lines |
| Every other control byte | Invisible, unreviewable literal | Both tools print the line normally |

Covering only U+0000 would reproduce a known miss: objectstack#5140 shipped a NUL *and* a U+0001
fourteen bytes away, and the NUL-only scanner reported OK on the second one (objectstack#5157).

**Why it is a separate workflow.** `ci.yml` and `lint.yml` used to list `'**/*.md'`, `content/**`,
`docs/**` and `.changeset/**` under `paths-ignore` on *every* trigger, and GitHub has no per-job
path filter. Markdown
is exactly the carrier the worst instance of this bug used — objectstack#4890 was a raw NUL in a
`.claude/` skill file, emitted by the PR that was writing the rule forbidding it, leaving the agent
instructions unfindable by `grep -r` with no signal that anything was missing. A path-filtered gate
could not have seen that PR. [#3523](https://github.com/objectstack-ai/objectui/issues/3523) has since taken that filter off their
`pull_request` triggers, so a markdown-only PR does start them now — but their jobs short-circuit
to nothing on such a change, and both keep the filter on `push`. This gate stays where it is, and
its unfiltered trigger set is why it is one of only two contexts that audit found safe to make
required today. `scripts/__tests__/check-control-bytes.test.ts` fails if a `paths` or
`paths-ignore` key is ever added here.

**If it fails:** write the escape sequence (backslash, lowercase `u`, four zeroes) instead of the
byte — the resulting string is byte-identical at runtime. Better still, if the byte was only ever
"a character the data cannot contain" (a join/split separator, a sentinel), use something a reader
can verify: a newline, a comma, or `JSON.stringify`, which needs no impossible character at all.
When writing *about* these bytes in prose or in a tool payload, name them as `U+0000` — a backslash
escape typed into an agent's tool payload gets decoded into the real byte before it reaches disk,
which is how two of the five incidents in this family happened.

**Known pre-existing offenders.** `KNOWN_OFFENDERS` in the script baselines the files that already
carried a control byte when the gate landed, so it could be switched on as a ratchet. It is not a
skip-list: the scan fails on an entry whose file has been cleaned or deleted, so a fix that forgets
to remove its entry is as red as a new offender. Entries carry the issue tracking their removal
(objectstack#5450) and the map is expected to reach empty and stay there.

### Action Ref Convention — the Action Ref Convention step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter**, for the same reason the Control Byte Scan has none: the population this gate scans *is*
`.github/workflows/`, and a change touching only that directory runs nothing expensive in `ci.yml`
or `lint.yml`. It runs as the **Action Ref Convention** step of the **Repo Gates** job.

Runs `scripts/check-action-ref-convention.mjs` — a checkout and one `node` call, no install.

#### The convention

**Every `uses:` in `.github/workflows/**` is written as a floating major tag, `owner/action@vN`.**

**An exception is marked by an entry in `DECLARED_EXCEPTIONS`** in that script, carrying the
workflow file, the action path, the issue that owns the decision, and a real reason. That is the
only form an exception takes. A trailing `# v9.0.0`-style comment beside a ref is a version *hint*,
not a reason, and the gate does not read it as one.

#### Why it exists — the finding is the sole instance, not the pinning

[objectui#8465](https://github.com/objectstack-ai/objectui/issues/8465). There were 13 distinct
action references in this directory. Exactly **one** was spelled differently from the other twelve —
a commit SHA on `actions/stale` — and it was the only reference in the repository that had **never
resolved**: 236 scheduled runs of the stale-issues workflow since 2026-01-16, **0 successes**, every
one failing in `Set up job`, unnoticed for eight months because nothing downstream consumes that
job. The broken reference itself was
[objectui#8126](https://github.com/objectstack-ai/objectui/issues/8126).

That workflow no longer exists. [objectui#8548](https://github.com/objectstack-ai/objectui/issues/8548)
retired it under enforce-or-remove — a declared automation with zero successes, zero consumers and no
external authors on the open board is removed rather than repaired — and #8126 closed with it. The
`DECLARED_EXCEPTIONS` entry that had covered its SHA pin was deleted in the same commit: an entry
matching nothing is red under the second rule below, so a deletion that left it behind would have
reddened this gate on `main` for every pull request.

This is **not** an argument that SHA pinning is wrong — it is normally the *more* secure spelling and
supply-chain guidance recommends it. The failure was the *shape*: one ref written in a form nothing
else in the tree used, with no convention that would have made the odd one out visible and nothing
verifying it. A floating tag that stops resolving is loud on the next run of every workflow that uses
it; a lone off-convention ref that never resolved is silent for as long as nobody happens to look.

So the default is the floating major tag because that is what the tree already was — 12 of 13, and
the repository's one deliberately reasoned per-ref pin, `changesets/action@v1`, is itself a tag (held
there by `scripts/__tests__/changeset-release-action-ref-pin.test.ts`). Declaring it moved no
reference and closed no door. **Do not read it as a ruling against SHA pinning, and do not "unify"
this directory in either direction under cover of this gate** — changing the repository's pinning
posture is a supply-chain decision and belongs on its own card.

#### What it does not do

It checks **spelling, not resolvability**. A SHA that points at no commit and one that points at a
real commit are indistinguishable without the network. That is deliberate: what failed in #8465 was
that the odd ref had no reason attached and no second instance to compare against, and both of those
are checkable offline.

#### The three ways it goes red

1. An off-convention ref with no entry in `DECLARED_EXCEPTIONS`.
2. An entry in `DECLARED_EXCEPTIONS` that matches nothing any more — the same staleness check
   `KNOWN_OFFENDERS` and `DOCUMENTATION_EXEMPT` carry elsewhere in this repository, because an escape
   hatch nobody removes is how a baseline turns into a permanent skip-list.
3. Its own census collapsing. A scan that stops finding references reports an empty offender list,
   which renders exactly like a clean repository, so the floors and a positive control
   (`actions/checkout` must be found) are asserted in the same run as the counts.

### Internal Docs Links — the Internal Docs Link Check step

**Triggers:** Push and PR to `main`/`develop`, plus manual dispatch — with **no path filter at
all**, which is the point of the workflow. It runs as the **Internal Docs Link
Check** step of the **Repo Gates** job.

Runs `scripts/check-doc-links.mjs`, which walks every `.md` / `.mdx` file in the surfaces listed in
its `SCAN_ROOTS` (17 rows as of objectui#6280) — `content/docs/`, `examples/`, the internal `docs/`
tree, every package and app `README.md`, the rest of each package's and app's directory tree (every
file except `README.md` and `CHANGELOG.md`, the latter excluded everywhere as changesets output
rather than authored prose), every nested `README.md` a package or app carries below its top level,
and the root-level markdown files (`README.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `AGENTS.md`,
`CHANGELOG.md`, `CLAUDE.md`, `LICENSE-THIRD-PARTY.md`, `QUICK_REFERENCE.md`) — and asks of each
internal markdown link whether its target is really there.

**Two rules, because the two groups are read through different machinery** (objectui#3536). For
`content/docs/` the question is the one a site reader cares about, **does the site serve this URL?**
Four checks, by href shape:

| Href shape | Resolved against | Rejected when |
|---|---|---|
| relative (`../plugins/plugin-charts.mdx`) | the linking file's directory | the target file is missing… |
| relative escaping the collection (`../../../packages/x/README.md`) | — | …**or** it resolves outside `content/docs/` (fumadocs can only resolve inside its page index, so the href reaches the browser verbatim — a 404 even though the file exists) |
| absolute `/docs/...` | `content/docs/` as a **route** | no `foo.md`, `foo.mdx` or `foo/index.md*` backs it — a `.md`/`.mdx` suffix always fails, since that URL 404s whatever is on disk |
| any other absolute (`/spec/...`, `/img/...`) | the **site itself**: route segments enumerated from `apps/site/app`, plus static files under `apps/site/public` | no route pattern or static file matches |

**Two href shapes are checked on _every_ surface, both rules included**, because they look external
but are decidable offline:

| Href shape | Resolved against | Rejected when |
|---|---|---|
| this repo's own `https://github.com/objectstack-ai/objectui/(blob\|tree)/main/...` (objectui#3536) | the path in the working tree | that path is not in the checkout. Only `main` and only this repo — other refs and repos cannot be answered offline |
| this site's own `https://[www.]objectui.org/...` (objectui#3603) | the origin is stripped, and what remains goes through the two absolute rows above, unchanged | the resulting route does not resolve — so `…/docs/guide/foo.md` fails for exactly the reason `/docs/guide/foo.md` does |

The second one had been invisible since the beginning: `judgeHref()` skipped every href carrying a
scheme, so a route written with the site's own origin was never checked while the identical
origin-less route was checked strictly. That blind spot was never confined to package READMEs —
`content/docs/` writes 6 such URLs itself — which is why the fix strips the origin in `judgeHref()`
rather than special-casing any surface. Measured before landing: 11 across the scanned tree, zero
dead. Prefer the origin-less form (`/docs/guide/plugins`) in new prose: it survives a domain change,
and both spellings are now checked identically.

Every other surface — `examples/`, `README.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `docs/` and the
package READMEs — is read on **GitHub** (and, for the package READMEs, on **npm**), not served by
the site, so a relative href there names a path on disk and is checked for existence only: a
directory (`./packages/core`) or a non-markdown file (`./vite.config.ts`) is a perfectly good
target, and there is no collection to escape. A leading `/` is rejected outright: GitHub resolves it
against `github.com`, not against this repository. Applying the `content/docs/` rules to these files
instead would reject 186 links that render correctly today.

`CONTRIBUTING.md`, `ROADMAP.md` and `docs/` are objectui#3572. They cost one `SCAN_ROOTS` row each
and no new rule, because "read on GitHub" already had one; their own backlog — three dead links —
was cleared first and separately (objectui#3545), so the rows landed on a green tree.

The package READMEs are objectui#3622, and the same shape: **one row, its backlog paid first**. That
backlog was 11 dead links in seven packages — three `/api/<pkg>` routes the site has never served,
four site URLs naming three `content/docs/` directories that have no index page (so fumadocs
generates no route for them), a `/docs/types` tree that does not exist, an `/examples` route that
does not either, and two disk paths that were simply absent. Each was repointed at a real page, or
replaced with the repository URL that does exist, before the row went in. The row is also the table's only wildcard: `packages/*/README.md` stands for
one file per package directory (38 of the 39 today), and only the README — a package's
`CHANGELOG.md`, `TESTING.md` and its own `docs/` tree stay unscanned.

**Package READMEs must keep the origin on site links.** Inside `content/docs/` the origin-less
`/docs/guide/plugins` is preferred; in a README it would be wrong, because GitHub and npm both
resolve a leading `/` against their own host, not against this site. Write
`https://www.objectui.org/docs/guide/plugins` there — it is checked exactly as strictly.

**One boundary, stated because it is easy to mistake for coverage:** links written inside a code
fence are invisible to this check. `stripCode()` blanks fenced blocks and inline spans before
scanning — required, since fenced code legitimately contains `[…](…)` that is not a link — so a
dead route in an illustrative snippet is not reported. `CONTRIBUTING.md` carries 10 such links
today against 15 outside fences, of which the gate judges one. Prose *about* links stays a human
review item.

One href shape is checked in **every** surface: a
`https://github.com/objectstack-ai/objectui/(blob|tree)/main/<path>` URL points back into this
repository, so `<path>` must exist in the working tree. Other repos' URLs, other refs, and
`#fragments` are not resolvable offline and stay Lychee's job.

Everything else — external `http(s)` and `mailto:` links, bare `#anchors` — is skipped. No install,
no build, no network: a checkout and one `node` call.

The last two rows are objectui#3490. Reading `apps/site` widens the script's responsibility, and
that is the deliberate purchase: it is the only way to catch a link to a route that does not exist,
and 18 such 404s had accumulated while the check waved every non-`/docs` absolute href through. The
cost is that a docs PR can now go red because `apps/site` moved under it — correct, but real. The
header of the script argues the trade-off in full.

**Why it blocks a merge.** A broken internal link is a 404 on the published site, and nothing else
in CI sees it: the site build succeeds with a dead link in it. The script itself is older than its
gate — it existed, worked, and was wired to nothing under `.github/`, so it had never run in CI at
all, and `main` sat with a broken link it would have caught (objectui#3213, objectui#3292).

**Why it was a separate workflow, and is a `repo-gates.yml` step rather than a `ci.yml` one.** This
is the second instance of the lesson the Control Byte Scan records, and it was found by the PR that first put this check into CI. That PR added it as a step
in `ci.yml`'s `docs` job — where it could never see the PRs that matter. `ci.yml` *then* listed
`'**/*.md'`, `content/**`, `docs/**` and `apps/site/**` under the `paths-ignore` of **both** its
triggers, GitHub's `paths-ignore` skips the *whole workflow* when every changed file matches, and
GitHub has no per-job path filter. So a **docs-only** PR — the likeliest way an internal link breaks — started no
workflow at all, and the check only ever ran on PRs that touched docs alongside code, plus pushes
to `main`. A bad link could merge through a pure-docs PR and turn `main` red later under an
unrelated author (objectui#3448).

The step was **removed** from `ci.yml` in the same change rather than left in place. This
workflow's trigger set is a strict superset of that job's, so keeping both would only add a second
red check for one broken link, and a second place to forget.
`scripts/__tests__/docs-links-workflow.test.ts` pins all of it: the workflow must exist, must gate
pull requests, must carry neither `paths` nor `paths-ignore`, and must remain the only workflow
that runs the script.

[#3523](https://github.com/objectstack-ai/objectui/issues/3523) removed `ci.yml`'s `pull_request` path filter, so the specific blindness above
no longer exists there — but nothing moves back. `ci.yml` still filters its `push` lane, so it
would miss a docs-only push to `main`; and this workflow is one of the two contexts that audit
found safe to require today precisely because it has never had a filter to reason about.

**If it fails:** it prints every offending `file -> href`. Either the link is misspelled, or the
page it points at has moved or been renamed — fix the link, or restore the target. Links are
checked as *routes*, so `/docs/guide/foo` is what belongs in the markdown, not
`content/docs/guide/foo.md`. Run it locally with `pnpm docs:check-links`.

### Skill Guide Paths — the Skill Guide Path Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**, for the same reason as the two sections above: this gate's entire scan surface
is markdown, and `ci.yml` still lists `'**/*.md'` under the `paths-ignore` of its `push` trigger. It runs as the **Skill Guide Path Check** step of the **Repo Gates**
job.

Runs `scripts/check-skills-paths.mjs`, which reads every markdown file under `skills/` and
`.claude/skills/` and asks, of each in-repo path the prose states inside a backtick code span,
whether it exists on disk. Those guides are a direct input to every agent that writes code in this
repository, and their prose gives paths as coordinates.

**Why a dead coordinate costs more than its size suggests:** the symbol named next to it is usually
real and only the location is wrong, so nobody gets a compile error — an agent gets "file not found"
from a `Read`, assumes its own search was clumsy, and spends a full lap re-locating something the
guide claimed to have located for it. Two rounds were found by eye while reading:
[#3713](https://github.com/objectstack-ai/objectui/issues/3713) (PR #3729) and
[#3730](https://github.com/objectstack-ai/objectui/issues/3730) (PR #3734), the second one 13 real
symbols at coordinates that did not exist. It also recurs by construction — the app-shell extraction
commits moved code with nothing anywhere to say the guides had gone stale
([#3735](https://github.com/objectstack-ai/objectui/issues/3735)).

**What counts as a stated path:** a backtick span that opens with one of five top-level directories
(`apps/`, `packages/`, `examples/`, `scripts/`, `content/`) and contains no whitespace. Three
exclusions, each a *rule* rather than an exemption, because none of them claims that a file exists:

| Excluded | Example in the guides today | Why |
|---|---|---|
| whitespace inside the span | a `grep -rn … packages/app-shell/src` self-check command line | prose, a command line or a type — not a path |
| glob or placeholder segment | the protected-primitive glob under `packages/components/src/ui`, a schema path with a placeholder domain segment | a shape, not a location; `existsSync` on it would mean nothing |
| fenced code blocks | a `bash` block that creates a file | a worked example may legitimately name a file the reader is about to create |

Measured on `main@6422aa891`: 18 guide files, 91 candidate spans, 5 of them patterns — **86 stated
paths, of which 85 resolve**.

**The one exemption, and why it cannot rot.** `scripts/skills-path-baseline.json` lists paths a guide
states *deliberately as absent*. Today there is exactly one: the Key contexts section of
`console-development.md` exists to correct a recurring wrong guess and says there is no
`apps/console/src/context/` directory at all. That entry is a ratchet, red in **both** directions —
if the path ever appears on disk the gate fails and names it (the sentence has become false), and if
the scan stops meeting the entry the gate fails too (the prose was rewritten, so the entry is dead
weight). Entries are keyed by file and token, never by line number, because guide prose moves
constantly.

**Scope, stated so it is not mistaken for an oversight.** `content/docs/**` carries backtick paths
too and is **not** scanned here. Widening a scan surface arrives with its own batch of red to clear,
which `check-doc-links.mjs` learned three times over (#3479, #3490, #3545) — measure it first, in its
own change. The five-prefix list is the same kind of decision: adding this repository's other five
top-level directories was measured at +2 candidates and 0 new red, so it is cheap, but it stays
deliberate rather than assumed.

**If it fails:** it prints every `file:line — token`. Fix the prose. Add a baseline entry only when
the sentence's whole point is that the path does not exist. Run it locally with
`pnpm check:skills-paths`, or `node scripts/check-skills-paths.mjs --list` to see every candidate and
how it was classified.

### Skill Examples — the Skill Example Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**, for the same reason as the section above: the scan surface is markdown under
`skills/` and `.claude/skills/`, and both `ci.yml` and `lint.yml` list `'**/*.md'` under the
`paths-ignore` of their `push` trigger. It runs as the **Skill Example Check** step of the **Repo Gates** job.

Runs `scripts/check-skill-examples.mjs`. Where the section above checks the *paths* a guide states in
prose, this one checks the *worked examples* themselves: a marked `ts` / `tsx` / `typescript` fence
must compile `--strict` against the packages' built `dist/*.d.ts` **and must not use a bare `any`**,
and a marked `json` / `jsonc` fence must parse.

**Why it was needed:** at the time it landed, `skills/objectui/` carried 112 TypeScript fences and 56
JSON fences and **not one gate in the repository read inside any of them**
([#7359](https://github.com/objectstack-ai/objectui/issues/7359)). Every gate that could have is
scoped elsewhere by construction — `check-skills-paths.mjs` deliberately reads inline code spans in
prose only, the three `content/docs` gates say so in their own headers. So a fence could import a
symbol that does not exist and stay green forever, and two rounds of exactly that had already been
cleaned by hand.

**Opt-in, and why:** a fence is checked only when the line **immediately above** it is
`<!-- os:check -->`. Most skill fences are fragments by construction — a `columns: [...]` subtree, a
block that continues the one above it — so compiling all of them at once would red on prose that is
not wrong, and a gate that reds on correct code gets deleted by the first person who hits it. The
marker is an inert HTML comment and leaves the fence info string bare, so the three gates that key on
the info string still see the block. The convention is ported byte-for-byte from objectstack's
`packages/spec/scripts/check-skill-examples.ts`.

**No bare `any` in a marked block** ([#7463](https://github.com/objectstack-ai/objectui/issues/7463)):
a marker is the author's claim that the block compiles, and every property access on an `any` is
unchecked — so a marked block full of `any` is a green badge over a `tsc` run that proved nothing.
The rule is ported from objectstack's runner with its scope intact: the annotation must **be** `any`
in a position that erases checking (a parameter, a variable / property / return annotation, a type
alias, an `as any` / `satisfies any` / angle-bracket assertion). An `any` **nested** inside a larger
type — `Record<string, any>`, `any[]`, `Promise<any>` — is deliberately allowed; that boundary is
what keeps a red meaning broken. The corpus had four such sites when the assertion landed, and each
is declared verbatim in `KNOWN_BARE_ANY_EXAMPLES` in the script. That list is a **shrink-only**
ratchet, not an allowlist: a row whose red goes away fails as **stale** and must be deleted. Fixing a
row is a judgement about the guide (one of them faithfully restates a platform type that really is
`any`), so the rows are declared debt rather than a mechanical unmark.

**`MARKED_FLOOR` is a second shrink-only ratchet, per category**
([#7550](https://github.com/objectstack-ai/objectui/issues/7550)): the script also floors the
*marked* population itself, one number per fence category, seeded at what `main` carried when it
landed — `ts: 17`, `json: 39` — and printed beside its own count on every run: `Marked: 17 ts
fence(s) (floor 17), 39 json fence(s) (floor 39) — the floor is ⛔ SHRINK-ONLY.` A category whose
marked count falls below its floor exits 1 naming the category, the count, the floor and the two
legal moves. It is a **floor**, not an exact pin, because the two directions are not symmetric:
marking one more fence is the direction this gate exists to travel, and an equality that reds on
that move is one people learn to route around — by unmarking, which is exactly the move this floor
exists to catch. Only the downward move needs a witness — raise the number in the pull request that
adds marks; lower it, in the *same* pull request that removes one, with the reason written beside
the constant: which example stopped being one, and why unmarking it was the honest call rather than
the cheap way out of a red.

**It scans `.claude/skills/` too** ([#7463](https://github.com/objectstack-ai/objectui/issues/7463)):
`SCAN_ROOTS` holds `skills` and `.claude/skills`, the same widening `check-skills-paths.mjs` took in
[#7358](https://github.com/objectstack-ai/objectui/issues/7358). When #7251 moved the two
contributor-only guides out of `skills/`, that gate stopped looking at them and nothing turned red.
Widening a root is **not** arming it: opt-in is the design, so this added 9 candidate fences (18 → 20
guides, 112 → 121 `ts` fences) and **zero** marked ones. Adding a marker under `.claude/skills/` is
the surface owner's step.

**Adjacency is strict:** a marker that is not directly above a checkable fence — separated by a blank
line, above a `bash` fence, or left behind when its example was deleted — is an **orphan** and fails
the run. A lenient rule would opt in nothing while its author believed otherwise, which is this
repository's recurring "looks like enforcement, isn't" class. A marker shown as *example text* inside
another fence is neither an opt-in nor an orphan: it is not at top level, so it claims nothing.

**It builds, unlike the Skill Guide Path Check:** the criterion is the *published* type surface, so the
packages the marked fences import must exist as `dist/*.d.ts` first. The filter is emitted by the
gate itself (`node scripts/check-skill-examples.mjs --build-filter`) rather than hand-maintained in
the workflow, so it grows only as the marked population grows; the job's one `turbo run build` takes
it in union with every package under `packages/`, which the README export check needs anyway
([#12214](https://github.com/objectstack-ai/objectui/issues/12214)).

**Three exit codes, not two.** `0` = every marked example held up. `1` = the gate ran and found
errors — a verdict about a guide. `2` = the gate **could not run**: the packages are unbuilt or typed
from source, a harness control failed, or nothing is marked at all. Nothing printed under exit 2 is a
verdict about any guide, and it is never a pass — zero with nothing run reads as coverage, which is
the failure shape this gate family exists to prevent
([#4846](https://github.com/objectstack-ai/objectui/issues/4846)).

**If it fails:** it prints `file:line` for every failing fence with the compiler's own diagnostic, or
the JSON parser's message, or the orphan marker's line, or — for a bare `any` — the position and the
verbatim baseline row to declare if the fix belongs to a later card, or — for a floor breach — the
category, the count, the floor and the two legal moves. Fix the example — or, if it was never meant
to stand alone, remove its marker **and lower `MARKED_FLOOR` for that category in the same pull
request**, with the reason written beside the constant: a marker deleted without that edit is a
silent unmark, exactly the move this floor exists to catch. Run it locally with
`pnpm check:skill-examples`, `node scripts/check-skill-examples.mjs --list` to see every candidate
fence and its verdict, and `--measure` to judge every candidate whether marked or not.

### Skill Eval Tokens — the Skill Eval Token Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**, for the same reason as the two sections above: the whole input is the markdown
and JSON under `skills/`, which `ci.yml` and `lint.yml` structurally cannot see. It runs as the **Skill Eval Token Check** step of the **Repo Gates** job.

Runs `scripts/check-skill-eval-tokens.mjs`. The two sections above check the *paths* a guide states
and the *worked examples* it ships; this one checks the **evals** — the `skills/<bundle>/evals/*.json`
files that grade an answering agent. Every `must_contain` token must occur as a **whole token** in the
markdown of its own skill bundle. Unlike its sibling it does **not** install or build: it reads text
out of the checkout, so it is a checkout plus two `node` calls, the shape the Skill Guide Path Check uses.

**Why it was needed:** nothing checked that a token an eval grades on is something the skill actually
teaches, so an eval could require a word the guides never say and grade nothing forever. The class had
already been cleaned by hand twice —
[#7360](https://github.com/objectstack-ai/objectui/issues/7360) (six assertions, one of them passing
only by accidental substring) and
[#7405](https://github.com/objectstack-ai/objectui/issues/7405) (three more) — both rounds found by a
human reading, which is the economics this gate family exists to end
([#7461](https://github.com/objectstack-ai/objectui/issues/7461)).

**The oracle is bundle-wide, and the losing option stays measurable.** A token counts as taught if it
appears anywhere in its own bundle's markdown, not only in the guide whose basename matches the eval
file. That is what the artefact supports: `SKILL.md` is a router that names every guide, and its rules
block tells the reader to read `rules/` before writing schemas, so the corpus an eval is answered from
is the whole bundle. Measured at the gate's branch point, per-guide would have started with 14 red rows
against bundle-wide's 0 — and 12 of those 14 exist only because `evals/protocol.json` has no
`guides/protocol.md` (its guide is `rules/protocol.md`), so they name no defect at all. `--measure`
prints **both** red lists on every run, so that comparison stays re-derivable rather than a claim in a
merged pull request.

**Whole tokens, never substrings.** An identifier-shaped token is matched on word boundaries, so `view`
does not match the tail of `// vite preview` and `FieldWidgetProps` does not match the head of
`FieldWidgetPropsSchema` — both real rows that a substring grep had reported clean. A token that is not
identifier-shaped at an end (a quoted JSON key, an operator) takes no boundary at that end and so
degrades to an exact substring, which is what such a token means. Matching is case-sensitive.

**`must_not_contain` is deliberately not scored against the guides** — it gets a shape check and
nothing else. Those entries are tokens an answer must *avoid*, so "no guide says it" is the healthy
case, and one of them is spelled as a quoted key fragment precisely so it does not fail an answer that
names the rule while following it. A check that validated that array the way it validates `must_contain`
would have the polarity backwards.

**Three exit codes, not two.** `0` = every token is taught, and something was actually checked. `1` =
the gate ran and found errors — an untaught token, a malformed assertion array, or a stale baseline
row. `2` = the gate **could not run**: no eval population, no guide corpus, or an eval file that does
not parse. Nothing printed under exit 2 is a verdict about any eval, and it is never a pass.

**If it fails:** it prints `file eval N token` for every red row, and says whether the token is absent
entirely or present only as a substring. Do **not** rewrite guide prose to teach the token and do
**not** re-point the row mechanically — which of the two is right is a per-row skills decision. The
declared list `KNOWN_UNTAUGHT_EVAL_TOKENS` is empty at landing and is **shrink-only**: a row parked in
it stays visible, and a row whose red goes away fails as stale until its line is deleted. Run it
locally with `pnpm check:skill-eval-tokens`, `--list` for every row under both oracles, and `--measure`
for the two red lists side by side.

### Documented Component Types — the Doc Component Type Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**, and here the reason is sharper than in the three sections above. `ci.yml`'s
`type-check` job decides whether to run its gates with a `git diff` that *excludes* `content/**`, so
a pull request editing only `content/docs/**.mdx` reports that context and runs nothing inside it —
and a docs-only pull request is exactly the change that introduces the defect this gate exists for.
It runs as the **Doc Component Type Check** step of the **Repo Gates** job.

Runs `scripts/check-doc-component-types.mjs`, which reads every fenced code block under
`content/docs/**` and asks, of each `type` string literal in one, whether the repository registers a
component under that name.

**A second gate in the same job, and it can stop your pull request.** The job then runs
`scripts/check-prompt-component-keys.mjs` in a step of its own — no `continue-on-error` — over
`.github/prompts/**`. Those are markdown, so `ci.yml`'s `type-check` diff excludes them under
`'**/*.md'` and a prompt-only PR starts that gate nowhere: the same blind spot, one file further
out. It asks the stricter question a file read by an AI *author* has to survive — not "does this
`type` exist" but "does it render, or is it answered only by the opt-in placeholder panel". A
retired key passes the first question and fails this one, which is the whole of
[#8929](https://github.com/objectstack-ai/objectui/issues/8929). Run it locally with
`pnpm check:prompt-keys`.

**Why the teaching surface needed its own ratchet.** The catalog side has had one since
[#4616](https://github.com/objectstack-ai/objectui/issues/4616):
`examples/schema-catalog/test/catalog-gallery-render.test.tsx` renders every catalog entry and fails
if any paints the registry's `Unknown component type` panel (OBJUI-001). A snippet in the docs is
rendered by nothing, parsed by nothing and compared against nothing, so it could name any string at
all and every check stayed green — while a reader who copied it got the red panel. The same defect
landed three times that way, each found by a human probe:
[#4786](https://github.com/objectstack-ai/objectui/issues/4786) taught `stats-card`, and
[#4796](https://github.com/objectstack-ai/objectui/issues/4796) taught `plugin:grid` and
`plugin:map` (the registered names are `object-grid` and `object-map`).

**Where the key list comes from.** Nowhere — it is derived from the `ComponentRegistry.register(…)`
and `registerLazy(…)` calls themselves on every run, including the loop forms and two helpers that
register from a collection, with `namespace` and `skipFallback` read out of each call's own balanced
argument span. There is no hard-coded enumeration to drift, and no build step, which is what keeps
the whole run to a checkout plus one `node` call. A registration whose key the derivation cannot
resolve **fails the gate** rather than being skipped: a key silently missing from the universe turns
*correct* documentation red, which is the failure mode that gets gates deleted.

**How a snippet is judged.** `type` is not one vocabulary in these pages — measured across every
`.md` and `.mdx` page under `content/docs`, a population the gate re-derives on every run and prints
in its own verdict line beside the code-block and `type`-literal counts, the corpus spells action
schemas, block schemas, theme and report schemas, field and JSON-Schema data types, validation rules
and navigation items all under the same key — so that size is read off the run, never copied here. A
structural discriminator was built and rejected on measurement (a TypeScript annotation reads exactly
like an object key to a brace tracker, and `items` carries navigation entries on one page and
renderable children on another, so any global rule is a silent false green somewhere). So the rule is
flat: every literal is a candidate component key, and a value outside the derived universe must be
**declared** in the script's `DOC_TYPE_EXEMPTIONS` — keyed by (file, value), with a written reason
naming the vocabulary it really belongs to. A whole-file exemption is deliberately not offered:
`api/schema-reference.md` carries `"type": "action"` (an ActionSchema discriminant) and
`"type": "card"` (a registered component key) in the same document.

Entries are re-derived per run, so one whose page stopped spelling that type fails as a stale
exemption rather than quietly widening the hole.

**If it fails:** it prints every `file:line — type '<value>'` with the offending source line. Either
spell the registered key (`grep -rn "ComponentRegistry.register(" packages/` for the real name), or —
if the value belongs to another vocabulary — add the declaration with its reason. Run it locally with
`pnpm check:doc-types`.

### Documented Snippet Types — the Doc Snippet Type Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**, for the same reason as the section above: the change that breaks a
documentation snippet is a docs-only change, and that is exactly the shape `ci.yml`'s expensive jobs
short-circuit. It runs as the **Doc Snippet Type Check** step of the **Repo Gates** job.

Runs `scripts/check-doc-snippet-types.mjs`, which extracts every fenced `ts` / `tsx` block from the
documents it covers and compiles them `--strict` against each package's **built** `dist/*.d.ts` — the
surface a reader who copies the snippet actually imports.

**The second dimension, and why it is separate from the first.**
The Doc Component Type Check answers whether a `type` literal names a registered component. It says so
in its own header, and [#5138](https://github.com/objectstack-ai/objectui/issues/5138) measured what
the gap beside it allowed: both plugin-report documents taught the pre-9.0 report form for the whole
interval after the ADR-0021 cutover, and every gate was green on that prose — because the `type`
literals (`summary`, `matrix`, `joined`) were the one thing that was correct, while `objectName`,
`groupingsDown`, an object-shaped `columns` and an import of a type the spec does not export sat
beside them. The harness that catches those had by then been hand-rolled three times, privately, in
[#5053](https://github.com/objectstack-ai/objectui/issues/5053),
[#5060](https://github.com/objectstack-ai/objectui/issues/5060) and
[#5047](https://github.com/objectstack-ai/objectui/issues/5047) — which is what made it consolidation
rather than new capability.

**Why this one builds.** Its criterion is the *published* type surface, so the packages the covered
snippets import must exist as `dist/*.d.ts` first. Since
[#12214](https://github.com/objectstack-ai/objectui/issues/12214) that closure is built in union with
every package under `packages/`, in the one build the README export check needs anyway, and the
filter is emitted by the gate itself (`node scripts/check-doc-snippet-types.mjs
--build-filter`) rather than hand-maintained in the workflow — so it can never drift from what the
documents import, and the cost grows only when coverage grows. Each emitted filter carries pnpm and
turbo's dependency-closure suffix (`--filter=@object-ui/react...`), because the packages the
documents import are not a buildable unit on their own: they depend on workspace packages no snippet
names, and those have to exist first. Under `turbo run build` the suffix selects the same tasks
`dependsOn: ["^build"]` already did; under `pnpm ... run build`, which selects exactly what it
matches, it is the difference between a build that completes and one that dies on an import the
reader never wrote ([#5911](https://github.com/objectstack-ai/objectui/issues/5911)). This is
deliberately **not** the per-PR full-repo build the 2026-08-16 ruling on
[#4846](https://github.com/objectstack-ai/objectui/issues/4846) rejected; see *Published Dist Gate*
below.

**And the filter is checked, twice.** The step that derives it fails the job if the gate exits
non-zero, and the build step refuses a filter that names no package
([#6221](https://github.com/objectstack-ai/objectui/issues/6221)). Written the obvious way —
`echo "args=$(node …)" >> "$GITHUB_OUTPUT"` — the step's status is `echo`'s, so a gate that failed
would read as a gate that named nothing, and `turbo run build` with no filter is the whole-workspace
build this section just said the job must never run.

**Fragments are declared, never guessed.** Documentation legitimately carries partial snippets, so a
block that is not meant to compile carries a marker line immediately above its fence with a written
reason — `{/* doc-snippet: fragment - why */}` in `.mdx`, the HTML-comment form in `.md`. A block
that merely fails to parse is **reported**, never skipped: a skip-on-failure rule turns every real
defect into silence, and degrades exactly as the docs get worse.

**Syntax and semantics are reported apart.** `tsc` reports syntactic diagnostics and, if there are
any, never reports semantic ones — program-wide. #5047 measured a run that printed five parse errors,
zero semantic diagnostics, and read as a meaningful red while proving nothing. So this gate parses
blocks one at a time first, keeps unparseable ones out of the semantic program, tags every failure
`[syntax]` or `[semantic]`, and always prints how many blocks the semantic phase actually judged.

**It proves itself before it judges the docs.** Every run prints three controls: the resolved path
for `@object-ui/types` (which must land in a `dist/*.d.ts` — the root `tsconfig.json` maps the
workspace to *source*, so that substitution is one inherited config away), a planted
`ThisNameIsDefinitelyNotExported` import that must produce TS2305 (a program silently resolving to
`any` reports green forever), and a real import that must be clean (so a broken harness cannot read
as "the docs are full of defects"). A failed control fails the run and says no verdict about the
documents can be read from it.

**Coverage is declared.** A document is covered unless the script's `UNGATED_DOCS` ledger names it
with a reason, so a new page is gated from the day it lands and opting one out is a visible edit.
The ledger is debt with names: those documents are **not** compiled and **not** counted, which the
script's header states plainly rather than letting a green run imply otherwise.

**It also censuses the code this repository's generators EMIT — report-only.** A second step in the
same job runs `node scripts/check-doc-snippet-types.mjs --emit-census`, against the same built
closure. Code a generator writes out of a template literal under `packages/*/src/**` is compiled by
nothing: `tsc` sees a **string**, `tsup` copies it through, and every doc gate's scan surface — this
one's included — stops at `content/docs`, the per-app docs trees and the package READMEs
([#7864](https://github.com/objectstack-ai/objectui/issues/7864)). The class already had two members
when the census was written: `packages/vscode-extension/src/extension.ts` emitted a phantom
`registerDefaultRenderers` import into every file its *Export to React* command ever wrote for a user
(fixed by [#7863](https://github.com/objectstack-ai/objectui/issues/7863)), and
`packages/cli/src/utils/app-generator.ts` is
[#7472](https://github.com/objectstack-ai/objectui/issues/7472), still open. A template is recognised
when its text carries an `import … from '…'` statement, or when it is opted in by a
`/* doc-snippet: emits tsx */` comment — one vocabulary with the fragment marker above; each `${…}`
hole is substituted by an identifier placeholder before the snippet is handed to the same
`compileSnippets()` a documentation block goes through. It prints a census — files walked, templates
recognised, what the recogniser cannot see, diagnostics, and the per-package split — and **exits 0
regardless of what it finds**, so it can block no merge; it exits non-zero only when the instrument
itself is broken, a walk that collapsed or a failed harness control, because a check that runs, goes
green and looked at nothing is worse than none. Report-only is a ruling, not an oversight: #7472's
site is an open card, and a blocking gate on this landing would go red on somebody else's work. The
population is the deliverable — whether the corpus gets cleaned or gets a declared ledger is decided
from those numbers on a follow-up card. The step is placed before the blocking one so the number is
re-read on every run instead of being skipped exactly when the corpus moved.

**If it fails:** each line is `file:line TS<code>: <message>`, addressed at the document rather than
at the harness. Either fix what the snippet teaches, or — if the block is genuinely partial — declare
it with a reason. Run it locally with `pnpm check:doc-snippets` (after building the packages it
names: `pnpm exec turbo run build $(node scripts/check-doc-snippet-types.mjs --build-filter)`).

#### JSDoc `@example` Types — the second gate in this job

The same job's second blocking step runs `scripts/check-doc-example-types.mjs`
(`pnpm check:doc-examples`). It asks the snippet gate's question of a different corpus: every fenced
`ts` / `tsx` block inside a JSDoc `@example` on an **exported** declaration under
`packages/NAME/src/**` must compile `--strict` against the packages' built `dist/*.d.ts`, or be
declared in the script's `UNGATED_EXAMPLES` ledger with a written reason and the diagnostics it
currently produces. That population is invisible to every gate above it, whose scan surface stops at
the authored pages: [#7974](https://github.com/objectstack-ai/objectui/issues/7974) is the shape —
`useSpecGesture`'s own `@example` passed a scalar where the declared type is an array, so a reader
copying it out of an IDE hover got TS2322, and nothing in this repository had ever compiled it.

| Command | Reads | Blocks a PR? |
|---|---|---|
| `pnpm check:doc-snippets` (`scripts/check-doc-snippet-types.mjs`) | fenced `ts` / `tsx` blocks in the **documents** the `UNGATED_DOCS` ledger does not exempt | **Yes** |
| `pnpm check:doc-snippets --emit-census` | code this repository's generators emit from **template literals** | No — report-only |
| `pnpm check:doc-examples` (`scripts/check-doc-example-types.mjs`) | fenced `ts` / `tsx` blocks in JSDoc **`@example`** tags on exported declarations under `packages/NAME/src/**` | **Yes** |
| `pnpm check:doc-json` (`scripts/check-doc-json-fences.mjs`) | fenced `json` / `jsonc` **node documents** in `content/docs`, every `packages/NAME/README.md` and the root `README.md`, judged through the strict authoring face | **Yes** |

**Why it shares this job rather than getting a workflow.** It is a *sibling* of the gate above, not a
fork: it imports that script's compiler host, its built-`.d.ts` resolution and every one of its
controls, and reuses its `analyze()` wholesale — so an `@example` block is judged by exactly the
program a documentation fence is judged by, and its precondition is the very build this job
already pays for. A workflow of its own would install the workspace and rebuild the same closure a
second time for no additional coverage; and it could not even derive that filter without naming
`scripts/check-doc-snippet-types.mjs` in a second workflow file, which that gate's own pin
(*"lives in exactly one workflow — one gate, one home"*) fails on by design.

**Why it runs last.** Both gates block, so whichever runs second is skipped when the first is red.
Ordering the newly wired gate first would let it mask an established one, which is the worse of the
two directions.

**Its exit codes are three, not two** — the same three as its sibling, for the same reason: `0` every
covered example compiles or fails exactly as its ledger row says; `1` the gate ran and found errors;
`2` the gate **could not run** — the packages are unbuilt or typed from source, the walk collapsed,
or one of the harness's own controls failed, in which case nothing it printed is a verdict about any
example. Locally that third one is what you get before building, and it is neither green nor red.

**It was declared and run by nothing until
[#8757](https://github.com/objectstack-ai/objectui/issues/8757).** The command sat in the root
`package.json` while no workflow named it — measured there, with the sibling's workflow mentions as
the control that the zero was a reading and not a failed grep. What that cost is on the record: a
defect this gate catches reached `main` and was repaired 71 minutes later with nothing observing in
either direction, and the card reporting the red was written from a stale merge base because there
was no run to read. Its first wired run, on unmodified `main`, exited **0** over 124 blocks — 35
compiling and 89 declared — so the wiring adds enforcement without importing a backlog. ⛔ A newly
wired gate is never made green by narrowing what it scans.

**If it fails:** the failing key is the block's path, line and symbol, and the ledger is keyed the
same way — so a row can be invalidated by an edit that merely moves lines above it, which is
[#8614](https://github.com/objectstack-ai/objectui/issues/8614) and is **not** fixed here. Fix the
example, or declare it. Run it locally exactly as this job does: build first
(`pnpm exec turbo run build $(node scripts/check-doc-snippet-types.mjs --build-filter)`), then
`pnpm check:doc-examples`; the gate prints that same recipe when it exits `2`.

#### JSON Node Documents — the third gate in this job

The job's **last** step runs `scripts/check-doc-json-fences.mjs` (`pnpm check:doc-json`). The two
gates above read `ts` / `tsx` only, so a `json` fence was checked by nothing:
[#5229](https://github.com/objectstack-ai/objectui/issues/5229) taught a `validation` bag on an
`input` node in `content/docs/blocks/forms.mdx` while every shipped tool was green. Every fenced
`json` / `jsonc` block on its scan surface that parses into an object whose `type` names a node
schema is judged through the **strict authoring face** — `StrictAnyComponentSchema`, read from the
`@object-ui/types` the build step above produced, the face `objectui validate` and `objectui check`
judge an authored document with ([#5250](https://github.com/objectstack-ai/objectui/issues/5250)).
So a key no schema declares fails here exactly as it fails `objectui validate`; the tolerant face
keeps it, because `BaseSchemaCore` is `.passthrough()` for the renderer.

**What it reads.** Four legs, declared once in the script's `SCAN_SURFACE` and printed leg by leg
in its summary: every `.mdx` / `.md` page under `content/docs`, every package's own `README.md`
(`packages/NAME/README.md`), the root `README.md`, and every `.md` page of the published skill bundle
under `skills/objectui/`. The two README legs are the ones the other doc gates walk, imported from the
component-type gate rather than spelled a second time. They joined in
[#12131](https://github.com/objectstack-ai/objectui/issues/12131), after the root README's form and
dashboard examples and a table in `packages/plugin-dashboard/README.md` were refused by
`objectui validate` while this gate was green. The skills leg joined in
[#12204](https://github.com/objectstack-ai/objectui/issues/12204): `check-skill-examples` holds those
fences to *parse* only, and its `os:check` opt-in line sits directly above each of them, so a fragment
declaration there goes on the line directly above that opt-in line — the one shape the gate steps
over. Pages off that surface are not read, and the summary says so: `docs/audits/**` (point-in-time
records, kept out on purpose), `.claude/skills/**`, CHANGELOGs, changesets, and READMEs below a package
root, which are published only when a package's `files` reaches them.

**What it does not judge, it counts.** A fence that is not JSON, not an object, carries no string
`type`, or names a `type` no node schema declares is not judged; the summary prints each bucket, and
`--list` prints every fence with its bucket.

**Fragments are declared, and the declaration is re-judged.** A node document that is deliberately
not complete or not valid — a refused example that shows the error, an excerpt that elides required
keys, an object whose `type` only collides with a node type — carries
`{/* doc-json: fragment - why */}` (the HTML-comment form in `.md`) on the line above its fence. The
declared fence must be one the strict face refuses: a declaration on a fence the face accepts, or on
one that is not a node document at all, is reported as stale, so the declarations can only shrink.

**It proves itself before it judges the docs.** The face must resolve inside `packages/types/dist/`;
a document carrying an undeclared key must be refused by the strict face and accepted by the
tolerant one; a declared-only document must be accepted; and the walk must judge at least one node
document, including one from each leg's anchor page, so a README leg that read nothing cannot pass.
Its exit codes are the sibling gates' three: `0` clean, `1` the gate ran and found errors, `2` it
**could not run** — `@object-ui/types` unbuilt, or a control or the enumeration failed — which is
neither green nor red.

**If it fails:** each refusal names the page, the line of its fence, and each reason — an undeclared
key by name and path, anything else by the face's own message. Remove the key, or replace it with
the declared key its renderer reads; declare a deliberate fragment. Run it locally with
`pnpm --filter @object-ui/types build`, then `pnpm check:doc-json`.

### Fence Languages — the Doc Fence Language Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — **no path
filter**, for the same reason as the two sections above. It runs as the **Doc Fence
Language Check** step of the **Repo Gates** job.

Runs `scripts/check-doc-fence-languages.mjs`. It answers the question the gate above cannot ask about
itself: *is every TypeScript block in the documentation actually fenced as TypeScript?*
`check-doc-snippet-types` reads `ts` / `tsx` / `typescript` fences and nothing else, so a TypeScript
block fenced any other way is invisible to it —
[#5867](https://github.com/objectstack-ai/objectui/issues/5867), whose remediation lane collected its
population from ```plaintext fences only.

**`plaintext` is not the only spelling of an unhighlighted fence.**
[#6135](https://github.com/objectstack-ai/objectui/issues/6135) measured a ```text block opening
`interface FileUploadSchema {` sitting outside the gate *and* outside the lane that exists to close
it, for no reason but how its fence is spelled. Widening the lane's derivation once would fix that
block; it would not stop a sixth spelling reopening the identical gap.

**So it reads bodies, not a list of languages.** No enumeration of allowed fence languages is on the
enforcement path — an enumeration is the thing that rots, and it rots silently. Every fence's body is
put to #5867's own binding triage classifier (*a block whose first line starts with `import` /
`export` / `interface` / `type X =` / `const x: T` is code*), quoted rather than extended. `txt`,
`console`, `raw`, or a bare fence with no info string at all therefore cannot hide a block.

**Two failure modes, because only one can be auto-classified.** A *known* spelling of an
unhighlighted fence (`plaintext`, `text`, `plain`, `txt`, no info string) is #5867's population and
its remedy is mechanical, so it is the only mode the baseline describes. Any *other* spelling might
be a sixth synonym or a real highlighter language — that is a human's call, so it is reported
separately and can **never** be baselined.

**The baseline is #5867's remaining population.** `KNOWN_UNHIGHLIGHTED_TS_FENCES` maps a path to the
number of hidden blocks it carries, ⛔ **shrink-only** in the shape
[#6133](https://github.com/objectstack-ai/objectui/issues/6133) landed for
`KNOWN_HAND_TYPED_GUARDS`: a file not in the map that carries one fails, a file carrying more than
its number fails, and a file carrying fewer fails as *stale* and names itself. Every #5867 batch now
lowers these numbers in the same pull request that re-fences the blocks, so the lane's arithmetic
lives in the repository instead of being re-derived by hand in each handback.

**`--self-test` runs first.** It drives the real scanner over fixture sources — including a
`text`-fenced, a `txt`-fenced and an info-string-less TypeScript block — and pins the shrink-only
baseline in every direction it can move. A scanner whose recogniser is broken reports a clean tree,
which is why the probe runs before the verdict.

**If it fails:** each line is `file:line ```<language> — <first line of the block>`. Re-fence the
block ```ts (or ```tsx) and fix whatever `check-doc-snippets` then reports, then lower the file's
number. Run it locally with `pnpm check:doc-fences`; it needs no install and no build.

### Documented Example Ids — the Doc Example Id Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**, for the same reason as the three doc sections above: the change that
introduces this defect is an id typed into an MDX page, and a docs-only pull request is exactly the
shape `ci.yml`'s expensive jobs short-circuit. It runs as the **Doc Example Id
Check** step of the **Repo Gates** job.

Runs `scripts/check-doc-example-ids.mjs`, which walks every `.mdx` and `.md` page under
`content/docs/**`, reads the `id` prop off each `SchemaExample` tag, and resolves it against the ids
the generated schema-catalog index carries.

**Why the reference side needed its own gate.** The site's `SchemaExample` component looks its id up
through `getExample`, and that lookup **throws** on an unknown id rather than degrading — the honest
behaviour, since a silently wrong or empty example teaches the wrong thing and an author would never
learn the id was wrong. The cost is that the throw arrives at *page render*, in the published docs.
The catalog's own suite resolves every registry **entry**, which cannot see a page pointing at an id
that is not there: the entry simply is not present to render. So a mistyped or stale id passed every
check in the repository and crashed the page it was on.

**Where the id universe comes from.** The generated catalog index, read twice on every run — the
`REGISTRY` object's own keys, which is what `getExample` indexes, and the schema import specifiers
above them. The two must agree exactly; if they diverge, the gate reports that it **could not run**
rather than judging pages against a half-read registry, because an id missing from the universe
turns *correct* documentation red.

**Illustrative references are exempted by shape, never by a list.** The catalog authoring guide
teaches the tag's syntax, so it carries an angle-bracket template and an ellipsis where a real id
would go. Those are recognised as metasyntax — a value carrying `<`/`>` or an elision cannot be a
filename-derived id — rather than by naming the two strings, which would be a ledger that rots and
would say nothing about the next placeholder somebody writes. A value that is merely *wrong* — bad
case, wrong segment count, a typo — is **not** exempt. Every exemption the run takes is printed in
its output, so the carve-out is never silent, and the rule's premise is re-derived from the live
registry each run: if a real id ever carries a marker, the gate stops instead of exempting it.

**Its own emptiness is a failure, not a pass.** A walk that reads no pages, a matcher that finds no
references, or a registry that reads as zero ids each exit `2` — *could not run* — because all three
otherwise produce the same clean verdict as a clean tree. The population was clean the day this
landed, so the gate's test spawns the real script over a throwaway tree carrying a deliberately
unknown id and asserts it goes red.

**If it fails:** it prints each page, the line, and the id that did not resolve. Fix the id, or add
the schema under `examples/schema-catalog/src/schemas/` and regenerate the index
(`pnpm -F @object-ui/example-schema-catalog regenerate`). ⛔ Do not make `getExample` fall back and
do not add a registry entry just to make a reference resolve. Run it locally with
`pnpm check:doc-example-ids`; it needs no install and no build.

### Pre-Install Import Graphs — the Pre-Install Import Graph Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**. What this gate judges is the arrangement of the workflows themselves, so its
input is `.github/workflows/**` plus the `scripts/` files those workflows name, and the change most
likely to break it is a workflow edit. It runs as the **Pre-Install Import Graph
Check** step of the **Repo Gates** job.

Runs `scripts/check-pre-install-import-graph.mjs`. Several gates in this repository deliberately run
**before any `pnpm install`** — that is what lets them run unfiltered on every pull request shape for
the price of a checkout plus one `node` call. The property that arrangement silently depends on is
that each of those scripts' *whole static import graph* is node builtins plus repo-relative modules,
with nothing in it needing `node_modules`.

**Why it needed a gate.** A violation is invisible everywhere it could be caught cheaply: it is not a
type error (`tsc` is happy with a package import), not a lint error (the package is a real dependency
of the repo), not a local failure (locally `node_modules` exists), and — until
[#6148](https://github.com/objectstack-ai/objectui/issues/6148) — not a test failure, because exactly
one of the pre-install scripts had a test asserting it. It surfaces only as `ERR_MODULE_NOT_FOUND`
inside one CI job, on whichever pull request happens to touch the file; and for the gates that carry
no path filter *precisely so they see every PR shape*, that is a gate which **stops running** rather
than one that fails loudly.

**The population is derived, never listed.** On every run the gate parses every workflow and, per
job, compares each step's index against the index of the first `pnpm install` step **in that same
job**. Move a step above an install and the population grows on the next run; move one below and it
shrinks. A hard-coded list would break silently the first time someone moved a step across an
install, which is exactly the edit that needs catching. Two anchoring decisions the derivation
depends on, each with a case in this repository: `pnpm exec playwright install chromium` installs a
browser rather than the workspace, and `git config merge.pnpm-merge.driver "pnpm install …"`
*configures* a driver — the `pnpm install` there is a quoted argument, not an install. That second
case was formerly live in `changeset-release.yml`; it was removed with the dead CI half of the
lockfile merge driver ([#6436](https://github.com/objectstack-ai/objectui/issues/6436)), so the
repository no longer contains a real instance and the gate keeps it as a synthetic fixture instead.
Reading either shape as an install would move a boundary and silently drop a script out of the
population.

**It walks the graph, not the entry file.** Requiring each of the entry's own imports to start with
`node:` is too narrow in one direction (a relative import of a builtins-only local module is fine,
and two of these scripts spell their builtins bare as `from "fs"`, which is equally install-free) and
too weak in the other, because it cannot see a package pulled in **one hop away**. Since
[#6092](https://github.com/objectstack-ai/objectui/issues/6092) every one of these scripts imports
`scripts/invoked-as.mjs`, so one hop away is exactly where the next breach comes from. The check is
static rather than a runtime resolver hook because a hook *executes* module top level, and these
files are CI gates that spawn `git`, read the whole tree and call `process.exit`.

**It is in its own population.** The step above runs a `scripts/` file before any install, in a job
that never installs, so the gate walks its own import graph on every run. A floor that exempted its
own enforcer would be the first thing to rot.

**If it fails:** it prints the offending chain — `scripts/some-gate.mjs -> scripts/invoked-as.mjs ->
typescript` — rather than a bare verdict, so the hop that introduced the package is named. Repairing
the import is deliberately *not* this gate's job: either drop the package, or move the step below
`pnpm install` in its workflow and accept the install cost. Run it locally with
`pnpm check:pre-install-import-graph`, `node scripts/check-pre-install-import-graph.mjs --list` to see
the derived population and every module walked, or `--self-test` to exercise the parser and the walk
against fixtures.

### Inert vi.mock Specifiers — the Inert vi.mock Specifier Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**. A module mock can be written into any package in any shape of pull request, and
the scan costs a checkout plus one `node` call, so there is nothing to gain by hiding it behind a
filter. It runs as the **Inert vi.mock Specifier Check** step of the **Repo Gates** job.

**Two gates run here, over one population, and both block a merge.**
`scripts/check-vi-mock-specifiers.mjs` and `scripts/check-vi-mock-inherit.mjs` are steps of the same
job, so either one failing fails it — and `dependabot-merge-gate.mjs` classifies **Repo Gates**, the
context both report through since [#12214](https://github.com/objectstack-ai/objectui/issues/12214),
as a required context. (Named without its `scripts/` path on purpose: this
section reads as this job's gate list, and that script runs in `dependabot-auto-merge.yml`, so
spelling the path here would credit this job with a gate it does not run.) They read the same
`vi.mock` call sites deliberately: a population that drifted between them would be a hole neither
one reports, which is why they shared a workflow instead of each registering a context of its own;
both steps carry the **Inert vi.mock Specifier Check** name, broader than the older of the two gates,
because that was the context name they reported under before the fold.

**The specifier gate.** `scripts/check-vi-mock-specifiers.mjs` walks every tracked JS/TS-family
source file, finds each `vi.mock` / `vi.doMock` call site, and resolves the **relative** specifiers
against the calling file's own directory. Any that resolves to no file fails the run.

**Why it needed a gate.** A mock whose specifier names no file does **not** error. Vitest registers
it against a module id nothing imports, the run proceeds with the *real* module everywhere, and the
suite passes — with no warning and no smaller assertion count, identically to a correct one. In
[#5646](https://github.com/objectstack-ai/objectui/issues/5646)'s one known instance (PR #5645) the
suite passed even when the code under test was reverted to the exact broken shape it had been written
to catch; only an ablation leg exposed it. Neighbouring mocks in that same file made it invisible to a
reader: one stepped up a single level and one stepped up two, and **both were correct**, because
their targets sat at different depths. This is
[#4347](https://github.com/objectstack-ai/objectui/issues/4347) one layer down — a declaration
pointing at nothing, reported as a pass.

**It is green at rest, so its census is part of the verdict.** There are zero unresolvable specifiers
in the tree and there should stay zero, which means the run's output alone cannot distinguish a
working gate from one that matches nothing. Two things answer that. The verdict line prints the
**population** it judged, not a bare `OK`. And the scan **fails when that population collapses**: no
source files, no test files, or no relative specifiers is a broken walk, not a clean tree, and
reporting `OK` for it would be this gate's own defect one level up. The evidence that the gate works
lives in `scripts/__tests__/check-vi-mock-specifiers.test.ts`, which reconstructs the historical
specifier on a fixture tree and pins that the two correct neighbours are *not* flagged.

**Resolution matches how this repo spells specifiers**, which is more than an existence check: the
bare path plus `.ts/.tsx/.js/.jsx/.mjs/.cjs`, the `/index.*` forms, and a trailing `.js` stripped and
retried, because `src/` is NodeNext throughout. The judgement is `isFile` rather than "exists", so a
directory with no index is correctly unresolved. Comments are masked and a call quoted inside a string
literal is counted but not judged — an ESLint `RuleTester` code sample is source text, not a mock.

**Scope:** relative specifiers only. A bare specifier (`@object-ui/…`, `lucide-react`) can be
misspelled too, but resolving one needs the workspace map rather than the filesystem — a different
check with a different failure mode. Bare specifiers are counted in the census and never judged.

**The inherit gate.** `scripts/check-vi-mock-inherit.mjs` judges the same call sites for the sibling
property: a factory that **hand-lists** the exports it returns freezes the mock's export surface at
whatever the author typed that day. The real module keeps growing, and the next export any module in
the file's import graph reads *at module scope* resolves to `undefined` against the frozen stand-in —
so the file dies during **collection**, before a single test in it runs. Measured on
[#6768](https://github.com/objectstack-ai/objectui/issues/6768): `Test Files 3 failed | 546 passed`
alongside `Tests 6694 passed`, with **zero** failed assertions, because the tests in those three
files never ran. It reads as flake to whoever meets it, and the bill lands on whoever added the
export.

Its recogniser is **semantic**, never a grep for `importOriginal`: that spelling mis-counted eleven
correct files as broken *and* missed a broken one
([#6849](https://github.com/objectstack-ai/objectui/issues/6849)). It asks whether the factory
*obtains* the real module — a callback parameter under any name, or `vi.importActual` of the same
specifier — and **spreads** it. Its scope is a declared, grow-only set of covered workspace
specifiers rather than every factory, because the failure mechanism needs an export surface that
grows: relative specifiers (whole-module replacement) and third-party packages are counted and never
judged. Like its sibling it is green at rest, so a collapsed population is a failure here too.

**If they fail:** the specifier gate names the file, the line and the specifier, and the first path
it tried — fix the specifier, then confirm the mock is really installed by reverting the code under
test and checking that the suite goes red. The inherit gate names each frozen call site as
`file:line`, with the specifier and the shape it wants instead. Run them locally with
`pnpm check:vi-mock-specifiers` and `pnpm check:vi-mock-inherit`, either with `--list` after the
script path to see every call site the walk found. Neither needs an install or a build.

### Shell Escape Residue — the Shell Escape Residue Scan step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**. The scan surface is markdown that any shape of pull request can touch, and a
markdown-only change is exactly the shape `ci.yml` and `lint.yml` skip their expensive steps on. It runs as the **Shell Escape Residue Scan** step of the **Repo Gates**
job.

Runs `scripts/check-shell-escape-residue.mjs`. It walks `AGENTS.md`, `CLAUDE.md`, every `.md`/`.mdx`
under `skills/`, every one under `.claude/skills/` and every one under `content/docs/`, and fails when
a **fenced code block** contains one of the enumerated machine-produced shell-quote escape runs.

The contributor tree `.claude/skills/` joined that list in
[#7403](https://github.com/objectstack-ai/objectui/issues/7403). It is not published, but it is
agent-**written** and agent-**read**, which is both halves of the mechanism this gate exists for —
and [#7251](https://github.com/objectstack-ai/objectui/issues/7251) had moved two contributor guides
there out of `skills/objectui/`, taking 18 fenced blocks off the surface in one commit with nothing
turning red. Nothing could have turned red: the `skills` row's file floor is a **collapse**
detector, and the files that stayed behind were enough to satisfy it while the two that left went
unmeasured. A floor measures the roots that are declared, never the tree that walked out of them, so
a move and its `SCAN_ROOTS` row belong in one change. ⛔ How many stayed is not stated here,
deliberately: this sentence used to carry that as a literal, the tree moved under it, and nothing
went red over that distance, because nothing fails on a number written in prose
([#8629](https://github.com/objectstack-ai/objectui/issues/8629),
[#7448](https://github.com/objectstack-ai/objectui/issues/7448)). The gate derives every root's
population from `SCAN_ROOTS` on each run and prints it — its result line carries a per-root `N
file(s), N fence(s)` reading — so running `scripts/check-shell-escape-residue.mjs` is the live
answer to what the `skills` root holds today. The sibling gate `check-skills-paths` lost 55 stated
paths to the same move and was widened the same way in
[#7358](https://github.com/objectstack-ai/objectui/issues/7358).

**Why it needed a gate.** In [#5150](https://github.com/objectstack-ai/objectui/issues/5150) the
`git commit -F -` example in `AGENTS.md` §9 shipped with its heredoc terminator wrapped in the
single-quote-inside-single-quote shell escape. Copied verbatim, that example does not fail with a
message — it **hangs**, on a terminator that never matches, and a reader does not attribute a hung
terminal to the document. [#5151](https://github.com/objectstack-ai/objectui/issues/5151) then ran the
full derived gate union against the replanted bytes: `check-control-bytes`, `check-doc-links`,
`check-changeset-presence` and `check-changeset-no-major` **all exited 0**. None of them was
negligent — the residue is printable ASCII inside a code block, and no scan surface in this repository
reached it. The amplifier is that `AGENTS.md`, `CLAUDE.md` and `skills/**` are re-read **once per
session** by every agent seat, so a bad example is not paid once; it is paid by every reader.

**⛔ What this gate does not do.** It checks an **enumerated literal** — one entry today, the sequence
#5150 leaked. It does **not** make fenced shell examples executable-by-construction, and nothing in
this repository does: a ```bash block may be syntactically invalid, may never terminate, or may name
a flag that does not exist, and this gate is green on all of it. Running `bash -n` over every block is
#5151's **unbuilt** "direction 1"; it was ruled out of that card rather than rejected on the merits,
and it carries a dependency worth recording — it is only as good as its **extraction convention**. In
#5150's own example the block sat inside a numbered list, so both lines carried a two-space indent,
and a quoted heredoc terminator must reach **column 0**. Rendered markdown strips the container indent
and the block looks fine; agents read these files by `cat`, not by rendering them, so a verbatim copy
including the indent hangs exactly as the original defect did. The boundary is asserted as a *fact* in
`scripts/__tests__/check-shell-escape-residue.test.ts` — broken shell is fed to the gate and a pass is
required — rather than pinned as a sentence, so the claim cannot rot into a false one.

**It is green at rest, so its census is part of the verdict.** There are zero occurrences in the tree
and there should stay zero, which means the run's output alone cannot distinguish a working gate from
one that matches nothing. The verdict line therefore prints the **per-root population** — files and
fenced blocks for each of the five roots — rather than a bare `OK`, and the scan **fails when that
population collapses**: a root that does not resolve, a root that walks to fewer documents than its
floor, or a total fence count under the floor is a broken walk, not a clean tree. The document floors
are **per root** and deliberately never a whole-surface total: on a day the smallest root,
`.claude/skills`, reads zero, the other four still return all but its handful of documents, so a
total floor stays green through the entire outage — the relation is the argument, and each root's
own population is printed on every run rather than copied here. A scan root that has
moved or been mistyped is reported **by name**, because a mistyped root and a clean root produce
identical output otherwise. The evidence that the gate works is the ablation in its test suite, which
replants #5150's exact line in each root on a fixture tree.

**Scope:** fenced blocks only. An occurrence in prose or an inline code span is **counted in the
census and not judged**, because documentation about this defect class has to be able to name the
literal. That is a known narrowing, and the census figure is what keeps it visible.

**If it fails:** it names the file, line and column, the fence language and the line the fence opened
on. Note that `AGENTS.md`, `CLAUDE.md`, `skills/**` and `.claude/**` are **governed surface** — a finding
in one of those is reported for a human to fix in its own change, not folded into an unrelated pull
request. A
finding under `content/docs/**` is an ordinary docs fix. Run it locally with
`pnpm check:shell-escape-residue`, or `node scripts/check-shell-escape-residue.mjs --list` to see the
per-root census. It needs no install and no build.
### README Exports — the README Export Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all**. It runs as the **README Export Check** step of the **Repo Gates** job.

The absent filter is the point. The two edits that introduce this drift are a README change and a
source change that renames or drops an export, and `ci.yml` structurally cannot see the first: every
one of its jobs opens with the `id: relevant` short-circuit whose diff excludes `**/*.md`, so on a
README-only pull request its expensive steps are skipped by design. A gate against fabricated README
imports living behind that switch would rebuild the hole it exists to close.

Runs `scripts/check-readme-exports.mjs` (`pnpm check:readme-exports`). For every **tracked** `README.md`
under `packages/`, it extracts the fenced code blocks, parses each one with the TypeScript parser, walks the
`ImportDeclaration` nodes, and for every binding that names the README's **own** package checks the
name against that package's real export surface.

**Why it needed a gate.** A README teaching `import { X } from '@object-ui/<pkg>'` for an `X` the
package does not export gave the reader a `TypeError` at runtime or a TS2305/TS2724 at build time, and
these READMEs are listed in each package's `files`, so they ship in the npm tarball. Nothing checked
them: `check-doc-links.mjs` parses links and never looks inside a code block, and
`check-doc-component-types.mjs` scans `content/docs` and never enters `packages/`. One manual sweep
([#5043](https://github.com/objectstack-ai/objectui/issues/5043)) found drift in **seven** packages
(#5010–#5016) and recorded that number as a *lower bound*, because the method it used could only see
single-line import statements.

**It parses, it does not match.** The card's first sketch was a cross-line regex; measured on
`plugin-gantt` it reported five words of prose as fabricated import names and missed both real
fabrications, because a **side-effect import** (`import '@object-ui/plugin-gantt';`, no `from`) lets a
lazy quantifier run on to the next `from` twenty lines later. Parsing makes that unrepresentable: a
multi-line block is one node, a trailing `//` comment is trivia that can never contribute a name, and
`A as B` exposes the export name separately from the local alias — the gate judges **`A`**.

**The export set is symbols, never a grep.** It comes from the TypeScript checker's
`getExportsOfModule` over each package's *declared* type entry, with aliases resolved before the
value/type flags are read. A text-level set is measurably wrong here: `GanttSchema` grepped in
`packages/types/src` has six hits, every one of them a substring of `ObjectGanttSchema`.

**Three verdicts, because two of them have different fixes.** `real`; `fabricated` (no package exports
it — delete or rename); and `wrong-path` (the name is real but belongs to another package, so the
*path* is what to change). #5010's `CalendarViewSchema` was the third kind, and the first run of this
gate found one more: `packages/core/src/adapters/README.md` imported `ObjectStackAdapter` and
`createObjectStackAdapter` from `@object-ui/core` when both live in `@object-ui/data-objectstack`.

**It builds first, and refuses to guess when it cannot.** The declared type entry is a built
`dist/index.d.ts` for almost every package, so the workflow installs and runs `turbo run build` before
the check (measured cold, concurrency 2, on a contended container: 2m42s for all 39 packages). If a
package's type entry is missing anyway, that is a **failure**, never a skip: counting it as "exports
nothing" would mark every import in its README fabricated, and skipping it would shrink the judged
population with nothing in the output to say so.

**It is green at rest, so its census is part of the verdict** — READMEs scanned, blocks parsed,
bindings judged, packages whose exports were read — and the census says **tracked** out loud,
because the walk is `git ls-files`: a new README that has not been `git add`-ed is outside the
population and a local run reports OK without opening it (objectui#6545). CI is unaffected — a
committed tree has no untracked files — and the scan **fails when that population
collapses**. The evidence that it can fail lives in `scripts/__tests__/check-readme-exports.test.ts`,
which plants four mutations on a fixture tree: a fabricated name in a multi-line block, one in a
trailing comment (which must **not** be reported), an `X as Y` with `X` fabricated, and one mid-block
in a type import.

**Out of scope, deliberately:** compiling the extracted blocks (a separate card — it has pre-existing
reds that need a baseline decision first), and authorable-JSON *key* surfaces: a JSON block carries no
type annotation, and the Zod mirror `safeValidateSchema` reads is `.passthrough()`.

**If it fails:** it names the README, the line of the offending specifier, and which package really
exports the name. Run it locally with `pnpm check:readme-exports` after a build, or
`node scripts/check-readme-exports.mjs --list` to see every self-import it judged.

`--list` is the diagnostic you reach for in the state where the gate just failed, so it answers in
that state rather than dying in it (objectui#9220): on a tree where a tracked package is unbuilt it
prints every row and the census it *could* derive, then `PRECONDITION NOT MET (exit 2)` naming the
unbuilt packages and a build command scoped to them. The separate exit code is the point — exit 1
means "a verdict was read and a README is wrong", exit 2 means "nothing above is a verdict". Before
that card the same state was an uncaught `TypeError` in the row formatter, which printed no census,
no row past the first unjudgeable declaration, and left exit 1, indistinguishable from the
fabricated-name failure the gate exists to report.

### Docs Route Eager Closure — the Docs Route Eager Closure Check step

**Triggers:** Push and PR to `main`/`develop`, merge-queue builds, plus manual dispatch — with **no
path filter at all** (the reason is in the [inventory](#workflow-inventory) bullets above). It runs as the **Docs Route Eager Closure Check** step of the **Repo Gates**
job, and `REQUIRED_CONTEXTS` in
`scripts/dependabot-merge-gate.mjs` declares that job's context blocking — which is also what puts
`repo-gates.yml` inside the derived `merge_group` floor, because a required check that never reports
on a queue build does not fail it, it stalls it for the ruleset's 60 minutes.

Runs `scripts/check-docs-route-eager-closure.mjs` (`pnpm check:docs-route-closure`): a checkout plus
one `node` call over the source tree, **no install and no build**, ~1.3 s.

**What it weighs, and what was not weighing it.**
`apps/site/app/components/registerCatalogBlocks.ts` is a list of side-effect imports, and each one
pulls its package's module graph into the Next docs route `/docs/[[...slug]]` — a route **every docs
page shares**, not just the catalog gallery. ⛔ No page count here, deliberately: this sentence used
to state one as a literal, it went stale, and nothing went red over that distance, because nothing
fails on a number written in prose ([#8629](https://github.com/objectstack-ai/objectui/issues/8629),
[#7448](https://github.com/objectstack-ai/objectui/issues/7448)). That population is derived on
every run from the directory `apps/site/source.config.ts` declares as the docs collection —
`content/docs` — and this gate prints how much of it the walk reached: the `gauge:` line reports the
route roots it crawled and how many of those are compiled MDX modules out of that directory. The
cards that added to that list said the cost was governed by `check:eager-closure`. It was not:
`scripts/check-eager-closure-budget.mjs` reads `apps/console/dist/eager-closure.json` and
`performance-budget.yml` builds `@object-ui/console`, so that budget weighs the **console**. The
only measurement of the docs route that has ever existed was reconstructed by hand, once, from the
`script src` set of the prerendered route on disk, and the `+50%` stop condition
[#4616](https://github.com/objectstack-ai/objectui/issues/4616) set had no gauge behind it
([#6316](https://github.com/objectstack-ai/objectui/issues/6316)).

**Structural, not byte-level — ruled that way on purpose.** A second byte budget would have to build
every page of that collection in CI, on every run. ⛔ No count of them here either, for the reason
the paragraph above gives: the size of that cost is derived, never written down. This gate instead
walks the route's **static** module graph from source —
the route entries, plus every compiled `content/docs/**` MDX module, which the route pulls in through
the generated `.source/server.ts` — and sorts every package the registrar names into one of three
buckets:

| Bucket | Meaning |
|---|---|
| **Recorded** | listed in the gate's `MEASURED_PAYLOAD` — its eager cost was argued for and written down when it landed |
| **Free** | already reachable without this file naming it, so the import adds a *declaration* and no payload |
| **New graph** | neither, so the import pulls a graph this route has never carried — **fails** |

The third bucket is the whole point: it turns an unmeasured hazard into a review event, which is
what a cheap instrument can honestly do. `MEASURED_PAYLOAD` is a ledger and **not a ceiling** — it
carries no bytes and no threshold, and every entry is re-measured on each run, so an entry the
registrar stopped naming, or one that became reachable some other way, fails and has to shrink.

**Exit 1 and exit 2 mean different things, and must not be read as one.** Exit **1** is a verdict
about the registrar: a new graph, or a ledger that has drifted. Exit **2** says the **gauge** is not
trustworthy — a specifier the walk must resolve did not, a route entry moved, the registrar is no
longer reachable from the route at all, or every workspace package now reads as reachable (a
traversal that reaches everything cannot tell a new graph from a free one). A reader who sees exit 2
must not conclude the registrar is wrong; nothing was validly measured. All three verdicts print
before any of them decides the code, the way `check-eager-closure-budget.mjs` prints its four.

**A structural gate that cannot fail is worse than none**, because it converts an unmeasured hazard
into a false assurance — so the failing direction is verified rather than assumed.
`scripts/__tests__/check-docs-route-eager-closure.test.ts` drives the real analysis over fixture
trees for each way the walk could silently answer "everything is reachable": a fenced MDX code block
counted as an import, an erased `import type`, a lazy `import()` (the distinction the gate exists to
police — `PluginLoader` is built on it so those graphs stay *off* this route), a package named only
in the registrar's own prose, an unresolved specifier, and the registrar falling off the route.

**If it fails:** the message names the package, the line that declares it, and the two ways out —
reach the code through a package the route already carries, or argue for the payload in review and
record it in `MEASURED_PAYLOAD` with what it is for. Run it locally with
`pnpm check:docs-route-closure`; a green run prints the full classification, including which file
each *free* package is already imported by.

## Governed Surface Guard (`governed-surface-guard.yml`)

**Trigger:** Pull request to `main` / `develop` (`opened`, `synchronize`, `reopened`,
`ready_for_review`) and merge-queue builds — **no path filter** on either leg.
**Appears as:** **Governed Surface Queue Guard**.
**Blocks a PR?** Not on the pull request, by design. On a merge-queue build it refuses.

The **governed surface** is a fixed list — `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `skills/**`,
`docs/adr/**` and, since the maintainer's ruling on
[#12255](https://github.com/objectstack-ai/objectui/issues/12255), `.github/workflows/**` — and
the rule about it is that a change to any of them is merged by a human, not by the queue. That rule
used to live only in prose. On
[#6183](https://github.com/objectstack-ai/objectui/pull/6183) an `AGENTS.md` change was correctly
parked as a draft; a GitHub MCP `update_pull_request` call passing only `reviewers` silently also
set `draft: false`; the pull request entered the merge queue and landed with no human approval, and
converting it back to a draft did not dequeue it. Nothing in CI could have refused that. This
workflow is the refusal ([#6596](https://github.com/objectstack-ai/objectui/issues/6596)).

**The two legs mean different things, and that is the whole design.** On a **pull request** the
check is deliberately green whatever it finds, and prints an early warning naming the governed paths
and the sequence not to start. A governed pull request sitting as a draft for the maintainer to
merge by hand is the *healthy* end state, so a check that reddened on it would be red on the healthy
case forever — and a permanently red check is one everybody learns to ignore. On a **merge-queue
build** the same finding is a refusal: that is a state a governed pull request should never be in at
all, so red there is red on the anomaly.

**What clears the queue leg** is a latest-decisive `APPROVED` review by an account in
`GOVERNED_APPROVERS`, on whichever commit it was left. Dismissed and superseded approvals (a later
`CHANGES_REQUESTED` by the same reviewer) never count; an `APPROVED` review by an account outside
that set never counts; an empty or unreadable review list fails closed. The predicate is the
existence of a human approval record, and says nothing about which bytes it was given for — the
maintainer ruled the sha pin out on 2026-09-04, quoted verbatim and untranslated because rewriting a
ruling is rewriting the ruling: 「你的门禁有问题，只需要有人工批准记录就行，不需要卡最新的提交。」
The pin is retired, not softened: no predicate reads `commit_id`, there is no stale bucket, and the
pull-request head read that existed only to feed the pin is gone with it. **The accepted cost**,
stated out loud rather than left to be discovered: a push after an approval is no longer re-reviewed
by this gate, so an approved governed pull request can land carrying bytes its approver never read.
The remedy the refusal prints **first** is not approval at all — convert the pull request back to a
draft and leave the merge to the maintainer.

**What it costs when nothing is governed:** on a **pull request**, nothing. The path test runs before
any request is constructed, so an ordinary pull request produces a `CLEAR` verdict and **zero**
GitHub API calls; an API outage cannot block a diff that touches no governed path. ⚠️ On a
**merge-queue build** that is no longer true and the verdict text says so rather than repeating a
promise the carrier leg took away: the carrier is remote state a seat hangs, not a property of the
diff, so there is no cheap local pre-filter for it and every merge group costs one label read per
queued pull request. An outage there **does** refuse the merge group. That is the deliberate
direction: fail-open on a gate label that cannot be seen is the failure this whole regime exists to
end. The mirrored requirement on the governed leg is unchanged — an API error on a diff that *is*
governed is a refusal with its own exit code (4, distinct from 3 for
"nobody approved"), never a pass — this gate exists because every other layer in the chain failed
open.


**The second leg: the contract-review carrier.** On a **merge-queue build only**, this check carries
a second and completely independent predicate, keyed on a *label* rather than on paths
([#9018](https://github.com/objectstack-ai/objectui/issues/9018), a re-implementation of the leg
objectstack landed as its own `objectstack#17484`). It enumerates **every** pull request the merge
group is landing — per commit, exactly as the governed leg does, because `merge_group.head_ref`
names only the *last* pull request in the group and keying on it would let an earlier pull request's
open carrier ride into `main` behind a clean one — reads each one's labels from the pull object
(`pull-requests: read`, the scope the review read already needs; the `issues/{n}/labels` route would
need `issues: read`, which this workflow does not grant), and refuses while
`needs:contract-review` is on any of them (**exit 6**) or when a label set cannot be read or the
group names no pull request at all (**exit 7**, split from 6 for the same reason 4 is split from 3).
The `pull_request` leg is untouched and reads no label.

**The honest boundary of that leg: it reads the label, not the verdict.** A carrier stripped seconds
before an enqueue with no review verdict on record is, to a label reader, identical to one that was
never hung. Of the eleven enqueues measured on 2026-09-09, five carried the label into the queue and
this leg refuses them; six did not and it passes them — including
[#8164](https://github.com/objectstack-ai/objectui/pull/8164), which landed a real defect. Upgrading
the predicate until it catches that would make it a *verdict* check, which is a strictly larger rule
than the one that was ruled. Nothing in this repository answers the verdict question, and since
the sweeper copy whose H31 compared the gate's two carriers was retired
([#10208](https://github.com/objectstack-ai/objectui/issues/10208)) nothing here compares the
carriers either. The `CLEAR` rendering says so out loud, so a green is never read as "the review
happened".

**What it deliberately does not do.** It does not govern the rest of `.github/` — `.github/dependabot.yml`,
`.github/labeler.yml`, `.github/prompts/` — because the ruling named the workflows, not their
directory. It *does*
govern its own workflow file, and a Dependabot `github-actions` bump with it: that bump edits
`.github/workflows/**`, so `dependabot-auto-merge.yml` still approves and enqueues it, the queue leg
refuses it, and it waits for an authorized approval like any other workflow change. It
cannot stop a maintainer
merging a governed pull request by hand, and does not try — under this regime the human merge *is*
the review record. And it does not make itself required: that is a branch-protection setting only
the maintainer can flip. Until it is flipped, the queue leg reports without stopping anything. What
this repository can write down, and has, is `REQUIRED_CONTEXTS` in `scripts/dependabot-merge-gate.mjs`.

**If it fails:** read the verdict — it names every governed path that matched, the pull request each
belongs to, and the two ways out. To ask the same question about a file list before pushing, run
`pnpm governed -- AGENTS.md packages/core/src/index.ts` (or
`node scripts/check-governed-queue-guard.mjs --test <paths>`); it exits 0 when nothing is governed.
The predicates are covered by `node scripts/check-governed-queue-guard.mjs --self-test`, which the
workflow runs as its own first step because a rotted predicate must redden rather than wave a
governed diff through, and the wiring is pinned by
`scripts/__tests__/check-governed-queue-guard.test.ts`.

## Line Citations (`line-citation-gate.yml`)

**Triggers:** Pull requests to `main`/`develop`, with **no path filter**, plus manual dispatch. It runs as the **Line Citation Gate** step of the **Repo Gates**
job.

**What it runs:** `node scripts/check-new-cross-file-line-citations.mjs` — one `node` call over the
pull request's own diff. No install, no build.

**Report-only.** This step **exits 0 regardless of what it finds**. It is not a required context, it
declares no `merge_group` trigger, and `scripts/dependabot-merge-gate.mjs` classifies it
`NOT_A_GATE` for that reason. The one thing that does make it exit 1 is a failure of its own
synthetic controls — a differential gate reporting zero through a broken differ is indistinguishable
from a clean branch, so the instrument is checked on every run.

### What it reads, and the word that decides its shape

The maintainer ruled the class on 2026-09-10, verbatim: 「跨文件的「某文件第几行」引用，
这种完全没必要吧，是否应该避免」. A cross-file line address points somewhere the reader is not
looking, and nothing tells them when it moves. Five spellings are read, written here with `NNN`
standing in for the digits **on purpose** — a real address in this paragraph would be one more
citation for the gate to report, which is the shape of the problem rather than a description of it:

| spelling | example, digits elided |
|---|---|
| the dominant form | `NAME.ts:NNN` |
| the GitHub permalink form | `NAME.ts#LNNN` |
| the address written first | `line NNN of NAME.ts` |
| the address written second | `NAME.ts line NNN` |
| the **continuation** form, which carries no filename at all | a bare `:NNN` beside an address written on a neighbouring line |

The continuation form is the one no basename-anchored probe can see, and it is why a one-syntax
count is not a reading. Measured on this tree: 1,267 such citations, 540 of them already false.

The gate is **differential**. It reads only what a pull request **adds**, against its merge base with
the target branch. The 540 existing citations are **not** its denominator and it does **not** sweep
them in: shifting an already-false address by a hunk delta moves a wrong pointer to a differently
wrong place while making the diff look diligent.

An absolute count was refused on a measurement rather than on taste. PR #8887's line shifts flipped
one citation from `drifted` to `resolves` by accident, moving the tree-wide false count 540 → 539 —
an unearned green that belonged to nobody, and one a total-reading gate would have scored as
progress.

### The three verdicts, and the one that must not collapse

Every added citation is a finding — the convention is that the address is not written, not that it
is written accurately — but each carries the verdict a reader would reach by following it:

| verdict | meaning |
|---|---|
| `false` | the cited line does not carry what the citing prose says it does |
| `resolving` | it does, today |
| `unresolvable` | nothing can ever decide it — chiefly citations into regenerated `dist/*.d.ts`, which are untracked and rebuilt, plus bare basenames that name several tracked files at once |

`unresolvable` is **never** counted as `false`. Calling an undecidable citation wrong is an
assertion, and the split is pinned by a synthetic control so it cannot quietly regress.

### What flips it to blocking

`ENFORCEMENT` in the script is the whole switch, and its test reads the landed value, so the flip
cannot happen without the pin moving with it. It flips once the gate reads zero new citations across
the in-flight population and the convention text has landed in `AGENTS.md` — an author failed by a
rule is owed a document to be failed against. When it does flip, this workflow owes a `merge_group`
leg before the context may be required: a required check that never reports on a queue build stalls
the queue until the ruleset's 60-minute timeout fails it.

### The related report

`pnpm census:cross-file-line-citations` is the tree-wide census the differential gate was derived
from. It runs in no workflow, prints the whole population with its per-directory split, and is the
right instrument for asking how large the existing class is — never for deciding a pull request.

## Lockfile Integrity (`lockfile-integrity.yml`)

**Triggers:** Pull requests to `main`/`develop` that touch `pnpm-lock.yaml`,
`scripts/check-lockfile-integrity.mjs` or the workflow file itself, plus manual dispatch. It runs as the **Lockfile Integrity Check** step of the **Repo Gates** job.

Runs `scripts/check-lockfile-integrity.mjs`, which compares the pull request's `pnpm-lock.yaml`
against the **merge base's** and reports two things:

1. an `@objectstack/*` identity resolving to a version **lower** than the base resolved;
2. a package the workspace declares at runtime (`dependencies`, `peerDependencies`,
   `optionalDependencies`) resolving to **more physical copies** than the base did — where a copy is
   a `snapshots:` key, peer suffix included, because that is the directory pnpm creates.

It is the only gate here that needs two revisions of a file, which is why it checks out with
`fetch-depth: 0`. Exit `0` clean, `1` findings, `2` **could not take a reading** — a shallow checkout
or a lockfile whose format moved exits 2 rather than reporting a clean lockfile it never read.

**Why it needed a gate.** In [#8326](https://github.com/objectstack-ai/objectui/issues/8326)
Dependabot's regenerated lockfile on three pull requests at once downgraded the whole
`@objectstack/*` family 17.3.0 → 17.2.0 and forked zod, splitting the workspace across **two physical
`@objectstack/spec` copies**. Nothing dedupes two real paths, so `vendor-objectstack` went
4,030,557 → 8,423,436 raw bytes. What that produced was a **red `Bundle Analysis` on a dependency bump
for a reason that had nothing to do with the dependency** — and the obvious reading, "this bump bloats
the bundle", was wrong. Two seats each spent a full diagnosis reaching the same answer independently.
Every workspace range on the family is a floating `^17.x` against a registry whose latest is 17.3.0,
so no fresh resolve can produce 17.2.0: it was a stale resolution carried across a rebase.

**Why one rule was not enough.** [#8333](https://github.com/objectstack-ai/objectui/issues/8333)
measured the other cause: floating `better-auth` to 1.7.3 from a **clean** base forks zod while moving
**no `@objectstack/*` identity at all**, and re-measuring it on `da5e4f69e` shows `@objectstack/spec`
staying at one version and still landing as **two directories**, one per peer resolution. A gate that
only asked "did an identity move backward", or that counted versions rather than snapshot keys, is
green on that.

**⛔ What this gate does not do.** It does not pin, dedupe or re-resolve anything — the remedy for a
finding is a decision the pull request makes. It is a **ratchet, not an audit**: a lockfile that is
already duplicated stays green while the change does not make it worse. It does not judge backward
moves outside `@objectstack/*` (third-party downgrades are legitimate) or duplications of packages
this workspace does not itself declare at runtime — measured, scoping it wider reds on ordinary merged
build-tooling churn. And it says nothing about bytes; `Bundle Analysis` measures those.

**⛔ It cannot block anything today**, by design. `scripts/dependabot-merge-gate.mjs` classifies it in
`NOT_A_GATE`, and its `pull_request` trigger is path-filtered, which under
[#3523](https://github.com/objectstack-ai/objectui/issues/3523)'s rule makes it unrequirable while
that filter stands. Enrolling it is a maintainer decision with its own cost, written up on #8326's
pull request as input.

## Lockfile Dedupe (`lockfile-dedupe.yml`)

Before the check, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs`: `pnpm dedupe --check` re-reads the `file:` directories every `@objectstack/*` package resolves to, and the checker reports a reading it could not take when they are missing (objectui#12957).

**Trigger:** Pull requests to `main` and `develop` that touch `pnpm-lock.yaml`, this gate's own
runtime closure (`scripts/check-lockfile-dedupe.mjs`, `scripts/invoked-as.mjs`,
`scripts/ci-setup-pnpm.sh`) or the workflow file itself, plus manual dispatch. It runs as the **Lockfile Dedupe Check** step of the **Repo Gates** job.

Runs `scripts/check-lockfile-dedupe.mjs`, which shells out to `pnpm dedupe --check` and requires the
committed lockfile to be **already deduped** — that is, `pnpm dedupe` must have nothing left to
collapse.

**How it differs from its neighbour.** `Lockfile Integrity Check` reports a **delta** against the
merge base ("did *this* change duplicate something?") and needs two revisions of one file.
This gate reports a **property of one tree** ("would `pnpm dedupe` still have work to do here?") and
needs no base — but it does need pnpm and the registry. The two are independent: a tree can be
delta-clean and still carry years of accumulated duplication, which is the state `main` was in until
[#9215](https://github.com/objectstack-ai/objectui/issues/9215) collapsed 47 identities out of it.

**Why it exists.** [#8333](https://github.com/objectstack-ai/objectui/issues/8333) measured the
sequence: a dependency bump re-resolves part of the peer graph and forks a package that was
single-copy — no declaration, range or override anywhere in the workspace changes — and
`Bundle Analysis` then reads a bundle that grew and attributes the growth to the bump. The remedy is
`pnpm dedupe`, but `pnpm dedupe` is **not surgical**: run on a tree carrying old duplication it
collapses all of it, and the reviewer reads the combined delta as the bump's — the same
misattribution, aimed at a different pull request. So the remedy is only honest once the tree is
already deduped, which is why #8333's ruling was **B then A**: pay the accumulated debt down in its
own dedicated pull request first (#9215), then require the remedy in bump pull requests. This gate is
that second half, and it is also what keeps the first half true.

**It IS a blocking context**, and that is a decision rather than a default.
`scripts/dependabot-merge-gate.mjs` classifies it in `OPTIONAL_CONTEXTS`, so a red stops a Dependabot
auto-merge; its path filter makes it unrequirable under
[#3523](https://github.com/objectstack-ai/objectui/issues/3523)'s rule, the same terms
`Bundle Analysis` is enrolled on. It blocks where `Lockfile Integrity Check` deliberately does not
because the two differ in **remedy**: #8326's gate names a duplication and leaves the answer open
(re-lock, pin, or accept), a judgement call its header reserves for the maintainer, while this gate
has exactly one mechanical remedy and pnpm prints it — run `pnpm dedupe` and commit the lockfile,
changing no declaration, range or override. To stop it blocking, move the name to `NOT_A_GATE`;
`scripts/__tests__/check-lockfile-dedupe.test.ts` fails on that demotion so it has to be taken
deliberately.

**⛔ What its green does not mean.** It does not say the lockfile is *minimal* — packages whose
ranges genuinely do not overlap keep their separate copies and are not findings. It does not measure
bytes; `Bundle Analysis` does. And it is not a check that drifts with the registry: `pnpm dedupe`
collapses copies already in the tree rather than chasing the newest version a range admits, which
#8333 measured directly (`better-auth` declared `^1.7.2`, locked at `1.7.2`, with `1.7.4` published
and admitted by that range — and this gate green on that tree).

**⛔ What it does not do.** It does not run `pnpm dedupe` for you, and it never edits the lockfile —
`--check` reports without writing. A finding is fixed in the pull request that caused it, by running
the command and committing the result. ⛔ Pinning a version, adding a `pnpm.overrides` entry or
widening a range are **not** acceptable ways to satisfy it: #8333 rejected all three, on the grounds
that they spend a declaration to fix a resolution artefact.

## Link Checking (`check-links.yml`)

**Trigger:** Weekly cron (`17 4 * * 0` — Sundays, off the top of the hour, when the scheduled-run
queue is shortest) plus manual workflow dispatch.

There are **two** link checkers, and they cover different things (objectui#3213):

| | Covers | Network | Runs |
|---|---|---|---|
| `scripts/check-doc-links.mjs` | **Internal** links in `content/docs/` (relative hrefs, `/docs/...` routes, every other site-absolute href against `apps/site`), and, as paths on disk: `examples/`, the internal `docs/` tree, every package and app `README.md`, the rest of each package's and app's directory tree (everything but `README.md`/`CHANGELOG.md`), every nested `README.md`, and the root-level markdown files (`README.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `LICENSE-THIRD-PARTY.md`, `QUICK_REFERENCE.md`) — plus this repo's own `blob/main/` and `tree/main/` GitHub URLs and this site's own `objectui.org` URLs everywhere — **except** anything inside a code fence | No | `repo-gates.yml`'s Internal Docs Link Check — every push and PR, no path filter |
| Lychee (this workflow) | **External** URLs, plus **relative** in-repo file links, in `content/docs/`, `docs/` and `README.md` | Yes | Weekly cron and manual dispatch |

Lychee sweeps **both** documentation trees plus `README.md`: the **published** tree
`content/docs/**` — every `.md` and `.mdx` under the fumadocs content source
`apps/site/source.config.ts` declares (`dir: '../../content/docs'`, baseUrl `/docs`) — and the
repo-root `docs/**` of **internal** material (ADRs, audits, architecture notes). What gets swept is
decided by that workflow's `args` glob list and by nothing else, and
`scripts/__tests__/check-links-workflow.test.ts` derives the expected scope from the site config
rather than restating it, so moving the content tree turns that test red instead of quietly
blinding the sweep.

⛔ **Neither tree's size belongs on this page.** One hand-copied count per tree stood in the
sentence above, and both had drifted by the time anyone read them, with nothing red over the whole
distance — no gate anywhere reads either figure, which is exactly why a number written here rots
(objectui#7448, objectui#7825, objectui#7886). State the population, as above, and point at the
reading: in any checkout,
`find content/docs docs -type f \( -name '*.md' -o -name '*.mdx' \) | wc -l`, and Lychee's own run
summary, which reports what it actually scanned. This page opens by declining to count workflows,
for the same reason.

**Past tense on purpose — none of the following describes the scope today.** Until objectui#3449
the `args` list named only the repo-root tree, so not one published page had ever been
link-checked: the workflow was green because of what it was not looking at.

It is deliberately **not** a PR gate (objectui#3213). External link checking goes over the network,
and one 502 or rate-limit from a third-party site would redden a pull request whose author can do
nothing about it. The cron was added only once the scope was correct: a schedule pointed at the
wrong tree just produces a false-green report on a timer.

Uses [Lychee](https://github.com/lycheeverse/lychee) with configuration from `lychee.toml`:
- Scans `content/docs/**/*.{md,mdx}`, `docs/**/*.{md,mdx}` and `README.md`
- Max concurrency: 10, timeout: 20s, retries: 3
- Excludes: localhost, example.com, Twitter/X, GitHub compare/commit URLs
- Skips **site-absolute** routes (`/docs/...`, `/api/...`): Lychee cannot resolve extensionless
  fumadocs routes, and without handling it fails them while building the URI — before `exclude` is
  even consulted. `root_dir` therefore resolves them into a sentinel namespace that is then
  excluded wholesale. Judging those routes is `check-doc-links.mjs`'s job, and duplicating its
  route-to-file mapping here would only create a second copy free to drift.

## Spec Shape Gate — moved to objectstack

The gate that compiled this repository against `@objectstack/spec` built from objectstack `main`
no longer runs here. Under the maintainer's ruling B on
[objectstack#23238](https://github.com/objectstack-ai/objectstack/issues/23238), the shape gate
moved to the repository whose commits change the shape, and
[#12352](https://github.com/objectstack-ai/objectui/issues/12352) deleted objectui's copy — its
workflow, its script and its pin test — once the two gates had read the same diagnostics on
consecutive hourly runs (the readings are on that card, not restated here). The gate's history in
this repository — option C of [#9860](https://github.com/objectstack-ai/objectui/issues/9860), its
enrolment under [#9969](https://github.com/objectstack-ai/objectui/issues/9969) and its removal from
the required set under [#12240](https://github.com/objectstack-ai/objectui/issues/12240) — lives on
those cards and in git history.

- **Where it runs now.** objectstack's `.github/workflows/spec-shape-gate.yml`, hourly on objectstack
  `main`. It clones objectui `main`, injects the spec built from the objectstack commit into this
  repository's install, and runs this repository's `pnpm type-check` with the turbo cache bypassed,
  so a red still names the objectui file and the objectstack commit. objectstack's release gate
  (`scripts/ci/scheduled-full-run.mjs` there) reads those runs, and a red is attributed to the
  objectstack lane that moved the shape. Nothing in this repository waits for it: no workflow here
  produces the Spec Main Shape Gate context any more, and `scripts/check-required-check-set.mjs`
  keeps a tombstone saying the name must not come back to the ruleset.
- **Where an intentional retirement is registered.** An objectstack change that removes something
  objectui still compiles against, on purpose, is registered in objectstack's
  `scripts/ci/spec-shape-retirements.json`, beside the objectui card that removes the downstream
  use. The gate reads a diagnostic matching a registered retirement as known rather than new;
  that file's own header states the entry grammar and when an entry is deleted.
- **What stays here.** `turbo.json` still names
  `node_modules/@objectstack/spec/.spec-main-shape-gate.json` in `globalDependencies`. objectstack's
  injection writes that marker — the name is kept on purpose — into every copy of the spec it
  replaces, so a tree holding an injected spec never shares a turbo hash with an installed one. That
  matters when somebody reproduces the gate locally in a linked worktree, whose `.turbo/cache` is
  shared with its siblings: a forced run skips cache reads but still writes, and without the marker
  an ordinary `pnpm type-check` in a sibling could replay a verdict taken against the injected spec
  ([#12114](https://github.com/objectstack-ai/objectui/issues/12114)). An installed tree carries no
  marker, and an absent global dependency hashes as nothing.


## Release Workflows

### Changeset Release (`changeset-release.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Trigger:** Push to `main` — the **publish** half. Cron `0 */6 * * *` and manual dispatch with
`refresh_version_pr` — the **version-PR refresh** half.

Uses [Changesets](https://github.com/changesets/changesets) for automated versioning and npm
publishing, in **two lanes that cannot do each other's job**:

| Event | Predicate | What runs |
|---|---|---|
| Push to `main` | declared version **not** on npm | **Publish to npm.** Normally the version-PR merge, which is the release act; also the retry for a release whose own run failed. |
| Push to `main` | declared version already on npm | **Nothing.** Every ordinary landing — a merge that is not a release does not move the version. |
| Cron `0 */6 * * *` | n/a | **Refresh the version PR** ([#5400](https://github.com/objectstack-ai/objectui/pull/5400)) — never publishes. |
| Manual, `refresh_version_pr` checked | n/a | The same refresh, on demand. |
| Manual, unchecked | n/a | Nothing; the run says so with a `::notice::`. |

The refresh used to run on **every** push to `main`, which force-pushed the version PR ~18 times
a working day while releases are weekly — so its branch CI never converged, and every refresh
was a CI run spent on bookkeeping nobody reads until release day
([objectstack#10850](https://github.com/objectstack-ai/objectstack/issues/10850)). A cheap `lane`
job answers the questions the split turns on from a sparse checkout of `.changeset/` and
`packages/core/`, before anything installs or builds.

#### The publish lane is keyed on npm, not on `.changeset/`

The publish half asks **"is the version this commit declares already on npm?"** — not "are
changesets pending?" ([#5442](https://github.com/objectstack-ai/objectui/issues/5442)). The two
read as interchangeable and come apart exactly where it costs a release: the version PR is cut
from `main` at T and merged at T+n, `main` takes ~18 merges a working day, and the merge does not
remove the changesets that landed in between. Those belong to the *next* version — but keyed on
them, the version this commit just bumped to is skipped, and the next version PR bumps straight
past it. Measured when #5442 was fixed: of the 90 versions `packages/core/CHANGELOG.md` declared,
**16 had never reached npm**, and the repository said `17.6.0` while `dist-tags.latest` said
`17.5.0`.

The npm predicate is also **cheaper** than the one it replaced, rather than a trade against it. An
ordinary landing does not move the manifest version, so it answers "already published" and the
expensive job is skipped — where "no changesets pending" ran the job in full on every landing that
happened to find `.changeset/` empty, only to publish nothing.

`@object-ui/core` is the version anchor because every package in the `fixed` group of
`.changeset/config.json` moves as one version, so any member answers for the whole release. The
lane **asserts** that membership instead of assuming it, and it refuses to guess a lane if the
registry cannot be read: 200 is published, 404 is not, and anything else fails the run.

`changesets/action@v1` chooses publish-vs-version from repository state rather than from an input,
so the predicate cannot reach it on its own — with changesets present it would take its version
branch and publish nothing. The publish lane therefore clears the pending `.changeset/*.md` from
the **runner's working tree** before invoking it. Nothing is committed and no branch is pushed
(`runPublish` never commits), so `.changeset/` on `main` is untouched and those changesets are
still owed to the next version PR.

#### The loud check

#5442's defect was never a red run — it was a green one: run 3370 on `cfeb378b5` completed
`success` having published nothing, and only a CHANGELOG-against-registry audit noticed, 16
versions later. So the publish lane now reads the registry back afterwards and **fails** if the
version it exists to ship is still absent. A repo/npm divergence is a failing run, not a finding.

#### Tags and GitHub Releases

`changesets/action@v1` pushes a package's git tag and creates its GitHub Release only for the
packages whose `New tag: <pkg>@<version>` line it parses out of the publish script's stdout. Since
[#5296](https://github.com/objectstack-ai/objectui/issues/5296) moved this repository to
`@changesets/cli` v3, `changeset publish` prints no such line, so the action pushed nothing and
created nothing: **17.6.0 and 17.7.0 reached npm with no tag and no Release**, while every step
stayed green ([#11596](https://github.com/objectstack-ai/objectui/issues/11596)). `changeset
publish` still creates the tags on the runner, so the publish lane now finishes the job itself,
after the npm check:

| Step | What it does |
|---|---|
| Push the release tags | Pushes exactly the `<pkg>@<version>` tags the release owes — the list `--print-tags` prints — in **one** push, and fails naming any tag `changeset publish` did not create. |
| Create GitHub Releases | `node scripts/release-github-releases.mjs`, ported from objectstack: one Release per public package from its CHANGELOG entry, idempotent (an existing Release is updated, never re-created), and every body **truncated to the Releases API's 125,000-character limit** with a link to the complete entry. |

The truncation is not hypothetical here: `@object-ui/app-shell@17.5.0` has a tag but no Release,
because its entry was over that limit when the action tried to post it, and many 17.7.0 entries
are larger still. Run the script with `--dry-run` to see the planned tag → Release list and each
body's size without calling the API.

Both steps run on the **publish lane only** — `push`, gated on the publish step and the npm check
having succeeded, so a `schedule` or `workflow_dispatch` run can never reach them — and under
`!cancelled()`, so a version that is already public still gets its record if a step between them
fails. The tags go first because a Release created for a tag the remote does not have makes the
API create that tag itself, as a lightweight tag. `scripts/__tests__/release-github-releases.test.ts`
runs the script's `--self-test` and pins both steps' lane scoping and order.

The refresh lane is invoked **without** a `publish:` script and **without** npm credentials, so
it cannot publish by construction rather than by a condition — the release act in this
repository stays the human merge of the version PR.

Before either lane's changesets step, the release job runs `pnpm build` — the publish lane ships
what that build produced, and the gates below judge the built `dist/`, so there is nothing for them
to read until it has run.

Last in the job, after every release step, `scripts/report-turbo-cache.mjs` posts the restored
cache key and what that build replayed as one notice, then prunes the cache to what the build used
before it is saved under this job's own key prefix
([#12276](https://github.com/objectstack-ai/objectui/issues/12276)).

The publish lane then runs `pnpm changeset:publish`, and that script is
`node scripts/objectstack-floor.mjs && node scripts/check-published-dist-tooling.mjs && node scripts/check-spec-range-floors.mjs && changeset publish`.
Its first step computes every `@objectstack/*` floor from `.objectstack-sha` — the earliest
published release whose tag contains the pinned commit — writes it into the published manifests
and their CHANGELOG entries, and stops the publish when no release contains the pin
([#12958](https://github.com/objectstack-ai/objectui/issues/12958); the rules are that script's
header). The other two are the **blocking** copies of the Published Dist Gate and the Spec Range
Floors gate above. A published package whose `dist/` carries tooling material, or one whose declared
`@objectstack/spec` floor is missing a symbol its own artifact uses, stops the publish before a
single tarball reaches npm, which is where those defects actually cost anything
([#4846](https://github.com/objectstack-ai/objectui/issues/4846)).

> ⚠️ **`pnpm changeset:publish` and `pnpm check:published-dist` are named above on purpose, and a
> `run:`-only reading of this workflow will not find them.** They reach the runner through
> `changesets/action@v1`'s `publish:` **input**, not through a `run:` step, so a tool — or a person
> — scanning the YAML for `run:` lines sees a section naming two commands the job appears not to
> run. It runs them. ⛔ Do not "fix" them out of this section; the parity pin in
> `scripts/__tests__/ci-cd-pipeline-doc.test.ts` declares them as expected and fails if either the
> declaration or the prose goes away.

#### The release PR runs no CI, so the refresh lane validates the tree itself

The version PR gets **no checks of its own, and cannot be given any**. Measured 2026-08-25:
`ci.yml` has **849** runs on `changeset-release/main` and every recent one is `action_required`
with `created_at == run_started_at == updated_at` — created and immediately parked, nothing
executed. GitHub does not start workflow runs from events raised by `GITHUB_TOKEN`, and the
refresh force-pushes that branch, so there is no stable head to re-run against either. On the
17.6.0 release PR the check-runs endpoint returned `total_count: 1`: one job, started **7 seconds
after the merge**. The release commit is therefore the only commit that reaches `main` without
passing the merge queue ([#5397](https://github.com/objectstack-ai/objectui/issues/5397)).

So the refresh lane renders `pnpm changeset:version` into the runner's working tree, validates it,
restores the tree, and only then invokes the action — which does its own versioning and owns the
commit and the push.

**What it validates, and why that is not `pnpm test`.** The version step cannot move a source
byte. Measured against the real tree (328 pending changesets, 17.6.0 → 17.7.0) it touches 411
paths: 330 `.changeset/*.md` deleted, 40 `package.json` (the `"version"` key and nothing else), 40
generated `CHANGELOG.md`, and `QUICK_REFERENCE.md`. The source in the post-version tree is
byte-identical to the `main` commit `ci.yml`'s push lane just tested under coverage across its
coverage shards, so a suite run here would re-test tested bytes at ~40 minutes a go, four times a day —
~2.7 h of daily runner time for a PR nobody reads until release day, which is the cost
[objectstack#10850](https://github.com/objectstack-ai/objectstack/issues/10850) was closed to
remove. The validation is scoped to the surfaces the diff can move instead:

| Command | Covers | Measured |
|---|---|---|
| `pnpm quick-reference:check` | `QUICK_REFERENCE.md` | ~1 s |
| `pnpm check:control-bytes` | the 40 generated `CHANGELOG.md` | ~4 s |
| `pnpm test scripts/__tests__` | 112 test files / 3360 tests on `main@59a3a233d` — every test that reads a manifest version, `QUICK_REFERENCE.md` or a `CHANGELOG.md` | ~50 s |

`check:spec-floors` and `check:published-dist` are deliberately **not** here: they read dependency
ranges and built `dist/`, neither of which the version step moves, and `pnpm changeset:publish`
runs both first on the publish lane anyway.

There is also **no "only when the PR content changed" condition**, for a measured reason: across
the seven consecutive 6-hourly windows from 2026-08-23T06:08Z to 2026-08-25T00:10Z, six carried
new changeset files (median 18). Such a predicate would skip about one refresh in seven while
adding a local prediction of another project's state that can be wrong silently — the shape
[#6081](https://github.com/objectstack-ai/objectui/issues/6081) just deleted from this file.

**Failure semantics.** A red validation fails the job and the refresh never runs, so the standing
PR keeps its last validated content rather than being force-pushed to a broken one. Nothing here
can touch the publish lane: all three steps are scoped to `schedule` / `workflow_dispatch`. The
restore step is load-bearing — with `.changeset/` left consumed the action would find nothing
pending, take its no-op branch and return, and the PR would fossilise with nothing failing
anywhere — so the restoration is asserted, not assumed.

Neither lane configures a lockfile merge driver. This job performs no local merge — the version
branch is updated by `reset --hard` plus a force-push inside `changesets/action` — so there is
nothing for a driver to resolve. It configured one until
[#6436](https://github.com/objectstack-ai/objectui/issues/6436); see **Lockfile Merge Driver**
below for the half of that mechanism which is still live.

### Published Dist Gate (`published-dist-gate.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Trigger:** Nightly cron `41 3 * * *`; push to `main` that touches the gate script or this
workflow; manual. **It carries no `pull_request` trigger, on purpose.**

No published package's build output may contain tooling material — `__tests__/`, `__mocks__/`,
`__benchmarks__/`, `*.test.*`, `*.spec.*`, `*.bench.*`, `*.stories.*`, or a `*.tsbuildinfo` build
record ([#7003](https://github.com/objectstack-ai/objectui/issues/7003): a record has no tooling
source to be traced back to, and it names every input path on the machine that produced it). The
gate is `scripts/check-published-dist-tooling.mjs` (`pnpm check:published-dist`); it builds every
published package itself, then reads each one's tarball file list from `npm pack --dry-run`.

Three things about it are easy to get wrong and are written down in the script's own header
([#4846](https://github.com/objectstack-ai/objectui/issues/4846)):

- **The criterion has to be artifact-level.** The cheap static version — "no build tsconfig
  program may contain a tooling file" — was measured and reds five packages that emit nothing
  wrong, because a tooling file in a *checking* program is correct and only a tooling file in an
  *emitting* program is a defect. Acting on it would mean moving tests out of type programs,
  which is the mirror of what
  [#4006](https://github.com/objectstack-ai/objectui/issues/4006) taught.
- **It must never pass vacuously.** A published package that contributes no build output is a
  finding (`no-build-output`), not a skip, and a failed build is a failure rather than a green
  run with nothing to look at.
- **It is deliberately not a PR gate.** The criterion needs a full-repo build and this repository
  has none per PR: `ci.yml`'s **Build & E2E** builds only `@object-ui/console`, and **Type
  Check** gets only the dependency closure from turbo's `dependsOn: ["^build"]`, so leaf packages
  are never built there. The blocking copy runs on the publish path instead — see below.
- **A per-PR sibling now covers the CONFIG half.** `pnpm check:published-tsconfig-exclude`
  ([#7212](https://github.com/objectstack-ai/objectui/issues/7212)) runs in **Type Check** and
  fails when a published package's build tsconfig names tooling by file name without naming the
  tooling directories. It is not a replacement and does not weaken anything here: it checks
  config shape, never emit semantics, so a package can satisfy it and still ship tooling
  material for some other reason. This gate stays the second line of defence and the only
  criterion that cannot be wrong about what actually ships.

### Spec Range Floors (`spec-range-floors.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Trigger:** Nightly cron `11 4 * * *`; push to `main` that touches the gate script or this
workflow; manual. **It carries no `pull_request` trigger, on purpose.**

A package's declared `@objectstack/spec` floor must carry every symbol that package's own
build output references. The gate is `scripts/check-spec-range-floors.mjs`
(`pnpm check:spec-floors`); the workflow builds every published package with `turbo run build`
(filtered only to exclude the docs site), then the gate compares
each one's `dist` imports of `@objectstack/spec/*` against the export set of the version that
package's own range admits at its lowest.

Between the build and the scan, the job runs `scripts/objectstack-floor.mjs`, the step the publish
path runs first, so the gate judges the floors a publish would ship. Its exit 2 — no published
objectstack release contains the pin yet — leaves nothing to judge, and the scan is skipped with a
notice ([#12958](https://github.com/objectstack-ai/objectui/issues/12958)).

The defect it closes, repaired in the gate's own landing commit `111741454`:
`@object-ui/plugin-detail` shipped `dist/renderers/record-reference-rail.d.ts` re-exporting
`ReferenceRailEntry` from `@objectstack/spec/ui` — a symbol that arrived in spec 17.1.0 — while
its own `dependencies` still named a floor a minor lower. A declared range is a public claim,
and that one admitted a spec without the symbol. (No range literal is quoted here on purpose:
the live answer is `packages/plugin-detail/package.json`, and this gate's output.) Normal installs resolve the newest 17.x and never see it,
which is exactly why nothing found it: it is a floor-honesty defect, and the lockfile hides it
from every other check in this repository.

Two ways of building this check return a confident green, and both are avoided by construction
rather than by care — the script's header carries the long version:

- **Resolution answers the wrong question.** The root `package.json` declares
  `@objectstack/spec`, so pnpm hoists it to the workspace root and every resolution succeeds
  from every package directory regardless of that package's own manifest. A green type-check
  therefore proves nothing about a floor: it type-checks against the *installed* version. The
  gate resolves nothing through `node_modules` — it fetches the declared minimum from the
  registry and reads that tarball's own `exports` map. It is the same trap
  `check-phantom-dependencies.mjs` records for `react`.
- **The spec is dual-package.** `require` reaches `dist/<entry>/index.js` and `import` reaches
  `dist/<entry>/index.mjs`, with separate type entries. Reading it through `createRequire` judges
  a build no bundler ever puts in an application. The gate walks the fetched manifest's `exports`
  map under the **`import`** condition and prints the entry it landed on, and `--cross-check`
  re-reads the `require` half and compares.

Like the two gates above it, the criterion is artifact-level and therefore needs a full build,
so the blocking copy runs on the publish path and this workflow is the nightly alarm. Reading
`src/` instead would be cheaper and wrong in the expensive direction: an `import type` used only
inside a function body is erased and never reaches `dist/`, so a source-level version would
demand floor bumps nothing published justifies.

### Node ESM Load Gate (`node-esm-load-gate.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Trigger:** Nightly cron `17 4 * * *`; push to `main` that touches the gate script or this
workflow; manual. **It carries no `pull_request` trigger, on purpose.**

Every published ESM package must be importable by Node's own resolver — no bundler, no loader
hooks. The gate is `scripts/check-node-esm-load.mjs` and it has two legs, only one of which runs
here:

- **The specifier leg** (`pnpm check:esm-specifiers`) reads *sources* and needs no build, so it
  runs per pull request in **Type Check**, not in this workflow. It is the ratchet: for a package
  whose build preserves import specifiers, the emitted specifier *is* the source specifier,
  because `tsc` never rewrites them.
- **The load leg** (`pnpm check:node-esm-load`) builds every published package and then actually
  `import()`s each entry in a child `node`. That is what runs here, and it needs the full build
  this repository has no per-PR copy of — the same trade `published-dist-gate.yml` records above.

Both legs exist because neither is honest alone
([#4538](https://github.com/objectstack-ai/objectui/issues/4538)):

- **Resolving the entry is not enough.** The card was filed from `@object-ui/plugin-charts`,
  whose own emitted entry resolves perfectly; the failure appeared only once evaluation crossed
  into `@object-ui/react`. A check that stops at resolution passes while the tree is broken, so
  the load leg evaluates.
- **The specifier leg cannot see a defect that arrives through a dependency.** In the first full
  run, four plugin packages failed on `packages/mobile/dist/useBreakpoint` — not their file. The
  gate therefore attributes a missing module to the package that *owns* it, so one cause produces
  one finding against one owner.
- **It must never pass vacuously.** "Imported nothing, found nothing" is the verdict this gate may
  never give, so both legs assert a floor on how much they inspected, and a published entry that
  is missing after the build is a finding (`no-build-output`), not a skip.

Packages that still carry the defect are named in the script's `SPECIFIER_DEBT` ledger with a
reason each. The ledger is a ratchet, not a mute button: an entry whose package has become clean
is itself a failure, so it cannot outlive the debt it records. Packages that are not importable
by design — a `bin`-only CLI, or a built web app whose `dist` is `index.html` — are printed on
every run rather than skipped silently.

A separate list, `UNBUNDLED_NODE_UNSUPPORTED`, names the packages plain Node is **not expected
to load at all**. Three style-carrying plugin packages sit there: `@object-ui/plugin-dashboard`
and `@object-ui/plugin-map` import `react-grid-layout`'s and `maplibre-gl`'s stylesheets at
module scope, and `@object-ui/app-shell` reaches the first of those through static imports. All
three resolve fine and then die on `ERR_UNKNOWN_FILE_EXTENSION`, because Node has no loader for
`.css`. That is **a stated product boundary, not debt** — unbundled Node consumption is not
supported for style-carrying plugin packages, ruled on
[#5384](https://github.com/objectstack-ai/objectui/issues/5384) after measuring that no
unbundled-Node consumer exists: every consumer reaches these packages through a bundler (`vite`
in the console and the examples, Next's `transpilePackages` in `apps/site`). The load leg's count
therefore stops short of the total on purpose, and the run prints those three names on every run
rather than quietly subtracting them. Each package says the same thing in its own README, so a
consumer meets the boundary before a red import rather than after one.

The boundary has a price, and the list states it rather than leaving it to be found later: it
matches by **package name**, not by error code, so the load leg cannot speak for those three at
all — a genuine extensionless-specifier regression in one of them would print as a boundary line
instead of failing the run. What guards them instead is the specifier leg, which is a hard
requirement now that `SPECIFIER_DEBT` is empty; [#5357](https://github.com/objectstack-ai/objectui/issues/5357)'s
ablation reverted app-shell's specifiers and watched the specifier leg redden while the load leg
went on printing its ledger line. The ratchet is kept in the other direction too: a named package
whose entry starts loading is itself a failure, because from that moment the exemption costs
coverage and buys nothing.

### Changeset Guard (`changeset-guard.yml`)

**Trigger:** PR to `main`/`develop`, and push to `main`, **when `.changeset/**` changes** — the
inverse of every other workflow's filter. It was carved out of `ci.yml` because `ci.yml` and
`lint.yml` listed `'**/*.md'` and `.changeset/**` under `paths-ignore`, so a PR that added only a
changeset started nothing at all. Since [#3523](https://github.com/objectstack-ai/objectui/issues/3523) such a PR does start both — and every
job in them short-circuits, because `.changeset/**` is still on the in-job ignore list. The check
that has to read the changeset therefore still lives here.

The same `paths:` list also carries the gate's own YAML and both scripts it runs,
`scripts/check-changeset-no-major.mjs` and `scripts/check-changeset-overwrite.mjs`
([#6321](https://github.com/objectstack-ai/objectui/issues/6321))
— self-coverage, not the inverse trigger above: without it, a PR that edits the gate is not the PR
that runs it, and the first real execution lands on someone else's unrelated `.changeset/**` PR.
Deliberately not listed: `scripts/check-changeset-presence.mjs` (the overwrite gate imports its
base-ref resolver, `git diff` wrapper and frontmatter reader rather than growing a third copy —
the second copy, in `check-i18n-en-drift.mjs`, inherited a real defect from that resolver's first
draft and had to be fixed to match under
[#3766](https://github.com/objectstack-ai/objectui/issues/3766); the root vitest suite exercises it
on any PR touching `scripts/**`), `scripts/invoked-as.mjs` (a dependency the gate scripts import, but a
widely shared one — 40+ importers under `scripts/` — that `published-dist-gate.yml`,
`spec-range-floors.yml` and `node-esm-load-gate.yml` also import without listing;
`half-state-patrol.yml` listed it as a documented one-off until
[#10208](https://github.com/objectstack-ai/objectui/issues/10208) moved that sweeper to an objectstack
checkout) and the script's own
`__tests__/check-changeset-no-major.test.ts` (it already runs in the root vitest suite on any PR
that touches `scripts/**`, the same `~ partial` reasoning `published-dist-gate.yml` and
`spec-range-floors.yml` apply to their own gate scripts' `__tests__` files).

Runs `scripts/check-changeset-no-major.mjs`, which fails if any pending changeset declares a
`major` bump. Every publishable package is in one `fixed` group (39 packages), so a single
`major` publishes all of them as the next major — and objectui's major is pinned to the
`@objectstack` major it is compatible with, not to its own count of breaking changes. Score
breaking changes of our own as `minor` and describe the break in the changeset body.

The one release that legitimately bumps the major is the one following `@objectstack` across
its major, and the script admits it by itself, with no switch to set: a `major` on a `fixed`-group
package passes only when the group's current major plus one equals the major of the
`@objectstack/spec` range the group's own manifests declare in `dependencies`,
`peerDependencies` or `optionalDependencies`; every other `major` is refused. In Changesets pre
mode, a changeset that `changeset version` has consumed moves to `.changeset/pre/` and is no longer
read. The script's header is the authoritative statement of the criterion. `pnpm test` asserts
the same repository state, so the rule survives this workflow being skipped.

#### Second job: Changeset Overwrite Report

Runs `scripts/check-changeset-overwrite.mjs`, which asks a different question of the same files:
did this change **modify or delete a `.changeset/*.md` that already existed at its merge base** —
a changeset it did not add? It is a separate job because it reads a diff and so needs
`fetch-depth: 0`, which the bump-policy job does not want.

[#6336](https://github.com/objectstack-ai/objectui/issues/6336) is why it exists. A dev run wrote
its changeset to a hand-picked `changesets`-style name that already existed on `main`, and the
heredoc overwrote an unrelated `@object-ui/plugin-charts: minor`. It was caught before any commit,
but the property that makes it worth a gate is that **the cost lands on a third party and is
invisible at the time it happens**: the agent that picks the colliding name loses nothing, and
whichever earlier PR's release declaration vanishes only discovers it when a package silently
fails to bump. Both signals that should catch it fail — `git status` shows `` M`` rather than
`??`, which reads as your own new file landing, and a deleted release declaration is not something
any later gate flags. With 424 accumulated changesets against an `adjective-animal-verb` name
space, the collision probability is not theoretical.

**It is report-only, and that is measured rather than cautious.** Across all 5281 first-parent
commits on `main`, 12 commits modified a pre-existing changeset (19 files) and **all 19 were
legitimate** — bump levels corrected when the pending release line changed, a "eleven" corrected
to "ten", a typo'd package name fixed, authors amending their own not-yet-released changeset. A
blocking gate would have failed every one of those PRs. Deletions are dominated by the release
itself (82 of 88 delete changesets alongside a package `CHANGELOG.md`, which is `changeset
version` emptying the queue); the job recognizes that shape and says so instead of reporting it.
`OS_CHANGESET_OVERWRITE_ENFORCE=1` flips the job to blocking for whoever revisits this with a new
measurement.

⭐ **The convention that makes the hazard impossible**: name a changeset after the issue it
settles — `.changeset/<issue>-<slug>.md`. The `adjective-animal-verb` names are safe when
`pnpm changeset` allocates them, because it allocates against the files already present; picking
one by hand is what removes that guarantee.

> **A changeset IS now required, by `changeset-presence.yml` — but there is still no
> `skip-changeset` mechanism.** Until [#3387](https://github.com/objectstack-ai/objectui/issues/3387)
> nothing in CI asked whether a PR had added one, and this note said so at length, because the
> opposite had been documented for months: a second workflow inventory at `.github/WORKFLOWS.md`
> — unpinned, therefore free to drift — gave a "Changeset Check" workflow its own numbered
> section, failing any PR touching `packages/` without a `.changeset/*.md` and skippable with a
> `skip-changeset` or `dependencies` label. None of it existed;
> [#3724](https://github.com/objectstack-ai/objectui/issues/3724) deleted the page.
>
> ⚠️ **The label object has been minted here before, and it never did anything.** This note
> used to report a point-in-time labels-API reading (2026-08-08: of the two names only
> `dependencies` existed), and that reading expired, because GitHub mints a label the first
> time one is applied by name — so a single API call that applies it is enough to create it.
> One did: by 2026-08-25 a `skip-changeset` label sat on **seven** pull requests, carrying the
> default grey `ededed` and an empty description that tell an auto-minted label apart from a
> curated one. [#4912](https://github.com/objectstack-ai/objectui/issues/4912) deleted that
> object on 2026-09-09, and ⛔ that deletion is no more durable than the reading it replaced:
> the same single API call re-mints it.
>
> ⛔ **Whether or not you can still see it in the picker, applying it declares nothing** — no
> gate in this repository reads it. The real gate has no label escape hatch by design: its
> exemption is a changeset with an **empty frontmatter**, which lives in the repository where
> the next reader finds it, rather than a label that vanishes from history. The name is wired
> in the `objectstack` sibling, not here, which is how it reaches agents that then look for it
> in this repo. If you were told to apply it, the instruction is wrong; declare an empty
> changeset instead.
>
> The three real things with adjacent names each do something different, and none of them
> subsumes another. `changeset-guard.yml` reads pending changesets and rejects a `major` bump.
> `ci.yml`'s `changeset-check` job (**Changeset Fixed Group Check**) checks `fixed`-group
> *membership*. `changeset-presence.yml` asks whether this change declared anything at all.

### Changeset Presence (`changeset-presence.yml`)

**Trigger:** PR to `main`/`develop`, and merge-queue builds. **No path filter** — see below.
**Blocks a PR:** yes, when a released package's `src/` changed and the PR added no changeset.

Runs `scripts/check-changeset-presence.mjs`, which compares the change against its merge base with
the target branch and asks one question: did anything under the `src/` of a package the release
covers change, and if so, does this change **add** a `.changeset/*.md`?

- **The exemption is an empty frontmatter.** What is demanded is a declaration, once, by the person
  who still knows what the change does — not a release. A changeset whose frontmatter names no
  package is a first-class pass:

  ```md
  ---
  ---

  Test-only change to the grid column resolver; no published behaviour changes.
  ```

- **The changeset must be ADDED by this change.** `.changeset/` accumulates until a release, so "a
  changeset exists in the tree" would be satisfied by somebody else's pending declaration and make
  the gate vacuous for every change that followed one.
- **The guarded surface is derived, not written down.** Every workspace package named in the
  `fixed` group of `.changeset/config.json` contributes its `src/`; everything in `ignore` is
  skipped. That matters more than it sounds: `@object-ui/console` lives at `apps/console`, outside
  `packages/`, and is both the most-edited published package here and the one the platform's
  `bump-objectui.sh` writes a changeset for — a hand-written `packages/*/src/**` glob would have
  missed it. A changed source file whose package is in *neither* list fails the check rather than
  being assumed unreleased; `check-changeset-fixed.mjs` is the gate that owns that classification.
- **Every missing input fails loudly.** An unresolvable base commit, a `git diff` that errors, a
  missing `.changeset/` directory: all red, none a silent pass. Note the direction is the *opposite*
  of the filter gates in `ci.yml` — those decide whether to run work, so "cannot tell" means run;
  here the work *is* the decision, so "cannot tell" means fail. Both refuse to report green having
  looked at nothing ([objectstack#4928](https://github.com/objectstack-ai/objectstack/issues/4928)).
- **No path filter, deliberately**, and it is the point of the whole workflow. A `paths:` filter
  skips the entire workflow, so the context is never created on a PR that does not match — and a
  required context that is never created leaves the PR pending rather than failing it
  ([#3523](https://github.com/objectstack-ai/objectui/issues/3523)). It would also be a second copy
  of the guarded surface, free to drift from the config the script reads.

**A second job — `Changeset Claim Re-read`, report-only.** The same workflow runs
`scripts/check-changeset-claims.mjs` in a job of its own, asking the *opposite* question: not
whether this change declares a changeset, but whether somebody else's **pending** declaration still
describes the tree once this change has touched a file it names. It has no enforcing switch at all,
deliberately — "a pending changeset names a file you edited" is usually still true, and a gate that
failed a build on prose being adjacent is the one triage said would be switched off within a month.
So a finding here never turns the declaration gate's context red. It lives in *this* workflow rather
than beside the other changeset gates in `changeset-guard.yml` because that one carries a `paths:`
filter, and this gate's subject — an ordinary source change that falsifies a pending claim — is
under no obligation to touch `.changeset/**` at all. Run it locally with
`pnpm check:changeset-claims`.

**That finding is delivered onto the pull request, not left in the job log.**
[#9140](https://github.com/objectstack-ai/objectui/issues/9140) re-ran the gate over five live
instances of the shape it exists for: it named four of them, and **none of the four was acted on**.
The finding calls itself a *request to read*, and it was addressed to a job log nobody opens on a
green check. So the job now runs `scripts/check-changeset-claims.mjs --json claims.json`, renders
that hand-off with `scripts/render-changeset-claims-comment.mjs`, and posts it as a comment on the
pull request through `actions/github-script` — the same channel the Console Performance Budget
report uses, on the same existing `pull-requests: write` grant, declared on this job only.

- **One comment per pull request, updated in place.** The job finds its previous comment by the
  first line of the body, which is a plain-text marker rather than the usual hidden HTML comment:
  GitHub deletes tag-shaped fragments from a stored body — an HTML comment alone on the first line
  included — and a marker that vanishes makes every re-run post a *new* comment. See AGENTS.md.
- **A revision that resolves the finding updates the same comment** to say so, rather than leaving
  a stale request at the top of the thread. A pull request with nothing to re-read and no earlier
  comment gets no comment at all.
- **Nothing about enforcement moved.** The step still exits 0 on findings, the job is still not a
  required context, and the comment says both in its own opening lines. Failing a build over prose
  being adjacent is the shape triage fenced, and it stays fenced.

**Why this is separate from `changeset-guard.yml`, which also polices changesets:** that workflow's
trigger is `paths: ['.changeset/**']`, and the inversion is deliberate — on a PR that adds *only* a
changeset, every gate inside `ci.yml` and `lint.yml` short-circuits, so nothing in either of them
ever reads the changeset, and that guard exists to see exactly that PR. (It is *not*, as this
paragraph said until [#4381](https://github.com/objectstack-ai/objectui/issues/4381), that such a PR
"starts no other workflow": since [#3523](https://github.com/objectstack-ai/objectui/issues/3523)
both workflows start and report on it — see **Changeset Guard** above, and the path-filter bullets
at the top of this page.) A PR that **forgot** its
changeset does not touch `.changeset/**` at all, so the one check able to notice was the one check
guaranteed not to run. Widening those paths would have broken the case that guard was built for.
Two workflows, opposite directions: one polices the *level* of a declaration that exists, the other
the *existence* of a declaration at all.

Why it exists: [objectstack#4731](https://github.com/objectstack-ai/objectstack/issues/4731) /
[#4843](https://github.com/objectstack-ai/objectstack/issues/4843) made the declared changesets the
single criterion for which frontend changes shipped, and the premise underneath — published source
changed, so a changeset was written — was enforced by nothing. Replaying this gate over the 80
commits before it landed reports 10 that would have failed, two of them user-visible fixes
(`918888a30` `fix(fields)`, `dcff16e06` `fix(cli,create-plugin)`) that reached a release with no
CHANGELOG line anywhere. `scripts/__tests__/check-changeset-presence.test.ts` pins the verdicts, the derived
surface, and every loud-failure path.

### Changelog Generation (`changelog.yml`)

**Trigger:** manual dispatch only. Nothing triggers this workflow automatically.

Uses [git-cliff](https://git-cliff.org/) with `cliff.toml` configuration to regenerate the root
`CHANGELOG.md` and commit it to the repository. It configured the lockfile merge driver until
[#6358](https://github.com/objectstack-ai/objectui/issues/6358); it no longer does, because this
job never merges. It checks out, runs git-cliff, stages exactly `CHANGELOG.md`, commits and
pushes — and a driver fires only when git has to merge the attributed path. Committing back to a
branch that may have moved does not reach one: such a push is *rejected*, not merged.

**When to run it:** at release time, as part of cutting the release — that is the ritual it
belongs to, and there is no other owner.

The lane also declared `release: types: [published]` until
[#5409](https://github.com/objectstack-ai/objectui/issues/5409), and that half never fired once.
Every release here is authored by `github-actions[bot]`, created by the Changesets action in
`changeset-release.yml` using `secrets.GITHUB_TOKEN`, and GitHub does not start workflow runs from
events raised with that token — so the automated release path structurally cannot wake this
workflow. Measured before the trigger came off: 0 runs across the repository's whole life, against
`changeset-release.yml`'s 4049 through the identical API call. It was removed rather than left
implying an automation that cannot happen.

What follows for readers: the root `CHANGELOG.md` is a **periodically hand-curated summary**, not
an auto-maintained full history. The per-package `CHANGELOG.md` files that Changesets writes on
each release commit are the source of truth for granular and current history.

### Docs Deploy (`docs-deploy.yml`)

Before `vercel build` (whose `installCommand` is a `pnpm i`), the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957).

**Trigger:** a 6-hourly cron (`43 5,11,17,23 * * *`) and manual dispatch. It has no `push` or
pull-request leg.

This workflow is the only way the docs site (`apps/site`, served at objectui.org) reaches
production. It builds the site on a GitHub-hosted runner and uploads the result to the Vercel
project as a prebuilt production deployment, using `vercel pull`, then `vercel build --prod`, then
`vercel deploy --prebuilt --prod`. The CLI version is pinned in the workflow's
`VERCEL_CLI_VERSION`. All three commands run from the repository root, because the Vercel
project's Root Directory is `apps/site`. `apps/site/vercel.json` turns Vercel's Git-triggered
deployments off (`git.deploymentEnabled: false`), so Vercel builds nothing when a branch is
pushed. The same file holds the build command, `pnpm turbo run build --filter=@object-ui/site`
run from the repository root, which is exactly what `ci.yml`'s **Build Docs** job runs. So a green
**Build Docs** on `main` predicts a green build here.

**Why it exists:** [#12178](https://github.com/objectstack-ai/objectui/issues/12178). Vercel build
minutes were nearly the whole Vercel bill, and every production build from 2026-09-06 until that
issue was fixed failed. Runners on this public repository cost nothing.

**Freshness:** the published docs can be up to six hours behind `main`. To publish right away, use
**Run workflow** on the workflow's Actions page (or `gh workflow run docs-deploy.yml --ref main`).

**Failure direction:** a missing `VERCEL_TOKEN`, a run on any ref other than `main`, a failed build
or a failed upload all turn the run **red** with an `::error::` that says which one. None of them
is ever a skipped green, because a silent skip would stop the docs updating with nothing to show
for it. `VERCEL_TOKEN` is given only to the `pull` and `deploy` steps. The build step runs the
workspace install and build, including dependencies' install scripts, without it.

## Repository Maintenance

### Auto-Labeler (`labeler.yml`)

**Trigger:** PR opened, synchronized, or reopened.

Automatically labels PRs based on file path patterns defined in `.github/labeler.yml`. Syncs labels on each push to the PR.

The job holds `issues: write` in addition to `pull-requests: write`. That is load-bearing, not
defensive: `pull-requests: write` alone lets the action attach labels that already exist in the
repository, while creating one it has never seen requires `issues: write`. Because the action
applies the whole label set in a single call, a config rule naming a label that does not yet
exist would otherwise fail the call and leave the PR with **no** labels at all.
`scripts/__tests__/labeler-package-coverage.test.ts` fails if either permission is dropped, and
also if a directory under `packages/` draws no label (objectui#7746).

### Cross-repo Issue Closer (`cross-repo-issue-closer.yml`)

**Trigger:** `pull_request_target` with type `closed`; the job acts only when the PR was actually
merged.

GitHub's closing keywords work **only within a repository**. A PR here whose body says
`Fixes objectstack-ai/objectstack#4475` reads to a human exactly like a same-repo close, merges,
and leaves that issue open forever — with no reference to the PR on the issue's page either. That
is not hypothetical: during v17 verification it happened twice in one day, and both framework
issues had to be closed by hand.

This workflow scans the merged PR body for **qualified** `owner/repo#N` closing keywords (the bare
`#N` form is left to GitHub) and takes one of two visible paths:

| `CROSS_REPO_ISSUE_TOKEN` | Behaviour |
|---|---|
| Configured | Comments on each foreign issue with the PR link, then closes it as `completed`. |
| Absent | Comments **on this PR**, listing every issue that still has to be closed by hand. |

The second path is the point. A workflow that quietly does nothing because a secret was never
provisioned is the same "declared but never enforced" shape both repositories keep having to fix,
so the missing credential announces itself — the run logs the token's presence before any early
return, and the PR comment names the cost.

It uses `pull_request_target` rather than `pull_request` because the latter withholds repository
secrets from fork-originated runs. The usual hazard of `pull_request_target` does not apply here:
the job never checks out the head ref and never executes anything from the PR — it reads the body
and calls the issues API.

### Half-State Patrol (`half-state-patrol.yml`)

**Trigger:** Four times a day at `:37` past the hour (cron `37 1,7,13,19 * * *`), manual dispatch,
or a pull request touching the workflow itself.

Runs objectstack's half-state patrol against **this** repository's issue board. The workflow is a
caller and nothing more: it checks this repository out, sets up Node, and calls the composite action
`objectstack-ai/objectstack/.github/actions/half-state-patrol`, pinned to an objectstack commit sha
([#11174](https://github.com/objectstack-ai/objectui/issues/11174)). The action carries objectstack's
sweeper, `scripts/pm/check-half-states.mjs` in that repository, whose predicates check the dispatch
protocol's label/assignee/PR invariants — a `pm:dispatched` card with no assignee, a card carrying
both `pm:queue` and `pm:dispatched`, a merged PR whose card still says it is in flight, a
`Blocked-by:` block whose blocker already closed, and so on. How the findings are rendered and
delivered, and when a run goes red, belong to the action, whose own header is the authority on them;
this page does not restate them.

**Report-only, and this is a rule rather than a description.** The job never writes a label, never
closes a card, never fixes a state, and no finding fails anything: a completed sweep passes whether
it found 0 half-states or 40. The run goes red when the sweep could not run — the patrol reporting its
own death, not a gate on the board. `permissions:` grants nothing beyond `contents: read` +
`issues: write`, the latter for an anchor write this repository does not ask for (below).

**The pin.** The `uses:` ref is a 40-character objectstack commit sha, never `@main`: `@main` would
adopt whatever landed upstream an hour ago, with no reviewed moment in this repository and nothing to
roll back to. The runner places the whole objectstack repository at the referenced commit, so the pin
freezes the sweeper as well as the action. To bump it, pin objectstack `main`'s tip as read at that
moment and record the sha and the time it was read in the pull request — not the action's own last
commit, which would roll the sweeper back to wherever it stood when the action last changed. The pin
must contain objectstack `79114850f`, where `anchor-optional` was declared. The sha spelling is a
declared exception to the Action Ref Convention above, in that gate's `DECLARED_EXCEPTIONS` table.

**What this repository decides is the step's inputs** — the whole of this install's configuration:

- `github-token` — this workflow's own `secrets.GITHUB_TOKEN`; each install reads and writes its own
  board only.
- `anchor-issue` — passed **empty**, and `anchor-optional` — passed as `true`: together they declare
  that this board has no anchor issue by decision (next paragraph).
- `closed-floor` — `'2026-08-28'`, the dated floor on the sweeper's closed-card reader (further below).

**No anchor issue, and that is a supported configuration**
([#8740](https://github.com/objectstack-ai/objectui/issues/8740)). The maintainer declined the anchor
setup on [#7852](https://github.com/objectstack-ai/objectui/issues/7852), so this board has no pinned
anchor issue, and the workflow says so by name rather than by omission: an empty `anchor-issue` beside
`anchor-optional: true`, the opt-in objectstack declared for exactly this board
([objectstack#20793](https://github.com/objectstack-ai/objectstack/issues/20793), decision A). On a
scheduled or dispatched run the action then sweeps, publishes the rendered findings to the **run
summary**, emits a `::notice::`, skips the anchor write, and **passes**. It will not guess an issue
number and rewrite an unrelated card, and it does not go red for a settled configuration: a check red
on the healthy case trains everyone to ignore red
([#6596](https://github.com/objectstack-ai/objectui/issues/6596)), and before #8740 this one was red
four times a day.

⛔ The opt-in is **empty-only**: a non-numeric `anchor-issue`, or a sweep that could not run, still
fails the run. The accepted cost, stated rather than discovered later, is that findings live only in
run summaries, which notify nobody ([#5791](https://github.com/objectstack-ai/objectui/issues/5791)
measured 58% of this board's machine-readable blocks false, one for a week, in exactly that silence).
A seat reading this board's half-states reads the patrol's run summaries; there is no anchor to read.

⚠️ A pull-request run cannot show any of this: it sweeps, but skips both anchor steps. The first
scheduled or dispatched run after a change to the workflow is the live reading of the opt-in — the
resolve step's `configured=false`, the `::notice::`, the anchor write skipped, and a green run.

**The closed-card floor** ([#5985](https://github.com/objectstack-ai/objectui/issues/5985)).
`closed-floor: '2026-08-28'` holds the sweeper's closed-card reader (`pm:*` labels left on cards that
already closed) to cards closed on or after that cutover. The closed-card window itself is left to the
sweeper's own default, which it exports as `CLOSED_ISSUE_WINDOW_DAYS` rather than being restated
here, a constant copied into prose being a number that rots the moment the export moves.

**Running it by hand.** A seat runs the same sweeper from an objectstack checkout:
`cd ../objectstack && PM_SWEEP_REPO=objectstack-ai/objectui PM_SWEEP_CHECKOUT=../objectui PM_SWEEP_CLOSED_FLOOR=2026-08-28 node scripts/pm/check-half-states.mjs`
— the board comes from `PM_SWEEP_REPO`; the script takes no `--repo` flag and refuses one by name.
That checkout's `main` may be ahead of the pin; check the pinned sha out first to reproduce a
patrol run exactly.

**Why a floor rather than a plain "on".** Stripping `pm:*` on close only became this repo's practice
on the cutover date, and the measurement taken just before it says what an unfloored reader would do
here: 815 closed cards carry `pm:dispatched`, and ~87% of the issues in the default window carried
some `pm:*` residue — against the 26% upstream measured. That predicate would report the
*convention* rather than a defect, and its rows would consume the whole body budget and trim every
other predicate out of the rendered body. Cards closed before the cutover are inert history — the
dispatch loop reads state on open cards only — so judging from the cutover forward buys the row's
whole value with no backfill: no bulk relabelling of closed cards was run, none is owed, and the
sweeper writes no label under any code path ([#5985](https://github.com/objectstack-ai/objectui/issues/5985)).
⛔ Do not move the date earlier without re-measuring: every day it moves back pulls in cards closed
under no convention at all. Until the cutover this install switched the closed reader fully off
through an objectui-only switch; that switch was dropped with the retired copy, not carried into
objectstack ([#10205](https://github.com/objectstack-ai/objectui/issues/10205)).

### Board Snapshot (`board-snapshot.yml`)

**Trigger:** four times a day at `:14` past the hour (cron `14 2,8,14,20 * * *`), manual dispatch,
or a pull request touching the workflow itself — the only path in this repository the run loads, since
the archiver and the modules it imports come from an objectstack checkout
([#10208](https://github.com/objectstack-ai/objectui/issues/10208)).

Checks out `objectstack-ai/objectstack`, runs *its* scripts/pm/board-snapshot.mjs against **this**
repository's issue board (`PM_SWEEP_REPO`; the script refuses a `--repo` flag) and commits what it read
to `board-archive`, an **orphan branch** of this same repository. Why a branch: a suspended GitHub
account loses every issue, pull request and comment it authored, while every branch and commit
survives, because those belong to the repository rather than to a user. The job runs as
`github-actions[bot]`, which is not an account that can be suspended with a person's.

⛔ **Nothing reads `board-archive` for state.** Not a seat, not a patrol, not a gate. Every reading of
the board still goes to GitHub; the archive answers one question, after a loss: what did the record
say? The tool has no write path to GitHub in any mode, and `--restore` *prints* a recreate payload
rather than posting one.

**A run may stop before it is finished, and that is a planned pause.** The job is capped at 800 API
requests — one shared `GITHUB_TOKEN` budget of 1,000/hour covers every workflow in this repository —
so a first full walk spends several runs, writing a phase cursor into the manifest and exiting 0 each
time. It walks the OPEN board to completion first, because the open board is exactly what a suspension
destroys. A real rate-limit refusal stops the run rather than retrying: a loop against a spent budget
starves every other automated caller for the rest of the hour.

**The schedule was re-derived for this repository, and only the minute moved.** The hours avoid the
half-state patrol's `1,7,13,19` because both are heavy board readers on that one hourly budget, and of
the six-hourly sets that avoid it, `2,8,14,20` is the only one whose hours carry no other scheduled
workflow. The minute is `14` rather than upstream's `7`: the merge queue head patrol runs every hour at
`7,22,37,52`, so upstream's minute would collide with it in all four hours
([#9387](https://github.com/objectstack-ai/objectui/issues/9387)).

**A pull-request run writes nothing.** No archive branch is checked out, the snapshot goes `--dry-run`
into the runner's temp dir capped to a handful of numbers, and the commit step is skipped. What it does
prove is the tool on a real runner — and, before that, the archiver's own `--self-test`. A change to the
archiver itself is exercised where it lives: objectstack's lint job runs that self-test unconditionally.

**The Cloudflare R2 mirror is optional and unset is a supported configuration.** After the commit, the
job mirrors the archive checkout to one R2 prefix and, once per UTC day, writes the tree as a tarball
outside that prefix so the `--delete` sync cannot eat the history. Until all four of `R2_ACCOUNT_ID`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` exist as repository secrets the step prints
one `::notice::` and **exits 0**. A *configured* upload that then fails goes red — a backup that
silently stops copying is the failure this whole workflow exists to prevent.

⭐ **The R2 prefix is this repository's name, and it is the one thing an adopter must change.** Upstream
hard-codes its own repository name in the sync target and the tarball key while passing the board it
archives in as `github.repository`. Two repositories aimed at one bucket with the same literal would
share a single `--delete` target and each run would erase the other's objects.

**The workflow is adopted from objectstack; the archiver is objectstack's.** This workflow was adopted
from `objectstack-ai/objectstack` and differs from it in the schedule, the R2 prefix, the header
paragraphs that named gates this repository does not have, and the objectstack checkout it runs the
archiver from. No gate compares it with upstream: the port pin and its parity gate were retired
([#10208](https://github.com/objectstack-ai/objectui/issues/10208)), and drift is found by hand.

**The order of the steps is deliberate.** The commit and the R2 mirror run BEFORE the step that reads
the snapshot's exit code, so a failing count check or a stale-archive verdict never costs the records
the same run archived. ⛔ Do not move the failing step above them — a stale archive is better than none.

### Test Shard Timings Refresh (`test-shard-timings-refresh.yml`)

**Trigger:** weekly (cron `47 6 * * 1`), manual dispatch, or a pull request touching the workflow
or the two scripts it loads (`scripts/test-file-timings.mjs` and the `test-shard-partition` module
beside it).

Regenerates `scripts/test-shard-timings.json`, the per-file durations both `ci.yml` test matrices
are split by ([#12208](https://github.com/objectstack-ai/objectui/issues/12208)), and opens a pull
request with it. `scripts/test-file-timings.mjs select` picks the newest completed `CI` runs on
`main` from the full battery's events (`push` and the hourly `schedule`) whose sixteen test shards
all reported success and whose sixteen `test-file-timings-N` artifacts are all there, at most six;
`gh run download` fetches those artifacts; `scripts/test-file-timings.mjs merge` keeps each file's
median across the runs and writes the file, keyed by a hash of each test path rather than the path
(a file listing every test path would put each retired-spelling pin's own name into the tree its
sweep reads — measured on this pull request's run 38271639400). ⛔ No timing in it is ever written by hand, ⛔ the
workflow never edits `ci.yml` (the width a run's measured total implies is printed by the two test
aggregators on every run, and moving a width is a reviewed edit), and ⛔ it opens no pull request for
a byte-identical file.

**Why a committed file and not an artifact the shards fetch.** Every leg of a matrix computes the
whole partition and keeps its own bin, so every leg of one run must read the same weights. A
committed file guarantees that by sharing the checkout; legs that each fetched "the newest" artifact
could straddle a refresh and run some files twice and others never, every leg green. The committed
file also makes a laptop's sharded run of the suite, leg 3 of 16, run what CI's leg 3 ran, and
because the dataset is in the root vitest config's import closure, the pull request that changes it runs the
full suite on the new split before it lands.

**NOT MEASURED is green.** When no run qualifies — before the first full battery has uploaded its
timings, or after a week of red — the selector exits 3, the job prints a warning naming the reason
and stays green, and nothing is written. A NOT MEASURED that persists is the finding.

**The refresh pull request runs its own CI.** GitHub starts no workflow for an event raised by a
run's `GITHUB_TOKEN`, so until [#13349](https://github.com/objectstack-ai/objectui/issues/13349)
every refresh pull request arrived without CI and waited for someone to push to its branch. The
push and the pull request now go out as the fleet App (`objectstack-fleet[bot]`):
`actions/create-github-app-token` mints a token on the runner from the organization variable
`OS_FLEET_APP_ID` and secret `OS_FLEET_PRIVATE_KEY`, narrowed to this repository and to
`contents`, `pull-requests` and `workflows` write (the force-push moves the branch across any
workflow files `main` changed since the last refresh), and revokes it when the job ends. The job's
own token only reads. ⛔ No personal access token ([#5397](https://github.com/objectstack-ai/objectui/issues/5397)),
and ⛔ no fallback to `GITHUB_TOKEN`: when the credential is not visible to this repository the run
goes red and says so. The branch, `ci/test-shard-timings-refresh`, is this workflow's own and is
overwritten by each refresh, as `changeset-release.yml` does with its version branch.

**A pull-request run writes nothing**, and neither does a manual dispatch on any branch but `main`.
It runs the selection, the downloads and the regeneration, and skips the mint, the push and the
pull request.

### Merge Queue Head Patrol (`merge-queue-head-patrol.yml`)

**Trigger:** every 15 minutes (cron `7,22,37,52 * * * *`) and manual dispatch. No pull-request leg —
see below.

Runs `scripts/check-merge-queue-head.mjs`, which asks one question: **does the entry at the head of
`main`'s merge queue have a `merge_group` build?** A head entry for which GitHub never dispatches
`merge_group` blocks every lane in the repository — a merge queue is strictly ordered, so nothing
behind a head that cannot merge can merge either — and it does so with *nothing red anywhere*, which
is what made the four recorded occurrences so expensive to diagnose
([#7010](https://github.com/objectstack-ai/objectui/issues/7010): 2026-08-17, two on 08-31, one on
09-02; the worst ran four hours).

**How the head is identified.** Each queue entry is a real branch,
`gh-readonly-queue/main/pr-<N>-<base_sha>`, and the head is the one stacked on `main`'s current tip.
The patrol lists those refs, picks the head, and counts `merge_group` runs on it. The ref is taken
verbatim from the refs listing and never assembled: `GET /actions/runs?branch=` answers
`total_count: 0` with HTTP 200 for a branch that does not exist, so a constructed ref one character
off would report a wedge on a healthy queue.

**Only the head is judged, and that is a correctness rule rather than a saving.** GitHub builds only
the first few entries speculatively, so zero `merge_group` runs is the *normal* state of an entry
deep in the queue — one healthy entry measured on 2026-09-05 waited 877 seconds for its first run
simply because it was sixth in line. The head is always inside the build window, which is what makes
zero runs anomalous there and nowhere else.

**The threshold is five minutes**, one named constant (`WEDGE_THRESHOLD_MS`) carrying both of the
boundary readings it sits between: a healthy head dispatches its runs 3–24 seconds after its queue
commit (measured over 18 entries), and the branch ruleset's status-check timeout self-heals a wedge
after about 60 minutes. A suspected wedge is confirmed with a second run count 60 seconds later, so
"wedged for an hour" is never confused with the seconds after a head change.

**Report-only in the queue's direction, red in its own.** The patrol never merges, dequeues, closes
or comments, and it **never opens an issue** — a finding that fired four times an hour would produce
one card per firing for one incident. Its only write is a PATCH of one pinned issue body, when the
repository variable `MERGE_QUEUE_ANCHOR_ISSUE` names one; with the variable unset the run summary and
the job status are the whole delivery, and that is not an error. The job *does* go red on a wedge
(unlike `half-state-patrol.yml`, which is report-only throughout) because the remedy is a human
removing that entry from the queue inside a 60-minute window, and an issue-body edit notifies nobody.
An empty queue, a head too young to judge, and a head that could not be identified all exit 0.

**A reading that could not be taken is never rendered as a healthy queue.** The script refuses its
own verdict (`assertGrounded`) unless the evidence is there: `clear` is unreachable without an
identified head *and* a positive run count. "I could not tell which entry is the head" is its own
verdict with its own wording.

**No `pull_request` leg, deliberately.** Every job of a `pull_request`-triggered workflow produces a
check run, and `scripts/dependabot-merge-gate.mjs` requires every produced name to be classified as
required, optional or not-a-gate. Adding a leg here would mean editing that declaration; instead the
offline `--self-test` runs on every pull request through
`scripts/__tests__/check-merge-queue-head.test.ts`, and the live transport is proven by
`workflow_dispatch`.

⛔ **Why** GitHub declines to dispatch `merge_group` for such an entry is *unestablished*. It is a
repository/Actions-settings reading no agent seat can take, and #7010's triage split it off so the
detection could ship without it. All four recorded heads were Dependabot pull requests, but that is
a correlation the patrol does not encode — Dependabot pull requests have merged through this queue
(`1a4381083`, 2026-08-25), so the failure is conditional and nobody has established on what.

### Required Check Set Patrol (`required-check-set-patrol.yml`)

**Trigger:** daily (cron `23 5 * * *`) and manual dispatch. No pull-request leg — see below.

Runs `scripts/check-required-check-set.mjs`, which asks one question: **is `Type Check` still in the
set of contexts `main`'s merge queue requires?** That set is the defence installed by
[#3523](https://github.com/objectstack-ai/objectui/issues/3523) after the 2026-08-07 incident, and it
lives in repository ruleset 11776024 — GitHub-side configuration. Dropping a member from it reds no
gate, fires no alarm, and leaves no trace in any diff a reviewer reads
([#9422](https://github.com/objectstack-ai/objectui/issues/9422)).

**The reading, and the read/write split it rests on.** The three ordered steps above draw the line
this patrol lives on. The *write* half is unchanged and this patrol does not touch it — it never
enrols, removes or renames a context, and it asks for no write permission at all. The *read* half is
a different question: true of a test in a checkout, false of a job with network.
`GET /repos/{owner}/{repo}/rules/branches/{branch}` answers HTTP 200 with the full rule list,
measured 2026-09-14. So the steps' rule for deciding which contexts *may* be required still stands
(`REQUIRED_CONTEXTS` is a human's answer, and nothing derives it from settings); what this patrol
adds is that the set which *is* required can be observed.

Until [#9502](https://github.com/objectstack-ai/objectui/issues/9502) several sentences in this tree
answered that second question for themselves rather than pointing here — written when the answer was
"no", left standing after a ruleset edit made it "yes". The docblock of
`scripts/check-required-check-set.mjs` inventories them by name, including the one deliberately left
alone and why. ⛔ Do not add another: point at the gate, do not copy its answer.

**Two tiers, because a job rename must not manufacture a red.** `PINNED_CONTEXTS` is `Type Check`
alone — the leg the recorded incident actually failed on — and its absence fails the job.
`WATCHED_CONTEXTS` is the rest of the declared set; their absence is reported in the run summary and
fails nothing, and so is a required context neither list declares. Pinning a name is pinning a
spelling, and a check that goes red on healthy work is how a repository learns to ignore red
([#6596](https://github.com/objectstack-ai/objectui/issues/6596)). The test-shard names were the
riskiest to pin: the 4-way matrix was a shape this repository had already changed once
(`71be244d52`, 2026-07-17), and [#9499](https://github.com/objectstack-ai/objectui/issues/9499)
replaced them with one aggregator context. ⚠️ The accepted cost is stated plainly — a silent removal
of any watched name is *observable*, not *enforced*. Promoting one is a one-line move between the
two lists. Which names the two lists hold is the script's declaration, not this page's.

**The rule TYPES are pinned as well**, and that is not the same kind of claim: `Type Check` being in
a `required_status_checks` rule means nothing if the `merge_queue` rule is gone. A rule type is not a
job name, so no rename can move it.

**An empty answer is a breach, never a clean read.** The endpoint answers `200 []` for a branch no
ruleset targets — measured here against `zzz-no-such-branch-9422` — which is indistinguishable from
"every rule on `main` was deleted", i.e. the 2026-08-07 state. The patrol reports both causes and
passes on neither. The branch comes from `github.event.repository.default_branch` rather than a
literal, so the benign cause is not reachable by a typo.

**What watches the patrol.** Its *logic* is watched offline on every pull request by
`scripts/__tests__/check-required-check-set.test.ts`, which drives the real CLI over a committed
fixture of the live API response with `Type Check` removed and asserts it exits 3, against the
unablated fixture as its control. Its *wiring* — this file, its schedule, its permissions and the
script it calls — is pinned by the same test, and the section and row you are reading are required by
`scripts/__tests__/ci-cd-pipeline-doc.test.ts`. Its *transport* is watched by the exit contract: a
reading that could not be taken is exit 2 and a red job, never a green one. ⚠️ What is **not**
watched, and is declared rather than dissolved: GitHub delaying or dropping scheduled runs, and an
admin disabling the workflow in the Actions UI. Two measurements bound it — the 60-day-inactivity
rule that disables schedules is nowhere near holding (3392 commits to `origin/main` in the last 60
days; longest gap between consecutive commits over the most recent 400 was 0.13 days), and the reader
is stateless, so a dropped tick costs detection latency and never coverage.

**Daily rather than every fifteen minutes**, unlike its sibling above: a settings edit has no
self-healing window, so a second read four minutes later reads the same thing. One run a day is one
API call a day, and the job takes no write permission at all.

**No `pull_request` leg, deliberately**, for the sibling's reason: every job of a
`pull_request`-triggered workflow produces a check run that `scripts/dependabot-merge-gate.mjs` must
classify. ⛔ A `merge_group` leg is ruled out by a sharper one — a check outside the required set does
not gate the queue, and putting *this* check inside it would make the gate that watches the required
set the thing whose silent removal it exists to detect. The set can never be self-watching, which is
what makes an out-of-band clock the right home.

### Hook Self-Tests (`hook-selftests.yml`)

**Trigger:** PR to `main`/`develop`, and push to `main`, **when `.claude/hooks/**` or this
workflow file changes**. **Blocks a PR:** yes.

Runs the hermetic self-test matrices for the PreToolUse guards behind the rules both
`CLAUDE.md` files state as binding: worktree-first, and never `git stash` (AGENTS.md §9). Each
self-test builds its own throwaway git fixture and needs only `jq` and `git`, both preinstalled
on `ubuntu-latest` — no install, no build.

**Discovered at run time, never enumerated**
([#6906](https://github.com/objectstack-ai/objectui/issues/6906)). The single step runs
`find .claude/hooks -type f -name '*.selftest.sh'`, so a new matrix under `.claude/hooks/` is
picked up with **no edit to this workflow** — including one in a subdirectory, which a flat glob
would miss. It used to be one hand-written `run:` step per matrix, and that was this workflow's
own defect one level up: it names itself the standing caller for all of them while a new matrix
shipped uncalled until someone remembered to edit it. Two properties keep discovery honest, and
both are load-bearing: an **empty** discovery is **red** (a step that verified nothing is not a
pass, so a renamed or moved directory cannot degrade the gate into a silent no-op), and the loop
**tolerates and collects** rather than sequencing — a `run:` block executes under `bash -e`, so a
bare loop would abort at the first red matrix and leave the rest unrun, neither green nor red.
The step still fails when any matrix does, and names every one that failed.

Before this workflow ([#5754](https://github.com/objectstack-ai/objectui/issues/5754)), nothing
ran either matrix automatically: a hook is not imported by any package, so no unit test, type
check, or lint reaches it (`eslint.config.js` is scoped to `**/*.{ts,tsx}` throughout, and there
is no `shellcheck` anywhere in this repo), and both self-tests' own headers only say to run them
*after touching the hook* — an instruction with no gate behind it. The failure mode is asymmetric
and both halves are bad: a fail-open regression silently stops guarding the shared checkout, and
a fail-closed regression (a false block) trains an operator onto `OS_ALLOW_MAIN_EDITS=1` /
`OS_ALLOW_STASH=1`, switching the guard off for the whole command. Neither shows up in a PR
without a caller.

**This job is a runner, not a rewrite.** It does not modify the hooks or their self-tests —
`.claude/**` is governed surface. It only gives the existing matrices a caller that fails the
build the moment any one of them goes red, the same way any other required check does.

**Path-filtered, unlike the Control Byte Scan.** That gate carries no `paths` filter because a raw
control byte can land in a markdown-only PR just as easily as a TypeScript one. That reasoning
does not transfer here: the self-tests assert the CURRENT hook script's behaviour against a
fixture they build themselves, so nothing about a docs-only or dependency-bump PR can move the
result. This workflow instead mirrors `changeset-guard.yml`'s inverse-filter shape, firing only
on a PR that touches `.claude/hooks/**` — which is also why `scripts/dependabot-merge-gate.mjs`
classifies **Hook Self-Tests** as `OPTIONAL_CONTEXTS` (present → must be `success`; absent → a
Dependabot bump never touches `.claude/hooks/**`, so it is never waited for) rather than
`REQUIRED_CONTEXTS`, following the same rule `Changeset Bump Policy` and `Bundle Analysis` do.

### Dependabot Auto-Merge (`dependabot-auto-merge.yml`)

**Trigger:** PRs on `main`/`develop` authored by `dependabot[bot]`.

- **Patch/minor updates**: approved and enqueued — **but only after an explicit wait**, see below.
- **Major updates**: commented for manual review; never approved, never enqueued.
- Configures **no** lockfile merge driver ([#6369](https://github.com/objectstack-ai/objectui/issues/6369)):
  its only merge is `gh pr merge`, which GitHub runs server-side, where the runner's git config
  cannot reach.

**The wait, and why it exists.** This workflow used to run `gh pr merge --auto --squash`
unconditionally for every patch/minor bump. `--auto` lands the merge as soon as GitHub considers
the PR mergeable — that is, as soon as the *branch-protection required set* is satisfied, which is
a different set from "the checks this repository runs". On 2026-08-17 the difference put a red
commit on `main`: [#4959](https://github.com/objectstack-ai/objectui/issues/4959) merged at
08:13:36Z with nine of its nineteen check runs still in flight, and shard 3/4 then reported
`failure` at 08:21:01Z, shard 1/4 at 08:21:56Z. The test shard matrix is the slowest job
here **by construction** — it exists to cut a ~9 minute wall clock — so it is the check `--auto`
systematically outruns, and the resulting red `main` blocked every parallel agent until
[#4968](https://github.com/objectstack-ai/objectui/issues/4968) repaired it. It was the second
time in seven days ([#4098](https://github.com/objectstack-ai/objectui/issues/4098)).

So the wait is now explicit and this workflow owns it
([#4973](https://github.com/objectstack-ai/objectui/issues/4973)):
`scripts/dependabot-merge-gate.mjs` polls the Checks API for the pull request's head SHA until
every context it declares has reported `success`, and only then may the two mutations — approve,
enqueue — run. The declared set is the unfiltered blocking contexts (**Test** — since
[#9499](https://github.com/objectstack-ai/objectui/issues/9499) the single aggregator context that
reports for the sixteen test shards and the dist-pin job — **Type
Check**, **Lint**, **Build & E2E**, **Build Docs**, **Repo Gates** — one context for the fifteen gates
[#12214](https://github.com/objectstack-ai/objectui/issues/12214) folded into one job — and the rest of
`REQUIRED_CONTEXTS`); the
path-filtered ones (**Bundle Analysis**, **Changeset Bump Policy**, **Hook Self-Tests**) must be
green *if they reported*; everything else is listed with the reason it cannot gate. A context that is missing,
still running at the deadline, or anything other than `success` is **not** green: nothing merges,
the job goes red, and a comment on the PR names what refused.

Two properties are worth keeping in mind when editing it:

- The gate does **not** ask GitHub which checks are required. That set is a repository-settings
  surface nothing here can **change** (see the three ordered steps under
  [Merge Queue](#merge-queue)); it can be *read*, and
  [Required Check Set Patrol](#required-check-set-patrol-required-check-set-patrolyml) reads it
  daily. Delegating to it anyway would reproduce the hole for a reason that survives every ruleset
  edit: the required set is the *narrower* of the two — a subset a maintainer chose, changeable
  off-repo with no diff — while the wait declared in `scripts/dependabot-merge-gate.mjs` covers
  every unfiltered blocking context this repository produces, and a test holds it to that.
- It does **not** replace `--auto` with a direct merge. `main` is behind an enforced merge queue,
  where a direct merge is rejected with 405; enabling auto-merge *is* the enqueue action. What
  changed is that it happens after the check set is green on that SHA, not 29 seconds after the
  shards started.

`scripts/__tests__/dependabot-merge-gate.test.ts` holds both halves: it replays #4959's measured
check-run timeline and asserts the gate says `pending` at the instant of the old merge and `red`
once the shards report, and it asserts the declared buckets partition exactly the set of check
names that `pull_request`-triggered workflows produce — so a renamed or added job fails that test
instead of quietly dropping out of the wait.

### Shadcn Component Check (`shadcn-check.yml`)

Before its install, the job restores the pinned `@objectstack/*` build from the cache keyed by `.objectstack-sha`, or builds it on a miss with `scripts/objectstack-pin.mjs` — every `@objectstack/*` package resolves to that build, not to npm (objectui#12957; the mechanism is that script's header).

**Trigger:** Weekly on Monday at 9:00 AM UTC, or manual dispatch. Nothing here blocks a merge — it
runs on a schedule, and its alarm is an issue rather than the job colour.

Three first-party commands, in this order:

- `pnpm shadcn:analyze` — the offline analysis of the vendored shadcn/ui components. Its exit code is
  captured rather than tolerated: the one non-zero it can produce is an uncaught crash, and a crash
  on a weekly schedule goes red where nobody looks.
- `pnpm shadcn:check` — the online half, 46 serial registry requests. It exits non-zero for one
  reason only, a declared local patch that is missing or no longer applies; ordinary drift and an
  unreachable registry both stay exit 0 by design, because this gate must only ever accuse real
  drift.
- `node scripts/shadcn-check-report.mjs` — classifies both exit codes, the cross-run registry streak
  and the step summary, and renders the issue body. It exits 0 for every *classified* outcome,
  alarms included; it going red means the classifier itself crashed. It is covered by
  `scripts/__tests__/shadcn-check-report.test.ts`.

The job then creates or updates a single tracking issue when the classifier raises an alarm, and
uploads the analysis artifacts for reference.

## Lockfile Merge Driver

⭐ **Contributor-facing, with zero CI consumers.** It had exactly one CI consumer,
`changeset-release.yml`, and that one was measured dead before it was removed
([#6436](https://github.com/objectstack-ai/objectui/issues/6436), ruled 2026-08-27). What is left
is live, repository-wide, and takes place entirely on contributors' machines — CI has no part in
it.

`pnpm-lock.yaml` is never merged line by line — it is regenerated. `.gitattributes` asks for
that:

```
pnpm-lock.yaml merge=pnpm-merge
```

⚠️ **An attribute names a driver; it does not define one.** Git ships no `pnpm-merge` driver, and
an attribute naming a driver nothing defines falls back to an ordinary text merge. The definition
lives in each contributor's own git config, and `CONTRIBUTING.md` is where they are told to add
it, under **Configure Git Merge Driver for pnpm-lock.yaml**:

```bash
git config merge.pnpm-merge.name "pnpm-lock.yaml merge driver"
git config merge.pnpm-merge.driver "pnpm install"
```

That is the entire live mechanism — the attribute in the repository, the definition on the
machine — and it fires on the `git merge upstream/main` that the same page tells contributors to
run. Measured in a scratch repository with one variable changed between two runs: **with** the
attribute the driver fires and the lockfile is regenerated; **without** it, nothing else altered,
the identical merge ends in `CONFLICT (content)` with conflict markers left inside
`pnpm-lock.yaml`.

⭐ **Why the live half is worth more than the CI half ever was.** A lockfile carrying conflict
markers is a high-blast-radius artifact that fails far from its cause, and hand-resolving one —
by a person or by an agent — is precisely the edit nobody can review line by line. Letting the
package manager regenerate the file instead makes that whole class of error structurally
unreachable.

**No workflow configures the driver**, and none should unless it gains a merge that git carries
out **on the runner**:

| Workflow | Why it needs the driver |
|---|---|
| _(none)_ | No workflow performs a local merge, so none gives the driver an occasion to fire |

`scripts/__tests__/ci-cd-pipeline-doc.test.ts` pins that table against the workflows that
actually configure the driver, in both directions — a workflow that gains the step without a row
is as red as a row whose workflow lost it. It is pinned because the claim had already drifted two
ways at once, and neither copy was checked by anything: this page named `changeset-release.yml`
and `dependabot-auto-merge.yml`, while the deleted `.github/WORKFLOWS.md` named
`changeset-release.yml` and `changelog.yml`. Each was missing a different one
([#3724](https://github.com/objectstack-ai/objectui/issues/3724)).

⚠️ **That pin no longer proves the mechanism is alive, so something else has to.** While a
workflow still configured the driver, "at least one workflow configures it" doubled as the guard
that the table's grep had actually matched something. Zero is now the correct answer, so the same
test instead asserts the two halves that remain load-bearing: that `.gitattributes` still routes
`pnpm-lock.yaml` through the driver, and that `CONTRIBUTING.md` still tells contributors to define
it. If either of those goes, the mechanism really has no consumers and this section should go with
it — but that is then a measured conclusion rather than a silent one.

Adding a workflow that merges **locally** — a merge git performs on the runner? Add the
configuration step after checkout and before the merge, and add its row to the table above — the
pin fails otherwise. It would need `--no-frozen-lockfile` in the driver command, because Actions
sets `CI=true`, under which pnpm refuses to modify the lockfile, and a driver that cannot write
the file it exists to rewrite would fail the merge it was installed to resolve. That default is
off locally, which is why contributors configure the same driver with a plain `pnpm install`.

The "does this workflow merge?" question has been read too widely three times, and each reading
left a dead copy behind:

⛔ **Pushing is not merging.** This sentence said "merges or pushes" until
[#6358](https://github.com/objectstack-ai/objectui/issues/6358): `changelog.yml` carried the step
on the strength of that word, having no merge to resolve. A workflow that only commits and pushes
needs no driver, and giving it one buys nothing while implying a lockfile hazard it does not have.

⛔ **A server-side merge is not a local one.** `dependabot-auto-merge.yml` carried the step until
[#6369](https://github.com/objectstack-ai/objectui/issues/6369) for a merge it genuinely performs
— `gh pr merge`. But GitHub executes that one itself, not on the runner, so no local git config
takes part in it.

⛔ **A rewrite is not a merge, and a force-push resolves none.** `changeset-release.yml` carried
the step on the strength of "version bumps rewrite the lockfile"
([#6391](https://github.com/objectstack-ai/objectui/issues/6391)), and was the last workflow to
carry it. Regenerating a file is not reconciling two versions of it, and the version branch is
updated by `reset --hard` plus a force-push inside `changesets/action`, which merges nothing on
the runner. Removed by [#6436](https://github.com/objectstack-ai/objectui/issues/6436).

## Toolchain Setup (`scripts/ci-setup-pnpm.sh`)

Every workflow that runs `pnpm` calls this one script, as its first step after checkout:

```yaml
- name: Enable Corepack and download the pinned pnpm
  run: bash scripts/ci-setup-pnpm.sh
```

pnpm is **not** on the GitHub runner. It arrives through Corepack, which downloads the
version pinned in the root `package.json`'s `packageManager` field from
`registry.npmjs.org` the first time anything invokes `pnpm`. That download is a network
read on the hot path of 13 workflows, and it has failed:
[#8099](https://github.com/objectstack-ai/objectui/issues/8099) records a job that died
inside undici ten seconds in, reddening the **required** check `README Export Check` on a
one-file prose diff. Re-running the same head with no code change turned it green.

The script does two things a bare `corepack enable` does not:

- **It puts the download where a reader can see it.** `corepack enable` only writes the
  shims; the *first pnpm invocation* is what downloads. Left implicit, that lands wherever
  each workflow happens to touch pnpm first — including inside `actions/setup-node`'s
  `cache: 'pnpm'` store probe, where a red is hardest to attribute to the toolchain rather
  than to the diff under test.
- **It retries the read, bounded.** Four attempts with a 5s/10s/15s backoff, each retry
  emitting a `::warning::` annotation that says the failure is the toolchain download and
  not the diff.

⛔ It does **not** remove the dependency on `registry.npmjs.org` — a sustained registry
outage still reds these jobs. It bounds a transient read, which is the failure that was
actually observed.

Two workflows mention `corepack enable` in comments only and must stay that way:
`changelog.yml` and `dependabot-auto-merge.yml`, the latter recording
[#6392](https://github.com/objectstack-ai/objectui/issues/6392)'s ruling that removed the
step because nothing in that job calls pnpm.

## Adding a New Workflow

> **Give it a section on this page in the same PR.** Not a convention — a test.
> `scripts/__tests__/ci-cd-pipeline-doc.test.ts` reads `.github/workflows/` and fails when a
> workflow has no heading here naming its file. Three workflows (`lint.yml`,
> `cross-repo-issue-closer.yml`, `changeset-guard.yml`) went undocumented for months precisely
> because nothing checked, and one of them is a PR gate.

1. Create a new `.yml` file in `.github/workflows/`.
2. Copy the pnpm + Turbo setup from a workflow that runs today, not from a snippet on this
   page. A copied YAML block is a fossil the moment it is pasted — this page used to keep
   one here, and every line of it had drifted: `actions/setup-node@v4` where every workflow
   now uses `@v7`, a hardcoded `node-version: 20` where every workflow declares 22
   (and 20 sat below the floor the root `package.json`'s `engines` field now declares), and
   `pnpm/action-setup@v4`, which no workflow in this repository has ever used — pnpm comes
   from Corepack plus the root `packageManager` field instead, through
   `scripts/ci-setup-pnpm.sh`.

   `repo-gates.yml` (see the **Repo Gates** section above) is a good one to read: it runs on
   every pull request, and its setup is the complete pattern most new
   build/test/lint workflows need — checkout, the shared pnpm setup, `actions/setup-node`
   with pnpm's own cache, `pnpm install --frozen-lockfile`, then a `turbo run build` step
   for whatever it needs built. Two of its steps hold for any workflow no matter which Node
   or pnpm version the repository is on when you read this:

   ```yaml
   - uses: actions/checkout@v7
   - run: bash scripts/ci-setup-pnpm.sh
   ```

   The second line is not optional and not a style choice — see
   [Toolchain Setup](#toolchain-setup-scriptsci-setup-pnpmsh) below.
   `scripts/__tests__/ci-setup-pnpm-wiring.test.ts` fails a workflow that runs `pnpm`
   without it, and fails one that spells `corepack` in a `run:` step directly.

   Copy everything else — the Node version, the cache key, the install command — from the
   workflow itself, not from this page.

3. Use Turbo for any build/test/lint steps to leverage caching:

```yaml
- run: pnpm turbo run build --filter=@object-ui/core
```

4. For PR workflows, consider adding path filters to avoid unnecessary runs:

```yaml
on:
  pull_request:
    paths:
      - 'packages/**'
      - 'pnpm-lock.yaml'
```

5. Add a section for it under the right heading on this page, and a row to the
   [inventory table](#workflow-inventory). State the display name if it differs from the file name,
   and say plainly whether it can block a merge.

## Environment Variables and Secrets

| Secret / Variable | Used By | Purpose |
|-------------------|---------|---------|
| `GITHUB_TOKEN` | All workflows | GitHub API access (automatic) |
| `NPM_TOKEN` | `changeset-release.yml` | npm package publishing |
| `OS_FLEET_APP_ID` (variable), `OS_FLEET_PRIVATE_KEY` (secret) | `test-shard-timings-refresh.yml` | Mint the fleet App token the refresh pushes its branch and opens its pull request with, so that pull request runs CI. Both are **organization**-level. If either is not visible to this repository, the run fails red. |
| `CROSS_REPO_ISSUE_TOKEN` | `cross-repo-issue-closer.yml` | Closing issues in sibling repositories. `GITHUB_TOKEN` cannot do this — it is scoped to the repository running the workflow. When absent the workflow reports instead of closing. |
| `VERCEL_TOKEN` | `docs-deploy.yml` | Vercel API token for the Object Stack team, used by `vercel pull` and `vercel deploy`. It is stored as an **organization** secret. If it is missing, the run fails red. |
| `TURBO_TOKEN` | Build workflows | Turbo remote cache authentication |
| `TURBO_TEAM` | Build workflows | Turbo remote cache team identifier |

Secrets are configured in the repository settings under **Settings → Secrets and variables → Actions**.
