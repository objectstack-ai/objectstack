---
'@objectstack/core': minor
'@objectstack/rest': patch
'@objectstack/cloud-connection': patch
'@objectstack/plugin-sharing': patch
'@objectstack/service-datasource': patch
'@objectstack/service-settings': patch
'@objectstack/service-storage': patch
---

refactor(core): one `classifyAdmissionTenancyPosture`, so six admission seams cannot each get the classification wrong (#16013)

Six admission doors each hand-wrote the same try/catch on the `tenancy` read that
feeds `resolveAuthzContext`: the registry's branded "never registered" rejection
(`isServiceNotRegisteredError`, #13905) resolves quietly to `undefined` — the
supported no-tenancy composition, where no posture-conditional refusal runs at
all — and every other rejection becomes `AuthzStoreUnavailableError('tenancy', err)`
(ADR-0112 `SERVICE_UNAVAILABLE` / 503), because the posture is an authorization
INPUT and admission was therefore never DECIDED. That is #13906 decision 1
option A, and it is the part nobody may get wrong: a quiet `catch` at any one of
the six re-opens the defect, where a failure reads as "this check does not apply"
and an ex-member's org-stamped API key is admitted.

Nothing is broken today — every copy was correct — so this removes a standing
hazard rather than fixing a defect. **No admission verdict changes**, on any
wiring: the classification is byte-for-byte the decision the six copies made,
now made once.

- **`@objectstack/core` gains `classifyAdmissionTenancyPosture`** (and the
  `TenancyServiceResolver` type), exported from the package index beside
  `effectiveTenancyPosture`. It takes a THUNK and owns the classification only.
  The thunk is not a style choice: the REJECTION is what gets classified, so the
  resolution has to happen inside the helper's `try` — a caller that awaited the
  service first would need a `catch` of its own, which is the thing being
  deleted.
- **The RESOLUTION deliberately did not move.** `rest-server.ts` branches on
  kernel-vs-provider, and asking twice would let a provider bound to the local
  kernel answer for a request that resolved to another environment; four seams
  read `ctx.getKernel()`; `service-storage` reads an already-normalised gate
  registry; and each seam's reason why a MISSING async accessor must stay quiet
  is its own argument (the storage door's is its declared degrade-to-ungated
  contract, the others' is the `KernelBase`/`LiteKernel` host shape). A helper
  that also owned how the service is reached would be wrong for one of them or
  grow a flag per seam — the copies again, with an extra step. Every one of
  those reasons stays written at its seam.
- **Folded**: `packages/rest/src/rest-server.ts` (both wirings),
  `packages/cloud-connection/src/marketplace-install-local-plugin.ts`,
  `packages/plugins/plugin-sharing/src/sharing-plugin.ts`,
  `packages/services/service-datasource/src/admin-routes.ts`,
  `packages/services/service-settings/src/settings-service-plugin.ts`,
  `packages/services/service-storage/src/storage-service-plugin.ts`.
- **Pinned where the decision now lives**:
  `packages/core/src/security/admission-tenancy-posture.test.ts` drives both
  rejections at the production seam — a real `ObjectKernel` that never
  registered `tenancy`, and one whose `tenancy` factory throws — each beside the
  brand predicate's own answer on that same rejection, so "the outage throws" is
  distinguishable from a helper that throws at everything. It also holds the
  constraint mechanically: the helper's source may not name an accessor, a
  kernel or a plugin context, and it takes exactly one parameter.
