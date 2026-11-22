---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an MCP access token for an app the user consented to, minted in the same second as a password change, after it, is no longer refused

Clause-②: yes (widening)
Metadata-protocol: none

The MCP door refuses an OAuth access token issued before its subject's password last changed. It compared the token's `iat`, which is whole seconds, with the change time in milliseconds, so a token minted after the change but inside the same wall-clock second was refused with `401` too. An agent or script that connected over MCP right after a password change or reset was turned away until the next second.

- The embedded authorization server now signs one more claim into every JWT access token it mints: `iat_ms`, the mint's own instant in milliseconds, written by the server's clock. A client cannot set or change it. It is written at a mint only, never into an opaque token's introspection answer.
- For an app the user granted access to through the consent step, the MCP door compares the change time with `iat_ms` when the token carries one that lies inside the second its `iat` names. A token minted in the second of the change, after it, is admitted; one minted in that second before it is still refused.
- An app admitted without a consent step (a server-only `skip_consent` client) keeps the whole-second refusal: every token minted for it in the second of the change is refused, whatever its `iat_ms`.
- A token without the claim (minted before this release) or with a value that cannot be placed keeps the old whole-second rule, so it is still refused in the second of the change. A token issued before a password change is never admitted.
