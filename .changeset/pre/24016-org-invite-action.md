---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

`sys_organization` now declares an `invite_user` action at `record_header`, so an organization record page can offer "Invite User" as its primary header button. It calls `/api/v1/auth/organization/invite-member` with the record's id as `organizationId`, asks for `email` and `role` (the role picker offers only the roles the caller may grant), and is gated like the other three invite mirrors: the `organization` capability and the owner / admin / delegated_admin grades. Its `order: -1` puts it first in the header.

`leave_organization` keeps `variant: 'danger'` and now declares `order: 1`, so it sorts last among the header actions and folds into the `⋯` overflow menu instead of taking the third inline slot. Its confirmation now names what is lost: the organization's environments and members (en, zh-CN, ja-JP and es-ES).

`@objectstack/spec` books the new action in `PUBLIC_AUTH_FEATURES.organization.gatedInputs`, beside the other three invite mirrors.

Clause-②: no
