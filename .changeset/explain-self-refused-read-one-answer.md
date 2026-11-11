---
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(plugin-security)!: a caller whose read of an object is refused is explained the same for every record id, decided by that refusal

Clause-②: yes (narrowing) — a record-grained `security.explain` asked by a principal about its own access, where that principal's read of the object is refused, answers every record id with one explanation: `visible: false`, `decidedBy` the layer that refused the read, singular and batch alike, on every operation; the comment and attachment gates that admit a parent edit on that explanation's `update` verdict follow it.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or retyped: what moves is the answer `security.explain` computes for one kind of asker, and the contract text that states it. Nothing at rest records that answer, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING.** A principal explaining its own access, whose read of the object is refused (a declared 4xx, such as no read grant on the object, or a read capability the object asks that the principal does not hold), gets the same explanation for every record id (ruling of record 6787890900):

- the record verdict is `visible: false`, with `decidedBy` naming the layer that refused the read (`object_crud`, `required_permissions`), taken from a read-operation pass; where no layer names the refusal, `decidedBy` is omitted, for every id alike;
- every layer's per-record attribution is the one an id no row carries gets, prefaced with the sentence that the principal's own read of this object is refused;
- the explanation never tells a stored record from a missing one, on any operation, and the batch form (`recordIds`) answers each id the same way;
- the comment gate (`@objectstack/plugin-audit`) and the attachment gate (`@objectstack/service-storage`), where they judge a parent edit by the caller's own `update` explanation of the parent record, admit it only when that explanation is allowed and visible; so they refuse a caller who holds edit on the parent object while its read of that object is refused, whatever kind of principal it is.

This is the security service's explain (`security.explain`, the REST explain route and every in-process caller of the service). The plugin-security engine export `explainAccess(deps, input)`, which is handed no asker, keeps answering a refused read by its own read question, as before.

A principal asking for itself is recognised by the request (no other user named), whatever kind of principal it is. A principal who can read the object is answered as before, and an asker explaining another user keeps the answer it had: an id it cannot read is the missing record, with no decider for the read.

What to do: a client that showed a per-record explanation to a principal without read access should expect one answer for every record id, naming the read refusal. To explain a record's own story, or to let a principal comment on or attach to a record it edits, grant the principal read on the object (and any capability the object's read requires).
