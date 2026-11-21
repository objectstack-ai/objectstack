// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of a seed's roll-up value, no longer stored
// (maintainer ruling D, record 7063117450, on objectstack#35655, from the
// decision analysis 7062334196). It narrows the documented "seed data keeps a
// pre-computed total" sentence. No key is added or removed, so there is no
// tombstone and no D2 conversion: whether a supplied total should become seeded
// child rows, a plain number field or a historical import is the author's call.
// The citations live here, not in the printed guidance, which carries no
// tracker number.
export const entry: SemanticMigration = {
  id: 'seed-summary-value-not-stored',
  surface:
    'data.Seed.records (a seed dataset in `defineStack({ data })`, `defineSeed`, a `seed` metadata item, or a package '
    + 'body\'s seed): a record that supplies a value for a field its object declares `type: \'summary\'` (a roll-up '
    + 'of any aggregate: `count`, `sum`, `min`, `max`, `avg`)',
  replacement:
    'Leave the summary field out of the seed record and seed the child rows the total is computed from. A figure '
    + 'that no child rows back is a plain value: model it as a `number` or `currency` field. A legacy total that must '
    + 'land as written goes through a historical import (`treatAsHistorical: true`), not a seed',
  reason:
    'A roll-up is computed by the engine from its child rows. The seed loader writes as the system principal, so a '
    + 'value a seed record supplied for one used to be stored as written, and survived wherever no child write came '
    + 'after it: a parent seeded with a total and no children kept the total, a re-seed over existing children wrote '
    + 'it over the computed value, and a seed replayed on the next boot stored the computed total on the first load '
    + 'and the supplied one on the second. A child row a validation rule judged against the supplied total could be '
    + 'refused for it. The loader now takes every such value out of the record before the replay compare and the '
    + 'write, on insert and on update: a created row starts the column at its empty-child-list value (0 for `count` '
    + 'and `sum`, empty for `min`, `max` and `avg`) and the seeded child rows compute it; a matched row keeps the '
    + 'value it holds. The load logs one warning per dataset naming the object, the fields and how many values it '
    + 'did not write. '
    + 'There is no mechanical rewrite: only the author knows whether the total stands for child rows that should be '
    + 'seeded or for a figure that is not a roll-up at all. Rows an earlier load stored a supplied total on are data, '
    + 'not metadata: the next child write recomputes them',
  acceptanceCriteria:
    'No seed record supplies a value for a `summary` field: the boot log and a seed validation carry no roll-up '
    + 'drop warning for any dataset, and every seeded roll-up equals the aggregate of its seeded child rows after the '
    + 'first boot and after a restart.',
};
