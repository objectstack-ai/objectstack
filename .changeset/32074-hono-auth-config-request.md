---
'@objectstack/hono': patch
---

The `/auth/config` arm hands the incoming request to the auth service's `getPublicConfig()`, as plugin-auth's own `/config` route does, so a host's organization-create choices (`features.organizationEditions`) come back in the language the request asked for.

Clause-②: no
Metadata-protocol: none
