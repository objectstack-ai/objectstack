// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-url-query-credential-refused',
  surface: 'datasource.config.url / datasource.config.syncUrl (turso) and ' +
    'datasource.config.url (postgres) — credential-bearing URL query parameters ' +
    '(`?authToken=` on turso, `?password=` on postgres)',
  replacement: 'the same URL with the credential query parameter removed (non-credential ' +
    'parameters such as `?tls=` / `?sslmode=` stay legal), plus the datasource secret binder: ' +
    "the Setup → Datasources connection form's secret field (encrypted into `sys_secret`, " +
    'handle stored at `external.credentialsRef`), or a direct `external.credentialsRef` ' +
    'secrets-store reference',
  reason:
    'The #7990 closure refused the inline credential KEYS and #8082 refused the URL userinfo ' +
    'spelling; the query string was the third spelling of the identical secret, one syntax ' +
    'over (#8337). `libsql://x.turso.io?authToken=eyJ…` landed in `sys_metadata` cleartext ' +
    'exactly as `config.authToken` did — and at connect `@libsql/core` assigns the URL token ' +
    'OVER the binder-injected one (measured), so the workaround also silently defeated the ' +
    'bound secret; `pg-connection-string` likewise honours `?password=` over userinfo ' +
    '(measured). Only parameters a measured client actually reads are refused: mysql and ' +
    'mongo ignore `?password=` (measured), so their URLs are unaffected. ' +
    'Runtime-environment DSNs (`OS_DATABASE_URL`, `OS_DATABASE_AUTH_TOKEN` and friends) ' +
    'never pass through the publish door and are unaffected by construction. There is no ' +
    'mechanical rewrite, for the same reason as the sibling entries ' +
    '`datasource-config-inline-credential-refused` and ' +
    '`datasource-config-url-userinfo-refused`: moving the value requires ENCRYPTING it into ' +
    'a `sys_secret` row through a running secret binder and stripping the cleartext, which a ' +
    'source-file transform cannot do — auto-stripping the parameter alone would silently ' +
    'drop a live credential instead. Do not substitute a `${…}` placeholder into the URL: ' +
    'placeholders in authored metadata are resolved by nothing and reach the database client ' +
    'verbatim (#8078, measured).',
  acceptanceCriteria:
    'Every datasource parses with no credential-bearing query parameter in `config.url` / ' +
    '`config.syncUrl` (no `?authToken=` on turso, no `?password=` on postgres); each ' +
    'affected datasource carries `external.credentialsRef` (or has its secret bound through ' +
    'the connection form) and still connects; no URL-embedded credential remains in any ' +
    'stored `sys_metadata` row or authored source.',
};
