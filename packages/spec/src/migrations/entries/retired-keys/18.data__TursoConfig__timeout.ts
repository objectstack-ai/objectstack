// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B. `TursoConfig.timeout` said
// "Operation timeout in milliseconds" in prose and carried a `.meta({ title:
// 'Timeout (ms)' })` no parse reads — and sat two keys below
// `sync.intervalSeconds`, which already spelled ITS unit. One shape carrying
// both conventions, and the suffixed one was the honest half. Renamed to
// `timeoutMs`; the value is unchanged. Tombstoned with `retiredKey()`; the
// shape IS `strictObject`, so the tombstone is here for the prescription an
// unknown-key rejection cannot carry. Covered by the D2 conversion
// `turso-config-timeout-to-timeout-ms`: a turso datasource is a `datasources[]`
// stack collection member whose `config` is stored whole in `sys_metadata`.
// ⚠️ This is the SPEC's turso contract (`packages/spec/src/data/driver/turso.zod.ts`).
// The driver package ships its own parallel `turso.zod.ts` whose `timeout` is
// outside this card's declared population and is renamed by the card that
// widens that population.
export const entry = 'data/TursoConfig:timeout';
