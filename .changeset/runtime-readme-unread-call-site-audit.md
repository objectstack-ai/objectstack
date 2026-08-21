---
"@objectstack/runtime": patch
---

Repair six false API claims in the published `@objectstack/runtime` README
(#10368). The README is in the package's `files` array, so it is the page npm
renders — a reader following it wrote code that could not compile.

Found by hand-adjudicating every call site in that document that
`check:published-readme-exports` reports under `NOT read:` — receivers built
from free variables, parameters and globals, which neither the gate nor a human
reader can type by looking. 30 sites on 17 receivers were read; the repairs below
are what came out.

- `engine.update('user', user.id, { name: 'Jane' })` → `engine.update('user',
  { id: user.id, name: 'Jane' })`. `IDataEngine.update` is
  `(objectName, data, options?)`; there is no `id` parameter. A by-id update is
  identified by a truthy scalar `data.id` (or `options.where.id`) — the rule
  `resolveEngineUpdateDispatch` in `@objectstack/metadata-core` defines.
- `engine.delete('user', user.id)` → `engine.delete('user', { where: { id: user.id } })`.
  `IDataEngine.delete` is `(objectName, options?)`; the id belongs in
  `options.where.id` (`assertEngineDeleteDispatch`). Passing it positionally
  landed the id in the options bag.
- The **Interface Methods** bullet list restated both wrong signatures, so it is
  corrected in the same edit — a repaired example beside a bullet list that still
  contradicts it is not a repair.
- `reply.code(429).send({ retryAfterMs })` in the rate-limiting recipe →
  `res.status(429).json({ retryAfterMs })`. `reply.code()` is Fastify; this
  package's HTTP contract is `IHttpResponse`, which spells the step
  `status(code)` and whose `send` takes `string | Uint8Array | ArrayBuffer`, not
  an object. The `docs/HARDENING.md` recipe the same section links to already
  answers 429 through the framework's own JSON responder.
- `status: res.statusCode` in the middleware example → dropped.
  `IHttpResponse` has no `statusCode`; a response's status is observed through
  `IHttpServer.afterResponse` (`HttpResponseObservation.status`), not read off
  the response inside middleware.
- The `PluginContext` interface block declared `logger: Console` and
  `getKernel?(): any`. The real contract (`@objectstack/core`) is
  `logger: Logger` and a required `getKernel(): ObjectKernel`.

Documentation only — no runtime, type or export change.
