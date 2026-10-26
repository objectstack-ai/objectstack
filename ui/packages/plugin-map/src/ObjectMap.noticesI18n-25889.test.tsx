/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25889 — the map's notices read the bundle: a zh-CN console shows
 * them in Chinese, not as the English literals they used to be.
 *
 * Its own FILE because mounting `I18nProvider` registers its instance as
 * react-i18next's module-global default for the rest of the file; the
 * provider-less English path is pinned in
 * `ObjectMap.styleFailureList-25889.test.tsx`, which never mounts one.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ObjectMapSchema } from '@object-ui/types';
import { I18nProvider } from '@object-ui/react';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

type Slot = { children?: React.ReactNode };

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: Slot & { onError?: (e: { error?: Error }) => void }) => (
    <div aria-label="Map">
      <button
        type="button"
        data-testid="simulate-style-error"
        onClick={() => props.onError?.({ error: new Error('Failed to fetch') })}
      />
      {props.children}
    </div>
  ),
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: Slot) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: Slot) => <div data-testid="map-popup">{children}</div>,
}));

const records = [
  { id: 't1', title: 'Install rooftop unit', location: { lat: 47.6062, lng: -122.3321 } },
  { id: 't2', title: 'No coordinates' },
];

const schema: ObjectMapSchema = { type: 'object-map', map: { locationField: 'location', titleField: 'title' } };

describe('ObjectMap notices under zh-CN (objectstack#25889)', () => {
  it('the excluded-records notice and the style-failure alert are in Chinese', async () => {
    render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <ObjectMap schema={schema} data={records} />
      </I18nProvider>,
    );
    await screen.findByLabelText('Map');
    await waitFor(() =>
      expect(screen.getByText('因坐标缺失或无效而未显示在地图上的记录：1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('simulate-style-error'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '地图加载失败（Failed to fetch）。记录已列在下方；此处无法加载公共默认地图瓦片，请联系管理员为此视图设置地图样式。',
    );
    expect(screen.getByTestId('map-style-retry')).toHaveTextContent('重试加载地图');
    expect(screen.getByRole('list', { name: '位置' })).toBeInTheDocument();
  });
});
