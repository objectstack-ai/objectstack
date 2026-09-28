// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `ConnectorSchema.health` — the connector
// resilience family (one batch with `status` and the nested `webhooks`), retired
// by the maintainer's criterion for a declared-but-unenforced family: does the
// mainstream platform offer the capability? Author-configured health probes and
// circuit breakers are not connector metadata anywhere in the mainstream
// (Salesforce Named Credentials, Power Platform custom connectors, Retool /
// Appsmith resources); breakers live in API-gateway infrastructure.
//
// Measured on `origin/main` before the removal: the fourteen keys under the block
// — `healthCheck.{enabled, intervalMs, timeoutMs, endpoint, method,
// expectedStatus, unhealthyThreshold, healthyThreshold}` and
// `circuitBreaker.{enabled, failureThreshold, resetTimeoutMs,
// halfOpenMaxRequests, monitoringWindowMs, fallbackStrategy}` — have ZERO reads
// outside `packages/spec` (lit control in the same scan: `retryConfig`, the
// executed sibling policy, read 17 times in `packages/connectors` and
// `packages/services/service-automation`). Nothing polled, counted or tripped.
//
// Tombstoned with `retiredKey()`: `ConnectorSchema` is a non-strict `z.object`,
// so a bare deletion would be a silent strip (ADR-0104). The shapes behind it
// leave whole — `integration/ConnectorHealth`, `integration/HealthCheckConfig`,
// `integration/CircuitBreakerConfig` in `RETIRED_DEFS_BY_MAJOR[18]`. The key
// carried no default of its own, so there is no residue window for it (its
// sub-keys' defaults were only materialized inside an authored block). Sources
// and stored rows are rewritten by the D2 conversion
// `connector-resilience-keys-removed`; the family's judgement is the D3 entry
// `connector-resilience-keys-retired`.
//
// Registered under 18, not 17: the removal ships on the 17.x line
// (launch-window convention: accept-set narrowings ride minor releases) and the
// prescription lives at the major boundary where `migrate meta` users look — the
// disposition `18.integration__Connector__errorMapping.ts` records for the same
// schema.
export const entry = 'integration/Connector:health';
