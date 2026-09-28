// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal codes `validateExpression` and `collectCelRootIdentifiers` carry
 * beside their English message (`expression-refusal.ts`).
 *
 * Two kinds of pin, and they fail for different reasons:
 *
 *  - **One test per code** — the code, its params exactly, and the English
 *    message exactly. The message pins are the control for adding the code: a
 *    code rides BESIDE the sentence API callers, the CLI and the agent tool
 *    already read, and must not change a byte of it. Where a message embeds a
 *    diagnostic the CEL or template engine wrote (`detail`), the expected text
 *    takes that diagnostic from the engine itself — the pin is on our words and
 *    on the pass-through, never on the engine's wording.
 *  - **The closed set** — every code has a pin and nothing else does; every
 *    refusal a broad sweep of inputs provokes carries a code from the set, with
 *    params the message actually interpolates; and at the type level a refusal
 *    without a code does not compile. A new refusal path without a code goes
 *    red at the type check, and a code nobody pinned goes red here.
 */

import { describe, expect, it } from 'vitest';
import { celEngine, collectCelRootIdentifiers, type CelRootIdentifiersResult } from './cel-engine';
import { templateEngine } from './template-engine';
import { validateExpression, type ExprInput, type ExprSchemaHint, type ExprValidationError, type FieldRole } from './validate';
import {
  EXPRESSION_REFUSAL_CODES,
  type CelRootsRefusalCode,
  type ExpressionRefusalCode,
  type ExpressionRefusalParams,
} from './expression-refusal';
import * as formula from './index';

/** What one refusal says, whichever producer said it. */
interface Said {
  readonly code: string;
  readonly params: unknown;
  readonly message: string;
}

/** The CEL engine's own diagnostic for `source` — what a CEL code's `detail` passes through. */
function celDetail(source: string): string {
  const compiled = celEngine.compile(source);
  if (compiled.ok) throw new Error(`expected \`${source}\` not to compile`);
  return compiled.error.message;
}

/** The template engine's own diagnostic for `source`. */
function templateDetail(source: string): string {
  const compiled = templateEngine.compile(source);
  if (compiled.ok) throw new Error(`expected \`${source}\` not to compile as a template`);
  return compiled.error.message;
}

/** The one refusal `validateExpression` reports, as an error, with nothing beside it. */
function onlyError(role: FieldRole, input: ExprInput, schema?: ExprSchemaHint): Said {
  const r = validateExpression(role, input, schema);
  expect(r.ok).toBe(false);
  expect(r.warnings).toHaveLength(0);
  expect(r.errors).toHaveLength(1);
  return r.errors[0];
}

/** The one advisory `validateExpression` reports, with no error beside it. */
function onlyWarning(role: FieldRole, input: ExprInput, schema?: ExprSchemaHint): Said {
  const r = validateExpression(role, input, schema);
  expect(r.ok).toBe(true);
  expect(r.errors).toHaveLength(0);
  expect(r.warnings).toHaveLength(1);
  return r.warnings[0];
}

/** `collectCelRootIdentifiers`'s refusal, with `error` read as the message. */
function rootsRefusal(source: string): Said {
  const r = collectCelRootIdentifiers(source);
  if (r.ok) throw new Error(`expected \`${source}\` to be refused`);
  return { code: r.code, params: r.params, message: r.error };
}

interface Pin<C extends ExpressionRefusalCode> {
  readonly produce: () => Said;
  readonly params: ExpressionRefusalParams[C];
  readonly message: string;
}

/** Over `maxListElements` (64) and under every other bound. */
const OVERSIZED_LIST = `size([${Array.from({ length: 65 }, () => '0').join(', ')}]) > 0`;

const NON_STRING_ENVELOPE_TAIL = (example: string, dialect: string): string =>
  `Write the expression as bare text (e.g. ${example}), or as an envelope whose \`source\` is that text ` +
  `(e.g. \`{ dialect: '${dialect}', source: '…' }\`).`;

const METHOD_CALL_TAIL =
  ' The callable names this platform advertises for authoring (the `functions` list `introspectScope` returns, ' +
  '`CEL_STDLIB_FUNCTIONS`) take their subject as an argument; only cel-js\'s own receiver methods ' +
  '(`record.name.split(\',\')`) are written after a dot.';

const UNKNOWN_FUNCTION_TAIL =
  ' The callable names this platform advertises for authoring are the `functions` list `introspectScope` returns ' +
  '(`CEL_STDLIB_FUNCTIONS`) — pick one of those, or precompute the value in a stored field and reference that field instead.';

/**
 * Every code, its primary case first. The mapped type makes a code without a
 * pin a type error in this file; the first test below makes it a red run.
 */
const PINS: { readonly [C in ExpressionRefusalCode]: readonly [Pin<C>, ...Pin<C>[]] } = {
  'envelope-source-not-text': [
    {
      produce: () => onlyError('predicate', { dialect: 'cel', source: 42 } as unknown as ExprInput),
      params: { role: 'predicate', found: 'number' },
      message:
        'invalid predicate envelope: an expression envelope carries its expression as a string `source` — found a number. ' +
        NON_STRING_ENVELOPE_TAIL('`record.rating >= 4`', 'cel'),
    },
    {
      produce: () => onlyError('template', { source: ['a'] } as unknown as ExprInput),
      params: { role: 'template', found: 'array' },
      message:
        'invalid template envelope: an expression envelope carries its expression as a string `source` — found an array. ' +
        NON_STRING_ENVELOPE_TAIL('`Hi {{ record.name }}`', 'template'),
    },
    {
      produce: () => onlyError('value', { source: { a: 1 } } as unknown as ExprInput),
      params: { role: 'value', found: 'object' },
      message:
        'invalid value envelope: an expression envelope carries its expression as a string `source` — found an object. ' +
        NON_STRING_ENVELOPE_TAIL('`record.rating >= 4`', 'cel'),
    },
  ],
  'template-dialect-mismatch': [
    {
      produce: () => onlyError('template', { dialect: 'cel', source: 'x' }),
      params: { dialect: 'cel' },
      message: 'expected a text template but got a `cel` expression.',
    },
  ],
  'invalid-template': [
    {
      produce: () => onlyError('template', 'Hi {{ record.name '),
      params: { detail: templateDetail('Hi {{ record.name ') },
      message: `invalid template: ${templateDetail('Hi {{ record.name ')} (holes use \`{{ path }}\`).`,
    },
  ],
  'template-single-brace': [
    {
      produce: () => onlyError('template', 'Hi {name}'),
      params: { ref: 'name' },
      message: 'single-brace `{name}` is not a valid template hole — use double braces: `{{ name }}`.',
    },
  ],
  'cel-dialect-mismatch': [
    {
      produce: () => onlyError('predicate', { dialect: 'js', source: 'x' }),
      params: { dialect: 'js' },
      message: 'expected a CEL expression but got a `js` dialect.',
    },
  ],
  'invalid-cel': [
    {
      produce: () => onlyError('predicate', 'record.rating >='),
      params: { role: 'predicate', detail: celDetail('record.rating >=') },
      message: `invalid CEL predicate: ${celDetail('record.rating >=')} — predicates are bare CEL (e.g. \`record.rating >= 4\`).`,
    },
    {
      produce: () => onlyError('value', "1 + 'a'"),
      params: { role: 'value', detail: celDetail("1 + 'a'") },
      message: `invalid CEL value: ${celDetail("1 + 'a'")} — values are bare CEL (e.g. \`record.rating >= 4\`).`,
    },
  ],
  'cel-too-large': [
    {
      produce: () => onlyError('predicate', OVERSIZED_LIST),
      params: { role: 'predicate', detail: celDetail(OVERSIZED_LIST), limit: 'maxListElements', limitValue: 64 },
      message:
        `invalid CEL predicate: ${celDetail(OVERSIZED_LIST)} — this is valid CEL that exceeds the \`maxListElements\` ` +
        'budget (limit 64) — a SIZE fault, not a dialect mistake, so re-spelling the expression will not fix it. ' +
        'Shrink it (fewer clauses, shallower nesting, fewer list elements), or precompute the heavy part into a stored ' +
        'field and reference that field instead. Splitting it into several expressions changes how they combine at ' +
        'this authoring site, so check that site\'s semantics before doing that.',
    },
  ],
  'cel-method-call': [
    {
      produce: () => onlyError('predicate', "record.name.upper() == 'X'"),
      params: { role: 'predicate', detail: celDetail("record.name.upper() == 'X'"), name: 'upper', receiver: 'record.name' },
      message:
        `invalid CEL predicate: ${celDetail("record.name.upper() == 'X'")} — \`upper\` is callable bare, not as a method — ` +
        'a CALL-SHAPE fault, not a dialect mistake, so re-spelling the expression will not fix it. ' +
        'Write `upper(record.name)` instead.' + METHOD_CALL_TAIL,
    },
    {
      produce: () => onlyError('predicate', "record.tags[0].upper() == 'X'"),
      params: { role: 'predicate', detail: celDetail("record.tags[0].upper() == 'X'"), name: 'upper' },
      message:
        `invalid CEL predicate: ${celDetail("record.tags[0].upper() == 'X'")} — \`upper\` is callable bare, not as a method — ` +
        'a CALL-SHAPE fault, not a dialect mistake, so re-spelling the expression will not fix it. ' +
        'Write `upper(…)` with the receiver as its first argument instead.' + METHOD_CALL_TAIL,
    },
  ],
  'cel-unknown-function': [
    {
      produce: () => onlyError('predicate', "upperr(record.name) == 'X'"),
      params: { role: 'predicate', detail: celDetail("upperr(record.name) == 'X'"), name: 'upperr', suggestion: 'upper' },
      message:
        `invalid CEL predicate: ${celDetail("upperr(record.name) == 'X'")} — \`upperr\` is not a callable name here — ` +
        'a NAME fault, not a dialect mistake, so re-spelling the expression will not fix it. Did you mean `upper`?' +
        UNKNOWN_FUNCTION_TAIL,
    },
    {
      produce: () => onlyError('value', 'frobnicate(record.x)'),
      params: { role: 'value', detail: celDetail('frobnicate(record.x)'), name: 'frobnicate' },
      message:
        `invalid CEL value: ${celDetail('frobnicate(record.x)')} — \`frobnicate\` is not a callable name here — ` +
        'a NAME fault, not a dialect mistake, so re-spelling the expression will not fix it.' + UNKNOWN_FUNCTION_TAIL,
    },
  ],
  'cel-template-brace': [
    {
      produce: () => onlyError('predicate', "{status} == 'x'"),
      params: { role: 'predicate', detail: celDetail("{status} == 'x'"), ref: 'status' },
      message:
        `invalid CEL predicate: ${celDetail("{status} == 'x'")} — it looks like a \`{status}\` template brace was used ` +
        'inside a CEL expression — `{…}` parses as a CEL map literal and fails. Write the bare reference instead, e.g. `status`.',
    },
  ],
  'unknown-field': [
    {
      produce: () => onlyError('predicate', 'record.amout > 1', { fields: ['amount'], objectName: 'deal' }),
      params: { field: 'amout', objectName: 'deal', suggestion: 'amount' },
      message: 'unknown field `amout` on `deal` — did you mean `amount`?',
    },
    {
      produce: () => onlyError('predicate', 'record.zzz > 1', { fields: ['amount'] }),
      params: { field: 'zzz' },
      message: 'unknown field `zzz`',
    },
  ],
  'unknown-role': [
    {
      produce: () => onlyError('predicate', "'org_admni' in current_user.positions", { roleCatalog: ['org_admin', 'sales'] }),
      params: { name: 'org_admni', suggestion: 'org_admin', catalog: ['org_admin', 'sales'] },
      message: 'unknown role `org_admni` — not a defined role; did you mean `org_admin`? Valid roles: org_admin, sales.',
    },
    {
      produce: () => onlyError('predicate', "'zzzzzzzz' in current_user.positions", { roleCatalog: ['org_admin', 'sales'] }),
      params: { name: 'zzzzzzzz', catalog: ['org_admin', 'sales'] },
      message: 'unknown role `zzzzzzzz` — not a defined role. Valid roles: org_admin, sales.',
    },
  ],
  'unbound-root': [
    {
      produce: () => onlyError('predicate', "pge.selectedProjectId != ''", { scope: 'record', roots: ['page'] }),
      params: { name: 'pge', roots: ['page'], suggestion: 'page' },
      message:
        'unbound root `pge` — beyond the record this authoring surface binds `page`, and `pge` is none of them, ' +
        'so `pge.…` resolves to nothing and the expression silently evaluates to null. Did you mean `page`?',
    },
  ],
  'bare-reference': [
    {
      produce: () => onlyError('value', 'amount * 2', { scope: 'record' }),
      params: { name: 'amount' },
      message:
        'bare reference `amount` — a formula/validation expression binds the record as the `record` namespace, ' +
        'not at top level, so `amount` resolves to nothing and the expression silently evaluates to null. Write `record.amount`.',
    },
  ],
  'date-arithmetic': [
    {
      produce: () => onlyError('value', 'record.close_date + 1', { scope: 'record', fieldTypes: { close_date: 'date' } }),
      params: { operands: 'google.protobuf.Timestamp + int', reference: 'record.close_date' },
      message:
        'date arithmetic `google.protobuf.Timestamp + int` — `record.close_date` is a date, and CEL can\'t do arithmetic ' +
        'on dates: this faults at runtime, so the field silently evaluates to null. Use `daysBetween(a, b)` for the span ' +
        'in whole days, and `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)` to shift a date.',
    },
    {
      produce: () =>
        onlyError('predicate', 'close_date + 1 > 3', { fields: ['close_date'], fieldTypes: { close_date: 'date' } }),
      params: { operands: 'google.protobuf.Timestamp + int', reference: 'close_date' },
      message:
        'date arithmetic `google.protobuf.Timestamp + int` — `close_date` is a date, and CEL can\'t do arithmetic ' +
        'on dates: this faults at runtime, so the field silently evaluates to null. Use `daysBetween(a, b)` for the span ' +
        'in whole days, and `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)` to shift a date.',
    },
  ],
  'type-mismatch': [
    {
      produce: () => onlyWarning('predicate', 'record.name > 5', { scope: 'record', fieldTypes: { name: 'text' } }),
      params: { operands: 'string > int', operator: '>', held: 'text', reference: 'record.name' },
      message:
        'type mismatch `string > int` — `record.name` holds text but is used with `>` against a number. This faults at ' +
        'runtime, so the expression silently evaluates to null (unless the value happens to be numeric). Use a number ' +
        'field, or drop the arithmetic/comparison.',
    },
    {
      produce: () =>
        onlyWarning('predicate', 'record.active + 1 > 5', { scope: 'record', fieldTypes: { active: 'boolean' } }),
      params: { operands: 'bool + int', operator: '+', held: 'boolean', reference: 'record.active' },
      message:
        'type mismatch `bool + int` — `record.active` holds a boolean but is used with `+` against a number. This faults ' +
        'at runtime, so the expression silently evaluates to null (unless the value happens to be numeric). Use a number ' +
        'field, or drop the arithmetic/comparison.',
    },
  ],
  'field-near-miss': [
    {
      produce: () => onlyWarning('predicate', "stauts == 'x'", { fields: ['status'], objectName: 'deal' }),
      params: { name: 'stauts', suggestion: 'status', objectName: 'deal' },
      message:
        '`stauts` is not a field of `deal` — did you mean `status`? (flow conditions reference fields bare, e.g. ' +
        '`status == …`). If `stauts` is a flow variable this is safe to ignore.',
    },
    {
      produce: () => onlyWarning('predicate', "stauts == 'x'", { fields: ['status'] }),
      params: { name: 'stauts', suggestion: 'status' },
      message:
        '`stauts` is not a field of `the trigger object` — did you mean `status`? (flow conditions reference fields ' +
        'bare, e.g. `status == …`). If `stauts` is a flow variable this is safe to ignore.',
    },
  ],
  'traversal-bare-and-traversed': [
    {
      produce: () =>
        onlyError('predicate', "record.account == 'a1' && record.account.name == 'x'", {
          fieldTypes: { account: 'lookup' },
          traversalHydration: true,
        }),
      params: { root: 'record', field: 'account' },
      message:
        '`record.account` is read BOTH through the relationship (`record.account.<related field>`) and as a plain value ' +
        '(`record.account`) in the same expression. Reading through the relationship resolves `record.account` to the ' +
        'related RECORD, so the plain-value comparison would stop matching the stored id — silently. To compare the id, ' +
        'write `record.account.id` for the value comparison, and keep `record.account.<related field>` for the ' +
        'traversal. `record.account.id` is not a null guard: it reads through `account` too, and a rule that reads ' +
        'through an empty `account` rejects the write instead of being skipped. If the plain value tests for empty, ' +
        'take that test out of this expression. To skip the rule while `account` is empty, guard it on `account` being ' +
        'set: make it the `then` of a `conditional` rule whose `when` is `record.account != null`. To refuse an empty ' +
        '`account`, make `account` required (`required: true`).',
    },
  ],
  'traversal-multi-hop': [
    {
      produce: () =>
        onlyError('predicate', "record.account.owner.name == 'x'", {
          fieldTypes: { account: 'lookup' },
          traversalHydration: true,
        }),
      params: { root: 'record', field: 'account' },
      message:
        '`record.account` is read through more than one relationship hop. Predicates resolve ONE hop ' +
        '(`record.account.<related field>`); a second hop is not loaded, so the expression would fault at evaluation ' +
        'time and reject the write. Denormalise the value you need onto `account`\'s object, or read it in a hook instead.',
    },
  ],
  'empty-expression': [
    {
      produce: () => rootsRefusal('   '),
      params: {},
      message: 'expression is empty',
    },
  ],
  'cel-parse-failed': [
    {
      produce: () => rootsRefusal('a =='),
      params: { detail: celDetail('a ==') },
      message: celDetail('a =='),
    },
    {
      produce: () => rootsRefusal(OVERSIZED_LIST),
      params: { detail: celDetail(OVERSIZED_LIST) },
      message: celDetail(OVERSIZED_LIST),
    },
  ],
};

describe('expression refusal codes — one pin per code (code, params, unchanged message)', () => {
  for (const code of EXPRESSION_REFUSAL_CODES) {
    it(code, () => {
      const cases = PINS[code] as readonly Pin<typeof code>[];
      for (const pin of cases) {
        const said = pin.produce();
        expect(said.code).toBe(code);
        expect(said.params).toEqual(pin.params);
        expect(said.message).toBe(pin.message);
      }
    });
  }
});

/**
 * Inputs chosen to walk every arm of both producers, and a good many inputs
 * that are refused by none — the sweep asserts about whatever it provokes, so
 * a clean input costs nothing and a new arm reached by an old input is judged.
 */
const SWEEP_SOURCES: readonly string[] = [
  '',
  '   ',
  'record.rating >= 4',
  'record.rating >=',
  "1 + 'a'",
  'a ==',
  OVERSIZED_LIST,
  "record.name.upper() == 'X'",
  "record.tags[0].upper() == 'X'",
  "upperr(record.name) == 'X'",
  'frobnicate(record.x)',
  "upper(1, 2) == 'X'",
  "record.name.contains() == true",
  "{status} == 'x'",
  'Hi {name}',
  'Hi {{ record.name }}',
  'Hi {{ record.name ',
  'Hi {{ }}',
  'record.amout > 1',
  'record.amount > 1',
  'amount * 2',
  "stauts == 'x'",
  "status == 'x'",
  "pge.selectedProjectId != ''",
  "page.selectedProjectId != ''",
  "'org_admni' in current_user.positions",
  "current_user.positions.contains('zzz')",
  'record.close_date + 1',
  'close_date + 1 > 3',
  'record.name > 5',
  'record.active + 1 > 5',
  "record.account == 'a1' && record.account.name == 'x'",
  "record.account.owner.name == 'x'",
  "type == 'grid' && status == 'q'",
  'has(status) && other == 1',
  'daysBetween(record.a, record.b) > 3',
];

const SWEEP_INPUTS: readonly ExprInput[] = [
  ...SWEEP_SOURCES,
  ...SWEEP_SOURCES.map((source) => ({ dialect: 'cel', source })),
  ...SWEEP_SOURCES.map((source) => ({ dialect: 'template', source })),
  { dialect: 'js', source: 'x' },
  { source: 42 } as unknown as ExprInput,
  { source: ['a'] } as unknown as ExprInput,
  { source: { a: 1 } } as unknown as ExprInput,
  { source: true } as unknown as ExprInput,
  { dialect: 'cel' },
  null,
  undefined,
];

const SWEEP_SCHEMAS: readonly (ExprSchemaHint | undefined)[] = [
  undefined,
  { scope: 'record' },
  { scope: 'record', roots: ['page'] },
  {
    scope: 'record',
    objectName: 'deal',
    fields: ['amount', 'close_date', 'name', 'active', 'account', 'status'],
    fieldTypes: { close_date: 'date', name: 'text', active: 'boolean', account: 'lookup' },
    roleCatalog: ['org_admin', 'sales'],
  },
  { fields: ['status', 'close_date'], objectName: 'deal', fieldTypes: { close_date: 'date' } },
  { fields: ['status'] },
  { fieldTypes: { account: 'lookup' }, traversalHydration: true },
];

const VALIDATE_CODES: ReadonlySet<string> = new Set(
  EXPRESSION_REFUSAL_CODES.filter((c) => c !== 'empty-expression' && c !== 'cel-parse-failed'),
);
const ROOTS_CODES: ReadonlySet<CelRootsRefusalCode> = new Set<CelRootsRefusalCode>(['empty-expression', 'cel-parse-failed']);

/** Every string a param carries, flattened — lists element by element, numbers as text. */
function paramStrings(params: unknown): string[] {
  const out: string[] = [];
  for (const value of Object.values(params as Record<string, unknown>)) {
    if (Array.isArray(value)) out.push(...value.map(String));
    else out.push(String(value));
  }
  return out;
}

describe('expression refusal codes — the closed set', () => {
  it('has a pin for every code, and no pin for a code outside the set', () => {
    expect(Object.keys(PINS).sort()).toEqual([...EXPRESSION_REFUSAL_CODES].sort());
    expect(new Set(EXPRESSION_REFUSAL_CODES).size).toBe(EXPRESSION_REFUSAL_CODES.length);
    for (const code of EXPRESSION_REFUSAL_CODES) expect(code).toMatch(/^[a-z]+(?:-[a-z]+)+$/);
  });

  it('is published from the package entry, frozen', () => {
    expect(formula.EXPRESSION_REFUSAL_CODES).toBe(EXPRESSION_REFUSAL_CODES);
    expect(Object.isFrozen(EXPRESSION_REFUSAL_CODES)).toBe(true);
  });

  it('every refusal validateExpression reports on the sweep carries a code from its set, with params the message interpolates', () => {
    const provoked = new Set<string>();
    let refusals = 0;
    for (const role of ['predicate', 'value', 'template'] as const) {
      for (const input of SWEEP_INPUTS) {
        for (const schema of SWEEP_SCHEMAS) {
          const r = validateExpression(role, input, schema);
          for (const said of [...r.errors, ...r.warnings]) {
            refusals++;
            expect(VALIDATE_CODES.has(said.code), `${said.code} from ${JSON.stringify(input)}`).toBe(true);
            expect(typeof said.params).toBe('object');
            expect(said.params).not.toBeNull();
            for (const part of paramStrings(said.params)) expect(said.message).toContain(part);
            provoked.add(said.code);
          }
        }
      }
    }
    // Positive control: the sweep is not vacuous — it reaches every code this
    // producer owns, so a code whose arm stopped being reachable shows up too.
    expect(refusals).toBeGreaterThan(100);
    expect([...provoked].sort()).toEqual([...VALIDATE_CODES].sort());
  });

  it('every refusal collectCelRootIdentifiers reports on the sweep carries a code from its set', () => {
    const provoked = new Set<string>();
    for (const source of SWEEP_SOURCES) {
      const r = collectCelRootIdentifiers(source);
      if (r.ok) continue;
      expect(ROOTS_CODES.has(r.code)).toBe(true);
      for (const part of paramStrings(r.params)) expect(r.error).toContain(part);
      provoked.add(r.code);
    }
    expect([...provoked].sort()).toEqual([...ROOTS_CODES].sort());
  });

  it('a refusal without a code does not type-check, on either producer', () => {
    // @ts-expect-error — `code` and `params` are required on every validateExpression refusal.
    const noCode: ExprValidationError = { source: 'x', message: 'y' };
    // @ts-expect-error — `code` and `params` are required on collectCelRootIdentifiers' failure arm.
    const noRootsCode: CelRootIdentifiersResult = { ok: false, error: 'y' };
    // @ts-expect-error — a code's params are its own: `invalid-cel` carries no `ref`.
    const wrongParams: ExprValidationError = { source: 'x', message: 'y', code: 'invalid-cel', params: { ref: 'r' } };
    expect([noCode, noRootsCode, wrongParams]).toHaveLength(3);
  });
});
