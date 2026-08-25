// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-min-length-malformed-or-misplaced-refused',
  surface: 'object field `minLength` declarations — `minLength: 0`, negative or non-integer '
    + 'values on any type, and the key with any value on field types outside '
    + '`BOUNDED_STRING_FIELD_TYPES` (`boolean`, `lookup`, `autonumber`, `formula`, `select`, '
    + '`json`, `secret`, …)',
  replacement: 'a positive-integer `minLength` (>= 1) on a bounded-string field type — `text`, '
    + '`textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code` '
    + '— or no declaration at all ("no minimum" is expressed by OMITTING the key, never by '
    + '`minLength: 0`). Deleting the key is mechanical and behaviour-preserving for a '
    + 'MISPLACED declaration (the write-time validator only ever applied `min_length` inside '
    + 'its bounded-string branch, so the key was inert by construction elsewhere) and for '
    + '`minLength: 0` / negative values anywhere (a string length is never below zero, so the '
    + 'check could not fire). A FRACTIONAL value on a bounded-string type is the judgment '
    + 'case: the validator\'s raw `<` comparison did consume it (`minLength: 2.5` behaved as '
    + '"at least 3"), so only the author knows the integer they MEANT — re-declare it '
    + 'deliberately if the constraint was wanted',
  reason:
    '#11949 (maintainer ruling 2026-08-25): `minLength` carried the exact defect pair #11566 '
    + 'closed for `maxLength`, and converges on the same template. Shape: the key was '
    + '`z.number()`, so `minLength: -5` and `minLength: 2.5` parsed cleanly while describing '
    + 'no character length; it is now `z.number().int().min(1)`. The lower bound is 1 by '
    + 'ruling: `minLength: 0` is refused loudly — a vacuous always-true declaration is '
    + 'exactly the noise an AI metadata author mass-produces, and the refusal surfaces it at '
    + 'authoring time. Applicability: the key sat on the BASE field schema — authorable on '
    + '`boolean` / `lookup` / `autonumber`, types where nothing bounded is stored — while the '
    + 'write-time validator (objectql `record-validator.ts`) only ever enforced it on the '
    + 'bounded-string set; the schema now refuses it outside `BOUNDED_STRING_FIELD_TYPES` '
    + '(ADR-0078 declared=enforced), and both authoring forms (`field.form.ts`, previously 3 '
    + 'types; `object.form.ts`, previously 9) show the key for exactly that set.',
  acceptanceCriteria:
    'Every field declaring `minLength` carries a positive integer and is a bounded-string '
    + 'type. Well-formed declarations (a positive-integer `minLength` on a bounded-string '
    + 'type) parse byte-identically to before; fields declaring no `minLength` are untouched, '
    + 'and absence stays absence — no default materializes. Deleting a misplaced key or a '
    + '`0`/negative value changes no runtime behaviour (misplaced keys sat outside the '
    + 'validator\'s bounded-string branch; a `0`/negative bound could never fire). Deleting a '
    + 'fractional value on a bounded-string type relaxes the write seam by up to one '
    + 'character — the author decides whether to delete or re-declare the integer they '
    + 'meant; a wanted minimum is re-declared as a positive integer and enforced by the '
    + 'write-time validator from the next write on.',
};
