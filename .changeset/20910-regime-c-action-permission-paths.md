---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the refusal of an in-place edit of a packaged action or permission set names that type's own sanctioned path, and a packaged action's removal names one too, not a redeploy or `OS_METADATA_WRITABLE` (#20910)

Clause-②: no

ADR-0126 puts `action` and `permission` in Regime C beside `flow`: the packaged base is locked, and the refusal names the sanctioned path. Until now only a flow's refusal did. An in-place `PUT /api/v1/meta/action/:name` or `PUT /api/v1/meta/permission/:name` onto an item a code package ships, without `?package=`, was refused with `403 NOT_OVERRIDABLE` and "Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE to grant a runtime escape hatch", citing ADR-0005. A `DELETE /api/v1/meta/action/:name` of a packaged action was refused with a sentence that named no path at all.

Each refusal is now built from its type's row in the protocol's regime table, names only the primitives that type has, and cites ADR-0126:

- a packaged action, on save and on removal: switch it off with `POST /api/v1/actions/_activation/:object/:action` and `{ enabled: false }` (`:object` is `global` for an object-less action). Where one install serves several organizations, only the platform operator can use the switch. No clone is named: cloning an action is not a sanctioned path.
- a packaged permission set, on save: clone it under a new name, with the "Clone" action on the permission set or `POST /api/v1/data/sys_permission_set` with a new name. That is the same wording the permission-set lock in `@objectstack/plugin-security` already uses.

A packaged flow's refusal is byte-for-byte unchanged. The status, the code and which writes are refused are unchanged too: `OS_METADATA_WRITABLE` still opens the lock as before, and removing a permission set's overlay row is still allowed, as repair. Every type with no declared regime reads exactly as before.

These sentences are answered where the metadata protocol's package door runs, which is an environment-scoped kernel. Two other refusals are left as they were. A write that names the shipping package with `?package=` is refused with `403 ITEM_LOCKED` by a separate limb. On a kernel whose `/meta` protocol is not environment-scoped, a packaged action's write is refused one layer down, by the metadata repository, with its own sentence.
