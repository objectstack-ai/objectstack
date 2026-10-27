// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26745 — the dashboard's two widget-type pickers read ONE registry
 * of the renderable spec types.
 *
 * Measured on `main` before this change: the designer's Add-widget menu offered
 * 11 types, the widget inspector's Type select 10 (no `scatter`), and the spec's
 * `ChartTypeSchema` accepts 20 — every one of which the dashboard draws when
 * written through the API. Each picker kept its own hand-written list.
 *
 * Pinned here, each through the rendered control:
 * - the registry IS the spec vocabulary (`WIDGET_TYPE_IDS` = `ChartTypeSchema`);
 * - the Add menu offers exactly that set, and so does the Type select;
 * - every offered type renders through the real `DashboardRenderer` — no
 *   "not supported yet" placeholder, no red unknown-component panel;
 * - every offered type has its two names in both catalogues (en + zh).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChartTypeSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
// Module-scope import of the lazily loaded renderer, so the preview's
// `React.lazy` factory resolves at once instead of racing the test's wait
// window (AGENTS.md, flaky-test discipline).
import '@object-ui/plugin-dashboard';

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});
// Network-free dataset catalog for the widget inspector.
vi.mock('./useDatasetCatalog', () => ({
  useDatasetCatalog: () => ({ datasets: [], loading: false, error: null }),
  useDatasetSemantics: () => ({ dimensions: [], measures: [], loading: false, error: null }),
}));

import { t } from '../i18n';
import { WIDGET_TYPE_IDS, WIDGET_TYPE_META } from './widget-types';
import { DashboardPreview } from './DashboardPreview';
import { DashboardDefaultInspector } from '../inspectors/DashboardDefaultInspector';
import { DashboardWidgetInspector } from '../inspectors/DashboardWidgetInspector';
// The `engine.inspector.*` rows live in `@object-ui/i18n`'s `studio` namespace,
// whose `zh` catalogue is fetched on demand (objectstack#25922). Resident before
// any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

// Radix Select reads pointer capture, which jsdom does not implement.
for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(m in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
  }
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const specTypes: string[] = enumOptions(ChartTypeSchema);

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The stored types the Add-widget menu lists, read off its rendered entries. */
async function addMenuTypes(): Promise<string[]> {
  render(
    <DashboardDefaultInspector
      type="dashboard"
      name="sales"
      locale="en-US"
      draft={{ name: 'sales', label: 'Sales', widgets: [] }}
      onPatch={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.add.widget', 'en-US') }));
  await flush();
  const picker = screen.getByRole('dialog');
  return Array.from(picker.querySelectorAll('button code')).map((c) => c.textContent ?? '');
}

/** The option names the widget inspector's Type select lists. */
async function typeSelectOptions(): Promise<string[]> {
  render(
    <DashboardWidgetInspector
      type="dashboard"
      name="sales"
      locale="en-US"
      draft={{ widgets: [{ id: 'w1', type: 'bar', title: 'Revenue' }] }}
      selection={{ kind: 'widget', id: 'w1' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
    />,
  );
  fireEvent.keyDown(document.getElementById('widget-type')!, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

describe('one widget-type registry, derived from the spec (objectstack#26745)', () => {
  it('reads a non-empty enum from the spec', () => {
    expect(specTypes, 'could not read ChartTypeSchema.options from the spec').not.toEqual([]);
  });

  it('the registry is the spec vocabulary, in the spec order', () => {
    expect([...WIDGET_TYPE_IDS]).toEqual(specTypes);
    expect(Object.keys(WIDGET_TYPE_META).sort()).toEqual([...specTypes].sort());
  });

  it('the Add-widget menu offers exactly the spec types', async () => {
    expect((await addMenuTypes()).sort()).toEqual([...specTypes].sort());
  });

  it('the Type select offers exactly the spec types, named from the same registry', async () => {
    expect(await typeSelectOptions()).toEqual(
      specTypes.map((id) => t(WIDGET_TYPE_META[id].selectLabelKey, 'en-US')),
    );
  });

  it('every offered type renders through the real DashboardRenderer — no placeholder, no red panel', async () => {
    const widgets = WIDGET_TYPE_IDS.map((type, i) => ({
      id: `w_${i}`,
      type,
      title: `Widget ${type}`,
      layout: { x: (i % 4) * 3, y: Math.floor(i / 4) * 2, w: 3, h: 2 },
    }));
    const { container } = render(
      <DashboardPreview
        type="dashboard"
        name="all_types"
        draft={{ name: 'all_types', label: 'All types', widgets }}
        editing={false}
        selection={null}
        onSelectionChange={() => {}}
        onPatch={() => {}}
        locale="en-US"
      />,
    );
    await waitFor(() => {
      const cells = container.querySelectorAll('[style*="grid-column"]');
      if (cells.length !== widgets.length) throw new Error(`expected ${widgets.length} widget cells, saw ${cells.length}`);
    });
    expect(container.textContent).not.toMatch(/chart type is not supported yet/);
    expect(container.textContent).not.toMatch(/Unknown component type/);
  });

  it('every offered type has its Add-menu name and its Type-select name in en and zh', () => {
    for (const meta of Object.values(WIDGET_TYPE_META)) {
      for (const key of [meta.labelKey, meta.selectLabelKey]) {
        expect(t(key, 'en-US'), `${key}: missing en row`).not.toBe(key);
        // A missing zh row reads the en one back.
        expect(t(key, 'zh-CN'), `${key}: missing zh row`).not.toBe(t(key, 'en-US'));
      }
      // The Add menu's en name is the English the stored default title is written from.
      expect(t(meta.labelKey, 'en-US'), meta.id).toBe(meta.label);
    }
  });
});
