// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-mongo-options-credential-refused',
  surface: 'datasource.config.options.auth.password (mongodb) — a login credential written ' +
    'into the MongoClient options passthrough',
  replacement: 'remove the `auth` block from `options` (its other keys — `replicaSet`, `tls`, ' +
    'timeouts — stay legal) and bind the secret: the Setup → Datasources connection form\'s ' +
    'secret field (encrypted into `sys_secret`, handle stored at `external.credentialsRef`), ' +
    'or a direct `external.credentialsRef` secrets-store reference, with the username kept in ' +
    'the URL (`mongodb://user@host/db`)',
  reason:
    'The FOURTH spelling of the same inline secret: #7990 refused the top-level `password` ' +
    'key, #8082 the URL userinfo, #8337 credential query parameters — and the `options` ' +
    'passthrough stayed open one syntax over. `options: { auth: { username, password } }` ' +
    'parsed green, persisted the password cleartext into `sys_metadata` (served back by the ' +
    'ordinary data API), and genuinely authenticated: mongodb@7.5.0 transforms the block ' +
    'into `MongoCredentials` (measured), so the workaround was live, not inert. A non-empty ' +
    'string `auth.password` is now refused at publish with the binder prescription; ' +
    '`auth.username` alone stays writable (#8876\'s asymmetry — a username is not credential ' +
    'material), as do all non-credential passthrough options. The bound secret wins over a ' +
    'passthrough `auth` block at connect (#8696, measured), so the replacement changes which ' +
    'store holds the secret, never which credential connects. There is no mechanical ' +
    'rewrite, for the same reason as the sibling entries ' +
    '`datasource-config-inline-credential-refused`, `datasource-config-url-userinfo-refused` ' +
    'and `datasource-config-url-query-credential-refused`: moving the value requires ' +
    'ENCRYPTING it into a `sys_secret` row through a running secret binder, which a ' +
    'source-file transform cannot do — and auto-dropping only the nested password would ' +
    'leave an `auth` block the client refuses at construction (measured: `credentials must ' +
    'be an object with \'username\' and \'password\' properties`). Runtime-environment DSNs ' +
    '(`OS_DATABASE_URL` and friends) never pass through the publish door and are unaffected ' +
    'by construction. The read path now also redacts the stored passthrough secrets ' +
    '(`options.auth.password`, `options.proxyPassword`, TLS key material, ' +
    '`AWS_SESSION_TOKEN`) instead of serving them back in cleartext.',
  acceptanceCriteria:
    'Every mongodb datasource parses with no `auth.password` inside `config.options`; each ' +
    'affected datasource carries `external.credentialsRef` (or has its secret bound through ' +
    'the connection form) with the username in its URL, and still connects; no passthrough ' +
    'credential remains in any stored `sys_metadata` row or authored source.',
};
