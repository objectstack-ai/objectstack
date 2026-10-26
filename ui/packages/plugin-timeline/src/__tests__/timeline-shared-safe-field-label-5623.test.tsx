/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5623 — `ObjectTimeline` no longer hand-rolls its own
 * `useSafeObjectLabel` / `OBJECT_LABEL_FALLBACK` (a 3-member fallback cast
 * `as any`); it now calls the SHARED `useSafeFieldLabel` from `@object-ui/react`
 * (re-exported from `@object-ui/i18n`), which carries a 5-member fallback.
 *
 * The acceptance check triage named for this dedup: the timeline's one call
 * site (`fieldOptionLabel`, used to resolve the `status`/`priority` meta-chip
 * labels) must behave IDENTICALLY on the bound and unbound paths. This file
 * pins that directly against the REAL `@object-ui/react` / `@object-ui/i18n`
 * exports — no `useObjectLabel`/`useSafeFieldLabel` mock — so a future
 * regression in the shared hook's fallback shape would be caught here, not
 * just in `packages/i18n`'s own tests.
 *
 * `./renderer` is deliberately NOT mocked either: the meta-chip text is read
 * off the real `TimelineRenderer` output, the same surface an end user sees.
 *
 * NOTE ON ORDER (mirrors `ObjectChart.fieldOptionLabelRefetch.test.tsx`,
 * objectui#5587): `createI18n` registers its instance as react-i18next's
 * process-global (via `initReactI18next`), and `useTranslation` falls back to
 * that global whenever no context supplies one. `react-i18next` itself is not
 * a direct dependency of `@object-ui/plugin-timeline` (only transitively, via
 * `@object-ui/i18n`), so this file cannot import `setI18n` to detach it
 * itself — the UNBOUND case therefore runs FIRST, before any test in this
 * file has created a bound instance. A leaked instance would make it a
 * second, silent run of the bound case instead of failing.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectTimeline } from '../ObjectTimeline';

// Only `useDataScope` / `useNavigationOverlay` are stubbed — everything else
// (crucially `useSafeFieldLabel`) passes through to the real `@object-ui/react`
// module, which re-exports it straight from `@object-ui/i18n`.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

// `@object-ui/components` is deliberately left UNMOCKED: `./renderer` needs
// its real `cva`-built primitives (`TimelineItem`, `TimelineMarker`, …) to
// render the meta chip this file reads, and `NavigationOverlay` (the one
// piece `ObjectTimeline` itself imports from this package) is never invoked
// — the mocked `useNavigationOverlay` above returns `isOverlay: false`, and
// `ObjectTimeline` only renders `<NavigationOverlay>` when that flag is true.

const RAW_LABEL = 'Open';
const LOCALIZED_LABEL = 'Open (localized)';

const OBJECT_DEF = {
  fields: {
    status: { type: 'select', options: [{ value: 'open', label: RAW_LABEL }] },
  },
};

const ROWS = [{ id: '1', name: 'Item 1', date: '2024-01-01', status: 'open' }];

function makeDataSource() {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
  };
}

const SCHEMA = { type: 'object-timeline', objectName: 'lead', titleField: 'name', dateField: 'date' };

/** The status meta-chip renders as a `<span>` whose text is the resolved label. */
async function renderTimelineAndReadChip(wrap: (el: React.ReactElement) => React.ReactElement) {
  const props = { schema: SCHEMA, data: ROWS, dataSource: makeDataSource() } as unknown as React.ComponentProps<
    typeof ObjectTimeline
  >;
  render(wrap(<ObjectTimeline {...props} />));
  // The status chip only appears once `objectDef` has resolved asynchronously
  // (fetched from `dataSource.getObjectSchema`) and the field-options memo has
  // re-run — wait for its own text rather than `Item 1`, which is present from
  // the very first render.
  await waitFor(() => expect(screen.queryByText(RAW_LABEL) || screen.queryByText(LOCALIZED_LABEL)).not.toBeNull());
  return (screen.queryByText(RAW_LABEL) ?? screen.queryByText(LOCALIZED_LABEL))!.textContent;
}

describe('ObjectTimeline — fieldOptionLabel via the shared useSafeFieldLabel (objectui#5623)', () => {
  it('resolves to the raw metadata label with NO I18nProvider mounted (unbound path)', async () => {
    const label = await renderTimelineAndReadChip((el) => el);
    expect(label).toBe(RAW_LABEL);
  });

  it('resolves to the SAME raw metadata label with an I18nProvider mounted but no matching translation (bound path)', async () => {
    // A real, bound i18next instance — but its bundle has nothing under
    // `fieldOptions.lead.status.open`, so `resolve()` still falls through to
    // the fallback exactly as the unbound path does. This is the case the
    // acceptance check names: bound and unbound must be IDENTICAL for this
    // call site when there is nothing for the bound path to find either.
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    instance.addResourceBundle('en', 'translation', { crm: { objects: { lead: { label: 'Lead' } } } }, true, true);

    const label = await renderTimelineAndReadChip((el) => (
      <I18nProvider instance={instance} persistLanguage={false}>
        {el}
      </I18nProvider>
    ));
    expect(label).toBe(RAW_LABEL);
  });

  it('still resolves a REAL translation when one is bound — proving the shared hook is genuinely wired, not just harmlessly inert', async () => {
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    instance.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: { lead: { label: 'Lead' } },
          fieldOptions: { lead: { status: { open: LOCALIZED_LABEL } } },
        },
      },
      true,
      true,
    );

    const label = await renderTimelineAndReadChip((el) => (
      <I18nProvider instance={instance} persistLanguage={false}>
        {el}
      </I18nProvider>
    ));
    expect(label).toBe(LOCALIZED_LABEL);
  });
});
