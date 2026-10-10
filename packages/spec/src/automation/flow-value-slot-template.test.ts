// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19939] The `{…}` template dialect retired from flow VALUE slots — the C
 * half of #11182 ruling D, on the protocol-18 line.
 *
 * Pinned here, on the one judge every door calls:
 *
 *  1. **Refused, each with its remedy.** Every token class the interpolator
 *     resolves and CEL can spell is refused, led by the rule sentence and
 *     naming the CEL spelling: a path (`a.b`, `items[0]`, `vars["$error"]`,
 *     `vars["list"][0]` for a head CEL claims) with its `has()` guard where
 *     `has()` can take it, arithmetic with every divisor a double
 *     (`/ 100.0`), text with holes as one concatenation, a token that
 *     resolves to nothing with the literal-text escape.
 *  2. **Nothing is kept.** The run user (`{$User.*}`) is refused (#19939
 *     pass 2): `{$User.Id}` names `current_user.id` and its guard for a
 *     user-less run, and every other `$User` path says it never resolved and
 *     names the read of the user record. The date macros are refused (pass 3)
 *     with their CEL string form — `isoDate(…)` / `isoDatetime(…)` — and the
 *     edges where it parts from the template: a fraction, a variable offset, an
 *     offset that is neither. A string mixing them with any other token is
 *     refused whole, with a remedy for every token.
 *  2b. **Where an envelope is data, the remedy names none there.** A string
 *     inside an object or list literal is spelled inside a CEL literal that
 *     builds the whole value; a legacy `assignment` shape is moved into the
 *     canonical map (that each remedy evaluates is pinned through the engine in
 *     `service-automation`'s `assignment-value-envelope.test.ts`).
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
  CEL_CLAIMED_IDENTIFIERS,
  CEL_KEYWORDS,
  FLOW_SCOPE_CLAIMED_IDENTIFIERS,
  celExpression,
  celPath,
} from './flow-template-token';
import { FLOW_NODE_EXPRESSION_PATHS } from './flow-node-expression-paths';
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

  // A guard on the last key alone does not hold where the VARIABLE is absent:
  // `has(source.id)` fails the run when `source` was never bound (`Unknown
  // variable`). So the guard tests each step off `vars`, which holds only the
  // bound variables. That it answers `null` there is pinned through the
  // engine in `service-automation`'s `value-slot-template-grammar.test.ts`.
  it('a dotted path: the same path in CEL, guarded a step at a time from `vars`', () => {
    const message = refusalOf('{record.assignee}');
    expect(message).toContain("{ dialect: 'cel', source: 'record.assignee' }");
    expect(message).toContain('`has(vars.record) && has(vars.record.assignee) ? vars.record.assignee : null`');
    expect(message).toContain('a step at a time from `vars`, which holds only the variables the run has bound');
    expect(message).not.toContain('`has(record.assignee)');
    expect(refusalOf('{a.b.c}')).toContain('`has(vars.a) && has(vars.a.b) && has(vars.a.b.c) ? vars.a.b.c : null`');
  });

  it('a numeric segment indexes the list: `userList.0` becomes `userList[0]`', () => {
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

describe('a head CEL claims is read through `vars`, the route a `$`-named head takes', () => {
  // The set, as `flow-template-token.ts` reads it off cel-js 8.0.0 — restated
  // here so the pin fails when a name is added or dropped there unreviewed.
  // That each printed spelling EVALUATES, with a variable of the name in scope,
  // is pinned through the built engine in `service-automation`'s
  // `value-slot-template-grammar.test.ts` (the spec cannot import the engine).
  const CLAIMED = [
    'bool', 'bytes', 'double', 'int', 'list', 'map', 'null_type', 'string', 'type', 'uint',
    'cel', 'google', 'optional',
    'as', 'break', 'const', 'continue', 'else', 'for', 'function', 'if', 'import', 'let', 'loop', 'namespace',
    'package', 'return', 'var', 'void', 'while', '__proto__', 'prototype',
    'true', 'false', 'null', 'in',
  ];

  it('the claimed set is exactly the enumerated one', () => {
    expect([...CEL_CLAIMED_IDENTIFIERS].sort()).toEqual([...CLAIMED].sort());
    expect([...CEL_KEYWORDS].sort()).toEqual(['false', 'in', 'null', 'true']);
  });

  it.each(CLAIMED)('%s', (name) => {
    expect(celPath(name)).toBe(`vars["${name}"]`);
    expect(celPath(`${name}.0`)).toBe(`vars["${name}"][0]`);
    expect(celPath(`${name}.1.key`)).toBe(`vars["${name}"][1].key`);
    expect(refusalOf(`{${name}.0}`)).toContain(`source: 'vars["${name}"][0]' }`);
  });

  it('a bare claimed variable keeps its guard, selected off `vars`; a keyword cannot be selected, so it gets none', () => {
    expect(refusalOf('{list}')).toContain('`has(vars.list) ? vars.list : null`');
    expect(refusalOf('{list.tags}')).toContain('`has(vars.list) && has(vars.list.tags) ? vars.list.tags : null`');
    expect(refusalOf('{for.tags}')).toContain('`has(vars.for) && has(vars.for.tags) ? vars.for.tags : null`');
    expect(refusalOf('{null}')).not.toContain('the guarded form');
    expect(refusalOf('{in.tags}')).not.toContain('the guarded form');
  });

  it('a later keyword segment is indexed by name; every other later segment stays a field', () => {
    expect(celPath('record.in')).toBe('record["in"]');
    expect(celPath('record.null.0')).toBe('record["null"][0]');
    expect(celPath('record.list.for')).toBe('record.list.for');
    expect(refusalOf('{record.true}')).not.toContain('the guarded form');
  });

  it('an index anywhere in the path leaves it unguarded — `has()` refuses one at run time', () => {
    expect(refusalOf('{rows.0.name}')).toContain("source: 'rows[0].name' }");
    expect(refusalOf('{rows.0.name}')).not.toContain('the guarded form');
  });

  it('text with holes reads a claimed head the same way', () => {
    expect(refusalOf('Hi {list.0}')).toContain(`source: "'Hi ' + vars[\\"list\\"][0]" }`);
  });

  it('controls: an ordinary head is unchanged, and so is a `$`-named head', () => {
    for (const ordinary of ['items', 'record', 'timestamp', 'duration', 'dyn', 'lists', 'map_of', 'variables', 'user']) {
      expect(CEL_CLAIMED_IDENTIFIERS.has(ordinary)).toBe(false);
      expect(celPath(`${ordinary}.0.key`)).toBe(`${ordinary}[0].key`);
    }
    // The path is read bare; its guard, like every head's, tests each step off `vars`.
    expect(refusalOf('{record.assignee}')).toContain("source: 'record.assignee' }");
    expect(refusalOf('{record.assignee}')).toContain('`has(vars.record) && has(vars.record.assignee) ? vars.record.assignee : null`');
    expect(celPath('$error.message')).toBe('vars["$error"].message');
  });
});

/**
 * A head the FLOW scope binds over a variable of the same name — `vars` (the
 * namespace) and `current_user` (the run user) — is read through `vars` too.
 * That each printed spelling evaluates, and the bare one reads the binding
 * instead, is pinned through the engine in `service-automation`'s
 * `value-slot-template-grammar.test.ts`.
 */
describe('a head the flow CEL scope claims is read through `vars`', () => {
  it('the claimed set is exactly `vars` and `current_user`, and neither is CEL\'s', () => {
    expect([...FLOW_SCOPE_CLAIMED_IDENTIFIERS].sort()).toEqual(['current_user', 'vars']);
    for (const name of FLOW_SCOPE_CLAIMED_IDENTIFIERS) expect(CEL_CLAIMED_IDENTIFIERS.has(name)).toBe(false);
  });

  it.each(['vars', 'current_user'])('%s', (name) => {
    expect(celPath(name)).toBe(`vars["${name}"]`);
    expect(celPath(`${name}.0`)).toBe(`vars["${name}"][0]`);
    expect(celPath(`${name}.tags`)).toBe(`vars["${name}"].tags`);
    expect(refusalOf(`{${name}.0}`)).toContain(`source: 'vars["${name}"][0]' }`);
    expect(refusalOf(`{${name}.tags}`)).toContain(`\`has(vars.${name}) && has(vars.${name}.tags) ? vars.${name}.tags : null\``);
  });
});

/**
 * #19939 pass 3 — the date macros are refused with their CEL string form, the
 * spelling #22277 gave the stdlib (`isoDate` / `isoDatetime`, UTC). That each
 * one writes the bytes the template wrote, over the same instants, is pinned
 * through both engines in `service-automation`'s
 * `crud-fields-value-envelope.test.ts`.
 */
describe('the date macros are refused, each with its CEL string form', () => {
  it.each([
    ['{TODAY()}', 'isoDate(today())'],
    ['{TODAY() + 7}', 'isoDate(daysFromNow(7))'],
    ['{TODAY()+7}', 'isoDate(daysFromNow(7))'],
    ['{ TODAY() - 3 }', 'isoDate(daysAgo(3))'],
    ['{TODAY() + 0}', 'isoDate(today())'],
    ['{NOW()}', 'isoDatetime(now())'],
    ['{NOW() + 2}', 'isoDatetime(addDays(now(), 2))'],
    ['{NOW() - 1}', 'isoDatetime(addDays(now(), -1))'],
    ['{TODAY() + expirationDays}', 'isoDate(addDays(today(), expirationDays))'],
    ['{TODAY() - record.grace_days}', 'isoDate(addDays(today(), -record.grace_days))'],
    ['{NOW() + $error.days}', 'isoDatetime(addDays(now(), vars["$error"].days))'],
  ])('%s → %s', (token, source) => {
    const message = refusalOf(token);
    expect(message).toContain(`Write \`${token}\` as { dialect: 'cel', source: '${source}' }`);
    expect(message).toContain('on the UTC calendar');
  });

  it('`{NOW() ± N}` keeps the time of day: the remedy says why it is not `daysFromNow`', () => {
    expect(refusalOf('{NOW() + 2}')).toContain('where `daysFromNow` would land on midnight');
    expect(refusalOf('{NOW()}')).not.toContain('daysFromNow');
  });

  it('a fractional offset: the template truncated the day sum, `addDays` the offset, and `daysAgo(1.5)` is refused at build', () => {
    const back = refusalOf('{TODAY() - 1.5}');
    expect(back).toContain("source: 'isoDate(addDays(today(), -1.5))' }");
    expect(back).toContain('truncated the sum, so it moved 2 days back once the day of the month passed 1.5');
    expect(back).toContain('where `addDays` moves 1 back by truncating the offset');
    expect(back).toContain('`daysAgo(1.5)` is refused at build');
    expect(back).toContain('Write the whole number of days you mean.');
    const forward = refusalOf('{TODAY() + 1.5}');
    expect(forward).toContain('moved 1 day forward, as `addDays` does');
    expect(forward).toContain('`daysFromNow(1.5)` is refused at build');
    // `NOW()` names no `daysAgo` / `daysFromNow` — its spelling is `addDays` either way.
    expect(refusalOf('{NOW() - 0.5}')).toContain('moved 1 day back, where `addDays` moves 0 back');
    expect(refusalOf('{NOW() - 0.5}')).not.toContain('is refused at build');
  });

  it('a variable offset the template read as 0 when absent or not a number: CEL refuses both loudly', () => {
    const message = refusalOf('{TODAY() + days}');
    expect(message).toContain('added 0 days without a word when it found none or the value was not a number');
    expect(message).toContain('an absent variable fails the run');
    expect(message).toContain('makes `addDays` an invalid date, which `isoDate` refuses');
    expect(message).not.toContain('dotted path');
    expect(refusalOf('{TODAY() + record.days}')).toContain('never walking a dotted path');
  });

  it('an offset that is neither a number nor a variable: the template added 0 days, so the remedy writes today and says so', () => {
    const message = refusalOf('{TODAY() + 3d}');
    expect(message).toContain("source: 'isoDate(today())' }");
    expect(message).toContain('`3d` is neither a number nor a variable name, so the template added 0 days without a word');
  });

  it('text with holes: the macro is its string form in the concatenation, with its edge named', () => {
    const message = refusalOf('Due {TODAY() + 7} for {name}');
    expect(message).toContain(`{ dialect: 'cel', source: "'Due ' + isoDate(daysFromNow(7)) + ' for ' + name" }`);
    expect(refusalOf('Due {TODAY() - 1.5}')).toContain('`daysAgo(1.5)` is refused at build');
  });

  // The kept-spelling leak: while the macros were kept, a run-user token
  // beside one rode the macro and was kept whole. Nothing is kept now, so the
  // string is refused, naming a remedy for both tokens.
  it('the kept-spelling leak is closed: `Due {TODAY()} by {$User.Id}` is refused, with both tokens\' remedies', () => {
    const message = refusalOf('Due {TODAY()} by {$User.Id}');
    expect(message).toContain(`{ dialect: 'cel', source: "'Due ' + isoDate(today()) + ' by ' + current_user.id" }`);
    expect(message).toContain('`{TODAY()}` is `isoDate(today())`');
    expect(message).toContain("`(current_user != null ? current_user.id : '')`");
  });

  it('the remedies name no tracker number', () => {
    for (const token of ['{TODAY() - 1.5}', '{TODAY() + days}', '{TODAY() + 3d}', '{NOW() + 2}', 'Due {TODAY()} by {$User.Id}']) {
      expect(refusalOf(token)).not.toMatch(/#\d/);
    }
  });
});

/**
 * #19939 pass 3 (carry from pass 2): where an envelope is literal DATA — a
 * string inside an object or list literal, or either legacy `assignment` shape
 * — the remedy prescribes no envelope at that position, because one written
 * there is stored as the object it spells. That each named spelling evaluates
 * to the template's value is pinned through the engine in
 * `service-automation`'s `assignment-value-envelope.test.ts`.
 */
describe('where an envelope is literal data, the remedy names none there', () => {
  it('a string inside an object literal: build the whole value as one CEL map literal', () => {
    const [refusal] = flowNodeValueTemplateRefusals('assignment', { assignments: { o: { who: '{name}' } } });
    expect(refusal!.path).toBe('assignments.o.who');
    expect(refusal!.message).toContain('sits inside an object or list literal, where nothing evaluates');
    expect(refusal!.message).toContain(`{ dialect: 'cel', source: "{'who': name}" }`);
    expect(refusal!.message).toContain('wrap each one in `dyn(…)`');
    // The spelling of the string itself is a bare CEL expression, never an envelope at that position.
    expect(refusal!.message).toContain('Write `{name}` as `name`.');
    expect(refusal!.message).not.toContain("{ dialect: 'cel', source: 'name' }");
  });

  it('a string inside a list literal, and deeper: the literal is built along the path', () => {
    const refusals = flowNodeValueTemplateRefusals('create_record', {
      objectName: 'q', fields: { tags: ['{x}'], payload: { meta: { note: 'for {name}' } } },
    });
    expect(refusals.map((r) => r.path)).toEqual(['fields.tags[0]', 'fields.payload.meta.note']);
    expect(refusals[0]!.message).toContain("{ dialect: 'cel', source: '[x]' }");
    expect(refusals[1]!.message).toContain(`{ dialect: 'cel', source: "{'meta': {'note': 'for ' + name}}" }`);
    expect(refusals[1]!.message).toContain("one CEL concatenation, `'for ' + name`");
  });

  it.each([
    ['the legacy `assignments` array', { assignments: [{ variable: 'o', value: '{name}' }] }, 'assignments[0].value'],
    ['the legacy bare config', { o: '{name}' }, 'o'],
  ])('%s: move the assignments into the canonical map, where the envelope evaluates', (_label, config, path) => {
    const [refusal] = flowNodeValueTemplateRefusals('assignment', config);
    expect(refusal!.path).toBe(path);
    expect(refusal!.message).toContain('evaluates nothing: an envelope written in it is stored as the object it spells');
    expect(refusal!.message).toContain('Move the node\'s assignments into the canonical map, `assignments: { … }`');
    expect(refusal!.message).toContain("Write `{name}` as { dialect: 'cel', source: 'name' }");
  });

  it('a nested string in a legacy shape: both — the canonical map, and the whole value as a CEL literal', () => {
    const [refusal] = flowNodeValueTemplateRefusals('assignment', { assignments: [{ variable: 'o', value: { who: '{$User.Id}' } }] });
    expect(refusal!.message).toContain('canonical map');
    expect(refusal!.message).toContain(`{ dialect: 'cel', source: "{'who': current_user.id}" }`);
  });

  it('control: the top-level value of a declared slot keeps the envelope remedy, with no literal-position lead', () => {
    const [refusal] = flowNodeValueTemplateRefusals('assignment', { assignments: { o: '{name}' } });
    expect(refusal!.message).toContain("Write `{name}` as { dialect: 'cel', source: 'name' }");
    expect(refusal!.message).not.toContain('canonical map');
    expect(refusal!.message).not.toContain('sits inside');
  });
});

/**
 * #19939 pass 2 — the maintainer's ruling: Q1 A (`current_user` is the run's
 * user, or `null` when it has none; `{$User.*}` refused with the bare read and
 * the guard, and the guard's `update_record` consequence), Q2 A (every other
 * `$User` path never resolved; read the user record by `current_user.id`).
 */
describe('the run user — `{$User.*}` is refused, with the ruled remedies', () => {
  it('`{$User.Id}`: `current_user.id`, and for a user-less run the guard, with what it changes on `update_record`', () => {
    const message = refusalOf('{$User.Id}');
    expect(message).toContain("Write `{$User.Id}` as { dialect: 'cel', source: 'current_user.id' }");
    expect(message).toContain("{ dialect: 'cel', source: 'current_user != null ? current_user.id : null' }");
    expect(message).toContain('The guarded form writes `null` where the template wrote nothing');
    expect(message).toContain('on `update_record` clears a stored value the template left alone');
  });

  it.each(['{$User.Email}', '{$User.Name}', '{$User.id}', '{$User.Profile.title}'])(
    '%s: it never resolved, and the email or name is read from the user record by `current_user.id`',
    (token) => {
      const message = refusalOf(token);
      expect(message).toContain(`\`${token}\` never resolved in any shipped run`);
      expect(message).toContain('`current_user` carries only what the run holds — `id`, `positions`, `organizationId`, `isPlatformAdmin`');
      expect(message).toContain("assignments: { uid: { dialect: 'cel', source: 'current_user.id' } }");
      expect(message).toContain("objectName: 'sys_user'");
      expect(message).toContain("{ dialect: 'cel', source: 'me.email' }");
      expect(message).not.toContain("Write `");
    },
  );

  it('text with the run user\'s id: one concatenation reading `current_user.id`, and the hole\'s guard', () => {
    const message = refusalOf('Owner: {$User.Id}');
    expect(message).toContain(`{ dialect: 'cel', source: "'Owner: ' + current_user.id" }`);
    expect(message).toContain("`(current_user != null ? current_user.id : '')`");
  });

  it('text with another `$User` path: the concatenation leaves it out, as the template did, and says what to read', () => {
    const message = refusalOf('Contact {$User.Email} about {name}');
    expect(message).toContain(`{ dialect: 'cel', source: "'Contact ' + ' about ' + name" }`);
    expect(message).toContain('`{$User.Email}` never resolved in any shipped run');
    expect(message).toContain('`me.email`');
  });

  it('the remedies name no tracker number', () => {
    for (const token of ['{$User.Id}', '{$User.Email}', 'Owner: {$User.Id}']) {
      expect(refusalOf(token)).not.toMatch(/#\d/);
    }
  });
});

/**
 * The EXPRESSION remedy rewrites every variable path inside the expression by
 * `celPath`'s rule — not only the divisors — so the printed envelope
 * evaluates (that it does is pinned through the built engine in
 * `service-automation`'s `value-slot-template-grammar.test.ts`).
 */
describe('an expression token\'s remedy reads each variable path the way a path token\'s does', () => {
  it.each([
    ['{int * 2}', 'vars["int"] * 2'],
    ['{items.0 * 2}', 'items[0] * 2'],
    ['{$error.code + 1}', 'vars["$error"].code + 1'],
    ['{round(list.0 * 100) / 100}', 'round(vars["list"][0] * 100) / 100.0'],
    ['{vars.0 + 1}', 'vars["vars"][0] + 1'],
    ['{record.in + 1}', 'record["in"] + 1'],
  ])('%s → %s', (token, source) => {
    expect(refusalOf(token)).toContain(`source: ${source.includes("'") ? JSON.stringify(source) : `'${source}'`} }`);
  });

  it('leaves a call, a keyword, a quoted string and a member of a call as written', () => {
    expect(celExpression('max(price, 10)')).toBe('max(price, 10)');
    expect(celExpression('flag == true ? 1 : null')).toBe('flag == true ? 1 : null');
    expect(celExpression("name + ' int.0 / 2'")).toBe("name + ' int.0 / 2'");
    expect(celExpression('size(rows).int')).toBe('size(rows).int');
  });

  it('keeps the divisor rule exactly: an integer divisor only, a double or a member left alone', () => {
    expect(celExpression('price/100')).toBe('price/ 100.0');
    expect(celExpression('price / 100.5')).toBe('price / 100.5');
    expect(celExpression('price / 2e3')).toBe('price / 2e3');
    expect(celExpression('10 / 4')).toBe('10 / 4.0');
  });

  it('a text hole holding an expression is rewritten the same way', () => {
    expect(refusalOf('Total {int * 2}')).toContain(`source: "'Total ' + (vars[\\"int\\"] * 2)" }`);
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
    expect(refusals.map((r) => r.path)).toEqual([['meta', 'note'], ['list', 1], ['when']]);
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
    expect(schema.safeParse('{TODAY() + 7}').success).toBe(false);
    expect(schema.safeParse({ dialect: 'cel', source: 'isoDate(daysFromNow(7))' }).success).toBe(true);
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
        ['fields.due', `${nodeType} field value`],
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
    expect(refusals.map((r) => r.path)).toEqual(['assignments[0].value', 'assignments[1].value']);
  });

  it('the legacy bare config — its top-level keys are the variables', () => {
    const refusals = flowNodeValueTemplateRefusals('assignment', { total: '{amount}', flag: true });
    expect(refusals.map((r) => r.path)).toEqual(['total']);
  });

  it('a node type with no value slot is not judged', () => {
    expect(flowNodeValueTemplateRefusals('notify', { title: 'Hi {name}', message: '{body}' })).toEqual([]);
  });

  it('the maps a node hands to a callee (#19939): `subflow.input`, `map.input`, `script.inputs`', () => {
    expect(flowNodeValueTemplateRefusals('subflow', {
      flowName: 'child', input: { ownerId: '{record.project.owner}', note: 'Task "{record.title}" is done.', n: 1 },
    }).map((r) => [r.path, r.label, r.source])).toEqual([
      ['input.ownerId', 'subflow input value', '{record.project.owner}'],
      ['input.note', 'subflow input value', 'Task "{record.title}" is done.'],
    ]);
    // `map.collection` keeps the dialect until its own stage; `map.input` does not.
    expect(flowNodeValueTemplateRefusals('map', {
      flowName: 'child', collection: '{rows}', input: { row: '{item}', tags: ['{item.tag}'] },
    }).map((r) => [r.path, r.label])).toEqual([
      ['input.row', 'map item input value'],
      ['input.tags[0]', 'map item input value'],
    ]);
    expect(flowNodeValueTemplateRefusals('script', { function: 'f', inputs: { title: '{record.title}' } })
      .map((r) => [r.path, r.label])).toEqual([['inputs.title', 'script input value']]);
    // Each names the envelope the executor now evaluates, at the key itself.
    const [refusal] = flowNodeValueTemplateRefusals('subflow', { flowName: 'child', input: { list: '{rows}' } });
    expect(refusal!.message).toContain("{ dialect: 'cel', source: 'rows' }");
  });
});

/**
 * [#19939] A callee's input — the guarded form SUPPLIES `null`. Where the
 * template resolved a whole token to nothing it handed the callee nothing, so
 * a child flow seeded the variable from its `defaultValue`; the guarded form
 * hands `null`, a supplied value that wins over the default. The refusal at a
 * top-level value of a callee's map says so (measured through the engine in
 * `service-automation`'s `callee-input-value-slots.test.ts`).
 */
describe('a callee\'s input map: the refusal says what the guarded form hands the callee', () => {
  const at = (nodeType: string, map: string, key: string, value: unknown, base: Record<string, unknown> = {}): string => {
    const refusals = flowNodeValueTemplateRefusals(nodeType, { ...base, [map]: { [key]: value } });
    expect(refusals, JSON.stringify(value)).toHaveLength(1);
    return refusals[0]!.message;
  };

  it('subflow: a path names the child variable, its `defaultValue`, and the `null` that wins over it', () => {
    const message = at('subflow', 'input', 'ownerId', '{record.owner}', { flowName: 'child' });
    expect(message).toContain('`input.ownerId` is the child flow\'s input variable `ownerId`.');
    expect(message).toContain('the child seeded `ownerId` from its `defaultValue`');
    expect(message).toContain('the guarded form hands `null`, a supplied value, which wins over that default');
    expect(message).toContain('To keep the default, write it in the guard\'s `null` branch');
    // The sentence follows the remedy: rule, spelling, guard, then the callee.
    expect(message.indexOf('(the guarded form writes `null`)')).toBeLessThan(message.indexOf('is the child flow\'s'));
  });

  it('map: the same sentence, for each item\'s child flow', () => {
    const message = at('map', 'input', 'row', '{item}', { flowName: 'child', collection: '{rows}' });
    expect(message).toContain('`input.row` is each item\'s child flow\'s input variable `row`.');
    expect(message).toContain('wins over that default');
  });

  it('script: the function is handed `null` where the template handed `undefined`', () => {
    const message = at('script', 'inputs', 'title', '{record.title}', { function: 'f' });
    expect(message).toContain('`inputs.title` is the function\'s `input.title`: where the template handed `undefined`, the guarded form hands `null`.');
    expect(message).not.toContain('defaultValue');
  });

  it('the run user\'s id and an expression carry it too — each has an absent case', () => {
    expect(at('subflow', 'input', 'who', '{$User.Id}', { flowName: 'child' })).toContain('wins over that default');
    expect(at('subflow', 'input', 'n', '{count + 1}', { flowName: 'child' })).toContain('wins over that default');
  });

  it('a `$User` path that never resolved handed nothing in EVERY run: leaving the key out keeps exactly that', () => {
    const message = at('subflow', 'input', 'email', '{$User.Email}', { flowName: 'child' });
    expect(message).toContain('which the template handed nothing in every run, so the child seeded `email` from its `defaultValue`: leaving the key out of `input` keeps exactly that.');
    expect(at('script', 'inputs', 'email', '{$User.Email}', { function: 'f' }))
      .toContain('which the template handed `undefined` in every run: leaving the key out of `inputs` hands it nothing, as the template did.');
  });

  it('no callee sentence where the remedy hands nothing new: text with holes, a date macro, braces that are neither', () => {
    for (const value of ['Hi {name}', '{TODAY()}', '{#}']) {
      expect(at('subflow', 'input', 'k', value, { flowName: 'child' }), value).not.toMatch(/child flow's input variable|defaultValue/);
    }
  });

  it('no callee sentence inside a literal: the variable takes the whole value, which the remedy builds', () => {
    const refusals = flowNodeValueTemplateRefusals('subflow', { flowName: 'child', input: { meta: { owner: '{record.owner}' } } });
    expect(refusals.map((r) => r.path)).toEqual(['input.meta.owner']);
    expect(refusals[0]!.message).not.toContain('defaultValue');
  });

  it('only the callee maps carry it — every other value slot the ledger declares does not (one list: the ledger)', () => {
    const CALLEE = new Set(['subflow input.*', 'map input.*', 'script inputs.*']);
    const valueEntries = FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.role === 'value');
    expect(valueEntries.filter((e) => CALLEE.has(`${e.nodeType} ${e.path}`))).toHaveLength(3);
    for (const entry of valueEntries) {
      const map = entry.path.slice(0, -2);
      const message = at(entry.nodeType, map, 'k', '{x}');
      const carries = /is (the child flow|each item's child flow|the function)'s/.test(message);
      expect(carries, `${entry.nodeType} ${entry.path}`).toBe(CALLEE.has(`${entry.nodeType} ${entry.path}`));
    }
  });

  it('the contract parse judges a value with no position, so the executor\'s door names the remedy without it', () => {
    const viaSchema = FlowValueSlotSchema.safeParse('{record.owner}');
    expect(viaSchema.success).toBe(false);
    const base = viaSchema.error!.issues[0]!.message;
    const viaDoor = at('subflow', 'input', 'ownerId', '{record.owner}', { flowName: 'child' });
    expect(viaDoor.startsWith(base)).toBe(true);
    expect(base).not.toContain('defaultValue');
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
