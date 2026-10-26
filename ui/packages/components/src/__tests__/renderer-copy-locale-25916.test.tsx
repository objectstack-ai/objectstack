/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25916, third pass — two renderers in this package drew English literals
 * whatever the session's language.
 *
 *   - `data-table`: the hover "open record" affordance's title and the inline
 *     edit row's cancel / save buttons (`table.openRecord`,
 *     `table.cancelChanges`, `table.saveRow`);
 *   - the `kind:'react'` page renderer: its capability notice, its empty-source
 *     refusal, its loading line and its error titles (`reactPage.*`).
 *
 * What this file pins, through the real renderers and a real `I18nProvider`:
 *   - under zh each surface draws the zh pack's row (expectations read from the
 *     pack, guarded as real zh rows);
 *   - a sentence with an inline `<code>` is ONE translated string: the code
 *     sits where the zh string put it, and no `{{slot}}` or private-use mark
 *     is left in the text;
 *   - control: with no provider each surface still reads its English.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { CAP_REACT_PAGES, ComponentRegistry, disableCapability, enableCapability } from '@object-ui/core';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import type { PageDocumentNode } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll`; see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const { zh, en } = builtInLocales;

/** No `{{slot}}` and no private-use slot mark survives into the rendered text. */
const LEAK = /\{\{|[\u{E000}-\u{F8FF}]/u;

function withLanguage(element: React.ReactElement, language: 'zh' | null) {
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {element}
      </I18nProvider>
    ) : (
      element
    ),
  );
}

const ALPHA = { id: 'a', name: 'Alpha', qty: 10 };

/** Resolved once, at module scope: the renderers registered above. */
const Table = ComponentRegistry.get('data-table')!;

function DataTable({ onRowClick }: { onRowClick?: () => void }) {
  const schema = {
    type: 'data-table',
    editable: true,
    singleClickEdit: true,
    rowActions: true,
    showRowNumbers: true,
    columns: [
      { header: 'Task', accessorKey: 'name', editable: false },
      { header: 'Estimate', accessorKey: 'qty', type: 'number' },
    ],
    data: [ALPHA],
    onRowSave: async () => undefined,
    ...(onRowClick ? { onRowClick } : {}),
  } as any;
  return <Table schema={schema} />;
}

/** Stage an edit on Alpha's estimate, so the row draws its cancel / save buttons. */
function stageEdit(container: HTMLElement) {
  const cell = container.querySelectorAll('tbody tr td')[2] as HTMLElement;
  fireEvent.click(cell);
  const input = cell.querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '11' } });
  fireEvent.blur(input);
}

const PAGE = (source: string): PageDocumentNode => ({
  type: 'home',
  kind: 'react',
  name: 'locale_page',
  label: 'Locale page',
  source,
});

function ReactPage({ source }: { source: string }) {
  return (
    <AdapterCtx.Provider value={{ find: async () => [] } as any}>
      <SchemaRenderer schema={PAGE(source)} />
    </AdapterCtx.Provider>
  );
}

afterEach(() => {
  cleanup();
  disableCapability(CAP_REACT_PAGES);
});

describe('renderer copy under zh (#25916)', () => {
  it('guard: the zh values read below are real zh rows, not English copies', () => {
    for (const [zhValue, enValue] of [
      [zh.table.openRecord, en.table.openRecord],
      [zh.table.cancelChanges, en.table.cancelChanges],
      [zh.table.saveRow, en.table.saveRow],
      [zh.reactPage.disabledTitle, en.reactPage.disabledTitle],
      [zh.reactPage.disabledBody, en.reactPage.disabledBody],
      [zh.reactPage.sourceRequired, en.reactPage.sourceRequired],
    ]) {
      expect(zhValue).not.toBe(enValue);
      expect(zhValue).toMatch(/\p{Script=Han}/u);
    }
  });

  it('data-table: the open affordance and the edited row buttons are titled in zh', () => {
    const { container } = withLanguage(<DataTable onRowClick={() => undefined} />, 'zh');
    expect(screen.getByTestId('row-expand-button').getAttribute('title')).toBe(zh.table.openRecord);
    stageEdit(container);
    const row = container.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByTitle(zh.table.cancelChanges)).toBeTruthy();
    expect(within(row).getByTitle(zh.table.saveRow)).toBeTruthy();
  });

  it('react page, capability off: the notice is zh, its three <code> chips where the zh string put them', async () => {
    const { container } = withLanguage(<ReactPage source="function Page() { return null; }" />, 'zh');
    expect(await screen.findByText(zh.reactPage.disabledTitle)).toBeTruthy();
    const flag = screen.getByText('OS_PAGE_REACT_ENABLED=true', { selector: 'code' });
    expect(flag.parentElement!.textContent).toBe(
      zh.reactPage.disabledBody
        .replace('{{kind}}', "kind:'react'")
        .replace('{{flag}}', 'OS_PAGE_REACT_ENABLED=true')
        .replace('{{call}}', "enableCapability('react-pages')"),
    );
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('react page, capability on: an empty source is refused in zh, its chips in place', async () => {
    enableCapability(CAP_REACT_PAGES);
    const { container } = withLanguage(<ReactPage source="   " />, 'zh');
    const source = await screen.findByText('source', { selector: 'code' });
    expect(source.parentElement!.textContent).toBe(
      zh.reactPage.sourceRequired.replace('{{kind}}', "kind:'react'").replace('{{source}}', 'source'),
    );
    expect(container.textContent).not.toMatch(LEAK);
  });
});

describe('control: with no provider each surface still reads its English (#25916)', () => {
  it('data-table', () => {
    const { container } = withLanguage(<DataTable onRowClick={() => undefined} />, null);
    expect(screen.getByTestId('row-expand-button').getAttribute('title')).toBe('Open record');
    stageEdit(container);
    expect(screen.getByTitle('Cancel changes')).toBeTruthy();
    expect(screen.getByTitle('Save row')).toBeTruthy();
  });

  it('react page notice', async () => {
    withLanguage(<ReactPage source="function Page() { return null; }" />, null);
    const flag = await screen.findByText('OS_PAGE_REACT_ENABLED=true', { selector: 'code' });
    expect(screen.getByText('React pages are disabled on this deployment')).toBeTruthy();
    expect(flag.parentElement!.textContent).toBe(
      "kind:'react' pages execute author JavaScript directly in the application, so they are off unless the deployment turns them on. An operator whose page authors are trusted sets OS_PAGE_REACT_ENABLED=true on the server (a host embedding the renderer calls enableCapability('react-pages')).",
    );
  });

  it('react page empty source', async () => {
    enableCapability(CAP_REACT_PAGES);
    withLanguage(<ReactPage source="   " />, null);
    const source = await screen.findByText('source', { selector: 'code' });
    expect(source.parentElement!.textContent).toBe("A kind:'react' page requires a non-empty source.");
  });
});
