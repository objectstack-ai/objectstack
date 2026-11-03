// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29523: an object extension's `fields` is keyed by the key schema
// `ObjectSchema.fields` reads, as its `fieldPatches` is (#29366). A semantic
// entry and not a conversion: the key is the name the added field is stored
// and queried under, and a rewrite of the spelling (lower-casing, a space or
// `-` to `_`) names a different column than the one rows, views and formulas
// may already read, or lands on a field the target already declares, so the
// name is the author's to choose.
//
// A stored row in this shape is listed, not rewritten: the stored pass wraps an
// `object_extension` row as an `objectExtensions` entry (the stored-only map in
// `conversions/stored.ts`), and the `REFUSED_STORED_SHAPES` detector of this id
// (`conversions/refused-shapes.ts`) lists each key the extension's own parse
// refuses as a key, under its row, through `os migrate meta --stored`.
export const entry: SemanticMigration = {
  id: 'object-extension-field-key-grammar-refused',
  surface:
    '`objectExtensions[].fields` keys (`defineObjectExtension({ fields })`) that are not a field name: any '
    + 'key outside the lowercase snake_case grammar of an object\'s `fields` keys, such as a label '
    + '(`Region Code`, `RegionCode`) or a kebab spelling (`region-code`).',
  replacement:
    'A lowercase snake_case field name, the key grammar of the target object\'s own `fields`: '
    + '`fields: { region_code: { type: \'text\', label: \'Region Code\' } }` (`region_code__c` in a '
    + 'customization package), never `fields: { \'Region Code\': { … } }`.',
  reason:
    'An extension\'s `fields` are merged into the target object\'s field map, and every key of that map is '
    + 'lowercase snake_case: `ObjectSchema.fields` refuses any other key. The extension schema used to take '
    + 'any string, so such a field parsed in `defineStack` and in `defineObjectExtension`, whether or not '
    + 'the target was in the same stack, and was merged into an object whose own declaration could never '
    + 'have held it. The key is now judged where it is written, by the same key schema the field map uses.',
  acceptanceCriteria:
    'Every `fields` key of every object extension in the stack is lowercase snake_case, and `os validate` '
    + 'passes. A key outside the grammar is refused at parse with one `invalid_key` issue at `fields.KEY` '
    + 'that names the grammar and an example. A stored `object_extension` row whose body still carries such '
    + 'a key no longer parses, so the sync that registers stored extensions names the row '
    + '(`INVALID_METADATA`) and registers none of it, its `fieldPatches` included, and its next save is '
    + 'refused until the field is renamed. `os migrate meta --stored` lists such a row before the upgrade, '
    + 'one TODO for each refused key at `fields.KEY` naming the extended object, and leaves it as stored: '
    + 'rename each listed field to a snake_case name, along with every view, formula and caller that reads '
    + 'it, and save the extension.',
};
