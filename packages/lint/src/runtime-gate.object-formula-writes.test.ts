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
 * (its pins: `runtime-gate.object-validation-writes.test.ts`), and since its
 * pass 2 the field-rule slots (`runtime-gate.object-field-rule-writes.test.ts`).
 * Every other object-borne pass the build runs — option `visibleWhen`, the
 * object's own action predicates — is FENCED off this door by name, and the
 * fence is pinned below with the build still flagging the same body, so a
 * later widening moves that line consciously rather than by drift.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`
 * and `publishMetaItem`, and the door/build equality of the finding — is
 * the #22019 block of `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';

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

describe('#22019 — the fence: every other object-borne expression pass stays off this door', () => {
  /**
   * One body carrying a fault in each FENCED pass — #22032's passes 3 and 4,
   * one site each: an option's `visibleWhen`, an object action's `visible` —
   * beside a fault in each LIFTED pass, the validation-rule pass (#22032 pass
   * 1) and a field-rule slot (`requiredWhen`, #22032 pass 2), and a CLEAN
   * formula. The build flags every fault; the object door flags the lifted
   * passes' alone. Each fault is one the build refuses at `error`, so "the
   * door is silent on a fenced site" cannot be read as "there was nothing to
   * say".
   */
  const fenced = () => fxSqrt('floor(record.amount)', {
    validations: [
      { name: 'amount_root', type: 'script', condition: 'sqrt(record.amount) > 1', message: 'x', severity: 'error' },
    ],
    actions: [
      { name: 'fx_close', label: 'Close', type: 'script', target: 'close', visible: 'record.status ==' },
    ],
  });
  const withFieldRule = () => {
    const body = fenced();
    const fields = body.fields as Record<string, unknown>;
    fields.name = { type: 'text', label: 'Name', requiredWhen: 'amount > 1' };
    fields.tier = {
      type: 'select',
      label: 'Tier',
      options: [{ label: 'Gold', value: 'gold', visibleWhen: 'amount > 1' }],
    };
    return body;
  };
  /** The fenced sites (passes 3–4) and the lifted ones (passes 1–2), by the build's `where`, in the build's order. */
  const FENCED_SITES = [
    "object 'fx_sqrt' · field 'tier' option 'gold' visibleWhen",
    "object 'fx_sqrt' · action 'fx_close' visible",
  ];
  const LIFTED_SITES = [
    "object 'fx_sqrt' · validation 'amount_root'",
    "object 'fx_sqrt' · field 'name' requiredWhen",
  ];

  it('the build (no `runtimeWriteType`) still flags each fenced site, and the lifted ones', () => {
    const wheres = validateStackExpressions({ objects: [withFieldRule()] })
      .filter((i) => (i.severity ?? 'error') === 'error')
      .map((i) => i.where);

    for (const site of [...FENCED_SITES, ...LIFTED_SITES]) {
      expect(wheres.includes(site), `${site}\n${dump(wheres)}`).toBe(true);
    }
    expect(wheres.some((w) => w === WHERE), 'the clean formula must not be flagged').toBe(false);
  });

  it('the object door flags none of the fenced sites — only the formula, validation-rule and field-rule-slot passes judge there', () => {
    const result = gateObject(withFieldRule());

    expect(result.rulesRun).toContain('validateStackExpressions');
    // [#22032 passes 1–2] The lifted passes' findings, and nothing else.
    expect(expressionFindings(result.errors).map((f) => f.where), dump(result)).toEqual(LIFTED_SITES);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
  });

  it('the narrowing is the rule\'s, keyed on the write type — a flow write still runs every pass it ran', () => {
    // `runtimeWriteType: 'flow'` is what the gate passes on a flow write; the
    // option narrows ONLY on `object`, so nothing about the three existing
    // doors moves.
    const stack = { objects: [withFieldRule()] };
    const all = validateStackExpressions(stack);
    expect(runStackExpressionPasses(stack, { runtimeWriteType: 'flow' })).toEqual(all);
    // And the object pass set is the build's own findings on the admitted
    // passes — a strict subset, in the build's order, none from a fenced site.
    const onObjectWrite = runStackExpressionPasses(stack, { runtimeWriteType: 'object' });
    expect(onObjectWrite.map((i) => i.where)).toEqual(LIFTED_SITES);
    expect(onObjectWrite).toEqual(all.filter((i) => LIFTED_SITES.includes(i.where) || i.where === WHERE));
  });
});
