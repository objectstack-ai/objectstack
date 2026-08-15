---
'@objectstack/plugin-security': minor
---

**Security boundary change — this WIDENS who may write rows that are refused today.** On an ADR-0055 `controlled_by_parent` detail, the ADR-0055 master gate is now the sole row-level write authority: the platform's wildcard ownership floor (`owner_only_writes` / `owner_only_deletes`, `created_by == current_user.id`) is no longer applied to such a detail at the by-id write pre-image gate. A by-id UPDATE or DELETE of a child row **created by another user** now succeeds whenever the caller may edit that child's master — where it previously answered `403` `record_access_denied`. Maintainer ruling 2026-08-15 on #8757 (delegated adjudication).

What the widening rests on: `assertControlledByParentWrite` — the object's declared write gate — already runs on the same operation, immediately after the pre-image gate, under a superset of its guard, and it refuses whenever the master is not editable. The floor is handed to that gate, not removed. Callers who could not edit the master are refused exactly as before, with the master gate's own sentence instead of the record-access one.

Why it was wrong before: `controlled_by_parent` means "access derives from the master", and the detail declares nothing about who may write it. Two gates were answering one write, and the stricter — a creator-only rule no author wrote — always won: `SharingService.checkEdit` abstains on the `public`-mapped model before reaching its `modifyAllRecords` branch, so ownership depth, an `edit`-level `sys_record_share` and Modify All Data were all inert on a detail.

Deliberately unchanged, each measured:

- **BULK (AST) writes keep the floor.** `assertControlledByParentWrite` returns early with no single id, so nothing would replace it there. The floor is dropped from the by-id call site, never from the object's posture alone.
- **Delegated (on-behalf-of) by-id writes keep both principals' floors**, matching ADR-0090 D10's existing exclusion at this gate.
- **INSERT and the read path are untouched** — an insert has no pre-image and so never carried the floor; the floor is `update`/`delete`-only.
- **App-authored policies are untouched** (provenance, ADR-0105 D3), Layer 0's tenant wall is untouched, and a detail that authors its own `select` policies still derives its write scope from them (#7665).
