// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two schemaless node contracts that are PARSED at execute time (#4343).
 *
 * `script` and `subflow` run through `service-automation`'s `parseNodeConfig()`
 * before their executors do anything, so what this file pins is not decoration:
 * a shape accepted here runs, and a shape rejected here refuses the node as a
 * guard. `decision` is deliberately absent — it stays export-only (its one key
 * is optional, so a parse would have nothing to check).
 *
 * The structural assertions at the bottom guard the downstream walkers that a
 * union-shaped contract would have broken, which is why #4343 converged the
 * node instead of modelling its branches: the authorable-surface ratchet, the
 * expression ledger and objectui's reconciliation all read a FLAT
 * `properties` / `.shape`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ScriptConfigSchema,
  SubflowConfigSchema,
  getSchemalessNodeConfigJsonSchemas,
} from './schemaless-node-config.zod.js';

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

describe('ScriptConfigSchema (#4343 — converged to a function call)', () => {
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
    expect(message).toMatch(/#4343/);
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

describe('SubflowConfigSchema (#4343 — parsed at execute time)', () => {
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
});
