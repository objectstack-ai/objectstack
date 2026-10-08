// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0120 D1 / D2 / D5a, staged by D7 to protocol 18: the declared index's
// positional `unique: true` is refused, and the chain respells it `'global'`.
export const entry: SemanticMigration = {
  id: 'declared-index-bare-unique-true-retired',
  surface: '`indexes[].unique: true` on a declared index (`objects[]` and `objectExtensions[]`) — '
    + 'the bare boolean, the one `unique` spelling whose scope was positional',
  replacement: 'a stated scope: `unique: \'global\'` (one holder across the whole installation — '
    + 'exactly the index bare `true` built, which is what the chain writes) or '
    + '`unique: \'organization\'` (one holder per organization — the driver prepends the NULL-safe '
    + 'organization key part `COALESCE(organization_id, \'__global__\')` to `fields` at '
    + 'registration). `unique: false` / omitted is unchanged, and field-level `unique: true` is '
    + 'unchanged and stays valid (it means per organization there)',
  reason:
    'The mechanical rewrite keeps every index exactly as it was built — `\'global\'` IS the verbatim '
    + 'column list bare `true` materialized, so nothing on disk changes. What the chain cannot know '
    + 'is what the author MEANT. On a declared index bare `true` read like "unique per '
    + 'organization" to anyone who knew the field-level meaning, and silently built an '
    + 'installation-wide constraint instead: an index meant per organization has been refusing a '
    + 'second organization\'s value all along, and its refusal told that organization somebody '
    + 'else holds it. Each respelled index is therefore a decision the owner makes once: keep '
    + '`\'global\'` for a genuinely installation-wide key (a hostname, an external provider id, an '
    + 'engine dedup key), or move it to `\'organization\'` so each organization may hold the value '
    + 'once — a change to the physical index that `os migrate plan` shows before anything is '
    + 'applied.',
  acceptanceCriteria:
    'No declared index in the sources carries `unique: true`: `os validate` passes, and every '
    + 'stored `object` row reads back with `\'global\'` where it held bare `true`. `os migrate plan` '
    + 'against the existing database shows no index operation for an index kept at `\'global\'`. '
    + 'Each index moved to `\'organization\'` appears in that plan as a planned index change.',
  conversionIds: ['declared-index-unique-scope'],
};
