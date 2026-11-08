# @objectstack/scenarios

Published, with a command line: `npx @objectstack/scenarios run` (below, "Running from npm").
The schema (zod) and loader for the open scenario library under
[`docs/qa/scenarios/`](../../../docs/qa/scenarios/README.md) — that README is the format's
reference.

```ts
import { loadScenarios, readCapabilityAreas, formatRefusal } from '@objectstack/scenarios';

const areas = readCapabilityAreas('docs/qa/platform-checklist/areas');
const { cards, refusals } = loadScenarios('docs/qa/scenarios', { areas, library: 'open' }); // 'overlay' refuses a generic card
for (const r of refusals) console.error(formatRefusal(r)); // FILE: FIELD.PATH: message
// cards[i].truths[questionId] → the question's computed truth
```

- `src/schema.ts` — the card shape, one strict zod object per layer.
- `src/truth.ts` — evaluates a declarative truth spec over seed rows; refuses a truth the
  seed does not determine.
- `src/loader.ts` — reads a directory of cards, validates shape and cross-references, holds
  a `starter` or `delivery` card to the gallery floor (`GALLERY_FLOOR`; the tiers are in the
  format's README), refuses a `generic` card loaded as the private overlay and a
  `customer-derived` or `held-out` card loaded as the open library (`library`; the origins are
  in the format's README), and returns typed cards or located refusals.

The private overlay's owner migrates its cards to each new card shape (today: `origin` and the
`{ zh, en }` title); the loader keeps no lenient conversion for an old shape.
- `src/score/` — the deterministic scorer, entries `@objectstack/scenarios/score` and
  `@objectstack/scenarios/score/full` (below).

`pnpm --filter @objectstack/scenarios build` (tsup) writes `dist/` as ESM, CJS and `.d.ts`, and
every `exports` subpath points there, so plain Node loads the package with no TypeScript resolver.
The build then copies the open library into `dist/library/` (`scripts/pack-library.mjs`), which
the published command line runs. The suites and `run-scenarios` read `src/` directly. The schema,
loader and scorer call no model and no network; the runner drives a local Claude Code session.

## Scoring a run against a card — `@objectstack/scenarios/score`

`@objectstack/scenarios/score` is the narrow entry (`src/score/narrow.ts`): the graph-shape
scorer (`scoreGraphShape`, `artifactToEvalGraph`), the item-name check and the run and
operation graders. Its import graph reads `@objectstack/core` and `@objectstack/spec` only
(pinned by `test/build/`). `@objectstack/scenarios/score/full` (`src/score/index.ts`) adds the
capability-tag checks, which read `@objectstack/objectql` and `@objectstack/plugin-sharing`, and
the card-level functions below.

Every card-level function takes a card the loader returned, so it judges against the loader's
computed truths and declared outcomes:

```ts
import { gradeCardAnswer, gradeCardOperation, scoreCardArtifact } from '@objectstack/scenarios/score/full';

scoreCardArtifact(card, artifact);                 // a built dist/objectstack.json: expect, tags, agent actions
gradeCardOperation(card, 'remove_ben', observed);  // an observed write against its declared outcome
gradeCardAnswer(card, { question: 'account_count', persona: 'sdr', turn }); // an agent's answer
```

- `scenario-score.ts` — `expect` scored by exact name and by shape; `scenario-graph.ts` reads
  the artifact into the graph both score.
- `scenario-tags.ts` — the capability-tag checks and the agent-action exposure check (each
  declared action exists on its object, carries `ai.exposed: true`, and carries
  `ai.requiresConfirmation: true` where the card says `confirm`; a missing action fails, never
  skipped).
- `scenario-operation-grade.ts` — an observed write against `applied` / `refused` /
  `pending_confirmation`; a fact the observation does not carry fails. The operation the
  card's `write_validation` guardrail names is graded in two halves: the agent half (its write
  was refused with the declared code, or it wrote nothing and its reply declines the write or
  asks for a correction) and the platform half, `platform:` checks (the runner's own write of
  the declared values, the probe, was refused with that code and stored nothing); so is every
  other `refused` create or update, permission oversteps included (`isProbedOperation`). A
  declared `VALIDATION_FAILED` is met by an app-defined code at a validation-class status
  (`refusalMeets`), and a declared value equal to the card's `asOf` by the run date, only in a
  field none of the agent's own write calls set (`agentSet`: the platform's clock stamped it).
- `scenario-run-grade.ts` — an answer graded on correct / cited / leaks, per persona against
  that persona's truth; a `withheld` truth is must-not-reveal. A figure computed over rows
  outside the persona's scope is flagged only when no figure of the persona's own rows
  (`scopeFigures`) equals it, and a hidden field leaks when a tool answer's keys carry it, not
  when a call only asked for it.

### The closed capability-tag table

A card's `capabilities` tag scores only when it is one of these, spelled exactly. Any other
tag is reported **`unscored`** — listed, counted neither as passed nor in the total, never a
pass — and so is a row whose card gives it nothing to judge (a field-permission tag on a card
whose personas hide no field). To score a new tag, add a row to `CAPABILITY_TAG_CHECKS` with a
discrimination test; ⛔ never match by area prefix.

| Tag | Passes when the built artifact… |
|:---|:---|
| `records-forms.lookup` | carries a lookup field, and every lookup field resolves to an object the build or the platform serves |
| `records-forms.master-detail-inline-edit` | has every master-detail field resolving, and one of them edited inline on its master (`inlineEdit`) |
| `records-forms.roll-up-summary` | carries a roll-up summary, each reading a child object that relates back and, unless it counts, a child field that exists |
| `records-forms.select-options` | carries a single-choice option field (`select`, `radio`), each offering at least two options |
| `records-forms.formula-field` | carries a computed field (a `formula` field, or a stored field with an `expression`), each expression compiling at `record` scope against its object's columns |
| `records-forms.validation-rule` | carries an active, refusing (`severity: 'error'`) validation rule on an object the card names, every rule's predicates (nested ones included) compiling against its object |
| `access-security.field-permissions` | denies (`readable: false`, in a permission set) every field a card persona hides, and has that field |
| `access-security.row-scope` | keeps every object a persona's `scope` names private (owner-scoped) or derived from its master, or narrows it for each such persona by a read policy (`rowLevelSecurity`, `select` or `all`, no `positions`, a `using` that is not `true`) on that persona's permission set |
| `access-security.row-level-security` | keeps every object a persona's `scope` names to that persona by a route that enforces: private, a detail whose master is itself kept so, or a narrowing read policy on its permission set; and every read policy that applies there lowers to a query filter |
| `approvals.approval-flow` | carries an approval (a flow with an Approval node), each bound to an object it serves, one bound to an object the card names |
| `approvals.multi-step-approval` | carries an approval flow, bound to an object the card names, in which a second Approval node follows the first on its `approve` branch |
| `approvals.dynamic-approver-routing` | routes an Approval node of a flow bound to an object the card names to an approver read off the record (`field`, `manager`, `expression`), each one able to name someone: a field holding a user, an expression over `current` / `trigger` / `vars` |
| `automation.record-triggered-flow` | carries a record-triggered flow, each bound to an object it serves, one bound to an object the card names |
| `dashboards.widget-measures` | carries a dashboard widget with a measure, and every widget measure resolves on the dataset it binds |
| `dashboards.report` | carries a report whose dataset binds an object the card names, every report selecting only measures and dimensions its datasets declare |
| `ai.agent-actions` | carries every action in `run.agentActions` on its object, AI-exposed and confirm-gated where the card says `confirm` (the agent-action checks) |

## Running the cards in a Claude Code cloud session

The runner below also runs in a Claude Code cloud session, under these settings:

- **Repository**: objectstack-ai/objectstack alone. The runner and the cards live here, and a generated app installs
  the published packages from npm (`create-objectstack@latest` unless `--create-version` says otherwise);
  objectstack-ai/cloud is not needed.
- **Login**: the container's `claude` CLI is logged in with the subscription (`claude auth status` reports
  `oauth_token`). The live driver refuses an API-key login, and refuses to start while `ANTHROPIC_API_KEY` or
  `ANTHROPIC_AUTH_TOKEN` is set, so unset both.
- **Permission mode**: not Auto. Auto mode's classifier refuses to launch the headless `claude -p` the runner spawns;
  use Accept edits and approve the command.
- **Time**: a background command is capped at 2 hours. Run one `starter` card per command (`--only ID`): its build
  takes about 20–30 min, then come the Run halves. For more, run two commands in parallel (each boots its app on a free
  port); do not chain several `starter` cards in one command.
- **Build first**: `pnpm install`, then `pnpm --filter '@objectstack/scenarios^...' build`. The runner reads its own
  `src/` but its dependencies' `dist/`, so on a fresh checkout `run-scenarios` stops at `ERR_MODULE_NOT_FOUND` on
  `@objectstack/spec/dist/…` and the suites at `Failed to resolve entry for package "@objectstack/types"`.
- **Network**: npm must be reachable (the default): the scaffold runs `npx -y create-objectstack@…`.
- **Cost**: the session's subscription quota.

```bash
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
claude auth status                                     # oauth_token
pnpm install && pnpm --filter '@objectstack/scenarios^...' build
pnpm --filter @objectstack/scenarios run-scenarios --only leave_balances   # one starter card per command
```

## Running the cards — `@objectstack/scenarios/runner`

```bash
pnpm --filter @objectstack/scenarios run-scenarios                       # every card, both modes
pnpm --filter @objectstack/scenarios run-scenarios --only service_desk --modes scratch
pnpm --filter @objectstack/scenarios run-scenarios --record /tmp/rec.json  # also save every turn
pnpm --filter @objectstack/scenarios run-scenarios --driver recorded:/tmp/rec.json  # replay, no model
pnpm --filter @objectstack/scenarios run-scenarios --driver codex           # the Codex CLI on your ChatGPT plan
pnpm --filter @objectstack/scenarios run-scenarios --driver external:./my-agent.mjs  # any command on the driver contract
pnpm --filter @objectstack/scenarios run-scenarios --author-timeout 90       # minutes per authoring turn (default 60)
pnpm --filter @objectstack/scenarios run-scenarios --author-max-turns 400    # turns per authoring turn, every card (default by tier)
pnpm --filter @objectstack/scenarios run-scenarios --ask-max-turns 20        # turns per question or operation turn (default 12)
pnpm --filter @objectstack/scenarios run-scenarios --model sonnet            # the model every turn asks for (default: the login's own)
pnpm --filter @objectstack/scenarios run-scenarios --author-model opus --ask-model haiku  # build and persona turns apart
pnpm --filter @objectstack/scenarios run-scenarios --packages workspace      # on this checkout's unreleased packages (default: published)
```

Per card and mode the runner writes `docs/qa/platform-checklist/runs/<date>-scenario-<card>.json`
(git-ignored) and prints the scorecard.

### Running from npm

No checkout needed: the package's `objectstack-scenarios` command is the same runner, with the same flags.

```bash
npx @objectstack/scenarios run --only service_desk --modes scratch   # one card, scratch mode
npx @objectstack/scenarios run                                       # every card, both modes
npx @objectstack/scenarios run --cards ./my-cards                    # a directory of your own, loaded as the overlay
npx @objectstack/scenarios help                                      # the commands; `version` prints the package version
```

- **Prerequisites**: Node 22 or later, and Claude Code installed and logged in with your own subscription
  (`claude auth login`). The runner refuses to start when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set, or the
  CLI is logged in with an API key. Each card scaffolds a project with `create-objectstack` (`--create-version` picks
  its version).
- **The cards**: the package carries the open library of this repository (`docs/qa/scenarios/*.json` and the
  capability areas, copied into `dist/library/` at build time) and nothing else. `--cards DIR` runs another directory
  as the overlay, where a `generic` card is refused.
- **The records**: one `scenario-runs/<date>-scenario-<card>.json` per card, under the directory you run it from,
  unless `--out DIR` says otherwise; the scorecard is printed as in a checkout. `--work DIR` keeps the scaffolded
  projects (default: a temp directory).
- **The packages**: always the published ones (`--packages published`, the default). `--packages workspace` builds
  and packs a checkout's packages, so the published CLI refuses it; run it from a checkout.
- It is not an `objectstack` (`os`) command: scenario scoring stays out of the customer CLI.

| Mode | Steps |
|:---|:---|
| `scratch` | `create-objectstack` → the agent builds from the card prompt and the runner's data contract (`prompts.ts`) → `objectstack validate` / `build` / `verify` (proofs chosen from the tags) → score → `objectstack dev --fresh` → seed, one user + permission-set grant + API key per persona → every question as every persona it names and every operation as its persona, over the app's MCP → the iterate change → rebuild, re-score, re-run |
| `template` | a blank host project (`host<code>`) → boot → install the card's verified build **unmanaged** (`/api/v1/marketplace/install-local`, `installMode: 'unmanaged'`) → the agent applies the iterate change to the installed copy → score → seed → Run. A refused install is a finding in the record |

- **Package source** (`packages.ts`, `--packages`): `published` (the default) scaffolds with `npx -y
  create-objectstack@<version>` and installs from npm, what a customer gets. `workspace` measures the next release before
  it ships: it builds what the release builds for the packages it publishes (every non-private `@objectstack/*` and
  `create-objectstack`, `turbo run build build:dist`), `pnpm pack`s each — the tarball npm would serve, `files[]` only —
  and scaffolds with the packed `create-objectstack`, whose own install a global pnpmfile points at the tarballs. The
  tarballs are then kept as `overrides` in the project's `pnpm-workspace.yaml` (a later `pnpm add` stays on them), and the
  scaffold is refused unless every `@objectstack/*` package came from a tarball and `.claude/skills/` equals the
  workspace build's catalog (`packages/skills/dist/skills`) file for file. Every record (`env.packages`,
  `env.packagesLine`) and scorecard states the source: `packages: published 18.3.0`, or `packages: workspace @ <sha>
  (unreleased)`. ⛔ The gallery exporter exports only a `published` run: a `workspace` record, or one that states no
  source, is refused.
- **Driver** (`driver.ts`): the local `claude` CLI on your own login (`claude -p --output-format stream-json`, the
  prompt written to its stdin: a build prompt carries the whole seed, and one argv string over 128 KiB makes `spawn`
  fail with `E2BIG` on Linux). It refuses to start when `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` is set or the CLI
  is logged in with an API key (the cost ruling on cloud#3600), and the record states the driver, the login, the
  authoring timeout and the turn caps. Every turn records its process: elapsed time, the turn cap it ran under
  (`--max-turns`), and for a turn that did not finish its exit code or signal, whether the runner's timeout killed it,
  and the end of its stderr. `RecordedDriver` replays a recording, and refuses the live-driver limits and models below;
  its record keeps the driver of the recording (`replayOf`). For Codex and any other agent tool, see
  [Other agent tools](#other-agent-tools--codex-and-the-external-driver-contract).
- **Model** (`driver.ts`): `--model M` passes `claude --model M` on every turn, an alias (`sonnet`) or a name
  (`claude-sonnet-4-5`); `--author-model` sets the authoring turns (build and iterate) and `--ask-model` the question
  and operation turns apart, each in place of `--model`. With none, a turn takes the login's default model. Every turn
  records the model it asked for (`requestedModel`) and the one it was served, read off the stream's init line
  (`model`); a served name that does not hold the requested one as whole dash-separated parts (`sonnet` is in
  `claude-sonnet-4-5-20250929`, `opus` is not) is a mismatch (`modelMismatch`). The scorecard's author rows name the
  served model (`⚠ asked for sonnet` on a mismatch), and its `Run · model` rows count the persona turns per served
  model (`claude-opus-5-5 ×9 ⚠ 9 not sonnet`).
- **Turn caps** (`driver.ts`): an authoring turn, build and iterate alike, may take `DEFAULT_AUTHOR_MAX_TURNS` by the
  card's `tier` — `control` 80, `starter` 300, `delivery` 600 — unless `--author-max-turns N` sets one cap for every
  card; a question or operation turn takes 12 unless `--ask-max-turns N` says otherwise. The cap guards a looping turn
  and `--author-timeout` a slow one, whichever comes first: the `starter` builds measured ran 11–18 s a turn, so the
  60-minute default holds 200–325 of them and both limits bind at about the same point. A `delivery` card's 600 turns
  outlast that default; raise `--author-timeout` with it.
- **A build that did not finish is not measured** (`orchestrate.ts`): an authoring turn the timeout killed
  (`--author-timeout`, build and iterate alike) leaves its Build half **not measured: author timed out after N min**;
  one that ended with no result line or an error result (`error_max_turns`, `is_error`), or never ran, leaves it **not
  measured: author turn failed: …**. Never a degraded score, and nothing runs on it: no score, seed, Run or iterate. The
  scorecard's author rows show every authoring turn's `resultSubtype`, the turns it took of its cap
  (`error_max_turns · 300/300 turns`) and its elapsed time.
- **Seed** (`seed.ts`): rows go in as the admin, a lookup's target before its referrer. Where the card's declared
  lookups lead back to where they start — `department.manager → employee` with `employee.department → department`, or a
  self-lookup naming a later row — the seed loads in two passes: every row first with each lookup naming a row not in
  yet left out, then one update per row sets those (`seed.secondPass` in the record). The side that waits is one the
  build left optional; a build that makes every side of a cycle `required` cannot be seeded, which the data contract
  states and the scorecard reports as a Build finding naming the cycle (the seed is still sent, so the record holds
  the app's own refusals). A refused row takes out what it feeds (`seedDependence` in `orchestrate.ts`): with its
  children through the declared lookups, the runner computes every question's truth again over the rest of the seed
  by the loader's own rules (`truthsOver`), and only a turn (a question, or a question as one persona) whose expected
  answer changes is **not measured**; every other turn is asked and graded as usual. An operation is not measured
  when a row it names is out.
- **Observation** (`observe.ts`): the write grader is fed what the runner reads itself: the agent's write calls and
  the door's answer (a coded refusal), the object's rows before and after the turn, and the audit trail's actor. A turn
  that wrote nothing because the object refused the read it needed first (a persona that may not read it) grades as
  that refusal's code; `(no write attempted)` is left for a turn whose object never refused it. For the
  operation the card's `write_validation` guardrail names, the runner then sends the declared write itself
  (`values`, on `target`) as the same persona through the same MCP door (`POST /api/v1/mcp`, its own API key) and
  reads that answer as the **probe**: the app's validation is measured on every run, whether or not the agent sent
  the bad value, and a careful agent that caught it first is not failed for it. A failed probe is the platform's
  failure, never the agent's. Every other `refused` create or update is probed the same way, so a permission
  overstep the agent declined still measures the platform's refusal. An answer that carries no code is reported
  with whose throw it was (`uncodedNote`: the build's own hook or action, named off the sandbox's wrapper, or the
  door's text). The runner also records the run dates (each clock instant's UTC and local date) and the fields
  the agent's own write calls set (`agentSetOf`: a create's or update's `data`, a `run_action`'s `params`); a
  declared `asOf` value is matched against a run date only in a field the agent did not set.
- **Namespaces** (`namespace.ts`): every card's app is in the namespace `demo` + the card's `code` (`democrm`): scratch
  mode scaffolds the project under that name, and template mode installs a template declaring it into a host named
  `host<code>` (the unmanaged copy keeps its namespace, and the install refuses one the host owns). The card's names are
  read relative to it (`account` → `democrm_account`), because a scaffolded project and the unmanaged install both
  refuse bare object names. The build prompt asks for the prefix on EVERY item, and the scorer reports each bare
  non-object item name as a failing Build check (`bare-name:<type>:<name>`), so such a build is never verified.
- **Persona contract**: the build is asked for one permission set per persona, named `<namespace>_<persona id>`. The runner
  grants it to that persona's user, and loads a seed row as owned (`owner_id`) by a persona's user only when the row
  names that person (`rowOwner` in `prompts.ts`): it IS the persona's `record`, a declared direct lookup on it holds
  that record's id (`ticket.assignee` = `a02`), or a declared user-handle field on it holds the persona's handle
  (`owner: u_sam`). The first persona in `run.personas` order the row names owns it. An option value
  (`visibility` = `public`), a row id scope and a lookup to a row no persona is (a department, a group) name nobody,
  so those rows keep the inserter, the admin. Each persona's `record` row is loaded with that persona's user id in its
  `user` field, which the build prompt asks for as an optional `user`-type field. `personaHandles` is the handle map
  only; `personaRecords` is the record binding. A field the card declares in `run.userHandleFields`
  (`userHandleFields` in `prompts.ts` reads the declaration, never infers it) is loaded with the user's id in place of
  the handle text, and the record's `seed.rewritten` lists each field so rewritten. The build prompt's Row ownership
  section states all of this, and a platform-boundary line: the open-source server has no hierarchy resolver, so a
  person who must see rows another person owns gets them through what the build models (a read policy, a
  parent-controlled child, a field naming them).
- **Structure contract** (`prompts.ts`): every Build check traces to text the build prompt carries, so a faithful build
  never fails for not guessing a name. Besides the seed (objects and fields) and the persona sets, the contract states
  each `expect` row the exact-name scorer checks by name: every lookup's target, every single-choice field with its
  minimum option count, every dashboard and every app navigation target, and, on a card carrying
  `records-forms.select-options`, that every other single-choice field offers two options or more. An iterate prompt
  states its change's rows the same way: the new objects (with the card's field minimum), lookups, option fields,
  dashboards and nav targets. `test/runner/prompt-trace.test.ts` reads the checks off the scorer itself and holds every
  card to it.

## Refreshing the gallery — `gallery-refresh`

```bash
G="$(realpath ../gallery)"   # pnpm runs the script in the package directory: pass absolute paths
pnpm --filter @objectstack/scenarios gallery-refresh --gallery "$G"                 # every exportable card
pnpm --filter @objectstack/scenarios gallery-refresh --gallery "$G" --debut         # one card: the gallery's first app
pnpm --filter @objectstack/scenarios gallery-refresh --gallery "$G" --model sonnet  # the model every turn asks for
```

One step from "is there a new stable release?" to a local commit in a checkout of objectstack-ai/gallery
(`src/export/refresh.ts`, CLI `src/export/refresh-cli.ts`). It reads npm's `latest` `@objectstack/cli` and the
`framework.version` of every app the gallery's `index.json` lists. When the index lists an app and every app states
that version, it prints one `skip: …` line and exits 0, having run nothing. It also skips when a remote-tracking
`export/<version>` branch exists: that refresh was pushed and awaits review. Otherwise it:

1. runs every card the gallery may show (origin `generic`, tier `starter` or `delivery`; `--debut`: the first of them
   by id) with `run-scenarios --modes scratch --packages published --create-version <version>`, so the apps are built
   on exactly that release, the turns recorded;
2. exports with screenshots into the checkout (`export-gallery`'s rules: only a run that passed every half);
3. creates the branch `export/<version>`, commits `apps/` and `index.json` under the checkout's own git identity, and
   prints the branch, the commit and a ready PR body.

It refuses, exit 1 with the reason, when: `--gallery` is not the top of a git checkout or has uncommitted changes;
the index does not validate; npm's `latest` is not a plain `MAJOR.MINOR.PATCH`; a local `export/<version>` branch
already exists; `--debut` meets an index that lists an app; no card may be exported; no app exported; an exported app
states another framework version; or anything outside `apps/` and `index.json` changed. The last three leave the
working tree as the export left it, uncommitted. `--work DIR` keeps the records, projects and recording (default: a
temp directory, named on a refusal). ⛔ It never pushes, never opens a PR and never talks to GitHub.

### The scheduled task's runbook

Ruling D2 (2026-11-06): a daily scheduled Claude Code task in this project's cloud environment runs the refresh on the
maintainer's subscription login, and the maintainer merges its PR on the gallery.

- **What it runs**: `gallery-refresh` from a fresh checkout of this repository, into a fresh clone of
  objectstack-ai/gallery; then `git push` of the one branch it created, and one PR.
- **What it needs**: both repositories in the environment's resources, with push access to the gallery; npm reachable;
  the container's `claude` logged in with the subscription (`claude auth status` reports `oauth_token`) and neither
  `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` set (the live driver refuses both); a permission mode that lets the
  session launch the headless `claude -p` the runner spawns (Auto mode's classifier refuses it, see
  [the cloud session settings](#running-the-cards-in-a-claude-code-cloud-session)); Chromium for the screenshots
  (preinstalled in the cloud container). A full refresh runs one `starter` build after another, longer than the
  2-hour cap on a background command, so the task starts it detached and waits in the foreground.
- **What it never does**: push `main` or any branch but `export/<version>`, force-push, merge, edit a gallery file by
  hand, pass `--packages workspace`, or run on an API key. A refusal is reported, never retried around.

The task's prompt, verbatim:

```text
Refresh the ObjectStack scenario gallery. Run each step in order and stop at the first that fails.

1. Check the login: `unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; claude auth status` must report oauth_token.
   Anything else is a failure (step 6).
2. In the objectstack checkout: `git fetch origin main && git checkout --detach origin/main`, `pnpm install`,
   `pnpm --filter '@objectstack/scenarios^...' build`.
3. Clone the gallery beside it: `git clone https://github.com/objectstack-ai/gallery ../gallery`.
   If ../gallery/index.json is missing or lists no app, add `--debut` to the command in step 4.
4. Start the refresh detached and wait for it in the foreground:
   `nohup sh -c 'pnpm --filter @objectstack/scenarios gallery-refresh --gallery "$(realpath ../gallery)" --work /tmp/gallery-refresh; echo "gallery-refresh exit $?"' > /tmp/gallery-refresh.log 2>&1 & echo $! > /tmp/gallery-refresh.pid`
   then repeat `timeout 590 tail --pid="$(cat /tmp/gallery-refresh.pid)" -f /dev/null` until the process is gone.
   The log's last line is `gallery-refresh exit N`; any N but 0 is a failure (step 6).
5. If a line of the log starts with `skip:`, stop: report that line and do nothing else.
   Otherwise the log names a `branch: export/VERSION`: push exactly that branch
   (`git -C ../gallery push origin export/VERSION`) and open one pull request on objectstack-ai/gallery from it into
   main, titled `Gallery refresh for ObjectStack VERSION`, with the text after "open the PR with this body:" as its
   body. Never push main, never force-push, never merge, never edit a gallery file by hand.
6. On any failure (a refusal, a non-zero exit, a failed push or PR): search the open issues of
   objectstack-ai/objectstack for one titled `Gallery refresh failed`. If one exists, add a comment with today's
   date, the step that failed and the last 40 lines of /tmp/gallery-refresh.log; otherwise open one issue with that
   title and the same text. Never open a second one.
```

## Other agent tools — Codex and the external driver contract

The same card can measure another agent tool. Every record (`env.driver`) and every gallery app page (`- Driver:`)
names the driver and its version; a replay (`--driver recorded:F`) names the driver of the recording it replays
(`replayOf`), never the recording's path.

### `--driver codex`

`drivers/codex.ts` runs the OpenAI Codex CLI in non-interactive mode, on your own ChatGPT plan. What it reads of the
CLI was measured on `codex-cli 0.167.0`:

- **Login**: the ChatGPT plan only. It refuses to start while `OPENAI_API_KEY` or `CODEX_API_KEY` is set, or when
  `codex login status` reports anything but `Logged in using ChatGPT` (an API key, no login, an access token); every
  turn passes `-c forced_login_method="chatgpt"`, and both variables are removed from its environment.
- **A turn**: `codex exec --json --ephemeral --skip-git-repo-check -c approval_policy="never" -p PROFILE … -`, the
  prompt on stdin. An authoring turn runs `-s workspace-write -c sandbox_workspace_write.network_access=true -C
  <project>`; a question or operation runs `-s read-only` in an empty temp directory.
- **MCP**: the app is served under the name `app` from a profile layer, `$CODEX_HOME/scenario-runner-<random>.config.toml`
  (0600, deleted when the turn returns), that holds the persona's key as an `http_headers` `Authorization` header and
  turns off every MCP server of your own config (`enabled = false`). A server of your own named `app` is refused.
- **Flags**: `--model`, `--author-model` and `--ask-model` pass `-m`; `--author-timeout` is the runner's own clock.
  `codex exec` has no cap on its agentic turns, so `--author-max-turns` and `--ask-max-turns` are refused. Its JSONL
  names no model, so the scorecard shows `model not reported (asked for …)`.

### `--driver external:COMMAND` — the contract

`drivers/external.ts` runs any command that speaks the driver seam as a process contract. `COMMAND` is split on
whitespace (no shell, no quoting); a word that starts `./` or `../`, and a first word holding a `/`, is resolved against
the directory you run from. For anything more, write a wrapper script.

- **One process per call.** The call is one JSON object on stdin; the answer is one JSON object on stdout; logs go to
  stderr (the record keeps its last 2,000 characters). Every input starts with `"contract":
  "objectstack-scenario-driver/1"`; a command should refuse a contract it does not know.
- **`info`**, once, before any card runs: `{"contract":…,"kind":"info"}` → `{"name":"my-agent","version":"1.4.2"}`.
  The record's driver is `external:my-agent`, its version `1.4.2`. A command that cannot answer it is refused.
- **`author`**: build or iterate the app in `cwd` with shell and file tools; the call runs in `cwd`.
  `{"contract":…,"kind":"author","step":{"card","mode","phase","step"},"prompt":"…","cwd":"/abs/project","tier":"starter","limits":{…}}`
- **`ask`**: answer one data question or write operation as a persona, over the app's MCP endpoint; the call runs in
  the directory of `mcp.configFile`.
  `{"contract":…,"kind":"ask","step":{"card","mode","phase","step","persona"},"prompt":"…","mcp":{"url":"…","configFile":"/tmp/…/mcp.json"},"limits":{…}}`
- **The answer** to `author` and `ask`, strict (an unknown key is refused):
  `{"replyText":"every text the agent said, joined","toolCalls":[{"name":"query_records","input":{…},"output":"…","isError":false}],"model":"…","numTurns":3}`.
  `model` and `numTurns` are optional; an MCP tool may be named bare or `mcp__<server>__<tool>`; a call that never
  answered leaves `output` out.
- **Exit codes**: 0 with an answer of that shape is the turn. Any other end is a failed turn with a named reason,
  never an empty pass: a non-zero exit or a signal is `no-result(exit N)`, stdout that is not one JSON object of that
  shape is `invalid-output(…)`. A failed authoring turn leaves its Build half not measured; a failed persona turn is
  graded as the empty answer it is.
- **Timeout**: `limits.timeoutMs` — `--author-timeout` for `author` (default 60 min), 5 min for `ask`. The runner kills
  a call still running then (SIGTERM).
- **Limits**: `limits` carries `timeoutMs`, and `maxTurns` (`--author-max-turns` / `--ask-max-turns`) and `model`
  (`--model`, `--author-model`, `--ask-model`) when given. The command may ignore them; the record states them.
- ⛔ **The key**: the persona's API key is only in `mcp.configFile`, a 0600 file in the shape of Claude Code's
  `--mcp-config` (`{"mcpServers":{"app":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}`), deleted
  when the call returns. It is never on argv, in the environment or on stdin, and so never in a run record, a
  scorecard or a gallery export. A command must not print it.
- **Cost**: the runner cannot see an external command's login, so the record's login reads `not verified`; the cost
  ruling still applies, and the runner removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` and
  `CODEX_API_KEY` from the command's environment.

`test/runner/fixtures/fake-external-driver.mjs` is a complete command in about a hundred lines.

**WorkBuddy** (checked 2026-11-07): Tencent's WorkBuddy is a desktop app; no headless mode with structured output
and an MCP client was found for it, so it is not wired here. A tool that has both rides `--driver external:` with a
wrapper, with no change to the runner.
