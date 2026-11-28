---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
---

feat(runtime): `POST /api/v1/packages/:id/move-in` moves a selection of loose items into one package, each through the save door

Clause-②: yes (widening)
Metadata-protocol: added — the five new `@objectstack/spec/api` MoveIntoPackage* schemas enter the `api` authorable-surface shard (23 keys); no metadata key an author writes is added

The door ADR-0084's amendment of 2026-11-26 names ("Loose items stay where they are, and one door moves them"; ruling 7184753035, question 3). It takes a selection, never "everything loose": `{ items: [{ type, name, member? }], dryRun? }` (`MoveIntoPackageRequestSchema`, strict). New in the public surface: the route, `MoveIntoPackageRequestSchema`, `MoveIntoPackageResponseSchema` and their item schemas and types in `@objectstack/spec/api`, the protocol method `moveIntoPackage`, the SDK method `client.packages.moveIn(id, request)`, and the message key `packages_move_in_unsupported` (four locales). Nothing an author writes into metadata changes.

What a move does:

- Only an item bound to no package moves. An overlay of a shipped item and a `.custom` pair item are not loose and are refused `NOT_LOOSE`.
- The target is judged by the save door's own predicates: an uninstalled package is refused `422 WRITABLE_PACKAGE_REQUIRED`, and a package the deployment ships is refused as every package write door refuses it.
- An object is judged against the target by the save door's object judges: the namespace prefix (`NAMESPACE_PREFIX`), the namespace clash (`NAMESPACE_CONFLICT`), the package that owns the name (`OBJECT_OVERLAY_PACKAGE_MISMATCH`) and the `__c` reservation.
- The selection is judged as a set (ADR-0150 D3 (a)): a moved item that names a loose item of a package-scoped type the selection leaves behind is refused `REFERENCE_LEFT_BEHIND`, with the names in `references`.
- Each selected item's type is judged as a write of that type: moving a `datasource` needs the platform-settings capability and moving a `knowledge_source` needs the knowledge-source capability and passes that source's own admission, as saving one does (`403`).
- Then every item goes through the delete door (storage kept, naming the version the judgement read, so a save in between answers `409 METADATA_CONFLICT`) and the save door into the target, so every other save-door judge runs too, and each type writes through to the registry at once: a moved flow and dataset are read at the package's address with no restart. Items other than objects and the package commit (`operation: 'apply'`) run in one transaction. Objects move just before it, outside it, because an object's save syncs its storage, and that DDL waits forever on the lock a SQLite transaction holds. A later refusal undoes them.
- Whole or nothing: any refusal answers `422` with the first item's code in `error.code` and the whole answer (`outcome: 'refused'`, every item's refusal) in `error.details`. What had moved is moved back, with the registry and the mutation signal replayed at both addresses, so every item is loose and resolves as before. A failure that is not a refusal answers `500`, every item loose as before; if moving an item back fails, the `500` names the items that did not go back.
- `dryRun: true` answers `outcome: 'would_move'` with what each item's addresses become from the judgement made before any door runs (loose, target, the object judges, the set). It calls no door and writes nothing, so a save-door judge that runs only on the real move can still refuse an item a dry run passed.
- `client.packages.moveIn` resolves the answer for `moved` and `would_move`. A refusal, a refused dry run included, rejects with the first item's code as `code` and the whole answer as `details`.

Measured on this door: after a move, `_env/NAME` answers `409 RESOURCE_CONFLICT` naming the package that now holds the item, and the bare name and `NAMESPACE/NAME` answer `200`.

`POST /packages/:id/adopt-orphans` is unchanged here. Its retirement is the second half of #38150 and ships in the same release.
