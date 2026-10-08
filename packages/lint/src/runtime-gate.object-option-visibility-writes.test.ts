// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22032, pass 3 — the OBJECT write door runs the build's per-option
 * `visibleWhen` pass.
 *
 * ## The state this closes
 *
 * `validateStackExpressions` is the build's expression rule. Its field walk
 * judges every `fields[].options[].visibleWhen` as a `record`-scoped predicate,
 * plus the #20078 refusal of a read through a reference field. After #22032's
 * pass 2 the object door ran the rest of the field walk and fenced the option
 * loop off by its own guard, so an option whose `visibleWhen` read a bare
 * `amount` — refused by `os build` — published clean, and the server's option
 * check then could not evaluate it and failed open on every write.
 *
 * ## The crossing
 *
 * No registry change: the entry already declares `object`. The option loop's
 * guard is gone, so on an object write it runs at the build's own position in
 * the field walk, and the door's finding IS the build's finding — rule,
 * location, message and hint. The object's own action predicates joined the
 * door in pass 4 (`runtime-gate.object-action-predicate-writes.test.ts`); the
 * pin that every object-borne pass judges here is in
 * `runtime-gate.object-formula-writes.test.ts`.
 *
 * ## What still publishes
 *
 * An option's evaluator binds `current_user` (ADR-0068 D1), so the build
 * accepts it there while it refuses it on the field-rule slots one level up.
 * The door gives the two verdicts the build gives: the showcase's role gate
 * (`'org_admin' in current_user.positions`) still publishes on an option, and
 * the same text on the field's own `visibleWhen` is refused, at both doors.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`,
 * `publishMetaItem` and `publishPackageDrafts` — is the #22032 pass 3 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

/**
 * The probe object; `visibleWhen` lands on the `gold` option of `tier`, and
 * `fieldVisibleWhen` (when given) on the `name` field's own slot.
 * `sharingModel` keeps `security-owd-unset` quiet, so a refusal is the rule's.
 */
const fxOption = (visibleWhen: unknown, fieldVisibleWhen?: unknown) => ({
  name: 'fx_option',
  label: 'Option Probe',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name', ...(fieldVisibleWhen === undefined ? {} : { visibleWhen: fieldVisibleWhen }) },
    amount: { type: 'number', label: 'Amount' },
    country: {
      type: 'select',
      label: 'Country',
      options: [{ label: 'China', value: 'cn' }, { label: 'United States', value: 'us' }],
    },
    account: { type: 'lookup', label: 'Account', reference: 'fx_account' },
    tier: {
      type: 'select',
      label: 'Tier',
      options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold', visibleWhen }],
    },
  },
});

const WHERE = "object 'fx_option' · field 'tier' option 'gold' visibleWhen";

/**
 * One refused body per finding the pass gives. Each `subject` is the named
 * subject of the build's finding (what the author typed), not its prose.
 */
const REFUSED = [
  // The card's shape: a bare field reference.
  { body: 'amount > 1', subject: 'bare reference `amount`' },
  { body: 'sqrt(record.amount) > 1', subject: '`sqrt`' },
  { body: 'record.amont > 1', subject: 'unknown field `amont`' },
  { body: 'record.country ==', subject: 'invalid CEL predicate' },
  // The traversal refusal, on both roots an option binds.
  { body: "record.account.name == 'x'", subject: 'reads `name` through `record.account`' },
  { body: "previous.account.name == 'x'", subject: 'reads `name` through `previous.account`' },
] as const;

/**
 * Bodies the build accepts on an option, and so must the door: the cascade,
 * the showcase's role gate, the grant check, and a reference compared as a
 * value rather than read through.
 */
const ACCEPTED = [
  "record.country == 'cn'",
  "'org_admin' in current_user.positions",
  "current_user.can('fx_option', 'edit') && 'org_admin' in current_user.positions",
  'record.account != null',
] as const;

const gateObject = (item: unknown, objects: unknown[] = []) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects } });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const buildFindings = (...objects: unknown[]) => {
  const stack = { objects };
  return expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
};

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#22032 pass 3 — the object door gives the build\'s option `visibleWhen` verdict', () => {
  it('needs no registry change: `validateStackExpressions` is already on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  for (const { body, subject } of REFUSED) {
    it(`⭐ LIT — an option's \`visibleWhen: ${body}\` is REFUSED, located at the option the author edits`, () => {
      const result = gateObject(fxOption(body));

      expect(result.rulesRun).toContain('validateStackExpressions');
      const errs = expressionFindings(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', where: WHERE, path: WHERE });
      expect(errs[0]!.message).toContain(subject);
    });
  }

  for (const body of ACCEPTED) {
    it(`⭐ CONTROL — an option's \`visibleWhen: ${body}\` still publishes clean, and the build agrees`, () => {
      const result = gateObject(fxOption(body));

      expect(result.rulesRun).toContain('validateStackExpressions');
      expect(expressionFindings(result.errors), dump(result)).toEqual([]);
      expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
      // Clean at both doors, not only this one.
      expect(buildFindings(fxOption(body))).toEqual([]);
    });
  }

  it('⭐ CONTRAST — `current_user` is accepted on the option and refused on the field\'s own slot, at both doors', () => {
    const role = "'org_admin' in current_user.positions";
    const body = fxOption(role, role);
    const atBuild = buildFindings(body);
    const atDoor = expressionFindings(gateObject(body).errors);

    // The field-rule slot's root verdict, and nothing at the option.
    expect(atBuild.map((f) => f.where), dump(atBuild)).toEqual(["object 'fx_option' · field 'name' visibleWhen"]);
    expect(atBuild[0]!.message).toContain('reads `current_user`');
    expect(atDoor, dump(atDoor)).toEqual(atBuild);
  });

  it('⭐ PARITY — for each refused body the door findings ARE the build findings', () => {
    for (const { body } of REFUSED) {
      const atBuild = buildFindings(fxOption(body));
      const atDoor = expressionFindings(gateObject(fxOption(body)).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.length, body).toBeGreaterThan(0);
      expect(atDoor, body).toEqual(atBuild);
    }
  });

  it('a stored sibling\'s broken options are not this write\'s to answer for (the differential)', () => {
    const sibling = {
      ...fxOption(REFUSED[0].body),
      name: 'fx_sibling',
      fields: {
        ...fxOption(REFUSED[0].body).fields,
        grade: {
          type: 'select',
          label: 'Grade',
          options: REFUSED.map(({ body }, i) => ({ label: `G${i}`, value: `g${i}`, visibleWhen: body })),
        },
      },
    };
    // Non-vacuous: the sibling is refused at the build.
    expect(buildFindings(sibling).length).toBeGreaterThan(0);

    const result = gateObject(fxOption(ACCEPTED[0]), [sibling]);

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});
