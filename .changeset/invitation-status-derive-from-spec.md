---
'@objectstack/client': patch
---

fix(client): `organizations.invitations.list()` / `listMine()` type `status` from the spec's `InvitationStatus` enum instead of a hand-copied literal (#7781).

`list()`'s row `status` was hand-written as `'pending' | 'accepted' | 'rejected' | 'canceled'` —
missing `expired`, ObjectStack's own terminal state driven by `expiresAt`. `listMine()` typed the
same field as a bare `string`. Both are now `InvitationStatus`, imported from
`@objectstack/spec/identity` — the same union `sys_invitation.status` binds its select options to
(#7726) — so a value added to the spec enum reaches the SDK by construction instead of silently
diverging again.

Types-only, no wire change: the value already arrived off the wire regardless of what the
annotation said, so nothing about what `list()` / `listMine()` return at runtime moves. What
changes is that TypeScript narrowing (a `switch` over `status`, for example) now sees all five
values, including `expired`.
