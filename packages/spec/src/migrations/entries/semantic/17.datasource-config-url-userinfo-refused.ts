// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-url-userinfo-refused',
  surface: 'datasource.config.url (postgres / mysql / mongo / turso) and ' +
    'datasource.config.syncUrl (turso) — the URL userinfo password segment ' +
    '(`user:password@host`)',
  replacement: 'the same URL with its userinfo password removed (a bare `user@host` stays ' +
    "legal), plus the datasource secret binder: the Setup → Datasources connection form's " +
    'secret field (encrypted into `sys_secret`, handle stored at `external.credentialsRef`), ' +
    'or a direct `external.credentialsRef` secrets-store reference',
  reason:
    'The #7990 closure refused the inline credential KEYS, and #8078 measured that ' +
    '`config.url` still accepted the identical secret one syntax over — ' +
    '`postgresql://user:password@host/db` landed in `sys_metadata` cleartext exactly as ' +
    '`config.password` did, and the key refusal itself steered authors there (#8082, ' +
    'maintainer-ruled Option A, 2026-08-12). Runtime-environment DSNs (`OS_DATABASE_URL` and ' +
    'friends) never pass through the publish door and are unaffected by construction. There ' +
    'is no mechanical rewrite, for the same reason as the sibling entry ' +
    '`datasource-config-inline-credential-refused`: moving the value requires ENCRYPTING it ' +
    'into a `sys_secret` row through a running secret binder and stripping the cleartext, ' +
    'which a source-file transform cannot do — auto-stripping the userinfo alone would ' +
    'silently drop a live credential instead. Do not substitute a `${…}` placeholder into ' +
    'the URL: placeholders in authored metadata are resolved by nothing and reach the ' +
    'database client verbatim (#8078, measured).',
  acceptanceCriteria:
    'Every datasource parses with a credential-free `config.url` / `config.syncUrl` (no ' +
    'userinfo password segment); each affected datasource carries ' +
    '`external.credentialsRef` (or has its secret bound through the connection form) and ' +
    'still connects; no URL-embedded credential remains in any stored `sys_metadata` row ' +
    'or authored source.',
};
