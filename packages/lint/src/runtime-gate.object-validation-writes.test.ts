// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22032, pass 1 — the OBJECT write door runs the build's validation-rule
 * pass.
 *
 * ## The state this closes
 *
 * `validateStackExpressions` is the build's expression rule. Its
 * validation-rule pass judges every `validations[]` predicate: the
 * `condition` (record-scoped, with the relationship-traversal checks the rule
 * validator serves), the `conditional` rule's `when`, and the #4763 null-guard
 * gate over every predicate the rule carries, its nested `then` / `otherwise`
 * branches included. #22019 put that rule on the object door for its
 * field-formula pass alone and fenced the rest off by name, so a rule whose
 * `condition` called an unregistered function (`sqrt(record.amount) > 1`) or
 * read a bare field (`amount > 1`) published clean — and then faulted on every
 * write the rule judged.
 *
 * ## The crossing
 *
 * No registry change: the entry already declares `object`. The fence in
 * `runStackExpressionPasses` admits this pass on an object write, at the
 * build's own position in the walk, so the door's finding IS the build's
 * finding — rule, location, message and hint. The other object-borne passes
 * joined later (the field-rule slots in pass 2, option `visibleWhen` in pass
 * 3, the object's own action predicates in pass 4); the pin that every one of
 * them judges here is in `runtime-gate.object-formula-writes.test.ts`.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`
 * and `publishMetaItem` — is the #22032 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 *
 * ## #22042 — one level down
 *
 * A `conditional` rule's `then` / `otherwise` is a rule the evaluator runs,
 * yet only the null-guard gate reached its predicates: the same unregistered
 * function or bare field the top level refuses published clean one level
 * down, in `os build` and at this door alike. The pass now runs the same
 * `check()` on every nested predicate, at the location the null-guard gate
 * already gives it (`validation rule 'outer' then → 'inner'`), with the
 * relationship-traversal checks on a nested `condition` (ObjectQL hydrates it)
 * and not on a nested `when` (it does not). The second describe block below
 * pins it; its protocol half is the #22042 block of the same protocol file.
 */
import { describe, expect, it } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

/** `sharingModel` keeps `security-owd-unset` quiet, so the refusal is the rule's. */
const fxRule = (validations: unknown[]) => ({
  name: 'fx_rule',
  label: 'Rule Probe',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    status: {
      type: 'select',
      label: 'Status',
      options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
    },
  },
  validations,
});

/** The card's first body: a `condition` calling a function the stdlib does not register. */
const UNREGISTERED = { name: 'amount_root', type: 'script', condition: 'sqrt(record.amount) > 1', message: 'x' };
/** The card's second body, on this pass's own key: a bare field reference. */
const BARE = { name: 'amount_bare', type: 'script', condition: 'amount > 1', message: 'x' };
/** A `conditional` rule whose `when` is the faulting predicate (its `then` is clean). */
const WHEN = {
  type: 'conditional',
  name: 'gate',
  when: 'sqrt(record.amount) > 1',
  message: 'x',
  then: { type: 'script', name: 'child', condition: 'record.amount != null && record.amount > 100', message: 'y' },
};
/** The null-guard gate's reach into the nested branches: `amount` is nullable, and `has()` is no guard on a total binding. */
const NESTED = {
  type: 'conditional',
  name: 'gate',
  when: "record.status == 'open'",
  message: 'x',
  then: { type: 'script', name: 'child', condition: 'record.amount > 100', message: 'y' },
  otherwise: { type: 'script', name: 'other', condition: 'has(record.amount) && record.amount < 0', message: 'z' },
};
/** Valid, guarded predicates — at the top level and inside a branch. */
const VALID = [
  { name: 'cap', type: 'script', condition: 'record.amount != null && record.amount > 100', message: 'x' },
  {
    type: 'conditional',
    name: 'gate',
    when: "record.status == 'open'",
    message: 'x',
    then: { type: 'script', name: 'child', condition: 'record.amount != null && record.amount > 100', message: 'y' },
  },
];

const gateObject = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const buildFindings = (body: unknown) => {
  const stack = { objects: [body] };
  return expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
};

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#22032 pass 1 — the object door gives the build\'s validation-rule verdict', () => {
  it('needs no registry change: `validateStackExpressions` is already on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  it('⭐ LIT — a `condition` calling an unregistered function (`sqrt`) is REFUSED, located at the rule', () => {
    const result = gateObject(fxRule([UNREGISTERED]));

    expect(result.rulesRun).toContain('validateStackExpressions');
    const errs = expressionFindings(result.errors);
    const where = "object 'fx_rule' · validation 'amount_root'";
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where, path: where });
    expect(errs[0]!.message).toContain('`sqrt` is not a callable name here');
  });

  it('⭐ LIT — a bare field reference in a `condition` (`amount > 1`) is REFUSED', () => {
    const errs = expressionFindings(gateObject(fxRule([BARE])).errors);

    expect(errs, dump(errs)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ where: "object 'fx_rule' · validation 'amount_bare'" });
    expect(errs[0]!.message).toContain('bare reference `amount`');
  });

  it('⭐ LIT — a `conditional` rule\'s `when` is judged', () => {
    const errs = expressionFindings(gateObject(fxRule([WHEN])).errors);

    expect(errs, dump(errs)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ where: "object 'fx_rule' · validation 'gate' when" });
    expect(errs[0]!.message).toContain('`sqrt` is not a callable name here');
  });

  it('⭐ LIT — the null-guard gate reaches the nested `then` / `otherwise` predicates', () => {
    const errs = expressionFindings(gateObject(fxRule([NESTED])).errors);

    expect(errs.map((e) => e.where), dump(errs)).toEqual([
      "object 'fx_rule' · validation rule 'gate' then → 'child'",
      "object 'fx_rule' · validation rule 'gate' otherwise → 'other'",
    ]);
    for (const e of errs) expect(e.message).toContain('`record.amount`');
  });

  it('⭐ CONTROL — valid, guarded predicates publish clean, top level and nested', () => {
    const result = gateObject(fxRule(VALID));

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
    // And the build agrees: the control is clean at both doors, not only this one.
    expect(buildFindings(fxRule(VALID))).toEqual([]);
  });

  it('⭐ PARITY — for each refused body the door findings ARE the build findings', () => {
    for (const rule of [UNREGISTERED, BARE, WHEN, NESTED]) {
      const body = fxRule([rule]);
      const atBuild = buildFindings(body);
      const atDoor = expressionFindings(gateObject(body).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.length, dump(rule)).toBeGreaterThan(0);
      expect(atDoor, dump(rule)).toEqual(atBuild);
    }
  });

  it('a stored sibling\'s broken rule is not this write\'s to answer for (the differential)', () => {
    const sibling = { ...fxRule([UNREGISTERED, BARE]), name: 'fx_sibling' };
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: fxRule(VALID),
      context: { objects: [sibling] },
    });

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});

/** #22042 — the card's two bodies, one level down: an unregistered function in `then`, a bare field in `otherwise`. */
const NESTED_REFUSED = {
  type: 'conditional',
  name: 'outer',
  when: "record.status == 'open'",
  message: 'x',
  then: { type: 'script', name: 'inner', condition: 'sqrt(record.amount) > 1', message: 'y' },
  otherwise: { type: 'script', name: 'other', condition: 'amont > 1', message: 'z' },
};
const THEN_WHERE = "object 'fx_rule' · validation rule 'outer' then → 'inner'";
const OTHERWISE_WHERE = "object 'fx_rule' · validation rule 'outer' otherwise → 'other'";

/** Two levels: a bare field in a nested `conditional`'s own `when`, an unregistered function one level below it. */
const TWO_LEVEL = {
  type: 'conditional',
  name: 'outer',
  when: "record.status == 'open'",
  message: 'x',
  then: {
    type: 'conditional',
    name: 'mid',
    when: 'amount > 1',
    message: 'y',
    then: { type: 'script', name: 'deep', condition: 'sqrt(record.amount) > 1', message: 'z' },
  },
};

/** Valid, guarded predicates in both branches and two levels down. */
const NESTED_VALID = {
  type: 'conditional',
  name: 'outer',
  when: "record.status == 'open'",
  message: 'x',
  then: {
    type: 'conditional',
    name: 'mid',
    when: 'record.amount != null',
    message: 'y',
    // Guarded in its own source: the null-guard gate does not credit the enclosing `when`.
    then: { type: 'script', name: 'deep', condition: 'record.amount != null && record.amount > 100', message: 'z' },
  },
  otherwise: { type: 'script', name: 'other', condition: 'record.amount != null && record.amount < 0', message: 'w' },
};

/** A probe object with a reference field, for the per-slot traversal checks. */
const fxRef = (validations: unknown[]) => {
  const base = fxRule(validations);
  return { ...base, fields: { ...base.fields, account: { type: 'lookup', label: 'Account', reference: 'fx_rule' } } };
};
/** Reads more than one relationship hop — a shape `checkPredicate` refuses, and `checkConditional` never judges. */
const MULTI_HOP = 'record.account.owner.email != null';
const HYDRATION = {
  type: 'conditional',
  name: 'outer',
  when: "record.status == 'open'",
  message: 'x',
  then: { type: 'script', name: 'inner', condition: MULTI_HOP, message: 'y' },
  otherwise: {
    type: 'conditional',
    name: 'mid',
    when: MULTI_HOP,
    message: 'z',
    then: { type: 'script', name: 'deep', condition: 'record.amount != null', message: 'w' },
  },
};

describe('#22042 — a `conditional` rule\'s nested predicates meet the same verdict, at the build and at the door', () => {
  it('the fixtures are spec-valid: each refusal below is the expression verdict, not the schema\'s', () => {
    for (const body of [fxRule([NESTED_REFUSED]), fxRule([TWO_LEVEL]), fxRule([NESTED_VALID]), fxRef([HYDRATION])]) {
      const parsed = ObjectSchema.safeParse(body);
      expect(parsed.success, dump(parsed.error?.issues)).toBe(true);
    }
  });

  it('⭐ LIT — an unregistered function in `then` and a bare field in `otherwise` are REFUSED by `os build`, located at the nested rule', () => {
    const atBuild = buildFindings(fxRule([NESTED_REFUSED]));

    expect(atBuild.map((f) => f.where), dump(atBuild)).toEqual([THEN_WHERE, OTHERWISE_WHERE]);
    for (const f of atBuild) expect(f).toMatchObject({ severity: 'error', path: f.where });
    expect(atBuild[0]!.message).toContain('`sqrt` is not a callable name here');
    expect(atBuild[1]!.message).toContain('bare reference `amont`');
  });

  it('⭐ LIT — the object door REFUSES the same body, and its findings ARE the build\'s', () => {
    const result = gateObject(fxRule([NESTED_REFUSED]));

    expect(result.rulesRun).toContain('validateStackExpressions');
    const atDoor = expressionFindings(result.errors);
    expect(atDoor.map((f) => f.where), dump(result)).toEqual([THEN_WHERE, OTHERWISE_WHERE]);
    expect(atDoor).toEqual(buildFindings(fxRule([NESTED_REFUSED])));
  });

  it('⭐ LIT — two levels down: a nested `conditional`\'s `when` and the rule below it are judged', () => {
    const atBuild = buildFindings(fxRule([TWO_LEVEL]));

    expect(atBuild.map((f) => f.where), dump(atBuild)).toEqual([
      "object 'fx_rule' · validation rule 'outer' then → 'mid' when-predicate",
      "object 'fx_rule' · validation rule 'outer' then → 'mid' then → 'deep'",
    ]);
    expect(atBuild[0]!.message).toContain('bare reference `amount`');
    expect(atBuild[1]!.message).toContain('`sqrt` is not a callable name here');
    expect(expressionFindings(gateObject(fxRule([TWO_LEVEL])).errors)).toEqual(atBuild);
  });

  it('⭐ CONTROL — valid nested predicates publish clean, two levels down and in `otherwise`', () => {
    const result = gateObject(fxRule([NESTED_VALID]));

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
    expect(buildFindings(fxRule([NESTED_VALID]))).toEqual([]);
  });

  it('each predicate is judged ONCE: the rule\'s own `condition` / `when` keep their location and are not re-judged as nested', () => {
    // A top-level `condition` — one finding, at the rule's own location only.
    const top = buildFindings(fxRule([UNREGISTERED]));
    expect(top.map((f) => f.where), dump(top)).toEqual(["object 'fx_rule' · validation 'amount_root'"]);
    // A faulting top-level `when` beside a faulting nested `then` — one finding each.
    const both = buildFindings(fxRule([{ ...WHEN, then: NESTED_REFUSED.then }]));
    expect(both.map((f) => f.where), dump(both)).toEqual([
      "object 'fx_rule' · validation 'gate' when",
      "object 'fx_rule' · validation rule 'gate' then → 'inner'",
    ]);
  });

  it('the traversal checks follow the evaluator per slot: ON for a nested `condition`, OFF for a nested `when`', () => {
    const atBuild = buildFindings(fxRef([HYDRATION]));

    // `checkPredicate` refuses a read deeper than one hop at any depth, so the build says so…
    expect(atBuild.map((f) => f.where), dump(atBuild)).toEqual(["object 'fx_rule' · validation rule 'outer' then → 'inner'"]);
    expect(atBuild[0]!.message).toContain('ONE hop');
    // …and `checkConditional` never hydrates a `when`, so the same source there earns no
    // traversal prescription — exactly as the top-level `when` site is opted out.
    const topWhen = buildFindings(fxRef([{ ...HYDRATION, when: MULTI_HOP, then: NESTED_VALID.otherwise, otherwise: undefined }]));
    expect(topWhen, dump(topWhen)).toEqual([]);
    expect(expressionFindings(gateObject(fxRef([HYDRATION])).errors)).toEqual(atBuild);
  });

  it('a stored sibling\'s nested fault is not this write\'s to answer for (the differential)', () => {
    const sibling = { ...fxRule([NESTED_REFUSED, TWO_LEVEL]), name: 'fx_sibling' };
    const result = runRuntimeAuthoringRules({ type: 'object', item: fxRule([NESTED_VALID]), context: { objects: [sibling] } });

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});
