---
'@objectstack/objectql': patch
---

fix(objectql): a roll-up recompute records the master's last change as the system, not as the person who wrote the child

Clause-②: no
Metadata-protocol: none (runtime audit stamping; no authorable key changes; the dev confirms against the diff)

When someone adds, changes, deletes or moves a child record, the engine recomputes the parent's `summary` (roll-up) fields. That recompute is a write onto the parent, and it used to stamp the parent's `updated_by` with the person who wrote the child. So a finance user who only added an invoice under a contract read as the contract's last editor, although they edited neither record and may hold no edit right on the contract.

The recompute now records the system as the actor on the parent: `updated_by` is set to `null` (the platform's system actor, which the Console shows as 系统), and `updated_at` is refreshed, because a figure on the parent did change. This holds for a child insert, update and delete, and for a child moved to another parent (both parents). The person's own write to the child is still stamped with their name, and a direct edit of the parent still stamps whoever made it. Hooks and record-triggered flows on the parent still see who triggered the change; only the parent's audit stamp changes.

What an upgrade changes: list views, reports, flows or filters on a parent's `updated_by` / "Last modified by" no longer match the child writer after a roll-up recompute; such a parent now reads as last changed by the system. Rows already stored keep the stamp they have until their next recompute or edit.
