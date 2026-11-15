---
'@objectstack/skills': patch
---

docs(skills): the automation skill says a flow that runs after a record change may not retry an inline outbound call

Clause-②: no
Metadata-protocol: none

The platform refuses a flow whose start node runs it after a record change (`record-after-create`, `-update`, `-delete`, `-insert`, `-write`) when a retry reaches an `http` node without `durable: true` or a `connector_action` node (`flow-after-save-inline-retry`), because the save waits for the run. The published automation skill now says so, so an author following it is not refused at the save door first.

- **`@objectstack/skills`** (`objectstack-automation`, `SKILL.md`): the `try_catch` row says that in a `record-after-*` flow neither its `retry` nor the flow's `errorHandling.strategy: 'retry'` may reach an inline `http` or `connector_action` node, since the save would wait out every attempt. The `http` row gives the fix: `durable: true`, which queues the request on the messaging HTTP outbox, or where none is wired sends it once in the background, unretried, so the run gets no response. The `connector_action` row gives its fix: drop the retry, or run the flow on demand or on a schedule. A credential still never goes in an `http` node's `url` or `headers`, as the `http` row already says.
- To pay for those words, three sentences that restate text with another home are cut: the screen row's `progress` field list (home: `content/docs/automation/flows.mdx`, the screen progress table), the trigger note's "unless you must modify or reject the record" (home: the trigger table's before rows), and Verify your work's bare-reference sentence and command block (home: **objectstack-formula** § Verify your work and its flow-condition note). No schema, runtime or behaviour changes.
