---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): every refusal of an in-place edit of a packaged flow, action or permission set names that type's own sanctioned path, at every door, and a packaged action's removal names one too, not a redeploy or `OS_METADATA_WRITABLE` (#20910)

Clause-②: no

ADR-0126 puts `flow`, `action` and `permission` in Regime C. The packaged base is locked, and the refusal names the sanctioned path. Until now only a flow's package-less refusal did, and only at one of the three places that refuse such a write. The other places prescribed "Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE …" or "Set OS_METADATA_WRITABLE to enable additional types at runtime". A packaged action's removal named no path at all.

There is now one regime table, and each type's row names only the primitives that type has:

- a packaged flow: clone it under a new name with `POST /api/v1/automation/:name/clone` and `{ name, label }`, or switch it off with `POST /api/v1/automation/:name/toggle` and `{ enabled: false }`;
- a packaged action: switch it off with `POST /api/v1/actions/_activation/:object/:action` and `{ enabled: false }` (`:object` is `global` for an object-less action). No clone is named, because cloning an action is not a sanctioned path;
- a packaged permission set: clone it under a new name, with the "Clone" action on the permission set or `POST /api/v1/data/sys_permission_set` with a new name. This is the same wording the permission-set lock in `@objectstack/plugin-security` already uses.

The switches are operator-only where one install serves several organizations. Every refusal cites ADR-0126. All three places that refuse such a write read the same table:

- **`403 NOT_OVERRIDABLE` on an environment-scoped kernel.** This covers `PUT /api/v1/meta/:type/:name` without `?package=`, and for a flow or an action `DELETE` too.
- **`403 NOT_OVERRIDABLE` where the `/meta` protocol is not environment-scoped**, for example the default local `pnpm dev` boot. The metadata repository refuses that write one layer down, and now with the same sentence.
- **`403 ITEM_LOCKED` for a write that names the read-only package with `?package=`, while `OS_METADATA_WRITABLE` is not set for the type.** The sentence now opens "Cannot overlay 'TYPE' in package 'ID': that package is read-only, and its packaged base is locked against in-place edits." and then names the path.

A packaged flow's package-less sentence is byte-for-byte unchanged. Statuses, codes, `lockSource`, `packageId`, `docs` and which writes are refused are unchanged too. `OS_METADATA_WRITABLE` still opens the lock for a write that names no package. The `ITEM_LOCKED` refusal given while the variable IS set reads exactly as before. Removing a permission set's overlay row is still allowed, as repair. Every type with no declared regime reads exactly as before, at every door.
