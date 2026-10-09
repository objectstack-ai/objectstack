// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #11509 (v18, ruling A-narrow) — the D3 entry of the
// `element-flat-data-binding-to-data-source` family: one entry for the ten
// keys, because they are one retirement (the element layer's second data door)
// and an upgrader moves them together. It absorbs the two protocol-18
// narrowings of the element flat `filter` to the rule array
// (`element-number-filter-rule-array`, `element-record-picker-filter-rule-array`):
// the key they narrowed is gone in the same major, and the rule array they
// prescribed is the binding's own form. The conversion follows each element's
// old rule, so what it cannot follow is listed as a TODO and judged here.
export const entry: SemanticMigration = {
  id: 'element-flat-data-binding-retired',
  surface:
    'page.component properties of element:record_picker (object, filter, sort, limit), '
    + 'element:number (object, filter) and element:repeater (object, filter, sort, limit) — the flat '
    + 'data-binding keys beside the node-level dataSource',
  replacement:
    '`dataSource` on the component node — `{ object, view?, filter?, sort?, limit? }`, a sibling of '
    + '`type` rather than a key inside `properties` — the one binding each of the three elements reads. '
    + 'Each key moves unchanged: `properties: { object: \'deal\', limit: 20 }` becomes '
    + '`dataSource: { object: \'deal\', limit: 20 }`, and a filter keeps its rule-array form '
    + '`[{ field, operator, value }, ...]`. `element:number` reads `object` and `filter` only. With a '
    + '`view`, the view supplies the baseline, an explicit binding key overrides it, and the binding '
    + 'filter AND-combines with the view\'s.',
  reason:
    'One node carried two doors onto one query, resolved by three different rules: the record picker '
    + 'let the binding win (its flat key was read only when the binding, or the saved view the binding '
    + 'named, supplied none), `element:number` resolved `object` binding-first and AND-combined the two '
    + 'filters, and the repeater read its flat keys alone and ignored the binding — while the '
    + 'component-props gate waived a missing flat `object` whenever `dataSource.object` was present, '
    + 'so a repeater bound only through `dataSource` passed validation and drew an empty list. The '
    + 'console moved all three elements onto the binding first, and in v18 the flat keys are '
    + 'refused. The D2 conversion `element-flat-data-binding-to-data-source` follows each element\'s '
    + 'old rule: a key the binding lacks moves there, a key the binding already set is deleted where '
    + 'the binding won, and `element:number`\'s filter is appended to the binding\'s. Three cases are '
    + 'left as stored and listed as TODOs, because only the author can decide them: a record-picker '
    + 'key beside a `dataSource.view` the binding sets no such key of its own for (the flat value '
    + 'applied only if the view supplied none, and no conversion reads the view); a repeater key the '
    + 'binding sets to a DIFFERENT value, or beside a `view` (the repeater never read either, so the '
    + 'list now applies something it did not before); and an `element:number` filter pair that is not '
    + 'two rule arrays. A repeater that carried a `dataSource` its list ignored now applies it — '
    + 'compare it with what the list showed. A flat filter in the retired record form moves to '
    + '`dataSource.filter` and is then converted there by `page-component-filter-record-to-rule-array` '
    + 'wherever the mapping is lossless; that entry lists the rest. Code that builds these props — a '
    + 'host, a generator, a designer — must write the binding, which no conversion reaches. And the '
    + 'gate now requires `dataSource.object` on all three elements: a node with none names no object '
    + 'and is reported.',
  acceptanceCriteria:
    'No `element:record_picker`, `element:number` or `element:repeater` node carries `object`, '
    + '`filter`, `sort` or `limit` inside `properties`; the parse refuses each. Every such node has '
    + '`dataSource.object`, and `os validate` reports no missing-binding finding for it. In the running '
    + 'page each picker offers, each number aggregates and each repeater lists the records the author '
    + 'intends — checked first on every node the migration listed as a TODO, and on every repeater '
    + 'that already carried a `dataSource`.',
  conversionIds: ['element-flat-data-binding-to-data-source'],
};
