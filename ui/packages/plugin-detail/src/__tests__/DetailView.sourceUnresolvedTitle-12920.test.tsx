/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12920 — `detail-view`'s unresolvable-view panel is titled from the
 * bundle (`element.detailView.sourceUnresolved`), not with the English literal
 * it carried. The block had no data-source pin of its own to sit beside, so
 * this one renders it through the real `SchemaRenderer` and registry under a
 * mounted zh-CN `I18nProvider`, with a binding that names a view the object
 * does not have.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `detail-view` (and the ElementDataSourceGate wiring under test).
import '../index';

const makeAdapter = () => ({
  find: vi.fn().mockResolvedValue({ data: [] }),
  findOne: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'contact',
    fields: { name: { type: 'text' } },
    listViews: { recent: { name: 'recent', label: 'Recent contacts', columns: ['name'] } },
  }),
});

const renderIn = (language: string, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer
          schema={{ type: 'detail-view', recordId: 'C-1', dataSource: { object: 'contact', view: 'nope' } } as any}
        />
      </SchemaRendererProvider>
    </I18nProvider>,
  );

const title = (container: HTMLElement) =>
  container.querySelector('[data-testid="detail-view-datasource-error"] p.font-medium')?.textContent;

describe('detail-view — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const { container } = renderIn('zh-CN', makeAdapter());
    await waitFor(() =>
      expect(container.querySelector('[data-testid="detail-view-datasource-error"]')).not.toBeNull(),
    );
    expect(title(container)).toBe('无法解析此详情视图的数据源');
  });

  it('CONTROL: under en the same panel reads the en pack', async () => {
    const { container } = renderIn('en', makeAdapter());
    await waitFor(() =>
      expect(container.querySelector('[data-testid="detail-view-datasource-error"]')).not.toBeNull(),
    );
    expect(title(container)).toBe('This detail view’s data source could not be resolved');
  });
});
