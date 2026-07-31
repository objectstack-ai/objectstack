// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Execute-time config `parse()` for the contract-carrying builtins (#4277 —
 * the enforcement half #4045 deliberately deferred).
 *
 * Until #4277 the Zod contracts in `@objectstack/spec/automation` were pure
 * exports: nothing parsed a node config with them, so a wrong-typed or
 * missing-required key sailed through to whatever the executor's loose reads
 * made of it (`limit: "10"` silently ignored, `mode: "view"` silently treated
 * as create). These tests pin the tightened behavior:
 *
 *  - a config that violates its contract REFUSES the node as a **guard** —
 *    the failure is not routable via `fault` edges (a config is metadata;
 *    re-running changes nothing), and the message names every violated path;
 *  - `{token}` templates stay legal everywhere they were: string slots parse
 *    raw templates, and `http` — which reads its config interpolated — parses
 *    the POST-interpolation shape, where a whole-token template has already
 *    resolved to its value's real type;
 *  - the deliberate exemption: a legacy flat-graph `loop` (no `config.body`)
 *    predates the ADR-0031 construct and is not parsed.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger() {
  const logger: any = {
    info() {}, warn() {}, error() {}, debug() {},
    child() { return logger; },
  };
  return logger;
}

interface HttpSurface {
  isHttpDeliveryReady?(): boolean;
  enqueueHttp?(input: any): Promise<string>;
}

function engineWith(messaging?: HttpSurface) {
  const engine = new AutomationEngine(silentLogger());
  const ctx: any = {
    logger: silentLogger(),
    getService(name: string) {
      if (name === 'messaging' && messaging) return messaging;
      throw new Error('none');
    },
  };
  installBuiltinNodes(engine, ctx);
  return engine;
}

/** start → n1(type, config) → end, with optional extra nodes/edges. */
function flowWith(
  type: string,
  config: Record<string, unknown>,
  extra?: { nodes?: any[]; edges?: any[]; variables?: any[] },
) {
  return {
    name: 'f', label: 'F', type: 'autolaunched', status: 'active', version: 1,
    variables: extra?.variables ?? [],
    nodes: [
      { id: 'start', type: 'start', label: 'S', config: {} },
      { id: 'n1', type, label: 'N', config },
      { id: 'end', type: 'end', label: 'E' },
      ...(extra?.nodes ?? []),
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n1', type: 'default' },
      { id: 'e2', source: 'n1', target: 'end', type: 'default' },
      ...(extra?.edges ?? []),
    ],
  };
}

describe('execute-time config parse (#4277)', () => {
  it('refuses a wrong-typed declared key, naming the exact path', async () => {
    const engine = engineWith();
    // `limit` is declared (so registration accepts it) but must be a number —
    // the executor never honored a string here, so this was dead config that
    // now fails loudly instead of silently doing nothing.
    engine.registerFlow('f', flowWith('get_record', { objectName: 'crm_lead', limit: 'ten' }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('get_record');
    expect(result.error).toContain('config.limit');
    expect(result.error).toContain('does not satisfy the get_record contract');
  });

  it('a parse refusal is a guard — a fault edge does NOT route it', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith(
      'get_record',
      { objectName: 'crm_lead', limit: 'ten' },
      {
        nodes: [{ id: 'recover', type: 'assignment', label: 'R', config: { recovered: true } }],
        edges: [{ id: 'e3', source: 'n1', target: 'recover', type: 'fault' }],
      },
    ));

    const result = await engine.execute('f');
    // Routable would mean success-via-recovery; a guard stays fatal (#3863).
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy the get_record contract');
  });

  it('refuses a missing required key (notify without title)', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('notify', { recipients: 'u1' }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('notify');
    expect(result.error).toContain('config.title');
  });

  it('string slots parse RAW templates — a `{token}` recipients/title passes', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('notify', {
      recipients: '{who}', title: 'Hi {who}',
    }, { variables: [{ name: 'who', type: 'text', isInput: true }] }));

    // No messaging service wired → the node degrades to a skipped success;
    // what matters here is that the parse accepted the template strings.
    const result = await engine.execute('f', { params: { who: 'u1' } } as any);
    expect(result.success).toBe(true);
  });

  it('http parses the INTERPOLATED config — a whole-token template in a typed slot resolves first', async () => {
    const enqueued: any[] = [];
    const engine = engineWith({
      isHttpDeliveryReady: () => true,
      async enqueueHttp(input) { enqueued.push(input); return 'dlv_1'; },
    });
    engine.registerFlow('f', flowWith('http', {
      url: 'https://example.test/hook', durable: true, timeoutMs: '{t}',
    }, { variables: [{ name: 't', type: 'number', isInput: true }] }));

    const result = await engine.execute('f', { params: { t: 1500 } } as any);
    expect(result.success).toBe(true);
    // Whole-token interpolation preserved the number, so the contract's
    // `timeoutMs: z.number()` saw 1500, not a string.
    expect(enqueued[0]?.timeoutMs).toBe(1500);
  });

  it('http still refuses a statically wrong-typed slot', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('http', { url: 'https://example.test', timeoutMs: 'soon' }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('config.timeoutMs');
  });

  it('screen refuses an out-of-enum mode instead of silently treating it as create', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('screen', { objectName: 'crm_lead', mode: 'view' }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('config.mode');
  });

  it('legacy flat-graph loop (no body) is exempt — an empty config still falls through', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('loop', {}));

    const result = await engine.execute('f');
    expect(result.success).toBe(true);
  });

  it('a structured loop (body present) IS parsed — missing collection refuses', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('loop', {
      body: { nodes: [{ id: 'b1', type: 'assignment', label: 'B', config: { x: 1 } }], edges: [] },
    }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('loop');
    expect(result.error).toContain('config.collection');
  });

  it('parallel refuses a non-array branches via the contract', async () => {
    const engine = engineWith();
    // A string `branches` slips past registration (validateControlFlow only
    // inspects arrays) — the execute-time parse is what catches it now.
    engine.registerFlow('f', flowWith('parallel', { branches: 'oops' }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('parallel');
    expect(result.error).toContain('config.branches');
  });

  it('map refuses a missing collection, naming the path', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith('map', { flowName: 'child' }));

    const result = await engine.execute('f');
    expect(result.success).toBe(false);
    expect(result.error).toContain('map');
    expect(result.error).toContain('config.collection');
  });
});
