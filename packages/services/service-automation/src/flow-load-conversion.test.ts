// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0087 D2 runtime load seam: `AutomationEngine.registerFlow` canonicalizes a
 * stored flow's shape on rehydration, BEFORE parse + execution — so a stored
 * flow authored against an old protocol shape keeps running with zero action,
 * and dropping a deprecated executor alias never silently changes behavior.
 *
 * Open-namespace node-type renames (`webhook`/`http_request`/`http_call` → `http`)
 * are conflict-aware: if a live custom executor owns the retired name, the rename
 * is refused and a loud diagnostic is logged instead of clobbering the node.
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

  it('refuses to rewrite a retired name a live custom executor owns, logging a conflict', async () => {
    const warns: string[] = [];
    const engine = new AutomationEngine(collectingLogger(warns));

    // A third party registers a custom node under the retired official name.
    let ran = false;
    engine.registerNodeExecutor({
      type: 'webhook',
      async execute() { ran = true; return { success: true, output: {} }; },
    });

    engine.registerFlow('f', flowWith({ id: 'n', type: 'webhook', config: {} }));

    const stored = await engine.getFlow('f');
    // NOT clobbered to `http` — the custom node survives.
    expect(stored?.nodes.find((n) => n.id === 'n')?.type).toBe('webhook');
    expect(warns.some((w) => w.includes('OS_METADATA_CONVERSION_CONFLICT'))).toBe(true);

    await engine.execute('f');
    expect(ran).toBe(true); // the custom executor actually ran
  });
});
