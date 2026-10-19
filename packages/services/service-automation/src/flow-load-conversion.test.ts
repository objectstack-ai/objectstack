// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0087 D2 runtime load seam: `AutomationEngine.registerFlow` canonicalizes a
 * stored flow's shape on rehydration, BEFORE parse + execution — so a stored
 * flow authored against an old protocol shape keeps running with zero action,
 * and dropping a deprecated executor alias never silently changes behavior.
 *
 * The retired callout node types (`webhook`/`http_request`/`http_call` → `http`)
 * are reserved since 18 (#23543 F5-http): the authoring doors refuse them, and
 * this engine refuses to register an executor under one. So a stored flow that
 * still carries one is rewritten to `http` unconditionally — until 18 the
 * rename skipped a node whose old name a live custom executor owned, and that
 * owner can no longer exist.
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';

function collectingLogger(warns: string[]): any {
  const l: any = { info() {}, warn(m: string) { warns.push(m); }, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

function flowWith(node: Record<string, unknown>) {
  return {
    name: 'f', label: 'F', type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'n', label: 'N', ...node },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n' },
      { id: 'e2', source: 'n', target: 'end' },
    ],
  };
}

describe('registerFlow canonicalizes stored flows (ADR-0087 D2 runtime seam)', () => {
  it('rewrites a retired callout node type to `http` on rehydration', async () => {
    const warns: string[] = [];
    const engine = new AutomationEngine(collectingLogger(warns));
    engine.registerFlow('f', flowWith({ id: 'n', type: 'http_request', config: { url: 'https://x' } }));

    const stored = await engine.getFlow('f');
    expect(stored?.nodes.find((n) => n.id === 'n')?.type).toBe('http');
    expect(warns.some((w) => w.includes("'http_request' → 'http'"))).toBe(true);
  });

  it('leaves a canonical flow untouched (no notice)', async () => {
    const warns: string[] = [];
    const engine = new AutomationEngine(collectingLogger(warns));
    engine.registerFlow('f', flowWith({ id: 'n', type: 'http', config: { url: 'https://x' } }));

    const stored = await engine.getFlow('f');
    expect(stored?.nodes.find((n) => n.id === 'n')?.type).toBe('http');
    expect(warns.some((w) => w.includes('OS_METADATA_CONVERTED') || w.includes('→'))).toBe(false);
  });

  it('rewrites every reserved callout name in a stored flow, one notice per site', async () => {
    const warns: string[] = [];
    const engine = new AutomationEngine(collectingLogger(warns));
    engine.registerFlow('f', {
      name: 'f', label: 'F', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n', type: 'webhook', label: 'N', config: { url: 'https://x' } },
        { id: 'm', type: 'http_call', label: 'M', config: { url: 'https://y' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'n' },
        { id: 'e2', source: 'n', target: 'm' },
        { id: 'e3', source: 'm', target: 'end' },
      ],
    });

    const stored = await engine.getFlow('f');
    expect(stored?.nodes.filter((n) => n.id === 'n' || n.id === 'm').map((n) => n.type)).toEqual(['http', 'http']);
    expect(warns.filter((w) => w.includes('OS_METADATA_CONVERTED'))).toHaveLength(2);
  });
});

describe('registerNodeExecutor refuses the reserved callout names (#23543 F5-http)', () => {
  it.each(['http_request', 'http_call', 'webhook'])("refuses an executor typed '%s', naming http, and registers nothing", (type) => {
    const engine = new AutomationEngine(collectingLogger([]));
    const before = engine.getRegisteredNodeTypes();
    expect(() => engine.registerNodeExecutor({
      type,
      async execute() { return { success: true, output: {} }; },
    })).toThrow(new RegExp(`^Node executor type '${type}' is reserved: it is a retired official flow node name, superseded by 'http'`));
    expect(engine.getRegisteredNodeTypes()).toEqual(before);
    expect(engine.getActionDescriptor(type)).toBeUndefined();
  });

  it('refuses a descriptor published under a reserved name beside a type of its own', () => {
    const engine = new AutomationEngine(collectingLogger([]));
    expect(() => engine.registerNodeExecutor({
      type: 'acme_callout',
      descriptor: { type: 'webhook', version: '1.0.0', name: 'Webhook' } as never,
      async execute() { return { success: true, output: {} }; },
    })).toThrow(/^Node executor type 'webhook' is reserved/);
    expect(engine.getRegisteredNodeTypes()).not.toContain('acme_callout');
    expect(engine.getActionDescriptor('webhook')).toBeUndefined();
  });

  it('refuses a deprecated alias under a reserved name too', () => {
    const engine = new AutomationEngine(collectingLogger([]));
    expect(() => engine.registerNodeAlias('http_request', 'http')).toThrow(/^Node executor type 'http_request' is reserved/);
    expect(engine.getRegisteredNodeTypes()).not.toContain('http_request');
  });

  it('CONTROL — a plugin type of its own registers, including one that merely contains a reserved name', () => {
    const engine = new AutomationEngine(collectingLogger([]));
    for (const type of ['acme_webhook', 'http_request_v2']) {
      engine.registerNodeExecutor({ type, async execute() { return { success: true, output: {} }; } });
      expect(engine.getRegisteredNodeTypes()).toContain(type);
    }
  });
});
