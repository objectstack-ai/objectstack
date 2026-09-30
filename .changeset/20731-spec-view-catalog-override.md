---
'@objectstack/spec': minor
---

fix(spec): `translateView` lets an explicit override beat the packaged catalog when it is handed the packaged view (#20731)

`translateView` (`@objectstack/spec/system`) now follows the rule ADR-0029 D9.2a records for objects, and that `translateDashboard` already follows: an explicit override beats a packaged default. When the caller supplies `packagedBase` (the view as its code package ships it, before any tenant overlay), a catalog string replaces a served string only while that string still equals its packaged counterpart. It is the same comparison, not a second one.

The comparison is made per string: the view `label` and `description`, each bulk-action def's `label`, `confirmText` and `confirmLabel`, and each of its params' `label`, `help` and `placeholder`. A def or param is matched by the `name` the bundle addresses it by, and one that the packaged view does not carry counts as authored, so its strings keep their values.

Why: an org overlay on a packaged view (ADR-0126 Regime O) changed the label of the showcase's `showcase_task.in_progress` and published. The metadata protocol's item and list reads served the edit, but a `zh-CN` reader was served `进行中`, the catalog's translation of the label the package shipped. The catalog (`objects.<object>._views.<viewKey>`) translated the packaged view and was applied over the tenant's edit.

What changes for a caller:

- `translateView`'s third parameter is typed `TranslateDocumentOptions` (was `ResolveOptions`). That type is `ResolveOptions` plus the optional `packagedBase`, and `translateMetadataDocument` already passed it through. Every existing call compiles unchanged.
- Without `packagedBase` (`undefined` or `null`), the output is byte-identical to before: the catalog applies. No serving layer in this release passes a view base yet, so no served view changes answer with this package alone.
- An edit back to exactly the shipped string is a no-op: the catalog still translates it. A label written as an inline locale map is not an override either; only a string is compared.

Nothing is removed or renamed, and there is nothing to migrate.
