// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9038 — a dashboard widget whose `chartConfig.title` is an inline
 * locale map reached the renderer with NO heading at all.
 *
 * `chartConfigPresentation` lowered the widget's chrome through a limb that
 * admitted only a plain string, so the spec-legal map arm of `I18nLabel` was
 * erased before the schema was built: not the wrong language, no language —
 * and therefore invisible to any check comparing a heading against a locale.
 *
 * ## Where these assertions stop, and why
 *
 * One step past the seam, as the sibling `DatasetWidget.comboPresentation`
 * file does and for the same mechanical reason: counting what is DRAWN needs
 * `ResponsiveContainer` mocked to a measured box, and `recharts` resolves
 * inside `plugin-charts` alone, so a `vi.mock('recharts')` in THIS package
 * cannot even resolve the specifier. So the widget's emitted schema is run
 * through `normalizeChartSchema` — the ONE translation `ChartRenderer` puts
 * between the schema and `AdvancedChartImpl` — at the two languages a viewer
 * could be in.
 *
 * The DRAWN half is pinned where recharts lives:
 * `ChartRenderer.presentationLocaleHeading-9038.test.tsx` renders the same
 * authored maps through `ChartRenderer` at both languages and reads the
 * headings out of the DOM.
 *
 * ⚠️ `normalizeChartSchema` is called here with an EXPLICIT language, which is
 * what `ChartRenderer` does with `useObjectTranslation().language`
 * (objectui#8943). Omitting it is not neutral — `pickLocalized` reads an absent
 * language as `en` — so a two-language assertion that passed no language would
 * print the same heading twice and prove nothing.
 *
 * PREDICTIONS, written before the run: every locale-map case is RED before the
 * fix, and red in the defect's own shape — the key is `undefined`, i.e. absent,
 * i.e. no heading. The plain-string case is GREEN on both sides.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
// The renderer's own translation layer, imported read-only through its
// PUBLISHED root entry — the same module `ChartRenderer` calls, reached the way
// any consumer outside this repo would reach it (objectui#4529).
import { normalizeChartSchema } from '@object-ui/plugin-charts';

let lastChartSchema: any = null;

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: (props: any) => {
    lastChartSchema = props.schema;
    return null;
  },
}));

import { DatasetWidget } from '../DatasetWidget';

afterEach(() => {
  cleanup();
  lastChartSchema = null;
});

const rows = [
  { stage: 'open', amount: 120 },
  { stage: 'paid', amount: 80 },
];

const fields = [
  { name: 'stage', label: 'Stage' },
  { name: 'amount', label: 'Amount' },
];

/** ⚠️ `en` FIRST. objectui#8943's defect was a first-string-in-key-order pick,
 *  so a map written `zh-CN` first would satisfy that defect too. */
const TITLE = { en: 'Pricing', 'zh-CN': '定价' };
const SUBTITLE = { en: 'By stage', 'zh-CN': '按阶段' };
const DESCRIPTION = { en: 'Bar chart of pricing by stage', 'zh-CN': '按阶段的价格柱状图' };

const renderWidget = async (chartConfig: Record<string, unknown>) => {
  const src = { queryDataset: vi.fn(async () => ({ rows, fields })) };
  render(
    <DatasetWidget
      widget={{
        type: 'bar',
        dataset: 'deals',
        dimensions: ['stage'],
        values: ['amount'],
        chartConfig,
      }}
      dataSource={src}
    />,
  );
  await waitFor(() => expect(lastChartSchema).not.toBeNull());
  return lastChartSchema;
};

describe('DatasetWidget — an authored locale-map heading survives to the renderer (objectui#9038)', () => {
  it('carries the authored union onto the emitted schema instead of erasing it', async () => {
    const schema = await renderWidget({ title: TITLE, subtitle: SUBTITLE, description: DESCRIPTION });
    // The failure this replaces was ABSENCE, so the first thing to pin is that
    // the keys are there at all — and that what arrived is the author's value,
    // not something coerced on the way.
    expect(schema.title).toEqual(TITLE);
    expect(schema.subtitle).toEqual(SUBTITLE);
    expect(schema.description).toEqual(DESCRIPTION);
  });

  it('resolves to the zh-CN entries for a zh-CN viewer', async () => {
    const schema = await renderWidget({ title: TITLE, subtitle: SUBTITLE, description: DESCRIPTION });
    const zh = normalizeChartSchema(schema, 'zh-CN');
    expect(zh.title).toBe('定价');
    expect(zh.subtitle).toBe('按阶段');
    expect(zh.description).toBe('按阶段的价格柱状图');
  });

  it('resolves to the en entries for an en viewer — the same maps, the other headings', async () => {
    const schema = await renderWidget({ title: TITLE, subtitle: SUBTITLE, description: DESCRIPTION });
    const en = normalizeChartSchema(schema, 'en');
    expect(en.title).toBe('Pricing');
    expect(en.subtitle).toBe('By stage');
    expect(en.description).toBe('Bar chart of pricing by stage');
  });

  it('leaves a plain-string title alone in either language — the live control', async () => {
    const schema = await renderWidget({ title: 'Quarterly revenue' });
    expect(schema.title).toBe('Quarterly revenue');
    expect(normalizeChartSchema(schema, 'zh-CN').title).toBe('Quarterly revenue');
    expect(normalizeChartSchema(schema, 'en').title).toBe('Quarterly revenue');
  });
});
