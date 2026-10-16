---
'@objectstack/plugin-sharing': patch
'@objectstack/runtime': patch
---

fix(plugin-sharing, runtime): a share link limited to an email allowlist answers every caller it does not open for with `404 INVALID_OR_EXPIRED`, whatever email and password were sent

Clause-②: no — every request refused before is still refused, and every request served before is still served; only which refusal code a caller reads changes.

A share link can carry a password and the `email` audience together. For such a link, the share-link resolve door answered a caller it did not open for from the password, never the audience: `401 NEEDS_PASSWORD` with no password, and `401 WRONG_PASSWORD` with any password, the correct one included, when the email sent was missing or not on the allowlist. A caller with the right password read "Incorrect password".

- **An `email` link, any caller it does not open for:** `404 INVALID_OR_EXPIRED`, with or without an email, with no password, a wrong one or the correct one, signed in or not. It is the answer a password-less `email` link already gave and an unknown token gives, so it tells the caller neither whether the email is on the allowlist, nor whether the password is right, nor whether the link has a password. The door does not read the email to choose its answer.
- **Served, unchanged:** an allowlisted email with the correct password (or, on a link without a password, an allowlisted email alone) still opens the record. An API or SDK caller sends both together; the door no longer prompts for the password first.
- **Unchanged:** links with any other audience, including the `signed_in` order (`401 SIGN_IN_REQUIRED` before sign-in, the password arms after), a `public` link's `NEEDS_PASSWORD` / `WRONG_PASSWORD`, and the expired-or-revoked `410 EXPIRED_OR_REVOKED`.
- Both mounts of the resolve door answer alike: plugin-sharing's share-link routes and the runtime dispatcher's share-links domain.
