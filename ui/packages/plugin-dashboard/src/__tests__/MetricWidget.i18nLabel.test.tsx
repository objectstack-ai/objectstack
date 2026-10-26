/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4032 — the OTHER two of the three private `resolveLabel` copies.
 *
 * `MetricWidget` and `MetricCard` are public SDUI blocks: a schema may address
 * them directly (`type: 'metric'` / `'metric-card'`) without going through
 * `DashboardRenderer`, so each has to resolve its own labels. Both carried the
 * same private resolver ending `return label.defaultValue || label.key`, and
 * both therefore rendered NOTHING for the inline per-locale map that
 * `@objectstack/spec` actually admits — the map has neither key.
 *
 * DIRECTIONS: every map case below is RED before the change (empty heading),
 * every plain-string case is GREEN on both sides.
 *
 * The `bare` variant is pinned alongside `card` because it is a SECOND read of
 * the same prop in the same file — the kind of second site a per-call fix
 * misses.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MetricWidget } from '../MetricWidget';
import { MetricCard } from '../MetricCard';

afterEach(cleanup);

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
      {ui}
    </I18nProvider>,
  );
}

describe('MetricWidget / MetricCard — inline per-locale labels (#4032)', () => {
  it('MetricWidget resolves a map `label` to the active locale', () => {
    renderIn('zh', <MetricWidget label={{ en: 'Revenue', 'zh-CN': '收入' }} value={42} />);
    expect(screen.getByText('收入')).toBeTruthy();
  });

  it('MetricWidget resolves a map `label` in the `bare` variant too', () => {
    renderIn('zh', <MetricWidget variant="bare" label={{ en: 'Revenue', 'zh-CN': '收入' }} value={42} />);
    expect(screen.getByText('收入')).toBeTruthy();
  });

  it('MetricWidget resolves a map `description` (the sub-caption slot)', () => {
    renderIn('zh', <MetricWidget label="Revenue" value={42} description={{ en: 'this month', 'zh-CN': '本月' }} />);
    expect(screen.getByText('本月')).toBeTruthy();
  });

  it('MetricWidget keeps the trend-phrase translation working on a plain string', () => {
    // #4333's neighbour behaviour: a recognised English trend phrase still maps
    // to its canonical key and translates. The map support must not disturb it.
    renderIn('en', <MetricWidget label="Revenue" value={42} description="vs last quarter" />);
    expect(screen.getByText('vs last quarter')).toBeTruthy();
  });

  it('MetricCard resolves map `title` and `description`', () => {
    renderIn('zh', (
      <MetricCard
        title={{ en: 'Revenue', 'zh-CN': '收入' }}
        value={42}
        description={{ en: 'this month', 'zh-CN': '本月' }}
      />
    ));
    expect(screen.getByText('收入')).toBeTruthy();
    expect(screen.getByText('本月')).toBeTruthy();
  });

  it('leaves plain-string labels exactly as authored', () => {
    // Non-vacuity for all of the above.
    renderIn('zh', <MetricWidget label="Revenue" value={42} />);
    expect(screen.getByText('Revenue')).toBeTruthy();
  });
});
