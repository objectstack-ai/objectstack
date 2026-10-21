---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the user page's Security tab shows only on the viewer's own record

Clause-②: no (platform metadata only: the Security tab's self-service sections are shown on the viewer's own record only; no action, param, response, spec key or export moves)

The `sys_user` record page's Security tab holds only self-service controls: change password and email, two-factor authentication, email verification and account deletion. Every one of those actions is already gated to the viewer's own record. On another user's record the actions were withheld, but the tab still showed its four "your account" headings and captions with nothing under them, addressed to an administrator about an account that is not theirs.

The tab item now carries the own-record gate `has(record.id) && record.id == ctx.user.id` as an item-level `visibleWhen` in the CEL envelope (the same guard the page's unverified-email alert carries). On your own record the tab is unchanged. On anyone else's record the tab header and its panel are both omitted. The actions, their own gates and the other tabs are unchanged.
