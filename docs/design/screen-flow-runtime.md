# Design — Screen-Flow Runtime (interactive `screen` nodes)

**Builds on**: [ADR-0019](../adr/0019-approval-as-flow-node.md) durable pause/resume (the same primitive approvals use).
**Audience**: implementing agent. Scope: make a `screen`-node flow (e.g. the showcase Reassign Wizard) actually collect input in the UI and resume.

## Current state (verified)

The pause/resume spine already exists:
- `screen` executor (`service-automation/src/builtin/screen-nodes.ts`) suspends **only** when `config.waitForInput === true`; otherwise it's a server pass-through. It does **not** surface the screen's field spec.
- `engine.resume(runId, signal)` restores variables, merges `signal.output` under `${nodeId}.key`, and continues from the node's out-edges. It does **not** set bare flow variables.
- No resume HTTP endpoint (only approvals have one); no UI runner.

Net gap for a working screen flow: (a) surface the **screen spec** on the paused result, (b) resume must set the collected inputs as **bare** flow variables (the showcase `apply` node reads `{new_assignee}`/`{recordId}`), (c) a resume HTTP endpoint, (d) an objectui `FlowRunner`, (e) suspend by default when a screen declares input fields.

## Protocol

### Types (spec/contracts)
```ts
interface ScreenFieldSpec { name: string; label?: string; type?: string; required?: boolean; options?: {value:unknown;label:string}[]; defaultValue?: unknown; }
interface ScreenSpec { nodeId: string; title?: string; description?: string; fields: ScreenFieldSpec[]; }
// AutomationResult gains:  screen?: ScreenSpec   // present when status==='paused' at a screen node
// ResumeSignal gains:      variables?: Record<string, unknown>   // bare flow vars (screen inputs)
```

### Engine
- **screen executor**: suspend when `waitForInput === true` **or** (`config.fields` non-empty **and** `waitForInput !== false`). When suspending, return `{ success:true, suspend:true, screen: { nodeId, title, description, fields } }` built from `node.config`.
- **suspend plumbing**: `NodeExecutionResult.screen` → `FlowSuspendSignal.screen` → `SuspendedRun.screen` → paused `AutomationResult.screen`.
- **resume**: apply `signal.variables` as **bare** variables (`variables.set(name, value)`) in addition to the existing `signal.output` (`${nodeId}.key`). If the continuation suspends at another screen, return that screen (multi-screen wizards).
- `async getSuspendedScreen(runId)` getter so HTTP can re-fetch the current screen. Durable (#4515): hot cache first, then the `SuspendedRunStore` via the same loader `resume` rehydrates from, so a screen run that survived a restart renders as well as it resumes.

### HTTP (`runtime/http-dispatcher.ts` `handleAutomation`)
- **Launch**: existing `POST /api/v1/automation/:name/trigger` — when the run pauses at a screen, the response includes `{ status:'paused', runId, screen }`.
- **Resume**: `POST /api/v1/automation/runs/:runId/resume` body `{ inputs: {field:value} }` → `engine.resume(runId, { variables: inputs })` → returns next `{ status:'paused', runId, screen }` or `{ status:'completed' }`. (Mirrors the approvals decide endpoint, keyed by runId.)
- `GET /api/v1/automation/runs/:runId/screen` — re-fetch the current screen (refresh-safe).

### objectui `FlowRunner` (app-shell)
- A modal driven by `{ runId, screen }`: render `screen.fields` as a form (reuse field widgets), submit → POST resume with `{inputs}` → render the next `screen` or close on `completed` (toast + refresh the originating view).
- Wired to actions that launch a screen flow: the action's launch response carrying `{ runId, screen }` opens the `FlowRunner` instead of just toasting.

### showcase
- `ReassignWizardFlow.collect` already declares `fields` → suspends by the new default (or set `waitForInput: true` explicitly). `recordId` is supplied at launch (the selected row); `new_assignee` is collected by the screen and applied by `update_record`.

## Phases
1. **contracts + engine + screen executor + resume** (+ unit tests) — server can launch→pause→resume a screen flow headlessly.
2. **HTTP** resume endpoint + launch surfaces the screen.
3. **showcase** flag/verify the wizard suspends & applies.
4. **objectui `FlowRunner`** + action wiring.
5. **browser verify** end-to-end (Bulk Reassign → form → submit → assignee updated).

Each phase is independently testable; 1–3 are framework, 4 is objectui.
