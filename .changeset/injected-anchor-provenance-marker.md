---
"@objectstack/metadata-core": minor
"@objectstack/objectql": minor
---

feat(metadata-core, objectql): machine-readable provenance for injected system columns — one authoritative answer to "is this column actually provisioned by the platform?" (#7865)

`applySystemFields` injects the platform anchors (`organization_id`,
`owner_id`, `owning_business_unit_id`, the audit family) into every object that
has not opted out — **including federated ones** (ADR-0015 `external`), for
which the platform provisions no storage: `Engine.syncObjectSchema` returns
early and issues no DDL. On such an object those anchors exist in the
registered schema and nowhere else, and a predicate over one degrades silently
on SQLite (unresolvable identifier → string literal → constant-false: HTTP 200,
zero rows, no error). Three consumers had independently re-derived that fact
(engine `DriverOptions.tenantId` withholding, plugin-security's Layer-0 phantom
guard, plugin-sharing's proposed `owner_id` twin).

Per the 2026-08-12 maintainer ruling (direction B), the injection keeps running
and the injected anchors now carry a machine-readable provenance marker, spelled
as an exported derivation in `@objectstack/metadata-core` (re-exported by
`@objectstack/objectql`, the injecting registry):

- `platformProvisionsStorage(def)` — `false` exactly for ADR-0015 `external`
  objects (the same predicate `syncObjectSchema` routes by, exported once).
- `resolveInjectedColumnProvenance(def, column)` —
  `'author' | 'injected-provisioned' | 'injected-unprovisioned' | 'absent'`;
  `'injected-unprovisioned'` is the marker: the platform's own injected anchor
  with no storage behind it.
- `unprovisionedInjectedColumns(def)` — the enumerable form.

The marker is deliberately **not** a `provisioned: false` key on the field
definitions: `FieldSchema` is strict (an undeclared key would stamp
`_diagnostics: { valid: false }` on every served federated object, and
declaring it would hand authors a forgeable switch over their own tenant wall),
and the anchor definitions are read by exact identity in the #4326 round-trip
strip and plugin-security's Layer-0 guard — a data key would flip both. No
document byte changes anywhere: registered, served (`/meta`), or stored. The
existing consumer guards are unchanged and converge on this API opportunistically
as they are next touched, per the ruling.

An author-declared column of the same name — including a real remote
`organization_id` on a federated object — answers `'author'`, never the marker,
so a consumer acting on the marker can never suppress a tenant wall the author
deliberately made real. Any inexact match fails toward `'author'`: toward
enforcement, never exposure.
