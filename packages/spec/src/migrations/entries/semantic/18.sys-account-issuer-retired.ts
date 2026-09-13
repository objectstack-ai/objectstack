// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sys-account-issuer-retired',
  surface: '`sys_account.issuer` — the column, its `{ fields: [\'issuer\', \'account_id\'], unique: '
    + 'true }` index, its label in the four generated translation bundles, and the '
    + '`@objectstack/plugin-auth` symbols that existed only to serve it '
    + '(`backfillAccountIssuer`, `CREDENTIAL_ISSUER`, `oauthIssuerFor`, `ResolvedSocialProvider`, '
    + '`BackfillAccountIssuerOptions`, `BackfillAccountIssuerResult`). The '
    + '`accounts.list()` client type loses `issuer` with the route that stopped returning it.',
  replacement: 'nothing — account identity is `(provider_id, account_id)`, which `sys_account` has '
    + 'declared UNIQUE since the object was created. A caller that read `account.issuer` reads '
    + 'nothing in its place: the authority is `sys_sso_provider.issuer`, resolved through the '
    + 'account\'s `provider_id`, which is unique per environment. A host that called '
    + '`backfillAccountIssuer` on its own schedule deletes the call; there is no successor pass. '
    + 'Existing deployments run the ceremony below before the column is dropped.',
  reason:
    'better-auth 1.7.3 removed the issuer-scoped account identity outright '
    + '(better-auth/better-auth#10909): `createLocalAccountIssuer` is deleted, `accountSchema.issuer` '
    + 'is gone, `AccountKey` is `(providerId, accountId)` again, and the `account.issuer` column '
    + 'and its unique index are gone from `get-tables`. There is no drop-in replacement. '
    + 'Maintainer ruling 2026-09-10 on #16629: adopt the rollback rather than own a fork of an '
    + 'identity model the vendor abandoned — a permanent fork on the authentication library was '
    + 'refused, and staying pinned was refused as the durable answer (#16186 was the stopgap and '
    + 'has done its job). The column was a net liability in its own right: a credential row whose '
    + '`issuer` was not the local credential issuer was invisible to `findAccountByKey`, so '
    + 'sign-in failed `INVALID_EMAIL_OR_PASSWORD` behind a "User not found" warn pointing at the '
    + '`sys_user` row rather than at the account — four checklist items rediscovered that '
    + 'independently. Its discriminating power here was near zero: `sys_sso_provider` declares '
    + '`{ fields: [\'provider_id\'], unique: true }`, so `provider_id → issuer` is a function '
    + 'within an environment.',
  acceptanceCriteria:
    'BEFORE the column is dropped, `os migrate account-issuer` reads zero on the deployment: no '
    + '`(provider_id, account_id)` key is held by more than one row. That pre-flight reads ROWS, '
    + 'never the index declaration, because `syncDeclaredIndexes` logs a plain UNIQUE whose CREATE '
    + 'failed on existing duplicates and lets the boot continue (#14902 / #15479) — so a database '
    + 'can carry the declaration without the constraint, and on such a database the drop degrades '
    + 'SILENTLY rather than failing. A dirty read refuses; so does a read that throws or a scan '
    + 'that truncates. `os migrate apply --allow-destructive` re-runs the same pre-flight and '
    + 'refuses the drop before writing any DDL; the boot refusal on unapplied destructive drift is '
    + 'unchanged, so a runtime never auto-migrates. Colliding rows are resolved by the operator — '
    + 'keep the row whose provider account is live, delete the rest so a fresh sign-in re-links — '
    + 'never merged or dropped by the platform. AFTER the drop, a fresh install and an '
    + 'existing-data upgrade both sign in over the real auth route. A `provider_id` re-pointed at a '
    + 'different IdP must have its account bindings REBUILT: no column records which IdP vouched '
    + 'for a row, so the key cannot separate the old IdP\'s subjects from the new one\'s, and the '
    + '`sys_sso_provider` update door refuses an issuer change while accounts are still bound to '
    + 'that provider.',
};
