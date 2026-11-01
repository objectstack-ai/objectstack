---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth, platform-objects): resending an expired invitation replaces it, leaving one pending invitation for the person

Clause-②: no
Metadata-protocol: none

- **`@objectstack/plugin-auth`**: when `POST /organization/invite-member` issues an invitation, the person's other pending invitations in that organization whose expiry has passed are now marked `expired`. A resend on an invitation that has already expired issues a new invitation, as before, and the expired one now moves to the Expired / Canceled list instead of staying in Pending beside the new one. A plain invite to an address whose earlier invitation expired does the same. A resend on an invitation that has not expired still renews that invitation (same id). A refused call changes nothing.
- **`@objectstack/platform-objects`**: the Resend Invitation confirmation on `sys_invitation` now reads "Resend the invitation to {{ record.email }}? The expiry date starts over, and an invitation that has already expired is replaced by a new one.", which is true for both rows the action is offered on. The zh-CN, ja-JP and es-ES translations say the same.
