// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DatasourceConnectionSpec } from './contracts/index.js';

/**
 * [#31327] The `tedious` connection object for an `mssql` datasource, from the
 * discrete fields `MssqlConfigSchema` declares (there is no URL form: tedious
 * reads no connection-string grammar, and the contract refuses one).
 *
 * - `username` → `user`, the knex `mssql` client's key (it hands tedious
 *   `authentication.options.userName`).
 * - The password comes ONLY from the bound secret (`external.credentialsRef`
 *   or the connection form's secret input) — the contract refuses it inline.
 * - TLS: `ssl` is the datasource-level `ssl` block / `config.ssl` toggle as
 *   the factory's `resolveSslOption` reads it for every SQL driver, passed in
 *   so this module stays a leaf (its test reaches no driver package). `false` →
 *   `encrypt: false`; anything truthy → `encrypt: true`, with
 *   `rejectUnauthorized: false` spelled the way tedious spells it
 *   (`trustServerCertificate: true`) and a CA / client certificate carried in
 *   `cryptoCredentialsDetails`. Undeclared leaves tedious's own default
 *   (encrypt on), which is what Azure SQL requires.
 * - `instanceName` is tedious's named-instance key; with it set the SQL Server
 *   Browser service resolves the port.
 */
export function buildMssqlConnection(spec: DatasourceConnectionSpec, ssl: unknown): Record<string, unknown> {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;
  const options: Record<string, unknown> = {};
  if (cfg.instanceName) options.instanceName = cfg.instanceName;
  if (ssl === false) {
    options.encrypt = false;
  } else if (ssl !== undefined) {
    options.encrypt = true;
    if (ssl && typeof ssl === 'object') {
      const block = ssl as { rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string };
      if (block.rejectUnauthorized === false) options.trustServerCertificate = true;
      const credentials = {
        ...(block.ca ? { ca: block.ca } : {}),
        ...(block.cert ? { cert: block.cert } : {}),
        ...(block.key ? { key: block.key } : {}),
      };
      if (Object.keys(credentials).length > 0) options.cryptoCredentialsDetails = credentials;
    }
  }
  return {
    server: cfg.host,
    ...(typeof cfg.port === 'number' ? { port: cfg.port } : {}),
    database: cfg.database,
    ...(cfg.username ? { user: cfg.username } : {}),
    ...(spec.secret ? { password: spec.secret } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}
