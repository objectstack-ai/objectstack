// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-options-timeout-to-timeout-ms',
  surface: '`DriverOptions.timeout` (data/driver.zod.ts) — the per-call options argument of every `IDataDriver` method',
  replacement: '`DriverOptions.timeoutMs` (milliseconds) — rename the key; the value is unchanged',
  reason:
    'Maintainer ruling 2026-09-02 on #14478 (ruled B — no grandfathered baseline): the unit of a '
    + 'duration-shaped `z.number()` key lives in the key NAME, never only in the description. '
    + '`timeout` said "Timeout in ms" in prose and nothing else. Tombstoned with retiredKey '
    + '(`DriverOptionsSchema` is not strict, so a bare deletion would strip the old key in '
    + 'silence) and registered as `data/DriverOptions:timeout`. Why a semantic entry and not a '
    + 'D2 conversion: a `DriverOptions` object is built at a call site and handed to a driver '
    + 'method — it is not a stack collection member and is never stored, so the chain has no '
    + 'seam that runs on it. Measured on ca46f8f12: no in-repo driver reads the key (the '
    + 'engine\'s own per-call budget is a separate `timeoutMs` on its options), so callers move '
    + 'their spelling with no behaviour change.',
  acceptanceCriteria:
    'No caller passes `{ timeout }` in a `DriverOptions` argument; a call spelling it fails to '
    + 'compile (input type `never`) and `DriverOptionsSchema.parse({ timeout: 5000 })` fails with '
    + 'the rename prescription naming `timeoutMs`; `{ timeoutMs: 5000 }` parses to the same '
    + 'number.',
};
