---
"@objectstack/client": minor
---

feat(client): `environments.delete` gains `purge` and documents the hosted control plane's two-step delete (#17636)

The hosted control plane's `DELETE /api/v1/cloud/environments/:id` follows cloud ADR-0014: a live environment is **archived**, and only a second call with `?purge=1` on the now-archived environment tears it down. `?force=1` confirms a production environment and is never a purge. The SDK sent `force` only, so an SDK caller could archive an environment but never purge one.

- `opts.purge?: boolean` sends `?purge=1`. It combines with `force`: a production environment is torn down with `{ force: true }`, then `{ force: true, purge: true }`. Calls that pass no options, or `force` alone, build exactly the URL they built before.
- The return type declares the two answers the route actually sends, discriminated by `deleted`:
  - archive: `{ environmentId, deleted: false, archived: true, purgeDeferred, retentionDays, warnings, message }`
  - teardown: `{ environmentId, deleted: true, purged: true, warnings }`

  Both members carry every key the old declaration named (`deleted`, `environmentId`, `warnings`), so existing reads still compile.
- The JSDoc no longer describes a one-call cascade delete: a live environment is archived, `purge` acts only on an archived environment, `force` is the production confirmation, and a `failed` environment is torn down in one call.
- `organizations.delete`'s JSDoc no longer claims that server-side hooks tear down the organization's environments. No hook does; delete each environment first.

Graded `minor`: a purely additive widening of a published method's accepted options and declared answer (the "WHICH LEVEL" rule in `.github/workflows/pr-automation.yml`). Nothing is removed or renamed.
