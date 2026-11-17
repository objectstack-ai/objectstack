---
'@objectstack/skills': patch
---

docs(skills): the AI and platform skills teach that a person confirms a gated MCP action, and that `run_action` and `resume_run` take no `confirm`

Clause-②: no
Metadata-protocol: none

objectstack-ai's MCP tool table no longer tells an agent to ask the human and retry `run_action` with `confirm: true`. The `run_action` row now says an action declaring `ai.requiresConfirmation: true` never runs on the call: the host's pending-confirmation service hands it to the person the call runs as and the answer is `status: 'pending_confirmation'` with a `pendingId`, a success the agent relays without retrying; an AI service account's refusal carries `details.reason: 'service_account'` at every action door. A paragraph under the table adds the rest: never send `confirm` to `run_action` or `resume_run` (a call carrying it is refused, on every action); a host with no pending-confirmation service refuses a gated call 428 with `details.reason: 'no_confirmation_service'`; and on a long-lived (stdio) server whose bridge serves these tools, a client that advertised form-mode `elicitation` is asked in the client, where `accept` runs the call once and a decline, a dismissal or five minutes without an answer refuse it (`declined`, `cancelled`, `timed_out`). The `delete_record` and `delete_records` rows are unchanged: those tools still read `confirm: true`.

objectstack-platform gains a sixth rule under `requires:`: AI-door confirmation is a service the host registers, an `IActionConfirmationService` under `'ai.actionConfirmation'`, and the open build ships none. Two restatements were removed from that file to pay for part of the rule: "Never rebuild what the platform owns." in the App / Platform Boundary intro, which the bullets under it carry, and the `HonoServerPlugin` row's note that `os dev` and `os serve` register it, which the boot sequence lists.

Three eval cases cover the teaching: an agent that retried with `confirm: true`, the answers to an in-client question together with the service-account refusal, and a host that wants its people to approve these calls in its app.
