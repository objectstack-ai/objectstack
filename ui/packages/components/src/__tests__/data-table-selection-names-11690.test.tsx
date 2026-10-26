/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The data table's selection checkboxes are named (objectui#11690).
 *
 * axe (wcag2a + wcag2aa) on a stock task list measured `button-name` on the
 * select-all checkbox and on every row's checkbox: each is a Radix checkbox (a
 * `button` with `role="checkbox"`) drawn alone in its cell, with no label. They
 * are now named through the `table.selectAllRows` / `table.selectRow` keys the
 * locale packs already carried — so the pin reads them in a non-English locale
 * against the pack, never against a literal.
 *
 * `color-contrast` is off: it needs layout happy-dom does not compute, and it
 * is outside the card.
 */

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import axe from 'axe-core';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { de } from '@object-ui/i18n/locales';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

afterEach(() => cleanup());

function table(language?: string) {
  const Component = ComponentRegistry.get('data-table')!;
  const schema = {
    type: 'data-table',
    selectable: true,
    columns: [{ header: 'Name', accessorKey: 'name' }],
    data: [
      { id: 'r1', name: 'Alpha' },
      { id: 'r2', name: 'Beta' },
    ],
  } as any;
  const node = <Component schema={schema} />;
  return language ? (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {node}
    </I18nProvider>
  ) : (
    node
  );
}

describe('data-table names its selection checkboxes (objectui#11690)', () => {
  it('no wcag2a/aa violation, and the name rule really ran on the checkboxes', async () => {
    const { container } = render(table());
    // Control: the selection column is drawn — header plus one per row.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    const res = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual([]);
    expect(res.passes.map((p) => p.id)).toContain('button-name');
  });

  it('the names come from the locale pack, in the viewer\'s language', () => {
    render(table('de'));
    const [all, ...rows] = screen.getAllByRole('checkbox');
    expect(de.table.selectAllRows).toBeTruthy();
    expect(all).toHaveAccessibleName(de.table.selectAllRows);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveAccessibleName(de.table.selectRow);
  });
});
