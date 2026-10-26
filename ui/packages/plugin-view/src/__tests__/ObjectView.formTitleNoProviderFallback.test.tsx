/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectView`'s create / edit / view form title still resolves to ENGLISH, and
 * to the SAME BYTES as before, when no `I18nProvider` is mounted —
 * objectui#3462.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: `object-view` renders wherever its type is
 * registered, so any host that renders schema without mounting a provider (this
 * package's own tests, the preview gallery, an embedding app) reads whatever the
 * defaults map says. The English defaults live in `VIEW_DEFAULT_TRANSLATIONS`
 * (`ObjectView.tsx`) — that map is what `createSafeTranslation` falls back to
 * when its `detail.recordDetailWithLabel` probe comes back unresolved, and it is
 * what interpolates `{{object}}`.
 *
 * The byte-identity matters beyond aesthetics: the heading is `View Contacts`
 * before the change and `View Contacts` after, so e2e specs and host tests that
 * address this chrome by its English name keep addressing it.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `ObjectView.formTitleI18n.test.tsx`. A missing map entry would turn it red by
 * rendering the raw key `form.viewTitle`, which is precisely the regression it
 * exists to catch.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, every later
 * "no provider" render in that same file silently resolves against the Chinese
 * instance — a green-looking file that asserts nothing about the fallback.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DataSource } from '@object-ui/types';
import { ObjectView } from '../ObjectView';

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

function dataSourceLabelled(label?: string): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }], total: 1 }),
    findOne: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'contacts',
      ...(label ? { label } : {}),
      fields: { name: { label: 'Name', type: 'text' } },
    }),
  } as unknown as DataSource;
}

function renderView(label?: string) {
  return render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'drawer' },
      } as never}
      dataSource={dataSourceLabelled(label)}
    />,
  );
}

const openView = () => fireEvent.click(screen.getByTestId('grid-row'));
const openEdit = () => fireEvent.click(screen.getByTestId('grid-edit'));
const openCreate = () => fireEvent.click(screen.getByRole('button', { name: 'New' }));

afterEach(() => cleanup());

describe('ObjectView form title — English fallback with no provider (objectui#3462)', () => {
  it('heads a view-mode drawer "View {label}", never the raw key', async () => {
    renderView('Contacts');
    openView();

    await waitFor(() => expect(screen.getByText('View Contacts')).toBeInTheDocument());
    expect(screen.queryByText('form.viewTitle')).toBeNull();
  });

  it('heads an edit-mode drawer "Edit {label}", never the raw key', async () => {
    renderView('Contacts');
    openEdit();

    await waitFor(() => expect(screen.getByText('Edit Contacts')).toBeInTheDocument());
    expect(screen.queryByText('form.editTitle')).toBeNull();
  });

  it('heads a create-mode drawer "Create {label}", never the raw key', async () => {
    renderView('Contacts');
    openCreate();

    await waitFor(() => expect(screen.getByText('Create Contacts')).toBeInTheDocument());
    expect(screen.queryByText('form.createTitle')).toBeNull();
  });

  it('falls back to the objectName when the object declares no label', async () => {
    renderView();
    openView();

    await waitFor(() => expect(screen.getByText('View contacts')).toBeInTheDocument());
  });
});
