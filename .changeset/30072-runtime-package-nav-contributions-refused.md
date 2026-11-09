---
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': minor
---

fix(metadata-protocol, runtime)!: a package created at runtime is refused when it carries `navigationContributions`, which its install never registered (#30072)

Clause-②: yes (narrowing) — `POST /api/v1/packages` (both install limbs, its no-protocol fallback included) and the protocol install primitive `installPackage` (and so the package duplicate and every in-process caller) refuse a manifest whose `navigationContributions` is a non-empty list with `400 VALIDATION_ERROR`, a manifest they stored and answered `201` for before. Widened: `@objectstack/metadata-protocol` publishes one new export, `runtimeNavigationContributionsRefusal`, the predicate both doors ask.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: ManifestSchema.navigationContributions keeps its shape and meaning, and a code package (a defineStack manifest loaded at boot, from the marketplace or by an artifact reload) registers its contributions exactly as before. Only the runtime install door refuses the key, and a refused contribution never reached any app's navigation, so there is no rewrite that keeps what the author meant; the author picks one of the two routes the refusal names. Rows already in sys_packages are data at rest and replay as stored. -->

**BREAKING** accept-set narrowing at the runtime package install door (Studio, REST, MCP and AI authors creating a package at runtime). `os validate`, `os build` and code packages are unchanged.

- **Before.** A package created through `POST /api/v1/packages` with `navigationContributions` targeting another app answered `201` and was stored, but no entry ever appeared in the target app, not after a restart either: only a code package's `registerApp` registers contributions, and neither the install nor the `sys_packages` replay at boot does. Nothing said why.
- **Now.** The same install is refused `400 VALIDATION_ERROR` before anything is stored, with a sentence that names the key and both routes that work. The refusal is asked ahead of the duplicate-id `409`, so the answer does not depend on whether the id is installed. A manifest with no `navigationContributions`, or an empty list, installs as before.
- **Not changed.** A code package's contributions (the Setup app's capability plugins, a multi-package artifact's modules, a marketplace package) are registered and served as before. A package already stored with the key keeps loading at boot, and its entries stay unregistered, as they always were.

**What an author does.** To add an entry to an installed app's menu, save an override of that app in its customization package (the app copied with the entry added; Studio's navigation editor writes it). To contribute menu entries into another package's app, ship them in a code package's manifest, which registers them when it loads. Then install the runtime package without `navigationContributions`.
