/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9038 — `chartConfigPresentation` DROPPED an inline-locale-map
 * `title` / `subtitle` / `description`, so a chart authored in the spec's own
 * `I18nLabel` union drew **no heading at all**.
 *
 * The old limb was `typeof v === 'string' && v ? v : undefined`. It did not
 * pick the wrong locale — it erased the value, the `if (title)` guard then
 * skipped the assignment, and the key never reached the result. That failure
 * mode is invisible to any check that asks "does the heading match the locale",
 * because there is no heading to compare; the assertions below therefore pin
 * the key's PRESENCE and its identity with the authored value, not a string.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * This half pins the SEAM: the authored union survives the lowering. It cannot
 * pin that a viewer sees the right limb — resolution happens downstream, in
 * `normalizeChartSchema`'s `label()` against the language `ChartRenderer`
 * reads. The rendered half is
 * `ChartRenderer.presentationLocaleHeading-9038.test.tsx` in
 * `@object-ui/plugin-charts`, which draws the same map at two languages.
 *
 * A green run here over a renderer that had not yet learned the union would be
 * a correct seam feeding a resolver that never sees it — which is exactly why
 * neither half stands alone.
 *
 * ## The key-order control
 *
 * Every locale map below is written **`en` first**. The sibling defect
 * objectui#8943 was a first-string-in-key-order pick, so a map written
 * `zh-CN` first would be satisfied by that defect too; writing `en` first keeps
 * these fixtures able to fail for the reason they exist.
 *
 * PREDICTIONS, written before the run: the `title`/`subtitle`/`description` map
 * cases are RED before the fix (the key is absent) and the plain-string,
 * refusal and untouched-key cases are GREEN on both sides — they pin decisions
 * that must NOT move. The mutation legs are recorded in the pull request.
 */

import { describe, it, expect } from 'vitest';
import { chartConfigPresentation, seriesPresentation } from '../chart-presentation.js';

/** `en` FIRST — see the key-order control above. */
const MAP = { en: 'Pricing', 'zh-CN': '定价' };

const CHROME_KEYS = ['title', 'subtitle', 'description'] as const;

describe('chartConfigPresentation — an inline-locale-map heading survives the lowering (objectui#9038)', () => {
  it.each(CHROME_KEYS)('forwards a locale-map `%s` verbatim, for the renderer to resolve', (key) => {
    const out = chartConfigPresentation({ [key]: MAP });
    // Identity, not equality: the authored value travels untouched, so no
    // renderer-side coercion can have happened on the way through.
    expect(out[key]).toBe(MAP);
  });

  it.each(CHROME_KEYS)('leaves a plain-string `%s` exactly as it was — the live control', (key) => {
    // The string arm of `I18nLabel` is the arm that already worked. It is in
    // this run so that "the map arm now travels" cannot be bought by changing
    // what a string does.
    expect(chartConfigPresentation({ [key]: 'Quarterly revenue' })[key]).toBe('Quarterly revenue');
  });

  it.each(CHROME_KEYS)('still refuses every value the union does not admit, for `%s`', (key) => {
    for (const value of [42, true, ['Pricing'], '', {}, { en: '' }, { en: 42 }, null, undefined]) {
      const out = chartConfigPresentation({ [key]: value });
      expect(Object.prototype.hasOwnProperty.call(out, key)).toBe(false);
    }
  });

  it('admits a map on the strength of one usable entry and carries the rest as authored', () => {
    // `InlineLocaleMapSchema` is `z.record(<tag>, z.string())`; enforcing that
    // is the parse's job, not this whitelist's. The mixed map is admitted
    // whole — `pickLocalized` skips the unusable entry the same way it skips an
    // absent one.
    const mixed = { en: 'Pricing', 'zh-CN': 7 };
    expect(chartConfigPresentation({ title: mixed }).title).toBe(mixed);
  });

  it('changes no other key for the same input', () => {
    // The harm this must not cause: a key other than the three moving value.
    const config = {
      showLegend: false,
      showDataLabels: true,
      height: 320,
      annotations: [{ y: 10 }],
      interaction: { tooltip: false },
      colors: ['#111', '#222'],
      title: MAP,
    };
    const withMap = chartConfigPresentation(config);
    const withString = chartConfigPresentation({ ...config, title: 'Pricing' });
    for (const [k, v] of Object.entries(withString)) {
      if (k === 'title') continue;
      expect(withMap[k]).toEqual(v);
    }
    expect(Object.keys(withMap).sort()).toEqual(Object.keys(withString).sort());
  });

  it('leaves the ledgered series label picked, not forwarded', () => {
    // objectui#4020's first-string-wins pick for a series `label` is a
    // DIFFERENT question — a locale-unaware CHOICE a caller can override, not
    // an erasure — and is out of this card's scope. Pinned here so a later edit
    // cannot quietly fold it in under this card's banner, and so the asymmetry
    // is visible rather than inferred: this one resolves to a string HERE, the
    // three chrome keys resolve at the renderer.
    //
    // `DatasetWidget` is the caller the ledger's justification names: it
    // replaces a series label from the locale bundle, so the pick is a value
    // that gets overridden rather than a value a viewer sees.
    expect(seriesPresentation({ name: 'total', label: MAP }).label).toBe('Pricing');
  });
});
