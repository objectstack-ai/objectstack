/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The "saved view is still resolving" placeholder reads the bundle
 * (objectui#12889).
 *
 * `ElementDataSourceLoadingPanel` printed an English "Loading view…" on every
 * locale, so a zh-CN page bound through a named view showed English on every
 * load. It reads `common.loading` now, the key the rest of the tree reads for a
 * bare "Loading…". Pinned through the gate itself (a view whose schema fetch
 * never settles, so the panel stays up) and on the exported panel alone.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { ElementDataSourceGate, ElementDataSourceLoadingPanel } from '../ElementDataSourceGate';

/** A view lookup that never answers, so the gate stays in its loading state. */
const pendingAdapter = () => ({
  find: vi.fn(),
  getObjectSchema: vi.fn(() => new Promise<never>(() => {})),
});

const inLanguage = (language: string, node: React.ReactElement) =>
  render(
    <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {node}
    </I18nProvider>,
  );

describe('ElementDataSourceLoadingPanel reads the bundle (objectui#12889)', () => {
  it('under zh-CN, the gate pending on a named view draws the zh pack value and no English', async () => {
    const { queryByTestId, getByTestId } = inLanguage(
      'zh-CN',
      <ElementDataSourceGate
        schema={{ dataSource: { object: 'account', view: 'hot' } }}
        mapping={{ filter: true }}
        dataSource={pendingAdapter()}
        testId="probe"
      >
        {() => <div data-testid="block" />}
      </ElementDataSourceGate>,
    );
    await waitFor(() => expect(queryByTestId('probe-resolving-view')).not.toBeNull());
    const text = getByTestId('probe-resolving-view').textContent ?? '';
    expect(text).toBe('加载中…');
    expect(text).not.toMatch(/Loading/);
    expect(queryByTestId('block')).toBeNull();
  });

  it('CONTROL — under en the panel reads the en pack value', () => {
    const { getByTestId } = inLanguage('en', <ElementDataSourceLoadingPanel testId="probe" />);
    expect(getByTestId('probe-resolving-view').textContent).toBe('Loading…');
  });

  it('without an I18nProvider the inline default reaches the screen, not the raw key', () => {
    const { getByTestId } = render(<ElementDataSourceLoadingPanel testId="probe" />);
    const text = getByTestId('probe-resolving-view').textContent ?? '';
    expect(text).toBe('Loading…');
    expect(text).not.toContain('common.loading');
  });
});
