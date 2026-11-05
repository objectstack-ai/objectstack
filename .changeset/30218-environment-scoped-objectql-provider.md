---
'@objectstack/rest': patch
---

fix(rest): the transactional `POST /batch`, the `/meta` object-state and published reads, and the meta read gate's disabled-package check use the request's environment's data engine when one REST plugin fronts many environments

Clause-②: no
Metadata-protocol: none

- **What was wrong.** On a host that mounts one `RestApiPlugin` in front of many environment kernels (the hosted runtime shape), the `objectql` provider read the HOST kernel's engine whatever environment it was asked for, and the unscoped (hostname-routed) mount asked it for no environment at all. `POST /batch` therefore opened its transaction on the host's engine and sent its update and delete ops through it, while its create ops went to the environment's own protocol, joined to the host's transaction. `GET /meta/object/:name/state/:field` judged the object by the host engine's registry, and `GET /meta/:type/:name/published` and the meta read gate asked the host engine's registry whether an environment's package is disabled. The request's execution context already read the environment's engine, so one request used two kernels.
- **What changes.** Given an environment id and a registered `kernel-manager`, the `objectql` provider now reads `objectql` on that environment's kernel, the same environment-scoped seam the approvals, email, sharing, security and other providers use. Every route that reads it passes the id the shared request→environment resolution answered: the `/environments/:environmentId` param on the scoped mount, else the host's `kernel-resolver` (or the hostname / `X-Environment-Id` chain) on the unscoped one. The host's engine is no longer a fallback: an environment whose kernel carries no engine answers `POST /batch` with `501 NOT_IMPLEMENTED`.
- **Unchanged.** A single-kernel deployment (no `kernel-manager`) reads the engine on the plugin's own kernel exactly as before, through the same factory-aware lookup: a factory that fails to build is still a loud `503`, and only an engine that was never registered reads as absent. The reserved `platform` id and a request the resolver places in no environment also read the plugin's own kernel.
- **No migration.** No configuration, route, response shape or export changes.
