---
"@objectstack/docs": patch
---

fix(docs): four pages enumerating the flow refusal codes now name `FLOW_INPUT_SCHEMA_INVALID` (#13720)

`FlowRefusalCode` gained a fourth member in `packages/runtime/src/flow-dispatch-status.ts`
(`b6d3d76b5`), answered `422` and classified never-dispatched. Three pages were updated with
it; four others enumerate the same union and were not, so each stated the enumeration as
**complete** while it was one code short — a teaching surface telling a reader that a status
they will really receive does not exist.

| page | the row that was short |
|:---|:---|
| `content/docs/api/declarative-endpoints.mdx` | the `type: 'flow'` delegation row |
| `content/docs/api/plugin-endpoints.mdx` | `POST /automation/:name/trigger` |
| `content/docs/protocol/kernel/http-protocol.mdx` | the declared-endpoint `type: 'flow'` answer row |
| `content/docs/ui/actions.mdx` | the `type: 'flow'` over-REST row |

Prose only — no schema, no runtime behaviour and no generated artifact moves. The two
generated reference pages (`references/api/contract.mdx`,
`references/api/error-code-ledger.mdx`) already carried the code, which is why the
generator needed nothing here.

**Which group the new code joins was read off the source, not inferred from the status.**
`classifyFlowRefusal` tests `FLOW_INPUT_SCHEMA_INVALID` inside the
`── never dispatched: the producer says WHICH refusal ──` arm block, above the
`result.status === 'failed'` arm that answers `400 FLOW_FAILED`. `ui/actions.mdx` is the
one page that splits its enumeration into "a run that ran and was rejected" versus "a
dispatch that never happened", so the code is placed in the second group there; putting it
beside `FLOW_FAILED` would have said the run started.

`422` is now carried by two codes (`FLOW_NO_START_NODE` and `FLOW_INPUT_SCHEMA_INVALID`).
Each page spells the status together with its code, so every entry stays a self-contained
pair rather than a claim about what `422` alone means — the discriminator is `error.code`,
which is what `http-protocol.mdx` already tells readers to branch on. The full table with
per-code guidance stays where it is, in `content/docs/automation/flows.mdx`.
