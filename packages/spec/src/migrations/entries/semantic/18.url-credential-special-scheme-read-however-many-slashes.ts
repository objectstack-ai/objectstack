// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'url-credential-special-scheme-read-however-many-slashes',
  surface: 'the URL credential rule at the two metadata doors that judge one, for a URL with a special scheme ' +
    '(`http`, `https`, `ws`, `wss`, `ftp`, any letter case): connector entries AUTHORED through defineStack ' +
    '`connectors:`, `os validate` / `os compile`, the artifact load and `PUT /meta/connector/:name` — every string ' +
    'under `providerConfig` and `auth` — and a datasource driver config\'s URL keys (`config.url` on postgres, ' +
    'mysql, mongo and turso, and turso `config.syncUrl`) at every door that parses the datasource',
  replacement: 'spell a special-scheme URL with `scheme://` and keep it credential-free as a URL parser reads it: ' +
    'for a connector, name the secret with `auth: { type, credentialRef }` and set its value under that name; for a ' +
    'datasource, bind the secret through the Setup → Datasources connection form\'s secret field (or reference it ' +
    'with `external.credentialsRef`) and keep a bare username in the URL if the driver needs one. Delete the ' +
    'credential from the string.',
  reason:
    'A URL with a special scheme is read for credentials the way a URL parser reads it, however many slashes follow ' +
    'the scheme. For `http`, `https`, `ws`, `wss` and `ftp`, in any letter case, a URL parser starts the authority ' +
    'after the whole run of `/` and `\\` that follows the scheme — none, one, a backslash, three or more — so ' +
    '`https:user:pass@host`, `https:/user:pass@host`, `https:\\user:pass@host` and `https:///user:pass@host` each ' +
    'carry the userinfo `user:pass`. The one userinfo grammar both doors read now starts a special scheme\'s ' +
    'authority there too: a connector string holding such a userinfo, and a datasource URL holding such a userinfo ' +
    'password, are refused, and both read redactors rewrite exactly that position and serve every other character ' +
    'as stored. Every other scheme keeps `scheme://` or a scheme-relative `//`, and `file:` carries no userinfo. ' +
    'There is deliberately no mechanical rewrite: the value in the string may be the only copy of the secret. A row ' +
    'stored before this refusal keeps working: a save of the served form keeps the stored value, and an edit of the ' +
    'served value stores the edit.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema` with no issue located at a ' +
    'string under `providerConfig` or `auth`, and every authored datasource parses through `DatasourceSchema` with ' +
    'no issue at `config.url` or `config.syncUrl`; each secret that sat after a special scheme is set under its ' +
    'reference instead, and the connector still materializes (`GET /api/v1/automation/connectors` reports it ' +
    '`ready`).',
};
