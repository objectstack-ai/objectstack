---
'@object-ui/console': patch
---

feat(console): the Access policy page shows the address the server judges beside Allowed IP ranges

Clause-②: no
Metadata-protocol: none

An organization's `access_policy.allowed_ip_ranges` save is refused when the list leaves out the saving request's own address, and until now **Setup → Access policy** told the organization administrator that address only in the refusal. The page now reads `GET /api/v1/auth/client-address` (the organization administrator's read, answered to a caller holding `setup.write` in their current organization) and draws the note the Authentication page already draws under its own Allowed IP ranges: the address, and whether it came from a trusted proxy's forwarded headers or, with `trustProxy` off, from the connection itself (behind a proxy, the proxy's address); when the server cannot establish an address, that a non-empty list cannot be saved from here. The Authentication page keeps reading the platform administrator's route. A caller the route refuses, a server without the route, or any other failed read draws no note and no toast, and the page is otherwise unchanged. No translation key is added: the three existing note sentences are reused.
