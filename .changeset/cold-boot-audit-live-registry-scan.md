---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the cold-boot org-scoped audit scans the LIVE metadata-type registry (#6992)

`reportUnhydratableOrgScopedRows` — the boot line that says which org-scoped
`sys_metadata` rows hydration walked past (#6190, PR #6600) — built its scanned
type list by walking `DEFAULT_METADATA_TYPE_REGISTRY`. A metadata type with no
entry there is registered at runtime by a plugin (`theme`, `connector`,
`webhook`, `sharing_rule`, `analytics_cube`, …), so it was absent from the scan
— while `loadMetaFromDb`'s filter (`organization_id: null`) is type-BLIND and
skips its org-scoped rows exactly like a `flow`'s. That family was the one
getting **neither** the write refusal nor the warning.

The scan now unions the declared non-org-overridable types with every **live**
type the registry does not declare at all, read through the same accessor
`getMetaTypes()` lists from (`engine.registry.getRegisteredTypes()` plus the
`metadata` service's) — extracted as `listLiveMetadataTypes()` so the listing
and the audit cannot drift into two vocabularies of "which types exist here".

Measured on a real `app-showcase` boot, at the instant the audit fires: 7 live
types have no registry entry (`analytics_cube`, `connector`, `data`, `package`,
`sharing_rule`, `theme`, `webhook`), all from the SchemaRegistry, which
manifests populate during kernel Phase 1 — before the audit runs in
`ObjectQLPlugin.start()` Phase 2. The widening is live, not defeated by boot
order.

**What an operator sees.** Still exactly one aggregated line per boot, same
`[metadata_org_scoped_unhydrated]` tag and same `type×count (names)` detail with
a 5-name sample cap — the widening adds segments to that line, never new lines.
Two wording changes carry the new family: the line no longer claims "types the
registry declares NOT per-org overridable" (false for a type with no
declaration) and instead says "types with NO per-org channel"; and each
plugin-registered type is marked `[plugin-registered]`, because the remediation
differs — a declared type's org-scoped write is refused from now on, so its rows
are residue that cannot grow, whereas an undeclared type's write is **not**
refused and the same names return after every restart until the author stops.

**The write refusal is deliberately unchanged.** `orgScopedWriteRefusal` keeps
its "statically-declared types only" predicate: a warning is free and should be
maximal, a refusal removes a capability, and widening it would extend a ruling
reasoned over the declared registry onto a surface nobody measured. The
divergence is now stated in the audit's TSDoc and pinned by a test, so it reads
as a decision rather than as drift.
