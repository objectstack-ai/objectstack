// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unknown flow-node `config` keys are REJECTED at registration (#4277 — the
 * error half of the #4045 unknown-key ladder; #4059 shipped the warn half).
 *
 * `FlowNodeSchema.config` is `z.record(z.unknown())`, so before #4059 a
 * misspelled or invented config key was accepted in **total silence**:
 * `visibleIf` instead of `visibleWhen` registered cleanly, was never read, and
 * the only symptom was a feature that quietly did not happen. That is the
 * diagnostic vacuum that made #3528 take three passes and two wrong diagnoses.
 *
 * [#21982] One judge per node type. A builtin's undeclared key is the spec's:
 * `flowNodeConfigRefusals` refuses it inside the `FlowSchema.parse`
 * `registerFlow` makes first — the same verdict `objectstack validate`,
 * `objectstack compile` and the save door give — for every type
 * `builtinNodeConfigKeysJudged` names, and the descriptor walk
 * (`validateNodeConfigKeys`) stands aside for those types. The walk's pins are
 * re-pointed here, not dropped: the key, its location, the prescription for a
 * known slip and a rename-or-remove remedy all reach the author from the spec
 * refusal. [#22343] `try_catch` joined once its contract's `retry` closed to
 * the five keys its descriptor declares, so the walk keeps every PLUGIN node
 * type and no builtin, and its own prescriptions are pinned on those. The
 * deliberate exemptions still register:
 * `assignment` (author-named keys), keyValue-map keys (author data),
 * `decision` (no executor contract).
 */

import { describe, it, expect } from 'vitest';
import { builtinNodeConfigKeysJudged, defineActionDescriptor, flowNodeConfigRefusals } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function recordingLogger() {
  const warnings: string[] = [];
  const logger: any = {
    info() {}, error() {}, debug() {},
    warn(msg: string) { warnings.push(msg); },
    child() { return logger; },
  };
  return { logger, warnings };
}

/** A plugin node type the spec knows nothing about: its descriptor declares `count` and `label`. */
const STAMP = 'test_stamp';
const stampExecutor: NodeExecutor = {
  type: STAMP,
  descriptor: defineActionDescriptor({
    type: STAMP, version: '1.0.0', name: 'Stamp', category: 'custom', paradigms: ['flow'], source: 'plugin',
    configSchema: { type: 'object', properties: { count: { type: 'number' }, label: { type: 'string' } } },
  }),
  async execute() { return { success: true }; },
};

function engineWith(logger: any) {
  const engine = new AutomationEngine(logger);
  installBuiltinNodes(engine, { logger, getService() { throw new Error('none'); } } as any);
  engine.registerNodeExecutor(stampExecutor);
  return engine;
}

/** A one-node flow carrying `config` verbatim on a node of `type`. */
function flowWith(type: string, config: Record<string, unknown>) {
  return {
    name: 'f', label: 'F', type: 'screen', status: 'active', version: 1,
    nodes: [
      { id: 'start', type: 'start', label: 'S', config: {} },
      { id: 'n1', type, label: 'N', config },
      { id: 'end', type: 'end', label: 'E' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n1', type: 'default' },
      { id: 'e2', source: 'n1', target: 'end', type: 'default' },
    ],
  };
}

/** Register and return what it threw (fails the test if it registers). */
function rejectionOf(engine: AutomationEngine, type: string, config: Record<string, unknown>): Error & { issues?: any[] } {
  try {
    engine.registerFlow('f', flowWith(type, config));
  } catch (err) {
    return err as Error & { issues?: any[] };
  }
  throw new Error(`flow with ${type} config ${JSON.stringify(config)} should have been rejected`);
}

/** The spec refusal `registerFlow` met: every issue's path, with the judge's own refusal beside it. */
function specRefusalsOf(engine: AutomationEngine, type: string, config: Record<string, unknown>) {
  const err = rejectionOf(engine, type, config);
  expect(err.issues, 'the FlowSchema parse, not the descriptor walk, refused it').toBeDefined();
  const judged = flowNodeConfigRefusals(type, config);
  return (err.issues ?? []).map((issue: any, i: number) => ({
    path: issue.path.join('.'),
    message: issue.message as string,
    code: judged[i]?.code,
    judgedMessage: judged[i]?.message,
  }));
}

describe('a builtin\'s undeclared key is the spec\'s, met at registration (#4277 re-pointed, #21982)', () => {
  it('rejects a misspelled key inside the field repeater, locating the exact element', async () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    // The typo lives INSIDE the field repeater — where the real #3528 one did.
    const config = { fields: [{ name: 'opportunityName', required: true, visibleIf: 'createOpportunity == true' }] };
    const [refusal, ...rest] = specRefusalsOf(engine, 'screen', config);
    expect(rest).toEqual([]);
    // Located to the exact element, so the author knows WHICH field.
    expect(refusal!.path).toBe('nodes.1.config.fields.0.visibleIf');
    expect(refusal!.code).toBe('node-config-refused-by-contract');
    expect(refusal!.message).toBe(refusal!.judgedMessage);
    // The load-bearing half for an agent author: the correct key is named, by
    // the screen field contract's own prescription for this exact typo.
    expect(refusal!.message).toContain('`visibleWhen`');
    // The flow is NOT registered.
    await expect(engine.getFlow('f')).resolves.toBeNull();
  });

  it('adds a did-you-mean when the typo IS within edit distance', () => {
    const engine = engineWith(recordingLogger().logger);
    const [refusal] = specRefusalsOf(engine, 'screen', { titl: 'Details' });
    expect(refusal!.path).toBe('nodes.1.config.titl');
    expect(refusal!.message).toContain('`title`');
  });

  it('carries the fieldValues → fields tombstone on the CRUD write map', () => {
    const engine = engineWith(recordingLogger().logger);
    const [refusal] = specRefusalsOf(engine, 'create_record', { objectName: 'crm_lead', fieldValues: { name: 'x' } });
    expect(refusal!.path).toBe('nodes.1.config.fieldValues');
    // The tombstone names the mechanism, not just the nearest key.
    expect(refusal!.message).toContain('The write map is `fields`');
  });

  it('reports every undeclared key in ONE rejection, not just the first', () => {
    const engine = engineWith(recordingLogger().logger);
    const refusals = specRefusalsOf(engine, 'screen', { hideWhen: 'x', submitLabel: 'Go' });
    expect(refusals.map((r) => r.path).sort()).toEqual(['nodes.1.config.hideWhen', 'nodes.1.config.submitLabel']);
  });

  it('a key with no did-you-mean still carries the rename-or-remove remedy', () => {
    const engine = engineWith(recordingLogger().logger);
    const [refusal] = specRefusalsOf(engine, 'screen', { totallyMadeUp: 42 });
    expect(refusal!.path).toBe('nodes.1.config.totallyMadeUp');
    expect(refusal!.message).not.toContain('did you mean');
    expect(refusal!.message).toMatch(/Rename the key .* or remove it/);
  });

  it('a body-less legacy loop with an undeclared key is still refused at registration — registerFlow widens nowhere', async () => {
    const engine = engineWith(recordingLogger().logger);
    const [refusal] = specRefusalsOf(engine, 'loop', { collection: 'rows', bogusKey: 1 });
    expect(refusal!.path).toBe('nodes.1.config.bogusKey');
    await expect(engine.getFlow('f')).resolves.toBeNull();
    // CONTROL: the same legacy loop without the key registers.
    expect(() => engine.registerFlow('f', flowWith('loop', { collection: 'rows' }))).not.toThrow();
  });

  it('the descriptor walk stands aside for every type the spec judges, and keeps the rest', () => {
    const engine = engineWith(recordingLogger().logger);
    const walk = (type: string, config: Record<string, unknown>) => () =>
      (engine as any).validateNodeConfigKeys('f', flowWith(type, config));
    // One judge per type: the spec already refused these in `FlowSchema.parse`.
    for (const [type, config] of [
      ['screen', { fields: [{ name: 'a', visibleIf: 'x' }] }],
      ['notify', { recipients: 'u1', title: 'T', bogusKey: 1 }],
      ['loop', { collection: 'rows', bogusKey: 1 }],
      ['try_catch', { try: { nodes: [], edges: [] }, bogusKey: 1, retry: { maxRetry: 2 } }],
    ] as const) {
      expect(builtinNodeConfigKeysJudged(type), type).toBe(true);
      expect(walk(type, config), type).not.toThrow();
    }
    // The walk keeps plugin types.
    expect(builtinNodeConfigKeysJudged(STAMP)).toBe(false);
    expect(walk(STAMP, { count: 1, bogusKey: 1 })).toThrow(/undeclared config key/);
  });
});

describe('try_catch: its retry closed, so its undeclared key is the spec\'s, refused once at registration', () => {
  const tryRegion = { nodes: [{ id: 'a', type: 'assignment', label: 'A', config: { assignments: { x: 1 } } }], edges: [] };

  it('a near miss under retry is refused by the parse, at the key, with the did-you-mean — and never by the walk', async () => {
    const engine = engineWith(recordingLogger().logger);
    const config = { try: tryRegion, retry: { maxRetry: 2 } };
    const refusals = specRefusalsOf(engine, 'try_catch', config);
    // ONE refusal, from the spec arm: the descriptor walk's rejection never joins it.
    expect(refusals.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'nodes.1.config.retry.maxRetry', code: 'node-config-refused-by-contract' },
    ]);
    expect(refusals[0]!.message).toBe(refusals[0]!.judgedMessage);
    expect(refusals[0]!.message).toContain('`maxRetry` → `maxRetries`');
    const err = rejectionOf(engineWith(recordingLogger().logger), 'try_catch', config);
    expect(err.message).not.toContain('undeclared config key(s)');
    await expect(engine.getFlow('f')).resolves.toBeNull();
  });

  it('every variant the walk refused is still refused at registration — registerFlow widens nowhere', () => {
    // The walk's verdicts on these, measured before the move: each was refused
    // as an undeclared key. A `retryDelayMs` the conversion leaves (a differing
    // `backoffMs` beside it, or a `null`) now meets the tombstone instead.
    for (const [config, path] of [
      [{ try: tryRegion, retry: { maxRetries: 1, bogusKey: 1 } }, 'nodes.1.config.retry.bogusKey'],
      [{ try: tryRegion, bogusKey: 1 }, 'nodes.1.config.bogusKey'],
      [{ try: tryRegion, retry: { maxRetries: 1, backoffMs: 500, retryDelayMs: 700 } }, 'nodes.1.config.retry.retryDelayMs'],
      [{ try: tryRegion, retry: { maxRetries: 1, retryDelayMs: null } }, 'nodes.1.config.retry.retryDelayMs'],
    ] as const) {
      const engine = engineWith(recordingLogger().logger);
      expect(specRefusalsOf(engine, 'try_catch', config).map((r) => r.path), JSON.stringify(config)).toEqual([path]);
    }
  });

  it('CONTROL: a declared retry block registers, and a pre-17 retryDelayMs alone is converted first', async () => {
    for (const retry of [
      { maxRetries: 3, backoffMs: 500, backoffMultiplier: 2, maxRetryDelayMs: 10000, jitter: true },
      { maxRetries: 1, retryDelayMs: 0 },
    ]) {
      const engine = engineWith(recordingLogger().logger);
      expect(() => engine.registerFlow('f', flowWith('try_catch', { try: tryRegion, retry })), JSON.stringify(retry)).not.toThrow();
      await expect(engine.getFlow('f')).resolves.not.toBeNull();
    }
  });
});

describe('the descriptor walk keeps plugin node types, with its own prescriptions', () => {
  it('a plugin node type: did-you-mean, the declared set, and the declare-it prescription', () => {
    const engine = engineWith(recordingLogger().logger);
    const err = rejectionOf(engine, STAMP, { coutn: 1 });
    expect(err.issues).toBeUndefined();
    expect(err.message).toContain(`node 'n1' (${STAMP}): unknown config key \`coutn\` at config.coutn`);
    expect(err.message).toContain('did you mean `count`?');
    expect(err.message).toContain('Declared here: count, label.');
    // The way OUT for a custom executor whose schema lags its reads.
    expect(err.message).toContain("declare it on the node type's descriptor configSchema");
  });

  it('a plugin node type: every undeclared key in ONE rejection', () => {
    const engine = engineWith(recordingLogger().logger);
    const err = rejectionOf(engine, STAMP, { hideWhen: 'x', submitLabel: 'Go' });
    expect(err.message).toContain('hideWhen');
    expect(err.message).toContain('submitLabel');
    expect(err.message).toContain('2 undeclared config key(s)');
  });
});

describe('what still registers (controls)', () => {
  it('registers a fully declared config without complaint', async () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('screen', {
      title: 'Details',
      fields: [{ name: 'a', type: 'boolean', required: true, visibleWhen: 'b == true' }],
      waitForInput: true,
      defaults: { x: 1 },
    }));

    await expect(engine.getFlow('f')).resolves.toBeDefined();
    expect(warnings.filter((w) => w.includes('unknown config key'))).toEqual([]);
  });

  it('assignment is exempt WHOLESALE — its top-level keys are author variable names', async () => {
    // Pinned as un-reconcilable by the form↔Zod ledger: with no `assignments`
    // wrapper, the top-level config keys ARE the variables being assigned, so
    // no fixed key set can describe them and the tightened check must not try.
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    expect(() => engine.registerFlow('f', flowWith('assignment', {
      approvalStatus: 'pending',
      // A literal — the `{…}` template dialect is refused in an assignment
      // value since #19939, a different rule from the key check pinned here.
      anyVariableNameAtAll: 'owner',
    }))).not.toThrow();
    await expect(engine.getFlow('f')).resolves.toBeDefined();
  });

  it('stays quiet for a node type that publishes no configSchema', () => {
    // `decision` is deliberately schemaless (config-schemas.test.ts) and has no
    // executor contract either: nothing is declared, so nothing can be undeclared.
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    expect(() => engine.registerFlow('f', flowWith('decision', { condition: 'a == b', whateverElse: 1 })))
      .not.toThrow();
  });

  it('does not flag the keys of a keyValue map — those are author data', () => {
    // Both judges descend where the contract declares structure and STOP at a
    // free-form map: `filter: { status: 'stale' }` keys are data, not config keys.
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    expect(() => engine.registerFlow('f', flowWith('get_record', {
      objectName: 'crm_lead',
      filter: { status: 'stale', anythingAtAll: true },
    }))).not.toThrow();
  });
});
