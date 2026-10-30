// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FLOW_NODE_EXPRESSION_PATHS` — the `value` role and the `assignment` entry
 * (#14149, maintainer ruling 2026-09-02: option A, the rendering half).
 *
 * The ledger's two consumers (`service-automation`'s `registerFlow` pass and
 * `@objectstack/lint`) and its reconciliation ratchet live outside this
 * package; what THIS file pins is the contract they read: the entry exists
 * with the ruled role, the `*` wildcard resolves each authored variable's
 * value, only the envelope form is emitted for the `value` role, and every
 * entry that existed before resolves byte-identically (the fixtures under
 * "unchanged" are the ratchet's own cases, restated here so a resolver edit
 * that moves them fails where the edit is made).
 */

import { describe, expect, it } from 'vitest';

import {
  FLOW_NODE_EXPRESSION_PATHS,
  FLOW_NODE_SIBLING_EXPRESSION_BLOCKS,
  flowFilterOperands,
  flowNodeExpressionBlock,
  isExpressionEnvelopeShaped,
  resolveFlowNodeExpressions,
  resolveFlowNodeValueSlots,
  predicateSlotRefusal,
  PREDICATE_SLOT_STRING_REFUSAL,
  structuralConditionRefusal,
  STRUCTURAL_CONDITION_SHAPE_REFUSAL,
  type FlowNodeExpressionPath,
  type FlowNodeExpressionRole,
} from './flow-node-expression-paths.js';
import { getBuiltinNodeConfigContracts } from './flow-node-config-refusals.js';

/** The ruling's example — the declared stdlib, reachable from metadata. */
const DIGEST_SOURCE = 'joinNonEmpty(overdue_tasks.map(t, t.subject), "\\n")';
const DIGEST_ENVELOPE = { dialect: 'cel', source: DIGEST_SOURCE };

/** A two-variable assignment: one `{token}` interpolation, one CEL value envelope. */
const TWO_VARIABLE_ASSIGNMENT = {
  assignments: {
    owner_name: '{manager.name}',
    digest: DIGEST_ENVELOPE,
  },
};

describe('FLOW_NODE_EXPRESSION_PATHS — the assignment value entry', () => {
  const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === 'assignment');

  it('declares exactly one slot for `assignment`: `assignments.*`, role `value`', () => {
    expect(entry, 'the ruled entry: an assignment value may be a CEL envelope').toBeDefined();
    expect(entry!.path).toBe('assignments.*');
    expect(entry!.role).toBe('value');
    expect(entry!.label).toBe('assignment value');
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === 'assignment')).toHaveLength(1);
  });

  // [#19939] RE-JUDGED IN PLACE: the union carried `flow-template` too, the
  // single-brace role whose two slots (`loop` / `map` `collection`) became
  // value slots in stage S3. The role went with them.
  it('the role union carries `value` beside `predicate`, and nothing else', () => {
    // A type-level pin: the union is what downstream consumers switch on.
    const roles: FlowNodeExpressionRole[] = ['predicate', 'value'];
    expect(new Set(FLOW_NODE_EXPRESSION_PATHS.map((e) => e.role))).toEqual(new Set(roles));
    // @ts-expect-error — the single-brace role is gone from the union (#19939).
    const retired: FlowNodeExpressionRole = 'flow-template';
    expect(roles).not.toContain(retired);
  });

  it('resolves the envelope value of a two-variable assignment, and only it', () => {
    const found = resolveFlowNodeExpressions('assignment', TWO_VARIABLE_ASSIGNMENT);
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe('assignments.digest');
    expect(found[0]!.entry).toBe(entry);
    expect(found[0]!.entry.role).toBe('value');
    // The value is handed over verbatim — the envelope, not its source — so a
    // consumer can pass it straight to `validateExpression('value', envelope)`.
    expect(found[0]!.value).toBe(DIGEST_ENVELOPE);
    expect((found[0]!.value as { source: string }).source).toContain('joinNonEmpty(');
  });

  it('a `{token}` string in a value slot is interpolation, not an expression — skipped', () => {
    expect(resolveFlowNodeExpressions('assignment', { assignments: { owner_name: '{manager.name}' } })).toEqual([]);
    // Bare CEL as a STRING is not CEL here either: a plain string has always
    // meant flow interpolation in this slot, and the envelope is the only CEL
    // spelling — so `'a + b'` is the literal text `a + b`, and not resolved.
    expect(resolveFlowNodeExpressions('assignment', { assignments: { sum: 'a + b' } })).toEqual([]);
  });

  it('literals that are not envelope-shaped are data, not expressions', () => {
    expect(resolveFlowNodeExpressions('assignment', {
      assignments: { n: 1, ok: true, nothing: null, list: [1, 2], obj: { source: 'x' } },
    })).toEqual([]);
  });

  it('a MALFORMED envelope is still resolved — so the validator refuses it instead of the store keeping it', () => {
    const found = resolveFlowNodeExpressions('assignment', { assignments: { digest: { dialect: 'cel' } } });
    expect(found.map((f) => f.path)).toEqual(['assignments.digest']);
    expect(found[0]!.value).toEqual({ dialect: 'cel' });
  });

  it('resolves every authored key of the map, in authoring order, with concrete paths', () => {
    const found = resolveFlowNodeExpressions('assignment', {
      assignments: {
        a: { dialect: 'cel', source: '1' },
        b: '{x}',
        c: { dialect: 'cel', source: '2' },
      },
    });
    expect(found.map((f) => f.path)).toEqual(['assignments.a', 'assignments.c']);
  });

  it('the legacy shapes are not declared: bare config keys and the array form resolve nothing', () => {
    // Bare `{ <variable>: <value> }` — envelope-shaped or not, these are the
    // literal values they always were; the ledger declares the canonical map.
    expect(resolveFlowNodeExpressions('assignment', { digest: DIGEST_ENVELOPE })).toEqual([]);
    // `assignments: [{ variable, value }]` — `*` over an array is not a map of
    // authored keys and must not invent index paths.
    expect(resolveFlowNodeExpressions('assignment', {
      assignments: [{ variable: 'digest', value: DIGEST_ENVELOPE }],
    })).toEqual([]);
    // The ratchet's own pin, kept true: `config.condition` is structural.
    expect(resolveFlowNodeExpressions('assignment', { condition: 'a == b' })).toEqual([]);
  });

  it('a wildcard against a non-object resolves nothing rather than throwing', () => {
    expect(resolveFlowNodeExpressions('assignment', {})).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', { assignments: 'nope' })).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', { assignments: null })).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', { assignments: 42 })).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', null)).toEqual([]);
  });
});

/**
 * #19938 (the contract half of #11182 ruling D) — `create_record` /
 * `update_record` `fields.*` is a `value` slot, the same shape and dialect
 * rules as `assignments.*`: only an envelope-shaped TOP-LEVEL field value is
 * an expression, a `{token}` string keeps its 17.x meaning and is not
 * resolved, and every other literal is data.
 */
describe('FLOW_NODE_EXPRESSION_PATHS — the CRUD `fields.*` value entries', () => {
  const PRICE_ENVELOPE = { dialect: 'cel', source: 'round(price * 100) / 100.0' };

  // [#19939, stage S6] RE-JUDGED IN PLACE: `update_record` declared `fields.*`
  // alone; since S6 its `filter` operands are a value slot too (the filter
  // entries below), so `fields.*` is its first entry, not its only one.
  it.each(['create_record', 'update_record'] as const)('declares `fields.*` for `%s`, role `value`, and beside it only a filter-operand entry', (nodeType) => {
    const entries = FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === nodeType);
    expect(entries.map((e) => e.path)).toEqual(nodeType === 'create_record' ? ['fields.*'] : ['fields.*', 'filter']);
    expect(entries[0]!.path).toBe('fields.*');
    expect(entries[0]!.role).toBe('value');
    expect(entries[0]!.label).toBe(`${nodeType} field value`);
  });

  it.each(['create_record', 'update_record'] as const)('%s: resolves the envelope field value, and only it, at the author\'s field name', (nodeType) => {
    const found = resolveFlowNodeExpressions(nodeType, {
      objectName: 'quote',
      filter: { id: '{quoteId}' },
      fields: {
        subject: 'Quote for {account.name}',   // `{token}` text — interpolation, not resolved
        owner: '{$User.Id}',
        discount: 10,
        total: PRICE_ENVELOPE,
        broken: { dialect: 'cel' },             // malformed — resolved so a validator refuses it
      },
    });
    expect(found.map((f) => f.path)).toEqual(['fields.total', 'fields.broken']);
    expect(found[0]!.value).toBe(PRICE_ENVELOPE);
    expect(found.every((f) => f.entry.role === 'value' && f.entry.nodeType === nodeType)).toBe(true);
  });

  it('only the TOP-LEVEL field value is judged — an envelope nested in a JSON value, or in an array, is data', () => {
    expect(resolveFlowNodeExpressions('create_record', {
      fields: {
        payload: { nested: { dialect: 'cel', source: 'x' } },
        tags: [{ dialect: 'cel', source: 'x' }],
        decoy: { dialect: 7, source: 'x' },
      },
    })).toEqual([]);
  });

  // [#19939, stage S6] RE-JUDGED IN PLACE, both: these pinned a CRUD
  // `filter` as no value slot, an envelope-shaped filter value resolving
  // nothing. Each filter OPERAND is a value slot since S6, so the envelope
  // operand resolves at its own path; `get_record`'s `fields` projection stays
  // no slot.
  it('`update_record.filter`: an envelope operand resolves at its own path', () => {
    expect(resolveFlowNodeExpressions('update_record', { filter: { total: PRICE_ENVELOPE } })
      .map((f) => [f.path, f.entry.label])).toEqual([['filter.total', 'update_record filter operand']]);
  });

  it('`get_record` / `delete_record`: an envelope filter operand resolves; the `fields` projection does not', () => {
    expect(resolveFlowNodeExpressions('get_record', { fields: ['id'], filter: { total: PRICE_ENVELOPE } })
      .map((f) => [f.path, f.entry.label])).toEqual([['filter.total', 'get_record filter operand']]);
    expect(resolveFlowNodeExpressions('delete_record', { filter: { total: PRICE_ENVELOPE } })
      .map((f) => [f.path, f.entry.label])).toEqual([['filter.total', 'delete_record filter operand']]);
  });

  it('a `fields` that is not a plain object resolves nothing rather than throwing', () => {
    expect(resolveFlowNodeExpressions('create_record', { fields: [PRICE_ENVELOPE] })).toEqual([]);
    expect(resolveFlowNodeExpressions('create_record', { fields: 'nope' })).toEqual([]);
    expect(resolveFlowNodeExpressions('create_record', { fields: null })).toEqual([]);
    expect(resolveFlowNodeExpressions('create_record', {})).toEqual([]);
  });
});

/**
 * #19939 (stage S1 of the rider positions) — the three maps a node hands to a
 * CALLEE are `value` slots: `subflow.input.*`, `map.input.*` and
 * `script.inputs.*`. Same shape rule as the other value maps: an
 * envelope-shaped TOP-LEVEL value is an expression, every other value is a
 * literal. `map.collection` is a value slot too since S3 (below).
 */
describe('FLOW_NODE_EXPRESSION_PATHS — the callee input maps (#19939)', () => {
  const LIST_ENVELOPE = { dialect: 'cel', source: 'rows' };
  const CALLEE_MAPS = [
    ['subflow', 'input', 'subflow input value'],
    ['map', 'input', 'map item input value'],
    ['script', 'inputs', 'script input value'],
  ] as const;

  it.each(CALLEE_MAPS)('declares `%s.%s.*` as a `value` slot', (nodeType, key, label) => {
    // `map.collection` is a value slot too since S3 — this pins the input map's own entry.
    const entries = FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === nodeType && e.role === 'value' && e.path !== 'collection');
    expect(entries.map((e) => [e.path, e.label])).toEqual([[`${key}.*`, label]]);
  });

  it.each(CALLEE_MAPS)('%s: resolves the envelope value, and only it, at the author\'s key', (nodeType, key) => {
    const found = resolveFlowNodeExpressions(nodeType, {
      [key]: { rows: LIST_ENVELOPE, text: 'plain', n: 1, broken: { dialect: 'cel' }, nested: { e: LIST_ENVELOPE } },
    }).filter((f) => f.entry.role === 'value');
    expect(found.map((f) => f.path)).toEqual([`${key}.rows`, `${key}.broken`]);
    expect(found[0]!.value).toBe(LIST_ENVELOPE);
  });

  it.each(CALLEE_MAPS)('%s: hands every authored value to the value-slot judge, strings included', (nodeType, key) => {
    expect(resolveFlowNodeValueSlots(nodeType, { [key]: { a: '{x}', b: LIST_ENVELOPE, c: null } })
      .map((f) => [f.path, f.value])).toEqual([[`${key}.a`, '{x}'], [`${key}.b`, LIST_ENVELOPE], [`${key}.c`, null]]);
  });

  // [#19939] RE-JUDGED IN PLACE: `map.collection` stayed a `flow-template`
  // slot beside `map.input` until stage S3 made it a value slot; the two
  // entries still resolve independently.
  it('`map.collection` resolves beside `map.input`, each its own value entry', () => {
    expect(resolveFlowNodeExpressions('map', { collection: LIST_ENVELOPE, input: { a: LIST_ENVELOPE } })
      .map((f) => [f.path, f.entry.label])).toEqual([['collection', 'map collection'], ['input.a', 'map item input value']]);
  });
});

/**
 * #19939 (stage S3) — the list a `loop` (with a `body`) and a `map` iterate is
 * a `value` slot: `loop.collection` and `map.collection`. Same shape rule as
 * every value slot: an envelope-shaped value is an expression, every other
 * value is a literal — a list, or a string the value-slot judge and the
 * contract refuse. A body-less `loop` is the legacy flat-graph form, which
 * reads `collection` as a bare variable name: neither walk reaches it.
 */
describe('FLOW_NODE_EXPRESSION_PATHS — the loop and map collection (#19939)', () => {
  const LIST_ENVELOPE = { dialect: 'cel', source: 'rows' };
  const BODY = { nodes: [{ id: 'b', type: 'noop', label: 'B' }], edges: [] };

  it.each([['loop', 'loop collection'], ['map', 'map collection']] as const)(
    'declares `%s.collection` as a `value` slot', (nodeType, label) => {
      const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === nodeType && e.path === 'collection');
      expect(entry).toBeDefined();
      expect([entry!.role, entry!.label]).toEqual(['value', label]);
    },
  );

  it('reads `loop.collection` only with a `body` — the contract map\'s `parsedWhen`, stated in the ledger', () => {
    const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === 'loop' && e.path === 'collection')!;
    expect(entry.onlyWithKey).toBe('body');
    // No other entry carries the condition: every other slot is read whenever it is there.
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.onlyWithKey !== undefined)).toEqual([entry]);
    // The structured form: both walks reach it.
    expect(resolveFlowNodeExpressions('loop', { collection: LIST_ENVELOPE, body: BODY }).map((f) => f.path))
      .toEqual(['collection']);
    expect(resolveFlowNodeValueSlots('loop', { collection: '{rows}', body: BODY }).map((f) => [f.path, f.value]))
      .toEqual([['collection', '{rows}']]);
    // The legacy flat-graph form (no `body`, or a `null` one): neither does.
    for (const legacy of [{ collection: LIST_ENVELOPE }, { collection: 'rows', body: null }]) {
      expect(resolveFlowNodeExpressions('loop', legacy)).toEqual([]);
      expect(resolveFlowNodeValueSlots('loop', legacy)).toEqual([]);
    }
  });

  it('`map.collection` is read on every `map`', () => {
    expect(resolveFlowNodeValueSlots('map', { collection: 'rows' }).map((f) => [f.path, f.value]))
      .toEqual([['collection', 'rows']]);
  });

  it('agrees with the contract map\'s `parsedWhen` for `loop`, over configs with and without a body', () => {
    const parsedWhen = getBuiltinNodeConfigContracts().get('loop')!.parsedWhen!;
    const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === 'loop' && e.path === 'collection')!;
    for (const config of [{ body: BODY }, { body: null }, {}, { body: {} }, { body: 'x' }]) {
      const read = resolveFlowNodeValueSlots('loop', { ...config, collection: 'rows' }).length > 0;
      expect(read, JSON.stringify(config)).toBe(parsedWhen(config));
      expect((config as Record<string, unknown>)[entry.onlyWithKey!] != null).toBe(parsedWhen(config));
    }
  });
});

/**
 * #19939 (stage S4) — a `notify` node's computed values are `value` slots:
 * `recipients`, `templateData.*` and `sourceId`. `recipients` holds one value
 * or a list of them, so it carries `eachElement`: each element of a list is a
 * value of its own, at its index. `sourceObject`, `actorId` and `payload` are
 * literals, read as written — no flow computed one, so the ledger declares no
 * slot there.
 */
describe('FLOW_NODE_EXPRESSION_PATHS — a notify node\'s value slots (#19939)', () => {
  const ENVELOPE = { dialect: 'cel', source: 'record.owner' };

  it('declares the three notify computed values as `value` slots, and only `recipients` reads each element', () => {
    const notify = FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === 'notify');
    expect(notify.map((e) => [e.path, e.role, e.label])).toEqual([
      ['recipients', 'value', 'notify recipient'],
      ['templateData.*', 'value', 'notify templateData value'],
      ['sourceId', 'value', 'notify sourceId'],
    ]);
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.eachElement).map((e) => `${e.nodeType}.${e.path}`))
      .toEqual(['notify.recipients']);
  });

  it('`recipients`: a list is read element by element, at each index; any other value at the slot itself', () => {
    expect(resolveFlowNodeValueSlots('notify', { recipients: ['u1', ENVELOPE, '{x}'] }).map((f) => [f.path, f.value]))
      .toEqual([['recipients[0]', 'u1'], ['recipients[1]', ENVELOPE], ['recipients[2]', '{x}']]);
    expect(resolveFlowNodeValueSlots('notify', { recipients: '{x}' }).map((f) => [f.path, f.value]))
      .toEqual([['recipients', '{x}']]);
    // The expression walk emits the envelopes only — an entry's at its index.
    expect(resolveFlowNodeExpressions('notify', { recipients: ['u1', ENVELOPE] }).map((f) => [f.path, f.value]))
      .toEqual([['recipients[1]', ENVELOPE]]);
    expect(resolveFlowNodeExpressions('notify', { recipients: ENVELOPE }).map((f) => f.path)).toEqual(['recipients']);
    expect(resolveFlowNodeValueSlots('notify', { recipients: [] })).toEqual([]);
  });

  it('the map is read per key, the single values at their key; the literals are no slot', () => {
    const config = {
      recipients: 'u1', templateData: { a: ENVELOPE }, payload: { b: ENVELOPE },
      sourceObject: 'o', sourceId: ENVELOPE, actorId: 'u2', actionUrl: '/x/{{ id }}', topic: '{t}',
    };
    expect(resolveFlowNodeValueSlots('notify', config).map((f) => f.path))
      .toEqual(['recipients', 'templateData.a', 'sourceId']);
    expect(resolveFlowNodeExpressions('notify', config).map((f) => f.path)).toEqual(['templateData.a', 'sourceId']);
  });
});

/**
 * #19939 (stage S5) — an `http` node's `body` is a `value` slot: ONE value,
 * the whole payload. Its `url` and `headers` values are text slots
 * (`flow-text-slot-template.ts`) and its `method`, `durable`, `timeoutMs` and
 * `signingSecret` literals — the ledger declares no slot at any of them.
 */
describe('FLOW_NODE_EXPRESSION_PATHS — an http node\'s body (#19939)', () => {
  const ENVELOPE = { dialect: 'cel', source: "{'id': record.id}" };

  it('declares the body as the one `value` slot of an http node, read as one value', () => {
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === 'http').map((e) => [e.path, e.role, e.label, e.eachElement]))
      .toEqual([['body', 'value', 'http body', undefined]]);
  });

  it('reads the body whole — an envelope, a literal map or a list — and nothing else of the config', () => {
    const config = {
      url: '/x/{{ id }}', headers: { 'X-Ref': '{{ id }}' }, method: 'POST', durable: true, timeoutMs: 5, signingSecret: 's',
    };
    expect(resolveFlowNodeValueSlots('http', { ...config, body: ENVELOPE }).map((f) => [f.path, f.value]))
      .toEqual([['body', ENVELOPE]]);
    expect(resolveFlowNodeExpressions('http', { ...config, body: ENVELOPE }).map((f) => f.path)).toEqual(['body']);
    // A literal is emitted for the template judge, never for the expression check.
    expect(resolveFlowNodeValueSlots('http', { ...config, body: ['a', '{x}'] }).map((f) => [f.path, f.value]))
      .toEqual([['body', ['a', '{x}']]]);
    expect(resolveFlowNodeExpressions('http', { ...config, body: { id: '{x}' } })).toEqual([]);
    expect(resolveFlowNodeValueSlots('http', config)).toEqual([]);
  });
});

/**
 * #19939 (stage S2) — a `screen`'s three positions that hand a value to the
 * client are `value` slots: an object form's `defaults.*`, a field's
 * `defaultValue` (under the `fields[]` repeater) and an object form's
 * `recordId` (a single value). `fields[].visibleWhen` keeps its `predicate`
 * entry beside them.
 */
describe('FLOW_NODE_EXPRESSION_PATHS — a screen\'s value slots (#19939)', () => {
  const ENVELOPE = { dialect: 'cel', source: 'rec' };

  it('declares `defaults.*`, `fields[].defaultValue` and `recordId` as `value` slots, after `visibleWhen`', () => {
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === 'screen').map((e) => [e.path, e.role, e.label])).toEqual([
      ['fields[].visibleWhen', 'predicate', 'screen field visibleWhen'],
      ['defaults.*', 'value', 'screen form default'],
      ['fields[].defaultValue', 'value', 'screen field default value'],
      ['recordId', 'value', 'screen record id'],
    ]);
  });

  it('resolves the envelope values, and only them, at each position', () => {
    const found = resolveFlowNodeExpressions('screen', {
      recordId: { dialect: 'cel', source: 'record.id' },
      defaults: { parent: ENVELOPE, stage: 'new', nested: { e: ENVELOPE } },
      fields: [
        { name: 'a', defaultValue: ENVELOPE, visibleWhen: 'x == 1' },
        { name: 'b', defaultValue: 'plain' },
        { name: 'c', defaultValue: { dialect: 'cel' } },
      ],
    });
    expect(found.map((f) => [f.path, f.entry.role])).toEqual([
      ['fields[0].visibleWhen', 'predicate'],
      ['defaults.parent', 'value'],
      ['fields[0].defaultValue', 'value'],
      ['fields[2].defaultValue', 'value'],
      ['recordId', 'value'],
    ]);
  });

  it('hands every authored value to the value-slot judge, strings included — an absent one skipped', () => {
    expect(resolveFlowNodeValueSlots('screen', {
      recordId: '{record.id}',
      defaults: { a: '{x}', b: ENVELOPE, c: null },
      fields: [{ name: 'k', defaultValue: '{y}' }, { name: 'none' }],
    }).map((f) => [f.path, f.value])).toEqual([
      ['defaults.a', '{x}'], ['defaults.b', ENVELOPE], ['defaults.c', null],
      ['fields[0].defaultValue', '{y}'],
      ['recordId', '{record.id}'],
    ]);
  });
});

describe('resolveFlowNodeValueSlots — every authored value of a `value` slot, strings included', () => {
  it('hands over every non-absent value of the CRUD `fields` map and the assignment map, by the ledger\'s own walk', () => {
    const envelope = { dialect: 'cel', source: 'price * 2' };
    expect(resolveFlowNodeValueSlots('create_record', {
      objectName: 'quote',
      fields: { subject: 'Hi {name}', total: envelope, n: 3, nothing: null, gone: undefined },
    }).map((f) => [f.path, f.value, f.entry.path])).toEqual([
      ['fields.subject', 'Hi {name}', 'fields.*'],
      ['fields.total', envelope, 'fields.*'],
      ['fields.n', 3, 'fields.*'],
      ['fields.nothing', null, 'fields.*'],
    ]);
    expect(resolveFlowNodeValueSlots('assignment', { assignments: { total: '{round(x)}' } }).map((f) => f.path))
      .toEqual(['assignments.total']);
  });

  it('reaches ONLY `value` slots — a predicate slot, an undeclared map, a legacy shape: nothing', () => {
    expect(resolveFlowNodeValueSlots('screen', { fields: [{ visibleWhen: 'a == 1' }] })).toEqual([]);
    // [#19939] A body-less `loop` (the legacy flat-graph form): its `collection` is read by no value slot.
    expect(resolveFlowNodeValueSlots('loop', { collection: '{rows}' })).toEqual([]);
    // [#19939, stage S6] RE-JUDGED IN PLACE: an `update_record` filter operand
    // was no value slot and resolved nothing; it is one since S6 (the filter
    // operand block below pins what it resolves), so the undeclared map here
    // is `create_record`'s `filter`, a key that node does not declare.
    expect(resolveFlowNodeValueSlots('create_record', { filter: { id: '{x}' } })).toEqual([]);
    expect(resolveFlowNodeValueSlots('assignment', { digest: '{x}' })).toEqual([]);
    expect(resolveFlowNodeValueSlots('assignment', { assignments: [{ variable: 'd', value: '{x}' }] })).toEqual([]);
    expect(resolveFlowNodeValueSlots('create_record', null)).toEqual([]);
  });

  it('agrees with `resolveFlowNodeExpressions` on the envelope subset — one walk, two views', () => {
    const config = { fields: { a: '{x}', b: { dialect: 'cel', source: '1' }, c: { dialect: 'cel' }, d: 4 } };
    const envelopes = resolveFlowNodeValueSlots('update_record', config).filter((f) => isExpressionEnvelopeShaped(f.value));
    expect(envelopes).toEqual(resolveFlowNodeExpressions('update_record', config));
  });
});

/**
 * [#19939, stage S6] The operands of a CRUD node's `filter` are value slots
 * (Fork R17 → A): `flowFilterOperands` reads the filter the way the filter
 * grammar does, and both walks emit each OPERAND — never the filter's keys,
 * operators, combinators or nested-relation conditions — at its own path.
 */
describe('a CRUD `filter`: each operand is a value slot of its own (#19939, S6)', () => {
  const ENV = { dialect: 'cel', source: 'record.id' };

  it.each(['get_record', 'update_record', 'delete_record'] as const)('%s declares one filter entry, `filterOperands`, role `value`', (nodeType) => {
    const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === nodeType && e.path === 'filter');
    expect(entry).toEqual({
      nodeType, path: 'filter', role: 'value', label: `${nodeType} filter operand`, filterOperands: true,
    });
  });

  it('every operand shape: a field\'s value, an operator\'s comparand, a list comparand\'s elements, combinators, a nested relation', () => {
    const filter = {
      owner: ENV,
      status: 'open',
      amount: { $gt: ENV, $lte: 100 },
      id: { $in: [ENV, 'r2'] },
      due: { $between: ['{yesterday}', ENV] },
      $or: [{ stage: ENV }, { stage: { $ne: null } }],
      $not: { kind: 'x' },
      account: { industry: ENV },
      ref: { $eq: { $field: 'other' } },
    };
    expect(flowFilterOperands(filter).map((o) => [o.path, o.value])).toEqual([
      [['owner'], ENV],
      [['status'], 'open'],
      [['amount', '$gt'], ENV],
      [['amount', '$lte'], 100],
      [['id', '$in', 0], ENV],
      [['id', '$in', 1], 'r2'],
      [['due', '$between', 0], '{yesterday}'],
      [['due', '$between', 1], ENV],
      [['$or', 0, 'stage'], ENV],
      [['$or', 1, 'stage', '$ne'], null],
      [['$not', 'kind'], 'x'],
      [['account', 'industry'], ENV],
      [['ref', '$eq'], { $field: 'other' }],
    ]);
  });

  it('an envelope is ONE operand, which may evaluate to a list; the top-level filter is never one', () => {
    expect(flowFilterOperands({ id: { $in: ENV } }).map((o) => o.path)).toEqual([['id', '$in']]);
    // A filter written as an envelope is a condition on fields named `dialect` and `source`.
    expect(flowFilterOperands(ENV).map((o) => [o.path, o.value])).toEqual([[['dialect'], 'cel'], [['source'], 'record.id']]);
    // A related field named `dialect` is matched through an operator map, never read as an envelope.
    expect(flowFilterOperands({ rel: { dialect: { $eq: 'cel' } } }).map((o) => [o.path, o.value]))
      .toEqual([[['rel', 'dialect', '$eq'], 'cel']]);
  });

  it('a filter that is not a plain object has no operand; a malformed combinator member is handed over as one', () => {
    expect(flowFilterOperands('{x}')).toEqual([]);
    expect(flowFilterOperands(null)).toEqual([]);
    expect(flowFilterOperands([ENV])).toEqual([]);
    expect(flowFilterOperands({ $and: ['{x}'] }).map((o) => [o.path, o.value])).toEqual([[['$and', 0], '{x}']]);
  });

  it('both walks emit the operands at their ledger paths — every value, and the envelope subset', () => {
    const config = { objectName: 'task', filter: { owner: ENV, id: { $in: ['{recordId}', ENV] }, $or: [{ s: 'x' }] } };
    expect(resolveFlowNodeValueSlots('delete_record', config).map((f) => [f.path, f.value])).toEqual([
      ['filter.owner', ENV],
      ['filter.id.$in[0]', '{recordId}'],
      ['filter.id.$in[1]', ENV],
      ['filter.$or[0].s', 'x'],
    ]);
    expect(resolveFlowNodeExpressions('delete_record', config).map((f) => f.path)).toEqual(['filter.owner', 'filter.id.$in[1]']);
  });
});

describe('isExpressionEnvelopeShaped — the recognizer a value slot discriminates on', () => {
  it('is a plain object with a string `dialect`, and nothing else', () => {
    expect(isExpressionEnvelopeShaped({ dialect: 'cel', source: '1' })).toBe(true);
    expect(isExpressionEnvelopeShaped({ dialect: 'cel' })).toBe(true); // malformed, but envelope-SHAPED
    expect(isExpressionEnvelopeShaped({ dialect: 'nope', source: '1' })).toBe(true); // the validator's call
    expect(isExpressionEnvelopeShaped({ dialect: 1, source: '1' })).toBe(false);
    expect(isExpressionEnvelopeShaped({ source: '1' })).toBe(false);
    expect(isExpressionEnvelopeShaped('{ dialect: cel }')).toBe(false);
    expect(isExpressionEnvelopeShaped(['dialect'])).toBe(false);
    expect(isExpressionEnvelopeShaped(null)).toBe(false);
    expect(isExpressionEnvelopeShaped(undefined)).toBe(false);
  });
});

describe('every entry older than the value role resolves byte-identically (the ratchet\'s fixtures, restated)', () => {
  const byKey = (e: FlowNodeExpressionPath) =>
    `${e.nodeType}.${e.block === undefined ? '' : `${e.block}.`}${e.path} (${e.role})`;

  it('the entries that existed before are still declared exactly as they were — each value-slot widening only appended rows', () => {
    // The census: five rows before #19938, seven after, ten after #19939's
    // callee maps, thirteen after its screen trio. Each widening appended its
    // `value` rows at the end — the CRUD write map's two, then `subflow.input`,
    // `map.input` and `script.inputs`, then the screen's `defaults.*`,
    // `fields[].defaultValue` and `recordId` — and every row above them is
    // byte-identical to what it was, with one exception: #19939's stage S3
    // moved `loop.collection` and `map.collection` from the retired
    // `flow-template` role to `value` IN PLACE (`screen.fields[].visibleWhen`
    // keeps its `predicate` row beside the screen's value rows). Stage S4
    // appended the three `notify` value rows, stage S5 the `http` body's, and
    // stage S6 the three CRUD `filter` operand rows. #27968 appended the first
    // row rooted in a sibling block rather than `config`: a `connector_action`
    // node's `connectorConfig.input` map.
    expect(FLOW_NODE_EXPRESSION_PATHS.map(byKey)).toEqual([
      'screen.fields[].visibleWhen (predicate)',
      'decision.conditions[].expression (predicate)',
      'loop.collection (value)',
      'map.collection (value)',
      'assignment.assignments.* (value)',
      'create_record.fields.* (value)',
      'update_record.fields.* (value)',
      'subflow.input.* (value)',
      'map.input.* (value)',
      'script.inputs.* (value)',
      'screen.defaults.* (value)',
      'screen.fields[].defaultValue (value)',
      'screen.recordId (value)',
      'notify.recipients (value)',
      'notify.templateData.* (value)',
      'notify.sourceId (value)',
      'http.body (value)',
      'get_record.filter (value)',
      'update_record.filter (value)',
      'delete_record.filter (value)',
      'connector_action.connectorConfig.input.* (value)',
    ]);
  });

  it('screen: each element of a field repeater, with its index', () => {
    const found = resolveFlowNodeExpressions('screen', {
      fields: [
        { name: 'createOpportunity', type: 'boolean' },
        { name: 'opportunityName', visibleWhen: 'createOpportunity == true' },
        { name: 'opportunityAmount', visibleWhen: 'createOpportunity == true' },
      ],
    });
    expect(found.map((f) => [f.path, f.value])).toEqual([
      ['fields[1].visibleWhen', 'createOpportunity == true'],
      ['fields[2].visibleWhen', 'createOpportunity == true'],
    ]);
    expect(found.every((f) => f.entry.role === 'predicate')).toBe(true);
  });

  // [#19939] RE-JUDGED IN PLACE: this pinned the string as resolved for the
  // `flow-template` role. Stage S3 made `collection` a value slot, which emits
  // only an envelope: a string there is the value-slot judge's and the
  // contract's to refuse, not an expression to check.
  it('loop / map: the top-level collection slot emits its envelope, never a string', () => {
    const envelope = { dialect: 'cel', source: 'tasks' };
    const loop = resolveFlowNodeExpressions('loop', { collection: envelope, body: { nodes: [], edges: [] } });
    expect(loop.map((f) => [f.path, f.value, f.entry.role])).toEqual([['collection', envelope, 'value']]);
    const map = resolveFlowNodeExpressions('map', { collection: envelope });
    expect(map.map((f) => [f.path, f.value, f.entry.role])).toEqual([['collection', envelope, 'value']]);
    expect(resolveFlowNodeExpressions('map', { collection: '{tasks}' })).toEqual([]);
  });

  it('decision: each branch predicate, with its index', () => {
    const found = resolveFlowNodeExpressions('decision', {
      conditions: [
        { label: 'Yes', expression: "lead.status == 'converted'" },
        { label: 'No', expression: 'true' },
      ],
    });
    expect(found.map((f) => f.path)).toEqual(['conditions[0].expression', 'conditions[1].expression']);
    expect(found.every((f) => f.entry.role === 'predicate')).toBe(true);
  });

  it('absent values in a string-role slot are skipped; a blank one is skipped only where no refusal applies', () => {
    expect(resolveFlowNodeExpressions('screen', {})).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: [] })).toEqual([]);
    // RE-JUDGED IN PLACE (#17493, ruling A 5651023407), not deleted. This line
    // pinned `[]`: a whitespace-only STRING was "not authored", on this side
    // and at the evaluator alike, and #15572 left the string rule alone on
    // that ground — consistent on both sides. The ground is still true and was
    // ruled no defence: a blank predicate is an author's rule that was never
    // written, so the resolver now EMITS it for the `predicate` role and every
    // door refuses it through `predicateSlotRefusal`.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: '   ' }] })
      .map((f) => [f.path, f.value, f.entry.role])).toEqual([['fields[0].visibleWhen', '   ', 'predicate']]);
    expect(resolveFlowNodeExpressions('decision', { conditions: [{ label: 'x', expression: '' }] })
      .map((f) => [f.path, f.value])).toEqual([['conditions[0].expression', '']]);
    // …and ONLY for that role: a `value` slot's blank string is a literal, not
    // an expression to check — `collection`'s is refused by its contract
    // instead (#19939; it was the `flow-template` role's skip before).
    expect(resolveFlowNodeExpressions('map', { collection: '   ' })).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: 'nope' })).toEqual([]);
    // A body-less `loop` reads no value slot at all (#19939), an envelope there included.
    expect(resolveFlowNodeExpressions('loop', { collection: { dialect: 'cel', source: 'x' } })).toEqual([]);
    expect(resolveFlowNodeExpressions('decision', { condition: 'a == b' })).toEqual([]);
  });

  /**
   * [#15572] A NON-string in a `predicate` slot is emitted, so a consumer can
   * refuse it. It used to be skipped as "a type violation for the schema pass
   * to report" — and for `decision`, a schemaless node type whose config is
   * never parsed against any Zod schema, there is no schema pass, so the value
   * reached the evaluator with no validator having ever seen it.
   */
  it('emits a non-string in a predicate slot, so a consumer can refuse it', () => {
    const envelope = { dialect: 'cel', source: '   ' };
    const decision = resolveFlowNodeExpressions('decision', {
      conditions: [{ label: 'Yes', expression: envelope }],
    });
    expect(decision.map((f) => [f.path, f.value, f.entry.role]))
      .toEqual([['conditions[0].expression', envelope, 'predicate']]);
    // Same rule on the other predicate slot — one class, not one node type.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: true }] })
      .map((f) => [f.path, f.value])).toEqual([['fields[0].visibleWhen', true]]);
    // `null` / absent stay "not authored" on a slot that is NOT required — a
    // refusal needs something authored. (A `required` slot is the exception,
    // #19961: see the block below.)
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: null }] })).toEqual([]);
  });

  /**
   * [#19961] A `required` predicate slot — `decision`'s
   * `conditions[].expression`, which `DecisionConditionSchema` declares
   * `z.string()` — emits an ABSENT or `null` value on a branch that exists, for
   * every door to refuse through `predicateSlotRefusal`. It used to be skipped
   * as "not authored", and the executor then evaluated the branch as a
   * condition with no `source` and failed the run there.
   */
  describe('a required predicate slot emits its absent value', () => {
    it('the required set is exactly the decision branch predicate — the absent arm is worded for it', () => {
      // `predicateSlotRefusal`'s absent arm names a decision branch and its
      // prescription; a second `required` entry must re-word it, so its
      // arrival fails here rather than shipping a sentence about the wrong slot.
      expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.required).map((e) => `${e.nodeType}.${e.path} (${e.role})`))
        .toEqual(['decision.conditions[].expression (predicate)']);
    });

    it('emits `undefined` for a branch with no `expression` key, and `null` for `expression: null`', () => {
      const found = resolveFlowNodeExpressions('decision', {
        conditions: [
          { label: 'first', expression: 'record.amount > 10' },
          { label: 'absent' },
          { label: 'null', expression: null },
          { label: 'aliased', condition: 'record.amount > 5' },
        ],
      });
      expect(found.map((f) => [f.path, f.value, f.entry.role])).toEqual([
        ['conditions[0].expression', 'record.amount > 10', 'predicate'],
        ['conditions[1].expression', undefined, 'predicate'],
        ['conditions[2].expression', null, 'predicate'],
        // The edge's spelling on a branch is not `expression`: the branch has none.
        ['conditions[3].expression', undefined, 'predicate'],
      ]);
    });

    it('judges only a branch that exists — no `conditions`, or an empty list, declares no branch', () => {
      expect(resolveFlowNodeExpressions('decision', {})).toEqual([]);
      expect(resolveFlowNodeExpressions('decision', { conditions: [] })).toEqual([]);
      expect(resolveFlowNodeExpressions('decision', { conditions: 'nope' })).toEqual([]);
    });

    it('a slot that is NOT required keeps skipping its absent value — an absent `visibleWhen` shows the field', () => {
      expect(resolveFlowNodeExpressions('screen', { fields: [{ name: 'amount' }] })).toEqual([]);
      expect(resolveFlowNodeExpressions('screen', { fields: [{ name: 'amount', visibleWhen: null }] })).toEqual([]);
    });
  });

  describe('predicateSlotRefusal — a predicate slot holds bare CEL text', () => {
    it('says nothing about a non-blank string — what it SAYS is validateExpression\'s business', () => {
      expect(predicateSlotRefusal('record.rating >= 4')).toBeUndefined();
      // Including a string that is itself malformed: the shape is right, so
      // this function is done and the CEL parse issues the verdict.
      expect(predicateSlotRefusal('{record.rating} >= 4')).toBeUndefined();
    });

    it('REFUSES a string that is blank after trimming, under the same sentence', () => {
      // RE-JUDGED IN PLACE (#17493, ruling A 5651023407), not deleted: the
      // test above used to end `expect(predicateSlotRefusal('')).toBeUndefined()`
      // on #15572's ground that the blank was treated the same on both sides.
      // That ground was ruled insufficient, so the blank moved here.
      for (const blank of ['', '   ', '\t\n ']) {
        const refusal = predicateSlotRefusal(blank);
        expect(refusal?.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL), JSON.stringify(blank)).toBe(true);
        // Attributed to what the author wrote, whitespace and all.
        expect(refusal?.source).toBe(blank);
      }
    });

    it('refuses an envelope and attributes it to the envelope\'s own source', () => {
      const refusal = predicateSlotRefusal({ dialect: 'cel', source: 'rows.map(r,' });
      expect(refusal?.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
      expect(refusal?.message).toContain('an expression envelope');
      expect(refusal?.source).toBe('rows.map(r,');
    });

    it('refuses every other non-string, naming what it found', () => {
      expect(predicateSlotRefusal(42)?.message).toContain('a number');
      expect(predicateSlotRefusal(true)?.message).toContain('a boolean');
      expect(predicateSlotRefusal(['a'])?.message).toContain('an array');
      expect(predicateSlotRefusal({ source: 'x' })?.message).toContain('an object');
      // No `dialect` ⇒ not envelope-shaped, so no source is claimed from it.
      expect(predicateSlotRefusal({ source: 'x' })?.source).toBe('x');
      expect(predicateSlotRefusal(42)?.source).toBe('');
    });

    /**
     * [#19961] No value at all — the resolver hands one over only for a
     * `required` slot, and this is the ONE refusal every door answers it with.
     * The prescription is the blank's minus the run it kept (an absent branch
     * predicate never evaluated — the run failed at the branch), so the
     * load-bearing clauses are pinned by name.
     */
    it('REFUSES no value at all — absent and `null` — under the same sentence, with the branch prescription', () => {
      const absent = predicateSlotRefusal(undefined);
      const nulled = predicateSlotRefusal(null);
      for (const [refusal, found] of [[absent, 'Found nothing — the key is absent'], [nulled, 'Found `null`']] as const) {
        expect(refusal?.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
        expect(refusal?.message).toContain(found);
        // The prescription: write the rule; `condition` belongs in `expression`;
        // `'false'` keeps the branch and never takes it; not by dropping the
        // only branch.
        expect(refusal?.message).toContain('Write the predicate the branch was meant to test');
        expect(refusal?.message).toContain('`condition` is the edge\'s spelling — belongs in `expression`');
        expect(refusal?.message).toContain('There is no run to keep');
        expect(refusal?.message).toContain('write `expression: \'false\'`');
        expect(refusal?.message).toContain('Not by dropping a decision\'s only branch');
        // Nothing was authored, so nothing is attributed.
        expect(refusal?.source).toBe('');
      }
      // Its own detail, never the envelope's or the blank's.
      expect(absent?.message).not.toContain('Found a undefined');
      expect(absent?.message).not.toContain('envelope is the `value`-role spelling');
      expect(absent?.message).not.toContain('the value the blank evaluated to');
    });
  });
  /**
   * [#15662] The STRUCTURAL condition arm — `config.condition` on any node and
   * `edge.condition`.
   *
   * The whole point of a second refusal is that it is NOT the ledger arm's
   * rule, so the first test here is the one that would fail if somebody
   * "unified" them: an expression envelope is legitimate on this arm and must
   * be admitted, while `predicateSlotRefusal` refuses it.
   */
  describe('structuralConditionRefusal — a structural condition is CEL text or an expression', () => {
    it('is NOT predicateSlotRefusal — an envelope is legitimate here and refused there', () => {
      const envelope = { dialect: 'cel', source: 'record.rating >= 4' };
      // The measured reason: `FlowEdgeSchema.condition` is
      // `ExpressionInputSchema`, whose string arm transforms into exactly this
      // shape, so after `FlowSchema.parse` every authored edge condition IS an
      // envelope. The ledger rule here would refuse every conditional edge.
      expect(structuralConditionRefusal(envelope)).toBeUndefined();
      expect(predicateSlotRefusal(envelope)).toBeDefined();
    });

    it('admits every string — what it SAYS is validateExpression\'s business', () => {
      expect(structuralConditionRefusal('record.rating >= 4')).toBeUndefined();
      expect(structuralConditionRefusal('{record.rating} >= 4')).toBeUndefined();
      // Still admitted — but on the SHAPE question only, and no longer because
      // the blank is correct. #15662 admitted it as "not authored on both
      // sides"; #15807 refused it at the edge door and #17322 rebound the node
      // door at `registerFlow`, so a blank structural condition IS a defect
      // today. It is refused there by the imported evaluated-slot rule sitting
      // BESIDE this one, never by this function — which is exactly what these
      // two assertions pin. See the docblock of `structuralConditionRefusal`.
      expect(structuralConditionRefusal('   ')).toBeUndefined();
      expect(structuralConditionRefusal('')).toBeUndefined();
    });

    it('admits an absent condition — "not authored" is not a malformed one', () => {
      expect(structuralConditionRefusal(undefined)).toBeUndefined();
      expect(structuralConditionRefusal(null)).toBeUndefined();
    });

    it('admits an envelope with no dialect, and an `ast` BESIDE a string `source`', () => {
      // `evaluateCondition` already treats an envelope with no dialect as CEL,
      // and reads `source` — an `ast` next to it changes nothing it evaluates.
      expect(structuralConditionRefusal({ source: 'record.rating >= 4' })).toBeUndefined();
      expect(structuralConditionRefusal({ dialect: 'cel', source: 'record.rating >= 4', ast: { kind: 'const' } })).toBeUndefined();
    });

    it('REFUSES an `ast`-only envelope — admitted at first, refused once an evaluated slot required a `source`', () => {
      // FLIPPED. This admitted `{ dialect: 'cel', ast }` because the spec still
      // admitted the shape at `edge.condition` and refusing it here would have
      // decided #15430's question from the consumer side. #15807 decided it at
      // the producer (`FlowEdgeSchema.condition` composes the evaluated input
      // form), and the engine never read `ast` — so an `ast`-only envelope in a
      // structural slot is exactly the silent-`false` population this refusal
      // exists for, on `config.condition` (still an open record) as on the edge.
      for (const value of [{ dialect: 'cel', ast: { kind: 'const', value: true } }, { ast: { kind: 'const' } }]) {
        const refusal = structuralConditionRefusal(value);
        expect(refusal?.message.startsWith(STRUCTURAL_CONDITION_SHAPE_REFUSAL)).toBe(true);
        expect(refusal?.message).toContain('Found an object carrying an `ast` but no string `source`');
        expect(refusal?.message).toContain('the engine evaluates `source`, never `ast`');
        expect(refusal?.source).toBe('');
      }
      // The sentence itself now says why, so the prescription travels with the refusal.
      expect(STRUCTURAL_CONDITION_SHAPE_REFUSAL).toContain('an envelope carrying only an `ast` is not evaluable');
    });

    it('refuses the values measured to register clean and answer a silent false', () => {
      for (const [value, found] of [[42, 'a number'], [true, 'a boolean'], [['a'], 'an array']] as const) {
        const refusal = structuralConditionRefusal(value);
        expect(refusal?.message.startsWith(STRUCTURAL_CONDITION_SHAPE_REFUSAL)).toBe(true);
        expect(refusal?.message).toContain(`Found ${found}`);
        expect(refusal?.source).toBe('');
      }
    });

    it('refuses an object that is neither text nor an expression', () => {
      // `{ source: 1 }` is the one that did not even reach the silent `false`:
      // it threw a bare `TypeError: exprStr.trim is not a function`.
      expect(structuralConditionRefusal({ source: 1 })?.message)
        .toContain('Found an object carrying no string `source`');
      // An envelope carrying neither — `ExpressionSchema`'s refine rejects it
      // too, and the evaluator reads it as an empty condition.
      expect(structuralConditionRefusal({ dialect: 'cel' })).toBeDefined();
      expect(structuralConditionRefusal({})).toBeDefined();
      // A non-string `source` is exactly what is refused, so it is never the
      // attribution.
      expect(structuralConditionRefusal({ source: 1 })?.source).toBe('');
    });
  });
});

/**
 * [#27968] A ledger path rooted in a node's SIBLING block — a
 * `connector_action` node's `connectorConfig.input`, the map its executor
 * evaluates through the per-key value-slot resolver. The resolvers read the
 * block off the node they are handed, name the block in each result, and
 * answer a caller that hands only `config` for `config` alone.
 */
describe('a path rooted in a sibling block (#27968)', () => {
  const ENVELOPE = { dialect: 'cel', source: 'record.id' };
  const connectorNode = (input: Record<string, unknown>) => ({
    type: 'connector_action',
    connectorConfig: { connectorId: 'helpdesk', actionId: 'open_ticket', input },
  });

  it('declares connector_action input.* in the connectorConfig block, as a value slot', () => {
    const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === 'connector_action');
    expect(entry).toMatchObject({ block: 'connectorConfig', path: 'input.*', role: 'value' });
    expect(FLOW_NODE_SIBLING_EXPRESSION_BLOCKS).toEqual({ connectorConfig: 'connector_action' });
    expect(flowNodeExpressionBlock(entry!)).toBe('connectorConfig');
    // Every other entry is rooted in `config`.
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.block !== undefined)).toEqual([entry]);
  });

  it('resolves the envelope in the block, located in it — the node handed, no config', () => {
    const node = connectorNode({ ticket: ENVELOPE, queue: 'support' });
    expect(resolveFlowNodeExpressions('connector_action', undefined, node)).toEqual([
      { entry: expect.objectContaining({ block: 'connectorConfig' }), block: 'connectorConfig', path: 'input.ticket', value: ENVELOPE },
    ]);
    // The value walk hands the literal over too, for the template judge.
    expect(resolveFlowNodeValueSlots('connector_action', undefined, node).map((f) => [f.block, f.path, f.value])).toEqual([
      ['connectorConfig', 'input.ticket', ENVELOPE],
      ['connectorConfig', 'input.queue', 'support'],
    ]);
  });

  it('answers a caller that hands only config for config alone', () => {
    const node = connectorNode({ ticket: ENVELOPE });
    expect(resolveFlowNodeExpressions('connector_action', undefined)).toEqual([]);
    expect(resolveFlowNodeValueSlots('connector_action', {})).toEqual([]);
    // A loose `config.input` (refused by the flow parse) is no position the
    // entry names: the block, never `config`, is read.
    expect(resolveFlowNodeExpressions('connector_action', { input: { ticket: ENVELOPE } }, { connectorConfig: {} })).toEqual([]);
    expect(resolveFlowNodeExpressions('connector_action', undefined, node)).toHaveLength(1);
  });

  it('names `config` as the block of every config-rooted result', () => {
    const found = resolveFlowNodeExpressions('assignment', TWO_VARIABLE_ASSIGNMENT, connectorNode({ ticket: ENVELOPE }));
    expect(found.map((f) => [f.block, f.path])).toEqual([['config', 'assignments.digest']]);
  });

  it('skips a block that is absent, null or not an object', () => {
    for (const connectorConfig of [undefined, null, 'x', 42]) {
      expect(resolveFlowNodeValueSlots('connector_action', undefined, { connectorConfig })).toEqual([]);
    }
    expect(resolveFlowNodeValueSlots('connector_action', undefined, { connectorConfig: { connectorId: 'a', actionId: 'b' } })).toEqual([]);
  });
});
