/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:history` labels each badge from `sys_activity.type` (objectstack#28894).
 *
 * The block self-fetches `sys_activity` and maps each row's `type` to the
 * entry's `action`, so the badge's source field is `sys_activity.type`. In zh
 * the badge reads that option's served label (已更新), not the stored word
 * upper-cased (UPDATED). Entries a host passes in name no source, so they keep
 * the stored value.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, transformSpecTranslations } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHistoryRenderer } from '../record-history';

const RESOURCES = {
  zh: transformSpecTranslations({
    objects: {
      sys_activity: {
        label: '活动',
        fields: { type: { label: '类型', options: { created: '已创建', updated: '已更新' } } },
      },
    },
  }),
};

const ROWS = [
  { id: 'a-1', type: 'updated', summary: '更新了 线索 "Lead 1"：职位', timestamp: '2026-01-02T00:00:00.000Z' },
  { id: 'a-2', type: 'created', summary: '创建了 线索 "Lead 1"', timestamp: '2026-01-01T00:00:00.000Z' },
];

function mount(schema: Record<string, unknown> = {}) {
  const dataSource = { find: vi.fn(async () => ({ data: ROWS })) } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: RESOURCES }}>
      <RecordContextProvider
        objectName="crm_lead"
        recordId="rec-1"
        data={{ id: 'rec-1', name: 'Lead 1' }}
        dataSource={dataSource}
      >
        <RecordHistoryRenderer schema={schema as any} />
      </RecordContextProvider>
    </I18nProvider>,
  );
  return dataSource;
}

afterEach(() => cleanup());

describe('record:history badge label (objectstack#28894)', () => {
  it('labels self-fetched entries from sys_activity.type in zh', async () => {
    const dataSource = mount();
    const updated = await screen.findByText('已更新');
    expect(updated.className).not.toContain('uppercase');
    expect(screen.getByText('已创建')).toBeTruthy();
    expect(screen.queryByText('updated')).toBeNull();
    expect(dataSource.find).toHaveBeenCalledWith('sys_activity', expect.anything());
  });

  it('keeps the stored value for host-supplied entries, which name no source', () => {
    mount({ entries: [{ id: 'h-1', action: 'updated', user_name: 'Ada Lovelace', created_at: '2026-01-02T00:00:00.000Z' }] });
    expect(screen.getByText('updated').className).toContain('uppercase');
    expect(screen.queryByText('已更新')).toBeNull();
  });
});
