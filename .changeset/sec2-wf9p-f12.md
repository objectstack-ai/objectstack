---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: an elevation's write is judged as it will be stored, and its option bag never widens it past its caller's organization wall

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer a data operation gets under an action body's, a system hook's or a system flow's elevation: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

The rule: an app-authored elevation (an action body, a hook that runs as system, a flow that runs as system) is held to its caller's organization wall on the row as it will be stored and on the tenant scope its option bag asks for, as the caller's plain door is (ADR-0095 D1, ADR-0123 D2).

**BREAKING** for an action body, a system hook or a system flow run for a signed-in caller.

- FROM: the organization a write's before-hooks left on the row, and the `tenantId` / `tenantIds` an operation's option bag named, were not judged against the caller's organization wall.
- TO:
  - a write is judged again on the rows its before-hooks leave: a row stored in an organization outside the caller's wall, or an update that leaves a row in no organization, is refused with `403 PERMISSION_DENIED`;
  - a write (`update`, `delete`, `purge`) whose option bag names an organization outside the caller's wall, or clears `tenantId`, is refused with `403 PERMISSION_DENIED`;
  - a read (`find`, `findOne`) whose option bag names or clears an organization scope is answered by the read rule: the caller's wall is composed onto its predicate, so it reads only rows the wall admits;
  - a before-hook that sets `tenantId` or `tenantIds` on the option bag it is handed is held to the same rule as it sets it.

**Not moved.** A caller with an active organization keeps exactly its reach: a before-hook that keeps the row in an organization the caller's wall admits, and an option bag that names one, behave as before. Objects outside tenancy, objects with no organization column, and a platform operator crossing the wall on an object whose posture permits it are answered as the caller's own requests answer them. System work that runs for no caller (a scheduled run, a platform plugin's own system context, the seeders) is unchanged, its option bag included.

The fix for a body or hook: write only into organizations the caller may write in, and leave `tenantId` / `tenantIds` off the option bag, or name an organization the caller's wall admits. A row that must land in another organization is written by a member of that organization, through its own request.
