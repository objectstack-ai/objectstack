// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22032, pass 2 — the OBJECT write door runs the build's field-rule-slot
 * pass.
 *
 * ## The state this closes
 *
 * `validateStackExpressions` is the build's expression rule. Its field walk
 * judges every field's `requiredWhen` / `readonlyWhen` / `conditionalRequired`
 * / `visibleWhen` as a `record`-scoped predicate, with the root verdict, the
 * `parent` gate (a slot reading `parent` on an object that does not declare
 * exactly one `master_detail`), the #4811 null-guard gate over `requiredWhen`,
 * and the #20078 refusal of a `requiredWhen` / `readonlyWhen` read through a
 * reference field. #22019 put that rule on the object door for its
 * field-formula pass alone and fenced the rest off by name, so a bare
 * `requiredWhen: 'amount > 1'` — refused by `os build` — published clean, and
 * the write path then refused every write whose requirement it could not
 * evaluate (ADR-0137 D2).
 *
 * ## The crossing
 *
 * No registry change: the entry already declares `object`. The fence in
 * `runStackExpressionPasses` admits the field-rule slots on an object write,
 * at the build's own position in the field walk, so the door's finding IS the
 * build's finding — rule, location, message and hint. The per-option
 * `visibleWhen` joined the door in pass 3
 * (`runtime-gate.object-option-visibility-writes.test.ts`); the object's own
 * action predicates (pass 4) stay fenced, and that pin is in
 * `runtime-gate.object-formula-writes.test.ts`.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`,
 * `publishMetaItem` and `publishPackageDrafts` — is the #22032 pass 2 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

/**
 * The probe object; `slots` lands on its `name` field. `sharingModel` keeps
 * `security-owd-unset` quiet, so a refusal is the rule's.
 */
const fxField = (slots: Record<string, unknown>) => ({
  name: 'fx_field',
  label: 'Field Rule Probe',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name', ...slots },
    amount: { type: 'number', label: 'Amount' },
    status: {
      type: 'select',
      label: 'Status',
      options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
    },
    account: { type: 'lookup', label: 'Account', reference: 'fx_account' },
  },
});

/**
 * One refused body per slot and per gate of the pass. Each `subject` is the
 * named subject of the build's finding (what the author typed), not its prose.
 */
const REFUSED = [
  // The card's body: a bare field reference.
  { slot: 'requiredWhen', slots: { requiredWhen: 'amount > 1' }, subject: 'bare reference `amount`' },
  { slot: 'readonlyWhen', slots: { readonlyWhen: 'sqrt(record.amount) > 1' }, subject: '`sqrt`' },
  { slot: 'visibleWhen', slots: { visibleWhen: 'sqrt(record.amount) > 1' }, subject: '`sqrt`' },
  { slot: 'conditionalRequired', slots: { conditionalRequired: 'amount > 1' }, subject: 'bare reference `amount`' },
  // The root verdict: a root a field-level rule never binds.
  { slot: 'requiredWhen', slots: { requiredWhen: 'current_user.id != null' }, subject: 'reads `current_user`' },
  // The `parent` gate: `fx_field` declares no `master_detail`.
  { slot: 'readonlyWhen', slots: { readonlyWhen: "parent.status == 'paid'" }, subject: 'reads `parent`' },
  // The null-guard gate: `amount` is nullable, and the binding is total.
  { slot: 'requiredWhen', slots: { requiredWhen: 'record.amount > 100' }, subject: '`record.amount`' },
  // The traversal refusal: a field-level predicate never reads the related record.
  { slot: 'requiredWhen', slots: { requiredWhen: "record.account.name == 'x'" }, subject: 'through `record.account`' },
] as const;

/** Valid predicates on all four declared slots of the field walk. */
const VALID = {
  requiredWhen: 'record.amount != null && record.amount > 100',
  readonlyWhen: "record.status == 'closed'",
  visibleWhen: "record.status == 'open'",
};

/** A detail of `fx_field`: exactly one `master_detail`, so `parent` binds. */
const fxLine = () => ({
  name: 'fx_line',
  label: 'Line Probe',
  sharingModel: 'private',
  fields: {
    header: { type: 'master_detail', label: 'Header', reference: 'fx_field' },
    qty: {
      type: 'number',
      label: 'Quantity',
      readonlyWhen: "parent.status == 'closed'",
      requiredWhen: "parent.status == 'open'",
    },
  },
});

const gateObject = (item: unknown, objects: unknown[] = []) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects } });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const buildFindings = (...objects: unknown[]) => {
  const stack = { objects };
  return expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
};

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#22032 pass 2 — the object door gives the build\'s field-rule-slot verdict', () => {
  it('needs no registry change: `validateStackExpressions` is already on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  for (const { slot, slots, subject } of REFUSED) {
    it(`⭐ LIT — \`${slot}: ${Object.values(slots)[0]}\` is REFUSED, located at the slot the author edits`, () => {
      const result = gateObject(fxField(slots));

      expect(result.rulesRun).toContain('validateStackExpressions');
      const errs = expressionFindings(result.errors);
      const where = `object 'fx_field' · field 'name' ${slot}`;
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', where, path: where });
      expect(errs[0]!.message).toContain(subject);
    });
  }

  it('⭐ CONTROL — valid predicates on every slot publish clean, and so does a `parent`-scoped detail', () => {
    const result = gateObject(fxField(VALID));

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
    // The detail reads `parent` with its one master stored beside it.
    const line = gateObject(fxLine(), [fxField(VALID)]);
    expect(expressionFindings(line.errors), dump(line)).toEqual([]);
    expect(expressionFindings(line.advisories), dump(line)).toEqual([]);
    // And the build agrees: the control is clean at both doors, not only this one.
    expect(buildFindings(fxField(VALID), fxLine())).toEqual([]);
  });

  it('⭐ PARITY — for each refused body the door findings ARE the build findings', () => {
    for (const { slots } of REFUSED) {
      const body = fxField(slots);
      const atBuild = buildFindings(body);
      const atDoor = expressionFindings(gateObject(body).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.length, dump(slots)).toBeGreaterThan(0);
      expect(atDoor, dump(slots)).toEqual(atBuild);
    }
  });

  it('a stored sibling\'s broken field rules are not this write\'s to answer for (the differential)', () => {
    const sibling = {
      ...fxField({}),
      name: 'fx_sibling',
      fields: {
        ...fxField({}).fields,
        ...Object.fromEntries(REFUSED.map(({ slots }, i) => [`f${i}`, { type: 'text', label: `F${i}`, ...slots }])),
      },
    };
    // Non-vacuous: the sibling is refused at the build.
    expect(buildFindings(sibling).length).toBeGreaterThan(0);

    const result = gateObject(fxField(VALID), [sibling]);

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});
