---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a delegated business-unit walk never starts at a unit outside the caller's organization

Clause-②: no (narrowing) — the delegated-administration gate holds the root of every delegated business-unit walk to the same organization as its descendants, so the range a self-delegation's anchor is judged against holds units of the caller's organization only. Nothing is widened: no export, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package entry changes: a delegation row keeps its shape and meaning, and the range its anchor is judged against is bounded to the caller's organization. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in the delegated-administration gate (`@objectstack/plugin-security`), only for a self-delegation that is anchored, or whose holding is anchored, at a unit outside the caller's organization.

- **Rule.** ADR-0105 D6 (red line 2): every business-unit mechanism operates within one organization. A delegated business-unit walk, its root included, covers only units of the caller's organization. A self-delegation (ADR-0091 D3) anchored at a unit outside the caller's organization, or whose holding's anchor is outside it, is refused `403 PERMISSION_DENIED` with the same answer as an anchor outside the delegator's range, and nothing is stored.
- **Unchanged.** An anchor inside the delegator's range, and an unanchored delegation, are admitted as before. A scope's by-name anchor keeps every answer it gave.
- **Who moves.** Nobody whose delegations and holdings anchor at units of their own organization.
