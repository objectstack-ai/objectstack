// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'object-index-unknown-keys-refused',
  surface: 'object `indexes[]` entries (`IndexSchema`) — undeclared keys',
  replacement: 'the declared surface: `name` / `fields` / `unique` (ADR-0120 scope). A key that '
    + 'names no declared capability is simply removed. `where` — the console fallback editor\'s '
    + 'drifted spelling for a partial-index predicate, removed from the editor by objectui#4772 — '
    + 'gets a curated prescription: partial indexes are built at the database layer '
    + '(`CREATE [UNIQUE] INDEX … WHERE` from a runtime migration), never declared here',
  reason:
    'The #4001 strictness campaign\'s 批 20 held site 14 open on a measured #5114-class risk: '
    + 'objectui\'s embedded index editor shipped a drifted hand-copied schema offering `where` '
    + 'and `brin`, spliced its output into `object.indexes[]` and PUT the whole object, so '
    + 'closing the shape would have 422\'d a control the console itself rendered. objectui#4772 '
    + 'converged that editor to the declared surface, spending the hold\'s evidence. Before this '
    + 'close an undeclared key on an index parsed clean and was silently dropped — an admin '
    + 'filling the old "Partial-index predicate" control got a green save while no driver ever '
    + 'read the predicate (`syncDeclaredIndexes` consumes `name`/`fields`/`unique` only). '
    + 'Undeclared keys are now refused at parse time with a prescriptive message; the '
    + 'protocol-17 `type`/`partial` tombstones keep answering their own migration text.',
  acceptanceCriteria:
    'Every `indexes[]` entry parses with only `name` / `fields` / `unique`. Declared keys parse '
    + 'byte-identically to before, at every ADR-0120 `unique` spelling. A stored body from the '
    + 'drift window carrying `indexes[].where` is rejected with the database-layer prescription '
    + 'rather than saved with the key silently dropped.',
};
