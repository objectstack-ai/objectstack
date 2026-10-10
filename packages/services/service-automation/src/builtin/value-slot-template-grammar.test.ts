// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19939] The spec's value-slot template judge reads the `{…}` dialect the
 * way THIS package's interpolator does — the drift pin its module docblock
 * names (`@objectstack/spec/automation`, `flow-value-slot-template.ts`).
 *
 * The spec cannot import the interpolator, so it carries a copy of
 * `resolveToken`'s dispatch: date macro, then `$User.`, then a variable path,
 * then an expression. If the two readings drifted, the judge would print the
 * wrong remedy for a spelling (a date macro read as a path, a path read as an
 * expression), or pass one it should refuse (the dialect surviving in a value
 * slot). So the interpolator itself is driven over the same tokens the judge
 * classifies:
 *
 *  - every date macro (refused since #19939 pass 3) resolves through
 *    `interpolateString` to ISO text, and the judge refuses each with its CEL
 *    string form (`isoDate(…)` / `isoDatetime(…)`) — read as a date macro,
 *    never as a path or an expression (that each form writes the same bytes
 *    over the same instants is the parity pin in
 *    `crud-fields-value-envelope.test.ts`);
 *  - the run user (`$User`, refused since #19939 pass 2) resolves through the
 *    interpolator to the run's `userId` for `$User.Id` and to nothing for every
 *    other path in a shipped run context, and the remedies the judge prints
 *    evaluate through the CEL scope's `current_user` to the same answer — with
 *    a user, and, guarded, without one;
 *  - every REFUSED spelling resolves through the variables (a path), computes
 *    (an expression), or resolves to nothing — and the judge refuses each,
 *    including the dispatch-order edges (`{$User}` with no path, `{NOW}` with
 *    no call, a padded `{ amount }`);
 *  - for a refused PATH, the remedy the judge prints reads the same value
 *    through this package's CEL evaluator (`evaluateValueEnvelope`: the
 *    author-time envelope check, then the built `@objectstack/formula` engine
 *    over the flow's real CEL scope) as the interpolator read from the
 *    template — including a head variable named like an identifier CEL claims
 *    for itself (`{list.0}` → `vars["list"][0]`, #22290), or one the flow
 *    scope binds over it (`{vars.0}` → `vars["vars"][0]`), and inside an
 *    EXPRESSION token (`{int * 2}` → `vars["int"] * 2`) — and the `has()`
 *    guard it prints answers `null`, rather than failing the run, where the
 *    variable itself was never bound (#19939 pass 3).
 */

import { describe, expect, it } from 'vitest';
import { VALUE_SLOT_TEMPLATE_REFUSAL, valueSlotTemplateRefusals } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';
import { interpolateString } from './template.js';

const VARIABLES = new Map<string, unknown>([
  ['amount', 1234.5],
  ['record', { owner: 'usr_7', name: 'Acme' }],
  ['list', ['a', 'b']],
  ['$error', { message: 'boom' }],
  ['days', 3],
]);
const CONTEXT = { userId: 'usr_1', user: { email: 'ada@example.com' } } as never;

describe('a date macro resolves through the interpolator to ISO text, and is REFUSED as a date macro', () => {
  it.each([
    ['{NOW()}', /^\d{4}-\d{2}-\d{2}T/, 'isoDatetime(now())'],
    ['{TODAY()}', /^\d{4}-\d{2}-\d{2}$/, 'isoDate(today())'],
    ['{TODAY() + 7}', /^\d{4}-\d{2}-\d{2}$/, 'isoDate(daysFromNow(7))'],
    ['{TODAY() - days}', /^\d{4}-\d{2}-\d{2}$/, 'isoDate(addDays(today(), -days))'],
    ['{NOW() + 2}', /^\d{4}-\d{2}-\d{2}T/, 'isoDatetime(addDays(now(), 2))'],
  ])('%s — a date macro', (token, shape, source) => {
    expect(String(interpolateString(token, VARIABLES, CONTEXT))).toMatch(shape);
    const refusals = valueSlotTemplateRefusals(token);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.message).toContain(`Write \`${token}\` as { dialect: 'cel', source: '${source}' }`);
  });
});

describe('the run user — `{$User.*}` — is REFUSED, and its remedy reads what the interpolator read', () => {
  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => quiet } as never;
  const engine = new AutomationEngine(quiet);
  /** A run context the way the trigger doors build one: no `user` object, ever. */
  const SHIPPED = { userId: 'usr_1', positions: ['org_member'], tenantId: 'org_1' } as never;
  const USERLESS = {} as never;
  /** The CEL sources the refusal of `token` prints, in order — read after the rule sentence, whose own `'…'` is not a remedy. */
  const sources = (token: string): string[] => {
    const message = (valueSlotTemplateRefusals(token)[0]?.message ?? '').slice(VALUE_SLOT_TEMPLATE_REFUSAL.length);
    return [...message.matchAll(/\{ dialect: 'cel', source: '([^']*)' \}/g)].map((m) => m[1]!);
  };

  it('`{$User.Id}`: the bare remedy reads the run user, the guard reads `null` where the template read nothing', () => {
    expect(valueSlotTemplateRefusals('{$User.Id}')).toHaveLength(1);
    const [bare, guarded] = sources('{$User.Id}');
    expect([bare, guarded]).toEqual(['current_user.id', 'current_user != null ? current_user.id : null']);
    // With a user: all three agree.
    expect(interpolateString('{$User.Id}', VARIABLES, SHIPPED)).toBe('usr_1');
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: bare! }, VARIABLES, 'w', SHIPPED)).toBe('usr_1');
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: guarded! }, VARIABLES, 'w', SHIPPED)).toBe('usr_1');
    // Without one: the template read nothing, the bare read fails loudly, the guard reads `null`.
    expect(interpolateString('{$User.Id}', VARIABLES, USERLESS)).toBeUndefined();
    expect(() => engine.evaluateValueEnvelope({ dialect: 'cel', source: bare! }, VARIABLES, 'w', USERLESS)).toThrow(/current_user\.id/);
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: guarded! }, VARIABLES, 'w', USERLESS)).toBeNull();
  });

  it.each(['{$User.Email}', '{$User.Name}', '{$User.id}'])('%s never resolved in a shipped run context — and is refused saying so', (token) => {
    expect(interpolateString(token, VARIABLES, SHIPPED)).toBeUndefined();
    expect(valueSlotTemplateRefusals(token)[0]!.message).toContain(`\`${token}\` never resolved in any shipped run`);
  });

  it('the user-record read it names starts from `current_user.id`, which evaluates', () => {
    const [uid] = sources('{$User.Email}');
    expect(uid).toBe('current_user.id');
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: uid! }, VARIABLES, 'w', SHIPPED)).toBe('usr_1');
  });
});

describe('a spelling the retirement REFUSES is one the interpolator reads as template dialect', () => {
  it.each([
    ['{amount}', 1234.5],
    ['{ amount }', 1234.5],
    ['{record.owner}', 'usr_7'],
    ['{list.0}', 'a'],
    ['{$error.message}', 'boom'],
  ])('%s — a variable path, resolved through the variables', (token, value) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBe(value);
    expect(valueSlotTemplateRefusals(token)).toHaveLength(1);
  });

  it.each([
    ['{amount * 2}', 2469],
    ['{round(amount)}', 1235],
    ['{max(amount, 10)}', 1234.5],
  ])('%s — an expression, computed', (token, value) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBe(value);
    expect(valueSlotTemplateRefusals(token)).toHaveLength(1);
  });

  it.each([
    // No `.` after `$User`: not the user shortcut — a variable path to a
    // variable nobody binds.
    '{$User}',
    // No call: not the date macro — a variable path.
    '{NOW}',
    '{missing.key}',
  ])('%s — a dispatch-order edge: a path that resolves to nothing', (token) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBeUndefined();
    expect(valueSlotTemplateRefusals(token)).toHaveLength(1);
  });

  it('text with holes renders through the interpolator, and is refused as one string', () => {
    expect(interpolateString('Owner {record.owner} of {record.name}', VARIABLES, CONTEXT)).toBe('Owner usr_7 of Acme');
    expect(valueSlotTemplateRefusals('Owner {record.owner} of {record.name}')).toHaveLength(1);
  });

  it('a token-free string is the same text to both: no substitution, no refusal', () => {
    expect(interpolateString('approved', VARIABLES, CONTEXT)).toBe('approved');
    expect(interpolateString('a {} b', VARIABLES, CONTEXT)).toBe('a {} b');
    expect(valueSlotTemplateRefusals('approved')).toEqual([]);
    expect(valueSlotTemplateRefusals('a {} b')).toEqual([]);
  });
});

describe('the remedy a refused path prints reads, through CEL, the value the interpolator read', () => {
  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => quiet } as never;
  const engine = new AutomationEngine(quiet);

  /** The CEL spellings the one refusal of `token` names: the envelope's source, and the `has()` guard when it prints one. */
  function printedSpellings(token: string): string[] {
    const refusals = valueSlotTemplateRefusals(token);
    expect(refusals, `exactly one refusal for ${token}`).toHaveLength(1);
    const message = refusals[0]!.message;
    const envelope = /Write `[^`]+` as \{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/.exec(message);
    expect(envelope, `an envelope remedy in: ${message}`).not.toBeNull();
    const guard = /: `(has\([^`]*)` \(the guarded form writes `null`\)/.exec(message);
    return [envelope![1] ?? (JSON.parse(envelope![2]!) as string), ...(guard ? [guard[1]!] : [])];
  }

  /** Both readings of `token` over `variables`, and every printed spelling evaluated to the interpolator's value. */
  function expectReadingsAgree(token: string, variables: Map<string, unknown>, value: unknown): void {
    expect(interpolateString(token, variables, CONTEXT)).toEqual(value);
    for (const source of printedSpellings(token)) {
      expect(engine.evaluateValueEnvelope({ dialect: 'cel', source }, variables, token), source).toEqual(value);
    }
  }

  // Every identifier CEL claims before a flow variable can (`flow-template-token.ts`
  // in the spec reads them off cel-js 8.0.0): the type identifiers, the namespace
  // constants, the reserved words and the keywords. `__proto__` is claimed there
  // too, and is left out of this list: the flow CEL scope is a plain object, where
  // `__proto__` names the prototype rather than a key, so no CEL spelling reads a
  // variable of that name.
  it.each([
    'bool', 'bytes', 'double', 'int', 'list', 'map', 'null_type', 'string', 'type', 'uint',
    'cel', 'google', 'optional',
    'as', 'break', 'const', 'continue', 'else', 'for', 'function', 'if', 'import', 'let', 'loop', 'namespace',
    'package', 'return', 'var', 'void', 'while', 'prototype',
    'true', 'false', 'null', 'in',
  ])('a head variable named `%s`', (name) => {
    const value = ['first', { key: 'second' }];
    const variables = new Map<string, unknown>([[name, value]]);
    expectReadingsAgree(`{${name}}`, variables, value);
    expectReadingsAgree(`{${name}.0}`, variables, 'first');
    expectReadingsAgree(`{${name}.1.key}`, variables, 'second');
    expectReadingsAgree(`{${name}.tags}`, new Map<string, unknown>([[name, { tags: 'T' }]]), 'T');
  });

  it('the guard is read off the refusal too, so each row above evaluates it where one is printed', () => {
    expect(printedSpellings('{list.tags}')).toEqual(['vars["list"].tags', 'has(vars.list) && has(vars.list.tags) ? vars.list.tags : null']);
    expect(printedSpellings('{list}')).toEqual(['vars["list"]', 'has(vars.list) ? vars.list : null']);
    expect(printedSpellings('{null.tags}')).toEqual(['vars["null"].tags']);
  });

  // The guard is for "one that may be absent" — the VARIABLE as well as a key.
  // A variable the run never bound (an `isInput` one the caller left out, with
  // no default: `seedDeclaredVariables` sets nothing for it) is absent from the
  // scope, and `has()` evaluates everything but its last selection, so a guard
  // on the last key alone, `has(source.id)`, fails the run there. The printed
  // guard tests each step off `vars`, which holds only the bound variables.
  it.each([
    ['{source.id}', 'source', { id: 'r1' }, 'r1'],
    ['{record.owner.name}', 'record', { owner: { name: 'Ada' } }, 'Ada'],
    ['{list.tags}', 'list', { tags: 'T' }, 'T'],
    ['{x}', 'x', 7, 7],
  ])('the printed guard of %s answers `null` where the variable, or a key on the way, is absent', (token, root, bound, value) => {
    const guard = printedSpellings(token)[1]!;
    expect(guard, token).toMatch(/^has\(vars\./);
    const evaluate = (variables: Map<string, unknown>) =>
      engine.evaluateValueEnvelope({ dialect: 'cel', source: guard }, variables, token);
    expect(evaluate(new Map()), `${guard} — ${root} unbound`).toBeNull();
    expect(evaluate(new Map([[root, null]])), `${guard} — ${root} null`).toBeNull();
    if (typeof bound === 'object') expect(evaluate(new Map([[root, {}]])), `${guard} — a key absent`).toBeNull();
    const variables = new Map<string, unknown>([[root, bound]]);
    expect(interpolateString(token, variables, CONTEXT)).toEqual(value);
    expect(evaluate(variables), `${guard} — bound`).toEqual(value);
  });

  it('through a run: an `isInput` variable the caller left out — the printed guard writes `null`, a guard on the last key fails the run', async () => {
    const guard = printedSpellings('{source.id}')[1]!;
    expect(guard).toBe('has(vars.source) && has(vars.source.id) ? vars.source.id : null');
    const run = async (source: string) => {
      const flowEngine = new AutomationEngine(quiet);
      registerLogicNodes(flowEngine, { logger: quiet, getService: () => undefined } as never);
      flowEngine.registerFlow('guarded', {
        name: 'guarded', label: 'Guarded', type: 'autolaunched',
        variables: [{ name: 'source', type: 'object', isInput: true }, { name: 'who', type: 'text', isOutput: true }],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'assign', type: 'assignment', label: 'Assign', config: { assignments: { who: { dialect: 'cel', source } } } },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'assign' }, { id: 'e2', source: 'assign', target: 'end' }],
      } as never);
      return flowEngine.execute('guarded', { params: {} } as never);
    };
    const guarded = await run(guard);
    expect(guarded.success, guarded.error).toBe(true);
    expect(guarded.output).toEqual({ who: null });
    // Control: the guard the refusal printed before — `has()` on the last key alone.
    const lastKeyOnly = await run('has(source.id) ? source.id : null');
    expect(lastKeyOnly.success).toBe(false);
    expect(lastKeyOnly.error).toContain('Unknown variable: source');
  });

  it('a later keyword segment, and an index in the middle of a path', () => {
    const variables = new Map<string, unknown>([['record', { in: 'x', tags: { null: 'y' } }], ['rows', [{ name: 'r0' }]]]);
    expectReadingsAgree('{record.in}', variables, 'x');
    expectReadingsAgree('{record.tags.null}', variables, 'y');
    expectReadingsAgree('{rows.0.name}', variables, 'r0');
  });

  it.each(['items', 'timestamp', 'duration', 'dyn'])('control: an ordinary head `%s` is read bare, unchanged', (name) => {
    const variables = new Map<string, unknown>([[name, ['first', { key: 'second' }]]]);
    expect(printedSpellings(`{${name}.0}`)).toEqual([`${name}[0]`]);
    expectReadingsAgree(`{${name}.0}`, variables, 'first');
    expectReadingsAgree(`{${name}.1.key}`, variables, 'second');
  });

  it('control: a `$`-named head is still read through `vars`', () => {
    expect(printedSpellings('{$error.message}')).toEqual(['vars["$error"].message']);
    expectReadingsAgree('{$error.message}', VARIABLES, 'boom');
  });

  // The flow scope's own claims (`FLOW_SCOPE_CLAIMED_IDENTIFIERS` in the spec,
  // measured from `celScope`): `vars` and `current_user` are bound AFTER the
  // variables are spread, so the bare spelling reads the binding and only
  // `vars["…"]` reads the variable.
  it.each(['vars', 'current_user'])('a head variable named `%s` — the scope binds it over the variable', (name) => {
    const value = ['first', { key: 'second' }];
    const variables = new Map<string, unknown>([[name, value]]);
    expectReadingsAgree(`{${name}.0}`, variables, 'first');
    expectReadingsAgree(`{${name}.1.key}`, variables, 'second');
    expectReadingsAgree(`{${name}.tags}`, new Map<string, unknown>([[name, { tags: 'T' }]]), 'T');
    // The bare spelling does not read the variable — the binding answers it.
    expect(() => engine.evaluateValueEnvelope({ dialect: 'cel', source: `${name}[0]` }, variables, name)).toThrow();
  });
});

describe('an EXPRESSION token\'s remedy evaluates — every variable path in it is read by the path rule', () => {
  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => quiet } as never;
  const engine = new AutomationEngine(quiet);
  const remedyOf = (token: string): string => {
    const message = valueSlotTemplateRefusals(token)[0]!.message;
    const m = /Write `[^`]+` as \{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/.exec(message);
    expect(m, message).not.toBeNull();
    return m![1] ?? (JSON.parse(m![2]!) as string);
  };

  it('`{int * 2}` — a head CEL claims: `vars["int"] * 2`, the value the interpolator computed', () => {
    const variables = new Map<string, unknown>([['int', 5]]);
    expect(interpolateString('{int * 2}', variables, CONTEXT)).toBe(10);
    expect(remedyOf('{int * 2}')).toBe('vars["int"] * 2');
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: remedyOf('{int * 2}') }, variables, 'w')).toBe(10);
  });

  it('`{items.0 * 2}` — an index: `items[0] * 2`, which evaluates (the interpolator computed nothing for it)', () => {
    const variables = new Map<string, unknown>([['items', [3, 4]]]);
    expect(interpolateString('{items.0 * 2}', variables, CONTEXT)).toBeUndefined();
    expect(remedyOf('{items.0 * 2}')).toBe('items[0] * 2');
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: remedyOf('{items.0 * 2}') }, variables, 'w')).toBe(6);
  });

  it('a `$`-named head and a divisor in one expression', () => {
    const variables = new Map<string, unknown>([['$error', { code: 7 }]]);
    expect(interpolateString('{$error.code / 2}', variables, CONTEXT)).toBe(3.5);
    expect(remedyOf('{$error.code / 2}')).toBe('vars["$error"].code / 2.0');
    expect(engine.evaluateValueEnvelope({ dialect: 'cel', source: remedyOf('{$error.code / 2}') }, variables, 'w')).toBe(3.5);
  });
});
