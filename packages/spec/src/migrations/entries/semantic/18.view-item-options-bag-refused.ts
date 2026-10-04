// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Stage (iv) of ruling 甲 on #20051. A write-time narrowing of the ViewItem wire
// member: a stored record it newly refuses is read and served exactly as before
// and fails only on its next save, which is why this is a semantic entry and
// not a conversion — whether a record's top-level bag duplicates, contradicts
// or extends its `config` blocks is a fact only its author holds.
export const entry: SemanticMigration = {
  id: 'view-item-options-bag-refused',
  surface:
    'A top-level `options` bag on a `view` item RECORD (`{ name, object, viewKind, config }`) saved through '
    + 'the metadata write door (`PUT /api/v1/meta/view/:name`, the Studio / MCP save): `options.kanban`, '
    + '`options.calendar`, `options.timeline` and every other key in it, on either `viewKind`.',
  replacement:
    'The same per-kind blocks under the record\'s `config` — `options.kanban` becomes `config.kanban`, '
    + '`options.timeline` becomes `config.timeline` — where each is judged by its kind\'s own block schema, '
    + 'and a key that block does not declare is re-spelled or deleted as its refusal says. A key `config` '
    + 'already sets wins; the bag\'s copy is deleted. The flattened list overlay (no `config`) keeps its '
    + 'legacy `options` bag, judged key by key, as before.',
  reason:
    'The record member re-opens its top level with a strip so the console\'s round-trip keys survive, and '
    + 'that strip dropped a top-level `options` bag from the parse without looking inside it, while the save '
    + 'stored the request body. The console reads a record\'s body from `config` on the object page but '
    + 'spreads the whole stored record on the interface page, so the same saved view rendered two ways. '
    + 'Now that the save stores the parsed body, the bag would instead vanish silently on the next save. '
    + 'The maintainer\'s ruling of 2026-09-30 refuses it by name with the prescription to '
    + 'write `config.KIND`; declaring it would have kept a second spelling of one block on a second member. '
    + 'No console write puts the bag on a record. Not convertible: which of two spellings of one block the '
    + 'author meant, where both are set, is the author\'s call.',
  acceptanceCriteria:
    'Every stored `view` record carrying a top-level `options` saves again after its blocks move under '
    + '`config`. A record that still carries the bag is refused `422 INVALID_METADATA` on its next save, with '
    + 'an issue at `options` whose message prescribes `config.KIND`. Nothing is rewritten on read and nothing '
    + 'is refused on read: a record that fails is served exactly as stored until it is saved. Verify by '
    + 're-saving each stored record that carries `options` (a GET then a PUT of the same body) and reading '
    + 'a `200`.',
};
