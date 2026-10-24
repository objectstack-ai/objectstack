/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6939, the `chart` group — the RENDER half. The validator-side
 * contract is pinned in
 * `packages/types/src/__tests__/chart-data-model-7113.test.ts`.
 *
 * Ruling 5510084784 (maintainer 2026-09-02, verbatim 「同意」) sets the bar per
 * group, from objectui#6318's triage: "the catalog entry validates, **and its
 * render is byte-identical in element count and text before and after**". The
 * validator half alone cannot make the claim — a "repair" that also changes
 * what is drawn has not proved the SCHEMA was wrong, it has changed the
 * product. Both landed sibling groups carry this half
 * (`plugin-map/src/ObjectMap.catalogRecordSource-6939.test.tsx`,
 * `examples/schema-catalog/test/tree-view-nodes-mirror-6939.test.tsx`), and
 * this file is the chart group's.
 *
 * ## The asymmetry this group has and the siblings do not
 *
 * At BASE both fixtures **FAIL** validation (`series.N.name`: they are authored
 * in the `dataKey` dialect, which the mirror required `name` instead of) while
 * **drawing correctly**. So the before/after identity cannot be measured through
 * a parse-then-render path — there is no parse at base. It is measured through
 * the renderer directly, which is also honest about how charts actually reach
 * the screen: `ChartRenderer` consumes the AUTHORED schema and calls
 * `normalizeChartSchema` on it; it never sees the mirror's parse output.
 *
 * That also bounds what this file can regress on: the objectui#7113 diff touches
 * no file under `packages/plugin-charts`, so the renderer is byte-identical
 * across the change. The pin's job is to keep it that way as the mirror moves.
 *
 * ## PRE_REPAIR — measured, not transcribed
 *
 * Captured on `origin/main` @ `98d4108a2` (the merge-base), both faces
 * untouched, through THIS file's `measure()` in a worktree at that commit.
 *
 * ⚠️ Element counts are HARNESS-BOUND and must never be carried over from
 * another run. The contract review of PR #7545 measured this same property on
 * its own harness and read `advanced-line-chart` 136 / `area-chart` 132 with 11
 * x-axis ticks; this harness reads 136 and **127** with **6** ticks. Both are
 * correct about their own harness — `ResponsiveContainer` is mocked to a fixed
 * 480x320 here, and tick density is a function of that width
 * (`AdvancedChartImpl`'s categorical axis thins labels by available space). The
 * claim that discriminates is IDENTITY WITHIN ONE HARNESS, which is why the
 * numbers below were re-derived here rather than copied.
 *
 * Three readings per fixture, because a count alone cannot tell a swapped
 * element from an equal one: element count, a tag census, and a SHA-256 of the
 * text.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0x0
// under the headless DOM, so nothing paints. Fix its size — the same shim the
// other render tests in this package use.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import { ChartRenderer } from './ChartRenderer';
import { safeValidateSchema } from '@object-ui/types/zod';

afterEach(cleanup);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NAMES = ['advanced-line-chart', 'area-chart'] as const;

function catalogEntry(name: (typeof NAMES)[number]): Record<string, unknown> {
  const file = path.join(REPO_ROOT, 'examples/schema-catalog/src/schemas/plugin-charts', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

interface Reading {
  elements: number;
  tags: Record<string, number>;
  lines: number;
  areas: number;
  xTicks: number;
  sha256: string;
}

/** Measured at `98d4108a2` through `measure()` below. See the header. */
const PRE_REPAIR: Record<(typeof NAMES)[number], Reading> = {
  'advanced-line-chart': {
    elements: 136,
    tags: { DIV: 9, STYLE: 1, svg: 1, title: 1, desc: 1, g: 48, line: 5, defs: 2, clipPath: 1, rect: 1, linearGradient: 14, stop: 28, path: 2, text: 11, tspan: 11 },
    lines: 2,
    areas: 0,
    xTicks: 6,
    sha256: 'dd56a5f8c25242bb737db18308f2952c3f5dabbe1dcb6eb9e0b71cdb3a3bbccd',
  },
  'area-chart': {
    elements: 127,
    tags: { DIV: 7, STYLE: 1, svg: 1, title: 1, desc: 1, g: 47, line: 5, defs: 2, clipPath: 1, rect: 1, linearGradient: 12, stop: 24, path: 2, text: 11, tspan: 11 },
    lines: 0,
    areas: 1,
    xTicks: 6,
    sha256: 'c1270f6053d2dd82c9da87b57607ae04896bf3fc317c9c15357632b48fa05386',
  },
};

async function measure(schema: unknown): Promise<Reading> {
  const { container } = render(
    <ChartRenderer schema={{ ...(schema as any), isAnimationActive: false }} />,
  );
  // `AdvancedChartImpl` is lazy — wait for the real plot, not the skeleton. A
  // fixture that stopped drawing fails HERE, loudly, rather than reporting a
  // tidy zero further down.
  await waitFor(() => {
    if (!container.querySelector('.recharts-surface')) throw new Error('nothing drew');
  });
  const nodes = Array.from(container.querySelectorAll('*'));
  // React's `useId` lands in the injected <style> block (`chart-_r_0_`), so it
  // varies with render ORDER inside the file. Normalise it, or the hash pins
  // the test order rather than the drawing.
  const text = (container.textContent ?? '').replace(/chart-_r_[0-9a-z]+_/g, 'chart-ID');
  return {
    elements: nodes.length,
    tags: nodes.reduce<Record<string, number>>((h, el) => ((h[el.tagName] = (h[el.tagName] ?? 0) + 1), h), {}),
    lines: container.querySelectorAll('.recharts-line').length,
    areas: container.querySelectorAll('.recharts-area').length,
    xTicks: container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

describe('objectui#6939 `chart` — the catalog fixtures draw exactly what they drew before', () => {
  it.each(NAMES)('%s renders identically to BASE', async (name) => {
    expect(await measure(catalogEntry(name))).toEqual(PRE_REPAIR[name]);
  });

  /*
   * The verdict half — the thing that DID change. At `98d4108a2` both of these
   * reported `series.N.name: Invalid input: expected string, received undefined`
   * from `safeValidateSchema` while drawing the readings pinned above. Together
   * with the identity above, that is objectui#6318's bar: the validator's
   * verdict moves, the drawing does not.
   */
  it.each(NAMES)('%s now VALIDATES, which is the half that changed', (name) => {
    const r = safeValidateSchema(catalogEntry(name));
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
  });

  /*
   * LIT CONTROL for the identity assertions. Without it, `toEqual(PRE_REPAIR)`
   * passing proves only that two things matched — it cannot show the instrument
   * would have NOTICED a difference. Perturb the authored rows and the same
   * measurement must move.
   */
  it('CONTROL — the measurement detects a changed drawing', async () => {
    const doc = catalogEntry('area-chart') as { data: Record<string, unknown>[] };
    const perturbed = { ...doc, data: [...doc.data, { month: 'Jul', users: 2600 }] };
    const reading = await measure(perturbed);
    expect(reading.sha256).not.toBe(PRE_REPAIR['area-chart'].sha256);
    expect(reading.elements).not.toBe(PRE_REPAIR['area-chart'].elements);
  });
});
