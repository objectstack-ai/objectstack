---
"@objectstack/lint": minor
---

fix(lint)!: a permission set's field-permission key with an empty object part (`'.FIELD'`) is refused as unqualified, at `os validate` and at the metadata save door alike (#23549)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is added, removed, renamed or re-shaped, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a lint verdict, and with it the accept set of the save door that runs the lint: a `fields` key whose object part is empty is now refused where it was accepted. No ledger entry can derive the repair, because an empty object part does not say which object the author meant; the repair is the author's edit of the key. A stored set holding such a key keeps loading until it is next saved, and that save is judged. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict and none is added (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A permission set's `fields` map is keyed `OBJECT.FIELD`, and the security plugin applies a set's field rules to an object by the key prefix `OBJECT.` (`PermissionEvaluator.getFieldPermissions`). A key whose object part is empty, such as `'.full_name'`, matches no object, because no object name can be empty, so the mask it declares never enforces: the field stays exactly as readable and editable as the object-level grant leaves it, for every holder of the set.

**What changes for `'.FIELD'`.**

- Before this change, both field-permission rules let the key through. `security-fls-unqualified-key` skipped every key containing a `.`, and `security-fls-unknown-field` read the empty object part as another package's object and did not judge it. `os validate`, `os build` and `os lint` passed the stack, and the metadata save door stored the set with `success: true`.
- Now `security-fls-unqualified-key` reports it, at `error`: a key is object-qualified only when it has a non-empty object part before its first `.`. The finding sits at `permissions[N].fields[".FIELD"]`. Its message says the object part before the first `.` is empty, and its fix line names the `'<object>.<field>'` form, with an example that keeps the remainder as the field when it is one plain name. `security-fls-unknown-field` no longer considers the shape, so each such key earns exactly one finding. The same holds for `'.'`, `'..FIELD'` and `'.FIELD.MORE'`.
- At the save door, a `permission` write in publish mode that carries such a key now answers `422 INVALID_METADATA`, with one `security-fls-unqualified-key` issue. This covers `PUT /api/v1/meta/permission/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`publishMetaItem`), and every door that saves through `saveMetaItem`: cloning a permission set, `duplicatePackage`, the import of an unmanaged package, the organization-ownership ceremony, and `os migrate meta` when it re-saves a converted active row (that row is then reported `failed` and keeps reading as stored).

**Remedy.** Put the object's name before the `.`, so `'.full_name'` becomes `'crm_account.full_name'` for the object whose field it masks. Saving the set as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- A qualified key naming a real field (`OBJECT.FIELD`) is accepted as before.
- A key naming an object this stack does not define, such as `no_such_object.x` or `no_such_object.`, is still not judged, because another installed package may declare that object.
- A bare key (`full_name`) is refused under `security-fls-unqualified-key` with the same message and fix line as before; an empty or dangling remainder on an object of this stack (`crm_account.`, `crm_account.owner.name`) is refused under `security-fls-unknown-field` as before.
- Stored rows are not migrated, and they are not refused on read or at boot: the save door judges new writes only. A set stored before this change keeps loading until it is next saved, and that save is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- No rule id, error code, export or signature is added or removed. `PermissionSetSchema` is unchanged.
- Measured before this change: no permission set in this repository's examples, templates, skills or fixtures carries a `fields` key that starts with `.`.
