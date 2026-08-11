---
'@objectstack/plugin-security': minor
---

Split `controlled_by_parent` write refusals by true semantics: three of the six legs stop answering `403 PERMISSION_DENIED`

A by-id write to a `controlled_by_parent` detail is refused for six distinct reasons, and all six used to answer with one envelope and one sentence — `403 PERMISSION_DENIED: … requires edit access to its master record`. Only three of them are authorization verdicts. The other three said something untrue and prescribed a remedy that could not work: "ask whoever owns the parent record" cannot fix a null master reference, a deleted row, or an object that declares `controlled_by_parent` with no `master_detail` relation to derive access from.

Unchanged — the three genuine verdicts keep `403 PERMISSION_DENIED` and their exact wording:

- the caller holds no object-level `update` on the master
- the master row lies outside the caller's write RLS
- the master carries no `edit`-level share grant

Changed — the three non-verdict conditions now answer for what they are:

| condition | before | after |
|---|---|---|
| `controlled_by_parent` declared with no `master_detail` relation | `403 PERMISSION_DENIED` | `422 INVALID_METADATA` |
| the target detail row does not exist | `403 PERMISSION_DENIED` | `404 RECORD_NOT_FOUND` |
| the detail's master reference is empty | `403 PERMISSION_DENIED` | `422 MISSING_REQUIRED_FIELD` |

Each carries a message written for the app author, naming the object, the operation and the remedy. The metadata-defect case is the one that matters most: it is a precisely detectable authoring defect that was disguised as routine RBAC noise, so nobody ever investigated it — and a false 403 steers debugging, human or agent, toward permission changes when the truth is broken metadata.

The 404 does not widen what a caller can learn. The detail row is probed under a system context, so a row hidden from the caller by row-level security is still found and falls through to the authorization legs; object-level CRUD and the row-level write pre-image check both run before this gate. Absence there is real absence.

All codes come from the existing ADR-0112 vocabulary — no new error code is introduced.
