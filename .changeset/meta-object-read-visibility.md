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

After the upgrade, every outlet that serves object schemas — `GET /meta/object` and `GET /meta/object/:name` (cached, uncached, layered, published and diff reads), the runtime `/metadata` catch-all, MCP `list_objects`, `describe_object` and `validate_expression`, and the stdio MCP bridge — treats an object the caller may not read (the security service's `canReadObject` does not admit them) as an object that does not exist:

- an object list leaves it out;
- a read of it answers exactly as that outlet answers a name that names no object, before any validator is judged, so no `304` is answered for it.

What does not change:

- callers exempt under ADR-0106 D4 (system context, `manage_metadata`, `studio.access`, `setup.access`) are served every object whole, and a deployment that sets `OS_ALLOW_UNMASKED_OBJECT_METADATA` (D8) is served as before;
- a readable object's reference field still names its target object;
- the action doors (`GET /meta/action`, MCP `list_actions`, and the run doors) judge an action on its object's field projection as before, whether or not the object itself is served to the caller;
- a deployment with no security service is served as before.

If the object read cannot be evaluated, the outlet answers `503 FIELD_VISIBILITY_UNRESOLVED`, as it already does when field visibility cannot be evaluated.

To restore an object for a caller, grant them read access to it (`allowRead` in one of their permission sets); the data plane's read access and the metadata plane's visibility are the same grant.
