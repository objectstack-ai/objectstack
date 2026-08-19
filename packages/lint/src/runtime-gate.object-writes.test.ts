// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4716 — the OBJECT write door, at its narrowed, adjudicated scope.
 *
 * Object writes are the hottest metadata path in the product: Studio's field
 * editor reaches `saveMetaItem` on every publish, and for a tenant it is the
 * ONLY door (`os lint` cannot see a `sys_metadata` overlay row). #4463's P1
 * deliberately gated `flow` first; this file pins the P2 crossing — and,
 * just as deliberately, its FENCES.
 *
 * The 2026-08-18 adjudication on #4716 ruled the scope by TIER:
 *
 *  - the five GATING rules carrying the object-writes reason cross together
 *    (`validateFunctionalCompleteness`, `validateManagedApiMethods`,
 *    `lintAutonumberFormats`, `validateRuleCompilability`,
 *    `validateRuleSchemaFormats`). Their false-positive budget was EXEMPTED on
 *    a measured 0 refusals across 75 real object declarations from two
 *    authoring lineages — a lower bound, since every measured population is
 *    authored config-file metadata — with a post-launch replay of stored
 *    overlay rows as the standing audit;
 *  - the six ADVISORY-tier object rules do NOT ride. They cannot refuse a
 *    write at all, and the measured ~8-advisories-per-object-write designer
 *    noise they would add is a UX decision with its own card, not a
 *    `runtimeTypes` edit. The fence is pinned below BY NAME so a later
 *    widening moves this line consciously rather than by drift.
 *
 * The six refusal cases are the adjudication's own non-vacuity controls — the
 * six synthetic broken bodies the measurement round pushed through the gate
 * differential to prove the zero was a fact about the corpus and not about the
 * harness (issue #4716, comment 5328421898). They are permanent here so the
 * evidence the exemption rests on cannot rot silently.
 */
import { describe, expect, it } from 'vitest';
import { AUTHORING_RULES } from './authoring-rules.js';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';

/** The five gating rules the adjudication crossed, in registry order. */
const CROSSED = [
  'validateFunctionalCompleteness',
  'validateManagedApiMethods',
  'lintAutonumberFormats',
  'validateRuleCompilability',
  'validateRuleSchemaFormats',
] as const;

/** The six advisory rules the adjudication fenced OUT, by name. */
const FENCED = [
  'validateRecordTitle',
  'validateSemanticRoles',
  'lintLivenessProperties',
  'lintUnscopedDeclaredIndexes',
  'lintUniqueDeclarations',
  'lintLegacyOrganizationComposites',
] as const;

/**
 * A stored sibling, clean under every object-gated rule, so the differential's
 * baseline contributes nothing and every asserted finding is unambiguously the
 * write's own. Same-name writes below exercise the replace-not-erase update
 * path (`buildRuntimeWriteSnapshots`), not an insert into an empty tenant.
 */
const STORED = [
  { name: 'leave_request', sharingModel: 'private', fields: { owner: { type: 'text' } } },
];

/**
 * A clean object body. `sharingModel` is authored on every fixture in this
 * file so `validateSecurityPosture` — at this door since #8310, not this
 * card's doing — contributes no `security-owd-unset` and each control stays
 * surgical about the one rule it exists to fire.
 */
const cleanObject = (over: Record<string, unknown> = {}) => ({
  name: 'leave_request',
  label: 'Leave Request',
  sharingModel: 'private',
  fields: { owner: { type: 'text' } },
  ...over,
});

const gateObject = (item: unknown, context: object = { objects: STORED }) =>
  runRuntimeAuthoringRules({ type: 'object', item, context });

/** The one error the write ADDED, asserted with its full 422 envelope keys. */
const expectSingleRefusal = (item: unknown, rule: string) => {
  const result = gateObject(item);
  const errs = result.errors.map((f) => f.rule);
  const f = result.errors.find((e) => e.rule === rule);
  expect(f, `expected [${rule}] among added errors, got: ${JSON.stringify(errs)}`).toBeDefined();
  // The 422 envelope's four keys (#4463 D3): the caller turns `errors` into
  // `err.issues` verbatim, so a finding without them is a refusal an author
  // cannot act on.
  expect(f!.severity).toBe('error');
  expect((f!.path ?? '').length).toBeGreaterThan(0);
  expect((f!.where ?? '').length).toBeGreaterThan(0);
  expect((f!.message ?? '').length).toBeGreaterThan(10);
  return result;
};

describe('the object write door dispatches at the adjudicated scope (#4716)', () => {
  it('dispatches `object` writes to the five crossed rules plus the two already at the door', () => {
    expect(runtimeGatedTypes()).toContain('object');
    expect(stackKeyForType('object')).toBe('objects');
    // Exact, in registry order — "clean" and "nothing ran" must stay
    // distinguishable, and a rule silently joining or leaving this door is
    // precisely the drift this pin exists to catch.
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toEqual([
      'validateFunctionalCompleteness',
      'validateManagedApiMethods',
      'validatePresetComparands', // #8793 — at this door before #4716
      'lintAutonumberFormats',
      'validateSecurityPosture', // #8310 — at this door before #4716
      'validateRuleCompilability',
      'validateRuleSchemaFormats',
    ]);
  });

  it('the six advisory-tier object rules do NOT ride — the Q2 fence, by name', () => {
    const atDoor = new Set(runtimeAuthoringRulesFor('object').map((r) => r.name));
    for (const name of FENCED) {
      expect(atDoor.has(name), `${name} reached the object write door — the #4716 adjudication `
        + `fenced the advisory tier out (the measured ~8-advisories-per-write designer noise). `
        + `Crossing it is a UX/volume decision with its own card, not a runtimeTypes edit.`).toBe(false);
      const entry = AUTHORING_RULES.find((r) => r.name === name);
      expect(entry, `${name} left AUTHORING_RULES — re-point this fence or retire it`).toBeDefined();
      expect(entry!.tier, `${name} changed tier — this fence pins the ADVISORY six; a severity `
        + `change needs its own PR and re-opens the crossing question for the rule`).toBe('advisory');
      expect((entry!.surfaceReason ?? '').length, `${name} sits off the runtime surface with no `
        + `substantive reason`).toBeGreaterThanOrEqual(40);
    }
    // And the five crossed rules really are gating tier — the exemption's
    // arithmetic (refusal risk lives only in `error`-capable rules) holds
    // only while this stays true.
    for (const name of CROSSED) {
      const entry = AUTHORING_RULES.find((r) => r.name === name)!;
      expect(entry.tier, `${name} is no longer gating — the #4716 exemption priced five gating `
        + `rules; a tier change moves it out of that ruling`).toBe('gating');
      expect(entry.runtimeTypes ?? []).toContain('object');
    }
  });

  // ── The six refusal controls — the exemption's non-vacuity evidence ──
  //
  // Each body is one a tenant could save through Studio/REST/MCP today:
  // Zod-green at the per-type parse, broken in a way only these rules judge.
  // Before #4716 every one of them published clean at this door.

  it('REFUSES a format rule whose regex does not compile (validateRuleCompilability)', () => {
    expectSingleRefusal(
      cleanObject({
        validations: [{ name: 'tax_format', type: 'format', field: 'owner', regex: '([' }],
      }),
      'validation-rule-regex-uncompilable',
    );
  });

  it('REFUSES a json_schema rule ajv cannot compile (validateRuleCompilability)', () => {
    // `required` must be an array; the runtime's `checkJsonSchema` would log
    // "uncompilable — skipped" and enforce NOTHING, forever (#4762).
    expectSingleRefusal(
      cleanObject({
        validations: [
          { name: 'payload_shape', type: 'json_schema', field: 'owner', schema: { required: 'name' } },
        ],
      }),
      'validation-rule-json-schema-uncompilable',
    );
  });

  it('REFUSES a json_schema rule naming an unregistered format (validateRuleSchemaFormats)', () => {
    // `emial` compiles under `strict: false` — ajv drops the keyword and the
    // rule enforces nothing for it (#5178). The record is ACCEPTED, which is
    // the silent direction; this is the door that makes it loud.
    expectSingleRefusal(
      cleanObject({
        validations: [
          {
            name: 'contact_shape',
            type: 'json_schema',
            field: 'owner',
            schema: { type: 'object', properties: { e: { type: 'string', format: 'emial' } } },
          },
        ],
      }),
      'validation-rule-json-schema-unknown-format',
    );
  });

  it('REFUSES a managed object advertising verbs its affordances close (validateManagedApiMethods)', () => {
    // The #7521 shape: `platform` bucket, `userActions` closing every write,
    // `enable.apiMethods` advertising `create`/`update` anyway. The registry
    // strips the verbs at boot behind a console.warn nobody reads.
    expectSingleRefusal(
      cleanObject({
        name: 'sys_environment_like',
        managedBy: 'platform',
        userActions: { create: false, edit: false, delete: false },
        enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update'] },
      }),
      'object/managed-api-method-unaffordable',
    );
  });

  it('REFUSES an autonumber format referencing a field the object does not carry (lintAutonumberFormats)', () => {
    expectSingleRefusal(
      cleanObject({
        fields: {
          owner: { type: 'text' },
          task_no: { type: 'autonumber', autonumberFormat: '{plan_no}{000}' },
        },
      }),
      'autonumber-references-unknown-field',
    );
  });

  it('REFUSES a summary field declaring no summaryOperations (validateFunctionalCompleteness)', () => {
    // ADR-0078: Zod-valid and fully inert — the field reads 0 forever while
    // authoring reports success (cloud#687's failure, at the door it ships from).
    expectSingleRefusal(
      cleanObject({
        fields: { owner: { type: 'text' }, total: { type: 'summary' } },
      }),
      'field/summary-without-operations',
    );
  });

  // ── What must NOT change ─────────────────────────────────────────────

  it('publishes a clean object write with every rule having RUN', () => {
    const result = gateObject(cleanObject());
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    expect(result.advisories, JSON.stringify(result.advisories)).toEqual([]);
    // "clean" and "nothing ran" must stay distinguishable.
    expect(result.rulesRun).toEqual([
      'validateFunctionalCompleteness',
      'validateManagedApiMethods',
      'validatePresetComparands',
      'lintAutonumberFormats',
      'validateSecurityPosture',
      'validateRuleCompilability',
      'validateRuleSchemaFormats',
    ]);
  });

  it('does not blame a clean write for a STORED sibling already in violation (#4463 D4)', () => {
    // A tenant's existing overlay rows may violate rules that did not exist
    // when they were written; the read path keeps serving them and the gate
    // blocks NEW writes only. The differential is what makes that structural:
    // the broken sibling's findings appear in both passes and cancel.
    const brokenStored = {
      name: 'legacy_task',
      sharingModel: 'private',
      fields: { task_no: { type: 'autonumber', autonumberFormat: '{gone_field}{000}' } },
      validations: [{ name: 'bad', type: 'format', field: 'task_no', regex: '([' }],
    };
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: cleanObject(),
      context: { objects: [...STORED, brokenStored] },
    });
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  });

  it('warning-tier findings from the crossed rules ride the advisory channel, never block', () => {
    // `lintAutonumberFormats`' optional-field arm is `warning`: the referenced
    // field exists but is not required at create time. The write publishes;
    // the author is told on the response channel (#4717), not with a 422.
    const result = gateObject(
      cleanObject({
        fields: {
          owner: { type: 'text' },
          plan_no: { type: 'text' },
          task_no: { type: 'autonumber', autonumberFormat: '{plan_no}{000}' },
        },
      }),
    );
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    const advisory = result.advisories.find((a) => a.rule === 'autonumber-references-optional-field');
    expect(advisory, JSON.stringify(result.advisories)).toBeDefined();
    expect(advisory!.severity).toBe('warning');
  });
});
