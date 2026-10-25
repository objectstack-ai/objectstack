/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#12742 — `@objectstack/spec` 18 reserves the flow node types
 * `http_request`, `http_call` and `webhook`: the flow parse refuses each at a
 * node's `type`, top level and inside `loop` / `parallel` / `try_catch` region
 * bodies, with the rename to `http`. The preview samples are the worked
 * examples the designers render, so none of them may carry one.
 *
 * The walk visits every object reachable from `SAMPLES` that holds a `nodes`
 * array, so a region body at any depth is swept. The installed spec may not
 * refuse the names yet; this sweep does not wait for it.
 */

import { describe, it, expect } from 'vitest';
import { SAMPLES } from '../preview-samples';

const RESERVED = ['http_request', 'http_call', 'webhook'];

interface SweptNode {
  sample: string;
  id: unknown;
  type: unknown;
}

function collectNodes(sample: string, value: unknown, out: SweptNode[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(sample, v, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes) {
      if (n && typeof n === 'object') {
        const node = n as Record<string, unknown>;
        out.push({ sample, id: node.id, type: node.type });
      }
    }
  }
  for (const v of Object.values(obj)) collectNodes(sample, v, out);
}

const NODES: SweptNode[] = [];
for (const [key, sample] of Object.entries(SAMPLES)) collectNodes(key, sample, NODES);

describe('preview samples carry no flow node type spec 18 reserves (objectui#12742)', () => {
  it('the walk reaches region bodies (lit control)', () => {
    // `charge_fee` sits in a loop body, `push` in a try_catch `try` region.
    const byId = new Map(NODES.map((n) => [n.id, n]));
    expect(byId.get('charge_fee')?.type).toBe('http');
    expect(byId.get('push')?.type).toBe('http');
  });

  it('no node in any sample, at any depth, is typed with a reserved name', () => {
    const offenders = NODES.filter((n) => RESERVED.includes(String(n.type))).map(
      (n) => `${n.sample}: ${String(n.id)} (${String(n.type)})`,
    );
    expect(offenders).toEqual([]);
  });
});
