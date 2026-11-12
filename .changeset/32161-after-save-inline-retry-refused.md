---
'@objectstack/service-automation': minor
'@objectstack/lint': minor
---

feat(automation)!: a flow that runs after a record change may not retry an inline outbound call, so a record save never waits through a retry ladder (`flow-after-save-inline-retry`)

Clause-②: no (narrowing) — the engine's flow registration, `os validate`, `os build`, `os lint` and the flow live save and publish doors refuse a flow they accepted before; `@objectstack/lint` also exports the rule id `FLOW_AFTER_SAVE_INLINE_RETRY`, and `RULE_EXPLANATIONS` gains its entry.
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-automation/SKILL.md (the `http` and `try_catch` rows); taught here in content/docs/automation/flows.mdx (Try / catch / retry) and in `os explain flow-after-save-inline-retry`.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: FlowSchema keeps its shape and meaning, and a flow running after a record change is now refused when an inline outbound call in it is retried. No rewrite keeps what the author meant: `durable: true` changes what the flow sees (a delivery id, not the response), and dropping a retry changes what the flow does on failure, so the author chooses. -->

**BREAKING** accept-set narrowing at flow registration (`POST /api/v1/automation`, the clone door, the boot bind of stored rows) and, through the gating `lintFlowPatterns` rule, in `os validate` / `os build` / `os lint` and at the flow doors (`PUT /api/v1/meta/flow/NAME` live save, the per-item and package publish; Studio, REST and MCP authors).

- **Before.** A flow whose start node runs it after a record change (`record-after-create`, `-update`, `-delete`, `-insert`, `-write`) could hold an `http` or `connector_action` node that a retry reaches: a `try_catch` whose `retry.maxRetries` is 1 or more (its `try` region, at any depth) or the flow's `errorHandling: { strategy: 'retry' }`. The record-change trigger waits for the run, so while the outside system was down the user's save waited through every attempt and every backoff delay (a three-retry ladder held one save for 8.8 s).
- **Now.** The engine refuses to register such a flow, naming the flow, each node, what retries it and the fix; `POST /api/v1/automation` answers it with a 4xx, and a row stored before this release is refused at boot and reads `registration: refused` beside its stored body. `flow-after-save-inline-retry` (severity `error`) names the same nodes at `flow 'NAME' · node 'ID'`: a live save and a publish answer `422 INVALID_METADATA` with the rule in `issues[]`, and a draft save still stores, with the finding in its `_diagnostics`.
- **Not judged.** An `http` node with `durable: true` (queued on the messaging HTTP outbox); an inline call no retry reaches, including one in a `try_catch`'s `catch` region; a before-trigger, scheduled, API or on-demand flow; a `subflow` node's callee, which is another flow judged on its own trigger.
- **No default retry ladder changes.** A retry policy's `maxRetries` already defaults to 0, and an `http` node has no retry of its own: the only ladders are the ones an author writes.

**What an author does.** For a refused `http` node: set `durable: true` on it; the request is queued on the messaging HTTP outbox, which retries it in the background, and the save no longer waits (the flow then gets a delivery id, not the response). For a refused `connector_action` node, which has no background path: remove the retry around it, or make the call through an `http` node with `durable: true`. Or run the flow on demand or on a schedule instead of after the save.
