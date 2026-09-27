---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/runtime': minor
---

feat(spec)!: the canon for "the version of a package or plugin" is SemVer 2.0.0 — nine carriers, one grammar

Clause-②: yes (narrowing)

<!-- adr-0087: registered manifest-version-semver-2-0-0, plugin-version-semver-2-0-0, package-version-row-semver-2-0-0, package-manifest-version-grammar-enforced -->

**BREAKING** — four published accept sets converge on one, and the fringe each
of them carried outside SemVer 2.0.0 is refused. The widening half needs no
action from anyone; the narrowing half is listed per carrier below, with its
FROM → TO.

One concept was judged by four different grammars across ten carriers in two
repositories, and the strictest refused `2.0.0-beta.1` — the exact string a
sibling declaration documented as an example of itself. The disagreement was
observable between doors on the same resource, not merely between schema files:
`os plugin build` refused a prerelease the publish door accepted, the Studio
form refused it twice over, the `PATCH` door answered `400`, and the install
door parsed nothing at all. An earlier change collapsed the eight regex literals
onto three exported constants, which removed the drift but not the disagreement.

`@objectstack/spec/kernel` now exports ONE grammar —
`SEMVER_2_0_0_VERSION_PATTERN`, semver.org's own published expression — and
every carrier references it.

## What every author gains, with no edit

Prerelease and build suffixes are accepted on the five carriers that demanded a
bare three-segment core, so `2.0.0-beta.1`, `17.0.0-rc.5`, `1.0.0+20230101` and
`1.0.0-rc.1+exp.sha.5114f85` now pass a key that refused all of them. Identifiers
are case-preserving everywhere, as the standard requires. This repository cuts
prereleases of its own packages while the key describing a package could not
express one; that ends here.

```
FROM  ManifestSchema.parse({ id: 'com.acme.crm', version: '2.0.0-beta.1', … })
      -> throws                              // and `os plugin build` exits 1

TO    ManifestSchema.parse({ id: 'com.acme.crm', version: '2.0.0-beta.1', … })
      -> parses
```

## What stops being accepted, per carrier

Eight strings, all of them forms SemVer 2.0.0 forbids and none of them a valid
prerelease. What they have in common is that no precedence order exists for any
of them — `dependency-resolver.ts` can place none in an order — so a package
versioned this way could be published and never compared against its own
successor.

```
FROM  version: '01.1.1'        TO  version: '1.1.1'     // §2 no leading zero in
FROM  version: '1.01.1'        TO  version: '1.1.1'     //    a numeric identifier
FROM  version: '1.1.01'        TO  version: '1.1.1'
FROM  version: '1.0.0-0123'    TO  version: '1.0.0-123' // §9 no leading zero in a
                                                        //    numeric prerelease id
FROM  version: '1.0.0-alpha..1' TO version: '1.0.0-alpha.1'  // §9 no empty
FROM  version: '1.0.0-alpha..'  TO version: '1.0.0-alpha'    //    identifier
FROM  version: '1.0.0-.'        TO version: '1.0.0'
FROM  version: '1.0.0+.'        TO version: '1.0.0'     // §10 no empty build id
```

⛔ Each repair above is one defensible reading and not the only one, which is
why they ship as ADR-0087 D3 semantic TODOs rather than as mechanical D2
conversions: a version is how a release is addressed, so rewriting one
re-points whatever already resolved the old string. Run
`objectstack migrate meta --from <N>` for the per-site list.

Per carrier:

- `ManifestSchema.version` and its three sibling declarations
  (`MetadataPluginManifestSchema`, `PluginRegistryEntrySchema`,
  `PluginMetadataSchema`), plus the `PATCH /api/v1/packages/:id` door: gain the
  whole prerelease and build space; lose a leading zero in the numeric core.
- `PluginSchema.version` and the plugin boot path in `@objectstack/core`: lose
  those eight and **nothing else**. ⭐ Every valid prerelease and build form the
  loader accepts today it still accepts, which is what keeps the widen-never-
  narrow ruling on that path honoured rather than reversed; both halves of that
  bound are pinned in `plugin.test.ts` and `plugin-loader.test.ts`.
- `PackageVersionSchema.version`: gains case-preserving identifiers
  (`1.0.0-Beta.1`, `1.0.0+Build.5`), which the boot path has always accepted and
  this key alone refused; loses the same eight.
- `PackageManifestSchema.version`: was a bare `z.string()` constraining nothing,
  so it is the one carrier where the grammar is entirely new. `latest`,
  `v1.0.0`, `1.0`, the empty string and `2.0.0-beta.1extra!` were accepted and
  frozen into a published manifest snapshot; each is refused now. A dist-tag
  becomes the version it pointed at, a `v`-prefix drops, a two-segment string
  gains its patch.

## The prose moved with the grammar

Every `.describe()` names SemVer 2.0.0 and the nine generated reference-doc rows
follow; the `PATCH` door's refusal says so; `manifest.test.ts`'s
「should enforce semantic versioning」 case stops listing `1.0.0-beta` among the
invalid versions. `PluginLoader.isSemverShapedVersion` becomes `isSemverVersion`
— a predicate named for a standard it does not implement gets misused by the
next caller whatever its docblock says, and the name is true now.

Three exported constants are retired, each replaced by the one canon:

```
FROM  import { MAJOR_MINOR_PATCH_VERSION_PATTERN } from '@objectstack/spec/kernel'
FROM  import { SEMVER_SHAPED_VERSION_PATTERN } from '@objectstack/spec/kernel'
FROM  import { SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN } from '@objectstack/spec/kernel'
TO    import { SEMVER_2_0_0_VERSION_PATTERN } from '@objectstack/spec/kernel'
```

⛔ They are not interchangeable with what they replaced — each named an accept
set that no longer exists, which is why they are retired rather than aliased. A
consumer that referenced one to REPRODUCE a verdict gets the canon's verdict
now; one that referenced it to match a foreign grammar owns that grammar itself.

The accept set is pinned witness by witness in `version-grammar.test.ts`: move a
cell there and you have moved a published accept set on nine carriers at once,
in one visible edit.
