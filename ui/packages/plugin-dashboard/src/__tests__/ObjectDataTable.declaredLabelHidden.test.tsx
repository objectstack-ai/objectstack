/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The AUTO-DERIVED columns of `ObjectDataTable` — the drill-down drawer's
 * columns, since `DrillDownDrawer` mounts this widget with no `columns` when
 * the drill names none — follow the list views' two rules:
 *
 *  - HEADER PRECEDENCE: translation bundle → the field's declared `label` →
 *    the humanized key. A label authored on the field alone (no bundle entry,
 *    the ordinary case in an app whose labels are written in its own language)
 *    heads the column.
 *  - HIDDEN FIELDS: a field the object declares `hidden: true` is not an
 *    auto-derived column. An explicit `columns` list is never filtered.
 *
 * Controls: a bundle entry still beats the declared label; a field with no
 * label still shows the humanized key; an explicit whitelist that names a
 * hidden field still shows it; an authored column header still beats the
 * declared label. PARITY: a whitelist that authors no header text (the drill
 * callers' raw-key objects, the string shorthand) heads a column exactly as
 * the auto-derived table does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';

import { DrillDownDrawer } from '../DrillDownDrawer';
import { ObjectDataTable } from '../ObjectDataTable';
import { humanizeFieldKey } from '../utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '@object-ui/components';

const OBJECT = 'crm_opportunity';

/**
 * Declaration order is the auto-derived column order. `title` and `start_date`
 * are retired columns kept for their data (`hidden: true`); they lead the
 * declaration so a regression that keeps them shows them FIRST, as the drawer
 * did.
 */
const SCHEMA = {
  name: OBJECT,
  fields: {
    title: { type: 'text', label: '标题', hidden: true },
    start_date: { type: 'date', label: '开始日期', hidden: true },
    subject: { type: 'text', label: '报销事项' },
    reason: { type: 'text', label: { en: 'Reason', 'zh-CN': '报销说明' } },
    approval_status: { type: 'text', label: '审批状态' },
    needs_analysis: { type: 'text' },
  },
};

const ROWS = [
  {
    title: 'retired',
    start_date: '2026-11-12',
    subject: 'Taxi',
    reason: 'Client visit',
    approval_status: 'pending',
    needs_analysis: 'x',
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS })),
    getObjectSchema: vi.fn(async () => SCHEMA),
  };
}

const headers = (): string[] =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

const zh = (resources: Record<string, unknown> = {}) =>
  (node: React.ReactElement) => (
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources }}>
      {node}
    </I18nProvider>
  );

async function renderWidget(
  columns: unknown[] | undefined,
  wrap?: (node: React.ReactElement) => React.ReactElement,
): Promise<string[]> {
  const node = (
    <ObjectDataTable
      schema={{ type: 'object-data-table', objectName: OBJECT, columns } as any}
      dataSource={makeDataSource()}
    />
  );
  render(wrap ? wrap(node) : node);
  await waitFor(() => expect(headers().length).toBeGreaterThan(0));
  return headers();
}

async function renderDrawer(wrap?: (node: React.ReactElement) => React.ReactElement): Promise<string[]> {
  const node = (
    <DrillDownDrawer
      open
      onClose={vi.fn()}
      title="Pending"
      objectName={OBJECT}
      filter={{ approval_status: 'pending' }}
      dataSource={makeDataSource()}
    />
  );
  render(wrap ? wrap(node) : node);
  await waitFor(() => expect(headers().length).toBeGreaterThan(0));
  return headers();
}

/** The exact mapping both drill callers apply to `drillDown.columns`. */
const asDrillColumns = (keys: string[]) => keys.map((c) => ({ accessorKey: c, header: c }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectDataTable auto-derived columns — declared label and hidden fields', () => {
  it('PIN: the drill drawer heads each column with the field\'s declared label and lists no hidden field', async () => {
    const shown = await renderDrawer(zh());
    expect(shown).toEqual(['报销事项', '报销说明', '审批状态', humanizeFieldKey('needs_analysis')]);
  });

  it('PIN: a declared plain-string label with no bundle entry heads its column', async () => {
    const shown = await renderWidget(undefined);
    expect(shown).toContain('报销事项');
    expect(shown).not.toContain(humanizeFieldKey('subject'));
  });

  it('PIN: a declared inline locale map is picked in the UI language', async () => {
    const shown = await renderWidget(undefined, zh());
    expect(shown).toContain('报销说明');
    expect(shown).not.toContain('Reason');
  });

  it('PIN: a `hidden: true` field is not an auto-derived column', async () => {
    const shown = await renderWidget(undefined);
    expect(shown).not.toContain('标题');
    expect(shown).not.toContain('开始日期');
    expect(shown).toHaveLength(4);
  });

  it('CONTROL: a bundle entry still beats the declared label', async () => {
    const resources = { zh: { crm: { fields: { [OBJECT]: { subject: '费用主题' } } } } };
    const shown = await renderWidget(undefined, zh(resources));
    expect(shown[0]).toBe('费用主题');
  });

  it('CONTROL: a field with no declared label shows the humanized key', async () => {
    const shown = await renderWidget(undefined);
    expect(shown[3]).toBe(humanizeFieldKey('needs_analysis'));
  });

  it('CONTROL: an explicit `columns` list that names a hidden field still shows it', async () => {
    const shown = await renderWidget(['start_date', 'subject']);
    expect(shown).toEqual(['开始日期', '报销事项']);
  });

  it('PARITY: a drill whitelist built from raw keys heads its columns like the auto-derived ones', async () => {
    const auto = await renderWidget(undefined);
    cleanup();
    const declared = await renderWidget(asDrillColumns(['subject', 'needs_analysis']));
    expect(declared).toEqual([auto[0], auto[3]]);
    expect(declared).toEqual(['报销事项', humanizeFieldKey('needs_analysis')]);
  });

  it('PARITY: a string-shorthand whitelist heads its columns like the auto-derived ones', async () => {
    const auto = await renderWidget(undefined);
    cleanup();
    const declared = await renderWidget(['subject', 'needs_analysis']);
    expect(declared).toEqual([auto[0], auto[3]]);
  });

  it('CONTROL: an authored column header still beats the declared label', async () => {
    const shown = await renderWidget([{ accessorKey: 'subject', header: 'Expense' }]);
    expect(shown).toEqual(['Expense']);
  });
});
