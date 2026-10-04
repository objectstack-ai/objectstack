// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two schemaless node contracts that are PARSED at execute time (#4343).
 *
 * `script` and `subflow` run through `service-automation`'s `parseNodeConfig()`
 * before their executors do anything, so what this file pins is not decoration:
 * a shape accepted here runs, and a shape rejected here refuses the node as a
 * guard. `decision` is different — no execute-time parse; its strictness binds
 * at the authoring doors only (`tsc`, the published JSON Schema and a direct
 * parse), while its `mode` key is ALSO judged at registration (#15429): the
 * automation engine's `registerFlow` parses every decision's config through
 * this schema and refuses the flow on any issue rooted at `mode`, and
 * `os validate` reports the same as `flow-decision-mode-invalid`. `mode` is
 * refused beside a non-empty `conditions` list (ruling 5856786357 on #20168) —
 * a refinement, so of the authoring doors it binds the direct parse and is
 * declared dropped in the JSON Schema; the two run-time doors carry it too.
 *
 * The structural assertions at the bottom guard the downstream walkers that a
 * union-shaped contract would have broken, which is why #4343 converged the
 * node instead of modelling its branches: the authorable-surface ratchet, the
 * expression ledger and objectui's reconciliation all read a FLAT
 * `properties` / `.shape`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { objectStackErrorMap } from '../shared/error-map.zod.js';
import {
  DecisionConditionSchema,
  DecisionConfigSchema,
  SCHEMALESS_NODE_CONFIG_SCHEMAS,
  ScriptConfigSchema,
  SubflowConfigSchema,
  getSchemalessNodeConfigJsonSchemas,
  type DecisionConfig,
  type DecisionConfigParsed,
} from './schemaless-node-config.zod.js';

interface Parseable { safeParse(v: unknown): { success: boolean; error?: { issues: ReadonlyArray<{ code: string; message: string }> } } }

/** The unknown-key message, or `undefined` when the shape was accepted. */
function unknownKeyMessage(schema: Parseable, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message;
}

/** Every key the contract still declares, tombstones included. */
const SCRIPT_SHAPE_KEYS = [
  'actionType', 'function', 'inputs', 'outputVariable',
  'recipients', 'script', 'template', 'variables',
];
/** The keys #4343 retired — each must reject with its own prescription. */
const SCRIPT_RETIRED: ReadonlyArray<[string, unknown]> = [
  ['actionType', 'email'],
  ['template', 'task_done'],
  ['recipients', ['{record.owner}']],
  ['variables', { taskName: '{record.name}' }],
  ['script', 'return { ok: true };'],
];

describe('ScriptConfigSchema (converged to a function call)', () => {
  it('accepts the one shape the executor runs', () => {
    expect(ScriptConfigSchema.parse({
      function: 'score_lead',
      inputs: { leadId: '{record.id}' },
      outputVariable: 'score',
    })).toEqual({
      function: 'score_lead',
      inputs: { leadId: '{record.id}' },
      outputVariable: 'score',
    });
  });

  it('accepts a bare `function` — inputs and outputVariable stay optional', () => {
    expect(ScriptConfigSchema.parse({ function: 'score_lead' })).toEqual({ function: 'score_lead' });
  });

  it('requires `function`: a script node that names no callable has nothing to run', () => {
    const empty = ScriptConfigSchema.safeParse({});
    expect(empty.success).toBe(false);
    expect(empty.error!.issues[0]!.path).toEqual(['function']);

    // Same for a present-but-empty name — `.min(1)`, not just "declared".
    expect(ScriptConfigSchema.safeParse({ function: '' }).success).toBe(false);
  });

  it.each(SCRIPT_RETIRED)('rejects the retired `%s` with its own prescription', (key, value) => {
    const result = ScriptConfigSchema.safeParse({ function: 'score_lead', [key]: value });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((i) => i.message).join('\n');
    // The tombstone's payload is the prescription, not "unrecognized key" —
    // this string IS the upgrade doc for whoever hits it (retired-key.ts).
    expect(message).toContain(`\`script.config.${key}\``);
    expect(message).toMatch(/was removed in @objectstack\/spec 17/);
    expect(message).toMatch(/os migrate meta --from 16/);
    expect(result.error!.issues[0]!.path).toEqual([key]);
  });

  it('names every violated key at once, so one refusal lists the whole job', () => {
    const result = ScriptConfigSchema.safeParse({
      function: 'score_lead', actionType: 'email', template: 't', recipients: ['a'],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path[0]).sort())
      .toEqual(['actionType', 'recipients', 'template']);
  });

  it('prescribes a different mechanism per branch — the retirement is not one rename', () => {
    const messageFor = (key: string, value: unknown) =>
      ScriptConfigSchema.safeParse({ function: 'f', [key]: value }).error!.issues[0]!.message;
    // Mail has a real delivery path; Slack does not go through it (no slack
    // channel exists — that is a connector), and an inline body is a function.
    expect(messageFor('actionType', 'email')).toMatch(/`notify` node/);
    expect(messageFor('actionType', 'email')).toMatch(/connector_action/);
    expect(messageFor('script', 'return 1;')).toMatch(/defineStack\(\{ functions \}\)/);
  });
});

describe('SubflowConfigSchema (parsed at execute time)', () => {
  it('accepts the executor-read shape', () => {
    expect(SubflowConfigSchema.parse({
      flowName: 'escalation_flow',
      input: { caseId: '{record.id}' },
      outputVariable: 'subResult',
    })).toEqual({
      flowName: 'escalation_flow',
      input: { caseId: '{record.id}' },
      outputVariable: 'subResult',
    });
  });

  it('refuses a missing or empty `flowName` — the step cannot pick a flow', () => {
    for (const bad of [{}, { flowName: '' }]) {
      const result = SubflowConfigSchema.safeParse(bad);
      expect(result.success, JSON.stringify(bad)).toBe(false);
      expect(result.error!.issues[0]!.path).toEqual(['flowName']);
    }
  });
});

describe('unknown keys — refused, not stripped, and this class had no other gate', () => {
  // The asymmetry worth stating once: `registerFlow()`'s #4277 undeclared-key
  // rejection derives its declared set from a descriptor `configSchema`, and
  // these three node types publish none — so the walk skips them BY
  // CONSTRUCTION. Until this batch there was no layer at all at which a wrong
  // key on a `script` / `subflow` / `decision` config was visible.

  it('script: rejects an undeclared key and names the surface', () => {
    const message = unknownKeyMessage(ScriptConfigSchema, { function: 'score_lead', outputVariables: ['x'] })!;
    expect(message).toContain('this script node config');
    // `outputVariables` is the exact key #4278 found objectui's form offering
    // and no executor reading. One character from the real key, so the
    // suggester earns its keep here.
    expect(message).toContain('`outputVariables` → `outputVariable`');
  });

  it.each([
    ['functionName', 'score_lead', '`function`'],
    ['input', { leadId: '1' }, '`inputs`'],
  ] as ReadonlyArray<[string, unknown, string]>)(
    'script: the retired `%s` alias gets its conversion named, not just a rename',
    (key, value, canonical) => {
      const message = unknownKeyMessage(ScriptConfigSchema, { function: 'f', [key]: value })!;
      expect(message).toContain(canonical);
      expect(message).toContain('flow-node-script-config-aliases');
    },
  );

  it('script: `input`\'s prescription protects `connector_action`, where the singular IS canonical', () => {
    // Without this the prescription reads as "the singular is always wrong",
    // and an author obeying it globally breaks a working connector node.
    expect(unknownKeyMessage(ScriptConfigSchema, { function: 'f', input: {} }))
      .toContain('connectorConfig.input');
  });

  it('script: the tombstoned keys are never offered as a suggestion (finding 12)', () => {
    // `strictObject` filters unwritable keys out of the candidate list. Five
    // `retiredKey()` tombstones sit in this shape, and `recipients` /
    // `template` / `variables` / `script` are exactly the sort of near-miss a
    // distance-based suggester reaches for.
    for (const typo of ['recipient', 'templates', 'variable', 'scripts', 'actionTypes']) {
      const message = unknownKeyMessage(ScriptConfigSchema, { function: 'f', [typo]: 'x' })!;
      const suggested = [...message.matchAll(/→ `([^`]+)`/g)].map((m) => m[1]!);
      for (const key of suggested) {
        const issues = ScriptConfigSchema.safeParse({ function: 'f', [key]: 'x' }).error?.issues ?? [];
        expect(issues.some((i) => i.message.startsWith('[REMOVED]') || /was removed in @objectstack\/spec/.test(i.message)),
          `suggested \`${key}\` for \`${typo}\`, but that key is a tombstone`).toBe(false);
      }
    }
  });

  it('subflow: prescribes `flowName`, and points `timeoutMs` at the node it belongs on', () => {
    expect(unknownKeyMessage(SubflowConfigSchema, { flowName: 'audit_flow', flow: 'ignored' }))
      .toContain('flow-node-subflow-flow-alias');
    const timeout = unknownKeyMessage(SubflowConfigSchema, { flowName: 'audit_flow', timeoutMs: 30000 })!;
    expect(timeout).toContain('FlowNodeSchema.timeoutMs');
  });

  it('decision: `condition` is pointed at the out-edges, NOT given the one-edit rename to `conditions`', () => {
    // The finding-7 case this batch had to get right. `condition` →
    // `conditions` is one character, so a bare suggester proposes it with
    // confidence — and taking that advice produces the double-declaration
    // (branches here AND on the edges) that #4414 was filed for. Guidance
    // suppresses the rename, so the assertion is as much about what is ABSENT.
    const message = unknownKeyMessage(DecisionConfigSchema, { condition: "amount > 100000" })!;
    expect(message).toContain('this decision node config');
    expect(message).toContain('double-declaration');
    expect(message).toContain('OUT-EDGES');
    expect(message, 'the prescription names the double declaration, never a tracker id')
      .not.toMatch(/#\d{3,5}/);
    expect(message).not.toContain('`condition` → `conditions`');
  });

  it('decision branch: `condition` DOES rename here — the edge and the branch spell one intent two ways', () => {
    // The mirror of the entry above, and deliberately the opposite verdict:
    // on a branch item the predicate slot really is `expression`, and
    // `FlowEdgeSchema` already aliases `expression` → `condition` going the
    // other way. Same word, two surfaces, both directions declared.
    expect(unknownKeyMessage(DecisionConditionSchema, { label: 'yes', condition: 'amount > 1' }))
      .toContain('`condition` → `expression`');
  });

  it('decision branch: `target` is named as VIRTUAL rather than renamed away', () => {
    const message = unknownKeyMessage(DecisionConditionSchema, { label: 'yes', expression: 'a > 1', target: 'n3' })!;
    expect(message).toContain('this decision branch');
    expect(message).toMatch(/virtual/i);
    expect(message).toContain('flow-branch-label-unmatched');
  });

  it('accepts every declared key on the decision pair', () => {
    expect(DecisionConfigSchema.parse({ conditions: [{ label: 'big', expression: 'amount > 100000' }] }))
      .toEqual({ conditions: [{ label: 'big', expression: 'amount > 100000' }] });
    // The no-conditions gateway shape stays legal — it is what every bundled
    // example uses, and strictness must not turn "branch on the edges" into an
    // error.
    expect(DecisionConfigSchema.parse({})).toEqual({});
  });
});

describe('DecisionConfigSchema.mode (taking every true branch must be declared — the contract half, declared ahead of the engine)', () => {
  it('accepts an omitted mode and both members, and injects nothing', () => {
    // No `.default('exclusive')`: "omitted means exclusive" is the contract's
    // prose and the future reader's job, so the parsed output stays exactly the
    // authored shape for every consumer of this schema.
    const omitted = DecisionConfigSchema.parse({});
    expect(omitted).toEqual({});
    expect('mode' in omitted, 'an omitted mode must not come back as a parsed default').toBe(false);
    expect(DecisionConfigSchema.parse({ mode: 'exclusive' })).toEqual({ mode: 'exclusive' });
    expect(DecisionConfigSchema.parse({ mode: 'inclusive' })).toEqual({ mode: 'inclusive' });
    // Beside a NON-EMPTY branch list the key is refused (ruling 5856786357 on
    // #20168) — pinned in the describe block below, with its controls.
  });

  it('types the key as the closed pair at the tsc door', () => {
    expectTypeOf<DecisionConfig['mode']>().toEqualTypeOf<'exclusive' | 'inclusive' | undefined>();
    expectTypeOf<DecisionConfigParsed['mode']>().toEqualTypeOf<'exclusive' | 'inclusive' | undefined>();
  });

  // The values an author reaching for this concept under another engine's
  // spelling writes — plus a case slip and the n8n-style boolean. Each is
  // refused with the SAME prescription, which names both members' meanings
  // and what an omitted key means.
  const REFUSED: ReadonlyArray<[unknown, string]> = [
    ['all', "`mode: 'all'`"],
    ['first', "`mode: 'first'`"],
    ['parallel', "`mode: 'parallel'`"],
    ['Inclusive', "`mode: 'Inclusive'`"],
    [true, '`mode: true`'],
    [null, '`mode: null`'],
  ];

  it.each(REFUSED)('refuses mode %j with the prescription at path [mode]', (value, echoed) => {
    const result = DecisionConfigSchema.safeParse({ mode: value });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_value');
    expect(issues[0]!.path).toEqual(['mode']);
    const message = issues[0]!.message;
    expect(message).toContain(`${echoed} is not a decision mode`);
    expect(message).toContain("the closed pair 'exclusive' | 'inclusive'");
    expect(message).toContain('what an omitted `mode` means');
    expect(message, 'a prescription an author is shown carries no tracker number').not.toMatch(/#\d{3,5}/);
  });

  it('keeps its prescription under the ObjectStack error map a validator may pass per parse', () => {
    // A schema-level `error` outranks a per-parse map in zod 4, so the generic
    // "Invalid value … Expected one of" text must not replace the prescription.
    const result = DecisionConfigSchema.safeParse({ mode: 'all' }, { error: objectStackErrorMap });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain("`mode: 'all'` is not a decision mode");
  });

  it('publishes mode as an optional closed enum with no default in the JSON Schema', () => {
    const json = getSchemalessNodeConfigJsonSchemas().decision as Record<string, unknown>;
    const mode = (json.properties as Record<string, Record<string, unknown>>).mode;
    expect(mode.enum).toEqual(['exclusive', 'inclusive']);
    expect(mode.default, 'a JSON-Schema default would read as an enforced one').toBeUndefined();
    expect(json.required ?? [], 'mode is optional').not.toContain('mode');
    for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
      expect(json[combinator], `top-level ${combinator} would blind the authorable-surface walk`).toBeUndefined();
    }
  });
});

/**
 * Ruling 5856786357 on #20168 (letter A): `mode` belongs to the edge-branched
 * decision alone, so a decision declaring a NON-EMPTY `conditions` list AND
 * `mode` is refused at `mode`, with the ruled prescription — delete `mode`
 * (the list is first-match on its own), or move the branches onto the
 * out-edges, delete `conditions`, and keep `mode`.
 *
 * Key-vs-value note: the rule judges the KEY beside a non-empty list, whatever
 * member it names, so every refusal below is a full `safeParse` failure
 * located at `mode`, and every control a full `safeParse` success that
 * round-trips — never mere absence of one issue code.
 */
describe('DecisionConfigSchema — `mode` beside a non-empty `conditions` list is refused', () => {
  const BRANCH = { label: 'big', expression: 'amount > 100000' } as const;
  const BRANCHES = [BRANCH, { label: 'small', expression: 'amount <= 100000' }] as const;

  /**
   * The ruled prescription on the message: the wording is the contract here
   * (the ruling names both ways out and #15429's acceptance list carries it),
   * so the first sentence is read verbatim and each remedy is required.
   */
  function expectRuledRefusal(message: string, mode: 'exclusive' | 'inclusive'): void {
    expect(message.startsWith(
      `\`mode: '${mode}'\` is not valid on a decision that declares a \`conditions\` list — `
      + '`mode` belongs to the edge-branched decision alone.',
    )).toBe(true);
    expect(message).toContain('A `conditions` list is first-match on its own');
    expect(message, 'remedy 1: drop mode').toContain('Either delete `mode` and keep the list');
    expect(message, 'remedy 2: branches onto the edges, keep mode')
      .toContain('move the branches onto the out-edges');
    expect(message).toContain('delete `conditions`, and keep `mode`');
    expect(message, 'a prescription an author is shown carries no tracker number').not.toMatch(/#\d{3,5}/);
  }

  type Issue = { code: string; path: PropertyKey[]; message: string };
  const issuesOf = (result: { success: boolean; error?: { issues: ReadonlyArray<Issue> } }): ReadonlyArray<Issue> =>
    (result.success ? [] : result.error!.issues);

  it.each(['inclusive', 'exclusive'] as const)(
    'refuses `mode: %j` beside a one-entry list — one custom issue at [mode], with the ruled prescription',
    (mode) => {
      const result = DecisionConfigSchema.safeParse({ conditions: [BRANCH], mode });
      expect(result.success).toBe(false);
      const issues = issuesOf(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.path).toEqual(['mode']);
      expectRuledRefusal(issues[0]!.message, mode);
    },
  );

  it.each(['inclusive', 'exclusive'] as const)('refuses `mode: %j` beside a multi-entry list alike', (mode) => {
    const issues = issuesOf(DecisionConfigSchema.safeParse({ mode, conditions: BRANCHES }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['mode']]]);
    expectRuledRefusal(issues[0]!.message, mode);
  });

  it('is the same refusal through `SCHEMALESS_NODE_CONFIG_SCHEMAS.decision` — the handle a registration-time reader looks up by node type', () => {
    // #15429's registration reader and metadata-protocol's reference walk both
    // reach this contract by node type rather than by its export name, so the
    // pin is taken through that door too.
    const issues = issuesOf(SCHEMALESS_NODE_CONFIG_SCHEMAS.decision.safeParse({ conditions: [BRANCH], mode: 'inclusive' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['mode']]]);
    expectRuledRefusal(issues[0]!.message, 'inclusive');
  });

  it('keeps its prescription under the ObjectStack error map a validator may pass per parse', () => {
    const result = DecisionConfigSchema.safeParse({ conditions: [BRANCH], mode: 'inclusive' }, { error: objectStackErrorMap });
    const issues = issuesOf(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['mode']);
    expectRuledRefusal(issues[0]!.message, 'inclusive');
  });

  it('a mode OUTSIDE the closed pair beside a list gets the value refusal first — one issue, never both', () => {
    // The enum refusal is a base-type issue, so the object's refinement does
    // not run over it: the author fixes the value, then meets this rule.
    const issues = issuesOf(DecisionConfigSchema.safeParse({ conditions: [BRANCH], mode: 'all' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_value');
    expect(issues[0]!.path).toEqual(['mode']);
    expect(issues[0]!.message).toContain("`mode: 'all'` is not a decision mode");
  });

  describe('CONTROLS — what the refusal must leave alone', () => {
    it.each(['inclusive', 'exclusive'] as const)('accepts `mode: %j` beside an EMPTY list, and it round-trips', (mode) => {
      const result = DecisionConfigSchema.safeParse({ conditions: [], mode });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ conditions: [], mode });
      expect(DecisionConfigSchema.parse(result.data)).toEqual(result.data);
    });

    it.each(['inclusive', 'exclusive'] as const)('accepts `mode: %j` with `conditions` absent, and it round-trips', (mode) => {
      const result = DecisionConfigSchema.safeParse({ mode });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ mode });
      expect('conditions' in result.data!).toBe(false);
      expect(DecisionConfigSchema.parse(result.data)).toEqual(result.data);
    });

    it('accepts a non-empty list with NO mode, and it round-trips', () => {
      for (const conditions of [[BRANCH], BRANCHES]) {
        const result = DecisionConfigSchema.safeParse({ conditions });
        expect(result.success, JSON.stringify(conditions)).toBe(true);
        expect(result.data).toEqual({ conditions });
        expect('mode' in result.data!).toBe(false);
        expect(DecisionConfigSchema.parse(result.data)).toEqual(result.data);
      }
    });

    it('following either remedy parses', () => {
      const refused: Record<string, unknown> = { conditions: [...BRANCHES], mode: 'inclusive' };
      expect(DecisionConfigSchema.safeParse(refused).success).toBe(false);
      // Remedy 1 — delete `mode`, keep the list.
      const listOnly = { ...refused };
      delete listOnly.mode;
      expect(DecisionConfigSchema.parse(listOnly)).toEqual({ conditions: BRANCHES });
      // Remedy 2 — the branches move onto the out-edges (outside this config),
      // `conditions` is deleted, and `mode` stays.
      const modeOnly = { ...refused };
      delete modeOnly.conditions;
      expect(DecisionConfigSchema.parse(modeOnly)).toEqual({ mode: 'inclusive' });
    });
  });
});

describe('structural contract — what the downstream walkers require', () => {
  it('keeps the tombstoned keys IN the shape, so the ratchet can see them retired', () => {
    // A `retiredKey()` is still a property. Deleting it outright would read as
    // "the key vanished" to the authorable-surface gate, which is the hard
    // failure the tombstone route exists to avoid.
    expect(Object.keys(ScriptConfigSchema.shape).sort()).toEqual(SCRIPT_SHAPE_KEYS);
    for (const [key] of SCRIPT_RETIRED) {
      expect(ScriptConfigSchema.shape[key as keyof typeof ScriptConfigSchema.shape].description)
        .toMatch(/^\[REMOVED\]/);
    }
  });

  it('stays a FLAT JSON Schema — no anyOf/oneOf for a union-blind walker to miss', () => {
    const json = getSchemalessNodeConfigJsonSchemas().script as Record<string, unknown>;
    expect(Object.keys(json.properties as object).sort()).toEqual(SCRIPT_SHAPE_KEYS);
    for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
      expect(json[combinator], `top-level ${combinator} would blind the authorable-surface walk`)
        .toBeUndefined();
    }
    expect((json.required as string[])).toEqual(['function']);
  });

  it('still converts without throwing, tombstones and all', () => {
    expect(() => z.toJSONSchema(SubflowConfigSchema, { unrepresentable: 'any' })).not.toThrow();
  });

  it('keeps the KEY SETS untouched — the property objectui reconciles across the repo seam', () => {
    // #4001 批 9 closed these shapes without moving a single key, and that is
    // the invariant the cross-repo check depends on: objectui's
    // `flow-node-config.spec-reconciliation` test compares its hand-written
    // `FLOW_NODE_CONFIG` table against `.shape` (not against a parse), so
    // strictness is invisible to it — while an added or dropped key would
    // break a repo we cannot fix from here. Pinned in THIS repo so the failure
    // lands where the edit is made.
    expect(Object.keys(SubflowConfigSchema.shape).sort())
      .toEqual(['flowName', 'input', 'outputVariable']);
    // `decision` gained `mode` (#15429, item 2) — a deliberate key-set change,
    // not drift. objectui's reconciliation reads `.shape` in both directions,
    // so its `decision` panel reds on the objectui spec bump that carries this
    // key until its hand-written form offers `mode` too; that is the cross-repo
    // half this pin exists to make visible here.
    expect(Object.keys(DecisionConfigSchema.shape).sort()).toEqual(['conditions', 'mode']);
    expect(Object.keys(DecisionConditionSchema.shape).sort()).toEqual(['expression', 'label']);
  });

  it('carries `additionalProperties: false` into the published JSON Schema without losing the expression markers', () => {
    const json = getSchemalessNodeConfigJsonSchemas().decision as Record<string, unknown>;
    // #3746 hazard checked: `z.toJSONSchema` on a strict lazySchema does not throw…
    expect(json.additionalProperties).toBe(false);
    // …and the `.meta({ xExpression })` channel the expression ledger reads
    // survives the conversion, one level down on the branch item.
    const branch = ((json.properties as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
      .conditions.items.properties).expression;
    expect(branch.xExpression).toBe('expression');
  });
});
