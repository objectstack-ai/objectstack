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
 * (`runtime-gate.object-option-visibility-writes.test.ts`), and since its
 * pass 4 the object's own action predicates
 * (`runtime-gate.object-action-predicate-writes.test.ts`). Every pass over the
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

describe('#22019 / #22032 — every pass over the object\'s body judges on this door, and no pass over another collection', () => {
  /**
   * One body carrying a fault in EVERY pass over the object's own body — the
   * validation-rule pass (#22032 pass 1), a field-rule slot (`requiredWhen`,
   * pass 2), an option's `visibleWhen` (pass 3) and an object action's
   * `visible` and `disabled` (pass 4) — beside a CLEAN formula. Since pass 4 no
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
    actions: [
      { name: 'fx_close', label: 'Close', type: 'script', target: 'close', visible: 'record.status ==', disabled: 'amount > 1' },
    ],
  });
  /** Every object-borne site of the body (passes 1–4), by the build's `where`, in the build's order. */
  const LIFTED_SITES = [
    "object 'fx_sqrt' · validation 'amount_root'",
    "object 'fx_sqrt' · field 'name' requiredWhen",
    "object 'fx_sqrt' · field 'tier' option 'gold' visibleWhen",
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
    // [#22032 passes 1–4] Every lifted pass's finding, in the build's order, and nothing else.
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
      ...LIFTED_SITES.slice(0, 3),
      OTHER_SITES[1],
      ...LIFTED_SITES.slice(3),
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
