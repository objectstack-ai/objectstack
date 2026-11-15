---
'@objectstack/spec': minor
---

feat(spec)!: a declared-gated action on an AI door is confirmed by a person, elicited in the MCP client or handed off to the app, never by the caller's own `confirm: true`

Clause-②: yes (narrowing) — once the doors implement the contract, a caller's `confirm: true` stops counting on an action declaring `ai.requiresConfirmation: true`; `@objectstack/spec/contracts` gains `AI_ACTION_CONFIRMATION_CAPABILITY`, `ACTION_CONFIRMATION_REFUSAL_REASONS`, `ActionConfirmationRefusalReason`, `ActionConfirmationHandOff`, `ActionConfirmationPending`, `IActionConfirmationService` and the optional `ActionConfirmationRequiredDetails.reason`.
Metadata-protocol: semantic
Skills-docs: follow-up — `skills/objectstack-ai/SKILL.md` (the MCP tool table: `run_action` / `resume_run` "refused with the same 428 unless the call sends `confirm: true`") teaches the member contract, which is still the door's behaviour in this release; it moves with the change that implements the doors, together with the MCP-served skill text (`packages/mcp/src/skill-md.ts`, `ui/apps/console/src/pages/developer/objectstack-skill.ts`) and the `ToolSchema` prescription in `packages/spec/src/ai/tool.zod.ts`.

<!-- adr-0087: registered action-requires-confirmation-elicited -->

**BREAKING, when the implementing change ships**, for an MCP client, an agent or a script that runs an action declaring `ai.requiresConfirmation: true` through `run_action` or `resume_run` by sending `confirm: true` itself. Ruled by the account owner: 「3826 照建议（征询版）」, amended 「我开始重新接受你说的主流方案，就是推送到客户的手机端」 and 「比如最简单的我可以先推送到邮件」.

⚠ In the release that carries this changeset nothing changes at any door: `run_action` and `resume_run` still run a declared-gated action on `confirm: true` and refuse it without, over stdio and Streamable HTTP alike. Keep sending `confirm: true` until a release's changelog says the doors confirm by elicitation. What ships now is the contract the doors move to, in `@objectstack/spec/contracts` (`AI_ACTION_CONFIRMATION_CAPABILITY`, `contracts/ai-service.ts`):

- After every admission gate (the subject load included) and before anything runs, the person is asked, in three steps: **elicit** when the client advertised `elicitation` at `initialize` and the door can carry it (one `elicitation/create`, form mode); otherwise **hand off** to the host's pending-confirmation service (`IActionConfirmationService`), answering `status: 'pending_confirmation'` with a pending id and a plain message, the person then approving or rejecting in the app, where the action runs as them with every gate and permission re-checked; **refuse** only when the host has no such service (`428 ACTION_CONFIRMATION_REQUIRED`, `details.reason: 'no_confirmation_service'`).
- An elicited `accept` runs the call once; `decline`, `cancel` (an error answer or a dropped connection included) and no answer within the door's bound are refused with reason `declined`, `cancelled` or `timed_out`. A call refused at confirmation may have read its subject and writes nothing.
- The approve and reject doors of the pending-confirmation service refuse an AI identity.
- The caller's `confirm` never counts on such a call.
- An AI service account acting for itself is refused whatever it sends, unchanged (ADR-0151 D3 rule 3), with reason `service_account` on every door; it is neither elicited nor handed off.
- An elicited `accept` proves the client answered, not that a person did; a hand-off is decided by a person in the app.
- Outside the amendment: the MCP `delete_record` and `delete_records` gates still read `confirm: true`, and REST `/actions` stays outside the gate for a person.

The semantic entry `action-requires-confirmation-elicited` carries the same notice, with the same timing, into the upgrade guide and `os migrate meta`.

What changes for a caller, from the release whose doors implement it:

- FROM confirm with the person yourself, then send `confirm: true` on `run_action` / `resume_run` TO advertise `elicitation` (form mode) at `initialize` and let the server ask the person, or, from a client that cannot, relay the pending answer's message and let the person decide in the app; `confirm` then confers nothing.
- FROM a script or agent that runs a gated action unattended with `confirm: true` TO a pending answer the person decides in the app (or a refusal on a host with no pending-confirmation service); where the action is safe unattended, its author declares `ai.requiresConfirmation: false`.
