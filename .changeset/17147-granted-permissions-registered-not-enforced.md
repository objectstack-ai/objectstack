---
'@objectstack/spec': patch
'@objectstack/core': patch
---

Say what the install-time granted permission set actually does: it is REGISTERED at load and refuses nothing.

Four shipped sentences claimed the structured `manifest.permissions` / `granted_permissions` set was enforced. Measured on `9bd4344e4`: `SecurePluginContext` — the only reader of `PluginPermissionEnforcer`'s service and hook gates — has zero production construction sites, and `enforceFileRead` / `enforceFileWrite` / `enforceNetworkRequest` are called by nothing at all, `SecurePluginContext` included. So #13457's binding registers a consented set that nothing queries, and the `fs` and `network` classes have no enforcement surface even in principle.

Corrected, each to the same truthful split ("registered at load · queried by nothing · refuses no operation"): the `registerGrantedPermissions` docblock, the `PluginPermissions` schema docblock, the `manifest.loading` tombstone prescription, and the ADR-0087 D3 entry that ships that prescription into `docs/protocol-upgrade-guide.md`. The hand-written plugin development guide gains the same note beside its permission table.

`plugin-runtime-tier-truthful-text.test.ts`'s coordination pin — which held the permissions half verbatim so it would go red the day that half was corrected — has been discharged and replaced by pins on the truthful text, in both carriers, each with the negative assertion that keeps the retracted sentence from returning beside it.

New in `@objectstack/core`: `granted-permissions-not-enforced.pin.test.ts` pins the MEASUREMENT as well as the words, so the claim cannot rot in either direction. It fails the day a production `SecurePluginContext` construction site appears — i.e. the day the ADR-0025 materialize seam lands — and names every text that then becomes false.

No behaviour changes: no accept/reject, no registration, no gate is added or removed.
