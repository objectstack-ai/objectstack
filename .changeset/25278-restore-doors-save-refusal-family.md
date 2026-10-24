---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: `rollbackMetaItem` and `revertCommit` refuse a stored version the save door refuses, instead of writing it back live

Clause-②: no (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered object-external-binding-managed-datasource-refused, page-default-record-page-one-per-object-refused, api-endpoint-anonymous-elevated-flow-refused) no rule is added or changed: the restore doors now ask the save door's existing refusals, and the ledger entries of the three that carry one already describe the refused shape and its fix -->

**BREAKING** (what a metadata restore writes narrows), shipped as `minor` under the 18.x convention for breaking changes.

The two restore doors write a stored history body back as the active row: `POST /api/v1/meta/TYPE/NAME/rollback` (`rollbackMetaItem`) and the restore limb of a commit revert (`revertCommit`, which `rollbackToPackageCommit` also uses). They asked only the save door's `name` and permission-set owner judges, and none of the refusals `saveMetaItem` runs after its schema gate. So a version saved before a refusal existed, or one half of a pair whose other half moved after the version was saved, came back live.

- **FROM:** a rollback or a commit revert restored a version that the save door would refuse today:
  - a hook with no `body`;
  - a record page marked `isDefault` for an object whose default another page now holds;
  - a datasource restored to `schemaMode: 'managed'` (or no `schemaMode`) while objects bind it `external`;
  - an object restored with `external` on a datasource that is managed now;
  - a `runAs: 'system'` flow that an anonymous (`authRequired: false`) endpoint names;
  - a body the shared runtime authoring rules refuse;
  - a body a domain plugin's authoring gate refuses (plugin-security's object posture gate, for example).
- **TO:** each restore door asks those refusals through the save door's own functions, with the save door's code and status, and stores nothing on a refusal. The active row, the history and the registry stay as they were.
  - `rollbackMetaItem` answers the refusal: `400 VALIDATION_ERROR` for the hook, `422 DEFAULT_RECORD_PAGE_CONFLICT` for the page, `422 INVALID_METADATA` for the datasource pair, the flow and the authoring rules, and the plugin gate's own code.
  - `revertCommit` reports the refused item in `failed[]` with that code and reverts the commit's other items, as it does for its other per-item refusals.
- **Unchanged:** a version the save door accepts restores as before. The restore does not run the schema parse on the history body, does not apply the read-only-base create refusal (that refusal judges a package a caller names for a new item; a restore names none and writes into the active row's own package binding), and keeps the write-only credential channel's current credential. The runtime authoring rules' advisories are not added to the restore response.
- **The fix for an author:** a refused restore names the same problem the save door names. Restore a different version, or first change the other half of the pair (for example, remove `external` from the bound objects before restoring the datasource as managed), then restore again.
