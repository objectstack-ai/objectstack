---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(auth,app-shell,i18n,console): an invitation link opened signed out names the inviter and the organization on the sign-in and sign-up pages

Clause-②: no
Metadata-protocol: none

A visitor who opened an invitation link while signed out landed on 「接受邀请 · 请使用收到邀请的邮箱。」 and then 「注册账号并加入」, and neither page said who had invited them or to which organization. The server has answered that question anonymously since `GET /api/v1/auth/organization/invitation-preview?id=ID`, but no page read it.

- **`@object-ui/auth`:** `getInvitationPreview(invitationId)` on the auth client, `AuthProvider` and `useAuth()`, with the `AuthInvitationPreview` type (`organizationName`, `inviterName`, `email`). It needs no session. It resolves the preview, resolves `null` for the server's not-found answer, and rejects with the server's `code` and the HTTP `status` on any other failure.
- **`@object-ui/app-shell`:** `useInvitationPreview(redirect)` and `invitationArrivalCopy(page, preview, t)`. `DefaultLoginPage` and `DefaultRegisterPage` use them for a visitor arriving from `/accept-invitation/ID`, and the card reads 「林晓 邀请你加入 晓林装饰工作室」. The masked invited address (`z***@example.com`) is shown as the address to use. It never fills the email field, because a masked value is not an address. An unknown or expired invitation, a failed read, or a server without the route keeps the generic copy.
- **`@object-ui/console`:** the console's own `/login` and `/register` do the same.
- **`@object-ui/i18n`:** `auth.login.invitationPreviewTitle`, `auth.login.invitationPreviewTitleNoInviter`, `auth.login.invitationPreviewDescription` and `auth.register.invitationPreviewDescription`, in all ten locale packs.

What to do: nothing. A host that mocks `useAuth()` without `getInvitationPreview` keeps the generic invitation copy.
