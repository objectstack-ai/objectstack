// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'connector-entry-undeclared-key-refused',
  surface: 'connector entries AUTHORED through `defineConnector()`, defineStack `connectors:`, `os validate` / ' +
    '`os compile`, the artifact load and `PUT /meta/connector/:name` — a top-level key the entry does not declare',
  replacement: 'keep only the keys `DeclarativeConnectorEntrySchema` declares. A provider setting moves under ' +
    '`providerConfig` (`baseUrl` for `rest`, `spec` / `baseUrl` for `openapi`, `transport` for `mcp`); a ' +
    'credential goes into the secrets layer under the name `auth.credentialRef` gives (an environment variable ' +
    'in the open tier, or Setup → Connector credentials) and the key is deleted; free-form notes go in ' +
    '`description` or `metadata`.',
  reason:
    'The authored entry was a plain object, so an undeclared top-level key parsed green at every door and ' +
    'meant nothing to the runtime: no provider, the automation service or the dispatcher ever read one. It is ' +
    'refused now, by name and located at the key, with a prescription for the two families an author most ' +
    'often misplaces: a credential and a provider setting. There is deliberately no mechanical rewrite: an ' +
    'undeclared key may be a misplaced provider setting whose right home depends on the provider, or a secret ' +
    'whose only copy is the value written there, and where either goes next is a judgement about the ' +
    'connector, not a rename. `defineConnector()` refuses the key too: it parsed the open runtime shape, which ' +
    'dropped the key before any closed door saw it. The runtime connector shape (`ConnectorSchema`, the def a ' +
    'plugin hands to `registerConnector`) is unchanged. The metadata read also now withholds the credential parts of a URL ' +
    'under `providerConfig` (userinfo and credential query parameters) and an `auth` or `authentication` ' +
    'value that is not an object.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema` with no ' +
    '`unrecognized_keys` issue at its root; each misplaced provider setting sits under `providerConfig` and ' +
    'the instance still materializes (`GET /api/v1/automation/connectors` reports it `ready`); each secret ' +
    'that sat at a top-level key is set under its `credentialRef` name; no stored `sys_metadata` connector ' +
    'row reports an undeclared top-level key in its `_diagnostics`.',
};
