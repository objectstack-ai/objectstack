// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `ConnectorSchema.status` — part of the connector
// resilience family batch (see `18.integration__Connector__health.ts`). The key
// was `ConnectorStatusSchema` (`active` / `inactive` / `error` / `configuring`)
// with a `.default('inactive')`, and NOTHING read it. Measured at `origin/main`
// 3f86dc52f2 with one member-read pattern over the connector packages, the
// automation service, rest, runtime, metadata and objectql: 38 `.status` reads,
// every one on an HTTP answer, an error case or a flow-run entry, none on a
// connector def — while the same pattern finds `requestTimeoutMs`, the lit
// control, read off a connector entry or provider context five times.
// The runtime's dispatchability answer is a DIFFERENT field: the computed
// `state` (`ready` / `degraded`) that `GET /api/v1/automation/connectors`
// publishes and no authored value can set. Participation is `enabled` (and
// `provider` on a declarative instance). The only non-spec occurrences were
// WRITES — `status: 'active'` in the four shipped connector packages and
// `status: 'error'` on the automation service's degraded husk — read back by
// nothing; they were deleted in the same change.
//
// Tombstoned with `retiredKey()` (non-strict schema, ADR-0104); the orphaned
// `integration/ConnectorStatus` enum leaves via `RETIRED_DEFS_BY_MAJOR[18]`.
//
// ⭐ RETIRED-DEFAULT RESIDUE: owed and adopted — `{ status: 'inactive' }` joins
// `{ connectionTimeoutMs: 30000 }` in `CONNECTOR_RETIRED_KEY_RESIDUE` on both
// carriers (#12840's class rule, `shared/retired-key.ts`). The discriminator is
// whether a released toolchain MATERIALIZED the default into something that is
// later re-parsed, and it did: every 17.x parse emitted `status: 'inactive'`
// into every connector — authored or not — and `registerConnector` re-parses a
// def built in code, where no conversion runs. Any other value keeps the
// refusal. Sources and stored rows are rewritten by the D2 conversion
// `connector-resilience-keys-removed`.
export const entry = 'integration/Connector:status';
