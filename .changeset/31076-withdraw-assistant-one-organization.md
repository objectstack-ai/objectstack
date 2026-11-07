---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): withdrawing an AI assistant in one organization no longer signs it out of the person's other organizations

Clause-②: no
Metadata-protocol: none

A person can authorize the same AI assistant (an OAuth client such as Claude Desktop) in two organizations. Withdrawing it in one of them, from the console (`POST /api/v1/auth/authorized-clients/withdraw` or the admin door) or with `POST /oauth2/revoke`, deleted only that organization's consent but every refresh token the assistant held for that person, in every organization. The assistant then stopped working in the other organization once its access token expired, and the person had to authorize it there again. A withdraw now deletes the refresh tokens minted in the withdrawn organization only: every one of them, rotated or live, and the access tokens minted from them. The other organization's refresh token keeps refreshing. A refresh token minted with no active organization belongs to the grant with no organization and is deleted when that grant is withdrawn. `/oauth2/revoke` answers exactly as before.
