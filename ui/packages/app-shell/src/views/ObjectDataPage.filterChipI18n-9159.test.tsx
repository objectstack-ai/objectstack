/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9159 round 2 — the is-null filter chip is drawn from the locale
 * packs, like every other user-visible string on this page.
 *
 * The operator landed with its chip text finished inside `groupFilterChips` as
 * the literal `'is null'`. That breaks two rules at once and "make it English"
 * answers only the first: a user-facing literal in a renderer is unlocalized for
 * every reader on every locale, and the defect survives verbatim in whatever
 * language it was written in. So the grouper now hands out the filter builder's
 * existing operator key and this page resolves it at the same half-chip seam
 * that already draws the field name through `fieldLabel`.
 *
 * ## Why this file renders the page instead of asserting the key
 *
 * A test on the grouper's return value can only pin that a key is handed OUT
 * (`drillUrlFilters.test.ts` does that). It stays green if the render site never
 * calls `t` — which is the whole defect, one layer down. So the observation
 * point is the DOM of the real page, under a real `I18nProvider`, and the
 * assertion is on the chip's own text node reached through the remove button
 * beside it rather than on the chip row's whole `textContent`, which also holds
 * the "Filtered by" lead-in and the translated field name.
 *
 * ## Why a NON-English locale, and what each control rules out
 *
 * English cannot tell the two worlds apart: a hardcoded `'is null'` and a
 * correctly resolved `en` pack value render the same pixels. Under `zh` they
 * differ, so the assertion has the power to fail for the reason it exists. The
 * controls below rule out the two ways this could pass vacuously — the packs
 * agreeing (they are asserted to differ, live) and the key failing to resolve
 * (i18next would render the key itself, so the text is asserted not to contain
 * the key's own prefix). ⇒ a pack that loses this key is VISIBLE here rather
 * than silently falling back to English.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

// Heavy children, all orthogonal to the chip row under test and each dragging in
// a plugin bundle — the same posture as the sibling create-affordance test on
// this page.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ObjectDataPage } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { NULL_FILTER, EMPTY_FILTER } from './drillUrlFilters';

const h = React.createElement;
const OBJECT_NAME = 'showcase_invoice';
const FIELD = 'owner';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Invoice',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      owner: { type: 'text', label: 'Owner' },
    },
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** What the pack itself says this operator is called, in one language. */
function packLabel(language: string): unknown {
  const pack = (builtInLocales as Record<string, any>)[language];
  return NULL_FILTER.labelKey.split('.').reduce<any>((node, part) => node?.[part], pack);
}

/**
 * Render the page at one `filter[...]` query string, in one language.
 *
 * `children` rides in the PROPS object rather than in `createElement`'s third
 * argument: both providers declare it required, and the third-argument overload
 * does not satisfy that (objectui#4040, the same fix the sibling i18n render
 * tests carry).
 */
function renderAt(language: string, search: string) {
  const page = h(
    MemoryRouter,
    { initialEntries: [`/apps/demo/${OBJECT_NAME}/data?${search}`] },
    h(
      Routes,
      null,
      h(Route, {
        path: '/apps/:appName/:objectName/data',
        element: h(ObjectDataPage, { dataSource: makeDataSource(), objects: OBJECTS }),
      }),
    ),
  );
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: language, detectBrowserLanguage: false },
      children: h(ExpressionProvider, {
        user: { id: 'u1', name: 'Ada', profile: 'admin' },
        children: page,
      }),
    }),
  );
}

/** The empty-bucket drill's own query string, spelled from the contract. */
const EMPTY_BUCKET_SEARCH = `filter[${FIELD}][${NULL_FILTER.param}]=${NULL_FILTER.flag}`;

/**
 * The chip's operator half. Reached through the remove button that sits beside
 * it, so this cannot drift onto the field-name half or the row's lead-in.
 */
function chipOperatorText(): string {
  const remove = document.querySelector(`[data-testid="object-data-remove-filter-${FIELD}"]`);
  expect(remove, 'the empty-bucket chip did not render at all').toBeTruthy();
  return remove!.previousElementSibling?.textContent ?? '';
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the is-null filter chip is translated (objectui#9159)', () => {
  it('renders the zh pack copy, not an English literal', () => {
    renderAt('zh', EMPTY_BUCKET_SEARCH);
    const rendered = chipOperatorText();

    // The rendered copy IS the pack copy. Read from the pack rather than
    // written out here: this card owns whether the chip is TRANSLATED, while
    // the wording of the operator label belongs to the catalogue and to the
    // filter builder that shares this key.
    expect(rendered).toBe(packLabel('zh'));
    // A key that failed to resolve renders as itself — the exact user-visible
    // symptom the filter-builder operator family's locale-parity pin names.
    expect(rendered).not.toContain('filterBuilder.operators');
    // And the two defects this arm replaced, neither of which can come back
    // through a pack: the bare comparand, and the deleted English literal.
    expect(rendered).not.toContain('true');
    expect(rendered).not.toBe('is null');
  });

  it('CONTROL: the English pack renders too, and the two packs really differ', () => {
    // Without this pair the zh assertion could pass on a page that never called
    // `t` at all, if the packs happened to agree.
    renderAt('en', EMPTY_BUCKET_SEARCH);
    expect(chipOperatorText()).toBe(packLabel('en'));
    expect(packLabel('zh')).not.toBe(packLabel('en'));
  });

  it('CONTROL: an equality chip is NOT translated, because its text is the user\'s own comparand', () => {
    // The other half of the split: a comparand has no catalogue entry and must
    // reach the DOM verbatim in every locale. A change that routed every chip
    // through `t` would turn this red.
    renderAt('zh', `filter[${FIELD}]=alice`);
    expect(chipOperatorText()).toBe('= alice');
  });
});

/**
 * objectui#11547 — the "is empty" pair's chips, through the same real page and
 * the same real packs. The arm hands out the filter builder's existing
 * `is_empty` / `is_not_empty` keys; a key that did not resolve would render as
 * itself, and a shared key would draw both directions with one label.
 */
describe('the is-empty filter chips are translated (objectui#11547)', () => {
  /** What the pack itself calls one operator, in one language. */
  const packLabelOf = (language: string, key: string): unknown =>
    key.split('.').reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      (builtInLocales as Record<string, unknown>)[language],
    );

  it.each([
    [EMPTY_FILTER.flag, EMPTY_FILTER.labelKey],
    [EMPTY_FILTER.notFlag, EMPTY_FILTER.notLabelKey],
  ])('`[empty]=%s` renders the zh pack copy of `%s`', (flag, key) => {
    renderAt('zh', `filter[${FIELD}][${EMPTY_FILTER.param}]=${flag}`);
    const rendered = chipOperatorText();
    expect(rendered).toBe(packLabelOf('zh', key));
    expect(rendered).not.toContain('filterBuilder.operators');
    expect(rendered).not.toContain('true');
    expect(rendered).not.toContain('false');
  });

  it('CONTROL: the en pack renders too, the packs differ, and the two directions differ', () => {
    renderAt('en', `filter[${FIELD}][${EMPTY_FILTER.param}]=${EMPTY_FILTER.flag}`);
    expect(chipOperatorText()).toBe(packLabelOf('en', EMPTY_FILTER.labelKey));
    expect(packLabelOf('zh', EMPTY_FILTER.labelKey)).not.toBe(packLabelOf('en', EMPTY_FILTER.labelKey));
    expect(packLabelOf('zh', EMPTY_FILTER.notLabelKey)).not.toBe(packLabelOf('zh', EMPTY_FILTER.labelKey));
    // And neither is the is-null label: "is empty" is a different question.
    expect(packLabelOf('zh', EMPTY_FILTER.labelKey)).not.toBe(packLabelOf('zh', NULL_FILTER.labelKey));
  });
});
