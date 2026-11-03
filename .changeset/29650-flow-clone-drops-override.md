---
'@objectstack/runtime': patch
---

fix(runtime): New similar on a flow with a live override writes a copy instead of answering 403 NOT_OVERRIDABLE

Clause-②: no
Metadata-protocol: none

When an administrator had customized a packaged flow in Studio and published the override, New similar (`POST /api/v1/automation/:name/clone`) refused with `403 NOT_OVERRIDABLE`: the copy kept the override's `overrides: { package, basedOn }` block under its new name, so it declared an override of a flow the base does not ship. The clone now drops the override declaration along with the protection envelope (`FLOW_CLONE_DROPPED_KEYS` derives `OverrideDeclarationFields`), so the copy is the customization package's own item under its new name, switched off as before (ADR-0146 D2, D4). It copies what the source serves, which with a live override is the override's definition. The override itself is left as it was.
