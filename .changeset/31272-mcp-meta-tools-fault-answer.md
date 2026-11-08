---
'@objectstack/mcp': patch
---

fix(mcp): the metadata tools and `list_actions` answer a fault the way `/meta` does, never with the fault's raw text

Clause-②: no
Metadata-protocol: none

When the bridge member behind `list_objects`, `describe_object`, `validate_expression` or `list_actions` faulted, the tool handed the agent the fault's raw text (`socket hang up`), or, for a driver's own string code, `{ "error": { "code": "SQLITE_BUSY", "message": "SQLITE_BUSY: database is locked" } }` as if a rule had refused. The `/meta` read doors answer the same throws `500 INTERNAL_ERROR` `Internal server error` and `500 DATABASE_ERROR` `Internal data error`, and log the fault.

These four tools now ask the reader the `/meta` doors answer a fault with (`mapDataError` and `isServerFault`, `@objectstack/types`). A throw that reader answers with a 5xx renders as `{ "error": { "code", "message", "status" } }` with the same code, sentence and status, and the thrown text is logged once on the server (`logServerFault`) instead of reaching the agent. A declared 5xx keeps its code and status and has its prose withheld, as `/meta` withholds it: the object-schema reads' `FIELD_VISIBILITY_UNRESOLVED` / 503 now answers `Internal server error` as its message, which is what the `/meta` object read answers. A refusal (a 4xx) is unchanged: a declared refusal keeps its code, sentence and status, and a code-less one keeps its bare message.
