---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/lint': minor
---

feat(metadata-core, metadata-protocol, objectql, lint)!: an App and the modules that declare it share one customization pair

Clause-②: yes (narrowing) — the ensure door refuses two asks it accepted: a package that reaches several Apps and whose namespace picks none of them (was `201` with its own pair, now `409`, merge question 11), and a module whose earlier per-package pair holds the App's pair namespace (was `201`/`200`, now `409 RESOURCE_CONFLICT` naming that pair, merge question 12); `appOf` now returns `string | undefined`. The widening half: a module of an App gets the App's pair (`200`, where it was `422 NAMESPACE_CONFLICT` when the App held the namespace), and `@objectstack/metadata-core` exports `pairsOf`, `AppOfRefusal` and `PairOfRefusal`. Ruling 6691022506; ADR-0146 D3 as amended by #31027.
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing at rest changes: a pair the ensure door created stays installed and served, and the two new refusals answer an ask without writing anything, so there is nothing for a migration to rewrite. -->

The customization unit is the App (ADR-0146 D3 as amended, ruling record 6691022506). `appOf` in `@objectstack/metadata-core` now reads the installed manifests: a `type: 'app'` package is its own App; any other package's App is the installed `type: 'app'` package it declares in `manifest.dependencies`, directly or through its declared parents (where it reaches several, the one holding its namespace); a package that declares no App is its own unit; a kernel package (scope `system` / `cloud`) keeps its own answer, because no platform pair is created in this version.

What changes for a caller:

- `POST /api/v1/packages/:id/ensure-customization` asked for a module of an App answers the App's one pair, `<app id>.custom` (namespace `<app namespace>_custom`, a dependency on the App at `^<major>`): `201` on the first ask from any member, `200` after, never `422` for a package of the same App. The answer's `basePackageId` is the App. HotCRM: the App and its modules all answer `app.objectstack.hotcrm.custom`.
- `422 NAMESPACE_CONFLICT` stays for the pair namespace held by a package outside the App.
- A per-package pair an earlier version created for a module (`<module id>.custom`) stays installed and honoured as before: its declared overrides are served at the module's address (by name, in the list and in the layered read), its list rows, translations, bundle members it added, object extensions and the served-overrides census are read beside the App's pair (`pairsOf` / `isPairOf`), it may still declare and remove its own overrides of the module's items ("Restore package original" included, for a type with no overlay channel too), and the customizations read (`GET /api/v1/packages/:id/customizations`) does not list it as another package's contribution. No reader is App-pair-only. While it holds the App's pair namespace, the ensure door answers `409 RESOURCE_CONFLICT` naming it instead of creating the App's pair beside it (merge question 12).
- A package that reaches several Apps and whose namespace picks none of them has no pair: the ensure door answers `409` (merge question 11).
- The App's pair's write closure reaches every member of the App, so an override or an object extension of a module's item saved into the App's pair is admitted.
- The uninstall refusal for an installed pair reads the pair named for the package: uninstalling the App is refused while the App's pair is installed, uninstalling a module is not (its customizations are the App pair's), and a module whose own earlier per-package pair is installed is still refused naming that pair.
- `os validate`'s `namespace-no-customization-pair` warning skips a member of a delivered App: its customizations land in the App's pair.

TypeScript: `appOf` now answers `string | undefined` (`undefined` = no single App), and `pairOf`'s refusal union gains `no_single_app` (`PairOfRefusal`); `pairsOf` and the `AppOfRefusal` / `PairOfRefusal` types are new exports of `@objectstack/metadata-core`.

**BREAKING** accept-set narrowing at `POST /api/v1/packages/:id/ensure-customization` (`@objectstack/metadata-protocol`) and a return-type change in `@objectstack/metadata-core`.

- **A package that reaches several Apps and whose namespace picks none.** Before: `201` with its own pair `<package id>.custom`. Now: `409 RESOURCE_CONFLICT` saying the package declares several Apps and its namespace picks no single one of them, and nothing is created. Remedy: declare the one App the package belongs to in `manifest.dependencies`, or give it the namespace of the App it belongs to.
- **A module whose earlier per-package pair holds the App's pair namespace.** Before: the module's own `<module id>.custom` (`201`, then `200`). Now: `409 RESOURCE_CONFLICT` naming that pair, from the App and from every member; the pair stays installed and its customizations stay served. Remedy: keep customizing in the existing pair (its id is in the refusal), or export it (`GET /api/v1/packages/<pair>/export`), delete it, and ensure again to get the App's pair.
- **`appOf` returns `string | undefined`** (was `string`). `undefined` means no single App. Remedy: handle `undefined` (`appOf(id, installed) ?? id` keeps the old reading); `pairOf`'s refusal reason may now also be `'no_single_app'` (`PairOfRefusal`).
