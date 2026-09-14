// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-multiple-non-capable-type-refused',
  surface: 'object.fields.<name>.multiple — an authored `multiple: true` on a field whose '
    + '`type` is outside MULTI_CAPABLE_TYPES (`select` / `radio` / `lookup` / `user` / `file` / '
    + '`image`) union MULTI_OPTION_TYPES (`multiselect` / `checkboxes` / `tags`) — e.g. '
    + '`master_detail`, `tree`, `text`, `boolean`, `datetime`, `avatar`',
  replacement: 'a multi-capable type that actually holds several values: `multiselect` / '
    + '`checkboxes` / `tags` for several option codes, a `lookup` with `multiple: true` for '
    + 'several related records (the replacement for a multi-valued `master_detail` / `tree`), '
    + '`file` / `image` with `multiple: true` for several attachments — or, where the field '
    + 'really does hold one value, dropping the `multiple` key. `MULTI_CAPABLE_TYPES` and '
    + '`isMultiValueField` are unchanged, so every field that was ALREADY multi-valued by that '
    + 'predicate keeps its declaration, its storage and its read path verbatim.',
  reason:
    '#17469 (maintainer ruling 2026-09-13, decision batch #128 item 5, option 1′ — the #11437 '
    + 'radio rule generalised): two definitions of "multi-valued" disagreed. `FieldSchema` '
    + 'accepted `multiple: true` on ANY type; driver-sql\'s `isJsonField` read it raw '
    + '(`|| !!field.multiple`) and built a JSON ARRAY column; `isMultiValueField` — the spec '
    + 'predicate consumers shape queries from — answered "not multi-value" for the same field. '
    + 'A related list therefore composed `=` against a JSON array column and the driver answered '
    + 'the user a 400 (objectui#8886 pinned the divergence on the consumer side; objectui#8937 '
    + 'recorded it as owed and not filed). There is NO lossless conversion: the column was '
    + 'physically built as a JSON array, so the stored value is an array while the replacement '
    + 'type may want one scalar, several ids, or several option codes — which of those the author '
    + 'meant is a business judgment the chain cannot make. Hence a structured TODO rather than an '
    + 'auto-rewrite (ADR-0087 D3 "never silence", ADR-0032 "no silent failure"). Population '
    + 'measured at ruling time: 0 in-tree and 0 in HotCRM (shallow clone c716a2c) — every '
    + '`multiple: true` there is on `lookup` / `select`.',
  acceptanceCriteria:
    'Every field in the stack parses: `ObjectSchema.parse()` / `objectstack validate` report no '
    + 'issue on the `multiple` path. For each field the refusal names — the message states the '
    + 'object-qualified field name and its `type` — the author has either dropped `multiple` or '
    + 'moved the field to a multi-capable type AND migrated the stored column, because the two '
    + 'storages differ: the old column holds a JSON array, the new one holds a scalar (dropping '
    + '`multiple`) or a differently-shaped array (changing `type`). Prove the data half by '
    + 'reading one migrated row back through the API and asserting the value shape the new '
    + 'declaration promises; `=` filters against the field answer rows instead of a 400. Fields '
    + 'already multi-valued by `isMultiValueField` need no change and must read back '
    + 'byte-identically.',
};
