# @objectstack/scenarios

Private, unpublished. The schema (zod) and loader for the open scenario library under
[`docs/qa/scenarios/`](../../../docs/qa/scenarios/README.md) — that README is the format's
reference.

```ts
import { loadScenarios, readCapabilityAreas, formatRefusal } from '@objectstack/scenarios';

const areas = readCapabilityAreas('docs/qa/platform-checklist/areas');
const { cards, refusals } = loadScenarios('docs/qa/scenarios', { areas });
for (const r of refusals) console.error(formatRefusal(r)); // FILE: FIELD.PATH: message
// cards[i].truths[questionId] → the question's computed truth
```

- `src/schema.ts` — the card shape, one strict zod object per layer.
- `src/truth.ts` — evaluates a declarative truth spec over seed rows; refuses a truth the
  seed does not determine.
- `src/loader.ts` — reads a directory of cards, validates shape and cross-references, and
  returns typed cards or located refusals.
- `src/score/` — the deterministic scorer, entry `@objectstack/scenarios/score` (below).

No build step (`exports` points at `src`), and nothing here calls a model or the network.

## Scoring a run against a card — `@objectstack/scenarios/score`

Every function takes a card the loader returned, so it judges against the loader's computed
truths and declared outcomes:

```ts
import { gradeCardAnswer, gradeCardOperation, scoreCardArtifact } from '@objectstack/scenarios/score';

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
  `pending_confirmation`; a fact the observation does not carry fails.
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
| `access-security.field-permissions` | denies (`readable: false`, in a permission set) every field a card persona hides, and has that field |
| `access-security.row-scope` | keeps every object a persona's `scope` names private (owner-scoped), or derived from its master |
| `approvals.approval-flow` | carries an approval (a flow with an Approval node), each bound to an object it serves, one bound to an object the card names |
| `automation.record-triggered-flow` | carries a record-triggered flow, each bound to an object it serves, one bound to an object the card names |
| `dashboards.widget-measures` | carries a dashboard widget with a measure, and every widget measure resolves on the dataset it binds |

## Running the cards — `@objectstack/scenarios/runner`

```bash
pnpm --filter @objectstack/scenarios run-scenarios                       # every card, both modes
pnpm --filter @objectstack/scenarios run-scenarios --only service_desk --modes scratch
pnpm --filter @objectstack/scenarios run-scenarios --record /tmp/rec.json  # also save every turn
pnpm --filter @objectstack/scenarios run-scenarios --driver recorded:/tmp/rec.json  # replay, no model
```

Per card and mode the runner writes `docs/qa/platform-checklist/runs/<date>-scenario-<card>.json`
(git-ignored) and prints the scorecard.

| Mode | Steps |
|:---|:---|
| `scratch` | `create-objectstack` → the agent builds from the card prompt and the runner's data contract (`prompts.ts`) → `objectstack validate` / `build` / `verify` (proofs chosen from the tags) → score → `objectstack dev --fresh` → seed, one user + permission-set grant + API key per persona → every question as every persona it names and every operation as its persona, over the app's MCP → the iterate change → rebuild, re-score, re-run |
| `template` | a blank project → boot → install the card's verified build **unmanaged** (`/api/v1/marketplace/install-local`, `installMode: 'unmanaged'`) → the agent applies the iterate change to the installed copy → score → seed → Run. A refused install is a finding in the record |

- **Driver** (`driver.ts`): the local `claude` CLI on your own login (`claude -p --output-format stream-json`). It
  refuses to start when `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` is set or the CLI is logged in with an API key
  (the cost ruling on cloud#3600), and the record states the driver and login. `RecordedDriver` replays a recording.
- **Observation** (`observe.ts`): the write grader is fed what the runner reads itself: the agent's write calls and
  the door's answer (a coded refusal), the object's rows before and after the turn, and the audit trail's actor.
- **Namespaces** (`namespace.ts`): a card's object names are read relative to the package namespace (`account` →
  `ns_account`), because a scaffolded project and the unmanaged install both refuse bare names.
- **Persona contract**: the build is asked for one permission set per persona, named by the persona's id. The runner
  grants it to that persona's user, and makes a seed row whose scope field names a persona's handle (`owner: u_sam`)
  owned by that persona's user.
