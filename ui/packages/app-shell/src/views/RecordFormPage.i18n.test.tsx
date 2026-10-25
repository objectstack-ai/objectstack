/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordFormPage — every user-visible string comes from the locale packs
 * (objectui#3469).
 *
 * The page used to hand i18next an inline `defaultValue` on nearly every
 * `t()` call. Those branches were unreachable: all ten packs define the keys
 * and `all-locales-key-parity.test.ts` pins that permanently, so i18next
 * always resolved the pack value. What the defaults DID do is carry a second,
 * unwatched English spelling — `form.createTitle`'s default read
 * `New {object}` while the pack says `Create {{object}}`. The day the key was
 * renamed or dropped, the page title would have silently changed verb with
 * every test still green. #3469 deleted them (declared = enforced), leaving
 * exactly one deliberate exception — `form.createTargetOrg`, the only key the
 * packs genuinely lacked. #3517 backfilled it into all ten, deleted that last
 * default, and inverted the exception's pin (final describe below), so the
 * rule now holds for every `t()` on the page with no carve-out.
 *
 * Direction note — a "put the deleted limb back and watch this go red"
 * reverse-verification is IMPOSSIBLE for this change, by construction: with
 * the key present in the pack, i18next never consults `defaultValue`, so
 * restoring `defaultValue: \`New ${label}\`` leaves every assertion here
 * green. That is precisely the defect the issue reported (a dead branch no
 * test could see). What this file pins instead is the invariant the deletion
 * buys:
 *
 *   1. the rendered copy IS the pack copy (asserted in two locales, so a
 *      hardcoded English default could not satisfy it), and
 *   2. every key the page now passes bare is really defined in all ten packs
 *      — so removing one turns this file red instead of silently swapping the
 *      title's verb.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { toastSuccess, formSchemas, getAuthConfig, authState } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  formSchemas: [] as any[],
  getAuthConfig: vi.fn(async () => ({ features: {} as Record<string, unknown> })),
  authState: { activeOrganization: null as { name: string } | null },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig,
    get activeOrganization() {
      return authState.activeOrganization;
    },
  }),
}));

// Stand-in for the real form: records the schema the page builds (so the
// `submitText` / `cancelText` it translates are observable) and exposes a
// button that fires `onSuccess`, which is what raises the toast under test.
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => {
    formSchemas.push(schema);
    return h(
      'div',
      { 'data-testid': 'object-form' },
      h('span', { 'data-testid': 'submit-text' }, schema.submitText),
      h('span', { 'data-testid': 'cancel-text' }, schema.cancelText),
      h(
        'button',
        { type: 'button', 'data-testid': 'fire-success', onClick: () => schema.onSuccess?.() },
        'ok',
      ),
    );
  },
}));

const metadataState = {
  objects: [] as any[],
  loading: false,
};
vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

/** Object whose `label` is what `useObjectLabel` falls back to (no app namespace loaded). */
const CONTACTS = {
  name: 'contacts',
  label: 'Contacts',
  fields: { name: { type: 'text' }, organization_id: { type: 'lookup' } },
};

function renderPage(
  mode: 'create' | 'edit',
  { language = 'en' }: { language?: string } = {},
) {
  const path =
    mode === 'create'
      ? '/apps/crm/contacts/new'
      : '/apps/crm/contacts/record/r1/edit';
  const route =
    mode === 'create'
      ? '/apps/:appName/:objectName/new'
      : '/apps/:appName/:objectName/record/:recordId/edit';

  return render(
    // `children` rides in the PROPS object: `I18nProviderProps` declares it
    // required, and `createElement`'s third-argument form does not satisfy that
    // overload (objectui#4040, same fix as packages/react's tranche).
    h(I18nProvider, {
      config: { defaultLanguage: language, detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: [path] },
        h(
          Routes,
          null,
          h(Route, { path: route, element: h(RecordFormPage, { mode }) }),
        ),
      ),
    }),
  );
}

const title = () => screen.getByTestId('record-form-page-title').textContent;

beforeEach(() => {
  metadataState.objects = [CONTACTS];
  metadataState.loading = false;
  authState.activeOrganization = null;
  getAuthConfig.mockResolvedValue({ features: {} });
  formSchemas.length = 0;
  toastSuccess.mockClear();
});
afterEach(cleanup);

describe('RecordFormPage title resolves from the locale packs (#3469)', () => {
  it('create mode renders the pack spelling "Create X" — never the deleted "New X" default', () => {
    renderPage('create');
    expect(title()).toBe('Create Contacts');
    // The verb the removed inline `defaultValue` carried. It never rendered
    // before this change either; asserting its absence is what makes a
    // re-introduced second spelling visible.
    expect(screen.queryByText('New Contacts')).not.toBeInTheDocument();
  });

  it('edit mode renders the pack spelling "Edit X"', () => {
    renderPage('edit');
    expect(title()).toBe('Edit Contacts');
  });

  it('follows the active locale — a hardcoded English default could not produce this', () => {
    // The strongest available proof that the PACK drives the title: under `zh`
    // the title is Chinese. No inline English `defaultValue` can satisfy this
    // assertion, so it fails loudly if the packs ever stop being consulted.
    renderPage('create', { language: 'zh' });
    expect(title()).toBe(String(builtInLocales.zh.form.createTitle).replace('{{object}}', 'Contacts'));
    expect(title()).toBe('新建Contacts');
  });
});

describe('RecordFormPage success toasts resolve from the locale packs (#3469)', () => {
  it('create mode raises the pack `form.createSuccess`', async () => {
    renderPage('create');
    fireEvent.click(screen.getByTestId('fire-success'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Contacts created successfully');
  });

  it('edit mode raises the pack `form.updateSuccess`', async () => {
    renderPage('edit');
    fireEvent.click(screen.getByTestId('fire-success'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Contacts updated successfully');
  });
});

describe('RecordFormPage chrome copy resolves from the locale packs (#3469)', () => {
  it('form buttons and the back control read their pack values', () => {
    renderPage('create');
    expect(screen.getByTestId('submit-text')).toHaveTextContent('Save');
    expect(screen.getByTestId('cancel-text')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('record-form-page-back')).toHaveAttribute('aria-label', 'Back');
  });
});

describe('the keys RecordFormPage passes bare are defined in every pack (#3469)', () => {
  // This is the guard the deleted `defaultValue`s used to suppress. Before
  // #3469, dropping `form.createTitle` from the packs changed the page title
  // from "Create X" to "New X" with the whole suite still green. Now a missing
  // key would put the raw key on screen — and turns this red first.
  const BARE_KEYS = [
    'form.createTitle',
    'form.editTitle',
    'form.createSuccess',
    'form.updateSuccess',
    'form.saveRecord',
    // Joined this list in #3517. It was the file's one exception — defined in
    // NO pack, not even `en` — until the backfill; the describe below pins the
    // rendered badge now that it resolves like every other key here.
    'form.createTargetOrg',
    'common.back',
    'common.cancel',
  ] as const;

  const at = (pack: unknown, dotted: string) =>
    dotted.split('.').reduce<any>((n, p) => n?.[p], pack);

  it.each(BARE_KEYS)('%s is a string in all ten packs', (key) => {
    const missing = Object.entries(builtInLocales)
      .filter(([, pack]) => typeof at(pack, key) !== 'string')
      .map(([lang]) => lang);
    expect(missing, `${key} missing from: ${missing.join(', ')}`).toEqual([]);
  });

  it('the comparison really covers ten packs', () => {
    expect(Object.keys(builtInLocales)).toHaveLength(10);
  });
});

describe('the ADR-0105 write-target badge resolves from the locale packs (#3517)', () => {
  // This describe used to pin the OPPOSITE fact. `form.createTargetOrg` was
  // the file's one load-bearing `defaultValue`: defined in NO pack — not even
  // `en` — so i18next genuinely missed and the inline default rendered, which
  // is why the badge read English `Creates in <org>` in all ten locales
  // (#3517). #3469 kept that default deliberately and left an assertion here
  // that would go red the moment any pack defined the key, instructing the
  // backfill to delete it. The backfill landed, so the assertion has served
  // its purpose and inverts: the key is now an ordinary member of BARE_KEYS
  // above (pinned present in all ten packs) and what needs pinning is that the
  // BADGE reads the pack copy.
  const badgeIn = async (language: string) => {
    authState.activeOrganization = { name: 'Acme Inc' };
    getAuthConfig.mockResolvedValue({ features: { tenancyPosture: 'group' } });
    renderPage('create', { language });
    return screen.findByTestId('record-form-write-target-org');
  };

  it('renders the en pack copy, never a raw key', async () => {
    const badge = await badgeIn('en');
    expect(badge).toHaveTextContent('Creates in Acme Inc');
    // A missing key would surface the key itself — the failure mode the
    // deleted `defaultValue` used to hide.
    expect(badge).not.toHaveTextContent('form.createTargetOrg');
  });

  it('follows the active locale — the deleted English default could not produce this', async () => {
    // Same proof the title describe uses, and the point of the whole issue:
    // under `zh` the badge is Chinese. The removed default was a hardcoded
    // `Creates in ${org}`, so it could never satisfy this assertion — if the
    // packs ever stop driving this badge, it fails loudly instead of quietly
    // reverting to English.
    const badge = await badgeIn('zh');
    expect(badge).toHaveTextContent(
      String(builtInLocales.zh.form.createTargetOrg).replace('{{org}}', 'Acme Inc'),
    );
    expect(badge).toHaveTextContent('创建到Acme Inc');
  });
});
