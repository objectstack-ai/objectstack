// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20637 — ADR-0049 enforce-or-remove (maintainer ruling, letter C) — the D3
// entry of the `cube-refresh-key-removed` family (one D3 entry per retirement
// family, even when D2 is lossless). Registered key: `data/Cube:refreshKey`.
// The strip changes no query answer; what it cannot decide is whether anything
// the author built assumed that cube results were cached or refreshed.
export const entry: SemanticMigration = {
  id: 'cube-refresh-key-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'analyticsCubes[].refreshKey (every, sql) — a cube\'s declared refresh cadence and data-change probe',
  replacement:
    'Nothing: delete the key. No analytics result is cached, so every query against a cube is computed '
    + 'when it is asked. A refresh cadence is declared again when a result cache exists.',
  reason:
    'The D2 conversion `cube-refresh-key-removed` deletes `refreshKey` from every cube, and the delete is '
    + 'lossless: nothing read `every` or `sql`, and no analytics result was ever cached for them to '
    + 'refresh, so no query answers differently. What the conversion cannot check is whether anything the '
    + 'author built assumed that cube results were cached or refreshed on a schedule. They never were.',
  acceptanceCriteria:
    'No cube carries `refreshKey`, and the parse refuses one with the prescription. Every analytics '
    + 'query answers as it did before the upgrade. Nothing the author maintains relies on cube results '
    + 'being cached or refreshed on a schedule.',
  relevantWhen: { kind: 'stack-declares', keys: ['analyticsCubes'] },
};
