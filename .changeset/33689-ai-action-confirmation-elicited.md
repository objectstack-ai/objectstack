---
'@objectstack/spec': minor
---

feat(spec)!: a declared-gated action on an AI door is confirmed by a person through MCP elicitation, never by the caller's own `confirm: true`

Clause-②: yes (narrowing) — the contract stops counting a caller's `confirm: true` on an action declaring `ai.requiresConfirmation: true` and refuses an MCP client that did not advertise `elicitation`; `@objectstack/spec/contracts` gains `AI_ACTION_CONFIRMATION_CAPABILITY`, `ACTION_CONFIRMATION_REFUSAL_REASONS`, `ActionConfirmationRefusalReason` and the optional `ActionConfirmationRequiredDetails.reason`.
Metadata-protocol: semantic
Skills-docs: follow-up — `skills/objectstack-ai/SKILL.md` (the MCP tool table: `run_action` / `resume_run` "refused with the same 428 unless the call sends `confirm: true`") teaches the member contract; it moves with the change that implements the doors, together with the MCP-served skill text (`packages/mcp/src/skill-md.ts`, `ui/apps/console/src/pages/developer/objectstack-skill.ts`) and the `ToolSchema` prescription in `packages/spec/src/ai/tool.zod.ts`, which describe the door that runs today.

<!-- adr-0087: registered action-requires-confirmation-elicited -->

**BREAKING** for an MCP client, an agent or a script that runs an action declaring `ai.requiresConfirmation: true` through `run_action` or `resume_run` by sending `confirm: true` itself. Ruled by the account owner: 「3826 照建议（征询版）」.

The contract in `@objectstack/spec/contracts` (`AI_ACTION_CONFIRMATION_CAPABILITY`, `contracts/ai-service.ts`) now says:

- The server asks the person: after every other gate passes and before anything runs, it sends one MCP `elicitation/create` request (form mode) to the client the call arrived on, naming the action, the object and the record.
- The door reads the `elicitation` capability the client sent at `initialize`. A client that did not advertise it is refused with `428 ACTION_CONFIRMATION_REQUIRED` and `details.reason: 'elicitation_unsupported'`; the message tells the person to use a client that supports confirmation, or to act in the app.
- `accept` runs the call once, under the caller's permissions, and nothing is stored for the next call. `decline`, `cancel` (an error answer or a dropped connection included) and no answer within the door's bound are refused with reason `declined`, `cancelled` or `timed_out`, and nothing runs.
- The caller's `confirm` never counts on such a call, with or without an elicitation.
- An AI service account acting for itself is refused whatever it sends, unchanged (ADR-0151 D3 rule 3), now with reason `service_account`; no elicitation is sent to it.
- Outside the amendment: the MCP `delete_record` and `delete_records` gates still read `confirm: true`, and REST `/actions` stays outside the gate for a person.

The doors switch in the change that implements this contract; until then they still gate on the member, and a refusal without `details.reason` comes from such a door. The semantic entry `action-requires-confirmation-elicited` carries the same notice into the upgrade guide and `os migrate meta`.

What changes for a caller:

- FROM confirm with the person yourself, then send `confirm: true` on `run_action` / `resume_run` TO advertise `elicitation` (form mode) at `initialize` and let the server ask the person; send no `confirm`.
- FROM a script or agent that runs a gated action unattended with `confirm: true` TO no replacement: a person runs the action, in an elicitation-capable client or in the app, or the action's author declares `ai.requiresConfirmation: false` where it is safe unattended.
