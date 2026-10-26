/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard heading resolves an INLINE locale map label (objectui#4580).
 *
 * `BaseSchema.label` accepts `string | I18nLabel` since #4580's revised Q1
 * ruling. `DashboardGridLayout` renders `schema.label` into an `<h2 >` text
 * node, which is the fourth and last site the widening's compiler inventory
 * named repo-wide (the other three are `@object-ui/components` renderers,
 * pinned in that package's `inline-locale-label-read-sites.test.tsx`).
 *
 * ## Red-first — measured BEFORE the fix, verbatim
 *
 * Rendering with `label: { en: 'Owner', 'zh-CN': '负责人' }` against the
 * unfixed source THREW:
 *
 * ```
 * Objects are not valid as a React child (found: object with keys {en, zh-CN}).
 * If you meant to render a collection of children, use an array instead.
 * ```
 *
 * ## Why `pickLocalized`, not the spec's `resolveI18nLabel`
 *
 * This component ALREADY resolves the sibling slot — `widget.title`, the same
 * inline-map vocabulary — with `pickLocalized(widget.title, language)` against
 * `useObjectTranslation().language`. Adding the spec resolver plus
 * `useDisplayLocale()` here would put two resolvers AND two locale channels in
 * one component for one vocabulary, and those channels genuinely disagree:
 * `useDisplayLocale()` prefers the tenant's regional default over the active UI
 * language, so a heading and the widget titles beneath it could resolve to
 * different languages in the same render.
 *
 * That is not a tolerant fallback standing in for the real resolver:
 * `pickLocalized` is objectui's limb-for-limb twin of `resolveI18nLabel`
 * (objectstack#6765 aligned them deliberately), and the ONLY difference is how
 * each spells a miss — `''` here for a text node, `undefined` there for a
 * producer's `?? name` chain — pinned in
 * `plugin-list/src/__tests__/i18nLabel-resolver-parity.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DashboardGridLayout } from '../DashboardGridLayout';

const INLINE_MAP = { en: 'Owner', 'zh-CN': '负责人' } as const;

/**
 * The heading reads the ACTIVE UI LANGUAGE channel (`useObjectTranslation`),
 * which is seeded by `config.defaultLanguage` — NOT by a `language` prop.
 * `persistLanguage={false}` keeps a stored preference from outranking the seed,
 * following `fields/src/__tests__/PercentCellRenderer.locale.test.tsx`.
 */
function renderGrid(schema: Record<string, unknown>, language: string) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <DashboardGridLayout schema={{ type: 'dashboard', widgets: [], ...schema } as any} />
    </I18nProvider>,
  );
}

describe('DashboardGridLayout heading — inline locale map label (objectui#4580)', () => {
  it('resolves the map for the active language', () => {
    renderGrid({ label: INLINE_MAP }, 'zh-CN');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('负责人');
  });

  it('resolves the same map differently for another language', () => {
    renderGrid({ label: INLINE_MAP }, 'en');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Owner');
  });

  it('passes a plain string label through unchanged', () => {
    renderGrid({ label: 'Sales' }, 'zh-CN');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Sales');
  });

  /**
   * INVERTED by objectui#7509 (maintainer ruling 2026-09-04, decision batch
   * #29). This case used to read "keeps `title` ahead of `label` in the
   * precedence chain" and asserted `Pipeline`. The dashboard-root `title` read
   * arm retired under ADR-0049 across all five surfaces, so `label` is now the
   * only header source — and the case is inverted rather than deleted, because
   * a legacy `title` sitting in front of the map is precisely what used to stop
   * this file's subject (the resolver) from running at all.
   *
   * That makes this the strongest non-vacuity control in the file: before the
   * retirement, a document carrying both NEVER exercised `pickLocalized`.
   */
  it('resolves the `label` map even when a legacy root `title` is also present', () => {
    renderGrid({ title: 'Pipeline', label: INLINE_MAP }, 'zh-CN');
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('负责人');
    expect(heading).not.toHaveTextContent('Pipeline');
  });

  it("falls back to 'Dashboard' when the map resolves to nothing", () => {
    renderGrid({ label: {} }, 'zh-CN');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Dashboard');
  });
});
