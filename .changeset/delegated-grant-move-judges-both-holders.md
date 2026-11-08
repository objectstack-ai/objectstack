---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a delegate can neither capture nor evict a direct grant beyond its subtree

Clause-②: no (narrowing) — an edit that points a direct permission-set grant at another user is judged on both holders it touches, the user it takes the grant from and the user it gives the grant to, so a delegated administrator no longer moves a grant away from a holder outside its subtree, or from a holder it cannot read. Nothing is widened: no export, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package entry changes: a direct grant keeps its shape and meaning, and each holder an edit touches is judged as a target user already is. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in the delegated-administration gate (`@objectstack/plugin-security`), only for a delegated administrator moving a stored direct grant to another user.

- **Rule.** A delegate can neither capture nor evict a direct grant beyond its subtree (ADR-0090 D12). A delegated write on a direct permission-set grant is judged on every holder it touches: an edit that points a stored grant at another user is judged on the holder it takes the grant from and on the holder it gives the grant to, each exactly as the gate judges a target user — through the caller's own read, and inside the subtree only through one of the subtree's business units.
- **What a caller sees.** Such an edit with either holder outside the subtree, or a holder the caller cannot read, answers `403 DELEGATION_SCOPE_VIOLATION`, with the sentence and details of every target outside the subtree, whichever end it is; the stored holder is named only when the caller reads it. A stored grant that names no holder is moved only by a tenant-level administrator (`403 PERMISSION_DENIED`).
- **Unchanged.** The allowlist check on the permission set; an edit that keeps the holder, an insert and a removal; a tenant-level administrator's writes; an organization administrator's writes, whose right creates and removes a grant and never edits one in place.
- **Who moves.** A delegate can no longer re-point a direct grant away from a holder outside its subtree, nor away from a holder it cannot read. Such a grant is moved by a tenant-level administrator, or removed and granted anew by an administrator whose boundary covers both holders.
