---
'@objectstack/metadata-core': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(meta)!: every schema-serving outlet answers an object the caller may not read as an object that does not exist

Clause-②: yes (narrowing) — the metadata plane's object schemas narrow to the objects the caller may read: an object the caller may not read is left out of every object list and is read as an unknown name.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing an author writes changes meaning. The object-schema posture gains one member and the security surface it reads gains the existing object-level read admission, so there is no stored shape for a migration to rewrite and no tombstone. -->

**BREAKING** — the metadata plane now applies object-level read access as well as field-level read access (ADR-0106, amended by ruling record 6787890900).

After the upgrade, every outlet that serves object schemas — `GET /meta/object` and `GET /meta/object/:name` (cached, uncached, layered, published and diff reads), the object state-machine read `GET /meta/object/:name/state/:field`, the runtime `/metadata` catch-all, MCP `list_objects`, `describe_object` and `validate_expression`, and the stdio MCP bridge — treats an object the caller may not read (the security service's `canReadObject` does not admit them) as an object that does not exist:

- an object list leaves it out;
- a read of it answers exactly as that outlet answers a name that names no object, so every outlet reaches the same answer. The metadata API's reads of one object by name — `GET /meta/object/:name` (cached, uncached, layered, published and diff reads), the state-machine read, and the runtime `/metadata` catch-all's read of one object — give that answer before the store or any validator is consulted, so no `304` and no store answer about that object is returned for it.

A caller with no principal, or with no resolved permission set, is served no object. The D7 fallback permission set decides which fields are served, never which objects exist for the caller.

What does not change:

- callers exempt under ADR-0106 D4 (system context, `manage_metadata`, `studio.access`, `setup.access`) are served every object whole;
- the D8 switch (`OS_ALLOW_UNMASKED_OBJECT_METADATA`, or `metadata.maskObjectFields: false`) now also governs object visibility: with it set, every caller is served every object, as before;
- a security service that answers field visibility but offers no object-level read admission narrows no object; the runtime says so once, at warn;
- a readable object's reference field still names its target object;
- the action doors (`GET /meta/action`, MCP `list_actions`, and the run doors) judge an action on its object's field projection as before, whether or not the object itself is served to the caller;
- a deployment with no security service is served as before.

What is enforced when a read cannot be evaluated: a fault in the field question answers `503 FIELD_VISIBILITY_UNRESOLVED`, as before, and is asked first; an object admission that throws answers the same `503`, never an empty list; a fault the security service's object admission folds into "not admitted" is answered as the object not existing, which fails closed.

Known residuals, not narrowed by this change: outlets that carry only object names and labels (the API description document, label bundles), navigation entries that name an object, and the object state-machine read's field level — that read applies the object-level rule, not the field projection.

To restore an object for a caller, grant them read access to it (`allowRead` in one of their permission sets); the data plane's read access and the metadata plane's visibility are the same grant.
