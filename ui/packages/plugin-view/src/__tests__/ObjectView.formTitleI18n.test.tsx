/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectView`'s create / edit / view form title speaks the session locale —
 * objectui#3462 (the #3426 / #3459 family).
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 * `getFormTitle()` string-built the three verbs:
 *
 *     case 'view': return `View ${objectLabel}`;
 *
 * so a Chinese session whose object is labelled 联系人 read a drawer headed
 * **"View 联系人"** — an English verb glued onto a localized label. The filer
 * reproduced exactly that. All three consumers of `getFormTitle()` are visible
 * chrome: `renderDrawerForm`'s `DrawerTitle`, `renderModalForm`'s
 * `DialogTitle`, and the `title` prop handed to `NavigationOverlay` in the
 * `popover` branch (a host-supplied `title` displaces the overlay's own
 * `resolvedTitle` default, so this is the string the user sees).
 *
 * ── Why this path is user-reachable ───────────────────────────────────────
 * `object-view` / `view` are registered renderer types
 * (`packages/plugin-view/src/index.tsx`) and `navigation` is a DECLARED
 * authorable input on that registration, typed as `ViewNavigationConfig` whose
 * `mode` union includes `'drawer'`, `'modal'` and `'popover'`. `handleRowClick`
 * turns a click under any of those into `setFormMode('view')` +
 * `setIsFormOpen(true)`, and `formLayout` maps the same mode to the container
 * that renders the heading. The toolbar's create button (`handleCreate`) and the
 * grid's row-edit action (`handleEdit`) reach the other two modes. The bar is
 * even lower than #3459's split branch: `ObjectViewSchema.layout` already
 * defaults to `'drawer'`. `app-shell`'s wrapper pinning `layout: 'page'` is one
 * host overriding a registered block, not proof the branch is dead.
 *
 * ── Direction of these assertions (decided before running them) ───────────
 *   - zh / de / ja cases, all three verbs: **RED before, GREEN after.** Before
 *     the change they rendered "Create 联系人" / "Create Kontakte" etc.
 *   - **de is the load-bearing case**: German puts the verb AFTER the object
 *     ("Kontakte anzeigen"), which a `` `Verb ${label}` `` concatenation cannot
 *     produce at any value of the verb. It is the assertion that a future
 *     "just translate the verb and concatenate" regression cannot satisfy.
 *   - en cases: **GREEN before AND after.** They pin that routing the title
 *     through `t()` did not move a single byte of what an English session sees,
 *     so e2e specs and host tests addressing this chrome by its English name
 *     keep addressing it.
 *   - the `schema.form.title` override: **GREEN before AND after.** The author
 *     wrote a title, so the author's title is used — that branch is deliberately
 *     untouched and this pins it.
 *
 * The provider-less fallback is asserted in
 * `ObjectView.formTitleNoProviderFallback.test.tsx` — it cannot live in this
 * file, because `createI18n` registers its instance as react-i18next's
 * module-global default and that registration survives `cleanup()`; a
 * "no provider" render here would silently resolve against whichever locale a
 * previous test mounted.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { ObjectView } from '../ObjectView';

// Mock @object-ui/react to avoid circular dependency issues (same shape as
// ObjectView.test.tsx — the bus exports are imported at module-eval time by the
// real @object-ui/components, so a strict mock must expose them).
vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="schema-renderer" data-schema-type={schema?.type}>
        {schema?.type}
      </div>
    ),
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

// Grid stub exposing the two row affordances this test drives: a row click
// (-> formMode 'view') and the row edit action (-> formMode 'edit').
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema, onRowClick, onEdit }: any) => (
    <div data-testid="object-grid" data-object={schema?.objectName}>
      <button data-testid="grid-row" onClick={() => onRowClick?.({ id: '1', name: 'Test' })}>
        Row 1
      </button>
      <button data-testid="grid-edit" onClick={() => onEdit?.({ id: '1', name: 'Test' })}>
        Edit row 1
      </button>
    </div>
  ),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => (
    <div data-testid="object-form" data-mode={schema?.mode}>
      Form ({schema?.mode})
    </div>
  ),
}));

function dataSourceLabelled(label: string): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }], total: 1 }),
    findOne: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'contacts',
      label,
      fields: { name: { label: 'Name', type: 'text' } },
    }),
  } as unknown as DataSource;
}

function renderViewIn(
  language: string,
  label: string,
  schemaOverrides: Partial<ObjectViewSchema> = {},
) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'contacts',
          navigation: { mode: 'drawer' },
          ...schemaOverrides,
        } as never}
        dataSource={dataSourceLabelled(label)}
      />
    </I18nProvider>,
  );
}

/** Row click under drawer/modal/popover navigation -> formMode 'view'. */
const openView = () => fireEvent.click(screen.getByTestId('grid-row'));
/** Row edit action -> formMode 'edit'. */
const openEdit = () => fireEvent.click(screen.getByTestId('grid-edit'));
/**
 * Toolbar create button -> formMode 'create'. Addressed by its own localized
 * verb (`console.objectView.new`), which is deliberately NOT the title key:
 * the button says "New" / 新建 while the title says "Create" / 新建... — reusing
 * the button verb for the heading is the drift this issue's sibling warned
 * about, and naming it here keeps the two visibly separate.
 */
const openCreate = (createVerb: string) =>
  fireEvent.click(screen.getByRole('button', { name: createVerb }));

/** The object label the fixtures use, per locale. */
const LABEL = { en: 'Contacts', zh: '联系人', de: 'Kontakte', ja: '取引先' } as const;

afterEach(() => cleanup());

describe('ObjectView form title — view mode, drawer (objectui#3462)', () => {
  it('renders the English title unchanged under an en session', async () => {
    renderViewIn('en', LABEL.en);
    openView();

    await waitFor(() => expect(screen.getByText('View Contacts')).toBeInTheDocument());
  });

  it('renders the zh bundle arrangement under a zh session', async () => {
    renderViewIn('zh', LABEL.zh);
    openView();

    // The filer's exact repro: a zh drawer used to be headed "View 联系人".
    await waitFor(() => expect(screen.getByText('查看联系人')).toBeInTheDocument());
    expect(screen.queryByText('View 联系人')).toBeNull();
  });

  it('renders the de bundle arrangement — verb AFTER the label', async () => {
    renderViewIn('de', LABEL.de);
    openView();

    await waitFor(() => expect(screen.getByText('Kontakte anzeigen')).toBeInTheDocument());
    expect(screen.queryByText('View Kontakte')).toBeNull();
  });

  it('renders the ja bundle arrangement under a ja session', async () => {
    renderViewIn('ja', LABEL.ja);
    openView();

    await waitFor(() => expect(screen.getByText('取引先を表示')).toBeInTheDocument());
  });
});

describe('ObjectView form title — edit mode, drawer (objectui#3462)', () => {
  it('renders the English title unchanged under an en session', async () => {
    renderViewIn('en', LABEL.en);
    openEdit();

    await waitFor(() => expect(screen.getByText('Edit Contacts')).toBeInTheDocument());
  });

  it('renders the zh bundle arrangement under a zh session', async () => {
    renderViewIn('zh', LABEL.zh);
    openEdit();

    await waitFor(() => expect(screen.getByText('编辑联系人')).toBeInTheDocument());
    expect(screen.queryByText('Edit 联系人')).toBeNull();
  });

  it('renders the de bundle arrangement — verb AFTER the label', async () => {
    renderViewIn('de', LABEL.de);
    openEdit();

    await waitFor(() => expect(screen.getByText('Kontakte bearbeiten')).toBeInTheDocument());
    expect(screen.queryByText('Edit Kontakte')).toBeNull();
  });
});

describe('ObjectView form title — create mode, drawer (objectui#3462)', () => {
  it('renders the English title unchanged under an en session', async () => {
    renderViewIn('en', LABEL.en);
    openCreate('New');

    await waitFor(() => expect(screen.getByText('Create Contacts')).toBeInTheDocument());
  });

  it('renders the zh bundle arrangement under a zh session', async () => {
    renderViewIn('zh', LABEL.zh);
    openCreate('新建');

    await waitFor(() => expect(screen.getByText('新建联系人')).toBeInTheDocument());
    expect(screen.queryByText('Create 联系人')).toBeNull();
  });

  it('renders the de bundle arrangement — verb AFTER the label', async () => {
    renderViewIn('de', LABEL.de);
    openCreate('Neu');

    await waitFor(() => expect(screen.getByText('Kontakte erstellen')).toBeInTheDocument());
    expect(screen.queryByText('Create Kontakte')).toBeNull();
  });
});

describe('ObjectView form title — the other two consumption sites (objectui#3462)', () => {
  it('localizes the modal DialogTitle', async () => {
    renderViewIn('zh', LABEL.zh, { navigation: { mode: 'modal' } } as never);
    openView();

    await waitFor(() => expect(screen.getByText('查看联系人')).toBeInTheDocument());
    expect(screen.queryByText('View 联系人')).toBeNull();
  });

  it('localizes the title handed to NavigationOverlay in popover mode', async () => {
    renderViewIn('zh', LABEL.zh, { navigation: { mode: 'popover' } } as never);
    openView();

    await waitFor(() => expect(screen.getByText('查看联系人')).toBeInTheDocument());
    expect(screen.queryByText('View 联系人')).toBeNull();
  });
});

describe('ObjectView form title — branches that stay literal (objectui#3462)', () => {
  it('uses the authored schema.form.title verbatim, untranslated', async () => {
    renderViewIn('zh', LABEL.zh, { form: { title: 'My Own Heading' } } as never);
    openView();

    // The author wrote a title, so the author's title wins — in every locale.
    await waitFor(() => expect(screen.getByText('My Own Heading')).toBeInTheDocument());
    expect(screen.queryByText('查看联系人')).toBeNull();
  });
});
