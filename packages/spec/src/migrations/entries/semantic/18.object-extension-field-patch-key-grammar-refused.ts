// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29366: an object extension's `fieldPatches` is keyed by the key schema
// `ObjectSchema.fields` reads. A semantic entry and not a conversion: the key
// that was meant is the name of a field the target declares, and a rewrite of
// the spelling (lower-casing, `-` to `_`) can land on a different field or on
// none, so which field is the author's to name.
//
// No `REFUSED_STORED_SHAPES` detector lists a stored row in this shape, because
// none could be reached: `applyConversionsToStoredItem` maps a row type onto a
// stack collection, and `object_extension` has none (it is in neither
// `SINGULAR_TO_PLURAL` nor the stored-only map), so the stored pass hands the
// row back untouched and runs no conversion or detector over it. The criteria
// below say so, and name the query that finds such a row instead.
export const entry: SemanticMigration = {
  id: 'object-extension-field-patch-key-grammar-refused',
  surface:
    '`objectExtensions[].fieldPatches` keys (`defineObjectExtension({ fieldPatches })`) that are not a '
    + 'field name: any key outside the lowercase snake_case grammar of an object\'s `fields` keys, such as '
    + 'a label (`Industry`, `Annual Revenue`) or a kebab spelling (`annual-revenue`).',
  replacement:
    'The name of the field the extended object declares, the key of its `fields` entry: '
    + '`fieldPatches: { industry: { label: \'Sector\' } }`, never `fieldPatches: { Industry: { … } }`.',
  reason:
    'A field patch addresses one of the target\'s own fields by name, and every field name is lowercase '
    + 'snake_case, so a key outside that grammar can never match a field. The schema used to take any '
    + 'string, so such a patch parsed in `defineStack`, was stored by the `object_extension` save door, '
    + 'and booted: the registry fold only named it in the log and applied nothing, and `os validate` '
    + 'refused it only when the target object was part of the composed stack. The author read "Sector" '
    + 'in their package while the screen kept the vendor\'s label. The key is now judged where it is '
    + 'written, by the same key schema the field map uses.',
  acceptanceCriteria:
    'Every `fieldPatches` key in the stack is the name of a field its `extend` target declares, and '
    + '`os validate` passes. A key outside the grammar is refused at parse with one `invalid_key` issue '
    + 'at `fieldPatches.KEY` that names the grammar and an example. A stored `object_extension` row whose '
    + 'body still carries such a key no longer parses, so the sync that registers stored extensions names '
    + 'the row (`INVALID_METADATA`) and registers none of it, its `fields` included, and its next save is '
    + 'refused until the key is renamed to the field it meant. `os migrate meta --stored` does not list such '
    + 'a row: the stored pass maps no `object_extension` row onto a stack collection, so it reads the row as '
    + 'already on protocol. Find one before upgrading by reading each stored `object_extension` row\'s '
    + '`fieldPatches` keys against the snake_case grammar of `fields` keys.',
};
