/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every chart key this app registers as a lazy stub is FULFILLED by the module
 * the stub points at (objectui#8760).
 *
 * ## The defect
 *
 * `register-plugins.ts` registered ten chart variants as `registerLazy` stubs
 * pointing at `@object-ui/plugin-charts`. That package registers eight keys,
 * and three of the ten — `line-chart`, `area-chart`, `advanced-chart` — were
 * not among them.
 *
 * An unfulfilled stub does not fail; it succeeds at being useless, and it does
 * so in the two places that decide whether a defect is ever seen:
 *
 *   - AT RENDER. `SchemaRenderer`'s lazy branch is re-entered on every pass:
 *     it checks `hasLazy(type)` and returns the `Loading <type>…` placeholder.
 *     `Registry.register()` deletes a lazy entry only for the keys the loaded
 *     module actually registers, so for an unfulfilled key the entry SURVIVES
 *     the load and every subsequent pass takes the same branch. MEASURED on
 *     `b775500af`, through this file's own chain: `{ "type": "line-chart" }`
 *     painted `role="status"` / `data-lazy-loading="line-chart"` /
 *     `Loading line-chart…`, permanently. Not OBJUI-001 — no alert, no error,
 *     no console warning. A skeleton that never resolves reads to a user as a
 *     slow network, which is why this outlived the card that first noticed it.
 *   - AT AUTHORING. The stub puts the key in `getKnownTypes()`, so
 *     `check:doc-types` and the CLI's generated `KNOWN_SCHEMA_TYPES` snapshot
 *     both bless it. `content/docs/plugins/plugin-dashboard.mdx` taught
 *     `"type": "line-chart"` inside a `card` body and every gate was green on
 *     it.
 *
 * So the failure was strictly worse than an unknown key: an unknown key is
 * refused loudly at authoring time, while this one passed every check, was
 * taught by the documentation, and failed only at render in front of a user.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * The claim under test is the OUTCOME an author observes, never "the registry
 * has N entries" or "the stub was registered" — those are the readings that let
 * the defect exist for as long as it did.
 *
 *   1. THE INVARIANT. The stub list is read from this app's own SOURCE and each
 *      key is driven through the REAL loader (`ComponentRegistry.loadLazy`),
 *      then re-checked in the registry — which is exactly what `loadLazy`'s
 *      docblock tells callers to do, because it resolves "whether or not the
 *      loaded module actually registered the expected type". A key added to
 *      that list without a matching `register()` in `packages/plugin-charts`
 *      fails HERE, on the first render nobody has done yet.
 *   2. THE RETIREMENT, as a render outcome. An authored node of a retired type
 *      now paints the loud OBJUI-001 refusal instead of the eternal skeleton.
 *   3. THE CONTROL. `chart:bar` and `bar-chart` — fulfilled variants in the
 *      same sweep (`chart:bar` since objectui#10859 batch 8 retired the
 *      `pie-chart` control) — are unchanged end to end: same registry identity, same
 *      drawn output, no alert and no placeholder. Each is asserted
 *      individually; neither reads zero on both sides of the change.
 *
 * The CLI half of (2) — `objectui check` refusing a document that authors a
 * retired key, which is the "refused at authoring time" outcome on the
 * PUBLISHED surface — is pinned in
 * `packages/cli/src/__tests__/unfulfilled-chart-stubs-retired-8760.test.ts`.
 *
 * `AnyComponentSchema` is NOT part of this file's claim: it refused all three
 * spellings before this change and refuses them after
 * (`packages/types/src/__tests__/node-slot-registered-arms-8499.test.ts` holds
 * that, and already carried `area-chart` as a firing control). Claiming it here
 * would be claiming a reading this card did not move.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';

import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Module-scope import of the module the stubs point at, per AGENTS.md's
// flaky-test rule: every assertion below lands after a dynamic `import()`
// boundary, and paying that cost at import time puts it outside every
// test/hook timeout. The specifier is character-identical to the one
// `register-plugins.ts` hands `registerLazy`, so ESM hands the loader the very
// same module instance. It cannot mask the defect it guards against: the seven
// retired keys are ones this module never registers under ANY load order.
import '@object-ui/plugin-charts';
import '../register-plugins';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER_PLUGINS = join(HERE, '..', 'register-plugins.ts');

/**
 * The three spellings objectui#8760 retired, plus the four objectui#10859
 * batch 8 retired with their registrations — `scatter-chart` (phase 2b) and
 * `pie-chart`, `donut-chart`, `radar-chart` (phase 2c). The same two halves
 * must hold for each: no stub left in this app, no key in the registry, and a
 * loud refusal for an authored node.
 */
const RETIRED = [
  'line-chart', 'area-chart', 'advanced-chart', 'scatter-chart', 'pie-chart', 'donut-chart', 'radar-chart',
] as const;

/**
 * The chart stub list, read from the source it is declared in — never a copy.
 * A copy is the failure this card is about: two declarations of one set, with
 * nothing comparing them.
 */
function chartStubList(): string[] {
  const source = readFileSync(REGISTER_PLUGINS, 'utf8');
  const marker = "() => import('@object-ui/plugin-charts')";
  const at = source.indexOf(`for (const variant of [`);
  const loops = [...source.matchAll(/for \(const variant of \[([^\]]*)\]\)([\s\S]{0,220}?)\}/g)];
  const charts = loops.filter((m) => m[2].includes(marker));
  if (charts.length !== 1) {
    throw new Error(`expected exactly one chart stub loop, found ${charts.length} (at ${at})`);
  }
  return [...charts[0][1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Render one authored node and report only what an author could observe. */
function paint(type: string, extra: Record<string, unknown> = {}) {
  const { container } = render(<SchemaRenderer schema={{ type, ...extra } as never} />);
  return {
    alerts: container.querySelectorAll('[role="alert"]').length,
    placeholders: container.querySelectorAll('[data-lazy-loading]').length,
    elements: container.querySelectorAll('*').length,
    text: (container.textContent ?? '').replace(/\s+/g, ' '),
  };
}

const ROWS = [
  { m: 'Jan', v: 4000 },
  { m: 'Feb', v: 3000 },
  { m: 'Mar', v: 6000 },
];

describe('objectui#8760 — every chart stub this app registers is fulfilled', () => {
  it('the source read finds the list, and finds it non-empty', () => {
    // Non-vacuity for every assertion below: a reader that has stopped reading
    // must throw or come back empty, never yield a silently passing zero.
    const list = chartStubList();
    expect(list.length, 'the stub-list read went vacuous').toBeGreaterThanOrEqual(3);
    expect(list, 'the reader is looking at the chart loop').toContain('chart:bar');
    for (const retired of RETIRED) expect(list).not.toContain(retired);
  });

  it('drives each stub through the REAL loader and re-checks the registry', async () => {
    const list = chartStubList();
    const unfulfilled: string[] = [];
    for (const key of list) {
      // The call, not the name: `loadLazy` resolves whether or not the module
      // registered the key, so the reading that matters is the one taken after.
      await ComponentRegistry.loadLazy(key);
      if (ComponentRegistry.get(key) === undefined) unfulfilled.push(key);
    }
    expect(
      unfulfilled,
      'a lazy stub resolves to nothing — the key renders `Loading …` forever',
    ).toEqual([]);
    // 3 since objectui#10859 batch 8 took `scatter-chart` (phase 2b) and
    // `pie-chart` / `donut-chart` / `radar-chart` (phase 2c) out of the list.
    expect(list).toHaveLength(3);
  }, 20000);
});

describe('objectui#8760 — a retired key is refused loudly instead of drawing nothing', () => {
  it.each(RETIRED)('`%s` has no stub and no registration', async (type) => {
    expect(ComponentRegistry.hasLazy(type)).toBe(false);
    expect(ComponentRegistry.hasLazy(type, 'plugin-charts')).toBe(false);
    await ComponentRegistry.loadLazy(type);
    expect(ComponentRegistry.get(type)).toBeUndefined();
    expect(ComponentRegistry.getKnownTypes()).not.toContain(type);
  });

  it.each(RETIRED)('an authored `%s` node paints OBJUI-001, not an endless skeleton', (type) => {
    const shot = paint(type, { data: ROWS, xAxisKey: 'm', series: [{ dataKey: 'v' }] });
    // The half that changed. Before this card BOTH numbers were the other way
    // round: 0 alerts and 1 placeholder, on every render pass, forever.
    expect(shot.alerts, `${type} did not refuse`).toBe(1);
    expect(shot.placeholders, `${type} is still stuck on a lazy placeholder`).toBe(0);
    expect(shot.text).toContain(`Unknown component type: ${type}`);
    expect(shot.text).toContain('OBJUI-001');
  });
});

describe('objectui#8760 — CONTROL: the fulfilled variants are unmoved, each on its own', () => {
  // Two controls, verified individually rather than as a pair: each resolves to
  // a DIFFERENT renderer, and each is non-zero on both sides of the change, so
  // neither can be the "reads 0 either way" kind that proves nothing.
  it.each([
    ['chart:bar', 'ChartRenderer'],
    ['bar-chart', 'ChartBarRenderer'],
  ])('`%s` still resolves to `%s`', async (type, renderer) => {
    await ComponentRegistry.loadLazy(type);
    const impl = ComponentRegistry.get(type);
    expect(impl).toBeDefined();
    expect((impl as { name?: string }).name).toBe(renderer);
    expect(ComponentRegistry.getKnownTypes()).toContain(type);
  });

  it.each(['chart:bar', 'bar-chart'])('`%s` still draws — no alert, no placeholder', async (type) => {
    await ComponentRegistry.loadLazy(type);
    const shot = paint(type, { chartType: 'pie', data: ROWS, xAxisKey: 'm', dataKey: 'v', series: [{ dataKey: 'v' }] });
    expect(shot.alerts, `${type} started refusing — the control moved`).toBe(0);
    expect(shot.placeholders, `${type} fell back to a lazy placeholder`).toBe(0);
    expect(shot.elements, `${type} drew nothing at all`).toBeGreaterThan(0);
  });
});
