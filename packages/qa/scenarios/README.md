# @objectstack/scenarios

Private, unpublished. The schema (zod) and loader for the open scenario library under
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

Not published. `pnpm --filter @objectstack/scenarios build` (tsup) writes `dist/` as ESM, CJS and
`.d.ts`, and every `exports` subpath points there, so a consumer that links the framework tree
and bundles its own entry can load the scorer under plain Node. The suites and `run-scenarios`
read `src/` directly. Nothing here calls a model or the network.

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
  the declared values, the probe, was refused with that code and stored nothing).
- `scenario-run-grade.ts` — an answer graded on correct / cited / leaks, per persona against
  that persona's truth; a `withheld` truth is must-not-reveal.

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
pnpm --filter @objectstack/scenarios run-scenarios --author-timeout 90       # minutes per authoring turn (default 60)
pnpm --filter @objectstack/scenarios run-scenarios --author-max-turns 400    # turns per authoring turn, every card (default by tier)
pnpm --filter @objectstack/scenarios run-scenarios --ask-max-turns 20        # turns per question or operation turn (default 12)
pnpm --filter @objectstack/scenarios run-scenarios --model sonnet            # the model every turn asks for (default: the login's own)
pnpm --filter @objectstack/scenarios run-scenarios --author-model opus --ask-model haiku  # build and persona turns apart
pnpm --filter @objectstack/scenarios run-scenarios --packages workspace      # on this checkout's unreleased packages (default: published)
```

Per card and mode the runner writes `docs/qa/platform-checklist/runs/<date>-scenario-<card>.json`
(git-ignored) and prints the scorecard.

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
  and the end of its stderr. `RecordedDriver` replays a recording, and refuses the live-driver limits and models below.
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
  the app's own refusals).
- **Observation** (`observe.ts`): the write grader is fed what the runner reads itself: the agent's write calls and
  the door's answer (a coded refusal), the object's rows before and after the turn, and the audit trail's actor. A turn
  that wrote nothing because the object refused the read it needed first (a persona that may not read it) grades as
  that refusal's code; `(no write attempted)` is left for a turn whose object never refused it. For the
  operation the card's `write_validation` guardrail names, the runner then sends the declared write itself
  (`values`, on `target`) as the same persona through the same MCP door (`POST /api/v1/mcp`, its own API key) and
  reads that answer as the **probe**: the app's validation is measured on every run, whether or not the agent sent
  the bad value, and a careful agent that caught it first is not failed for it. A failed probe is the platform's
  failure, never the agent's.
- **Namespaces** (`namespace.ts`): every card's app is in the namespace `demo` + the card's `code` (`democrm`): scratch
  mode scaffolds the project under that name, and template mode installs a template declaring it into a host named
  `host<code>` (the unmanaged copy keeps its namespace, and the install refuses one the host owns). The card's names are
  read relative to it (`account` → `democrm_account`), because a scaffolded project and the unmanaged install both
  refuse bare object names. The build prompt asks for the prefix on EVERY item, and the scorer reports each bare
  non-object item name as a failing Build check (`bare-name:<type>:<name>`), so such a build is never verified.
- **Persona contract**: the build is asked for one permission set per persona, named `<namespace>_<persona id>`. The runner
  grants it to that persona's user, and makes a seed row whose scope field names a persona's handle (`owner: u_sam`)
  owned by that persona's user.
- **Structure contract** (`prompts.ts`): every Build check traces to text the build prompt carries, so a faithful build
  never fails for not guessing a name. Besides the seed (objects and fields) and the persona sets, the contract states
  each `expect` row the exact-name scorer checks by name: every lookup's target, every single-choice field with its
  minimum option count, every dashboard and every app navigation target, and, on a card carrying
  `records-forms.select-options`, that every other single-choice field offers two options or more. An iterate prompt
  states its change's rows the same way: the new objects (with the card's field minimum), lookups, option fields,
  dashboards and nav targets. `test/runner/prompt-trace.test.ts` reads the checks off the scorer itself and holds every
  card to it.
