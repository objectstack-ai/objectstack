---
'@objectstack/runtime': patch
---

fix(runtime): a `/data` write a hook refuses answers on the dispatcher path as it does on the REST routes

Clause-②: no
Metadata-protocol: none

A host that serves `/data` through `HttpDispatcher.dispatch()` (in this repository, `@objectstack/hono`'s `createHonoApp`) answered a sandboxed hook's declared refusal differently from `@objectstack/rest`'s `/data` routes:

- **A code of the hook's own** (one its `refusals` catalogue declares, such as `OVERLAP`): `500 INTERNAL_ERROR`, with no `userMessage` and no `details.refusals`. The person refused saw a server error instead of the app's sentence.
- **A registered code** (such as `RESOURCE_CONFLICT`): the declared status and the refusal lines, but the `userMessage` was not cut at 500 characters as the REST routes cut it.

`dispatch()` now answers such a refusal itself, with the REST routes' answer for the same throw: the declared status, the status's registered `code` with a hook's own code beside it as `declaredCode`, the hook's sentence, the `userMessage` cut at 500 characters, every reason's line whole on `details.refusals`, and `Vary: Accept-Language`. A hook refusal that declares `PERMISSION_DENIED` is answered the same way. A hook body that crashed, the sandbox's own faults and every other throw are answered as before.

Nothing to migrate.
