// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29233] A flow whose loop / parallel / try_catch region is malformed is
// refused at every publish door, and its draft read says so, over the real
// showcase composition and through the REST doors the card measured.
//
// ## What was broken
//
// `PUT /api/v1/meta/flow/:name?mode=draft&package=PKG` with a loop whose body
// is a → b → a saved, the draft read answered `_diagnostics: { valid: true }`,
// and `publish-drafts` answered `outcome: 'published'`. The automation engine
// then refused to register the flow ("loop 'lp' body: region has no entry
// node …"), so it never ran, and only the by-name read's `registration` and
// the boot log said why.
//
// ## What these cases pin
//
// The draft still saves (drafts are never gated). Its read answers
// `valid: false` with the `flow-region-shape-invalid` finding on the flow, in
// the engine's own sentence; `publish-drafts`, the per-item publish and a live
// save each refuse it before any write. Control: a well-formed loop, parallel
// and try_catch region each read valid, publish, and the engine registers them.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG_BAD = 'app.rgnprobe29233';
const PKG_OK = 'app.rgnprobeok29233';

/** The engine's registration refusal for the card's loop. */
const REGION_SENTENCE =
  "loop 'lp' body: region has no entry node (every node has an incoming edge — cyclic?); "
  + 'region has no exit node (every node has an outgoing edge — cyclic?); '
  + 'region contains a cycle (region bodies must be acyclic)';

const step = (id: string) => ({ id, type: 'assignment', label: id });
const oneStep = (id: string) => ({ nodes: [step(id)], edges: [] });

/** start → CONTAINER → end. */
const regionFlow = (name: string, container: { id: string } & Record<string, unknown>) => ({
  name,
  label: 'Region probe',
  type: 'autolaunched',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, container, { id: 'end', type: 'end', label: 'End' }],
  edges: [
    { id: 'e1', source: 'start', target: container.id },
    { id: 'e2', source: container.id, target: 'end' },
  ],
});

/** The card's flow: a loop whose body a → b → a closes on itself. */
const closedLoopFlow = (name: string, prefix: string) => regionFlow(name, {
  id: 'lp',
  type: 'loop',
  label: 'Loop',
  config: {
    collection: [1, 2],
    iteratorVariable: 'row',
    body: {
      nodes: [step(`${prefix}_a`), step(`${prefix}_b`)],
      edges: [
        { id: `${prefix}_1`, source: `${prefix}_a`, target: `${prefix}_b` },
        { id: `${prefix}_2`, source: `${prefix}_b`, target: `${prefix}_a` },
      ],
    },
  },
});

describe('dogfood: a flow with a malformed region is refused at publish, and its draft says so (#29233)', () => {
  let stack: VerifyStack;
  let token: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  const createPackage = async (id: string, namespace: string) => {
    const created = await call('POST', '/packages', {
      manifest: { id, name: `Region probe ${namespace}`, version: '0.1.0', type: 'app', namespace },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
  };

  const expectRegionRefusal = (res: { status: number; json: any }) => {
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    const text = JSON.stringify(res.json);
    expect(text).toContain('INVALID_METADATA');
    expect(text).toContain('flow-region-shape-invalid');
  };

  /** No active row was written: the by-name read serves nothing under that name. */
  const expectNoActiveRow = async (name: string) => {
    const served = await call('GET', `/meta/flow/${name}`);
    expect(served.status, JSON.stringify(served.json)).toBe(404);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    await createPackage(PKG_BAD, 'rgnprobe');
    await createPackage(PKG_OK, 'rgnprobeok');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the card: the draft saves, reads valid:false on the loop, and publish-drafts refuses it before any write', async () => {
    const saved = await call('PUT', `/meta/flow/rgnprobe_loop?mode=draft&package=${PKG_BAD}`, closedLoopFlow('rgnprobe_loop', 'k'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const read = await call('GET', `/meta/flow/rgnprobe_loop?state=draft&package=${PKG_BAD}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    const diagnostics = JSON.stringify(read.json);
    expect(diagnostics).toContain('"valid":false');
    expect(diagnostics).toContain('"code":"flow-region-shape-invalid"');
    // The registry rule anchors the flow itself: the item root, in item-relative spelling.
    expect(diagnostics).toContain('"path":""');
    expect(diagnostics).toContain(JSON.stringify(`Flow 'rgnprobe_loop' would be refused at registration: ${REGION_SENTENCE}`));

    const published = await call('POST', `/packages/${PKG_BAD}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    expect(published.json?.data).toMatchObject({ outcome: 'refused', publishedCount: 0 });
    expect(JSON.stringify(published.json)).toContain('flow-region-shape-invalid');
    await expectNoActiveRow('rgnprobe_loop');
  }, 30_000);

  it('the per-item publish and a live save refuse it too, before any write', async () => {
    const drafted = await call('PUT', '/meta/flow/rgnprobe_item?mode=draft', closedLoopFlow('rgnprobe_item', 'i'));
    expect(drafted.status, JSON.stringify(drafted.json)).toBe(200);
    expectRegionRefusal(await call('POST', '/meta/flow/rgnprobe_item/publish', {}));
    await expectNoActiveRow('rgnprobe_item');

    expectRegionRefusal(await call('PUT', '/meta/flow/rgnprobe_live', closedLoopFlow('rgnprobe_live', 'v')));
    await expectNoActiveRow('rgnprobe_live');
  }, 30_000);

  it('control: a well-formed loop, parallel and try_catch region each read valid, publish, and register', async () => {
    const flows = [
      regionFlow('rgnprobeok_loop', {
        id: 'lp', type: 'loop', label: 'Loop',
        config: { collection: [1, 2], iteratorVariable: 'row', body: oneStep('ok_loop_step') },
      }),
      regionFlow('rgnprobeok_parallel', {
        id: 'fan', type: 'parallel', label: 'Fan',
        config: { branches: [oneStep('ok_left_step'), oneStep('ok_right_step')] },
      }),
      regionFlow('rgnprobeok_try', {
        id: 'guard', type: 'try_catch', label: 'Guard',
        config: { try: oneStep('ok_try_step'), catch: oneStep('ok_catch_step') },
      }),
    ];
    for (const flow of flows) {
      const saved = await call('PUT', `/meta/flow/${flow.name}?mode=draft&package=${PKG_OK}`, flow);
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      const read = await call('GET', `/meta/flow/${flow.name}?state=draft&package=${PKG_OK}`);
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      expect(JSON.stringify(read.json)).toContain('"_diagnostics":{"valid":true}');
    }

    const published = await call('POST', `/packages/${PKG_OK}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    expect(published.json?.data).toMatchObject({ outcome: 'published', publishedCount: 3 });

    for (const flow of flows) {
      let served = '';
      for (let i = 0; i < 50; i += 1) {
        served = JSON.stringify((await call('GET', `/meta/flow/${flow.name}`)).json);
        if (served.includes('"registration":{"state":"registered"}')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(served, flow.name).toContain('"registration":{"state":"registered"}');
    }
    // Three saves, three reads, a package publish and up to three registration
    // polls of 5 s each: the default 5 s per test was measured too tight inside
    // the full battery on a shared box.
  }, 60_000);
});
