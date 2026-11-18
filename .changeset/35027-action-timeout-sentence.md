---
'@objectstack/runtime': patch
---

fix(runtime): an action body that runs out of time answers a sentence naming the action and its limit, at the same `500 INTERNAL_ERROR`

Clause-②: no
Metadata-protocol: none

An action body that hit its time limit answered `500 INTERNAL_ERROR "Internal server error"` on the `/actions` door and MCP `run_action`, naming neither the action nor the limit, so a caller (an AI agent above all) could not tell a slow action from a broken platform. It now answers the same status and code with the sentence `Action 'NAME' timed out: it exceeded its N ms time limit and was stopped.`, where `N` is the CPU-time budget the body ran under (its `body.timeoutMs`, the enclosing timeout, or the `OS_SANDBOX_ACTION_TIMEOUT_MS` default). A body stuck waiting on platform calls past the wall-clock ceiling answers `Action 'NAME' timed out: it exceeded its N ms time limit while waiting on platform calls, and was stopped.` Both doors read one reader, so they answer the same sentence. The server log line is unchanged (`action 'NAME' exceeded CPU budget of Nms (after P pump iterations)`).

Nothing else moves. A body that crashes (a `TypeError`, say) still answers the sanitised `500 "Internal server error"`, because its own text may carry the data it was reading. A hook's or a job's timeout is unchanged: it carries no caller sentence, and the `/data` door and import rows answer it as before. The action's sentence is declared at `500`, so the `/data` door, which relays a sandbox sentence only below the server band, never serves it as business text.
