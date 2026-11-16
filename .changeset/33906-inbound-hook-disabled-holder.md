---
'@objectstack/service-automation': patch
---

fix(service-automation)!: the inbound hook door refuses the address of a flow slot whose package is disabled, before anything is enqueued (ADR-0150 D5)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is the anonymous inbound hook's answer to a post under a reversible package state: no stored row, slot key, run key, trigger binding, hook secret or dispatch key changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a sender that posts to the inbound hook of a flow whose package is disabled while the automation engine still holds that flow's slot (the re-sync that follows a disable failed or did not run, or the disable came with no announce). The door answered `202 Accepted` and queued the post, and the queued run was then skipped, so the event was lost while the sender was told it was accepted. It now answers the door's one refusal, `401 INVALID_SIGNATURE`.

What moves, while the package is disabled:

- `POST /api/v1/automation/hooks/NAMESPACE/NAME/HOOK` for a name two packages each ship, where NAMESPACE names the disabled package: the self-hosted mount and the hosted face both answer the one refusal, once the body has been read in full. Nothing is enqueued, and the other package's flow of the name is not reached in its place.
- For a name only the disabled package ships, both its qualified address and the bare `POST /api/v1/automation/hooks/NAME/HOOK` answer the same refusal.

The answer is byte for byte the one the same address gets once the disable's re-sync has withdrawn the slot, and the one every unverified post gets, so it says nothing about which packages are installed or disabled. The cause is written to the server log only, at `info`, once per refused post (`cause: 'disabled-holder'`, with the flow, the package and the slot).

Senders that retry on a non-2xx keep the event and can redeliver after a re-enable. When the package is enabled again the address answers `202` and runs the flow again, with no re-arm.

The served package's qualified hook beside a disabled one, a flow no package ships, and a flow switched off with its slot toggle answer as before. The bare hook of a name two packages ship answers the one refusal as before.
