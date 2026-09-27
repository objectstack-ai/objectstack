// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15680 / #15682 (stack card of #14478, maintainer ruling B: a duration key
// carries its unit in its NAME) — the D3 entry of the
// `turso-config-timeout-to-timeout-ms` family (ruling B on #17152: one D3 entry
// per retirement family, even when D2 is lossless). One conversion covers the
// authored surface of both declarations — the spec's turso contract and the
// driver package's own mirror schema, renamed in the same change.
export const entry: SemanticMigration = {
  id: 'turso-config-timeout-unit-in-key',
  surface: 'datasource.config.timeout on the turso driver — the per-request time limit',
  replacement: '`timeoutMs` — the same limit, in milliseconds, beside the sibling '
    + '`sync.intervalSeconds` that already spelled its unit.',
  reason: 'The D2 conversion `turso-config-timeout-to-timeout-ms` renames `config.timeout` to '
    + '`config.timeoutMs` on every datasource whose driver resolves to turso (a stored `libsql` '
    + 'spelling included) and leaves every other driver\'s `timeout` alone; the rename is lossless '
    + 'because the key always meant milliseconds. The judgment is whether each value was written '
    + 'in that unit. Two keys above it, `sync.intervalSeconds` spelled SECONDS, so one config '
    + 'block carried both conventions, and the unit of `timeout` lived only in a description and '
    + 'a title no parse reads: `timeout: 30` meant as thirty seconds became a thirty-millisecond '
    + 'limit, short enough to fail a remote request, and the rename keeps 30. Only the author '
    + 'can say which unit they meant. Code that builds a turso driver config in TypeScript is '
    + 'outside the chain\'s reach.',
  acceptanceCriteria: 'No turso datasource carries `config.timeout`; the spec contract refuses it '
    + 'with the rename. Every `timeoutMs` value is the limit the author intends in milliseconds — '
    + 'a datasource meant to allow thirty seconds '
    + 'reads `timeoutMs: 30000` — and queries against the remote database complete as they did '
    + 'before the upgrade. No code reads or writes `timeout` on a turso driver config.',
};
