// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25281] The stored-shape listing and the refusing door name ONE set.
 *
 * `os migrate meta --stored` lists a stored page or view whose `visibleWhen`
 * hands `has()` an argument that is not a field selection, under the D3 entry
 * `visibility-predicate-has-argument-refused`. The listing lives in
 * `@objectstack/spec`, which cannot parse CEL, so it reads the source on its
 * own (`conversions/cel-has-argument.ts`). The refusal is this package's
 * `visibility-predicate-has-argument`, whose verdict is the engine's AST. This
 * file holds the two equal over every shape the engine was measured on: a
 * predicate is listed exactly when the door refuses it under that id, and the
 * door refuses exactly what `celEngine.compile` refuses as `has() invalid
 * argument`.
 */
import { describe, expect, it } from 'vitest';
import { applyConversionsToStoredItem, type ConversionTodoNotice } from '@objectstack/spec';
import { celEngine } from '@objectstack/formula';

import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { VISIBILITY_PREDICATE_HAS_ARGUMENT } from './validate-visibility-predicates.js';

const ENTRY_ID = 'visibility-predicate-has-argument-refused';

const page = (visibleWhen: string) => ({
  name: 'pipeline_home',
  label: 'Pipeline',
  type: 'app',
  regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Pipeline' }, visibleWhen }] }],
});

/** Does the stored pass list this page under the entry? */
function listed(visibleWhen: string): boolean {
  const todos: ConversionTodoNotice[] = [];
  applyConversionsToStoredItem('page', page(visibleWhen), { onTodo: (t) => todos.push(t) });
  return todos.some((t) => t.conversionId === ENTRY_ID);
}

/** Does the page save door refuse it under the rule? */
function refusedAtDoor(visibleWhen: string): boolean {
  const result = runRuntimeAuthoringRules({ type: 'page', item: page(visibleWhen), context: { objects: [] } });
  return result.errors.some((f) => f.rule === VISIBILITY_PREDICATE_HAS_ARGUMENT);
}

function engineRefuses(visibleWhen: string): boolean {
  const compiled = celEngine.compile(visibleWhen);
  return !compiled.ok && compiled.error.message.split('\n')[0].trim() === 'has() invalid argument';
}

const REFUSED = [
  'has(status)',
  'has(record)',
  'has(record.items[0])',
  "has(record['k'])",
  'has(record.items[size(record.items) - 1])',
  'has(record.?a)',
  'has(record.a.?b)',
  'has(1)',
  "has('x')",
  'has(true)',
  'has(record.x.size())',
  'has(upper(record.x))',
  'has(-record.a)',
  'has(record.a == 1)',
  'has(record.a ? record.b : record.c)',
  'has(record.x) || has(record.items[0])',
  'record.items.exists(i, has(i))',
  'has (record)',
];

const ACCEPTED = [
  'has(record.a)',
  'has(record.a.b.c.d)',
  'has((record.a))',
  'has(record.items[0].x)',
  "has(record['a'].b)",
  'has(dyn(record).a)',
  'has(record.a.?b.c)',
  'record.items.exists(i, has(i.x))',
  "has(record.a) && record.a != ''",
  "record.note == 'has(x)'",
  'record.tags.has(record.a)',
];

describe('#25281 — the stored listing, the save door and the engine agree on `has()` arguments', () => {
  it.each(REFUSED)('%s — the engine refuses it, the door refuses it, the stored pass lists it', (predicate) => {
    expect(engineRefuses(predicate), 'engine').toBe(true);
    expect(refusedAtDoor(predicate), 'door').toBe(true);
    expect(listed(predicate), 'listing').toBe(true);
  });

  it.each(ACCEPTED)('%s — none of the three refuses or lists it', (predicate) => {
    expect(engineRefuses(predicate), 'engine').toBe(false);
    expect(refusedAtDoor(predicate), 'door').toBe(false);
    expect(listed(predicate), 'listing').toBe(false);
  });
});
