// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A shorthand that silently declared a value nobody wrote, refused instead. The
// Field.select string shorthand used to delete every character outside a-z, 0-9
// and _, so 'no-overlay' was declared as nooverlay. It now keeps the string as
// written beyond lower-casing and whitespace to _, and SelectOptionSchema.value
// refuses what is no system identifier, as it always did for an explicit value.
// A structured TODO, not a D2 conversion: the shorthand runs in the author's own
// TypeScript, so no stored artifact carries it, and which value the author meant
// to store (no_overlay, or the column is not a select at all) is intent no
// artifact records.
export const entry: SemanticMigration = {
  id: 'field-select-shorthand-keeps-written-value',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.Field.select string shorthand (Field.select([...]) and Field.select({ options: [...] }) with '
    + 'string options) — a string holding a character outside letters, digits, whitespace, _ and . '
    + '(a hyphen, most often) is now refused at options.N.value instead of being declared with that '
    + 'character deleted',
  replacement:
    'write the option explicitly with the value you store: Field.select({ options: [{ label: '
    + '\'no-overlay\', value: \'no_overlay\' }] }). Where rows already hold the hyphenated spelling, the '
    + 'column is not a select: declare it as Field.text({ maxLength: 255 })',
  reason:
    'The shorthand built each option as { label: s, value: s lower-cased, whitespace runs turned into _, '
    + 'and every other character outside a-z, 0-9 and _ deleted }. The last step was undocumented and '
    + 'silent: Field.select([\'no-overlay\']) declared nooverlay, and a record written with no-overlay, the '
    + 'value as written, was refused with invalid_option on a writable field and held a value no option '
    + 'declared on a read-only one. The ruling on this defect made the shorthand stop rewriting and join '
    + 'the refusal an explicit { value: \'no-overlay\' } already met, rather than inventing a parallel one '
    + '(ADR-0049: a declaration holds what its writer writes). SelectOptionSchema.value accepts and refuses '
    + 'exactly what it did before; the shorthand only stops hiding a value from it. A dot is now kept '
    + 'rather than deleted, so \'v1.2\' declares v1.2, a valid identifier, where it declared v12. An '
    + 'object built by the old helper and stored carries explicit option values (nooverlay), which still '
    + 'parse, so no stored row or definition needs rewriting. Measured on this tree at the change: the one '
    + 'in-tree shorthand the strip altered was sys_metadata_audit.lock_state, now a text column; no '
    + 'example, template, CLI scaffold or published skill writes such a string. ADR-0049 / ADR-0087.',
  acceptanceCriteria:
    'Load every object module (os validate or os build): ObjectSchema.create and the object save door '
    + 'report any shorthand option that is no system identifier at fields.FIELD.options.N.value with '
    + 'invalid_format. Rewrite each as an explicit option whose value is the one your writers store, or '
    + 'declare the column as text where stored rows hold the hyphenated spelling. Done when every object '
    + 'loads and every select option value equals a value a writer stores.',
};
