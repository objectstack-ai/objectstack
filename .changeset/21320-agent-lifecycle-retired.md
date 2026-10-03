---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
---

feat(spec)!: retire `agent.lifecycle`, the agent conversation state machine, and with it the XState `StateMachineSchema` family — a conversation phase is a skill with `triggerConditions`, orchestration is Flow, record transitions are the `state_machine` validation rule (#21320)

**BREAKING** — `agent.lifecycle` was parsed and never read. No runtime, in this
repository or in the cloud AI runtime that executes agents, moved an agent through a
declared state or refused an undeclared transition, so an authored machine changed
nothing an agent did (ADR-0049 enforce-or-remove). Enforcing it would have meant a
statechart interpreter beside Flow, the two-engine shape ADR-0020 rejected. Authoring
now refuses the key by name, with a prescription, and TypeScript rejects it.

Its value schema had no other authorable door: ADR-0020 had already retired the XState
shape as a record-lifecycle declaration and kept the file only for this key. So the
family leaves the package with it.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `agent.lifecycle` — any value | delete the key. |
| a conversation phase in the machine (its own instructions and tools) | a skill with its own `instructions` and `tools`, selected by its `triggerConditions`, listed in the agent's `skills`. |
| a multi-step process in the machine | a Flow. |
| a record's status transitions in the machine | a `state_machine` validation rule in the object's `validations`: `{ type: 'state_machine', field, transitions: { from: [to, …] } }`. |
| `StateMachineSchema`, `StateNodeSchema`, `TransitionSchema`, `ActionRefSchema`, `GuardRefSchema` and the types `StateMachineConfig`, `StateNode`, `StateNodeConfig`, `Transition`, `ActionRef`, `GuardRef` from `@objectstack/spec/automation` | no replacement: declare the shape your code needs itself, or drop it. For record transitions, `StateMachineValidationSchema` in `@objectstack/spec/data` is the enforced shape. |
| `StateNodeConfig` from `@objectstack/spec` or `@objectstack/spec/ai` | removed with the family; nothing in those entries mentions it any more. |

**The one-line fix: delete `lifecycle`; put phase-scoped instructions and tools in
skills with `triggerConditions`, and orchestration in Flow.** `os migrate meta --from 17`
lists the mechanical edits for existing sources (the `lifecycle` deletion). Where each
deleted machine's intent goes is the author's judgement.

The refusal is a parse error at `lifecycle` naming the key and the fix, and the key
fails `tsc` (its input type is `never`).

### The retirement kit

- **Tombstone.** `lifecycle` is a `retiredKey()` on `AgentSchema` carrying the
  prescription; the agent metadata form no longer offers it.
- **D2 conversion `agent-lifecycle-removed`** (step 18, retired from the load path):
  it deletes `lifecycle` from every agent, whatever it holds. The delete is lossless,
  because no value of it ever changed what an agent did. Stored `sys_metadata` agent
  rows and built artifacts replay it; one notice per agent. An object's ADR-0057
  `lifecycle` block shares the name and is not touched.
- **D3 entry `agent-lifecycle-retired`** carries the judgement the conversion cannot
  make: which of the three destinations each deleted machine meant.
- **`RETIRED_KEYS_BY_MAJOR[18]`** registers `ai/Agent:lifecycle`, and
  **`RETIRED_DEFS_BY_MAJOR[18]`** registers the five published defs
  `automation/StateMachine`, `automation/StateNode`, `automation/Transition`,
  `automation/ActionRef` and `automation/GuardRef`. Their reference page
  (`references/automation/state-machine`) is gone.
- **No deprecation window**, per the project's startup-stage posture.

### The liveness ledger

The `agent.lifecycle` row moves `experimental` → `dead` with a REMOVED note
(`verifiedAt` 2026-10-02); the tombstone keeps it in the walked shape. No `agent` row is
`experimental` any more. `os validate` and every other parsing door refuse the key at
parse, before any advisory runs. `os lint` reads the unparsed stack, so it now grades the
key `liveness-dead-property` where it used to say `liveness-experimental-property`.

### `@objectstack/platform-objects`

The agent metadata-form catalogs drop the `lifecycle` row's label and help text in all
four locales.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is
published: tenant-authored agents, and code outside this repository importing the
family's exports, were not measured. This repository authors no `agent.lifecycle`
outside `packages/spec` and imports none of the family outside it; the pinned objectui
checkout imports none of the family and reads no `agent.lifecycle`.

Clause-②: yes (narrowing)

<!-- adr-0087: registered agent-lifecycle-removed, agent-lifecycle-retired -->
