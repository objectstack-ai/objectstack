/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The chart primitives are gone from `@object-ui/components`, and may not come
 * back (objectui#7397, maintainer ruling of 2026-09-04, batch #28, option (a)).
 *
 * ## What was actually wrong
 *
 * `packages/components/src/ui/chart.tsx` was a second copy of the primitives in
 * `packages/plugin-charts/src/ChartContainerImpl.tsx`, and it carried the
 * label-resolution hole that objectui#7248 fixed in the plugin-charts one: the
 * legend swatch renders unconditionally while the label comes only from a config
 * hit, so an entry whose lookup misses paints an anonymous coloured dot. On a
 * scatter that reads as a data point drawn outside the plot area, which is what
 * objectui#7248 was reported as.
 *
 * The card that found it recorded the copy as "not re-exported from the
 * `packages/components` barrel" and therefore "currently unreachable". Both were
 * false: `src/index.ts` re-exported `./ui`, `ui/index.ts` re-exported `./chart`,
 * and `chart.tsx` ended in a trailing `export { ... }` block. Two `export *` hops,
 * so every external consumer importing `ChartLegendContent` from
 * `@object-ui/components` got the UNFIXED copy. The card's probe had been
 * `^export (const|function|type|interface) ChartLegend...`, which returns 0
 * against a trailing export block -- a zero produced by the wrong query shape,
 * with no control to reveal it. Hence the lit control in the first test below:
 * this file's own zeros have to be readings.
 *
 * ## Why a pin and not just the deletion
 *
 * "Two copies of one primitive is how a fixed bug returns" is the ruling's
 * reason, so the guard has to outlive the diff that satisfies it. There are two
 * ways the file comes back, and they need different guards:
 *
 *   - **by sync.** `scripts/shadcn-sync.js` iterates `manifest.components`, so
 *     `pnpm shadcn:update-all` would re-fetch `chart` and rewrite the file. The
 *     manifest record is the guard, and the third test holds it: `chart` sits
 *     under `customComponents` (never fetched) carrying `movedToPlugin`, the
 *     vocabulary this manifest already uses for `calendar-view`, `chatbot` and
 *     `timeline`.
 *   - **by hand.** Nothing stops someone re-adding `ui/chart.tsx` and a barrel
 *     line. The first two tests are that guard.
 *
 * Deleting this file is deleting the ruling. If the primitives are ever meant to
 * return to `@object-ui/components`, that is a new decision on objectui#7397 and
 * this file is where it gets recorded.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import * as components from '../index';

/** `packages/components` -- two levels up from `src/__tests__`. */
const PKG_DIR = resolve(__dirname, '../..');

/**
 * The six value exports plus the `ChartConfig` type alias that `ui/chart.tsx`
 * published. `ChartConfig` is named here because the deletion removed it from
 * the surface too; `@objectstack/spec/ui` owns the authored-chart `ChartConfig`,
 * and `@object-ui/plugin-charts` calls the per-series style map
 * `ChartContainerConfig` precisely so the two never collide again.
 */
const REMOVED = [
  'ChartContainer',
  'ChartTooltip',
  'ChartTooltipContent',
  'ChartLegend',
  'ChartLegendContent',
  'ChartStyle',
  'ChartConfig',
] as const;

describe('@object-ui/components no longer publishes the chart primitives (objectui#7397)', () => {
  it('exports none of them from the package barrel', () => {
    const surface = Object.keys(components);

    // The lit control. A zero below is only a reading if this fires: the whole
    // defect on objectui#7397 was a zero produced against a surface nobody had
    // proved was being read at all.
    expect(
      surface.length,
      'nothing parsed out of the @object-ui/components barrel -- the assertion below would prove nothing',
    ).toBeGreaterThan(100);
    expect(
      surface,
      'the control name is missing, so this file is not reading the real package surface',
    ).toContain('Button');
    expect(
      surface,
      'ChartSkeleton is the loading placeholder in src/custom/view-skeleton.tsx -- a DIFFERENT symbol that legitimately stays; if it vanished, this file is measuring the wrong module',
    ).toContain('ChartSkeleton');

    expect(
      REMOVED.filter((name) => surface.includes(name)),
      [
        '@object-ui/components exports a chart primitive again. The maintainer ruling on',
        'objectui#7397 (2026-09-04, batch #28, option (a)) removed these: a second copy of',
        'ChartLegendContent is how the objectui#7248 legend bug returns, and the copy that',
        'lived here was the unfixed one.',
        '',
        '@object-ui/plugin-charts (ChartContainerImpl.tsx) is the single implementation.',
        'components cannot re-export it either -- plugin-charts depends on',
        '@object-ui/components (workspace:*), so the dependency direction forbids it.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('and the synced primitive file itself is gone, with no barrel line pointing at it', () => {
    expect(
      existsSync(join(PKG_DIR, 'src/ui/chart.tsx')),
      'packages/components/src/ui/chart.tsx is back. It is the duplicate objectui#7397 removed.',
    ).toBe(false);

    const uiBarrel = readFileSync(join(PKG_DIR, 'src/ui/index.ts'), 'utf8');

    // Floor: prove the barrel really parsed before reading a zero out of it.
    expect(
      uiBarrel.split('\n').filter((line) => line.startsWith('export * from')).length,
      'no re-export lines parsed out of src/ui/index.ts -- the assertion below would prove nothing',
    ).toBeGreaterThan(10);

    expect(
      uiBarrel.includes("from './chart'"),
      "src/ui/index.ts re-exports './chart' again -- see the header on objectui#7397.",
    ).toBe(false);
  });

  it('and the shadcn manifest records the exclusion, so a re-sync cannot resurrect it', () => {
    const manifest = JSON.parse(
      readFileSync(join(PKG_DIR, 'shadcn-components.json'), 'utf8'),
    ) as {
      components: Record<string, unknown>;
      customComponents: Record<string, { movedToPlugin?: string }>;
    };

    expect(
      Object.keys(manifest.components).length,
      'no `components` entries parsed out of shadcn-components.json -- the assertions below would prove nothing',
    ).toBeGreaterThan(1);

    expect(
      Object.keys(manifest.components),
      [
        '`chart` is back under `components` in shadcn-components.json. That object is what',
        'scripts/shadcn-sync.js iterates, so `pnpm shadcn:update-all` would re-fetch the',
        'primitive and rewrite src/ui/chart.tsx -- undoing objectui#7397 silently, with no',
        'diff anybody reviewed.',
      ].join('\n'),
    ).not.toContain('chart');

    expect(
      manifest.customComponents.chart?.movedToPlugin,
      [
        'shadcn-components.json no longer records `chart` as moved to a plugin package.',
        'That record is the ONLY thing standing between `pnpm shadcn:update-all` and a',
        'resurrected duplicate: entries under `customComponents` are never fetched.',
      ].join('\n'),
    ).toBe('@object-ui/plugin-charts');
  });
});
