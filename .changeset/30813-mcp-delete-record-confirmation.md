---
'@objectstack/mcp': patch
'@objectstack/spec': patch
---

feat(mcp)!: the MCP `delete_record` tool refuses a call without `confirm: true`, with `run_action`'s confirmation refusal

Clause-②: yes (narrowing) — the MCP `delete_record` tool refuses every call that does not carry `confirm: true`, where it deleted the record. The confirmation contract in `@objectstack/spec/contracts` (`AIActionConfirmation`, `ActionConfirmationRequiredDetails`) gains its second door in its docblock, and the error-code ledger lists `ACTION_CONFIRMATION_REQUIRED` under `@objectstack/mcp` as a second emitter; no shape changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing at rest records a tool call: what moves is the answer an MCP client gets for a delete_record call that does not carry the confirmation member. The fix is in the calling client, which adds one member to the call; there is nothing for a metadata migration to rewrite. -->

**BREAKING** accept-set narrowing at the MCP `delete_record` tool (`@objectstack/mcp`), over both transports (Streamable HTTP `/api/v1/mcp` and stdio): every MCP client that deletes is refused until it sends the confirmation member.

- **Before.** `delete_record({ objectName, recordId })` deleted the record. A delete is hard and permanent, and the tool's only safety signal was `annotations.destructiveHint`, a hint a client may ignore. A call carrying `confirm` was refused as an unknown key.
- **Now.** A call without `confirm`, or with `confirm: false`, is refused before the data bridge is reached, and nothing is read or deleted. A non-boolean `confirm` (the string `"true"`, `1`) is refused before that by the tool's closed input schema, with no code and no `details`, exactly as on `run_action`. The answer to an absent or `false` member is the refusal `run_action` gives an action whose author declared `ai.requiresConfirmation: true`: an `isError` result whose text is `{ "error": { "code": "ACTION_CONFIRMATION_REQUIRED", "message", "status": 428, "details": { "actionName": "delete_record", "objectName", "confirmationMember": "confirm" } } }`. `delete_record({ objectName, recordId, confirm: true })` deletes as before, under the same exposure, credential and permission checks. The tool schema advertises `confirm` as an optional boolean, and the tool description tells the agent to ask the human first, then retry.
- **Who moves.** An MCP client or agent that calls `delete_record`. A client that already handles `run_action`'s `ACTION_CONFIRMATION_REQUIRED` (read `details.confirmationMember`, ask the human, resend the same call with that member set to `true`) needs no change.

**The remedy.** Ask the human in the loop, then send the same `delete_record` call with `confirm: true` added beside `objectName` and `recordId`. The flag asserts an approval; it does not obtain one, and the gate makes forgetting loud without proving a human.

**The bounds, as decided.**

- REST `DELETE /api/v1/data/:object/:id` (the human path) is outside the gate and unchanged.
- `update_record` is not gated.
- No object is exempt: every object a caller may delete through `delete_record` takes the gate.
- Any future bulk-delete tool takes the same gate.

The member, the code, the status and the `details` shape are the contract `run_action` already serves (`AI_ACTION_CONFIRMATION_MEMBER` and `ActionConfirmationRequiredDetails` in `@objectstack/spec/contracts`), so an agent learns one retry for both tools. The MCP server's own skill (`GET /api/v1/mcp/skill`) teaches the member on `delete_record`.
