---
'@objectstack/spec': minor
---

feat(spec)!: an agent's `structuredOutput` is JSON-only — the `regex` / `grammar` / `xml` formats and the `coerce_types` step are retired, and the block is `live`, enforced by the cloud AI runtime (#21277)

**BREAKING** — four members leave the agent's structured-output vocabulary:
`regex`, `grammar` and `xml` from `StructuredOutputFormat` (so from
`agent.structuredOutput.format` and `agent.structuredOutput.fallbackFormat`), and
`coerce_types` from `TransformPipelineStep` (so from
`agent.structuredOutput.transformPipeline`). ADR-0049 enforce-or-remove, ruled
retire. The cloud AI runtime, the one runtime that executes agents, enforces
`structuredOutput` on every final answer and refused an agent declaring any of the
four before its first turn: the spec never had a key to carry the pattern or
grammar a `regex` / `grammar` answer would be checked against, an answer is checked
only as JSON, and no coercion engine exists. So no authored value of the four ever
did what it named, and authoring now refuses them by name instead of the first
live turn refusing the agent. `json_object`, `json_schema`, `trim`, `parse_json`
and `validate` are unchanged.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `structuredOutput.format: 'regex'`, `'grammar'` or `'xml'` | `format: 'json_schema'` with a JSON Schema in `schema` when the answer must have a shape, or `format: 'json_object'`; or delete the `structuredOutput` block if the agent needs no output contract. |
| `structuredOutput.fallbackFormat: 'regex'`, `'grammar'` or `'xml'` | `'json_object'` or `'json_schema'`, or delete the key. |
| `'coerce_types'` in `structuredOutput.transformPipeline` | delete the step, and declare the exact types in `schema` so the answer is validated as the model wrote it. |

**The one-line fix: use `json_schema` with a JSON Schema; drop `coerce_types`.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

Each retired member is refused at parse with a prescription naming the JSON
formats, and in `tsc` (the members are gone from the `StructuredOutputFormat` /
`TransformPipelineStep` types). Any other unknown value keeps zod's own message.

### The retirement kit

- **Value-level retirement.** Both enums are declared through
  `enumWithRetiredValues` (`shared/retired-key.ts`), the house mechanism for a
  narrowed vocabulary, with the prescriptions module-private. No authorable KEY and
  no def changed, so nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four surface
  ratchets (`api-surface`, `authorable-surface`, `json-schema.manifest`,
  `api-surface-signatures`) are byte-identical.
- **D2 conversion `agent-structured-output-refused-members-removed`** (step 18,
  retired from the load path): it deletes a `structuredOutput` block whose `format`
  was retired (the format is required, and no rewrite can say which JSON contract
  was meant), deletes a retired `fallbackFormat`, and drops `coerce_types` from the
  pipeline, keeping the other steps in order. Stored `sys_metadata` agent rows replay
  it at rehydration; one notice per edit.
- **D3 entry `agent-structured-output-refused-members-retired`** carries the
  judgement the conversion cannot make: whether an agent whose block was deleted
  should now carry a `json_schema` contract.
- **No deprecation window**, per the project's startup-stage posture.

### Describes and the liveness ledger

- `agent.structuredOutput` drops `[EXPERIMENTAL — not enforced]`: it states that the
  cloud AI runtime enforces it on every final answer and that the open framework
  edition does not run agents. Its ledger row moves `experimental` → `live`, citing
  the cloud readers (`agent-runtime.ts#compileStructuredOutput`,
  `ai-service.ts#AIService.settleFinalAnswer`) as attested by the cloud seat's
  reading at cloud `cb62c3ea`, `verifiedAt` 2026-10-02. `os lint` / `os validate` no
  longer warn `liveness-experimental-property` on an agent that sets it.
- `fallbackFormat`'s describe states what the runtime does with it: once the primary
  format's retries are spent, the last answer is checked against the fallback.
- `guardrails.blockedTopics`'s describe states the enforced match: an exact,
  case-sensitive match on the tool name, on `action_` plus the action type, or on
  the tool category.
- The generated agent reference page follows.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is
published, and tenant-authored agents were not measured. This repo authors no
`structuredOutput` outside `packages/spec`, and the cloud seat's reading found no
producer in cloud.

Clause-②: no (narrowing)

<!-- adr-0087: registered agent-structured-output-refused-members-removed, agent-structured-output-refused-members-retired -->
