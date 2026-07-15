---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(security): enforce the `ai.exposed` opt-in on the MCP action surface (#2849)

Business-action bodies execute as trusted code: their engine facade carries no
`ExecutionContext`, so a body's internal reads/writes bypass RLS/FLS/CRUD and
tenant scoping — the caller's permissions and an agent's ADR-0090 D10 data
ceiling do NOT bound what an invoked action does. The MCP `run_action` bridge
nevertheless allowed invoking ANY headless action, ignoring the spec's
`ai.exposed` governance gate (ADR-0011) entirely.

The MCP bridge now fail-closes on `ai.exposed`: `list_actions` only enumerates
— and `run_action` only dispatches — actions the app author explicitly opted
into the AI surface with `ai: { exposed: true, description }`. Flow-type
actions additionally receive the caller's identity (`userId` / `positions` /
`permissions` / `tenantId`) as a proper `AutomationContext` (replacing the
former `triggerData` envelope the engine never read), so a `runAs: 'user'`
flow enforces RLS as the invoker instead of running unscoped (ADR-0049).
Trusted body dispatches are now audit-logged on both the MCP and REST action
paths, and the MCP tool/README/docs wording no longer claims action bodies run
under the caller's RLS.

Migration: actions that should stay invokable by AI agents through MCP must
declare `ai: { exposed: true, description: '…' }` (≥40-char description). All
other invocation surfaces (UI, REST `/actions/...`) are unchanged.
