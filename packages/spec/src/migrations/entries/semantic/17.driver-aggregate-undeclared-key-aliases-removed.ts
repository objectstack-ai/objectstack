// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-aggregate-undeclared-key-aliases-removed',
  // No backticks in `surface`: the upgrade-guide renderer wraps this string
  // in a code span of its own, and a nested pair renders as literal ticks.
  surface: "driver aggregate() call argument — query.aggregate and aggregations[].func",
  replacement:
    'query.aggregations and aggregations[].function — the spellings QueryASTSchema and '
    + 'AggregationNodeSchema have always declared',
  reason:
    '`SqlDriver.aggregate` and `RemoteTransport.aggregate` each read two aliases the '
    + 'Query Protocol has never declared: `query.aggregations || query.aggregate` and '
    + '`agg.function || agg.func`. "Never declared" is measured, not assumed — `git log '
    + '-S` over `data/query.zod.ts` finds no commit that ever introduced either name, '
    + 'there is no `retiredKey()` tombstone and no alias-table entry for them (the file\'s '
    + 'only alias table is `SortNode`\'s `direction` → `order`), and neither appears in any '
    + 'upgrade guide or release note. So this entry does not record a declared surface '
    + 'being withdrawn; it records a LENIENCY being withdrawn, which is why it is here '
    + 'rather than behind a tombstone. The only writers in this repository were the two '
    + 'driver packages\' own fixtures — #4984\'s family, where a fixture spelling the alias '
    + 'keeps the tolerant limb green forever and no test in existence can go red on its '
    + 'deletion — so ADR-0049 enforce-or-remove applies once those are re-spelt. ⚠️ Do '
    + 'NOT read this across to `dashboard`/`page` measures: `aggregate` IS the canonical '
    + 'key there and `func` IS a declared, loudly-suggesting alias (`DatasetMeasureSchema`, '
    + 'ui/dataset.zod.ts). That neighbouring vocabulary is untouched, and it is the most '
    + 'likely reason an off-repo caller ever wrote these keys on a QUERY — one habit, two '
    + 'surfaces, only one of which declared it. This is a driver CALL ARGUMENT — code, '
    + 'never stack metadata — so there is no source for the D2 chain to rewrite and '
    + 'deliberately no schema tombstone: nothing ever ran a query through '
    + '`QueryASTSchema.parse()` on this path. The enforced channel is tsc at the call '
    + 'site, once the parameter is `DriverQuery` — and for an untyped JS caller there is '
    + 'no enforced channel at all, which is exactly why this ledger entry has to exist: '
    + 'the generated upgrade guide is the only way such a reader learns of the rename. '
    + 'Same disposition, and the same reason, as `data-driver-find-stream-retired` '
    + '(#4484), `storage-service-list-retired` (#5540) and `actor-user-roles-to-positions` '
    + '(#6011). ADR-0049 / ADR-0087, #6321 (PR #6404).',
  acceptanceCriteria:
    'No caller passes `aggregate:` to a driver\'s `aggregate()`, and no aggregation entry '
    + 'spells its function `func:`; both are written `aggregations:` / `function:`. An '
    + 'inline literal still using either old spelling no longer type-checks (TS2353 at the '
    + 'call site). An untyped JS caller that keeps writing `aggregate:` silently receives '
    + 'no aggregate column — the grouping still happens, the measure is simply absent — '
    + 'and one that keeps writing `func:` receives INVALID_QUERY / 400 naming the '
    + 'undeclared function, identically on the local driver and the Turso remote '
    + 'transport.',
};
