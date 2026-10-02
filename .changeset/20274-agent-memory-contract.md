---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
---

feat(spec)!: an agent's `memory` contract states exactly what the runtime honours — `maxEntries` and `reflectionInterval` are required once long-term memory is enabled, `longTerm.store` is retired, and the block is `live`, enforced by the cloud AI runtime (#20274)

**BREAKING** — `agent.memory` narrows to what the cloud AI runtime, the one runtime
that executes agents, actually does with it. That runtime recalls the newest
`maxEntries` distilled notes for the user before the first round, writes one note
every `reflectionInterval` delivered interactions, evicts notes beyond `maxEntries`,
and keeps them in its own database store. Before an agent's first turn it refused
exactly the declarations this spec still accepted, so authoring now refuses them,
by name, with a prescription (ADR-0049 enforce-or-remove):

- **`longTerm.maxEntries` and `reflectionInterval` are required when
  `longTerm.enabled` is true.** No default is declared for either: none has a
  measured basis, and the runtime adds none.
- **`reflectionInterval` is refused without an enabled `longTerm`** — a reflection
  writes a long-term note, so with none enabled it would do nothing.
- **`longTerm.store` is retired as a whole key.** The memory store is platform
  infrastructure, not agent metadata: the runtime keeps the notes in its own
  database store, and refused `vector` (the key's default, so what an omitted
  `store` parsed to) and `redis`. Its old spellings `backend`, `storage` and
  `provider` under `longTerm` are answered with the same prescription instead of
  being steered onto `store`.

`longTerm.enabled` is unchanged.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `memory.longTerm.store` — any value, `database` included | delete the key; where the notes are kept is the platform's choice. |
| `longTerm: { enabled: true, … }` without `maxEntries` | add `maxEntries`: how many distilled notes are kept for each user (an integer of at least 1). |
| `longTerm: { enabled: true, … }` without `memory.reflectionInterval` | add `reflectionInterval`: how many delivered interactions pass between the reflections that write a note (an integer of at least 1). |
| `memory.reflectionInterval` without `longTerm.enabled: true` | enable long-term memory with both numbers, or delete `reflectionInterval`. |

**The one-line fix: declare `maxEntries` and `reflectionInterval` when `longTerm.enabled`; delete `store`.**
`os migrate meta --from 17` lists the mechanical edits for existing sources (the
`store` deletion); the two numbers are the author's to choose.

Each refusal is a parse error at the key's own path, naming the key and the fix, and
`store` also fails `tsc` (its input type is `never`).

### The retirement kit

- **Tombstone.** `longTerm.store` is a `retiredKey()` carrying the prescription; the
  three old alias spellings moved from `aliases` to `guidance`, because an alias may
  not steer an author onto a tombstone.
- **The contract check** is a refinement on `memory` (`reflectionInterval` is
  `longTerm`'s sibling), one `custom` issue per missing or misplaced key. A JSON
  Schema cannot state a value-conditioned requirement in the closed projection list,
  so the published `ai/Agent` schema (and the four installed-package schemas that
  embed agents) names the site in `x-dropped-refinements`, recorded in
  `dropped-refinements.baseline.json`.
- **D2 conversion `agent-memory-long-term-store-removed`** (step 18, retired from the
  load path): it deletes `store` from `memory.longTerm`, whatever it holds — the
  delete is lossless, because no value of it ever chose a backend. Stored
  `sys_metadata` agent rows and built artifacts replay it; one notice per agent. It
  supplies neither number.
- **D3 entry `agent-memory-store-retired-and-limits-required`** carries the judgement
  the conversion cannot make: the two numbers an enabled `longTerm` now requires.
- **`RETIRED_KEYS_BY_MAJOR[18]`** registers `ai/Agent:memory.longTerm.store`.
- **No deprecation window**, per the project's startup-stage posture.

### Describes and the liveness ledger

- `agent.memory` drops `[EXPERIMENTAL — not enforced]`: it states that the cloud AI
  runtime enforces it and that the open framework edition does not run agents.
  `longTerm`, `enabled`, `maxEntries` and `reflectionInterval` each state what the
  runtime does with them.
- The ledger row moves `experimental` → `live`, citing the cloud reader
  `agent-runtime.ts#compileAgentMemory` (via `AgentRuntime.resolveTurnGuardrails`),
  the enforcement in `ai-service.ts` and the store `agent-memory.ts#AgentMemoryStore`,
  as attested by the cloud seat's reading at cloud `ef5a4344`, `verifiedAt`
  2026-10-02. `os lint` / `os validate` no longer warn
  `liveness-experimental-property` on an agent that sets `memory`.
- ⚠️ **The window, stated.** At `ef5a4344` the cloud reader still reads `store`: it
  honours `database` only and refuses `vector` and `redis`. Cloud drops `store` in
  that one reader once this release reaches its pin, and no earlier.

### The agent form's help texts

- The `memory` row's help text on the agent metadata form named short-term memory,
  a key the schema refuses. It now states what memory does and that `maxEntries`
  and `reflectionInterval` are required once long-term memory is enabled.
- The neighbouring `planning` row named a strategy and a replan switch the schema
  does not declare; it now states the one key it has, the iteration cap.
- The `platform-objects` metadata-form catalogs follow: the English leaves are
  regenerated, and the `zh-CN`, `ja-JP` and `es-ES` leaves are authored, not copied.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is
published, and tenant-authored agents were not measured. This repo authors no
`longTerm` outside `packages/spec`, and no cloud built-in agent declares one.

Clause-②: yes (narrowing)

<!-- adr-0087: registered agent-memory-long-term-store-removed, agent-memory-store-retired-and-limits-required -->
