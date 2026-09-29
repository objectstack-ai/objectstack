// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove — the D3 entry of the connector resilience family:
// `connector.health` (the `healthCheck` probe and the `circuitBreaker`),
// `connector.status` and the connector-nested `webhooks`, sixteen authorable keys
// retired as one batch. One D3 entry per retirement family, even when D2 is
// lossless (ruling B on #17152): the D2 conversion
// `connector-resilience-keys-removed` repairs the data, and this entry carries
// what only the author can judge. It also names the CHAIN through the same
// protocol step: `connector-health-and-trigger-durations-unit-in-key` used to
// rename `health.circuitBreaker.monitoringWindow` to `monitoringWindowMs`, and
// that half was absorbed here — the renamed key is itself removed. (Its trigger
// half was absorbed later by `connector-triggers-removed`, and the conversion
// left the table.)
export const entry: SemanticMigration = {
  id: 'connector-resilience-keys-retired',
  surface: 'connector.health (healthCheck / circuitBreaker), connector.status and connector.webhooks — '
    + 'on a connector and on a stack connectors[] entry',
  replacement: '(removed — nothing replaces the probe, the breaker or an authored status.) '
    + 'Participation is `enabled` (and `provider` on a declarative instance); whether a registered '
    + 'connector can be dispatched is the computed `state` (`ready` / `degraded`) on '
    + '`GET /api/v1/automation/connectors`; a webhook that is actually delivered is declared in '
    + 'the top-level `webhooks:` collection; probes and circuit breaking belong in the connector '
    + 'provider or an upstream gateway.',
  reason: 'The D2 conversion `connector-resilience-keys-removed` deletes `health`, `status` and '
    + '`webhooks` from every connector, stack entry and stored connector row, one notice per key, '
    + 'and the delete is lossless: no loop ever polled a connector endpoint, counted failures or '
    + 'tripped a breaker, no code read an authored status, and a webhook nested in a connector '
    + 'was never registered, materialized or delivered. Three judgements remain. First, a probe '
    + 'or breaker the author believed was protecting a flaky upstream never was — if that '
    + 'protection matters, it has to be built where calls are made (the connector provider) or '
    + 'in front of the upstream (a gateway). Second, `status` values like `active` or `error` '
    + 'gated nothing; an author who used `status` to switch a connector off needs `enabled: '
    + 'false` on the declarative entry instead. Third, the nested webhooks are STRIPPED, not '
    + 'moved: redeclaring one in the top-level `webhooks:` collection STARTS deliveries that '
    + 'never happened before, so which of them should exist is the author\'s call — and their '
    + '`events` (`sync.completed`, `auth.expired` and the rest) and `signatureAlgorithm` have no '
    + 'counterpart there. The chain: in this same protocol step, '
    + '`connector-health-and-trigger-durations-unit-in-key` no longer renames '
    + '`health.circuitBreaker.monitoringWindow` to `monitoringWindowMs` — the whole block that '
    + 'key lived in is removed, so an author holding either spelling ends with no key at all. '
    + 'That conversion\'s other half, `triggers[].interval` to `intervalSeconds`, was absorbed '
    + 'the same way by the removal of the whole `triggers` array (`connector-triggers-removed`), '
    + 'so the rename itself is no longer in the step.',
  acceptanceCriteria: 'No connector and no stack connector entry carries `health`, `status` or '
    + '`webhooks`; the parse refuses each with its prescription (a stored `status: \'inactive\'` '
    + 'default is accepted and stripped as inert residue), and no code imports ConnectorHealth, '
    + 'HealthCheckConfig, CircuitBreakerConfig, ConnectorStatus, WebhookConfig, WebhookEvent or '
    + 'WebhookSignatureAlgorithm. Every connector dispatches exactly as it did before the '
    + 'upgrade. Each declarative connector instance the author meant to be switched off carries '
    + '`enabled: false` and is observed absent from `GET /api/v1/automation/connectors`; each '
    + 'nested webhook that is still wanted '
    + 'is declared in the top-level `webhooks:` collection and observed delivering; and each '
    + 'probe or breaker the author relied on is provided by the connector provider or a gateway '
    + 'and observed tripping against a failing upstream.',
};
