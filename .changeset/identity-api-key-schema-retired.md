---
"@objectstack/spec": minor
---

feat(spec): retire `ApiKeySchema` — the identity module no longer publishes a second, fictional declaration of `sys_api_key` (#8715, ADR-0049)

**BREAKING** public-surface removal, landing after the v17.0.0 cut (the
lockstep launch-window convention ships it as `minor`; the migration
prescription is registered under protocol major 18, where `os migrate meta`
users will look — the #8586 precedent).

`ApiKeySchema` (and its `ApiKey` / `ApiKeyParsed` types) documented
better-auth's `apiKey` **plugin** schema — a plugin this platform does not
load: `start` and `lastRefetchAt` name columns that do not exist; `enabled`
inverts the real `revoked` column's polarity; `rateLimitEnabled` /
`rateLimitTimeWindow` / `rateLimitMax` / `remaining` advertise a per-key
rate-limit capability nothing implements; `permissions` and `metadata` have no
columns; `organizationId` is camelCase fiction next to the real snake_case
`active_organization_id`. Zero consumers anywhere in the monorepo outside its
own unit test — one table had two declarations, and the published one was
fiction (maintainer-ruled DELETE, 2026-08-15).

**What breaks:** `import { ApiKeySchema, ApiKey, ApiKeyParsed }` from
`@objectstack/spec` or `@objectstack/spec/identity` is TS2305 after upgrade.
The generated reference page's `ApiKey` section and the 19
`identity/ApiKey:*` authorable-surface keys disappear with the schema.

**What stays:** everything real. The single declaration of `sys_api_key` is
the ObjectSchema in `@objectstack/platform-objects`
(`identity/sys-api-key.object.ts`) — columns `name, prefix, user_id,
active_organization_id, scopes, expires_at, last_used_at, revoked, key, id,
created_at, updated_at`; rows are minted by `POST /api/v1/keys` and verified
by `core/src/security/api-key.ts`, keyed by the `osk_` prefix. Neither ever
read the deleted schema, so runtime behaviour is byte-identical.
`UserSchema` / `AccountSchema` / `VerificationTokenSchema` and the
organization module survive unchanged.

The retirement kit:

- schema deleted in place, with the in-module explanatory block naming the
  live declaration (`packages/spec/src/identity/identity.zod.ts`)
- ADR-0087 registration: retired-def entry `identity/ApiKey` + D3 semantic
  entry `identity-api-key-schema-retired`, both under protocol 18 (route 3 —
  no carrier key and no authored document, so no tombstone and no D2
  conversion; the registry entries ARE the declaration)
- pin tests: `identity/api-key-retirement.test.ts` (zero holders on every
  public entry, survivors stand) and platform-objects'
  `sys-api-key-single-declaration.test.ts` (the real column set, spec's
  runtime namespace lost the name)
- generated baselines regenerated: authorable surface (−19 keys), JSON-schema
  manifest (−1 def), api-surface / export-origins (−3 names), reference docs
- `cloud/developer-portal.zod.ts` prose corrected: marketplace API keys point
  at the `sys_api_key` object and `POST /api/v1/keys`, not at
  `Identity.ApiKeySchema` (the marketplace-key plan is ruled not live)

## FROM → TO

```ts
// before — type-checked green against a schema no runtime ever read
import { ApiKeySchema, type ApiKey } from '@objectstack/spec/identity';
const key: ApiKey = { id, name, userId, enabled: true, rateLimitMax: 100, /* … */ };

// after — read the real table: the sys_api_key ObjectSchema in
// @objectstack/platform-objects (snake_case, `revoked` not `enabled`);
// mint via POST /api/v1/keys, verify via core/src/security/api-key.ts.
import { SysApiKey } from '@objectstack/platform-objects';
```
