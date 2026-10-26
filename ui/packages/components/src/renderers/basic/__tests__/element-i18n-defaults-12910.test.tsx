/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The `element:*` blocks registered from `renderers/basic` draw their defaults
 * in the page's language (objectui#12910, the close-out of objectui#12889).
 *
 * Before: `element:record_picker` printed "Select a record…", "Loading…",
 * "Failed to load", "No records" and its unresolved-view panel title as English
 * literals; `element:number` printed "aggregate failed" and its own panel
 * title; `element:definition-list` printed "No details"; `element:image`
 * printed "no image source"; and every line of `element:metadata_viewer` was
 * English. Each now reads the bundle, and an authored value still wins.
 *
 * Rendered through the real `SchemaRenderer` (or the registry, for the
 * metadata viewer) under a mounted `I18nProvider` set to zh-CN. The sibling
 * file `element-english-defaults-census-12910.test.ts` keeps the literals from
 * coming back.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, MetadataCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

function inLanguage(language: string, children: React.ReactNode) {
  return (
    <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {children}
    </I18nProvider>
  );
}

function mount(node: Record<string, unknown>, adapter: unknown, language = 'zh-CN') {
  return render(
    inLanguage(
      language,
      <AdapterCtx.Provider value={adapter as never}>
        <SchemaRenderer schema={node as never} />
      </AdapterCtx.Provider>,
    ),
  );
}

const pending = () => new Promise<never>(() => {});

/** Latin letters: none of these zh-CN states carries one, chips aside. */
const LATIN = /[A-Za-z]/;

// ── element:record_picker ────────────────────────────────────────────────────

const picker = (properties: Record<string, unknown> = {}, dataSource: Record<string, unknown> = { object: 'account' }) => ({
  type: 'element:record_picker',
  id: 'picker',
  dataSource,
  properties,
});

const trigger = (container: HTMLElement) =>
  container.querySelector('[data-testid="record-picker-trigger"]')?.textContent ?? '';

/** The empty-state line under the control (the only `p.text-xs` the block draws). */
const emptyLine = (container: HTMLElement) => container.querySelector('[data-testid="record-picker"] p.text-xs');

describe('element:record_picker — defaults read the bundle (objectui#12910)', () => {
  it('a pending read shows the zh loading placeholder', async () => {
    const { container } = mount(picker(), { find: vi.fn(pending) });
    await waitFor(() => expect(trigger(container)).toBe('加载中…'));
  });

  it('a rejection shows the zh error placeholder, also when it carries no message', async () => {
    const { container } = mount(picker(), { find: vi.fn(async () => Promise.reject({})) });
    await waitFor(() => expect(trigger(container)).toBe('无法加载记录'));
    // A failed read is not an empty one: no empty-state line.
    expect(emptyLine(container)).toBeNull();
  });

  it('an empty answer shows the zh placeholder and the zh empty line', async () => {
    const { container } = mount(picker(), { find: vi.fn(async () => ({ data: [] })) });
    await waitFor(() => expect(emptyLine(container)?.textContent).toBe('暂无数据'));
    expect(trigger(container)).toBe('选择记录');
    expect(LATIN.test(container.textContent ?? '')).toBe(false);
  });

  it('an unresolvable `view` draws the zh panel title', async () => {
    const adapter = {
      find: vi.fn(async () => ({ data: [] })),
      getObjectSchema: vi.fn(async () => ({ name: 'account', fields: {}, listViews: {} })),
    };
    const { container } = mount(picker({}, { object: 'account', view: 'nope' }), adapter);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-picker-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="record-picker-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此记录选择器的数据源',
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('CONTROL: under en the same defaults read the en pack', async () => {
    const { container } = mount(picker(), { find: vi.fn(async () => ({ data: [] })) }, 'en');
    await waitFor(() => expect(emptyLine(container)?.textContent).toBe('No data'));
    expect(trigger(container)).toBe('Select record');
  });

  // H3: the default is applied BEFORE `pickLocalized`, so every authored arm wins.
  describe('an authored value still wins, under zh-CN', () => {
    const empty = { find: vi.fn(async () => ({ data: [] })) };

    it.each([
      ['a plain string', 'Nothing here', 'Nothing here'],
      ['an inline locale map', { en: 'None', 'zh-CN': '无' }, '无'],
      ['an empty string', '', ''],
    ])('emptyText as %s', async (_arm, emptyText, shown) => {
      const { container } = mount(picker({ emptyText }), empty);
      await waitFor(() => expect(emptyLine(container)).not.toBeNull());
      expect(emptyLine(container)?.textContent).toBe(shown);
    });

    it.each([
      ['a plain string', 'Pick one', 'Pick one'],
      ['an inline locale map', { en: 'Owner', 'zh-CN': '负责人' }, '负责人'],
      ['an empty string', '', ''],
    ])('placeholder as %s', async (_arm, placeholder, shown) => {
      const { container } = mount(picker({ placeholder }), empty);
      await waitFor(() => expect(emptyLine(container)).not.toBeNull());
      expect(trigger(container)).toBe(shown);
    });
  });
});

// ── element:number ───────────────────────────────────────────────────────────

const number = (dataSource: Record<string, unknown> = { object: 'contact' }) => ({
  type: 'element:number',
  id: 'metric',
  dataSource,
  properties: { aggregate: 'count' },
});

describe('element:number — the error path reads the bundle (objectui#12910)', () => {
  it('a rejection with no message shows the zh error line', async () => {
    const { container } = mount(number(), { aggregate: vi.fn(async () => Promise.reject({})) });
    const line = await screen.findByTestId('element-number-error');
    expect(line.textContent).toBe('发生未知错误。');
    expect(container.textContent).not.toContain('aggregate failed');
  });

  it('CONTROL: a thrown message is still shown as thrown', async () => {
    mount(number(), { aggregate: vi.fn(async () => Promise.reject(new Error('quota exceeded'))) });
    expect((await screen.findByTestId('element-number-error')).textContent).toBe('quota exceeded');
  });

  it('an unresolvable `view` draws the zh panel title', async () => {
    const adapter = {
      aggregate: vi.fn(async () => [{ count: 1 }]),
      getObjectSchema: vi.fn(async () => ({ name: 'contact', fields: {}, listViews: {} })),
    };
    const { container } = mount(number({ object: 'contact', view: 'nope' }), adapter);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="element-number-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="element-number-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此指标的数据源',
    );
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });
});

// ── element:definition-list ──────────────────────────────────────────────────

describe('element:definition-list — the empty state reads the bundle (objectui#12910)', () => {
  it('no items shows the zh empty line', () => {
    mount({ type: 'element:definition-list', properties: { items: [] } }, null);
    expect(screen.getByTestId('definition-list-empty').textContent).toBe('暂无数据');
  });

  it('CONTROL: items still render as rows', () => {
    mount({ type: 'element:definition-list', properties: { items: [{ term: '状态', description: '进行中' }] } }, null);
    expect(screen.queryByTestId('definition-list-empty')).toBeNull();
    expect(screen.getByTestId('definition-list').textContent).toContain('进行中');
  });
});

// ── element:image ────────────────────────────────────────────────────────────

describe('element:image — the no-source placeholder reads the bundle (objectui#12910)', () => {
  it('no `src` shows the zh placeholder', () => {
    mount({ type: 'element:image', properties: {} }, null);
    expect(screen.getByTestId('element-image-no-source').textContent).toBe('无图片来源');
  });

  it('CONTROL: an authored `src` draws the image, not the placeholder', () => {
    const { container } = mount({ type: 'element:image', properties: { src: '/a.png', alt: '图' } }, null);
    expect(screen.queryByTestId('element-image-no-source')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('图');
  });
});

// ── element:metadata_viewer ──────────────────────────────────────────────────

function metaCtx(getItem: (type: string, name: string) => Promise<unknown>) {
  return {
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem, getItemsByType: () => [], getTypeStatus: () => 'ready' as const,
  };
}

function viewer(properties: Record<string, unknown>, getItem: (type: string, name: string) => Promise<unknown>) {
  const C = ComponentRegistry.get('element:metadata_viewer') as React.ComponentType<{ schema: unknown }>;
  if (!C) throw new Error('element:metadata_viewer is not registered');
  return render(
    inLanguage(
      'zh-CN',
      <MetadataCtx.Provider value={metaCtx(getItem) as never}>
        <C schema={{ type: 'element:metadata_viewer', properties }} />
      </MetadataCtx.Provider>,
    ),
  );
}

/** The block's text with every `<code>` chip (an identifier, not copy) removed. */
function copyOf(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('code').forEach((c) => c.remove());
  return clone.textContent ?? '';
}

const chips = (container: HTMLElement) => [...container.querySelectorAll('code')].map((c) => c.textContent);

const TASK = {
  name: 'task',
  fields: { status: { type: 'select', options: [{ value: 'open', label: '打开', default: true }, { value: 'done', label: '完成' }] } },
  validations: [{ type: 'state_machine', name: 'status_flow', field: 'status', transitions: { open: ['done'], done: [] } }],
};

describe('element:metadata_viewer — every line reads the bundle (objectui#12910)', () => {
  it('a state machine draws zh chrome, with the object and field as chips', async () => {
    const { container } = viewer({ type: 'state_machine', object: 'task' }, async () => TASK);
    await waitFor(() => expect(container.textContent).toContain('初始'));
    const text = copyOf(container);
    expect(text).toContain('状态机');
    expect(text).toContain('的生命周期');
    expect(text).toContain('终态');
    expect(chips(container)).toEqual(['task', 'status']);
    // The rule's `name` is authored data and wins over the default title.
    expect(text.replace('status_flow', '')).not.toMatch(LATIN);
  });

  it('a missing state machine says so in zh, the object a chip', async () => {
    const { container } = viewer({ type: 'state_machine', object: 'task', name: 'nope' }, async () => ({ ...TASK, validations: [] }));
    await waitFor(() => expect(copyOf(container)).toContain('上没有名为“nope”的状态机。'));
    expect(chips(container)).toEqual(['task']);
  });

  it('a flow draws its zh counts, with hidden technical steps', async () => {
    const flow = { name: 'f', label: '审批', nodes: [{ id: 'a', label: '开始' }, { id: 'b', type: 'script', label: '脚本' }] };
    const { container } = viewer({ type: 'flow', name: 'f' }, async () => flow);
    await waitFor(() => expect(container.textContent).toContain('步骤：2'));
    expect(copyOf(container)).toContain('已隐藏技术步骤：1');
    expect(chips(container)).toEqual(['detail: technical']);
  });

  it('a permission set draws its zh header and count', async () => {
    const perm = { name: 'p', label: '销售', objects: { account: { allowRead: true } } };
    const { container } = viewer({ type: 'permission', name: 'p' }, async () => perm);
    await waitFor(() => expect(container.querySelector('th')?.textContent).toBe('对象'));
    expect(copyOf(container)).toContain('对象访问：1');
  });

  it.each([
    ['a missing key', { type: 'flow' }, '此视图缺少 。', ['name']],
    ['a load that never settles', { type: 'flow', name: 'f' }, '正在加载 …', ['f']],
    ['an unknown type', { type: 'chart' }, '未知的元数据视图类型“chart”。应为 、 或 。', ['state_machine', 'flow', 'permission']],
  ])('%s says so in zh, its identifiers as chips', async (_state, properties, copy, chipList) => {
    const { container } = viewer(properties, pending);
    await waitFor(() => expect(copyOf(container)).toBe(copy));
    expect(chips(container)).toEqual(chipList);
  });

  it('a name the store does not hold says not found in zh', async () => {
    const { container } = viewer({ type: 'permission', name: 'p' }, async () => null);
    await waitFor(() => expect(copyOf(container)).toBe('未找到 。'));
    expect(chips(container)).toEqual(['p']);
  });
});
