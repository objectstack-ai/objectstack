---
"@objectstack/plugin-security": minor
---

**The five remaining seeder refusals now reach the author.** The two declared-metadata seeders refuse to write in five more places, and every one of them reported through `logger?.warn?.(…)` — optionally chained **twice**, so a caller that injected no logger got no output at all (#18091).

Measured on the pre-change tree, each site driven with **no logger passed** while all five console channels were spied, beside the two already-repaired axes as lit controls in the same harness:

```
                                        counter               author-visible lines
curated platform capability refused     skippedPlatform = 1            0
capability declaration unowned          skippedUnowned  = 1            0
capability rows unreadable              unreadable      = 1            0
permission set declaration unowned      (no counter at all)            0
permission set rows unreadable          unreadable      = 1            0
LIT CONTROL  capability_name_collision  skippedForeign  = 1            1
LIT CONTROL  permission_set_name_…      skippedForeign  = 1            1
```

Every one of those zeros is now a 1, with the counters unchanged.

⛔ **No skip changed.** They are correct under ADR-0086 D4 (a package never writes into a foreign record) and ADR-0086 D3 (a package-managed row with no `package_id` makes uninstall undefined). The defect was only that the refusal never reached the author who caused it.

**Each site words its own consequence** — the reason a mechanical copy was rejected. A curated-platform-name hijack still *resolves* against the curated row, so nothing is denied and only the authored metadata and the provenance claim are lost; an unowned **capability** has three different outcomes depending on what already stands in `sys_capability`; an unowned **permission set** keeps every grant working (the evaluator resolves declared sets through the metadata registry) and loses only the *record* — the Setup surface, the provenance axis and uninstall; and an unreadable read compared nothing, so nothing is lost and nothing arrived either. One generic "declaration skipped" line would send the first author hunting for a broken grant that is not broken.

**What is shared is exactly one thing: where the line goes.** This shape had already been repaired one instance at a time twice, each repair restating the same two lines at its own call site. `reportThroughSink()` is now the single derivation, so a sixth refusal site cannot re-earn this card. It also improves on both spellings it replaces: a host sink that lies about its shape used to buy safety with silence (`logger?.warn?.(…)`) or noise with a throw (`logger.warn(…)`) — the `typeof` guard buys neither, and keeps the receiver so a class-based host logger does not throw.

New published surface on `@objectstack/plugin-security`, on the criterion the two existing collision diagnostics state and no wider — a refusal an **author** can cause has a second door by construction (`@objectstack/lint`, `os build` / `os validate`), and both of these are decidable from the declaration alone with no database:

- `CAPABILITY_PLATFORM_NAME_REFUSED` / `capabilityPlatformNameRefusedDiagnostic()` / `reportCapabilityPlatformNameRefused()` and the `CapabilityPlatformNameRefusedDiagnostic` record.
- `CAPABILITY_DECLARATION_UNOWNED` / `capabilityDeclarationUnownedDiagnostic()` / `reportCapabilityDeclarationUnowned()` and the `CapabilityDeclarationUnownedDiagnostic` record.
- `PERMISSION_SET_DECLARATION_UNOWNED` / `permissionSetDeclarationUnownedDiagnostic()` / `reportPermissionSetDeclarationUnowned()` and the `PermissionSetDeclarationUnownedDiagnostic` record.

⛔ The two unreadable-rows summaries are deliberately **not** published: an unreadable database is a runtime condition no compile-time door can raise, so they stay package-private for the reason `position_name_fold_grant` does.

⚠️ The end-of-pass `logger?.info?.(…)` summary in each seeder keeps its outer `?.` **deliberately**. A pass that did its work and refused nothing must stay silent on every console channel with no sink injected; routing a healthy boot's info line to the console would turn that control into noise and buy no author anything. The refusal channel is the one where silence was the defect.
