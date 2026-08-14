// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-reference-rail-unknown-keys-refused',
  surface: 'page `record:reference_rail` components — `properties` and each `entries[]` item: '
    + 'undeclared keys (notably a per-entry `filter`, an entry `icon`, and an inline locale map '
    + 'as `title`)',
  replacement: 'the declared shape the renderer reads: `entries[]` of `{ objectName, '
    + 'relationshipField, title?, limit?, displayField? }` plus a component-level `hideEmpty`. '
    + 'Every rejection carries the surface, the offending key and a prescription (`filter` → '
    + 'remove it, or use `record:related_list` whose `filter` is real; `icon` → remove it, no '
    + 'render path reads it; entry-level `hideEmpty` → move it up beside `entries`; `items` / '
    + '`related` → `entries`; `object` → `objectName`; `label` → `title`; a `title` locale map '
    + '→ a literal string, or omit it to keep the localized object label)',
  reason:
    'The rail was the `record:*` component the #4001/#5068 gate could not reach: it had a '
    + 'registered renderer and a `PageComponentType` entry but no `ComponentPropsMap` row, so '
    + 'the props gate\'s dispatch skipped it as unregistered and every authored key rode '
    + 'through. Measured on 17.0.0 GA end to end: a planted entry `filter` passed tsc, '
    + '`objectstack validate` and `objectstack build`, shipped verbatim in the artifact, and '
    + 'the rendered rail kept counting and listing unfiltered rows — while the same build '
    + 'loudly reported `record:related_list` keys in the same file. The row declares the shape '
    + 'the renderer actually reads (measured from its read points, not its TS interface — the '
    + 'interface\'s `icon` is read by nothing and is refused, not declared), so an undeclared '
    + 'key is now a publish-time refusal instead of a silent no-op.',
  acceptanceCriteria:
    'Every `record:reference_rail` node validates with only declared keys: `properties` carries '
    + '`entries` (≥ 1) and optionally `hideEmpty`; each entry carries `objectName` and '
    + '`relationshipField` and optionally `title` (literal string), `limit` (positive int) and '
    + '`displayField`. Declared keys parse byte-identically to before; `objectstack validate` '
    + 'reports no `component-props-unknown-key` / `component-props-invalid` finding for the '
    + 'rail.',
};
