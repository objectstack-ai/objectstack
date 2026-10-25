/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Page element blocks draw their loading, empty and error defaults in the
 * page's language (objectui#12889).
 *
 * Before: `element:repeater` printed the English literals "Loading…",
 * "No records" and "Failed to load", none of them through `t()`, and a loading
 * `element:number` printed a bare `…` glyph at the number's size. A zh-CN
 * control-plane home showed both on every load. Now:
 *
 *   - the repeater reads `common.loading`, `common.noData` and
 *     `list.loadErrorTitle`; an authored `emptyText` still wins, and a thrown
 *     message is still shown as thrown;
 *   - a loading number draws the skeleton primitive, named by `common.loading`.
 *
 * Rendered through the real `SchemaRenderer` and this package's registration,
 * under a mounted `I18nProvider`, with an adapter whose `find` is held pending,
 * answers empty, or rejects.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

type Find = (...args: unknown[]) => Promise<unknown>;

const pending: Find = () => new Promise<never>(() => {});
const empty: Find = async () => ({ data: [], total: 0 });
const rejectsWith = (message: string): Find => async () => {
  throw new Error(message);
};

function mount(language: string, node: Record<string, unknown>, find: Find) {
  const adapter = { find: vi.fn(find) };
  return render(
    <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <AdapterCtx.Provider value={adapter as never}>
        <SchemaRenderer schema={node as never} />
      </AdapterCtx.Provider>
    </I18nProvider>,
  );
}

const repeater = (properties: Record<string, unknown> = {}) => ({
  type: 'element:repeater',
  id: 'rep',
  dataSource: { object: 'contact' },
  properties: { titleField: 'name', ...properties },
});

const number = {
  type: 'element:number',
  id: 'metric',
  dataSource: { object: 'contact' },
  properties: { aggregate: 'count' },
};

/** Any run of Latin letters: the zh render of these states carries none. */
const LATIN = /[A-Za-z]/;

describe('element:repeater — loading, empty and error defaults read the bundle (objectui#12889)', () => {
  it('under zh-CN, a pending find shows the zh loading text and no English', async () => {
    const { container } = mount('zh-CN', repeater(), pending);
    const loading = await screen.findByTestId('repeater-loading');
    expect(loading.textContent).toBe('加载中…');
    expect(container.textContent).not.toContain('Loading');
    expect(container.textContent).not.toMatch(LATIN);
  });

  it('under zh-CN, an empty answer shows the zh empty default', async () => {
    const { container } = mount('zh-CN', repeater(), empty);
    await waitFor(() => expect(screen.getByText('暂无数据')).toBeInTheDocument());
    expect(container.textContent).not.toMatch(LATIN);
  });

  it('under zh-CN, a rejection with no message shows the zh error default', async () => {
    const { container } = mount('zh-CN', repeater(), rejectsWith(''));
    const error = await screen.findByTestId('repeater-error');
    expect(error.textContent).toBe('无法加载记录');
    expect(container.textContent).not.toMatch(LATIN);
  });

  it('CONTROL — a thrown message is still shown as thrown', async () => {
    mount('zh-CN', repeater(), rejectsWith('upstream refused'));
    const error = await screen.findByTestId('repeater-error');
    expect(error.textContent).toBe('upstream refused');
  });

  it('CONTROL — an authored emptyText wins over the default, in any language', async () => {
    const { container } = mount('zh-CN', repeater({ emptyText: 'Nothing here yet' }), empty);
    await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeInTheDocument());
    expect(container.textContent).not.toContain('暂无数据');
  });

  it('CONTROL — under en the defaults read the en pack', async () => {
    mount('en', repeater(), pending);
    expect((await screen.findByTestId('repeater-loading')).textContent).toBe('Loading…');
    cleanup();
    mount('en', repeater(), empty);
    await waitFor(() => expect(screen.getByText('No data')).toBeInTheDocument());
  });
});

describe('element:number — a loading number draws a skeleton, not a glyph (objectui#12889)', () => {
  it('while the aggregate runs: the skeleton, named in the page language, and no `…`', async () => {
    const { container } = mount('zh-CN', number, pending);
    const skeleton = await screen.findByTestId('element-number-loading');
    expect(skeleton.className).toContain('animate-pulse');
    expect(skeleton.getAttribute('role')).toBe('status');
    expect(skeleton.getAttribute('aria-label')).toBe('加载中…');
    expect(container.textContent).not.toContain('…');
    expect(container.querySelector('.tabular-nums')).toBeNull();
  });

  it('CONTROL — once the aggregate answers, the number replaces the skeleton', async () => {
    const { container } = mount('zh-CN', number, empty);
    await waitFor(() => expect(container.querySelector('.tabular-nums')?.textContent).toBe('0'));
    expect(screen.queryByTestId('element-number-loading')).toBeNull();
  });
});
