---
'@objectstack/runtime': patch
---

`POST /api/v1/automation` answers 400 `VALIDATION_FAILED`, not 500, for a malformed flow definition (#8055)

Registering a flow whose definition the engine refuses — a node missing `label`, a node key the schema does not declare, a malformed ADR-0031 `try_catch` region, or a config key the node type's descriptor does not declare (#4277) — was answered **500 `INTERNAL_ERROR`**. The refusals were all correct; only the class was wrong. It is now **400 `VALIDATION_FAILED`** carrying an ADR-0114 `details.fields[]`, the same class the sibling `POST /automation/:name/toggle` route moved to in #7535.

Two consequences the old class caused: a retry-on-5xx client re-sent a request that can never succeed, and an agent authoring a flow read "the server broke" instead of "your metadata is wrong" — the inverse of the self-correcting message #4277 was designed to deliver. A raw Zod issue array (`{expected, code, path}`) also stopped reaching the wire; the house envelope's `fields[]` carries the located fault instead.

**Which bodies are refused is unchanged** — a definition that registered before still registers, and every one that was refused is still refused, with the engine's own message intact (a 400 never reaches the 5xx message sanitiser, so the #4277 prescription survives verbatim). An engine error that declares its own `.status` / `.statusCode` still keeps it.
