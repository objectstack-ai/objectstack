---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a delegated scope held in a context that names no organization covers nothing

Clause-②: no (narrowing) — the delegated-administration gate resolves a delegated scope only inside the caller's active organization, so a context that names no organization holds no subtree: it covers no business unit and no user, the delegable-scope report lists no scope and no placeable unit — a tenant-level administrator's report included — and a write under the scope is refused naming the missing active organization. Nothing is widened: no export, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package entry changes: an adminScope keeps its shape and meaning, and the subtree it names resolves in the caller's active organization only. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in the delegated-administration gate (`@objectstack/plugin-security`), only for a context that names no organization.

- **Rule.** A delegated scope held in a context that names no organization covers nothing (ADR-0123 D2: "Tenant-scoped reads resolve to nothing; tenant-scoped writes are refused loudly"). For such a context every answer that reads the scope's subtree is empty: the delegated business-unit read admits nothing, so the read door refuses it `403 PERMISSION_DENIED` as it does for a caller holding no scope; the delegable-scope report lists no scope, no placeable unit and no position assignable through a scope; the explain coverage of a user is false. A tenant-level administrator's delegable-scope report offers such a context no placeable unit either: the units it offers are its active organization's, and a context that names none has none. An assignment or direct grant written under the scope is refused `403 PERMISSION_DENIED` with a message naming the missing active organization, the wording an organization administrator's refusal of the same state already carries.
- **Unchanged.** A context that names its organization gets every answer it got before, a tenant-level administrator's report included. The writes of a tenant-level administrator, an organization administrator's writes and reports, and a self-delegation of duty are judged as before, and a tenant-level administrator's report still lists the positions it may assign.
- **Who moves.** Nobody whose sessions carry an active organization: every session on a stock `single` deployment carries the Default Organization (ADR-0131 C1). A caller that reaches the gate with no active organization selects one first.
