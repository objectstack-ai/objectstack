---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@object-ui/app-shell': minor
---

fix(spec)!: an object permission that edits or deletes a record also reads it

Clause-②: no (narrowing) — the authoring object-permission schema refuses an entry granting `allowEdit: true` or `allowDelete: true` without read (`allowRead`, `viewAllRecords` or `modifyAllRecords`), a permission set it accepted before; the permission evaluator grants edit and delete only together with read; and a by-id update or delete from a caller the read door refuses answers that refusal. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: docs moved — `content/docs/permissions/permission-sets.mdx` states the rule under the object permission bits; `skills/**` teaches no entry granting edit or delete without read (its examples grant read beside edit), so no skill moves.

<!-- adr-0087: registered permission-write-without-read-refused -->

**BREAKING** accept-set narrowing on `ObjectPermissionSchema` (and so `PermissionSetSchema`, `definePermissionSet`, `defineStack`, `os validate` / `os build`, and the metadata save and publish doors for `permission`).

- **Before.** `objects: { crm_lead: { allowEdit: true } }` parsed, and the evaluator granted edit on `crm_lead` to a holder who could not read it.
- **Now.** The schema refuses it: one `custom` issue at `objects.crm_lead.allowEdit` (or `.allowDelete`), naming both fixes. `objectPermissionGrants` answers edit and delete as `read ∧ grant` (the shape `allowExport` already had), and `PermissionEvaluator.checkObjectPermission` asks it of the caller's merged entry, so the read half may come from another set — the same answer `/me/permissions` gives the client.
- **Stored rows.** A permission set stored before this release keeps loading; its unread edit or delete grant grants nothing. The response-side `EffectiveObjectPermissionSchema` stays tolerant. A built artifact carrying the shape is refused when it is parsed and is rebuilt from a corrected source.
- **By-id writes.** A by-id update or delete from a caller whose read of the object is refused — with these grants that is a capability the object requires for a read and not for a write — answers that read refusal for every id it addresses: a caller who cannot read an object writes none of its records by id.
- **`@object-ui/app-shell`.** The permission set editor ticks Read when Edit or Delete is ticked, and unticks Edit and Delete when Read is unticked (unless View All or Modify All still grants the read).
- Unchanged: `allowCreate` and `allowTransfer` are not part of this rule.

**FROM → TO.** `objects: { crm_lead: { allowEdit: true } }` → `objects: { crm_lead: { allowRead: true, allowEdit: true } }` if the set should edit the object, or `objects: { crm_lead: {} }` if it should not. The upgrade-guide entry is `permission-write-without-read-refused` (a semantic migration: no automatic rewrite, because only the author knows which of the two the set means).
