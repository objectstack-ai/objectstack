// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'connector-entry-nested-undeclared-key-refused',
  surface: 'connector entries AUTHORED through `defineConnector()`, defineStack `connectors:`, `os validate` / ' +
    '`os compile`, the artifact load and `PUT /meta/connector/:name` — a key `retryConfig` or an `actions` element ' +
    'does not declare',
  replacement: 'keep only the keys `RetryConfigSchema` declares inside `retryConfig` (`strategy`, `maxAttempts`, ' +
    '`initialDelayMs`, `maxDelayMs`, `backoffMultiplier`, `retryableStatusCodes`, `retryOnNetworkError`, `jitter`) ' +
    'and only the keys `ConnectorActionSchema` declares inside each `actions` element (`key`, `label`, ' +
    '`description`, `inputSchema`, `outputSchema`, `effect`). A credential goes into the secrets layer under the ' +
    'name `auth.credentialRef` gives and the key is deleted; an execution binding (`method`, `path`, `url`) has no ' +
    'home on an action (ADR-0097 §5) — a provider-bound instance derives its actions from the upstream.',
  reason:
    'The entry closed its top level; its two nested shapes were still plain objects, so an undeclared key inside ' +
    '`retryConfig` or an `actions` element parsed green at every door and meant nothing to the runtime. Each is ' +
    'refused now, by name, in one `unrecognized_keys` issue located at the container (`retryConfig`, `actions.N`) ' +
    'that lists every undeclared key. There is deliberately no mechanical rewrite, for the top-level entry\'s ' +
    'reason: an undeclared key may be a misplaced setting or the only copy of a secret. The open shapes ' +
    '(`ConnectorSchema`, `RetryConfigSchema`, `ConnectorActionSchema` — the def a plugin hands to ' +
    '`registerConnector`, and the policy the runtime parses) are unchanged. A row stored before this refusal keeps ' +
    'working: the read withholds the undeclared key. An explicit `retryConfig` in a save replaces the stored one ' +
    'whole, so its undeclared key is not kept and the save names it on its answer; an `actions` element\'s ' +
    'undeclared key is kept at rest by a save of the served form.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema` with no `unrecognized_keys` ' +
    'issue at `retryConfig` or at an `actions` element; each secret that sat at such a key is set under its ' +
    '`credentialRef` name.',
};
