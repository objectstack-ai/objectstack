---
'@objectstack/metadata-core': patch
'@objectstack/objectql': patch
'@objectstack/cloud-connection': patch
'@objectstack/cli': patch
---

fix(metadata-core,objectql,cloud-connection,cli)!: the package upgrade plan counts the fields a package adds through `objectExtensions`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row changes: what moves is which fields the package upgrade comparison reads from each version, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for an upgrade that retypes, or drops and replaces, a field the package adds to an object through `objectExtensions`. Such an upgrade now stops with `409 SCHEMA_UPGRADE_CONFIRMATION_REQUIRED` until it is confirmed, exactly as the same change to a field of an object the package declares does. Before, it installed without a question.

The package upgrade plan (`comparePackageVersions`) read only a version's `objects` and `data`. A field an `objectExtensions` entry adds, retypes or drops was therefore missing from the upgrade preview, from the rows counted per touched column, and from the schema upgrade verdict. A preview of an upgrade that added seven columns through extensions listed no added field, and its rollback listed no removed one.

Now each side of the comparison is the objects as the registry serves them from that version: the owner's declaration, with every extension's `fields` merged over it by name, in ascending `priority` (`200` when none is declared). The existing rules then apply to an extension field unchanged:

- an extension field added is listed in `plan.fields.added`, and one dropped in `plan.fields.removed`, with the rows holding a value counted in `environment.columns`;
- an extension field retyped is a type change; `needs_confirm` and `destructive` changes need the confirmation, and a `safe` one does not;
- an extension field dropped while another stored field of the same object is added, with no `renamedFrom` linking them, is a suspected rename and needs the confirmation; a field dropped alone is listed and refused by nothing, as an owned one is.

An object a version reaches only through an extension (another package owns it) is compared by the fields the extension adds. It is never listed in `plan.objects.added` or `plan.objects.removed`, because the upgrade neither creates nor drops it. `os diff` prints the field changes of such an object under `objects.<name>.fields`.

`PackageUpgradeSide` (`@objectstack/metadata-core`) gains an optional `objectExtensions` list. A caller that builds a side itself passes the version's `objectExtensions` beside its `objects`, read with the same collection reader; a side without the key compares as before.

Who moves: an installer upgrading a package whose new version retypes an extension field, or drops one while adding another to the same object. The fix: confirm the findings with the token the refusal names (`--confirm-upgrade <token>` on `os deploy` and `os package install`).

Unchanged: a plan over packages that declare no `objectExtensions` is the same plan as before; seed datasets are compared as before; `fieldPatches` changes display properties only and stays out of the comparison.
