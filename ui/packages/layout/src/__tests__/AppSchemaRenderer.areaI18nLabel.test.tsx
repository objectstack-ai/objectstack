/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4163 part 1 — `NavigationArea.label` is the spec's `I18nLabel`, and
 * `@objectstack/spec` 17.0.0-rc.6 widened that from `string` to
 * `string | Record<string, string>`. The area switcher reads it twice (the
 * button's `tooltip` and its visible `<span>`), so an inline per-locale map
 * used to reach objectui's KEYED resolver — which answers `undefined` for a map
 * that carries no `key` — and, via the `tooltip` string slot, `[object Object]`.
 *
 * The pins below are DOM assertions rather than type assertions on purpose: the
 * `tsc` error is the pre-fix red for the compile half, and it says nothing about
 * *which* string a reader ends up seeing. Both halves have to hold.
 *
 * `@object-ui/layout` carries no i18n dependency by design, so the resolution
 * runs at the spec's documented "no locale known" default (`en`) — see
 * `resolveAreaLabel` in `AppSchemaRenderer.tsx` for why that is a choice and
 * what would change it.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppComponentSchema, NavigationArea } from '@object-ui/types';
import { AppSchemaRenderer } from '../AppSchemaRenderer';

function renderApp(schema: AppComponentSchema) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppSchemaRenderer schema={schema} basePath="/apps/crm">
        <div data-testid="page-content">Page Content</div>
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
}

/** Two areas — the switcher only renders with more than one. */
const mapLabelledArea: NavigationArea = {
  id: 'area-sales',
  label: { en: 'Sales', 'zh-CN': '销售' },
  icon: 'Briefcase',
  navigation: [
    { id: 'n1', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
  ],
};

const stringLabelledArea: NavigationArea = {
  id: 'area-service',
  label: 'Service',
  icon: 'Headphones',
  navigation: [{ id: 'n2', type: 'object', label: 'Cases', objectName: 'case' }],
};

const schema: AppComponentSchema = {
  type: 'app',
  name: 'crm',
  title: 'Sales CRM',
  areas: [mapLabelledArea, stringLabelledArea],
};

describe('AppSchemaRenderer — inline per-locale area labels (#4163)', () => {
  it('renders the resolved locale string for a map-valued area label', () => {
    renderApp(schema);
    expect(screen.getByText('Sales')).toBeTruthy();
  });

  it('never renders the stringified object', () => {
    const { container } = renderApp(schema);
    // The whole harm this card exists for. Asserted on the full subtree rather
    // than one node, because the map reaches TWO slots (visible text and the
    // button's `tooltip`/`title`) and either alone would look fixed.
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('keeps the tooltip slot a real string, not a stringified map', () => {
    renderApp(schema);
    const button = screen.getByText('Sales').closest('button');
    expect(button).toBeTruthy();
    // `tooltip` is forwarded to the sidebar button; whatever attribute carries
    // it must never hold the object's source text.
    expect(button!.outerHTML).not.toContain('[object Object]');
  });

  it('leaves a plain-string area label exactly as authored', () => {
    // The non-vacuity half: if `resolveAreaLabel` were returning '' for
    // everything, the assertion above would still pass. This one would not.
    renderApp(schema);
    expect(screen.getByText('Service')).toBeTruthy();
  });

  it('falls back to `en` when the map has no entry for the default locale', () => {
    // Limb 5 of the shared resolution rule: no locale is known here, so `en`
    // is what the spec's resolver picks — the documented behaviour this
    // package deliberately settles for.
    renderApp({
      ...schema,
      areas: [
        { ...mapLabelledArea, label: { 'zh-CN': '销售', en: 'Sales EN' } },
        stringLabelledArea,
      ],
    });
    expect(screen.getByText('Sales EN')).toBeTruthy();
    expect(screen.queryByText('销售')).toBeNull();
  });
});
