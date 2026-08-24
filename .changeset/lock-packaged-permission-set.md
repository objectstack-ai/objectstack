---
'@objectstack/plugin-security': minor
---

Lock package-declared permission sets at the save door; clone to customize (#11513)

Maintainer ruling of 2026-08-24, recorded verbatim and untranslated:
「同意 第一步(创业阶段,Salesforce 式)」 — step 1 of the mainstream-platform
comparison: lock the base, clone to customize.

A Studio/API save that targets a **package-declared** permission set is now
**refused at the server**, with a message that names the sanctioned path — clone
it and edit the clone. Previously the data door translated the write into a
metadata write and left the refusal entirely to the metadata protocol's ADR-0005
tier gate. That gate is exactly what the documented
`OS_METADATA_WRITABLE=permission` operator hatch switches off, so on a
deployment running with the hatch there was no refusal at all: the save minted a
`sys_metadata` overlay of a packaged set, and boot reconciliation re-projected
that overlay onto the record on every boot, unconditionally, forever — the set
froze at the fork and every future package upgrade of it was ignored, silently.

**Clone-to-customize** is the sanctioned path and is unchanged: the clone is an
ordinary org-owned set (`managed_by: 'admin'`, no `package_id`, so no upgrade
linkage), and upgrades keep flowing to the package-declared base untouched.

**Existing forks** get a **detection reading** at boot — count *and names*,
warned loudly, saying outright that nothing was reaped. It reads `sys_metadata`
directly rather than the `customized` column, which is forced `false` on the
exact confounded shape the field report measured (a genuinely package-declared
set whose row's `managed_by` predates provenance tracking). Nothing is reaped,
merged or migrated: disposition of an existing fork is a follow-up reading for
the maintainer, and the per-set remedy remains the explicit, audited
"Discard Overlay" action a human invokes.

Behaviour deliberately NOT narrowed:

- an **ordinary org-owned** set is still fully editable (pinned as a control —
  a lock that refuses everything would satisfy the refusal pin perfectly);
- the **activate / deactivate** actions still write their column: a bare
  `{ active }` patch is row state, not a customization of the definition;
- a `managed_by: 'package'` row with **no artifact behind it** — published
  through the metadata door (ADR-0070) and materialized by the ADR-0086 P2
  path — keeps editing in place. That is ADR-0094 D5-R's surviving
  `allowRuntimeCreate` neighbour, and `managed_by` is measurably not the
  artifact-provenance fact. Provenance is read from the engine SchemaRegistry,
  the one source this plugin already calls "package-declared".

Provenance is **fail-closed**: a read that cannot answer refuses the save rather
than accepting it, and the read is not a name-keyed page over
`sys_permission_set`, so it cannot be truncated into a false "not packaged".
