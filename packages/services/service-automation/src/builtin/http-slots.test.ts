// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **An `http` node's url and headers are text slots, its body a value slot,
 * and the rest literals** (#19939, the rider positions' fifth stage; #11182
 * ruling D; ADR-0032 Decisions 2 and 3). `url` and every `headers` value
 * render `{{ }}` holes; `body` takes a CEL value envelope or a literal;
 * `method`, `durable`, `timeoutMs` and `signingSecret` are read as written:
 * the 17.x interpolator resolved them too, but no shipped flow computed one,
 * so no slot is built there (the S4 rule) and a `{…}` token there is refused
 * with the literal's remedy.
 *
 * Before this, the executor handed its WHOLE config to the single-brace
 * `interpolate()` and parsed the result: a `{token}` resolved anywhere, a
 * whole token in a typed key (`timeoutMs: '{t}'`) resolved to its value's
 * type, and a CEL envelope in the body was sent as the object it spells.
 *
 * Pinned through the shipped `AutomationEngine`:
 *
 *  1. **Refused at every door.** A `{…}` token stops the flow registering,
 *     located at the position and naming its `{{ }}` spelling (a text slot),
 *     its CEL spelling (the body) or the value itself (a literal); the
 *     executor's contract parse refuses it as a guard. `signingSecret` is
 *     run-resolved — the credential store may hold the secret — so its token
 *     is refused at the run alone.
 *  2. **Rendered and evaluated in the run's scope**, and the literals read as
 *     written, on the inline call.
 *  3. **Once, before either mode.** The durable outbox enqueues the rendered
 *     url and headers and the evaluated payload — nothing renders at delivery.
 *  4. **Absent and nothing.** A url that renders to no text refuses the node;
 *     a header that renders to no text is not sent; an absent variable in the
 *     body fails the run with an evaluation fault, and nothing is sent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEXT_SLOT_TEMPLATE_REFUSAL, VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

const CEL = (source: string) => ({ dialect: 'cel', source });
const URL_BASE = 'https://api.example.test/v1';

interface Enqueued { url: string; method?: string; headers?: Record<string, string>; payload: unknown; timeoutMs?: number }

/** An engine with the builtins and, when `durable`, a messaging HTTP outbox that records each enqueue. */
function makeEngine(durable = false): { engine: AutomationEngine; enqueued: Enqueued[] } {
  const enqueued: Enqueued[] = [];
  const messaging = durable
    ? { isHttpDeliveryReady: () => true, async enqueueHttp(input: Enqueued) { enqueued.push(input); return 'dlv_1'; } }
    : undefined;
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, {
    logger: silentLogger(),
    getService(name: string) { return name === 'messaging' ? messaging : undefined; },
  } as any);
  return { engine, enqueued };
}

/** start → http → end, with `config`. */
function flowOf(name: string, config: Record<string, unknown>): any {
  return {
    name, label: name, type: 'autolaunched',
    variables: [
      { name: 'id', type: 'text', isInput: true },
      { name: 'title', type: 'text', isInput: true },
      { name: 'obj', type: 'object', isInput: true },
    ],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'node', type: 'http', label: 'HTTP', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'node' },
      { id: 'e2', source: 'node', target: 'end' },
    ],
  };
}

function registerError(config: Record<string, unknown>): string {
  try {
    makeEngine().engine.registerFlow('refused', flowOf('refused', config));
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

/** The builtin `http` executor itself — the run-time door, reached without `registerFlow`. */
function httpExecutor(): { execute: (...args: any[]) => Promise<any> } {
  const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const engine = new AutomationEngine(silentLogger());
  const recorder = new Proxy(engine, {
    get(target, key, receiver) {
      if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
      return Reflect.get(target, key, receiver);
    },
  });
  installBuiltinNodes(recorder as AutomationEngine, { logger: silentLogger(), getService() { return undefined; } } as any);
  return executors.get('http')!;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, async json() { return { ok: true }; }, async text() { return ''; } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function run(config: Record<string, unknown>, params: Record<string, unknown> = {}, durable = false) {
  const { engine, enqueued } = makeEngine(durable);
  engine.registerFlow('probe', flowOf('probe', config));
  const result = await engine.execute('probe', { params } as any);
  const runs = await engine.listRuns('probe');
  const step = runs[0]?.steps.find((s) => s.nodeId === 'node');
  return { result, enqueued, step };
}

/** What the inline arm handed `fetch`: the url and the request init. */
function sent(): { url: string; init: { method: string; headers?: Record<string, string>; body?: string } } {
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  return { url: url as string, init: init as any };
}

/** Each typed literal: the config holding `value` there, and the sentence its refusal leads with. */
const LITERALS = [
  ['method', (value: unknown) => ({ url: URL_BASE, method: value }), '`method` is the request method (`GET`, `POST`, …), a literal the executor reads as written:'],
  ['durable', (value: unknown) => ({ url: URL_BASE, durable: value }), '`durable` is whether the call goes through the durable outbox, `true` or `false`, a literal the executor reads as written:'],
  ['timeoutMs', (value: unknown) => ({ url: URL_BASE, timeoutMs: value }), '`timeoutMs` is the per-request timeout in milliseconds, a number, a literal the executor reads as written:'],
] as const;

const LITERAL_TOKEN_REMEDY = 'a single-brace token is not resolved here; write the value.';
const LITERAL_ENVELOPE_REMEDY = 'a CEL value envelope is not evaluated here; write the value.';

describe('1. a `{…}` token is refused at every door', () => {
  it('url: `registerFlow` refuses a single-brace token, naming its hole spelling', () => {
    const message = registerError({ url: `${URL_BASE}/orders/{id}` });
    expect(message).toContain(`http url at config.url: ${TEXT_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain(`Write \`${URL_BASE}/orders/{id}\` as \`${URL_BASE}/orders/{{ id }}\`.`);
  });

  it('a headers value: `registerFlow` refuses a single-brace token at its own path, naming its hole spelling', () => {
    const message = registerError({ url: URL_BASE, headers: { 'X-Ref': 'r-{id}' } });
    expect(message).toContain(`http header at config.headers.X-Ref: ${TEXT_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain('Write `r-{id}` as `r-{{ id }}`.');
  });

  it('body: `registerFlow` refuses a token, located inside the literal, naming the whole-value envelope', () => {
    const message = registerError({ url: URL_BASE, body: { id: '{id}', status: 'done' } });
    expect(message).toContain(`http body at config.body.id: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain('Compute the whole value as one CEL envelope that builds it');
    const whole = registerError({ url: URL_BASE, body: '{obj}' });
    expect(whole).toContain(`http body at config.body: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    expect(whole).toContain("Write `{obj}` as { dialect: 'cel', source: 'obj' }.");
  });

  it.each([
    ['url', { url: `${URL_BASE}/{id}` }, TEXT_SLOT_TEMPLATE_REFUSAL],
    ['a headers value', { url: URL_BASE, headers: { 'X-Ref': '{id}' } }, TEXT_SLOT_TEMPLATE_REFUSAL],
    ['body', { url: URL_BASE, body: { id: '{id}' } }, VALUE_SLOT_TEMPLATE_REFUSAL],
  ] as const)('%s: the executor\'s contract parse refuses it as a guard', async (_label, config, lead) => {
    const result = await httpExecutor().execute(
      { id: 'node', type: 'http', label: 'HTTP', config },
      new Map<string, unknown>([['id', '42']]),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('guard');
    expect(result.error).toContain(lead);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(LITERALS)('%s (a literal): `registerFlow` refuses a `{…}` token and a CEL envelope with the literal remedy', (label, configOf, lead) => {
    const token = registerError(configOf('{id}'));
    expect(token).toContain(`refused at \`${label}\` by the http contract: ${lead} ${LITERAL_TOKEN_REMEDY}`);
    expect(token).not.toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
    const envelope = registerError(configOf(CEL('id')));
    expect(envelope).toContain(`refused at \`${label}\` by the http contract: ${lead} ${LITERAL_ENVELOPE_REMEDY}`);
  });

  it.each(LITERALS)('%s (a literal): the executor\'s contract parse refuses a token as a guard', async (_label, configOf, lead) => {
    const result = await httpExecutor().execute(
      { id: 'node', type: 'http', label: 'HTTP', config: configOf('{id}') },
      new Map<string, unknown>([['id', '42']]),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('guard');
    expect(result.error).toContain(lead);
    expect(result.error).toContain(LITERAL_TOKEN_REMEDY);
  });

  it('headers: a token written as the whole map is refused at `registerFlow` — a map is not computed into it', () => {
    expect(registerError({ url: URL_BASE, headers: '{obj}' }))
      .toContain('refused at `headers` by the http contract: `headers` is a map of header name to text, read as written');
  });

  it('signingSecret: run-resolved — `registerFlow` leaves it to the run, whose contract parse refuses the token', async () => {
    expect(registerError({ url: URL_BASE, signingSecret: '{id}' })).toBe('');
    const { result, step } = await run({ url: URL_BASE, signingSecret: '{id}' }, { id: 'k' });
    expect(result.success).toBe(false);
    expect(step?.error?.message).toContain('config.signingSecret');
    expect(step?.error?.message).toContain('a single-brace `{…}` token is not resolved here');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('2. rendered and evaluated in the run\'s scope; the literals read as written', () => {
  it('the url and each header render their holes; the body envelope evaluates to the payload', async () => {
    const { result } = await run(
      {
        url: `${URL_BASE}/orders/{{ id }}`,
        method: 'PUT',
        headers: { 'X-Ref': 'r-{{ id }}', 'X-Kind': 'probe' },
        body: CEL("{'id': id, 'text': 'Done: ' + title}"),
        timeoutMs: 5000,
      },
      { id: 'o_7', title: 'Ship it' },
    );
    expect(result.success).toBe(true);
    const { url, init } = sent();
    expect(url).toBe(`${URL_BASE}/orders/o_7`);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'X-Ref': 'r-o_7', 'X-Kind': 'probe' });
    expect(JSON.parse(init.body!)).toEqual({ id: 'o_7', text: 'Done: Ship it' });
  });

  it('a literal body is sent as written — a nested envelope is data', async () => {
    await run({ url: URL_BASE, method: 'POST', body: { n: 1, inner: CEL('id') } });
    expect(JSON.parse(sent().init.body!)).toEqual({ n: 1, inner: { dialect: 'cel', source: 'id' } });
  });

  it('a whole hole holding a map renders JSON in a header, never `[object Object]`', async () => {
    await run({ url: URL_BASE, headers: { 'X-Obj': '{{ obj }}' } }, { obj: { a: 1 } });
    expect(sent().init.headers).toEqual({ 'X-Obj': '{"a":1}' });
  });
});

describe('3. once, before either mode — the durable outbox enqueues the rendered request', () => {
  it('the enqueued url, headers and payload are the rendered and evaluated ones', async () => {
    const { result, enqueued } = await run(
      {
        url: `${URL_BASE}/orders/{{ id }}`,
        durable: true,
        headers: { 'X-Ref': 'r-{{ id }}' },
        body: CEL("{'id': id}"),
        timeoutMs: 1500,
      },
      { id: 'o_7' },
      true,
    );
    expect(result.success).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      url: `${URL_BASE}/orders/o_7`,
      method: 'POST',
      headers: { 'X-Ref': 'r-o_7' },
      payload: { id: 'o_7' },
      timeoutMs: 1500,
    });
    // Nothing is left for delivery to render.
    expect(JSON.stringify(enqueued[0])).not.toContain('{{');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('4. absent and nothing', () => {
  it('a url that renders to no text refuses the node, and nothing is sent', async () => {
    const { result, step } = await run({ url: '{{ id }}' });
    expect(result.success).toBe(false);
    expect(step?.error?.message).toContain('http: url is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a header that renders to no text is not sent', async () => {
    await run({ url: URL_BASE, headers: { 'X-Ref': '{{ id }}', 'X-Kind': 'probe' } });
    expect(sent().init.headers).toEqual({ 'X-Kind': 'probe' });
  });

  it('an absent variable in the body fails the run with an evaluation fault naming it, and nothing is sent', async () => {
    const { result, step } = await run({ url: URL_BASE, method: 'POST', body: CEL("{'id': id}") });
    expect(result.success).toBe(false);
    expect(step?.error?.code).toBe('EXECUTION_ERROR');
    expect(step?.error?.message).toContain('body: value expression failed to evaluate as CEL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
