// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22019 — the OBJECT write door runs the build's field-formula pass, and only
 * that pass.
 *
 * ## The state this closes
 *
 * `validateStackExpressions` is the build's expression rule. Its field-formula
 * pass calls `validateExpression('value', …)` on every `fields[].expression` —
 * the verdict `formulas.mdx` says backs both `os build` and metadata
 * registration. The entry declared `runtimeTypes: ['flow', 'action', 'hook']`,
 * so on an `object` write the gate never dispatched it: a formula calling an
 * unregistered function (`sqrt(record.amount)`) published clean and read
 * `null` on every row.
 *
 * ## The crossing, and its fence
 *
 * `object` joins `runtimeTypes`, and the gate's `runtimeWriteType` reaches the
 * rule (`runStackExpressionPasses`), which on an object write runs the
 * field-formula pass — and, since #22032's pass 1, the validation-rule pass
 * (its pins: `runtime-gate.object-validation-writes.test.ts`), since its
 * pass 2 the field-rule slots (`runtime-gate.object-field-rule-writes.test.ts`),
 * since its pass 3 the per-option `visibleWhen`
 * (`runtime-gate.object-option-visibility-writes.test.ts`), since its
 * pass 4 the object's own action predicates
 * (`runtime-gate.object-action-predicate-writes.test.ts`), and since #26646 a
 * field group's `visibleWhen`
 * (`runtime-gate.object-field-group-visibility-writes.test.ts`). Every pass over the
 * object's own body now judges here; the passes over the stack's OTHER
 * collections (flows, top-level actions, sharing rules, hooks) do not. Both
 * halves are pinned below with the build still flagging the same body, so a
 * fence re-added on any object-borne pass, or a pass over another collection
 * reaching this door, moves that line consciously rather than by drift.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`
 * and `publishMetaItem`, and the door/build equality of the finding — is
 * the #22019 block of `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';
import { STORED_EXPRESSION_CROSS_RECORD_INPUT, STORED_EXPRESSION_VOLATILE_INPUT } from './stored-expression-inputs.js';

/** The card's object, with the formula under test. `sharingModel` keeps `security-owd-unset` quiet. */
const fxSqrt = (expression: string, over: Record<string, unknown> = {}) => ({
  name: 'fx_sqrt',
  label: 'Formula Probe',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    score: { type: 'formula', label: 'Score', expression },
  },
  ...over,
});

const WHERE = "object 'fx_sqrt' · field 'score' expression";

const gateObject = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#22019 — the object door dispatches the build\'s expression rule', () => {
  it('`validateStackExpressions` is on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  it('⭐ LIT — a formula calling an unregistered function (`sqrt`) is REFUSED, located at the key the author edits', () => {
    const result = gateObject(fxSqrt('sqrt(record.amount)'));

    expect(result.rulesRun).toContain('validateStackExpressions');
    const errs = expressionFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where: WHERE, path: WHERE });
    expect(errs[0]!.message).toContain('`sqrt` is not a callable name here');
  });

  it('⭐ LIT — a formula reading a field the object has not got is REFUSED (the same pass, its field-existence half)', () => {
    const result = gateObject(fxSqrt('floor(record.amont)'));

    const errs = expressionFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ where: WHERE });
    expect(errs[0]!.message).toContain('amont');
  });

  it('⭐ CONTROL — a registered call (`floor(record.amount)`) publishes clean', () => {
    const result = gateObject(fxSqrt('floor(record.amount)'));

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
  });

  it('⭐ PARITY — the door finding IS the build finding for the same body', () => {
    const body = fxSqrt('sqrt(record.amount)');
    const atDoor = expressionFindings(gateObject(body).errors);
    const stack = { objects: [body] };
    const atBuild = expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));

    expect(atBuild).toHaveLength(1);
    expect(atDoor).toEqual(atBuild);
  });

  it('a stored sibling\'s broken formula is not this write\'s to answer for (the differential)', () => {
    const sibling = { ...fxSqrt('sqrt(record.amount)'), name: 'fx_sibling' };
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: fxSqrt('floor(record.amount)'),
      context: { objects: [sibling] },
    });

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});

describe('#24410 — the object door refuses a formula hop to a field the target does not declare', () => {
  /** The lookup's target, delivered by ANOTHER package the written one depends on. */
  const book = {
    name: 'fx_book', label: 'Book', sharingModel: 'private', _packageId: 'com.example.library',
    fields: { title: { type: 'text', label: 'Title' } },
  };
  const loan = (expression: string) => ({
    name: 'fx_loan',
    label: 'Loan',
    sharingModel: 'private',
    fields: {
      book: { type: 'lookup', label: 'Book', reference: 'fx_book' },
      summary: { type: 'formula', label: 'Summary', expression },
    },
  });
  const gateLoan = (expression: string) => runRuntimeAuthoringRules({
    type: 'object',
    item: loan(expression),
    context: { objects: [book] },
    packageScope: { packageId: 'com.example.loans', dependencies: ['com.example.library'] },
  });
  const LOAN_WHERE = "object 'fx_loan' · field 'summary' expression";

  it('⭐ LIT — the read is REFUSED under EXPRESSION_INVALID, naming the field and the target from the other package', () => {
    const result = gateLoan('record.book.name');

    const errs = expressionFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where: LOAN_WHERE, path: LOAN_WHERE });
    expect(errs[0]!.message).toContain('unknown field `name` on `fx_book`');
  });

  it('⭐ CONTROL — a read of a field the target declares publishes clean', () => {
    const result = gateLoan('record.book.title');

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
  });
});

describe('#22019 / #22032 — every pass over the object\'s body judges on this door, and no pass over another collection', () => {
  /**
   * One body carrying a fault in EVERY pass over the object's own body — the
   * validation-rule pass (#22032 pass 1), a field-rule slot (`requiredWhen`,
   * pass 2), an option's `visibleWhen` (pass 3), an object action's
   * `visible` and `disabled` (pass 4) and a field group's `visibleWhen`
   * (#26646) — beside a CLEAN formula. Since pass 4 no
   * object-borne site is fenced: the build and the object door flag the same
   * sites in the same order. Each fault is one the build refuses at `error`,
   * so a fence put back on any of these passes drops its site from the door's
   * list and turns the pins below red.
   */
  const withEverySite = () => fxSqrt('floor(record.amount)', {
    validations: [
      { name: 'amount_root', type: 'script', condition: 'sqrt(record.amount) > 1', message: 'x', severity: 'error' },
    ],
    fields: {
      name: { type: 'text', label: 'Name', requiredWhen: 'amount > 1' },
      amount: { type: 'number', label: 'Amount' },
      score: { type: 'formula', label: 'Score', expression: 'floor(record.amount)' },
      tier: {
        type: 'select',
        label: 'Tier',
        options: [{ label: 'Gold', value: 'gold', visibleWhen: 'amount > 1' }],
      },
    },
    fieldGroups: [{ key: 'g1', label: 'G1', visibleWhen: 'amount > 1' }],
    actions: [
      { name: 'fx_close', label: 'Close', type: 'script', target: 'close', visible: 'record.status ==', disabled: 'amount > 1' },
    ],
  });
  /** Every object-borne site of the body (passes 1–4 and #26646), by the build's `where`, in the build's order. */
  const LIFTED_SITES = [
    "object 'fx_sqrt' · validation 'amount_root'",
    "object 'fx_sqrt' · field 'name' requiredWhen",
    "object 'fx_sqrt' · field 'tier' option 'gold' visibleWhen",
    "object 'fx_sqrt' · field group 'g1' visibleWhen",
    "object 'fx_sqrt' · action 'fx_close' visible",
    "object 'fx_sqrt' · action 'fx_close' disabled",
  ];
  /**
   * A fault in each pass over ANOTHER collection of the stack — a top-level
   * action, a flow, a sharing rule, a hook — each bound to the same object. The
   * build flags each; an object write never judges them (they are not the
   * object's body, and each is judged at its own type's door).
   */
  const otherCollections = {
    actions: [{ name: 'fx_top', label: 'Top', type: 'script', target: 't', objectName: 'fx_sqrt', visible: 'record.status ==' }],
    flows: [{
      name: 'fx_flow',
      label: 'Flow',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', config: { objectName: 'fx_sqrt' } }, { id: 'end', type: 'end' }],
      edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'record.status ==' }],
    }],
    sharingRules: [{ name: 'fx_share', object: 'fx_sqrt', type: 'criteria', condition: 'amount > 1' }],
    hooks: [{ name: 'fx_hook', object: 'fx_sqrt', events: ['beforeInsert'], condition: 'amount > 1' }],
  };
  const OTHER_SITES = [
    "flow 'fx_flow' · edge 'e1' (start→end) condition",
    "stack · action 'fx_top' visible",
    "sharingRule 'fx_share' (fx_sqrt) condition",
    "hook 'fx_hook' (fx_sqrt) condition",
  ];

  it('the build (no `runtimeWriteType`) flags each object-borne site, and nothing at the clean formula', () => {
    const wheres = validateStackExpressions({ objects: [withEverySite()] })
      .filter((i) => (i.severity ?? 'error') === 'error')
      .map((i) => i.where);

    expect(wheres, dump(wheres)).toEqual(LIFTED_SITES);
    expect(wheres.some((w) => w === WHERE), 'the clean formula must not be flagged').toBe(false);
  });

  it('the object door flags every object-borne site — no pass over the object\'s body is fenced', () => {
    const result = gateObject(withEverySite());

    expect(result.rulesRun).toContain('validateStackExpressions');
    // [#22032 passes 1–4, #26646] Every lifted pass's finding, in the build's order, and nothing else.
    expect(expressionFindings(result.errors).map((f) => f.where), dump(result)).toEqual(LIFTED_SITES);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
  });

  it('the narrowing is the rule\'s, keyed on the write type — an object write never runs a pass over another collection', () => {
    const stack = { objects: [withEverySite()], ...otherCollections };
    const all = validateStackExpressions(stack);
    // Non-vacuous: the build flags every site, the other collections' included,
    // in its own walk order (flows, the object's body, actions, sharing rules, hooks).
    expect(all.map((i) => i.where), dump(all)).toEqual([
      OTHER_SITES[0],
      ...LIFTED_SITES.slice(0, 4),
      OTHER_SITES[1],
      ...LIFTED_SITES.slice(4),
      OTHER_SITES[2],
      OTHER_SITES[3],
    ]);
    // A flow write still runs every pass it ran: the option narrows ONLY on `object`.
    expect(runStackExpressionPasses(stack, { runtimeWriteType: 'flow' })).toEqual(all);
    // The object pass set is the build's own findings on the object's body —
    // a strict subset, in the build's order, none from another collection.
    const onObjectWrite = runStackExpressionPasses(stack, { runtimeWriteType: 'object' });
    expect(onObjectWrite.map((i) => i.where)).toEqual(LIFTED_SITES);
    expect(onObjectWrite).toEqual(all.filter((i) => LIFTED_SITES.includes(i.where)));
  });
});

describe('#32529 / #32554 — the object door judges a stored expression\'s inputs as the build does', () => {
  /** The related record, delivered by the stored universe the door reads. */
  const employee = {
    name: 'fx_employee', label: 'Employee', sharingModel: 'private',
    fields: { daily_hours: { type: 'number', label: 'Daily Hours' } },
  };
  /** The written object, with one stored computed field `hours` (a `number`, not a `formula`). */
  const leave = (expression: string, type = 'number') => ({
    name: 'fx_leave',
    label: 'Leave',
    sharingModel: 'private',
    fields: {
      employee: { type: 'lookup', label: 'Employee', reference: 'fx_employee' },
      days: { type: 'number', label: 'Days' },
      hours: { type, label: 'Hours', expression },
    },
  });
  const LEAVE_WHERE = "object 'fx_leave' · field 'hours' expression";
  const gateLeave = (expression: string, type?: string) =>
    runRuntimeAuthoringRules({ type: 'object', item: leave(expression, type), context: { objects: [employee] } });
  const ofRule = <T extends { rule: string }>(rule: string, fs: readonly T[]): T[] => fs.filter((f) => f.rule === rule);

  it('⭐ LIT — a stored expression reading another record is an ADVISORY at the door, under its own rule id, never a 422', () => {
    const result = gateLeave('record.days * record.employee.daily_hours');

    const advised = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, result.advisories);
    expect(advised, dump(result)).toHaveLength(1);
    expect(advised[0]).toMatchObject({ severity: 'warning', where: LEAVE_WHERE, path: LEAVE_WHERE });
    expect(result.errors, dump(result)).toEqual([]);
  });

  it('⭐ LIT — a hop through the injected `owner_id` is advised too, on an object that does not declare it', () => {
    const result = gateLeave("record.?owner_id.?name.orValue('')", 'text');

    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, result.advisories), dump(result)).toHaveLength(1);
    expect(result.errors, dump(result)).toEqual([]);
  });

  it('⭐ LIT — a re-save of an object STORED with the hop still saves: the advisory is repeated, nothing is refused', () => {
    const stored = leave('record.days * record.employee.daily_hours');
    const result = runRuntimeAuthoringRules({ type: 'object', item: stored, context: { objects: [employee, stored] } });

    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, result.advisories), dump(result)).toHaveLength(1);
    expect(result.errors, dump(result)).toEqual([]);
  });

  it('⭐ LIT — a stored expression reading the clock is an ADVISORY at the door, never a refusal', () => {
    const result = gateLeave('today()', 'date');

    expect(ofRule(STORED_EXPRESSION_VOLATILE_INPUT, result.advisories), dump(result)).toHaveLength(1);
    expect(result.errors, dump(result)).toEqual([]);
  });

  it('⭐ CONTROL — a same-row stored expression, and a `formula` reading the hop, publish clean', () => {
    for (const result of [gateLeave('record.days * 8'), gateLeave('record.days * record.employee.daily_hours', 'formula')]) {
      expect(result.errors, dump(result)).toEqual([]);
      expect(result.advisories, dump(result)).toEqual([]);
    }
  });

  it('⭐ PARITY — the door finding IS the build finding for the same body', () => {
    const body = leave('record.days * record.employee.daily_hours');
    const atDoor = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, gateLeave('record.days * record.employee.daily_hours').advisories);
    const stack = { objects: [employee, body] };
    const atBuild = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, runAuthoringRules('build', { normalized: stack, parsed: stack }));

    expect(atBuild).toHaveLength(1);
    expect(atDoor).toEqual(atBuild);
  });
});

describe('#33072 — the object_extension door judges an extension field\'s formula as the build does', () => {
  /** The extended object, as the door's live universe carries it. */
  const target = {
    name: 'fx_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: {
      employee: { type: 'lookup', label: 'Employee', reference: 'fx_staff' },
      amount: { type: 'number', label: 'Amount' },
    },
  };
  const staff = {
    name: 'fx_staff', label: 'Staff', sharingModel: 'private',
    fields: { daily_hours: { type: 'number', label: 'Daily Hours' } },
  };
  /** One extension of `fx_ticket` adding the given fields. */
  const extension = (fields: Record<string, unknown>) => ({ extend: 'fx_ticket', fields });
  const scoreOf = (expression: string) => extension({ score: { type: 'formula', label: 'Score', expression } });
  const EXT_WHERE = (field: string) => `object 'fx_ticket' · objectExtensions[0] · field '${field}' expression`;
  const gateExtension = (item: unknown, objects: unknown[] = [target, staff]) =>
    runRuntimeAuthoringRules({ type: 'object_extension', item, context: { objects } });
  const ofRule = <T extends { rule: string }>(rule: string, fs: readonly T[]): T[] => fs.filter((f) => f.rule === rule);

  it('`validateStackExpressions` is on the object_extension door, beside the vocabulary freeze', () => {
    expect(runtimeAuthoringRulesFor('object_extension').map((r) => r.name))
      .toEqual(['validateStackExpressions', 'validateSecurityRoleWord']);
  });

  it('⭐ LIT — an extension formula calling an unregistered function (`sqrt`) is REFUSED, at the entry the build names', () => {
    const result = gateExtension(scoreOf('sqrt(record.amount)'));

    expect(result.rulesRun).toContain('validateStackExpressions');
    const errs = expressionFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where: EXT_WHERE('score'), path: EXT_WHERE('score') });
  });

  it('⭐ LIT — an extension formula reading a field the extended object does not serve is REFUSED', () => {
    const result = gateExtension(scoreOf('record.amont * 2'));

    const errs = expressionFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]!.where).toBe(EXT_WHERE('score'));
    expect(errs[0]!.message).toContain('amont');
  });

  it('⭐ LIT — a stored extension field reading another record is an ADVISORY, never a 422', () => {
    const result = gateExtension(extension({
      hours: { type: 'number', label: 'Hours', expression: 'record.amount * record.employee.daily_hours' },
    }));

    const advised = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, result.advisories);
    expect(advised, dump(result)).toHaveLength(1);
    expect(advised[0]).toMatchObject({ severity: 'warning', where: EXT_WHERE('hours') });
    expect(result.errors, dump(result)).toEqual([]);
  });

  it('⭐ PARITY — on one shared input, the door finding IS the build finding', () => {
    for (const item of [
      scoreOf('sqrt(record.amount)'),
      extension({ hours: { type: 'number', label: 'Hours', expression: 'record.amount * record.employee.daily_hours' } }),
    ]) {
      const atDoor = gateExtension(item);
      const stack = { objects: [target, staff], objectExtensions: [item] };
      const atBuild = runAuthoringRules('build', { normalized: stack, parsed: stack })
        .filter((f) => f.where.includes('objectExtensions'));

      expect(atBuild.length, dump(atBuild)).toBe(1);
      expect([...atDoor.errors, ...atDoor.advisories]).toEqual(atBuild);
    }
  });

  it('⭐ CONTROL — a valid extension formula, and one reading a field the same extension adds, publish clean', () => {
    for (const item of [
      scoreOf('floor(record.amount)'),
      extension({
        bonus: { type: 'number', label: 'Bonus' },
        total: { type: 'formula', label: 'Total', expression: 'record.amount + record.bonus' },
      }),
    ]) {
      const result = gateExtension(item);
      expect(result.errors, dump(result)).toEqual([]);
      expect(result.advisories, dump(result)).toEqual([]);
      expect(result.rulesRun).toEqual(['validateStackExpressions', 'validateSecurityRoleWord']);
    }
  });

  it('an extension of an object the door does not carry is judged on what does not depend on its fields', () => {
    expect(expressionFindings(gateExtension(scoreOf('sqrt(record.amount)'), []).errors)).toHaveLength(1);
    const read = gateExtension(scoreOf('record.amount * 2'), []);
    expect(read.errors, dump(read)).toEqual([]);
  });

  it('a stored object\'s own broken formula is not the extension write\'s to answer for (the differential)', () => {
    const broken = { ...target, fields: { ...target.fields, bad: { type: 'formula', label: 'Bad', expression: 'sqrt(record.amount)' } } };
    const result = gateExtension(scoreOf('floor(record.amount)'), [broken, staff]);

    expect(result.errors, dump(result)).toEqual([]);
  });

  it('on an extension write only the extension walk judges: no pass over the objects the door carries', () => {
    const broken = { ...target, fields: { ...target.fields, bad: { type: 'formula', label: 'Bad', expression: 'sqrt(record.amount)' } } };
    const stack = { objects: [broken, staff], objectExtensions: [scoreOf('floor(record.amount)')] };
    // The build judges the declared formula…
    expect(validateStackExpressions(stack).map((i) => i.where)).toEqual(["object 'fx_ticket' · field 'bad' expression"]);
    // …the extension door's pass reads only the written entry.
    expect(runStackExpressionPasses(stack, { runtimeWriteType: 'object_extension' })).toEqual([]);
  });

  it('CONTROL — the object save door is unchanged: it judges the object\'s own formula and no extension field', () => {
    const result = gateObject(fxSqrt('sqrt(record.amount)'));
    expect(expressionFindings(result.errors).map((f) => f.where)).toEqual([WHERE]);
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });
});
