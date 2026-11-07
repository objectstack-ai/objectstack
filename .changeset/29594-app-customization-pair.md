---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/lint': minor
---

feat(metadata-core, metadata-protocol, objectql, lint): an App and the modules that declare it share one customization pair

Clause-②: no
Metadata-protocol: semantic

The customization unit is the App (ADR-0146 D3 as amended, ruling record 6691022506). `appOf` in `@objectstack/metadata-core` now reads the installed manifests: a `type: 'app'` package is its own App; any other package's App is the installed `type: 'app'` package it declares in `manifest.dependencies`, directly or through its declared parents (where it reaches several, the one holding its namespace); a package that declares no App is its own unit; a kernel package (scope `system` / `cloud`) keeps its own answer, because no platform pair is created in this version.

What changes for a caller:

- `POST /api/v1/packages/:id/ensure-customization` asked for a module of an App answers the App's one pair, `<app id>.custom` (namespace `<app namespace>_custom`, a dependency on the App at `^<major>`): `201` on the first ask from any member, `200` after, never `422` for a package of the same App. The answer's `basePackageId` is the App. HotCRM: the App and its modules all answer `app.objectstack.hotcrm.custom`.
- `422 NAMESPACE_CONFLICT` stays for the pair namespace held by a package outside the App.
- A per-package pair an earlier version created for a module (`<module id>.custom`) stays installed and served: its declared overrides, list rows, translations and served-overrides census are read beside the App's pair (`pairsOf` / `isPairOf`). While it holds the App's pair namespace, the ensure door answers `409 RESOURCE_CONFLICT` naming it instead of creating the App's pair beside it (merge question 12).
- A package that reaches several Apps and whose namespace picks none of them has no pair: the ensure door answers `409` (merge question 11).
- The App's pair's write closure reaches every member of the App, so an override or an object extension of a module's item saved into the App's pair is admitted.
- The uninstall refusal for an installed pair reads the pair named for the package: uninstalling the App is refused while the App's pair is installed, uninstalling a module is not (its customizations are the App pair's), and a module whose own earlier per-package pair is installed is still refused naming that pair.
- `os validate`'s `namespace-no-customization-pair` warning skips a member of a delivered App: its customizations land in the App's pair.

TypeScript: `appOf` now answers `string | undefined` (`undefined` = no single App), and `pairOf`'s refusal union gains `no_single_app` (`PairOfRefusal`); `pairsOf` and the `AppOfRefusal` / `PairOfRefusal` types are new exports of `@objectstack/metadata-core`.
