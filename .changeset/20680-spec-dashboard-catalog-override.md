---
'@objectstack/spec': minor
---

fix(spec): `translateDashboard` lets an explicit override beat the packaged catalog when it is handed the packaged base (#20680)

`translateDashboard` (`@objectstack/spec/system`) now follows the rule ADR-0029 D9.2a records for objects: an explicit override beats a packaged default. When the caller supplies `packagedBase` (the dashboard as its code package ships it, before any tenant overlay), a catalog string replaces a served string only while that string still equals its packaged counterpart. The comparison is made per string: the dashboard `label` and `description`, each widget's `title`, `description` and sub-caption (`options.description`), each global filter's `label`, and each static option `label`. Each string is matched by the key the bundle addresses it by (widget `id`, filter key, option value). A widget, filter or option that the packaged base does not carry counts as authored, so its strings keep their values.

Why: an org overlay on a packaged dashboard (ADR-0126 Regime O) published, and `?layers=true` reported it as effective, but the served widget title stayed the shipped one whenever the dashboard's bundle carried that title. The platform's `system_overview` is one such dashboard, because `platform-objects` ships an `en` bundle that repeats every widget title. The catalog translated the packaged declaration and was applied over the tenant's edit.

What changes for a caller:

- `translateDashboard`'s third parameter is typed `TranslateDocumentOptions` (was `ResolveOptions`). That type is `ResolveOptions` plus the optional `packagedBase`, and `translateMetadataDocument` already passed it through. Every existing call compiles unchanged.
- Without `packagedBase` (`undefined` or `null`), the output is byte-identical to before: the catalog applies. No serving layer in this release passes a dashboard base yet, so no served dashboard changes answer with this package alone.
- An edit back to exactly the shipped string is a no-op: the catalog still translates it.

Nothing is removed or renamed, and there is nothing to migrate.
