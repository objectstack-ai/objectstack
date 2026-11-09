---
'@objectstack/rest': patch
---

fix(rest): the `/security` routes, and the auth, settings, i18n and metadata seams, answer from the request's environment kernel when one REST plugin fronts many environments

Clause-②: no
Metadata-protocol: none

- **What was wrong.** On a host that mounts one `RestApiPlugin` in front of many environment kernels (the hosted runtime shape), the `security` provider read the HOST kernel's service whatever environment it was asked for, and the unscoped (hostname-routed) suggested-binding mount asked it for no environment at all. The host has no `security` service, so `GET /security/suggested-bindings` and `POST /security/suggested-bindings/:id/confirm` answered 501 on every hosted environment: no owner could accept an installed app's default permission set, and every invited member read 403 on that app's data. `security/explain` and the record, export and meta doors that read the same service fell back to the host's occupant whenever the environment's kernel did not answer.
- **What changes.** Given an environment id and a registered `kernel-manager`, the `security` provider now reads `security` on that environment's kernel, the same environment-scoped seam the approvals, email, sharing, sharing-rule and analytics providers use. Every route that reads it passes the id the shared request→environment resolution answered: the `/environments/:environmentId` param on the scoped mount, else the host's `kernel-resolver` (or the hostname / `X-Environment-Id` chain) on the unscoped one. The host's occupant is no longer a fallback.
- **The audited seams.** The `auth`, `settings`, `i18n` and `metadata` providers are environment-scoped the same way. On a hosted runtime the REST face's execution context now localizes (time zone, locale, currency) from the environment's own settings, as the runtime dispatcher's already did, instead of the host's. An environment whose kernel carries no `auth` service is no longer authenticated by the host's identity store. The `tenancy` provider keeps reading the plugin's own kernel: every consumer reads the bound environment kernel's `tenancy` first.
- **Unchanged.** A single-kernel deployment (no `kernel-manager`) reads every one of these services on the plugin's own kernel exactly as before, for every route and every id. The reserved `platform` id and a request the resolver places in no environment also read the plugin's own kernel.
- **No migration.** No configuration, route, response shape or export changes.
