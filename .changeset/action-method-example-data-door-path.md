---
"@objectstack/spec": patch
---

fix(spec): `ActionSchema.method`'s worked example now names the shipped data door

The `method` docblock's only worked example of a `type: 'api'` PATCH pointed at
`/api/v1/sys_api_key/{id}` — a path the router never mounts. The shipped data
door composes as `getApiBasePath()` + `crud.dataPrefix` + `/:object/:id`, so the
update endpoint is `PATCH /api/v1/data/:object/:id` on a default host. The `/data`
segment was missing, and nothing catches the difference at authoring time:
`objectstack validate` does not check `target`, `type: 'api'` has no author-time
route validation, and the action parses green, renders, is clickable, and 404s at
the click — the same silent shape as an unregistered handler, arriving through a
doc example. This mattered more than an ordinary stale comment because it is the
one worked example of that route on the published contract.

The example now reads `/api/v1/data/sys_api_key/${ctx.recordId}`. The object name
is unchanged on purpose — the error was the path STRUCTURE, not which object the
example picks — and the id is spelled with the `${ctx.X}` interpolation that
`target`'s own docblock documents, so the two placeholder conventions in this one
schema stop reading as interchangeable (a bare `{recordId}` is `newTabUrl`'s
convention alone).

Two things the corrected example now says that the old one did not:

- **The full path is host-dependent.** Under `enableProjectScoping` with
  `projectResolution: 'required'` only
  `/api/v1/environments/:environmentId/data/:object/:id` is registered, so even a
  correctly spelled unscoped path still 404s on such a host. An author copying a
  full path needs to know which base their host mounts.
- **A single-record field write has a declarative form now.** `operation: 'update'`
  with `patch` writes the current record on the data plane as the caller, with no
  endpoint, method or id placeholder to spell. The `type: 'api'` + `PATCH` form
  remains the way to call an explicit endpoint.

Documentation only: no schema member, no `.describe()` and no runtime behaviour
changes. It is a `patch` rather than a `skip-changeset` because the corrected text
publishes — `@objectstack/spec` ships `dist/**` and `src/**/*.zod.ts`, and both
carry this docblock.
