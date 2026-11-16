---
'@objectstack/runtime': minor
'@objectstack/mcp': minor
---

feat(runtime,mcp): the MCP `run_action` and `resume_run` tools ask the person in their client when it advertises `elicitation`

Clause-②: no
Metadata-protocol: semantic (at the MCP door, an author's `ai.requiresConfirmation: true` is confirmed in place for a client that advertises `elicitation`. The dev confirms the level against the diff and, if it holds, adds the PR body's `Skills-docs:` line.)
Skills-docs: follow-up owed — skills/objectstack-ai/SKILL.md (the `run_action` row of the MCP tool table; the same row the hand-off follow-up #34210 rewrites)

This release implements step 1 of the amended confirmation contract (`AI_ACTION_CONFIRMATION_CAPABILITY`, `@objectstack/spec/contracts`) on the long-lived MCP server, the one behind the stdio transport.

- When the client advertised `elicitation` at `initialize` (an empty `elicitation: {}` reads as form mode), a call on an action whose author declared `ai.requiresConfirmation: true` is asked in place: after every admission gate, the subject load and the caller-scope subject verdict included, the server sends one `elicitation/create` request in form mode, related to the open tool call, naming the action, the object and the record (its id, and its title when the subject load read one). Only the result's `action` is read.
- `accept` runs the call exactly once, as any admitted call, under the caller's permissions; the next call is asked again. `decline` is refused `428 ACTION_CONFIRMATION_REQUIRED` with `details.reason: 'declined'`. `cancel`, an error answer, a tool call cancelled by the client and a connection that closes first are refused with `reason: 'cancelled'`. No answer within the door's bound, `ACTION_CONFIRMATION_ELICITATION_TIMEOUT_MS` (five minutes, exported by `@objectstack/mcp`), is refused with `reason: 'timed_out'`, and a later answer runs nothing. Nothing is handed off on any of these answers.
- `resume_run` is asked the same way for the run's action: `accept` resumes the parked run with the call's values; any other answer refuses the call and the run stays paused.
- An AI service account is refused before anyone is asked, as before (`reason: 'service_account'`).
- Unchanged: a client that does not advertise `elicitation` takes the hand-off (or the `no_confirmation_service` refusal) exactly as before, and is never refused for that alone. The Streamable HTTP door builds a fresh server per request that never read the client's `initialize`, so it cannot elicit, and every caller there is handed off as before; its answers stay plain JSON.
- `McpActionBridge.runAction` and `resumeRun` take an optional third argument, `door: { elicitConfirmation }` (`McpActionCallDoor`), which the tools pass only when the call can be elicited. `@objectstack/mcp` also exports `actionConfirmationElicitorFor`, `actionConfirmationQuestion` and the types `McpActionConfirmationSubject`, `McpActionConfirmationAnswer` and `McpActionConfirmationElicitor`.
