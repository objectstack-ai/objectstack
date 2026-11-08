---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a delegated business-unit subtree stays inside one organization, whether or not the caller's context names one

Clause-②: no (narrowing) — the delegated-administration gate bounds every delegated business-unit subtree to one organization: the caller's when its context names one, otherwise the scope root's own. A unit of another organization is outside the subtree, and so is every unit below it, even where its parent link names a unit inside the scope. Nothing is widened: no export, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package entry changes: an adminScope keeps its shape and meaning, and the subtree it names is bounded to one organization for every caller. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in the delegated-administration gate (`@objectstack/plugin-security`), for a business unit whose organization differs from its subtree's only.

- **Rule.** A delegated scope covers the units of ONE organization: the scope root and its descendants that carry that organization. Every answer that reads the subtree follows it — the delegated business-unit read (the read door, `canReadObject`, `getReadFilter`, `security/explain`), an assignment or direct grant written under the scope, the delegable-scope report and the explain coverage of a user. A unit outside it is refused `403 DELEGATION_SCOPE_VIOLATION` on a write and left out of every read and report.
- **Unchanged.** A context that names its organization gets every answer it got before. A unit of the subtree's own organization is inside the subtree, as before. A store whose units carry no organization keeps its whole tree.
- **Who moves.** Nobody whose business-unit tree keeps each unit in its parent's organization.
