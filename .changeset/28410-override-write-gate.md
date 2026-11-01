---
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
'@objectstack/cloud-connection': minor
'@objectstack/spec': patch
---

**BREAKING** feat(metadata-protocol)!: the override write gate — only a base's paired `<base>.custom` package declares an override, and a dependent's item under a base item's name is refused (ADR-0146 D2, #28410)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches the `overrides` declaration, a `<base>.custom` package or the sealed-write sentence; the `content/docs/references/**` pages that show `overrides` are generated from the spec and do not move.

<!-- adr-0087: not-required (no-migration-prescription) The narrowing is a refusal at the write doors (publish, `os validate`, the marketplace managed install) of item NAMES and of an `overrides` declaration outside the base's paired package: no metadata key, accepted value, export or error code is removed or renamed, and no stored shape changes. The remedy is a rename of an item, or a declaration added in the base's paired `.custom` package, both authoring choices a person makes; there is no mechanical conversion between two metadata versions for `objectstack migrate meta` to apply, and the precondition count on #28410 found no same-named item inside a dependency closure in hotcrm or the repository's examples. The other categories are closed on facts: all three packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); the one `packages/spec/**` file touched is the error-code provenance ledger (`api/error-code-ledger.zod.ts`), two rows naming new emitters of the already-registered `NOT_OVERRIDABLE`, so no schema, type or runtime interface moves (not type-surface-only, not runtime-interface-only); and no export is retired (not runtime-export-retired). -->

A dependent package used to be able to ship, publish or install an item under the name an item of a package in its dependency closure already has, and nothing said which one a reader would get. Ruling A on #28390 settles it: only the base's paired `<base>.custom` package declares an override (`overrides: { package: '<base>', basedOn }`), and a dependent's same-named item has one fix, rename.

**What is refused**, `403 NOT_OVERRIDABLE` (the code and status the sealed write already answers), each with its own sentence:

- **An undeclared same name inside the closure.** A dependent's item bearing the name of an item a read-only (installed) package in its dependency closure ships, on a type a declared override can replace. In `<base>.custom` the sentence says to declare it or rename it; in any other dependent, to rename it.
- **`overrides` outside the pair.** A declaration on a package that is not the base's paired `.custom`.
- **A declaration the closure cannot back.** `overrides.package` outside the declaring package's dependency closure (the sentence says to declare the dependency), or a base that ships no item of that type and name.
- **A type that takes no override.** An excluded type (permission, position, capability, the code-only types…), pointing to creating a new item under a new name; an `object`, pointing to `objectExtensions`.
- **A channel not yet open.** A declared `flow` ("flow customization is not yet available") or `action`.

**Where.** The save door (`saveMetaItem`, so `PUT /api/v1/meta/:type/:name` and every authoring path through it), the promotion (`publishMetaItem` and `publishPackageDrafts`), `os validate` (each package of the artifact against its closure inside the artifact; exit 1), and the marketplace managed install (`POST /api/v1/marketplace/install-local`, before any write). The undeclared-same-name refusal is asked last at the publish doors, so every refusal those doors already answered keeps its code and status.

**Admitted.** The base's paired `.custom` declaring an override of an item its base ships, on an open type: the save and the promotion write it as the pair's own row, and the managed install registers it.

**The install answer lists upgrade collisions.** An install of a base whose new version ships a name an installed dependent already holds, undeclared, answers `200` with `overrideCollisions` (`type`, `name`, `packageId`, `rule`, `message`), one row per held item; the key is omitted when there is none. The install is not refused: the dependent's item is the one to rename, or in `.custom`, to declare.

**The sealed sentence.** A write over a sealed item of a type a declared override can replace now names the writer's route in place of none. Written from the base's paired `.custom`, or naming no package, it ends "To change it, declare an override from '<base>.custom' (overrides: { package: '<base>', basedOn }), or rename the item."; written from any other package, "To change it, rename the item: only '<base>.custom' may declare an override of '<base>'."

**A malformed `overrides` is not a declaration.** A value the spec's `OverrideDeclarationSchema` refuses (null, not an object, no or an empty `package`, no `basedOn`) is not judged by the gate; the save door's schema gate answers it (`422 INVALID_METADATA`), and `os validate` reports it at its schema step.

`@objectstack/metadata-protocol` exports the gate's rule, `judgeOverrideWrite`, and its item walk, `overrideWriteItemsOf`, so the three doors ask one judgement.

`@objectstack/spec` records the two new emitters of `NOT_OVERRIDABLE` in its error-code provenance ledger (`api/error-code-ledger.zod.ts`, under `@objectstack/cli` and `@objectstack/cloud-connection`). The code was already registered, so the union, casing and every schema are unchanged.
