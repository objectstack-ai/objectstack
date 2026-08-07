// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `flow.zod` ↔ `control-flow.zod` import cycle survives **eager** schema
 * construction, in either import order (#4415).
 *
 * `FlowNodeSchema` parses its own ADR-0031 regions, so it needs
 * `FlowRegionSchema` / `ParallelBranchSchema`; those hold `z.array(FlowNodeSchema)`.
 * The recursion is genuinely mutual, so the two modules import each other. Three
 * things keep that legal, and every one of them looks like an ordinary style
 * choice to the next person who edits it:
 *
 *   1. the region schemas back-reference through `z.lazy(() => FlowNodeSchema)`
 *      / `z.lazy(() => FlowEdgeSchema)` rather than naming them directly;
 *   2. `flowNodeObject()` is a **hoisted `function` declaration**, not a `const`
 *      arrow;
 *   3. every schema in both modules stays inside a `lazySchema()` factory.
 *
 * Undo any of them and module evaluation reads a `const` still in its temporal
 * dead zone: `ReferenceError: Cannot access 'FlowNodeSchema' before
 * initialization`, thrown at import time, before a single test body runs.
 *
 * **Why this needs its own test rather than the ordinary suite.** `lazySchema`
 * defers construction behind a Proxy, which hides the whole hazard — the normal
 * vitest run never triggers it. It only appears under `OS_EAGER_SCHEMAS=1`, the
 * documented rollback switch, which `gen:schema` / `check:authorable-surface`
 * set. So without this file the regression surfaces as a generator crash in CI
 * with no test naming the cause; with it, the failure says what to restore.
 *
 * Two entry points, because eager evaluation order is decided by whichever
 * module the process enters first: the `automation` barrel (what every real
 * consumer and `gen:schema` reach through) and `flow.zod` directly (the order
 * that breaks first if the `z.lazy` back-references are unwrapped). Entering
 * `control-flow.zod` directly is deliberately NOT asserted — that order already
 * dies on an unrelated, pre-existing `strict-object.ts` ↔ `field.zod.ts` TDZ on
 * `origin/main`, measured while writing this file and filed separately; pinning
 * it here would pin someone else's bug to this feature.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Import the two modules in a given order under eager construction. */
function importEagerly(first: string, second: string): string {
  return execFileSync(
    process.execPath,
    [
      '--import', 'tsx',
      '--input-type=module',
      '-e',
      // The two bare imports ARE the assertion: under OS_EAGER_SCHEMAS=1 every
      // schema in both modules is constructed during this evaluation, so a TDZ
      // regression throws here. The parse below then proves the cycle produced
      // a working schema and not merely a silent one.
      // (tsx compiles .ts to CJS, so the namespace arrives under `default`.)
      `import ${JSON.stringify(first)};
       import ${JSON.stringify(second)};
       const mod = await import(${JSON.stringify(new URL('./flow.zod.ts', import.meta.url).href)});
       const { FlowSchema } = mod.FlowSchema ? mod : mod.default;
       const flow = FlowSchema.parse({
         name: 'c', label: 'C', type: 'schedule',
         nodes: [{ id: 'l', type: 'loop', label: 'L', config: {
           collection: '{rows}', iteratorVariable: 'row',
           body: { nodes: [{ id: 'n', type: 'log', label: 'N' }],
                   edges: [{ id: 'b', source: 'n', target: 'n', condition: 'row.x > 1' }] },
         } }],
         edges: [],
       });
       console.log(JSON.stringify(flow.nodes[0].config.body.edges[0].condition));`,
    ],
    { env: { ...process.env, OS_EAGER_SCHEMAS: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

const FLOW = new URL('./flow.zod.ts', import.meta.url).href;
const BARREL = new URL('./index.ts', import.meta.url).href;
const ENVELOPE = JSON.stringify({ dialect: 'cel', source: 'row.x > 1' });

describe('#4415 — the flow ↔ control-flow schema cycle under OS_EAGER_SCHEMAS=1', () => {
  it('evaluates and parses regions through the automation barrel', () => {
    expect(importEagerly(BARREL, FLOW)).toBe(ENVELOPE);
  }, 60_000);

  it('evaluates and parses regions when flow.zod is entered first', () => {
    expect(importEagerly(FLOW, BARREL)).toBe(ENVELOPE);
  }, 60_000);
});
