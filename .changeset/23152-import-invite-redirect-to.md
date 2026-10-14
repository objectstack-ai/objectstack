---
'@objectstack/plugin-auth': minor
---

The identity import's automatic invitation email links to the Console's set-password page, no longer to an `INVALID_TOKEN` error

Clause-②: yes (widening)

- **Before.** For every row an admin imported under the Automatic (or Invite) password policy with email delivery, `POST /api/v1/auth/admin/import-users` requested the password reset with no `redirectTo`. better-auth then emailed a link ending in an empty `callbackURL=`, and its `GET /reset-password/:token` refused that link with a redirect to `?error=INVALID_TOKEN`, which the Console shows on its sign-in page. The token in the link was still valid, but the invited user had no page to use it on.
- **Now.** The reset request carries `redirectTo` set to the Console's set-password page (`${origin}${uiBasePath}/reset-password`, by default `/_console/reset-password`), the page the Console's own forgot-password flow lands on. The emailed link opens `/_console/reset-password?token=…`, and better-auth's origin check accepts it because it is the deployment's own origin.
- **The two new members.** Both are additions; nothing existing changes shape.
  - `AuthManager.getConsoleUrl(path)` is a public reader of the absolute URL of a Console page. It returns what the class already composes for every email and SMS link it sends.
  - `IdentityImportDeps.consoleResetPasswordUrl?()` is optional. `AuthPlugin` wires it to `getConsoleUrl('/reset-password')`. A host that calls `runAdminImportUsers` itself should pass it to get a working invitation link. A caller that omits it sends the request exactly as before (`{ email }`), so the link keeps the empty `callbackURL`.
- **Unchanged.** The SMS invitation, the temporary-password policy, and the email copy (the invitation still uses the password-reset template).
