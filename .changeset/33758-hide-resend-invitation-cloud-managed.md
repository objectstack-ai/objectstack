---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

Clause-②: no
Metadata-protocol: none

Setup → Invitations no longer offers **Resend Invitation** on a cloud-managed environment. A resend is a call to invite-member, which a cloud-managed environment refuses with `409 RESOURCE_CONFLICT`, so the action now carries the same `features.cloudManaged != true` gate as the four Invite User mirrors and Copy Invite Link, and is booked in `PUBLIC_AUTH_FEATURES.cloudManaged.gatedInputs`. Off a managed environment it is offered exactly as before.
