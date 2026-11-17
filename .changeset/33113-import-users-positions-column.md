---
'@objectstack/plugin-auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-auth): `POST /api/v1/auth/admin/import-users` takes a `positions` column, assigned in a second pass as Setup assigns a position

Clause-②: yes (widening)
Metadata-protocol: none

The user import gains one column, `positions`: position machine names, several separated by `;` (or an array on a JSON row) — the same column `admin/import-sso-users` reads. Nothing that worked before is refused: a file with no `positions` column imports exactly as before.

- Each named position is assigned after every row of the batch has landed, as a `sys_user_position` grant written under the importing administrator's own execution context, so it passes the same checks as assigning a position in Setup (the position catalog, delegated administration, the holder's organization membership).
- A position that does not exist (`unresolved`) or whose assignment is refused (`refused`, with the refusal's `code`) is reported on its row, and the user is still created. `rows[].positions` lists each named position's outcome (`assigned`, `already_assigned`, `unresolved`, `refused`), a cell that is not a list reads `'unreadable'`, and `summary.positions` counts them. The import only adds positions; it never removes one.
- When the positions cannot be judged at all, the users are still created and every named position is reported `refused` on its row: `NOT_IMPLEMENTED` on a server that cannot assign positions during an import, `PERMISSION_DENIED` when the caller's own access does not resolve. Dry runs do not assign.
- There is no permission-set column: a position carries its permission sets.

`@object-ui/app-shell`: the Users import wizard offers a `positions` target column, and its options panel explains the column (`console.identityImport.positionsHint`, in every `@object-ui/i18n` pack).
