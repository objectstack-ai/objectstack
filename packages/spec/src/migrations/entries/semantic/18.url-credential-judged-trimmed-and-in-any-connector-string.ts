// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'url-credential-judged-trimmed-and-in-any-connector-string',
  surface: 'the URL credential rule at the two metadata doors that judge one: connector entries AUTHORED through ' +
    'defineStack `connectors:`, `os validate` / `os compile`, the artifact load and `PUT /meta/connector/:name` — ' +
    'every string under `providerConfig` and `auth` — and a datasource driver config\'s URL keys (`config.url` on ' +
    'postgres, mysql, mongo and turso, and turso `config.syncUrl`) at every door that parses the datasource',
  replacement: 'keep every authored URL credential-free as a URL parser reads it, and keep a credential query ' +
    'parameter out of every connector string, URL or not: for a connector, name the secret with `auth: { type, ' +
    'credentialRef }` and set its value under that name; for a datasource, bind the secret through the Setup → ' +
    'Datasources connection form\'s secret field (or reference it with `external.credentialsRef`) and keep a bare ' +
    'username in the URL if the driver needs one. Delete the credential from the string.',
  reason:
    'A URL is judged after trimming surrounding whitespace and removing tab and newline characters, as a URL parser ' +
    'does; a credential query parameter is refused in any string of the entry. A URL parser trims the leading and ' +
    'trailing C0 control characters and spaces of a string and removes every tab, newline and carriage return in it ' +
    'before it reads it, so both halves of the rule now read the value as the parser does, at both doors: a ' +
    'connector URL holding a userinfo, and a datasource URL holding a userinfo password, are refused as the parser ' +
    'reads them (a bare username in a datasource URL stays accepted), and each query pair is cleaned the same way ' +
    'before its name is read. One userinfo grammar serves both doors: an authority starts at `scheme://` or at a ' +
    'scheme-relative `//`. And the connector entry\'s credential query parameter rule is one value-level parse — the ' +
    'one the datasource doors already run — applied to every string under `providerConfig` and `auth`, whether or ' +
    'not it starts with a scheme. Both read ' +
    'redactors rewrite exactly what the write refuses, at the position the write judged, and serve every other ' +
    'character as stored. There is deliberately no mechanical rewrite: the value in the string may be the only copy ' +
    'of the secret. A row stored before this refusal keeps working: a save of the served form keeps the stored ' +
    'value, and an edit of the served value stores the edit.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema` with no issue located at a ' +
    'string under `providerConfig` or `auth`, and every authored datasource parses through `DatasourceSchema` with ' +
    'no issue at `config.url` or `config.syncUrl`; each secret that sat in such a string is set under its reference ' +
    'instead, and the connector still materializes (`GET /api/v1/automation/connectors` reports it `ready`).',
};
