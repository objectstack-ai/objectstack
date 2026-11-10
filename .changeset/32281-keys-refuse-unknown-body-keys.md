---
'@objectstack/runtime': patch
---

fix(runtime)!: `POST /api/v1/keys` refuses a body key it does not read, instead of dropping it and minting a key anyway

Clause-②: yes (narrowing) — a mint request whose body carries any key other than `name` and `expires_at`, or whose body is not an object, used to be answered 201 with a key minted for the caller; it is now answered `400 VALIDATION_FAILED` and nothing is minted.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, schema, export or type changes. The door narrows what it accepts at the HTTP boundary: the remedy is to stop sending the keys it never read, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `POST /api/v1/keys` (`@objectstack/runtime`, `domains/keys.ts`).

The body is `{ name?, expires_at? }`. Any other key — `user_id`, `userId`, `scopes`, `key`, `id`, `revoked`, `prefix`, an organization (`organization_id`, `active_organization_id`, `organizationId`) or a misspelling — is refused with `400 VALIDATION_FAILED` and one `error.details.fields[]` entry per key (`code: 'unknown_field'`), before any service is resolved or any row is read or written. A body that is an array or a primitive is refused the same way, naming `(body)`. An empty or absent body still mints a key named "API Key".

None of those keys was ever honoured: a key is always minted for the signed-in caller, in the caller's active organization, acting with the caller's access. Before this change the door dropped them silently and answered 201, so a client that asked for a key for another user, or with scopes, was told it had succeeded. After the upgrade, send only `name` and, optionally, `expires_at`. The first-party callers (the SDK's `client.keys.create`, the console's key-minting pages and the `sys_api_key` Create Key action) already send only those two keys and are unchanged.
