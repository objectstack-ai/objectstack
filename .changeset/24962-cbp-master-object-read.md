---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a `controlled_by_parent` detail's read scope requires object-level read on its master (ADR-0055 §3)

Clause-②: no

ADR-0055 §3 says reading a detail requires read access to its master, and §4 says a member who cannot read the master can neither read nor by-id-write a detail under it. The master-derived read scope of a `controlled_by_parent` object scoped the master's rows, but it did not ask whether the principal may read the master object at all. It now asks first, through the predicate `canReadObject` answers. A principal the master's own read door refuses at the object gate gets an empty master set, so it reads no detail under that master.

- **Every door that composes the scope.** The engine read door (`find`, `findOne`, `count`), the delegator half of an on-behalf-of read (ADR-0090 D10), `getReadFilter`, and every hop of a chain all answer this way.
- **The write doors follow.** A by-id update or delete of such a detail answers the read door's not-found (`RECORD_NOT_FOUND`, 404), as it does for any row the principal cannot read. A predicate update or delete matches no such detail.
- **The engine already gave this answer.** Its ADR-0139 `ReadableIds` leaf asks `canReadObject` before it scopes a parent's rows. The id-list derivation and the leaf now agree.
- **Unchanged.** A principal that may read the master object keeps its previous answer, whether or not its master rows are scoped. So do a system context, a super-user grant, and an on-behalf-of read whose delegator may read the master.
