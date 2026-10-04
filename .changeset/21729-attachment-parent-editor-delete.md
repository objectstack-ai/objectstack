---
'@objectstack/service-storage': minor
'@objectstack/plugin-security': minor
---

A user who can edit a record may delete another user's attachment on it, as the attachment gate declares (#21729).

Clause-②: yes (widening)

- **What was refused.** The attachment gate's delete rule is "the uploader OR a user who can edit the parent record". For every member holding `org_member`, the platform's row-level delete floor in `member_default` (`owner_only_deletes`: only the rows you created) answered first, so a parent editor's delete of someone else's attachment was refused with `PERMISSION_DENIED` before the gate ran.
- **`@objectstack/service-storage`** contributes a delete-only alternate match for `sys_attachment` (`sys_attachment_parent_editor_delete`, every row) when it installs the attachment gate, and only then. The gate decides: a parent editor's delete answers 200, and a caller who can read the attachment but neither uploaded it nor can edit the parent is refused with `ATTACHMENT_DELETE_DENIED`. A caller who cannot read the parent cannot see the attachment, and is still refused with `PERMISSION_DENIED` before the gate runs, so the parent is not named to them.
- **Without `@objectstack/service-storage`** nothing is contributed. A deployment that registers `sys_attachment` without the storage service keeps the floor, and only a row's creator may delete it.
- **The edit limb is unchanged.** Editing another user's attachment row is still refused by the floor for a member it binds, a parent editor included.
- **`@objectstack/plugin-security`** gains the seam: `contributeOwnershipFloorAlternates(plugin, alternates)` on the registered `security` service, an extension of `ISecurityService` that callers feature-detect. Each alternate names one object (never `'*'`), one floor limb (`update` or `delete`; `all` is refused) and a `using` predicate. It lands beside each enabled floor policy of that limb, in that policy's own `positions` domain, so it reaches only the principals the floor binds. A plugin's second call replaces its first, and an empty list withdraws it. A contribution that breaks these rules throws.

Nothing that was admitted before is refused now. No principal outside the floor's domain, and no other object or operation, changes.
