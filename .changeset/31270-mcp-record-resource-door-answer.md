---
'@objectstack/mcp': patch
---

fix(mcp): the record resource answers a code-less throw as `/api/v1/data` does, so a sandboxed hook abort no longer shows the hook's name

Clause-②: no
Metadata-protocol: none

`objectstack://objects/{name}/records/{id}` answered a thrown error that carried no `code` with `{ "error": <thrown message> }`. For a sandboxed hook body's `throw new Error('…')` that message is the runner's debug wrapper, `hook '<name>' threw: Error: …`, so a client saw the hook's internal name, and a fault's own text (a driver error, a crash) reached it verbatim. `GET /api/v1/data/{name}/{id}` answers the same throws `400 HOOK_ABORTED` with the body's sentence, or `500 INTERNAL_ERROR` `Internal server error`.

The resource now answers a code-less throw with the `/data` door's answer, read the way the record data tools read it since the code-less fix for those tools (`mapDataError`, `@objectstack/types`), in the members the resource already uses: `{ "error", "code", "status" }`. A resource reader should expect `code` and `status` on a code-less throw too now. `status` is always set, and `code` is set whenever the door names one:

- an undeclared sandboxed hook abort: `{ "error": "<the body's sentence>", "code": "HOOK_ABORTED", "status": 400 }`;
- a bare `Error`, or a sandboxed body that crashed (with or without a declared code): `{ "error": "Internal server error", "code": "INTERNAL_ERROR", "status": 500 }`. The thrown text is logged once on the server as a `[5xx]` line instead of being sent.

A coded refusal is answered as before.
