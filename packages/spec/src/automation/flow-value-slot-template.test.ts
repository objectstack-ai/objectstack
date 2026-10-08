// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19939] The `{…}` template dialect retired from flow VALUE slots — the C
 * half of #11182 ruling D, on the protocol-18 line.
 *
 * Pinned here, on the one judge every door calls:
 *
 *  1. **Refused, each with its remedy.** Every token class the interpolator
 *     resolves and CEL can spell is refused, led by the rule sentence and
 *     naming the CEL spelling: a path (`a.b`, `list[0]`, `vars["$error"]`)
 *     with its `has()` guard, arithmetic with every divisor a double
 *     (`/ 100.0`), text with holes as one concatenation, a token that
 *     resolves to nothing with the literal-text escape.
 *  2. **Kept.** The date macros and `$User` paths, which CEL cannot spell yet,
 *     are not refused — alone or beside another token.
 *  3. **Controls.** A token-free literal, every non-string literal and a CEL
 *     envelope pass; only value slots are judged (a `filter` value is not).
 *  4. **Every door's contract.** `FlowValueSlotSchema`, `AssignmentValueSchema`
 *     and the CRUD contracts refuse the same set at the value's path.
 *  5. **Not converted (ADR-0087 D2).** The whole conversion chain, retired
 *     entries included, leaves every measured spelling as authored — none is
 *     lossless, so the refusal is what meets it.
 */

import { describe, expect, it } from 'vitest';

import { applyConversionsToFlow } from '../conversions/apply';
import {
  AssignmentValueSchema,
  CreateRecordConfigSchema,
  FlowValueSlotSchema,
  UpdateRecordConfigSchema,
} from './builtin-node-config.zod';
import {
  VALUE_SLOT_TEMPLATE_REFUSAL,
  flowNodeValueTemplateRefusals,
  valueSlotTemplateRefusals,
} from './flow-value-slot-template';

/** The one refusal a string draws, or a failure naming what came back. */
function refusalOf(value: unknown): string {
  const refusals = valueSlotTemplateRefusals(value);
  expect(refusals, `exactly one refusal for ${JSON.stringify(value)}`).toHaveLength(1);
  expect(refusals[0]!.message.startsWith(VALUE_SLOT_TEMPLATE_REFUSAL)).toBe(true);
  return refusals[0]!.message;
}

describe('a value-slot string in the retired `{…}` dialect is refused, with the CEL spelling of its tokens', () => {
  it('a bare variable: the path, and a `has(vars.x)` guard for the absent case', () => {
    const message = refusalOf('{new_assignee}');
    expect(message).toContain("{ dialect: 'cel', source: 'new_assignee' }");
    expect(message).toContain('`has(vars.new_assignee) ? vars.new_assignee : null`');
    expect(message).toContain('the guarded form writes `null`');
  });

  it('a dotted path: the same path in CEL, guarded on its last key', () => {
    const message = refusalOf('{record.assignee}');
    expect(message).toContain("{ dialect: 'cel', source: 'record.assignee' }");
    expect(message).toContain('`has(record.assignee) ? record.assignee : null`');
  });

  it('a numeric segment indexes the list: `list.0` becomes `list[0]`', () => {
    expect(refusalOf('{userList.0}')).toContain("{ dialect: 'cel', source: 'userList[0]' }");
  });

  it('a `$`-named variable is read through `vars`, as CEL has no identifier spelling for it', () => {
    expect(refusalOf('{$error.message}')).toContain('{ dialect: \'cel\', source: \'vars["$error"].message\' }');
  });

  it('arithmetic: every integer divisor becomes a double, the `/ 100.0` remedy', () => {
    const message = refusalOf('{round(amount * (1 - discount / 100) * 100) / 100}');
    expect(message).toContain("{ dialect: 'cel', source: 'round(amount * (1 - discount / 100.0) * 100) / 100.0' }");
    expect(message).toContain('CEL divides two integers as integers');
  });

  it('a name the dialect does not know is still an expression — CEL\'s own check refuses it, with a did-you-mean', () => {
    expect(refusalOf('{ROUND(price)}')).toContain("{ dialect: 'cel', source: 'ROUND(price)' }");
  });

  it('a divisor already written as a double is left as authored', () => {
    expect(refusalOf('{price / 100.0}')).toContain("source: 'price / 100.0'");
  });

  it('text with holes: one CEL concatenation, with the null and non-string advice', () => {
    const message = refusalOf('Renewal — {currentContract.contract_number}');
    expect(message).toContain(`{ dialect: 'cel', source: "'Renewal — ' + currentContract.contract_number" }`);
    expect(message).toContain("`coalesce(…, '')`");
    expect(message).toContain('`string(…)`');
  });

  it('a token that is neither a path nor an expression: the literal-text escape, as a CEL string literal', () => {
    const message = refusalOf('{"a": 1}');
    expect(message).toContain('is neither a variable path nor an expression');
    expect(message).toContain(`{ dialect: 'cel', source: "'{\\"a\\": 1}'" }`);
  });

  it('every message leads with the rule sentence, which names no tracker number', () => {
    expect(VALUE_SLOT_TEMPLATE_REFUSAL).not.toMatch(/#\d/);
  });
});

describe('the two spellings CEL cannot write yet are KEPT — not refused', () => {
  it.each([
    '{NOW()}',
    '{TODAY()}',
    '{TODAY() + 7}',
    '{TODAY() - 3}',
    '{TODAY() + expirationDays}',
    '{NOW() + 2}',
    '{$User.Id}',
    '{$User.Email}',
    'Due {TODAY()} for {name}',
    'Owner: {$User.Id}',
  ])('%s', (value) => {
    expect(valueSlotTemplateRefusals(value)).toEqual([]);
  });
});

describe('controls — what the judge never refuses', () => {
  it.each([
    ['a token-free string', 'converted'],
    ['an empty string', ''],
    ['empty braces (no token)', 'a {} b'],
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
    ['an array of literals', ['a', 'b']],
    ['a plain object of literals', { note: 'x' }],
  ])('%s', (_label, value) => {
    expect(valueSlotTemplateRefusals(value)).toEqual([]);
  });

  it('a CEL value envelope is not judged here — `FlowValueSlotSchema` owns it, and accepts a valid one', () => {
    const envelope = { dialect: 'cel', source: 'round(price * 100.0) / 100.0' };
    expect(valueSlotTemplateRefusals(envelope)).toEqual([]);
    expect(FlowValueSlotSchema.safeParse(envelope).success).toBe(true);
  });

  it('a string at any depth of a literal is judged, located inside the value', () => {
    const refusals = valueSlotTemplateRefusals({ meta: { note: 'for {name}' }, list: ['ok', '{x}'], when: '{NOW()}' });
    expect(refusals.map((r) => r.path)).toEqual([['meta', 'note'], ['list', 1]]);
  });

  it('a self-referencing literal does not loop', () => {
    const value: Record<string, unknown> = { a: '{x}' };
    value.self = value;
    expect(valueSlotTemplateRefusals(value)).toHaveLength(1);
  });
});

describe('every value-slot contract refuses the same set, at the value', () => {
  it.each([
    ['FlowValueSlotSchema', FlowValueSlotSchema],
    ['AssignmentValueSchema', AssignmentValueSchema],
  ])('%s', (_name, schema) => {
    const refused = schema.safeParse('{record.amount}');
    expect(refused.success).toBe(false);
    expect(refused.error!.issues[0]!.message.startsWith(VALUE_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    expect(schema.safeParse('{TODAY() + 7}').success).toBe(true);
    expect(schema.safeParse('literal text').success).toBe(true);
  });

  it.each([
    ['create_record', CreateRecordConfigSchema],
    ['update_record', UpdateRecordConfigSchema],
  ])('%s: the CRUD contract refuses it at `fields.<field>`', (_type, schema) => {
    const refused = schema.safeParse({ objectName: 'task', fields: { owner: '{record.owner}', status: 'open' } });
    expect(refused.success).toBe(false);
    expect(refused.error!.issues.map((i) => i.path)).toEqual([['fields', 'owner']]);
  });
});

describe('`flowNodeValueTemplateRefusals` — every value position of a node, located for a door', () => {
  it('create_record / update_record `fields`, nested values included; a `filter` value is not a value slot', () => {
    for (const nodeType of ['create_record', 'update_record']) {
      const refusals = flowNodeValueTemplateRefusals(nodeType, {
        objectName: 'task',
        filter: { id: '{recordId}' },
        fields: { owner: '{record.owner}', tags: ['{x}'], due: '{TODAY()}', status: 'open' },
      });
      expect(refusals.map((r) => [r.path, r.label])).toEqual([
        ['fields.owner', `${nodeType} field value`],
        ['fields.tags[0]', `${nodeType} field value`],
      ]);
    }
  });

  it('the canonical `assignments` map', () => {
    const refusals = flowNodeValueTemplateRefusals('assignment', { assignments: { total: '{amount}', label: 'x' } });
    expect(refusals.map((r) => [r.path, r.label, r.source])).toEqual([['assignments.total', 'assignment value', '{amount}']]);
  });

  it('the legacy `assignments` array — no way around the retirement', () => {
    const refusals = flowNodeValueTemplateRefusals('assignment', {
      assignments: [{ variable: 'total', value: '{amount}' }, { variable: 'today', value: '{TODAY()}' }],
    });
    expect(refusals.map((r) => r.path)).toEqual(['assignments[0].value']);
  });

  it('the legacy bare config — its top-level keys are the variables', () => {
    const refusals = flowNodeValueTemplateRefusals('assignment', { total: '{amount}', flag: true });
    expect(refusals.map((r) => r.path)).toEqual(['total']);
  });

  it('a node type with no value slot is not judged', () => {
    expect(flowNodeValueTemplateRefusals('notify', { title: 'Hi {name}', message: '{body}' })).toEqual([]);
  });
});

describe('ADR-0087 D2 — no measured spelling is converted; the refusal is what meets it', () => {
  it('the whole conversion chain, retired entries included, leaves every spelling as authored', () => {
    const fields = {
      a: '{name}', b: '{oppRecord.amount}', c: '{userList.0}', d: '{$error.message}',
      e: 'Hello {o.name}', f: '{round(oppRecord.amount * (discount / 100) * 100) / 100}', g: '{10 / 4}',
      h: '{NOW()}', i: '{TODAY()}', j: '{$User.Id}',
    };
    const flow = {
      name: 'probe', label: 'Probe', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'w', type: 'create_record', label: 'Write', config: { objectName: 'task', fields } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'w' }, { id: 'e2', source: 'w', target: 'end' }],
    };
    const notices: unknown[] = [];
    const converted = applyConversionsToFlow(flow, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect((converted.nodes[1]!.config as { fields: unknown }).fields).toEqual(fields);
    expect(JSON.stringify(notices)).not.toMatch(/fields\.[a-j]\b/);
  });
});
