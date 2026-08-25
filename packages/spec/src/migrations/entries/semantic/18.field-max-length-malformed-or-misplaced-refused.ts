// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-max-length-malformed-or-misplaced-refused',
  surface: 'object field `maxLength` declarations — `maxLength: 0`, negative or non-integer '
    + 'values on any type, and the key with any value on field types outside '
    + '`BOUNDED_STRING_FIELD_TYPES` (`boolean`, `lookup`, `autonumber`, `formula`, `select`, '
    + '`json`, `secret`, …)',
  replacement: 'a positive-integer `maxLength` (>= 1) on a bounded-string field type — `text`, '
    + '`textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, '
    + 'plus `signature`/`qrcode` since #11875 (the set is `BOUNDED_STRING_FIELD_TYPES`; the '
    + '#11566 narrowing itself landed on the ten-member set of its day) '
    + '— or no declaration at all. Deleting the key is mechanical and behaviour-preserving '
    + 'for a MISPLACED declaration: the write-time validator only ever applied `max_length` '
    + 'inside its bounded-string branch, so the key was inert by construction on every other '
    + 'type. A MALFORMED value on a bounded-string type is the judgment case — the '
    + 'validator\'s raw `>` comparison did consume it (`maxLength: 0` accepted only the '
    + 'empty string, a negative value refused every write, `maxLength: 12.5` behaved as '
    + '"at most 12"), and the SQL schema-drift planner consumed `maxLength: 0` as '
    + '`varchar(0)` DDL until #11431 taught it to defend itself — so only the author knows '
    + 'the bound they MEANT: re-declare it as a positive integer, or delete it deliberately '
    + 'accepting the unbounding',
  reason:
    '#11566 (maintainer ruling 2026-08-24; enforcement shipped on the 17.x line in PR '
    + '#11989 — accept-set narrowings ride minors, and this entry tells `migrate meta` users '
    + 'at the major boundary; registration was deferred to #11950 because the registry file '
    + 'was serialized behind an in-flight change when the enforcement landed). Shape: a '
    + 'character length is a positive integer, so the key tightened from `z.number()` to '
    + '`z.number().int().min(1)` — `maxLength: 0` measurably sent schema-drift planning '
    + '`varchar(0)` DDL no server accepts, at severity error/destructive, before #11431 '
    + 'taught that consumer to defend itself (the #8321 `precision`/`scale` house pattern). '
    + 'Applicability: the key sat on the BASE field schema — authorable on `boolean` / '
    + '`lookup` / `autonumber`, types where nothing bounded is stored — while the write-time '
    + 'validator (objectql `record-validator.ts`) only ever enforced it on its ten '
    + 'bounded-string types, the one list of the three that had a measured reader; that list '
    + 'is promoted to the protocol as `BOUNDED_STRING_FIELD_TYPES`, the schema refuses the '
    + 'key outside it (ADR-0078 declared=enforced), and both authoring forms '
    + '(`field.form.ts`, previously 3 types; `object.form.ts`, previously 9) show the key '
    + 'for exactly that set.',
  acceptanceCriteria:
    'Every field declaring `maxLength` carries a positive integer and is a bounded-string '
    + 'type. Well-formed declarations (a positive-integer `maxLength` on a bounded-string '
    + 'type) parse byte-identically to before; fields declaring no `maxLength` are '
    + 'untouched, and absence stays absence — no default materializes. Deleting a misplaced '
    + 'key changes no runtime behaviour (it sat outside the validator\'s bounded-string '
    + 'branch and enforced nothing). For a malformed value on a bounded-string type the '
    + 'author decides: re-declare the intended positive-integer bound (enforced by the '
    + 'write-time validator from the next write on, and honoured by schema drift as '
    + '`varchar(n)`), or delete the key and accept the type\'s unbounded/default column '
    + 'shape — either way the accidental old behaviour (empty-only writes under '
    + '`maxLength: 0`, unwritable fields under a negative value) is gone by decision, not '
    + 'by silence.',
};
