// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29235 — a recent dashboard, page or report row reads its item by
 * name, never its type's whole list.
 *
 * `useRecentItemLabel` labelled those rows from `metadata.dashboards` (through
 * `useNavTargetLabel`), `metadata.pages` and `metadata.reports`, so a Home with
 * one such recent row downloaded the whole `/meta/dashboard`, `/meta/page` or
 * `/meta/report` list for one label. Each row now asks its own item through
 * the provider's by-name read (`useReadItemsByName`), and reads the list only
 * once something else has loaded it.
 *
 * Real subjects: `useRecentItemLabel`, `MetadataProvider` and the i18n
 * provider, over a fake adapter that records each read. What the rows print is
 * pinned beside the reads: the same text the whole list gave, in en and in
 * zh-CN (an inline locale map, and a translation bundle key), and the machine
 * name while nothing has landed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { useMetadata } from '@object-ui/react';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { useRecentItemLabel } from '../useRecentItemLabel';
import type { RecentItem } from '../../context/RecentItemsProvider';

const ITEMS: Record<string, Array<Record<string, unknown>>> = {
  dashboard: [
    { name: 'pipeline', label: 'Pipeline' },
    { name: 'other_dashboard', label: 'Other' },
  ],
  page: [
    { name: 'welcome', label: { en: 'Welcome', 'zh-CN': '欢迎' } },
    { name: 'other_page', label: 'Other page' },
  ],
  report: [
    { name: 'q3_results', label: 'Q3 Results' },
    { name: 'other_report', label: 'Other report' },
  ],
};

function makeAdapter(calls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          calls.push(type);
          return Promise.resolve({ type, items: structuredClone(ITEMS[type] ?? []) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (ITEMS[type] ?? []).find((it) => it.name === name);
          if (!item) return Promise.reject(Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND' }));
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function wrapperFor(calls: string[], language = 'en') {
  const i18n = createI18n({
    defaultLanguage: language,
    detectBrowserLanguage: false,
    resources: { 'zh-CN': { showcase: { reports: { q3_results: { label: '第三季度结果' } } } } },
  });
  const adapter = makeAdapter(calls);
  return ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      <MetadataProvider adapter={adapter}>{children}</MetadataProvider>
    </I18nProvider>
  );
}

const at = '2026-11-02T09:00:00.000Z';
const ROWS: RecentItem[] = [
  { id: 'dashboard:pipeline', type: 'dashboard', name: 'pipeline', href: '/d', visitedAt: at },
  { id: 'page:welcome', type: 'page', name: 'welcome', href: '/p', visitedAt: at },
  { id: 'report:q3_results', type: 'report', name: 'q3_results', href: '/r', visitedAt: at },
];

/** The whole-list reads of the three types. */
const listReads = (calls: string[]) => calls.filter((c) => c === 'dashboard' || c === 'page' || c === 'report');

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

afterEach(() => cleanup());

describe('recent dashboard / page / report rows read their item by name (objectstack#29235)', () => {
  it('each row asks its own item, never its type’s list, and prints what the list gave', async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapperFor(calls) });
    await waitFor(() => expect(ROWS.map((row) => result.current(row))).toEqual(['Pipeline', 'Welcome', 'Q3 Results']));
    await settle();
    expect(listReads(calls)).toEqual([]);
    expect(calls.filter((c) => c.includes('/')).sort()).toEqual(['dashboard/pipeline', 'page/welcome', 'report/q3_results']);
  });

  it('zh-CN: an inline locale map and a translation bundle key read as the list gave them', async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapperFor(calls, 'zh-CN') });
    await waitFor(() => expect(ROWS.map((row) => result.current(row))).toEqual(['Pipeline', '欢迎', '第三季度结果']));
    expect(listReads(calls)).toEqual([]);
  });

  it('the machine name until the item lands, and for an item the server does not have (asked once)', async () => {
    const calls: string[] = [];
    const gone: RecentItem = { id: 'report:gone', type: 'report', name: 'gone', href: '/r', visitedAt: at };
    const { result, rerender } = renderHook(() => useRecentItemLabel(), { wrapper: wrapperFor(calls) });
    expect(ROWS.map((row) => result.current(row))).toEqual(['pipeline', 'welcome', 'q3_results']);
    expect(result.current(gone)).toBe('gone');
    await waitFor(() => expect(result.current(ROWS[2])).toBe('Q3 Results'));
    await settle();
    rerender();
    expect(result.current(gone)).toBe('gone');
    expect(calls.filter((c) => c === 'report/gone')).toEqual(['report/gone']);
    expect(listReads(calls)).toEqual([]);
  });

  it('CONTROL: once the lists are loaded, the rows read them and ask no item', async () => {
    const calls: string[] = [];
    const { result } = renderHook(
      () => {
        const metadata = useMetadata();
        return { label: useRecentItemLabel(), metadata };
      },
      { wrapper: wrapperFor(calls) },
    );
    await act(async () => {
      await Promise.all(['dashboard', 'page', 'report'].map((type) => result.current.metadata.ensureType(type)));
    });
    await waitFor(() => expect(ROWS.map((row) => result.current.label(row))).toEqual(['Pipeline', 'Welcome', 'Q3 Results']));
    await settle();
    expect(listReads(calls).sort()).toEqual(['dashboard', 'page', 'report']);
    expect(calls.filter((c) => c.includes('/'))).toEqual([]);
  });
});
