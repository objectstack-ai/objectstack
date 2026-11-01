---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(studio): an "All metadata" area in the builder, per package and across packages; a pillar type opened there opens its pillar

Clause-②: no
Metadata-protocol: none

Studio owns all metadata (ADR-0146 D1), and until now only Setup listed every type. The builder gains an "All metadata" area beside its four pillars. It is the metadata-admin pages Setup mounts (the type directory, the lists, the generic item page, history and diagnostics), mounted, not copied.

- **Per package.** `/studio/<package>/metadata/…` is the open package's area, with the same route shapes Setup has below `/apps/setup/metadata`. The header links it beside the pillars, and names it from 1280 px. The URL keeps `?package=` for the area's package, which the item page binds its saves to, so a writable package saves exactly as Setup does with `?package=`. There is no new write path.
- **Across packages.** `/studio/~all/metadata/…` serves the environment catalog (position, capability, permission, sharing_rule) with `?scope=environment` and no package. The landing's "Not in a package" row opens it. `~all` is a reserved segment, so no package id spells it, and it is not the package-less flows scope (`~org`).
- **Query kept.** `?package=`, `?scope=environment` and `?review=1` mean what they mean in Setup. A `?package=` naming another package re-roots onto that package. `?scope=environment` and `?package=all` move to the cross-package leg. `?review=1` opens the generic item page and its review.
- **Pillar types open their pillar.** An item opened from the area opens its pillar with `?surface=`: object → Data, flow → Automations, page, dashboard, report and view → Interfaces, permission → Access. Every other type opens the generic item page. Interfaces now opens a page, dashboard, report or view that no nav entry opens by its `?surface=` link, instead of the first nav leaf.
- **Read-only package.** On a package `GET /api/v1/packages` lists as not writable (a kernel package the switcher hides included), the item page is read-only and says the package is why. Layers, references, history, audit and source stay. No rollback, source save, reset, delete, create or "Customize with an overlay" save is offered. A package the list cannot answer for stays ungated, as on the pillars.
- **Setup's parts stay Setup's.** In the area, a position's holders and a permission set's assignments are a link to their Setup page and are not drawn there. The datasource tile and any datasource URL open Setup's Datasources page. Setup's own pages are unchanged.
