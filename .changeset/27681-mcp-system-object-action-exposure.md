---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(mcp): an action on a `sys_*` object whose author exposed it to AI is listed and run over MCP, behind every gate the action already has

Clause-②: yes (widening: MCP `list_actions` / `run_action` / `resume_run` now admit a `sys_*` action that declares `ai.exposed: true`; `McpActionSummary` gains the optional `aiExposed`)
Metadata-protocol: none
Ruling-ref: #27681 ruling `6513869839` letter B

MCP refused every action on a `sys_*` object by its object name, ahead of the action's own AI opt-in, so no declaration could open one, while `POST /api/v1/actions/:object/:action` served the same action to the same caller. Now the name refusal yields to the action's own `ai: { exposed: true, description }` (ADR-0011), and to nothing else:

- **Where.** `run_action`, `list_actions` and `resume_run`, in the runtime bridge and in the `@objectstack/mcp` tool layer. An agent that lists sees exactly the system-object actions it may run.
- **What still runs behind the flag, unchanged.** The ADR-0066 D4 capability gate, the ADR-0126 §8 activation switch, the declared param contract, the `ai.requiresConfirmation` confirmation (428 `ACTION_CONFIRMATION_REQUIRED` without `confirm: true`), the subject load under the caller's row-level security, and for a `type: 'api'` action the target endpoint's own authorization.
- **No deployment switch.** `allowSystemObjects` keeps its meaning (the tool layer's filter) and opens nothing in the runtime: a `sys_*` action without the declaration stays refused there.
- **Nothing changes on day one.** No platform `sys_*` action declares an `ai` block, so every one of them stays hidden and refused until its declaration lands.
- **`McpActionSummary.aiExposed`** (optional) is how a bridge attests the author's opt-in to the tool layer, which never sees the declaration. A bridge that does not set it keeps every `sys_*` action hidden and refused, as before. The runtime bridge sets it on every action it lists.
