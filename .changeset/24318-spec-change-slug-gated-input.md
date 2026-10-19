---
'@objectstack/spec': minor
---

fix(spec)!: `PUBLIC_AUTH_FEATURES.multiOrgEnabled.gatedInputs` no longer lists `sys_organization.actions.change_slug` (#24318)

Clause-②: no (narrowing)

`gatedInputs` is the census of platform-object inputs gated on a public auth feature, which the platform objects' completeness guard holds equal to their declarations in both directions. `sys_organization` no longer declares `change_slug` (its door is the cloud orchestrator's, and the composition that serves it declares the action), so its row leaves the census.

**BREAKING — what moves for consumers.** One string leaves a published constant, shipped as `minor` under the launch-window convention for breaking changes.

- FROM: `PUBLIC_AUTH_FEATURES.multiOrgEnabled.gatedInputs` listed seven `sys_organization` actions, `'sys_organization.actions.change_slug'` among them.
- TO: it lists six: `create_organization`, `update_organization`, `rename_organization`, `delete_organization`, `set_active_organization` and `leave_organization`.
- Fix: none for an action declared outside the platform objects. The census is not a gate on other packages: a top-level action bound to `sys_organization` that declares `requiresFeature: 'multiOrgEnabled'` is lowered to the same `features.multiOrgEnabled != false` predicate and served with it, measured on a booted composition.

**Unchanged.** The `multiOrgEnabled` key, its surface (`crud`) and its semantics (`default-on`); every other feature's row.

<!-- adr-0087: not-required (no-migration-prescription) one path string leaves a published census constant that only the platform objects' own completeness guard reads: no authorable spec key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this row (not already-registered); and the constant's export and type are unchanged (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
