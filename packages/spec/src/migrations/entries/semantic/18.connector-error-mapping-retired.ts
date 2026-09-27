// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove — the D3 entry of the
// `connector-error-mapping-removed` family, which landed in commit 13c48c2a5:
// eleven inert authorable keys, one of them spelled like the live
// `userMessage` channel. One D3 entry per retirement family, even when D2 is
// lossless (ruling B on #17152). The family is the key on both carriers
// (`integration/Connector:errorMapping`,
// `integration/DeclarativeConnectorEntry:errorMapping`) and the shape that
// leaves with it — `integration/ErrorMappingConfig`,
// `integration/ErrorMappingRule` and `integration/ConnectorErrorCategory` in
// RETIRED_DEFS_BY_MAJOR[18].
export const entry: SemanticMigration = {
  id: 'connector-error-mapping-retired',
  surface: 'connector.errorMapping — the rules / defaultCategory / unmappedBehavior / logUnmapped '
    + 'block and its per-rule keys, on a connector and on a stack connectors[] entry',
  replacement: '(removed — no connector engine maps an external error through authored rules.) '
    + 'Retry behaviour is `retryConfig`, which the outbound fetch applies. No connector-level '
    + 'channel shows an end user a message: an error users must read is surfaced by whatever '
    + 'handles the connector call\'s failure.',
  reason: 'The D2 conversion `connector-error-mapping-removed` deletes the whole block from every '
    + 'connector, stack entry and stored connector row, with one notice per connector, and the '
    + 'delete is lossless: no provider, dispatcher or materializer ever mapped an external error '
    + 'through the rules, so the eleven nested keys configured nothing. The judgment is about what '
    + 'the rules were written to achieve. A rule marking an upstream code `retryable` never '
    + 'changed a retry — if that retry matters, it belongs in `retryConfig`. A rule with a '
    + '`userMessage` never showed that message to anyone, although the spelling matches the live '
    + 'API-error channel and read as a user-facing refusal; if users need that text, whatever '
    + 'handles the failed call has to surface it. `unmappedBehavior` and `logUnmapped` suppressed '
    + 'or logged nothing. Which of these intents still matters is known only to the connector\'s '
    + 'author.',
  acceptanceCriteria: 'No connector and no stack connector entry carries `errorMapping`; the parse '
    + 'refuses it, and no code imports ErrorMappingConfig, ErrorMappingRule or '
    + 'ConnectorErrorCategory. Calls through each connector fail and retry exactly as they did '
    + 'before the upgrade. For every rule whose intent still matters: a retry the author wanted is '
    + 'expressed in `retryConfig` and observed on a failing upstream, and a message the author '
    + 'wanted users to read is shown to them, by the caller that handles the failure, when the '
    + 'upstream fails.',
};
