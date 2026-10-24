// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12688 — the dashboard component list's display titles, paired from
 * the server's localized `/meta` dashboard and the published layer it
 * translated. This is the rail's rule (`servedNavText.test.ts`) applied to
 * widgets, with the same comparison.
 *
 * The fixtures are the showcase's shape. The published layer is the authored
 * English document `/layers` serves. The served row is what the `/meta`
 * dashboard list answers on a zh-CN request: `translateDashboard` rewrites a
 * widget's `title` by its `id` where the bundle has one, and only
 * `combo_count_vs_progress` has one here. Both documents parse against the
 * spec's `DashboardSchema`.
 */

import { describe, expect, it } from 'vitest';
import { DashboardSchema } from '@objectstack/spec/ui';
import { displayWidgetTitle, servedWidgetTextOf } from './servedDashboardText';

const widget = (id: string, title: unknown) => ({
  id,
  type: 'metric',
  title,
  dataset: 'tasks_ds',
  values: ['task_count'],
  layout: { x: 0, y: 0, w: 3, h: 2 },
});

const PUBLISHED = {
  name: 'showcase_chart_gallery',
  label: 'Chart Gallery',
  widgets: [widget('kpi_total', 'Total Tasks'), widget('combo_count_vs_progress', 'Task Count vs Avg Progress')],
};

const SERVED_ZH = {
  ...PUBLISHED,
  widgets: [widget('kpi_total', 'Total Tasks'), widget('combo_count_vs_progress', '任务数与平均进度')],
};

describe('the objectui#12688 dashboard fixture is what the spec accepts', () => {
  it('the published layer and the served row both parse against DashboardSchema', () => {
    expect(DashboardSchema.safeParse(PUBLISHED).success).toBe(true);
    expect(DashboardSchema.safeParse(SERVED_ZH).success).toBe(true);
  });
});

describe('displayWidgetTitle — the component list draws the served title of an unchanged widget (objectui#12688)', () => {
  const served = servedWidgetTextOf(PUBLISHED, SERVED_ZH);

  it('a widget whose title is the published one draws the served title; one the bundle leaves alone reads as authored', () => {
    expect(PUBLISHED.widgets.map((w) => displayWidgetTitle(w as never, served))).toEqual(['Total Tasks', '任务数与平均进度']);
  });

  it('a widget changed in the draft, and one added there, draw their authored title', () => {
    expect(displayWidgetTitle(widget('combo_count_vs_progress', 'Count vs Progress') as never, served)).toBe('Count vs Progress');
    expect(displayWidgetTitle(widget('widget_new', 'New metric') as never, served)).toBe('New metric');
  });

  it('a locale map is the same authored title as an equal map, whatever its key order', () => {
    const published = { ...PUBLISHED, widgets: [widget('combo_count_vs_progress', { en: 'Combo', fr: 'Combiné' })] };
    const text = servedWidgetTextOf(published, SERVED_ZH);
    expect(displayWidgetTitle(widget('combo_count_vs_progress', { fr: 'Combiné', en: 'Combo' }) as never, text)).toBe('任务数与平均进度');
    expect(displayWidgetTitle(widget('combo_count_vs_progress', { en: 'Combo', fr: 'Mixte' }) as never, text)).toEqual({
      en: 'Combo',
      fr: 'Mixte',
    });
  });

  it('the widget itself is never modified', () => {
    const before = JSON.stringify(PUBLISHED);
    for (const w of PUBLISHED.widgets) displayWidgetTitle(w as never, served);
    expect(JSON.stringify(PUBLISHED)).toBe(before);
  });
});

describe('servedWidgetTextOf — what counts as a served counterpart (objectui#12688)', () => {
  it('no served text without both documents, or for two different dashboards', () => {
    expect(servedWidgetTextOf(null, SERVED_ZH)).toBeNull();
    expect(servedWidgetTextOf(PUBLISHED, null)).toBeNull();
    // `/layers` answering 404 leaves the pillar an empty document.
    expect(servedWidgetTextOf({}, SERVED_ZH)).toBeNull();
    expect(servedWidgetTextOf(PUBLISHED, { ...SERVED_ZH, name: 'other_dashboard' })).toBeNull();
  });

  it('outside the Studio pillar (no served text) every widget reads as authored', () => {
    expect(displayWidgetTitle(PUBLISHED.widgets[1] as never, null)).toBe('Task Count vs Avg Progress');
  });
});
