// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineStack` — ADR-0087 D2 conversion notices reach the author.
 *
 * A conversion is deliberately silent about FIXING the shape — zero consumer
 * action is the point. It is not supposed to be silent about having had to:
 * the notice carries "retires in protocol N", after which the old spelling
 * stops loading. `defineStack` once passed no sink, so the author who wrote the
 * old shape heard nothing unless they happened to run `os validate` (`os build`
 * was deaf too).
 *
 * This block lived in `stack.test.ts`, driven by
 * `flow-node-http-callout-rename`, until #23543 F5-http retired that entry —
 * the last real one left live on the load path. The subject is the sink and its
 * warn-once, not any one entry, so the vehicle is a conversion this file owns: a
 * test-only flow-node type rename appended to the table the pass reads.
 * `vi.mock` replaces the registry module for the whole file, so `apply.ts`
 * (which `defineStack` calls) reads the extended table; nothing outside this
 * file sees the probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineStack } from './stack.zod';
import type { MetadataConversion } from './conversions/types';

const PROBE = 'stack-conversion-notices-probe';

vi.mock('./conversions/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('./conversions/registry')>();
  const { mapFlowNodes } = await import('./conversions/walk');
  const probe: MetadataConversion = {
    id: 'stack-conversion-notices-probe',
    toMajor: 18,
    surface: 'flow.node.type (test probe)',
    summary: "test-only probe: a live load-path rename, node type 'probe_old_callout' → 'http'",
    apply(stack, emit) {
      return mapFlowNodes(stack, (node, path) => {
        if (node.type !== 'probe_old_callout') return node;
        emit({ from: 'probe_old_callout', to: 'http', path: `${path}.type` });
        return { ...node, type: 'http' };
      });
    },
    fixture: { before: {}, after: {}, expectedNotices: 0 },
  };
  return { ...original, ALL_CONVERSIONS: [...original.ALL_CONVERSIONS, probe] };
});

describe('defineStack — ADR-0087 D2 conversion notices', () => {
  const manifest = { id: 'com.example.p', version: '1.0.0', type: 'app' as const, name: 'P', namespace: 'demo' };
  const obj = { name: 'demo_task', label: 'Task', fields: { title: { type: 'text' as const } } };

  // A flow node typed with the probe's old spelling — it converts to `http`.
  //
  // The warn-once key is (conversionId, path, from, to) and the notice path is
  // INDEX-based (`flows[i].nodes[j].type`) — the flow's name never enters it.
  // Since the dedupe set is process-scoped by design, every case below has to
  // occupy its own node index or it silently reuses an earlier case's key and
  // asserts nothing.
  const legacyFlowAt = (index: number) => ({
    name: `conv_demo_${index}`,
    nodes: [
      ...Array.from({ length: index }, (_, i) => ({ id: `n_pad_${i}`, type: 'http' })),
      { id: 'n_call', type: 'probe_old_callout' },
    ],
  });
  // Non-strict throughout: the assertion is about the conversion sink alone,
  // not about satisfying every downstream cross-reference check. The sink is
  // wired on the single `normalizeStackInput` call that runs BEFORE the strict
  // branch, so both modes go through it.
  // The flows are deliberately minimal (no label, type or edges) — the
  // non-strict pass is all that runs on them — so they are cast past the
  // authoring type rather than padded out.
  const define = (index: number) =>
    defineStack({ manifest, objects: [obj], flows: [legacyFlowAt(index)] as never }, { strict: false });

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('warns when a conversion rewrites an old shape, naming the retirement major', () => {
    define(0);

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain(`'probe_old_callout' → 'http'`);
    expect(msg).toContain(PROBE);
    expect(msg).toContain('retires in protocol');
  });

  it('nags once per distinct conversion site', () => {
    define(1);
    define(1);
    define(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports a second, distinct site separately', () => {
    // Two different authored occurrences, each needing its own fix — dedupe
    // must not swallow the second.
    define(2);
    define(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('stays quiet for a stack that is already canonical', () => {
    defineStack(
      { manifest, objects: [obj], flows: [{ name: 'conv_canonical', nodes: [{ id: 'n1', type: 'http' }] }] as never },
      { strict: false },
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
