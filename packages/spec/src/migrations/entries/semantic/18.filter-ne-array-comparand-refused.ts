// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Ruling A on #19886, item 1: the $ne slot's half of the question
// filter-equality-array-comparand-refused answered for equality. One entry for
// both named positions — the shared comparand-shape face every query crosses,
// and the $ne operator slot of FieldOperatorsSchema — because the ruling gives
// them one remedy text and the two land together. The formula evaluator and
// driver-mongodb faces landed earlier under their own entries
// (rls-predicate-array-comparand-refused, cel-predicate-list-comparand-refused).
export const entry: SemanticMigration = {
  id: 'filter-ne-array-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.FilterCondition and the $ne slot of data.FieldOperators — an ARRAY as the comparand of '
    + '$ne. At the runtime filter doors (the shared comparand-shape face that parseFilterAST and '
    + 'the engine lowering seam both run): { field: { $ne: [...] } }, which the FilterArray sugar '
    + '["field", "ne", [...]] lowers to, and likewise "!=", "<>", "neq", "not_equals" and '
    + '"notequals", at any depth under $and / $or / $not, the empty array included. At parse: '
    + 'FieldOperatorsSchema.$ne, its documentation copy EqualityOperatorSchema.$ne, and the '
    + 'NormalizedFilter AST that validates against it',
  replacement:
    'the declared list-negation operator. "None of these values" is $nin: '
    + '{ field: { $nin: ["a", "b"] } } (authoring spellings "nin", "not_in", "notin"). A filter '
    + 'that meant a single value writes that value: { field: { $ne: "a" } }. $ne: null (the '
    + 'has-a-value predicate), every scalar, a Date and a { $field } reference are untouched, and '
    + 'the list operators ($in / $nin / $between) keep their arrays, empty lists included',
  reason:
    'Ruled on 2026-09-24 by the director seat, on the standing contract text (option A): '
    + 'the shared comparand-shape face refuses an array under $ne for every driver, and '
    + 'FieldOperatorsSchema.$ne refuses it at parse, with one remedy text naming the declared list-negation operator by its '
    + 'spec spelling — no alias, no window. The governing text is $ne\'s own published describe: '
    + 'the comparand is a literal, or a { $field } reference to another column of the same table. '
    + 'An array is neither, so the refusal pulls the doors back to what $ne already declared. '
    + 'Measured on the card before any stage landed, on the lowered { tags: { $ne: ["a"] } }: '
    + 'driver-sql and driver-memory REFUSED it with 400; driver-mongodb ANSWERED it as MongoDB '
    + 'reads $ne against an array operand, not equal to that array and not holding it as an '
    + 'element, which is every scalar row (mingo, the named proxy; a live mongod was NOT '
    + 'measured); and the formula evaluator matched EVERY row, which on the row-level write check '
    + 'admitted every write a != policy against a list was written to refuse. Those two answering '
    + 'faces were closed first, each at its own face, under rls-predicate-array-comparand-refused '
    + 'and cel-predicate-list-comparand-refused. Measured on origin/main 9e7824a4, after both and '
    + 'before this change: the shared face passed the shape at every depth (so did its '
    + 'FilterArray lowering, and the engine\'s delegating wrapper), and FieldOperatorsSchema, '
    + 'EqualityOperatorSchema and the NormalizedFilter AST all parsed it GREEN. Now the face '
    + 'refuses it with INVALID_FILTER / 400 before any driver runs, and the operator slot refuses '
    + 'it on parse, with one sentence from one builder: the face names the field and appends the '
    + 'location (at where.tags.$ne); the slot cannot see either, and its issue carries the '
    + 'location as its path. On the SQL family and driver-memory the verdict does not move (400 '
    + 'before, 400 after); the text and the moment move, to the face, before any driver. ⚠️ Not '
    + 'moved by this entry: FilterConditionSchema, the schema every stored filter carrier parses '
    + 'through (dataset, dashboard widget, report, rollup and the rest), does not parse a field\'s '
    + 'operator map through FieldOperatorsSchema and its own walk does not judge $ne, so such a '
    + 'carrier still SAVES a $ne list and the face refuses it at query time; the ruling names the '
    + 'face and the operator slot, not that walk. Metadata AT REST is not rewritten and this entry '
    + 'adds no D2 conversion: a list under $ne has no single honest value, and whether it meant '
    + 'none of these values or one value is the author\'s call. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep stored filters, dataset and widget filters, flow node filters and code that builds a '
    + 'where for $ne whose comparand is an array — { field: { $ne: [...] } }, or a FilterArray '
    + 'triple on ne, !=, <>, neq, not_equals or notequals carrying an array — then decide per '
    + 'filter what it meant: none of these values ($nin), or one value ($ne with that value). Each '
    + 'is refused at query time with INVALID_FILTER / 400 naming the field, the path and $nin, so '
    + 'a test suite that exercises the query finds every one; code that parses a filter with '
    + 'FieldOperatorsSchema or the NormalizedFilter AST is refused on parse at the $ne path. ⛔ A '
    + 'clean re-save of a stored carrier is NOT a sweep: the carrier schema does not refuse the '
    + 'shape, so exercise each stored filter or grep it. On driver-mongodb re-check what the query '
    + 'is supposed to return rather than assuming the old rows were right: the old answer was '
    + 'MongoDB array inequality, which $nin does not reproduce.',
};
