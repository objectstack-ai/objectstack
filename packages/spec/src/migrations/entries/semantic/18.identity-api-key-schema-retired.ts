// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'identity-api-key-schema-retired',
  surface:
    'identity.apiKey (the whole of `ApiKeySchema` in identity/identity.zod.ts — '
    + '1 def, 3 exported names: `ApiKeySchema`, `ApiKey`, `ApiKeyParsed`)',
  replacement:
    '(removed — there is no replacement schema, because the deleted one never '
    + 'described the real table. The single declaration of `sys_api_key` is the '
    + 'ObjectSchema in `@objectstack/platform-objects` '
    + '(`identity/sys-api-key.object.ts`): columns `name, prefix, user_id, '
    + 'active_organization_id, scopes, expires_at, last_used_at, revoked, key, '
    + 'id, created_at, updated_at`, snake_case, `revoked` as the kill switch — '
    + 'not `enabled`. Rows are minted by `POST /api/v1/keys` '
    + '(`runtime/src/domains/keys.ts`) and verified by '
    + '`core/src/security/api-key.ts`, keyed by the `osk_` prefix. Per-key rate '
    + 'limiting returns only via the ENFORCE route of ADR-0049 through a new '
    + 'ADR — the executor first, the vocabulary second)',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-15 on #8715 '
    + '(disposition B: delete). `ApiKeySchema` documented better-auth\'s `apiKey` '
    + 'PLUGIN schema — a plugin this platform does not load '
    + '(`plugin-auth/src/managed-extension-fields.ts` states the table is '
    + 'hand-rolled ObjectStack): `start` and `lastRefetchAt` name columns that do '
    + 'not exist; `enabled` inverts the real `revoked` column\'s polarity; '
    + '`rateLimitEnabled` / `rateLimitTimeWindow` / `rateLimitMax` / `remaining` '
    + 'advertise a per-key rate-limit capability nothing implements (the sharpest '
    + 'PD #10 instance — a reader can reasonably conclude API keys support rate '
    + 'limiting); `permissions` and `metadata` have no columns; `organizationId` '
    + 'is camelCase fiction next to the real snake_case '
    + '`active_organization_id`. Zero consumers measured (08-14, re-verified at '
    + 'the retirement\'s base commit): only its own unit test, the export '
    + 'snapshots, the generated reference page and a prose mention in '
    + '`cloud/developer-portal.zod.ts` (corrected in the same PR — the '
    + 'marketplace-key plan it gestured at is ruled NOT live). One table had two '
    + 'declarations and the published one was fiction; the generated reference '
    + 'page rendered it faithfully, which is how the defect surfaced as a docs '
    + 'card. With no carrier key and no authored document there is nothing to '
    + 'tombstone and no seam for a D2 conversion: route 3, the #4834 / #4988 / '
    + '#5055 / #6486 / #8075 shape — RETIRED_DEFS_BY_MAJOR plus this entry ARE '
    + 'the declaration.',
  acceptanceCriteria:
    'No code imports `ApiKeySchema`, `ApiKey` or `ApiKeyParsed` from '
    + '`@objectstack/spec` or `@objectstack/spec/identity` — every one is TS2305 '
    + 'after upgrade, on every public entry (pinned by resolved symbol identity '
    + 'in `identity/api-key-retirement.test.ts`). No metadata document needs '
    + 'editing: the schema was reachable from no metadata-type binding, stack '
    + 'collection or /meta door, so no document could ever carry it. '
    + '`UserSchema` / `AccountSchema` / `VerificationTokenSchema` and the '
    + 'organization module survive unchanged (the ruling accepts the sibling '
    + 'asymmetry deliberately), and the `sys_api_key` ObjectSchema in '
    + '`@objectstack/platform-objects` still declares the real column set '
    + '(pinned in `sys-api-key-single-declaration.test.ts`). '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED: nothing ever '
    + 'read the schema, so removing it removes no behaviour — mint and verify '
    + 'work byte-identically before and after.',
};
