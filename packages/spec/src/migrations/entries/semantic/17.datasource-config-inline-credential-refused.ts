// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-inline-credential-refused',
  surface: 'datasource.config.password (postgres / mysql / mongo) and ' +
    'datasource.config.authToken (turso)',
  replacement: "the datasource secret binder: the Setup → Datasources connection form's " +
    'secret field (encrypted into `sys_secret`, handle stored at `external.credentialsRef`), ' +
    'or a direct `external.credentialsRef` secrets-store reference',
  reason:
    'A datasource artefact is persisted whole into `sys_metadata`, which is served back by ' +
    'the ordinary data API — an inline credential is cleartext at rest (#7990, maintainer-' +
    'ruled per-artefact contract closure, 2026-08-12). There is no mechanical rewrite: ' +
    'moving the value requires ENCRYPTING it into a `sys_secret` row through a running ' +
    "secret binder and deleting the cleartext, which a source-file transform cannot do — " +
    'auto-deleting the key alone would silently drop a live credential instead.',
  acceptanceCriteria:
    'Every datasource parses with no `config.password` / `config.authToken` key; each ' +
    'affected datasource carries `external.credentialsRef` (or has its secret bound through ' +
    'the connection form) and still connects; no cleartext credential remains in any ' +
    'stored `sys_metadata` row or authored source.',
};
