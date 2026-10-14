---
'@objectstack/mcp': patch
---

fix(mcp): `run_action` and `resume_run` withhold a `PERMISSION_DENIED` refusal's `details`, as the data tools already do (#23529)

**What was wrong.** The two action tools render a thrown coded refusal through `errorResultFromThrown`, which served the refusal's `details` verbatim. The security gate's `PERMISSION_DENIED` carries the caller's own positions and permission-set names in `details`. Those are server-side diagnostics. The runtime dispatcher and the REST actions door withhold them, and the data tools and the record resource never serve a refusal's `details`. The action tools were the one place on the MCP surface that still served them, and `executeDeclarativeUpdateAction` writes as the caller, so the gate's write-side refusal reaches that renderer.

**What a client reads now.** A `PERMISSION_DENIED` on `run_action` or `resume_run` answers the shape the data tools answer: `isError: true`, and the text is the JSON `{ "error": { "code", "message", "status" } }` with no `details`. The code, the message and the status are unchanged.

Every other coded refusal on the two tools is unchanged. `ACTION_CONFIRMATION_REQUIRED` keeps the `details` that name the action and the member to set, and `resume_run`'s other refusals keep theirs. A throw with no code still answers its bare message.
