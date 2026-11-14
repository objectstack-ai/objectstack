---
'@objectstack/service-automation': minor
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(automation)!: a flow that runs after a record change is not armed while a subflow it calls retries an inline outbound call, and a durable `http` node with no outbox does not hold the save

Clause-②: yes (narrowing) — a record-triggered flow the engine armed before is now registered but not armed when a `subflow` / `map` child retries an inline call; `@objectstack/spec/contracts` gains the `FLOW_UNBOUND_CAUSES` value `retried_callout_in_subflow`.
Metadata-protocol: semantic
Skills-docs: none — taught in content/docs/automation/flows.mdx (Try / catch / retry) and in `os explain flow-after-save-inline-retry`; no skill under `skills/**` teaches the subflow or the no-outbox case.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and every flow that registered before still registers. One flow is no longer armed, and one durable request on a host with no outbox is sent in the background; no rewrite of a stored flow keeps what its author meant, so the author chooses the fix. -->

**BREAKING** for two shapes of a flow whose start node runs it after a record change (`record-after-create`, `-update`, `-delete`, `-insert`, `-write`). Ruling D on the after-save retry card: the record save never waits on an external system.

- **A retried inline call in a subflow.** Before, the after-save rule (`flow-after-save-inline-retry`) judged only the flow's own nodes, so a flow whose `subflow` or `map` node called a child holding a retried `http` (without `durable: true`) or `connector_action` node armed, and while the outside system was down the save waited through every attempt and backoff delay. The retry counts wherever it sits on the call chain: the child's own `try_catch` retry or `errorHandling: { strategy: 'retry' }`, a deeper child's, or a retry around the call in the caller. Now the arming gate declines such a flow, after its disabled-subflow, save-notice and region halves: it still registers, is not armed, and warns once, naming the call node, the retried node, the flow that holds it and what retries it. `GET /automation/_status` reports it `bound: false` with that reason and the new `unboundCause` value `retried_callout_in_subflow`, and the Studio's run note says it in plain words. Whenever a flow is registered, every flow whose calls reach it is judged again, so the decline does not depend on load order, and a child republished with the call durable (or unretried) arms the caller again.
- **A durable `http` node on a host with no messaging HTTP outbox.** Before, such a node fell back to the inline call on every path, so on the save path a retry around it held the save through the whole ladder. Now, on the save path (an after-record-change run, or a `subflow` / `map` child of one), the request is sent once in the background and the run does not wait for it or see its outcome, as with the outbox: the node answers `{ enqueued: false, background: true }`, and a failed send is logged at `error` and is not retried. Off the save path the fallback is the inline call, as before.
- **Not changed.** Registration, the save door and `objectstack validate` accept the same flows as before. A flow that does not run after a record change, an inline call nothing retries, and a durable `http` node with an outbox wired behave as before.

**What an author does.** For a declined flow: in the child the warning names, set `durable: true` on the `http` node, or remove the retry around it (a `connector_action` has no background path: remove the retry, or run that work on demand or on a schedule). For a host with no outbox: wire the messaging service with reliable delivery so a durable request is queued and retried, rather than sent once.
