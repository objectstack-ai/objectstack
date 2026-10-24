/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5264 — `ObjectMetricWidgetProps` was the last interface in
 * any package's shipped `src` still declaring the `{ key, defaultValue }`
 * key-reference label form that objectstack#5055 RETIRED at rc.6. The sibling
 * `MetricWidgetProps` was migrated for exactly this reason in objectui#4358;
 * this one was missed in that pass.
 *
 * WHY IT WAS NOT MERELY INERT. `ObjectMetricWidget` forwards `label` /
 * `description` / `trend` straight to `MetricWidget`, which resolves them with
 * `pickLocalized`. The retired object hits no locale limb, so resolution falls
 * through to the last resort — "first string property in insertion order" — and
 * the natural `{ key, defaultValue }` spelling therefore paints the raw dotted
 * translation key onto the KPI card. Write the same two properties the other
 * way round and the English falls out instead. That PROPERTY-ORDER DEPENDENCE
 * is why the defect never read as systematic, and it is covered here in both
 * orders.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *
 *  - **(a) inline-map `label` / `description` / `trend.label` on the CARD →
 *    GREEN on both sides.** These three were already forwarded to
 *    `pickLocalized` by `MetricWidget`, so the migration does not move them.
 *    They are the non-vacuity floor: they prove the harness renders what it
 *    claims to, so a red elsewhere is a real red.
 *  - **(b) inline-map `title` in the DRILL-DOWN DRAWER → RED before.** The
 *    drawer's `drawerTitle` read `title?.defaultValue` directly. An inline
 *    per-locale map has no such limb, so an authored drill title resolved to
 *    `''` and the drawer fell back to the literal word "Details" — a plausible
 *    heading that silently discards what the author wrote.
 *  - **(c) inline-map `label` as the drawer's fallback title → RED before**,
 *    same limb, same substitution.
 *  - **(d) card/drawer COHERENCE under the retired form, key-first → RED
 *    before.** This is the order-dependence made executable without
 *    fossilizing any resolved text. Before the change the two surfaces used
 *    DIFFERENT resolvers — the card `pickLocalized` (order-dependent), the
 *    drawer `.defaultValue` (order-independent) — so one KPI tile painted the
 *    raw dotted key while the drawer it opened painted the English. They now
 *    share one resolver and cannot disagree.
 *  - **(e) card/drawer coherence under the retired form, defaultValue-first →
 *    GREEN on both sides.** The other half of the order pair, and the reason
 *    (d) is a genuine finding rather than a blanket failure: before the change
 *    exactly ONE of the two orders diverged.
 *  - **(f) the accept set — the inline map → RED before, at COMPILE time.**
 *    This one was predicted the other way round and the prediction was wrong;
 *    the measurement is recorded here because it changes what this migration
 *    is. `I18nLabel`'s object half is `InlineLocaleMap`, and that erases to
 *    `Record<string, string>` in the emitted `.d.ts` — the BCP-47 key regex is
 *    a Zod RUNTIME refinement and does not survive into the type. So:
 *
 *      old `string | { key?: string; defaultValue?: string }`
 *        accepts `{ key, defaultValue }` (both orders)
 *        REJECTS `{ en, 'zh-CN' }` with TS2353 — excess property `en`
 *      new `string | I18nLabel`
 *        accepts `{ en, 'zh-CN' }`
 *        still accepts `{ key, defaultValue }` — every string key fits a
 *        `Record<string, string>` index signature
 *
 *    So this migration ADDS the only vocabulary the spec admits (a TS consumer
 *    writing the correct form previously got a compile error) and REMOVES
 *    nothing. It is a widening at the type level, not the narrowing it reads
 *    like. The retired form is refused where refusal is actually expressible —
 *    `I18nLabelSchema` at authoring time, pinned below in both orders.
 *
 *    That is also why there is no `@ts-expect-error` tombstone here: one was
 *    written first and `tsc` reported both directives UNUSED. Per objectui#4032's
 *    fixture-triage discipline the same trap applies to a tombstone as to a
 *    fixture — an assertion that passes for the wrong reason is worse than none.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
// Imported from the package barrel at MODULE scope: the drill drawer renders
// its body through `SchemaRenderer`, which resolves `object-data-table` from
// the registry the barrel populates as a side effect. Module scope, never a
// hook, per AGENTS.md's flaky-test rule (objectui#3010/#3021).
import { ObjectMetricWidget } from '../index';

afterEach(cleanup);

/** The dotted translation key from the issue's measurement. */
const KEY = 'crm.dashboards.sales.widgets.revenue.title';
const ENGLISH = 'Total Revenue';

/** The vocabulary the spec actually admits: an inline per-locale map. */
const REVENUE = { en: 'Revenue', 'zh-CN': '收入' };
const RECORDS = { en: 'Revenue records', 'zh-CN': '收入记录' };

const makeSource = () => ({
  aggregate: vi.fn(async () => [{ amount_sum: 120 }]),
  find: vi.fn(async () => ({ data: [] })),
  getObjectSchema: vi.fn(async () => ({ fields: {} })),
});

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
      {ui}
    </I18nProvider>,
  );
}

describe('ObjectMetricWidget — I18nLabel on the card (#5264 (a))', () => {
  it('resolves a map `label` to the active locale', () => {
    renderIn('zh', <ObjectMetricWidget objectName="deal" label={REVENUE} fallbackValue={42} />);
    expect(screen.getByText('收入')).toBeTruthy();
    expect(screen.queryByText(KEY)).toBeNull();
  });

  it('resolves a map `description` (the sub-caption slot)', () => {
    renderIn('zh', (
      <ObjectMetricWidget objectName="deal" label="Revenue" fallbackValue={42} description={RECORDS} />
    ));
    expect(screen.getByText('收入记录')).toBeTruthy();
  });

  it('resolves a map `trend.label`', () => {
    renderIn('zh', (
      <ObjectMetricWidget
        objectName="deal"
        label="Revenue"
        fallbackValue={42}
        trend={{ value: 12, direction: 'up', label: RECORDS }}
      />
    ));
    expect(screen.getByText('收入记录')).toBeTruthy();
  });

  it('leaves a plain-string label exactly as authored', () => {
    renderIn('zh', <ObjectMetricWidget objectName="deal" label="Revenue" fallbackValue={42} />);
    expect(screen.getByText('Revenue')).toBeTruthy();
  });
});

/** Open the KPI tile's drill-down and return the heading text the drawer shows. */
async function openDrawerTitle(language: string, props: Record<string, unknown>) {
  const src = makeSource();
  renderIn(language, (
    <ObjectMetricWidget
      objectName="deal"
      aggregate={{ field: 'amount', function: 'sum' }}
      dataSource={src as unknown as never}
      drillDown={{ enabled: true }}
      {...(props as { label: string })}
    />
  ));
  // The tile becomes `role="button"` only when a drill handler is attached, so
  // this also asserts the drill is live rather than silently disabled.
  fireEvent.click(await screen.findByRole('button'));
  const heading = await screen.findByRole('heading');
  return heading.textContent ?? '';
}

describe('ObjectMetricWidget — I18nLabel in the drill-down drawer (#5264 (b)(c))', () => {
  it('paints an inline-map `title` in the drawer, not the literal "Details"', async () => {
    const title = await openDrawerTitle('zh', { label: REVENUE, title: RECORDS });
    expect(title).toBe('收入记录');
    expect(title).not.toBe('Details');
  });

  it('falls back to the inline-map `label` when no `title` is authored', async () => {
    const title = await openDrawerTitle('zh', { label: REVENUE });
    expect(title).toBe('收入');
    expect(title).not.toBe('Details');
  });

  it('still honours a plain-string `title`', async () => {
    const title = await openDrawerTitle('en', { label: 'Revenue', title: 'Revenue records' });
    expect(title).toBe('Revenue records');
  });
});

/**
 * The order-dependence, made executable. The retired form can only be reached
 * through a cast now — which is the fix — so what is asserted here is not the
 * resolved TEXT (that would fossilize an out-of-contract input) but that the
 * card and the drawer it opens agree. Before the change they used two different
 * resolvers and disagreed in exactly one of the two property orders.
 */
describe('ObjectMetricWidget — retired {key,defaultValue}: card and drawer agree (#5264 (d)(e))', () => {
  it('key-first — the tile and its drawer paint the same text', async () => {
    const retired = { key: KEY, defaultValue: ENGLISH } as unknown as string;
    const src = makeSource();
    renderIn('zh', (
      <ObjectMetricWidget
        objectName="deal"
        label={retired}
        aggregate={{ field: 'amount', function: 'sum' }}
        dataSource={src as unknown as never}
        drillDown={{ enabled: true }}
      />
    ));
    const tile = await screen.findByRole('button');
    const cardText = tile.textContent ?? '';
    fireEvent.click(tile);
    const drawerTitle = (await screen.findByRole('heading')).textContent ?? '';

    // Whatever the card resolved to, the drawer resolved to the same thing.
    expect(cardText).toContain(drawerTitle);
    expect(drawerTitle).not.toBe('Details');
  });

  it('defaultValue-first — the tile and its drawer agree here too', async () => {
    const retired = { defaultValue: ENGLISH, key: KEY } as unknown as string;
    const src = makeSource();
    renderIn('zh', (
      <ObjectMetricWidget
        objectName="deal"
        label={retired}
        aggregate={{ field: 'amount', function: 'sum' }}
        dataSource={src as unknown as never}
        drillDown={{ enabled: true }}
      />
    ));
    const tile = await screen.findByRole('button');
    const cardText = tile.textContent ?? '';
    fireEvent.click(tile);
    const drawerTitle = (await screen.findByRole('heading')).textContent ?? '';

    expect(cardText).toContain(drawerTitle);
    expect(drawerTitle).not.toBe('Details');
  });

  it('the two orders are NOT interchangeable — this is why the type had to narrow', async () => {
    // Pure resolver characterization, no component: the same two properties in
    // the two natural spellings resolve to DIFFERENT strings, one of them the
    // raw dotted key. Neither spelling is reachable through the props type any
    // more; this records what made the defect invisible in review.
    const { pickLocalized } = await import('@object-ui/i18n');
    expect(pickLocalized({ key: KEY, defaultValue: ENGLISH }, 'zh')).toBe(KEY);
    expect(pickLocalized({ defaultValue: ENGLISH, key: KEY }, 'zh')).toBe(ENGLISH);
  });
});

describe('ObjectMetricWidgetProps — the accept set after the migration (#5264 (f))', () => {
  it('now accepts the inline per-locale map the spec admits — a COMPILE ERROR before', () => {
    // The load-bearing assertion is the compiler's: `tsconfig.test.json` type-
    // checks this file (chained from the package's `type-check` script), and
    // against the retired declaration these three props were TS2353 — excess
    // property `en` does not exist in `{ key?, defaultValue? }`. A consumer
    // writing the ONLY vocabulary @objectstack/spec accepts could not compile.
    const ok = (
      <ObjectMetricWidget
        objectName="deal"
        label={REVENUE}
        description={RECORDS}
        title={RECORDS}
        trend={{ value: 1, direction: 'up', label: RECORDS }}
        fallbackValue={42}
      />
    );
    expect(ok).toBeTruthy();
  });

  it('leaves the retired form refused where refusal is expressible — the spec, at authoring time', async () => {
    // TypeScript cannot express this rejection: `I18nLabel`'s object half is
    // `Record<string, string>`, so `key` and `defaultValue` are two ordinary
    // string entries as far as the compiler is concerned. The refusal lives in
    // the spec's runtime schema, whose own message names both properties.
    // Contract-first (AGENTS.md #0.1): the producer is rejected at publish
    // time rather than tolerated by a renderer-side fallback here.
    const { I18nLabelSchema } = await import('@objectstack/spec/ui');
    expect(I18nLabelSchema.safeParse({ key: KEY, defaultValue: ENGLISH }).success).toBe(false);
    expect(I18nLabelSchema.safeParse({ defaultValue: ENGLISH, key: KEY }).success).toBe(false);
    // Non-vacuity: the same schema accepts both admitted forms.
    expect(I18nLabelSchema.safeParse(REVENUE).success).toBe(true);
    expect(I18nLabelSchema.safeParse('Revenue').success).toBe(true);
  });
});
