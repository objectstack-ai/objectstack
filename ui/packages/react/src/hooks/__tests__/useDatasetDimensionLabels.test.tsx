/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `useDatasetDimensionLabels` / `useDatasetDimensionMeta` (objectui#4389) — the
 * analytics label net's React glue, pinned at the seam where it is now stated
 * ONCE for both consuming surfaces.
 *
 * ## What these pins are for, and what they deliberately do NOT re-assert
 *
 * The RENDERED behaviour of this net is already pinned per surface, by the 39
 * assertions PR #4388 landed across
 * `plugin-dashboard/src/__tests__/DatasetWidget.*` and
 * `plugin-report/src/__tests__/DatasetReportRenderer.localSelectI18n.test.tsx`.
 * Those keep passing UNCHANGED across this refactor and are its acceptance
 * evidence; nothing here duplicates them.
 *
 * What they CANNOT state is the property that only exists now that there is one
 * hook: that both surfaces inherit the same two bug fixes from the same wiring.
 * A plugin-level pin can only ever observe its own copy — which is exactly how
 * the duplication survived long enough to be filed. So these four pins assert
 * the wiring itself:
 *
 * 1. the read rides the host's AUTHENTICATED `apiFetch` (objectui#4121);
 * 2. it degrades to the global `fetch` when no host supplies one, rather than
 *    crashing a surface rendered outside a provider;
 * 3. a NEW `apiFetch` identity re-issues the read — i.e. `apiFetch` really is
 *    IN the effect's deps, which is the half of #4121 that a "does it call
 *    apiFetch once" assertion cannot see;
 * 4. switching the language at RUNTIME re-labels in place and issues NO further
 *    metadata read — i.e. the locale really is OUT of the effect's deps, and
 *    the fetched metadata really is locale-free in state
 *    (objectui#4030 / PR #4324).
 *
 * Pin 4 is the one that would have caught the regression #4324 fixed, and it is
 * the reason the fetch and the derivation sit on opposite sides of a memo.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { SchemaRendererProvider } from '../../context/SchemaRendererContext';
import { useDatasetDimensionLabels, useDatasetDimensionMeta } from '../useDatasetDimensionLabels';

const CHANNEL_OPTIONS = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'export', label: 'Export' },
];

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: { sales_channel: { type: 'select', options: CHANNEL_OPTIONS } },
};

/**
 * The same bundle shape the #4388 surface pins use.
 *
 * `fields` is NOT decoration: `useObjectLabel`'s namespace discovery only
 * treats a top-level key as an app namespace when it carries one of
 * `objects`/`fields`/`apps`/… , so a bundle with `fieldOptions` alone is never
 * searched and every option silently falls back to its authored label.
 */
const ZH_BUNDLE = {
  zh: {
    crm: {
      fields: { crm_opportunity: { sales_channel: '销售渠道' } },
      fieldOptions: {
        crm_opportunity: { sales_channel: { domestic: '国内', export: '出口' } },
      },
    },
  },
};

/** A `GET /meta/object/:name` router that counts what it was asked for. */
function makeMetaRouter(docs: Record<string, unknown>) {
  const requested: string[] = [];
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    const name = m ? decodeURIComponent(m[1]) : '';
    requested.push(name);
    const doc = docs[name];
    if (!doc) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: doc }) };
  });
  return { fn, requested };
}

const DIMENSION_FIELDS = { sales_channel: 'sales_channel' };
const DIMENSIONS = ['sales_channel'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useDatasetDimensionMeta — the read rides the host apiFetch (objectui#4121)', () => {
  it('reads through SchemaRendererContext.apiFetch, not the bare global fetch', async () => {
    const host = makeMetaRouter({ crm_opportunity: OPPORTUNITY });
    const globalRouter = makeMetaRouter({ crm_opportunity: OPPORTUNITY });
    global.fetch = globalRouter.fn as any;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SchemaRendererProvider dataSource={null as any} apiFetch={host.fn as any}>
        {children}
      </SchemaRendererProvider>
    );

    const { result } = renderHook(
      () => useDatasetDimensionMeta('crm_opportunity', DIMENSION_FIELDS, DIMENSIONS),
      { wrapper },
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(host.requested).toEqual(['crm_opportunity']);
    // The load must NOT have leaked onto the unauthenticated global channel.
    expect(globalRouter.fn).not.toHaveBeenCalled();
    expect(result.current?.metaByPath['sales_channel']?.object).toBe('crm_opportunity');
    expect(result.current?.metaByPath['sales_channel']?.options).toEqual(CHANNEL_OPTIONS);
  });

  it('falls back to the global fetch when no host supplies apiFetch', async () => {
    const globalRouter = makeMetaRouter({ crm_opportunity: OPPORTUNITY });
    global.fetch = globalRouter.fn as any;

    // No provider at all — the surface must degrade, not crash. (This is why
    // the context is read directly rather than via a throwing useSchemaContext.)
    const { result } = renderHook(() =>
      useDatasetDimensionMeta('crm_opportunity', DIMENSION_FIELDS, DIMENSIONS),
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(globalRouter.requested).toEqual(['crm_opportunity']);
  });

  it('re-issues the read when apiFetch changes identity — apiFetch IS in the deps', async () => {
    const first = makeMetaRouter({ crm_opportunity: OPPORTUNITY });
    const second = makeMetaRouter({ crm_opportunity: OPPORTUNITY });

    // Rendered as a real tree rather than via `renderHook`'s wrapper: the
    // wrapper receives ONLY `children`, never `initialProps`, so a
    // provider-prop-driven rerender cannot be expressed through it. The varying
    // input here IS the provider's `apiFetch`, so the provider has to be the
    // thing that rerenders.
    const Probe = () => {
      const meta = useDatasetDimensionMeta('crm_opportunity', DIMENSION_FIELDS, DIMENSIONS);
      return <div data-testid="probe">{meta ? 'resolved' : 'pending'}</div>;
    };
    const treeWith = (apiFetch: unknown) => (
      <SchemaRendererProvider dataSource={null as any} apiFetch={apiFetch as any}>
        <Probe />
      </SchemaRendererProvider>
    );

    const { rerender, getByTestId } = render(treeWith(first.fn));

    await waitFor(() => expect(getByTestId('probe').textContent).toBe('resolved'));
    expect(first.requested).toEqual(['crm_opportunity']);

    rerender(treeWith(second.fn));

    // THE PIN: a new channel re-reads. `apiFetch` missing from the deps would
    // leave this at [] forever — the half of objectui#4121 that "was apiFetch
    // called at least once" cannot see.
    await waitFor(() => expect(second.requested).toEqual(['crm_opportunity']));
    // The first channel is not re-read.
    expect(first.requested).toEqual(['crm_opportunity']);
  });
});

describe('useDatasetDimensionLabels — the metadata stays locale-free (objectui#4030 / PR #4324)', () => {
  it('re-labels in place on a runtime language switch, with NO second metadata read', async () => {
    const host = makeMetaRouter({ crm_opportunity: OPPORTUNITY });
    const i18n = createI18n({
      defaultLanguage: 'en',
      detectBrowserLanguage: false,
      resources: ZH_BUNDLE,
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider instance={i18n}>
        <SchemaRendererProvider dataSource={null as any} apiFetch={host.fn as any}>
          {children}
        </SchemaRendererProvider>
      </I18nProvider>
    );

    const { result } = renderHook(
      () => useDatasetDimensionLabels('crm_opportunity', DIMENSION_FIELDS, DIMENSIONS),
      { wrapper },
    );

    // Under `en` the map is the PRE-#4030 value → authored-label map: the net's
    // original job (objectui#4053) with no translation layered on. Waiting for
    // this settled shape — rather than for the fetch alone — is what makes the
    // "no second read" assertion below meaningful; asserting before the state
    // lands would pass for the wrong reason.
    await waitFor(() =>
      expect(result.current?.sales_channel).toEqual({ domestic: 'Domestic', export: 'Export' }),
    );
    expect(host.requested).toEqual(['crm_opportunity']);

    await act(async () => {
      await i18n.changeLanguage('zh');
    });

    // The maps gain the translation — derived in the render memo from metadata
    // ALREADY in state, keyed BOTH by the stored value and by the authored
    // label, so a row arrives relabeled whichever spelling the server sent.
    await waitFor(() =>
      expect(result.current?.sales_channel).toEqual({
        domestic: '国内',
        Domestic: '国内',
        export: '出口',
        Export: '出口',
      }),
    );

    // THE PIN: the language switch issued no further metadata read. A locale in
    // the effect's deps would show up here as a second `crm_opportunity`.
    expect(host.requested).toEqual(['crm_opportunity']);
  });
});
