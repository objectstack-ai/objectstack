// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29025] A flow whose loop-closing edge is not typed `back` is refused at
// publish, and its draft read says so, over the real showcase composition and
// through the REST doors the card measured.
//
// ## What was broken
//
// `PUT /api/v1/meta/flow/:name?mode=draft&package=PKG` with a loop
// push → check → revise → push and no `type` on revise → push saved, the draft
// read answered `_diagnostics: { valid: true }`, and `publish-drafts` answered
// `outcome: 'published'`. The automation engine then refused to register the
// flow ("Flow contains a cycle: …"), so it never ran, and only the by-name
// read's `registration` and the boot log said why.
//
// ## What these cases pin
//
// The draft still saves (drafts are never gated). Its read answers
// `valid: false` with the `flow-undeclared-cycle` finding on the closing edge,
// in the engine's own sentence, and `publish-drafts` refuses the batch with
// the same finding. Control: the same loop with its closing edge typed `back`
// reads valid, publishes, and the engine registers it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG_BAD = 'app.cycprobe29025';
const PKG_OK = 'app.cycprobeok29025';

/** The engine's refusal sentence for the card's walk. */
const CYCLE_SENTENCE = 'Flow contains a cycle: cycprobe_push → cycprobe_check → cycprobe_revise → cycprobe_push.';

const loopFlow = (name: string, loopType?: 'back') => ({
  name,
  label: 'Cycle probe',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'cycprobe_push', type: 'assignment', label: 'Push' },
    { id: 'cycprobe_check', type: 'decision', label: 'Check' },
    { id: 'cycprobe_revise', type: 'assignment', label: 'Revise' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'cycprobe_push' },
    { id: 'e2', source: 'cycprobe_push', target: 'cycprobe_check' },
    { id: 'e3', source: 'cycprobe_check', target: 'end', type: 'conditional', condition: 'true' },
    { id: 'e4', source: 'cycprobe_check', target: 'cycprobe_revise', type: 'conditional', condition: 'false' },
    { id: 'e5', source: 'cycprobe_revise', target: 'cycprobe_push', ...(loopType ? { type: loopType } : {}) },
  ],
});

describe('dogfood: a flow with an undeclared cycle is refused at publish, and its draft says so (#29025)', () => {
  let stack: VerifyStack;
  let token: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  const createPackage = async (id: string, namespace: string) => {
    const created = await call('POST', '/packages', {
      manifest: { id, name: `Cycle probe ${namespace}`, version: '0.1.0', type: 'app', namespace },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    await createPackage(PKG_BAD, 'cycprobe');
    await createPackage(PKG_OK, 'cycprobeok');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the card: the draft saves, reads valid:false on the closing edge, and publish-drafts refuses it', async () => {
    const saved = await call('PUT', `/meta/flow/cycprobe_loop?mode=draft&package=${PKG_BAD}`, loopFlow('cycprobe_loop'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const read = await call('GET', `/meta/flow/cycprobe_loop?state=draft&package=${PKG_BAD}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    const diagnostics = JSON.stringify(read.json);
    expect(diagnostics).toContain('"valid":false');
    expect(diagnostics).toContain('"code":"flow-undeclared-cycle"');
    expect(diagnostics).toContain('"path":"edges.4"');
    expect(diagnostics).toContain(CYCLE_SENTENCE);

    const published = await call('POST', `/packages/${PKG_BAD}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    expect(published.json?.data).toMatchObject({ outcome: 'refused', publishedCount: 0 });
    expect(JSON.stringify(published.json)).toContain('flow-undeclared-cycle');
  });

  it('control: the same loop with its closing edge typed back reads valid, publishes, and registers', async () => {
    const saved = await call('PUT', `/meta/flow/cycprobeok_loop?mode=draft&package=${PKG_OK}`, loopFlow('cycprobeok_loop', 'back'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const read = await call('GET', `/meta/flow/cycprobeok_loop?state=draft&package=${PKG_OK}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(JSON.stringify(read.json)).toContain('"_diagnostics":{"valid":true}');

    const published = await call('POST', `/packages/${PKG_OK}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    expect(published.json?.data).toMatchObject({ outcome: 'published', publishedCount: 1 });

    let served = '';
    for (let i = 0; i < 50; i += 1) {
      served = JSON.stringify((await call('GET', '/meta/flow/cycprobeok_loop')).json);
      if (served.includes('"registration":{"state":"registered"}')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(served).toContain('"registration":{"state":"registered"}');
  });
});
