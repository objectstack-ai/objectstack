---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/objectql': minor
'@objectstack/service-record-context': minor
---

feat(objectql,service-record-context)!: a context pack (`ai_context`) is identified by its package and its name; `get_record_context` reaches each package's pack by its face

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37177

<!-- adr-0087: registered ai-context-package-scoped-name -->

ADR-0150's addendum of 2026-11-25 puts the context pack in bucket 3 beside `skill`. Two packages may each ship a pack of one name, and each reader reaches the one it means.

- **The four lists.** `ai_context` joins `PACKAGE_SCOPED_TYPES` (`@objectstack/core`: the one ADR-0150 D3 rule resolves a bare pack name), `PACKAGE_SCOPED_READ_TYPES` (`@objectstack/objectql`: the `/meta/ai_context/NAME` read and its `?package=` qualifier), `PACKAGE_SLOTTED_METADATA_TYPES` (`@objectstack/spec/api`: the metadata service keeps one copy per `(package, name)`, and uninstalling one package drops its pack and keeps another package's pack of the name) and `NAMESPACE_UNIQUE_TYPES` (`@objectstack/objectql`: D2's refusal of a second holder inside one namespace).
- **`get_record_context` picks a pack by package and name.** The candidates are still the packs rooted on `objectName`. `context` is read the way a skill prompt's name is read. A face (`NS-NAME` for a package's pack, `deriveAiFaceName`) answers its one pack. A bare name resolves as for a caller with no package: the environment's own pack, else the one package that holds the name, else `409 RESOURCE_CONFLICT` naming each candidate by its face. With `context` omitted on an object with several packs, the answer (`400 VALIDATION_ERROR`) lists each pack by its face with its label, in English and in Simplified Chinese; a pack without a label would be listed by its face alone. The tool's description tells the model to name a package's pack as `NAMESPACE-NAME`.
- **New door member.** `RecordContextDoor.packageNamespace(packageId)` (optional) gives a package's manifest namespace. A door without it spells every pack by its bare name, as an environment pack is spelt.
- **New exports** (`@objectstack/service-record-context`): `contextPackCandidates`, and the types `ContextPackCandidate`, `ContextPackCandidateName`, `PackageNamespaceOf`. `selectContextPack` now takes the candidates `contextPackCandidates` returns, not the parsed packs. Its `several` outcome carries `packs` (each `{ face, label }`) in place of `names`, and its `duplicate` outcome carries `candidates`. `recordContextReadSet` returns the selected pack's face as `pack`. For an environment pack, and on a door without `packageNamespace`, the face is the pack's name, so these answers are unchanged there.

**BREAKING (narrowing), each counted on `objectstack-ai/objectstack` at `d7f299c0` and `objectstack-ai/hotcrm` at `9b735103`:**

- A second package of one namespace that ships a pack name another package of that namespace already holds is refused at install (`409`, the namespace name conflict) and by `os validate`. First-party packages refused: 0. The one declarer, `examples/app-showcase`, ships two packs with different names in one package. hotcrm declares none.
- `GET /api/v1/meta/ai_context/NAME` with no package, for a name two packages hold, answers `409 RESOURCE_CONFLICT` naming both. Before, it served the first match. Read each pack with `?package=ID`. First-party reads refused: 0.
- A package-less pack row under a name a package ships is that package's customization and is not served. The rule is read by type and name, whatever object the row is rooted on. This was already true and this change does not alter it. What changes is which item such a row is compared against: the one holder's. First-party rows affected: 0.

Fix for an upgrading author: give a pack a name no other package of the same namespace uses, and read a shared name by its package. A model names the pack it means by its face, as the refusals list it.
