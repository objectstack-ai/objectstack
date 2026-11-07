---
'@objectstack/mcp': patch
---

fix(mcp): a coded refusal from a sandboxed hook or action body answers the body's own sentence, not the sandbox wrapper that names the hook

Clause-②: no
Metadata-protocol: none

A QuickJS hook or action body that throws with a declared `code` and `status` (for example `throw Object.assign(new Error('Locked.'), { code: 'RECORD_LOCKED', status: 409 })`) reached every MCP tool and the `objectstack://objects/{name}/records/{id}` resource with the sandbox's debug wrapper as its message, `hook '<name>' threw: Error: Locked.`, so an agent saw the hook's internal name. `/api/v1/data` answers the same throw with the body's sentence alone.

The MCP tools and the record resource now read that sentence the way the `/data` door does (`sandboxBusinessMessage`, `@objectstack/types`): `{ "error": { "code": "RECORD_LOCKED", "message": "Locked.", "status": 409 } }`. The code and status are unchanged. A coded refusal that does not come from a sandbox keeps its own message byte for byte, and a sandboxed body that crashed keeps today's message.

This supersedes one sentence of the `@objectstack/mcp` note for the record data tools' code-less throw ("A thrown error that carries a `code` is answered exactly as before"): a coded refusal from a sandboxed body now answers its inner sentence; its code and status are still answered as before.
