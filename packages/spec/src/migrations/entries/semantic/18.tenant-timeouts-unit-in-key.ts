// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'tenant-timeouts-unit-in-key',
  surface: 'DatabaseLevelIsolationStrategy `connectionPool.idleTimeout` / TenantSecurityPolicy '
    + '`accessControl.sessionTimeout` (system/tenant.zod.ts)',
  replacement: '`connectionPool.idleTimeoutSeconds` (default 300) and `accessControl.sessionTimeoutSeconds` '
    + '(default 3600) — rename each key; the values (seconds) are unchanged',
  reason:
    'Maintainer ruling 2026-09-02 on #14478 (ruled B), folding in #14519. Both keys carried their '
    + 'unit (seconds) in a source JSDoc only; `.describe()` — the text `content/docs/references/**` '
    + 'publishes — said "Idle pool timeout" and "Session timeout" with no unit at all. So the one '
    + 'reader who most needs the unit, the reader of the published reference page, was the only '
    + 'reader who never saw it: 300 is a plausible number of seconds and a plausible number of '
    + 'milliseconds, and nothing on the page decided it. #14519 proposed adding the unit to the two '
    + 'descriptions; under the #14478 gate that exact fix is a violation (unit in prose, none in '
    + 'the name), so the keys are renamed instead — one breaking change per key, and the tree '
    + 'never passes through a state the gate refuses. Both are retiredKey tombstones (the nested '
    + 'objects are not strict). Why a semantic entry and not a D2 conversion: neither schema is a '
    + 'stack collection member or a stored row (they describe cloud tenancy configuration), so the '
    + 'chain has no seam that runs on them (the `kernel/Manifest:loading` precedent). Measured on '
    + 'ca46f8f12: no in-repo runtime reads either key.',
  acceptanceCriteria:
    'Every tenant isolation / security-policy source spells `idleTimeoutSeconds` and '
    + '`sessionTimeoutSeconds`; authoring `idleTimeout` or `sessionTimeout` fails to compile and '
    + 'fails to parse with the rename prescription naming the suffixed key; the parsed defaults '
    + 'are 300 and 3600 as before.',
};
