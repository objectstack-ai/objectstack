// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/CircuitBreakerConfig` (`enabled`, `failureThreshold`,
// `resetTimeoutMs`, `halfOpenMaxRequests`, `monitoringWindowMs`,
// `fallbackStrategy`, and the `monitoringWindow` rename tombstone) leaves with
// `integration/ConnectorHealth`, whose `circuitBreaker` was its only carrier. No
// state machine ever opened, half-opened or closed a breaker, and none of the
// four `fallbackStrategy` behaviours was implemented. Its `monitoringWindow`
// tombstone leaves with it: the `RETIRED_KEYS_BY_MAJOR[18]` row
// `integration/CircuitBreakerConfig:monitoringWindow` stays, which is the
// whole-def removal steady state gate (b3) of `scripts/build-schemas.ts`
// deliberately exempts. See `retired-keys/18.integration__Connector__health.ts`
// for the retirement record.
export const entry = 'integration/CircuitBreakerConfig';
