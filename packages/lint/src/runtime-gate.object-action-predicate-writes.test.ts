// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22032, pass 4 — the OBJECT write door runs the build's pass over the
 * object's own action predicates.
 *
 * ## The state this closes
 *
 * `validateStackExpressions` is the build's expression rule. It judges every
 * object action's `visible`, and its `disabled` unless that is a boolean
 * literal, as a `record`-scoped predicate (`checkAction`). After #22032's
 * pass 3 the object door ran every other pass over the object's body and kept
 * this one fenced, so an action whose `visible` read a bare `amount` — refused
 * by `os build` — published clean, and the action runtime's fail-closed
 * evaluation then hid the action on every record.
 *
 * ## The crossing
 *
 * No registry change: the entry already declares `object`. The object action
 * loop's guard is gone, so the door's finding IS the build's finding for an
 * object body — rule, location, message and hint. The one location that
 * differs is pinned below: an action ALSO declared top-level is located by the
 * build at `stack · action …`, and by the door at the object.
 *
 * ## What still publishes
 *
 * The shapes the platform and the examples ship: a `record` comparison, the
 * `{ dialect, source }` envelope, a `current_user.positions` role gate, a
 * `current_user.isPlatformAdmin` check, a `features.*` switch, and a boolean
 * literal, which the build never judges as a predicate.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`,
 * `publishMetaItem` and `publishPackageDrafts` — is the #22032 pass 4 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

/**
 * The probe object; `visible` and `disabled` land on its one action,
 * `fx_close`. `sharingModel` keeps `security-owd-unset` quiet, so a refusal is
 * the rule's.
 */
const fxAction = (visible: unknown, disabled?: unknown, name = 'fx_action') => ({
  name,
  label: 'Action Probe',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    status: { type: 'text', label: 'Status' },
  },
  actions: [
    {
      name: 'fx_close',
      label: 'Close',
      type: 'script',
      target: 'close',
      visible,
      ...(disabled === undefined ? {} : { disabled }),
    },
  ],
});

const whereOf = (key: 'visible' | 'disabled', object = 'fx_action') => `object '${object}' · action 'fx_close' ${key}`;

/** The clean `visible` every `disabled` body below rides beside. */
const OPEN = "record.status == 'open'";

/**
 * One refused body per finding kind the pass gives, on both keys. Each
 * `subject` is the named subject of the build's finding (what the author
 * typed), not its prose.
 */
const REFUSED = [
  // The card's shape: a bare field reference.
  { key: 'visible', body: 'amount > 1', subject: 'bare reference `amount`' },
  { key: 'visible', body: 'sqrt(record.amount) > 1', subject: '`sqrt`' },
  { key: 'visible', body: 'record.amont > 1', subject: 'unknown field `amont`' },
  { key: 'visible', body: 'record.status ==', subject: 'invalid CEL predicate' },
  { key: 'disabled', body: 'amount > 1', subject: 'bare reference `amount`' },
  { key: 'disabled', body: 'record.status ==', subject: 'invalid CEL predicate' },
] as const;

const bodyFor = ({ key, body }: { key: 'visible' | 'disabled'; body: unknown }) =>
  key === 'visible' ? fxAction(body) : fxAction(OPEN, body);

/**
 * Bodies the build accepts on an action, and so must the door — the shapes the
 * platform's objects and the examples ship.
 */
const ACCEPTED = [
  { key: 'visible', body: OPEN },
  { key: 'visible', body: { dialect: 'cel', source: OPEN } },
  { key: 'visible', body: "'org_admin' in current_user.positions" },
  { key: 'visible', body: 'current_user.isPlatformAdmin == true' },
  { key: 'visible', body: 'features.organization != false' },
  { key: 'visible', body: false },
  { key: 'disabled', body: "record.status == 'closed'" },
  // A boolean `disabled` is skipped by the build, not judged.
  { key: 'disabled', body: true },
] as const;

const gateObject = (item: unknown, objects: unknown[] = []) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects } });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const buildFindingsOf = (stack: Record<string, unknown>) =>
  expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));

const buildFindings = (...objects: unknown[]) => buildFindingsOf({ objects });

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#22032 pass 4 — the object door gives the build\'s object action predicate verdict', () => {
  it('needs no registry change: `validateStackExpressions` is already on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  for (const refused of REFUSED) {
    const { key, body, subject } = refused;
    it(`⭐ LIT — an action's \`${key}: ${body}\` is REFUSED, located at the action the author edits`, () => {
      const result = gateObject(bodyFor(refused));

      expect(result.rulesRun).toContain('validateStackExpressions');
      const errs = expressionFindings(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', where: whereOf(key), path: whereOf(key) });
      expect(errs[0]!.message).toContain(subject);
    });
  }

  for (const accepted of ACCEPTED) {
    const { key, body } = accepted;
    it(`⭐ CONTROL — an action's \`${key}: ${JSON.stringify(body)}\` still publishes clean, and the build agrees`, () => {
      const result = gateObject(bodyFor(accepted));

      expect(result.rulesRun).toContain('validateStackExpressions');
      expect(expressionFindings(result.errors), dump(result)).toEqual([]);
      expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
      // Clean at both doors, not only this one.
      expect(buildFindings(bodyFor(accepted))).toEqual([]);
    });
  }

  it('⭐ PARITY — for each refused object body the door findings ARE the build findings', () => {
    for (const refused of REFUSED) {
      const atBuild = buildFindings(bodyFor(refused));
      const atDoor = expressionFindings(gateObject(bodyFor(refused)).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.length, `${refused.key}: ${refused.body}`).toBeGreaterThan(0);
      expect(atDoor, `${refused.key}: ${refused.body}`).toEqual(atBuild);
    }
  });

  it('an action also declared TOP-LEVEL: the build locates it at `stack · action`, the door at the object — the same verdict', () => {
    const body = fxAction('amount > 1');
    const topLevel = { ...body.actions[0], objectName: 'fx_action' };
    // The shape `defineStack` hands the build: the bound action stays top-level
    // AND is merged onto its object; the build reports it once, at the top level.
    const atBuild = buildFindingsOf({ objects: [body], actions: [topLevel] });
    const atDoor = expressionFindings(gateObject(body).errors);

    expect(atBuild.map((f) => f.where), dump(atBuild)).toEqual(["stack · action 'fx_close' visible"]);
    expect(atDoor.map((f) => f.where), dump(atDoor)).toEqual([whereOf('visible')]);
    expect(atDoor[0]!.message).toBe(atBuild[0]!.message);
    expect(atDoor[0]!.severity).toBe(atBuild[0]!.severity);
  });

  it('a stored sibling\'s broken actions are not this write\'s to answer for (the differential)', () => {
    const sibling = fxAction(REFUSED[0].body, REFUSED[4].body, 'fx_sibling');
    // Non-vacuous: the sibling is refused at the build, on both keys.
    expect(buildFindings(sibling).map((f) => f.where)).toEqual([
      whereOf('visible', 'fx_sibling'),
      whereOf('disabled', 'fx_sibling'),
    ]);

    const result = gateObject(fxAction(OPEN), [sibling]);

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });

  it('over a broken STORED SELF: a clean save passes, and re-saving the broken body is refused — re-saving a row is writing it', () => {
    const storedSelf = fxAction(REFUSED[0].body);

    const clean = gateObject(fxAction(OPEN), [storedSelf]);
    expect(expressionFindings(clean.errors), dump(clean)).toEqual([]);

    const resaved = gateObject(fxAction(REFUSED[0].body), [storedSelf]);
    expect(expressionFindings(resaved.errors).map((f) => f.where), dump(resaved)).toEqual([whereOf('visible')]);
  });
});
