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
 *
 * #4343 added the two schemaless nodes whose contracts could carry the same
 * seam: `subflow` (flat all along — it just had a hand-written guard) and
 * `script`, once retiring its non-functional dispatch branches left it flat.
 * `decision` stays out: its one key is optional, so a parse would check nothing.
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

/**
 * #20316 — a key the executor contract requires, LEFT OUT, is refused at the
 * build doors now: `registerFlow` parses first, so a flow missing it no longer
 * registers ({@link doorRefusal} pins that half). The execute-time parse this
 * file is about is still the executor's own contract, met by a config that
 * reaches it past the doors — so {@link runStripped} registers the node WHOLE
 * and removes the keys from the stored flow before the run.
 */
function doorRefusal(type: string, config: Record<string, unknown>): string {
  try {
    engineWith().registerFlow('f', flowWith(type, config));
  } catch (e) {
    return String((e as Error).message);
  }
  return '';
}

async function runStripped(
  engine: AutomationEngine,
  type: string,
  whole: Record<string, unknown>,
  strip: string[],
  extra?: { nodes?: any[]; edges?: any[]; variables?: any[] },
) {
  const stored = engine.registerFlow('f', flowWith(type, whole, extra));
  const config = stored.nodes.find((n) => n.id === 'n1')!.config as Record<string, unknown>;
  for (const key of strip) delete config[key];
  return engine.execute('f');
}

/**
 * #21898 — a VALUE the executor contract refuses is refused at the build doors
 * too now ({@link doorRefusal} pins that half, at the key). The execute-time
 * parse is met the same way as above: {@link runPatched} registers the node
 * with a value the contract accepts and writes the refused one into the stored
 * flow before the run.
 */
async function runPatched(
  engine: AutomationEngine,
  type: string,
  whole: Record<string, unknown>,
  patch: Record<string, unknown>,
  extra?: { nodes?: any[]; edges?: any[]; variables?: any[] },
) {
  const stored = engine.registerFlow('f', flowWith(type, whole, extra));
  Object.assign(stored.nodes.find((n) => n.id === 'n1')!.config as Record<string, unknown>, patch);
  return engine.execute('f');
}

describe('execute-time config parse (#4277)', () => {
  it('refuses a wrong-typed declared key, naming the exact path', async () => {
    // `limit` must be a number — the executor never honored a string here, so
    // this was dead config that now fails loudly instead of silently doing
    // nothing: at registration, at the key, and at the run.
    expect(doorRefusal('get_record', { objectName: 'crm_lead', limit: 'ten' })).toContain('refused at `limit`');
    const engine = engineWith();
    const result = await runPatched(engine, 'get_record', { objectName: 'crm_lead', limit: 10 }, { limit: 'ten' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('get_record');
    expect(result.error).toContain('config.limit');
    expect(result.error).toContain('does not satisfy the get_record contract');
  });

  it('a parse refusal is a guard — a fault edge does NOT route it', async () => {
    const engine = engineWith();
    const result = await runPatched(
      engine,
      'get_record',
      { objectName: 'crm_lead', limit: 10 },
      { limit: 'ten' },
      {
        nodes: [{ id: 'recover', type: 'assignment', label: 'R', config: { recovered: true } }],
        edges: [{ id: 'e3', source: 'n1', target: 'recover', type: 'fault' }],
      },
    );
    // Routable would mean success-via-recovery; a guard stays fatal (#3863).
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy the get_record contract');
  });

  it('refuses a missing required key (notify without title)', async () => {
    expect(doorRefusal('notify', { recipients: 'u1' })).toContain('A notify node needs one content source');
    const engine = engineWith();
    const result = await runStripped(engine, 'notify', { recipients: 'u1', title: 'Hi' }, ['title']);
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
    expect(doorRefusal('http', { url: 'https://example.test', timeoutMs: 'soon' })).toContain('refused at `timeoutMs`');
    const engine = engineWith();
    const result = await runPatched(engine, 'http', { url: 'https://example.test', timeoutMs: 1000 }, { timeoutMs: 'soon' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('config.timeoutMs');
  });

  it('screen refuses an out-of-enum mode instead of silently treating it as create', async () => {
    expect(doorRefusal('screen', { objectName: 'crm_lead', mode: 'view' })).toContain('refused at `mode`');
    const engine = engineWith();
    const result = await runPatched(engine, 'screen', { objectName: 'crm_lead', mode: 'edit' }, { mode: 'view' });
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
    const body = { nodes: [{ id: 'b1', type: 'assignment', label: 'B', config: { x: 1 } }], edges: [] };
    expect(doorRefusal('loop', { body })).toContain("config leaves out `collection`");
    const engine = engineWith();
    const result = await runStripped(engine, 'loop', { collection: [1], body }, ['collection']);
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
    expect(doorRefusal('map', { flowName: 'child' })).toContain("config leaves out `collection`");
    const engine = engineWith();
    const result = await runStripped(engine, 'map', { flowName: 'child', collection: [1] }, ['collection']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('map');
    expect(result.error).toContain('config.collection');
  });

  // ── the two schemaless nodes that joined the seam in #4343 ──────────────
  //
  // `script` could not be parsed while its legal key set depended on
  // `actionType`; converging it to a function call (retiring the branches that
  // never delivered anything) is what made a flat parse fit. `subflow` was
  // always flat — it just carried a hand-written guard instead of the contract.

  it('script refuses a node that names no callable', async () => {
    expect(doorRefusal('script', {})).toContain("config leaves out `function`");
    const engine = engineWith();
    const result = await runStripped(engine, 'script', { function: 'recalc' }, ['function']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy the script contract');
    expect(result.error).toContain('config.function');
  });

  it('script refuses a retired email stub — it used to log a line and report success', async () => {
    const engine = engineWith();
    // `registerFlow` strips the retired keys on rehydration (#3903), so what
    // reaches the parse is a node with nothing to run. Before #4343 this was a
    // green step that delivered no mail. Since #20316 the flow parse behind
    // that conversion refuses the stripped node itself — it names no
    // `function` — so the flow no longer registers; the run below meets the
    // same stripped shape past the doors.
    expect(doorRefusal('script', {
      actionType: 'email', template: 'task_done', recipients: ['{record.owner}'],
    })).toContain("config leaves out `function`");
    const result = await runStripped(engine, 'script', {
      function: 'send_mail', actionType: 'email', template: 'task_done', recipients: ['{record.owner}'],
    }, ['function']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy the script contract');
  });

  it('a script parse refusal is a guard — a fault edge does NOT route it', async () => {
    const engine = engineWith();
    const result = await runStripped(
      engine,
      'script',
      { function: 'post_to_slack', actionType: 'slack', template: 't' },
      ['function'],
      {
        nodes: [{ id: 'recover', type: 'assignment', label: 'R', config: { recovered: true } }],
        edges: [{ id: 'e3', source: 'n1', target: 'recover', type: 'fault' }],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy the script contract');
  });

  it('an unresolvable function name stays ROUTABLE — the registry is the host, not the metadata', async () => {
    const engine = engineWith();
    engine.registerFlow('f', flowWith(
      'script',
      { function: 'never_registered' },
      {
        nodes: [{ id: 'recover', type: 'assignment', label: 'R', config: { recovered: true } }],
        edges: [{ id: 'e3', source: 'n1', target: 'recover', type: 'fault' }],
      },
    ));

    // The negative half of the contract (#3863): the same flow succeeds on a
    // host that registers the name, so the author must be able to handle it.
    const result = await engine.execute('f');
    expect(result.success).toBe(true);
  });

  it('subflow refuses a missing flowName through the contract, not a hand-written check', async () => {
    expect(doorRefusal('subflow', {})).toContain("config leaves out `flowName`");
    const engine = engineWith();
    const result = await runStripped(engine, 'subflow', { flowName: 'child' }, ['flowName']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy the subflow contract');
    expect(result.error).toContain('config.flowName');
  });

  it('subflow refuses an empty flowName — declared is not the same as named', async () => {
    expect(doorRefusal('subflow', { flowName: '' })).toContain('refused at `flowName`');
    const engine = engineWith();
    const result = await runPatched(engine, 'subflow', { flowName: 'child' }, { flowName: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('config.flowName');
  });
});
