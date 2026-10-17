---
"@objectstack/spec": patch
---

docs(spec): `IHttpRequest.body`'s TSDoc says what a handler reads, and that reading it may refuse

Clause-②: no

- **What it is.** The parsed JSON document for `application/json`, or the parsed fields of a `multipart/form-data` or `application/x-www-form-urlencoded` form; `{}` when the request carries no body.
- **It may refuse.** An implementation that cannot parse the body, or does not read its media type, throws from the read instead of handing over an invented value. The standard transport (`@objectstack/plugin-hono-server`) does, and answers 400 `INVALID_REQUEST` itself, replacing whatever the handler wrote. So a handler must not catch the refusal and carry on.
- **Raw bytes.** A handler that needs them reads `rawBody()` and never reads `body`.
- **Unchanged:** the type (`body?: any`), every other member, and every runtime behaviour. This is prose in the shipped `.d.ts` only.
