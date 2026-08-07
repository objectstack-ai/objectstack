---
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

fix(objectql,spec): app-declared `capabilities` reach the registry with package provenance (#5870, #4967 Part 2)

An authorization capability a package DEFINES (`defineCapability` →
`stack.capabilities`, ADR-0066 D1) never acquired registry provenance, so a
declaration that did not repeat its owner by hand was **declared but never
enforced**.

**FROM.** `ObjectQL.registerApp()` decomposes a manifest's metadata arrays and
calls `SchemaRegistry.registerItem(type, item, 'name', packageId)` — the only
seam that runs `applyProtection(item, { packageId })` and stamps `_packageId` /
`_provenance`. The key list driving that decomposition (`metadataArrayKeys`,
present twice in `packages/objectql/src/engine.ts`: the manifest seam and the
nested-plugin seam) carried every other Security-Protocol collection —
`permissions`, `sharingRules`, `roles`, `profiles`, `policies` — but not
`capabilities`. The other path a stack's security metadata travels,
`AppPlugin` → `MetadataManager.registerInMemory`, stamps nothing by design. So
`readDeclared(ql, 'capability')` always returned `[]`, and
`bootstrapDeclaredCapabilities` — which resolves the owner as
`cap._packageId ?? cap.packageId` — could never satisfy the first half.

The consequence was a contract that lied in the direction that costs the most:
`CapabilityDeclarationSchema.packageId` documents itself as the ADR-0086 D3
*fallback* used "when the registry has not stamped `_packageId`", and the field
is `.optional()`, but in practice it was **mandatory**. Omitting it produced one
boot `warn` and one authorization grant that silently never took effect —
permission sets have rows and materialize, capabilities did not.

**TO.** `capabilities` is registered through the same provenance seam as
`permissions`, at both `metadataArrayKeys` sites, and `capabilities` →
`capability` joins `PLURAL_TO_SINGULAR` in `@objectstack/spec` so the items land
under the singular type name the seeder reads back (the same mapping
`AppPlugin`'s security bridge already used). A capability declared by a package
— or by a package's nested plugin — now carries `_packageId` /
`_provenance: 'package'`, is listable via `registry.listItems('capability')`,
and is seeded into `sys_capability` with `managed_by:'package'` and a real
`package_id`.

**What authors should do.** Nothing is required and nothing breaks: an authored
`packageId` still parses and still wins where the registry has not stamped
(items registered outside a package context). It is now genuinely optional —
drop it and the platform supplies the owner. Where both are present the registry
stamp takes precedence, as the schema always said; the showcase's
`showcase.export_data` keeps its authored `packageId` and names the same id the
stack does, so the two agree.

This does not change what may be created at runtime: `capability` has no entry
in `DEFAULT_METADATA_TYPE_REGISTRY`, and the runtime-create gate reads that
registry, not the item store — its verdict for the type is the same before and
after.
