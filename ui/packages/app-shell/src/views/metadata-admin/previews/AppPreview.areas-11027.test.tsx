// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11027: the Studio app preview shows each navigation area's
 * `description`.
 *
 * `AppSchema.areas[]` carries a `label` and an optional `description`, both the
 * spec's `I18nLabel` (a plain string or an inline locale map). Before this card
 * `AppPreview` read no `areas` at all, so an authored area description reached
 * no human anywhere in Studio.
 *
 * The cases:
 *   - authored: the description renders under its own area's label;
 *   - absent: an area with no `description` renders its label and id only, and
 *     an app with no `areas` renders no areas list at all;
 *   - locale map: both keys resolve in the designer `locale`, never as
 *     `[object Object]`;
 *   - the list's heading is designer chrome, read in the designer `locale`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '../i18n';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

const NAV = [{ id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' }];

function renderApp(draft: Record<string, unknown>, locale = 'en-US') {
  return render(<AppPreview type="app" name="crm" draft={{ name: 'crm', label: 'CRM', ...draft }} locale={locale} />);
}

/** The areas list item that shows `label`. */
function areaItem(label: string): HTMLElement {
  const item = screen.getByText(label).closest('li');
  expect(item, `no areas list item shows ${JSON.stringify(label)}`).not.toBeNull();
  return item as HTMLElement;
}

describe('AppPreview renders each area with its description (objectui#11027)', () => {
  it('shows an authored description under its own area, and nothing for an area without one', () => {
    renderApp({
      navigation: NAV,
      areas: [
        { id: 'area_sales', label: 'Sales', description: 'Leads, opportunities and forecasts', navigation: NAV },
        { id: 'area_service', label: 'Service', navigation: NAV },
      ],
    });

    expect(areaItem('Sales').textContent).toContain('Leads, opportunities and forecasts');
    // Absent: the label and the id are all this row carries, with no stand-in text.
    expect(areaItem('Service').textContent).toBe('Servicearea_service');
  });

  it('renders no areas list for an app that declares no areas', () => {
    renderApp({ navigation: NAV });
    expect(screen.queryByText(t('engine.appPreview.areas', 'en-US'))).toBeNull();
    expect(document.querySelector('li')).toBeNull();
  });

  it('resolves a locale-map label and description in the designer locale', () => {
    const areas = [
      {
        id: 'area_sales',
        label: { en: 'Sales', 'zh-CN': '销售' },
        description: { en: 'Pipeline work', 'zh-CN': '销售管道' },
        navigation: NAV,
      },
    ];

    renderApp({ navigation: NAV, areas }, 'zh-CN');
    expect(areaItem('销售').textContent).toContain('销售管道');
    expect(document.body.textContent).not.toContain('[object Object]');
    cleanup();

    renderApp({ navigation: NAV, areas }, 'en-US');
    expect(areaItem('Sales').textContent).toContain('Pipeline work');
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('reads the list heading in the designer locale', () => {
    const zh = t('engine.appPreview.areas', 'zh-CN');
    expect(zh, 'a missing zh row echoes the key back').not.toBe('engine.appPreview.areas');
    expect(zh).not.toBe(t('engine.appPreview.areas', 'en-US'));

    renderApp({ navigation: NAV, areas: [{ id: 'area_sales', label: 'Sales', navigation: NAV }] }, 'zh-CN');
    expect(screen.getByText(zh)).toBeTruthy();
  });

  it('lists the areas in design mode too', () => {
    render(
      <AppPreview
        type="app"
        name="crm"
        draft={{
          name: 'crm',
          navigation: NAV,
          areas: [{ id: 'area_sales', label: 'Sales', description: 'Pipeline work', navigation: NAV }],
        }}
        editing
        selection={null}
        onSelectionChange={() => {}}
        locale="en-US"
      />,
    );
    expect(areaItem('Sales').textContent).toContain('Pipeline work');
  });
});
