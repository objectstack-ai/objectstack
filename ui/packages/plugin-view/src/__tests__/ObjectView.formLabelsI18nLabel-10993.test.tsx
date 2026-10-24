/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectView`'s form heading resolves the `form` slot's `title` and
 * `description` as `I18nLabel` (objectui#10993).
 *
 * `ObjectViewSchema.form` is `ObjectFormSchema`'s slot keys, so when
 * objectui#10993 widened `ObjectFormSchema.title` / `.description` (and the zod
 * mirror's) to the spec's `I18nLabel`, the `object-view` node's `form.title` /
 * `form.description` widened with them. `ObjectView` draws its own drawer and
 * modal header around the form and read both raw: `getFormTitle()` returned
 * `schema.form.title` as the header's text, and `form.description` went into
 * the header as a React child, so a per-locale map was an object child there.
 * Both now resolve with `pickLocalized` against the UI language
 * (`useObjectTranslation().language`), the language `ObjectForm` resolves the
 * same form's buttons against.
 *
 * The harness is `ObjectView.formTitleI18n.test.tsx`'s: `ObjectForm` and the
 * grid are stubbed, and a row click opens the form in view mode. Every map lists
 * `en` FIRST, so an `en` or first-entry fallback fails the row. The plain-string
 * row is the control, and the authored-title override that file pins
 * ("uses the authored schema.form.title verbatim") is untouched.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ObjectView } from '../ObjectView';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: { schema?: { type?: string } }) => (
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
  ObjectGrid: ({
    schema,
    onRowClick,
  }: {
    schema?: { objectName?: string };
    onRowClick?: (row: Record<string, unknown>) => void;
  }) => (
    <div data-testid="object-grid" data-object={schema?.objectName}>
      <button data-testid="grid-row" onClick={() => onRowClick?.({ id: '1', name: 'Test' })}>
        Row 1
      </button>
    </div>
  ),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema?: { mode?: string } }) => (
    <div data-testid="object-form" data-mode={schema?.mode}>
      Form ({schema?.mode})
    </div>
  ),
}));

function makeDataSource(): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }], total: 1 }),
    findOne: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'contacts',
      label: '联系人',
      fields: { name: { label: 'Name', type: 'text' } },
    }),
  } as unknown as DataSource;
}

/** `en` first on purpose — see the file header. */
const TITLE_MAP = { en: 'Contact card', 'zh-CN': '联系人卡片' };
const DESCRIPTION_MAP = { en: 'Who to call', 'zh-CN': '联系谁' };

const node = (mode: 'drawer' | 'modal', form: Record<string, unknown>) => ({
  type: 'object-view',
  objectName: 'contacts',
  navigation: { mode },
  form,
});

function renderView(mode: 'drawer' | 'modal', form: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <ObjectView schema={node(mode, form) as unknown as ObjectViewSchema} dataSource={makeDataSource()} />
    </I18nProvider>,
  );
}

const openView = () => fireEvent.click(screen.getByTestId('grid-row'));

afterEach(() => cleanup());

describe('ObjectView — the form slot\'s `title` / `description` are I18nLabel (objectui#10993)', () => {
  it('the locale-map documents these rows mount are ones the validator accepts', () => {
    for (const mode of ['drawer', 'modal'] as const) {
      const parsed = safeValidateSchema(node(mode, { title: TITLE_MAP, description: DESCRIPTION_MAP }));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it.each(['drawer', 'modal'] as const)(
    '%s: a locale-map `form.title` and `form.description` head the form in the UI language',
    async (mode) => {
      renderView(mode, { title: TITLE_MAP, description: DESCRIPTION_MAP });
      openView();

      await waitFor(() => expect(screen.getByText('联系人卡片')).toBeInTheDocument());
      expect(screen.getByText('联系谁')).toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain('[object Object]');
    },
  );

  it('CONTROL: plain strings head the form exactly as authored', async () => {
    renderView('drawer', { title: 'Card', description: 'Call list' });
    openView();

    await waitFor(() => expect(screen.getByText('Card')).toBeInTheDocument());
    expect(screen.getByText('Call list')).toBeInTheDocument();
  });
});
