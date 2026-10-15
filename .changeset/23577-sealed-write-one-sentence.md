---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(metadata-protocol): every write over a sealed, package-held name reads one sentence that states what the door knows; the inferred create remedy retires

Clause-②: no

**What was wrong.** A save over a name a managed package holds, on a type with no environment overlay, is refused `403 NOT_OVERRIDABLE`. The sentence guessed what the save meant from `If-None-Match: *`. A publish-mode `*` was told "… so its name is taken. To author your own TYPE, choose a name no package or built-in holds …", and every other save, the console's generic create (`?mode=draft` with `If-None-Match: *`) included, was told "… Edit the source artifact and redeploy." Neither request declares a create or an edit, so each remedy was wrong for one of its callers. An editor who followed the first authored a second item. A creator who followed the second, and every administrator of an installed package, was sent to an artifact they cannot edit.

**What changed.**

- `@objectstack/metadata-protocol`: every write over such a name, on a type with no regime row, reads one sentence, whatever its mode or pin: "'TYPE/NAME' is provided by a managed package and is sealed: it cannot be written here. GET /api/v1/meta/TYPE lists the names in use." The same sentence comes from the repository's type door (draft promotion, restore, revert). It gives no create advice and no source-artifact advice. It names no holding package, because neither door has the package at hand. This supersedes the draft/publish split described in this release's earlier entry for the first-draft remedy. A type with a regime row (`flow`, `action`, `permission`, `datasource`) keeps its regime sentence, and every removal keeps its sentence.
- `@objectstack/metadata-protocol` (retired, no producer remains): the `'create'` member of `ObjectStackProtocolImplementation.packagedBaseRefusal`'s `operation` (now `'save' | 'delete'`), the `operation` parameter of `tenantAuthoredWriteRefusal`, and the `create` arm of the internal `SealedItemOperation`. A caller that passed `operation: 'create'` passes `'save'`: the verdict, code and status were always the same.
- `@objectstack/spec`: the `GetMetaItemResponseSchema.version` and `MetadataConflictErrorSchema.currentVersion` descriptions say that a `null` beside `editable: false` takes no save, and prescribe no `If-None-Match: *` pin for it.
- `@objectstack/runtime`: a permission-set clone (`POST /api/v1/security/permission-sets/:name/clone`) whose save loses the race for the target name now answers the door's own `409` name-taken refusal ("Permission set 'NAME' already exists — a clone must take a NEW machine name. …", code `RESOURCE_CONFLICT`), the same refusal a name the catalog already held reads. It used to relay the `/meta` door's conflict sentence, which told the caller to send `If-Match`, and this door takes no `If-Match`.

**Unchanged.** Which requests are accepted or refused. The `NOT_OVERRIDABLE` code and `403` status. The named read-only base's `ITEM_LOCKED` sentence. The `/meta` door's conflict sentence for its own callers.
