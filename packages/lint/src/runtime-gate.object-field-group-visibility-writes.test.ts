// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26646 — the build and the OBJECT write door judge a field group's
 * `visibleWhen`.
 *
 * ## The state this closes
 *
 * `ObjectFieldGroupSchema.visibleWhen` is a live slot: the form renderer gates
 * the whole group on it, header included, and a predicate that faults hides
 * the group (fail-closed). No pass of `validateStackExpressions` read it, so
 * the card's body — `record.no_such_field == 'x'` on a group — saved with a
 * 200 and the group vanished from every form, while the same text on a
 * field's `visibleWhen` or an action's `visible` was refused 422 at the same
 * door.
 *
 * ## The crossing
 *
 * No registry change: the entry already declares `object`. The field-group
 * pass runs in the object walk, after the field walk, with the field
 * `visibleWhen` slot's verdict (the `record`-scoped check and the root
 * verdict). It is not fenced on an object write, so the door's finding IS the
 * build's finding — rule, location, message and hint — located at the group's
 * key.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem` —
 * is the #26646 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

/**
 * The card's probe object, verbatim but for the predicate: `stage` sits in
 * group `g1`, whose `visibleWhen` is the body under test.
 */
const fxGroup = (visibleWhen: unknown, name = 'qa_fg_probe') => ({
  name,
  label: 'QA',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage', group: 'g1' },
  },
  fieldGroups: [{ key: 'g1', label: 'G1', visibleWhen }],
});

const WHERE = "object 'qa_fg_probe' · field group 'g1' visibleWhen";

/** The card's body: a read of a field the object does not declare. */
const CARD_BODY = "record.no_such_field == 'x'";

/**
 * One refused body per finding the pass gives. Each `subject` is the named
 * subject of the build's finding (what the author typed), not its prose.
 */
const REFUSED = [
  { body: CARD_BODY, subject: 'unknown field `no_such_field`' },
  { body: "stage == 'won'", subject: 'bare reference `stage`' },
  { body: 'sqrt(record.stage) > 1', subject: '`sqrt`' },
  { body: 'record.stage ==', subject: 'invalid CEL predicate' },
  // The root verdict: a root the field-rule family never binds.
  { body: "'org_admin' in current_user.positions", subject: 'reads `current_user`' },
] as const;

/** Bodies the build accepts on a field's `visibleWhen`, and so must accept on a group. */
const ACCEPTED = [
  "record.stage == 'won'",
  "record.stage != null && record.name != ''",
  "previous.stage != record.stage",
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

describe('#26646 — the object door gives the build\'s field group `visibleWhen` verdict', () => {
  it('needs no registry change: `validateStackExpressions` is already on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  for (const { body, subject } of REFUSED) {
    it(`⭐ LIT — a group's \`visibleWhen: ${body}\` is REFUSED, located at the group's key`, () => {
      const result = gateObject(fxGroup(body));

      expect(result.rulesRun).toContain('validateStackExpressions');
      const errs = expressionFindings(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', where: WHERE, path: WHERE });
      expect(errs[0]!.message).toContain(subject);
    });
  }

  for (const body of ACCEPTED) {
    it(`⭐ CONTROL — a group's \`visibleWhen: ${body}\` still publishes clean, and the build agrees`, () => {
      const result = gateObject(fxGroup(body));

      expect(result.rulesRun).toContain('validateStackExpressions');
      expect(expressionFindings(result.errors), dump(result)).toEqual([]);
      expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
      expect(buildFindings(fxGroup(body))).toEqual([]);
    });
  }

  it('⭐ CONTROL — a group with no `visibleWhen` publishes clean', () => {
    const result = gateObject(fxGroup(undefined));

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
  });

  it('⭐ PARITY — the card\'s body earns the same finding on the group as on the field\'s own `visibleWhen`', () => {
    const onGroup = expressionFindings(gateObject(fxGroup(CARD_BODY)).errors);
    const onField = expressionFindings(
      gateObject({
        ...fxGroup(undefined),
        fields: { ...fxGroup(undefined).fields, stage: { type: 'text', label: 'Stage', group: 'g1', visibleWhen: CARD_BODY } },
      }).errors,
    );

    expect(onField.map((f) => f.where)).toEqual(["object 'qa_fg_probe' · field 'stage' visibleWhen"]);
    expect(onGroup.map((f) => f.message), dump(onGroup)).toEqual(onField.map((f) => f.message));
  });

  it('⭐ PARITY — for each refused body the door findings ARE the build findings', () => {
    for (const { body } of REFUSED) {
      const atBuild = buildFindings(fxGroup(body));
      const atDoor = expressionFindings(gateObject(fxGroup(body)).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.length, body).toBeGreaterThan(0);
      expect(atDoor, body).toEqual(atBuild);
    }
  });

  it('the root verdict is worded for the group, and names its fail-closed consequence', () => {
    const errs = expressionFindings(gateObject(fxGroup(REFUSED[4].body)).errors);

    expect(errs, dump(errs)).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/^`visibleWhen` reads `current_user`, but a field group's section predicate binds only `record`/);
    expect(errs[0]!.message).toContain('fails CLOSED');
  });

  it('a stored sibling\'s broken group is not this write\'s to answer for (the differential)', () => {
    const sibling = fxGroup(CARD_BODY, 'qa_fg_sibling');
    // Non-vacuous: the sibling is refused at the build.
    expect(buildFindings(sibling).length).toBeGreaterThan(0);

    const result = gateObject(fxGroup(ACCEPTED[0]), [sibling]);

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});
