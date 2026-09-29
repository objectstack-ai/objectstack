// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'apimethod-enum-shrink',
  surface: 'data.object.enable.apiMethods (the eight legacy non-primitive values)',
  replacement:
    'the six primitives only — `get` / `list` / `create` / `update` / `delete` / `bulk`: '
    + 'replace each legacy value with the primitives it derives from, de-duplicate, and '
    + 'delete the key entirely if the result names all six',
  reason:
    'The authored `enable.apiMethods` enum is now exactly the six primitives. The eight '
    + 'legacy values — `upsert`, `aggregate`, `history`, `search`, `restore`, `purge`, '
    + '`import`, `export` — are no longer authorable, because they are DERIVED effective '
    + 'operations resolved by the server\'s single derivation table, and an enum that lets an '
    + 'author name both a primitive and something derived from it has two spellings for one '
    + 'fact. The FROM → TO is a table rather than a rename: `upsert` → `create` + `update`; '
    + '`import` → `create` + `update`; `export`, `aggregate` and `search` → `list`; '
    + '`history` → `get`; and `restore` / `purge` map to NOTHING — they never derived, '
    + 'because `enable.trash` was retired with the other dead `enable.*` flags in the 11.0 '
    + 'ADR-0049 removal of dead author-facing properties, so the value is deleted outright. That '
    + 'last row is why this is a semantic entry and not a mechanical conversion, and the '
    + 'reason is a security one: the mapping WIDENS. An allowlist naming `history` was '
    + 'granting read of one record\'s audit trail; rewritten to `get` it grants ordinary '
    + 'record reads, and an allowlist naming `search` becomes a grant of full `list`. A '
    + 'transform that applied the table silently would broaden real API permissions without '
    + 'anyone reading the diff, so the rewrite is delegated to the author with the widening '
    + 'flagged. The reporter codemod exists for exactly that shape: `node '
    + 'scripts/codemod/apimethods-legacy-to-primitives.mjs` scans, reports the exact '
    + 'replacement per site, and FLAGS the allowlists the mapping would widen so the edit '
    + 'stays reviewable — it reports, it does not rewrite. Stored metadata keeps parsing '
    + '(permanent tolerance, narrowing only), so nothing breaks at rest; what changes is what '
    + 'an author may newly write. Registered late, by the stock reconciliation that compared '
    + 'the breaking changesets already on the v17 release train against this ledger: the enum '
    + 'shrink (phase 2 of the programme that made UI action buttons agree with the '
    + '`apiMethods` allowlist) predates the gate that makes a breaking changeset state its '
    + 'ledger disposition. ADR-0087.',
  acceptanceCriteria:
    'No authored `enable.apiMethods` array names a legacy value; `objectstack validate` '
    + 'passes. Run the reporter codemod first and read its widening flags before applying '
    + 'anything — ⚠️ the migration is only correct if each widened grant was INTENDED. For '
    + 'every object where `history` became `get` or `search` became `list`, confirm the '
    + 'broader operation is one the API should genuinely expose; where it is not, the answer '
    + 'is not a different value in this enum but a permission set that withholds the '
    + 'operation. Where the six primitives are all present, prefer deleting the key: that is '
    + 'equivalent to default-open and it tracks future primitives, whereas a hand-listed six '
    + 'silently stops granting anything added later. `restore` / `purge` are deleted with no '
    + 'replacement — if trash-like behaviour was being relied on, that capability left in the '
    + '11.0 dead-property removal and this entry is not where it returns.',
};
