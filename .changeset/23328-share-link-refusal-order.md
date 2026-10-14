---
'@objectstack/plugin-sharing': patch
'@objectstack/runtime': patch
---

fix(plugin-sharing, runtime): a share link that has a password and is limited to signed-in users answers an anonymous visitor `401 SIGN_IN_REQUIRED`, whatever password was sent

Clause-②: no — every request refused before is still refused; only which refusal code an anonymous caller reads changes.

A share link can carry a password and the `signed_in` audience together. For such a link, the share-link resolve door answered an anonymous visitor from the password before the audience: `NEEDS_PASSWORD` with no password, and `WRONG_PASSWORD` with any password, the correct one included. The console's shared-record page then told a visitor who typed the right password "Wrong password.", and never offered sign-in.

- **Anonymous caller, `signed_in` link:** `401 SIGN_IN_REQUIRED` with no password, a wrong one or the correct one. The answer is the same for all three, so it never tells an anonymous caller whether a password is right. Once signed in, the visitor is asked for the password as before.
- **Signed-in caller:** unchanged. `401 NEEDS_PASSWORD` with no password, `401 WRONG_PASSWORD` with a wrong one, and the record with the correct one.
- **Unchanged:** links with any other audience (a `public` link with a password still answers `NEEDS_PASSWORD` / `WRONG_PASSWORD` to an anonymous caller), the expired-or-revoked `410 EXPIRED_OR_REVOKED`, the `404 INVALID_OR_EXPIRED` for an unknown token or an object with public sharing switched off, and every link that resolves.
- Both mounts of the resolve door answer alike: plugin-sharing's share-link routes and the runtime dispatcher's share-links domain.
