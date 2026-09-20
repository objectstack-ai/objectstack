---
"@objectstack/plugin-hono-server": patch
---

`/auth/me/permissions` now reports an unrestricted object's effective operation set whenever the export axis withholds `export`, so the Console stops rendering an Export button the server answers `403 EXPORT_NOT_PERMITTED` (#18931).

`Clause-②: no`

The endpoint builds its per-object map in four passes — seed, fold, clamp, annotate. `seedSuperUserRestrictedObjects` resolved each registered schema **without** the export slot and skipped every `unrestricted` one; `annotateEffectiveApiOperations` resolves **with** it and iterates existing entries only. Two predicates for one question, and they disagreed on exactly one population: a principal whose only grant is a `'*'` wildcard carrying `modifyAllRecords` and no `allowExport` — which, since #8681 removed the wildcard export grant from the built-in admin sets, is every platform administrator holding no app-authored set.

For that principal an unrestricted object got no entry, so annotate never saw it and the response said nothing about it at all. The client reads `apiOperations: undefined`, takes the default-allow path #3391 gave it, renders **Export**, and the click is refused. A sibling object declaring `apiMethods` got an entry, an `apiOperations` without `export`, and no button — the same principal, the same session, two answers.

- **The seed now applies annotate's own predicate**: resolve with the export slot annotate will read for the entry being seeded, and skip only an object that is unrestricted **and** keeps `export`. A seeded entry carries no `allowExport` of its own and `foldWildcardSuperUser` does not add one, so annotate's `acc.allowExport ?? wildExport` resolves to the same wildcard bit the seed read — the two passes cannot diverge again.
- **The export axis is the only axis this reaches.** Measured across the `enable` shapes an unrestricted object can carry: withholding `export` subtracts `export` and nothing else, and `mode` stays `unrestricted` either way — which is why the old `mode`-only guard could not tell the two cases apart. The CRUD axis needed no annotation and still gets none.
- **What the response gains**: for such a principal, one entry per unrestricted object, each the full closure minus `export`. Its CRUD bits are folded `true` — the same answer the client already computed by falling back to `'*'`, now stated explicitly rather than inherited.
- **Denial is unchanged.** `enforceExportPermission` → `security.canExport` still answers `403 EXPORT_NOT_PERMITTED`, and no request that was refused is now accepted. This is the affordance half: the channel that is supposed to tell the client now does.
