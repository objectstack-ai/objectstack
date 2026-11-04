---
'@objectstack/rest': patch
---

fix(rest): the approvals, email, sharing, sharing-rule and analytics routes answer from the request's environment kernel when one REST plugin fronts many environments

Clause-②: no
Metadata-protocol: none

- **What was wrong.** On a host that mounts one `RestApiPlugin` in front of many environment kernels (the hosted runtime shape), the five provider seams the plugin hands `RestServer` for `approvals`, `email`, `sharing`, `sharingRules` and `analytics` read the HOST kernel's service whatever environment they were asked for, and the unscoped (hostname-routed) mount asked them for no environment at all. The environment's own services were never reached: `GET /api/v1/approvals/requests` answered `{ data: [] }`, `GET /api/v1/approvals/requests/:id` answered 501, and the sharing, sharing-rule and email doors answered 501, on every hosted environment. The record page's approvals part answered no requests.
- **What changes.** Given an environment id and a registered `kernel-manager`, each of the five providers now reads its slot on that environment's kernel (`kernelManager.getOrCreate(id)`), the same acquisition the data routes make. The routes pass the id the shared request→environment resolution answered: the `/environments/:environmentId` param on the scoped mount, else the host's `kernel-resolver` (or the hostname / `X-Environment-Id` chain) on the unscoped one. There is no fallback to the host's occupant: an environment whose kernel carries no such service gets the door's own "not configured" answer.
- **Analytics.** `POST /analytics/dataset/query` already read the environment's service first, and now reads it alone: when the environment's kernel carries no analytics service, or cannot be acquired, the answer is the route's 501 rather than the host's service.
- **Unchanged.** A single-kernel deployment (no `kernel-manager`) reads all five services on the plugin's own kernel exactly as before, for every route and every id. The reserved `platform` id and a request the resolver places in no environment also read the plugin's own kernel.
- **No migration.** No configuration, route, response shape or export changes.
