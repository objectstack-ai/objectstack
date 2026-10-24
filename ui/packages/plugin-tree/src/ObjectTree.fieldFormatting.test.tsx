/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The tree-grid formats its cells the way the flat table does — objectui#6014.
 *
 * ── The repro this file pins ───────────────────────────────────────────────
 * On the built-in 业务单元 (`sys_business_unit`) page the 「组织架构」 tree tab
 * rendered the manager `lookup` column as a raw record id and the `type`
 * `select` column as the raw stored value (`department`), while the flat-table
 * tab on the SAME page rendered the user's name and the translated 「部门」.
 *
 * ── The mount shape matters, and it is why this was invisible ──────────────
 * `ListView` renders the tree through `SchemaRenderer` with BOTH `objectName`
 * (so `getDataConfig` yields `provider: 'object'`) and its own already-fetched
 * `data` array. `ObjectTree` treats "a host passed inline data" as "I do not
 * need the object schema" and skips `getObjectSchema`, yet its record-fetch
 * branch still prefers a live object dataSource — so it issued its OWN query
 * with `buildExpandFields(undefined)` → `[]` → no `$expand` at all, and had no
 * field definitions to read `options` from either. Both halves of the card fall
 * out of that one gap, which is why the tests below mount the tree the way
 * `ListView` really does (dataSource AND inline `data`) rather than the way the
 * older tests do (inline `data` only, no dataSource — a path that never runs
 * the tree's own fetch and therefore cannot see this defect).
 *
 * ── The two halves are two mechanisms ─────────────────────────────────────
 * The lookup half is object unwrapping over an `$expand`ed record; the select
 * half is option-label resolution (`field.options` + the `fieldOptions.*` i18n
 * convention). Fixing one does not fix the other, so both are asserted here.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

/** `sys_business_unit`, trimmed to the two columns the card names. */
const OBJECT_SCHEMA = {
  name: 'sys_business_unit',
  fields: {
    name: { type: 'text', label: 'Name' },
    parent_id: { type: 'lookup', reference: 'sys_business_unit', label: 'Parent' },
    manager_user_id: { type: 'lookup', reference: 'sys_user', label: 'Manager' },
    type: {
      type: 'select',
      label: 'Type',
      // Labels deliberately NOT derivable from their value: `humanizeLabel`
      // (the unmatched-value fallback) turns `department` into `Department`,
      // so an assertion expecting `Department` would pass even with option
      // matching completely broken. `Business Department` can only come from
      // the options array.
      options: [
        { label: 'Business Department', value: 'department' },
        { label: 'Holding Company', value: 'company' },
      ],
    },
  },
};

/** What the server returns when `$expand` names the manager lookup. */
const EXPANDED_ROWS = [
  {
    id: 'bu1',
    name: 'Acme',
    parent_id: null,
    manager_user_id: { id: 'u1', name: 'Zhang San' },
    type: 'department',
  },
];

/** What the server returns when `$expand` is absent — the reported symptom. */
const BARE_ROWS = [
  { id: 'bu1', name: 'Acme', parent_id: null, manager_user_id: 'u1', type: 'department' },
];

const TREE_SCHEMA = {
  type: 'object-tree',
  objectName: 'sys_business_unit',
  labelField: 'name',
  fields: ['name', 'manager_user_id', 'type'],
};

/**
 * A dataSource that answers honestly: it expands only what it was ASKED to
 * expand. A stub that always returned the expanded shape would make this whole
 * file pass without a fix — the defect is in the request, not the response.
 */
function makeDataSource(rows?: any[]) {
  const expandArgs: (string[] | null)[] = [];
  const dataSource = {
    find: async (_object: string, query: any) => {
      const expand = query?.$expand ?? null;
      expandArgs.push(expand);
      if (rows) return rows;
      return expand && expand.includes('manager_user_id') ? EXPANDED_ROWS : BARE_ROWS;
    },
    getObjectSchema: async () => OBJECT_SCHEMA,
  } as any;
  return { dataSource, expandArgs };
}

/** The cells of the single rendered row, as text — what the user sees. */
async function renderRowCells(children: (ds: any) => React.ReactElement) {
  const { dataSource, expandArgs } = makeDataSource();
  render(children(dataSource));
  await waitFor(() => expect(screen.getByTestId('object-tree')).toBeInTheDocument());
  const row = screen.getAllByTestId('object-tree-row')[0];
  const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');
  return { cells, expandArgs };
}

/** The ListView mount shape: `objectName` + a live dataSource + inline `data`. */
function listViewShapedTree(dataSource: any) {
  return (
    <ObjectTree schema={TREE_SCHEMA as never} dataSource={dataSource} data={BARE_ROWS} />
  );
}

describe('ObjectTree field formatting (objectui#6014)', () => {
  it('renders a lookup column as the referenced record display name, not its id', async () => {
    const { cells } = await renderRowCells(listViewShapedTree);

    // The manager column is the second cell (label column first).
    expect(cells[1]).toBe('Zhang San');
    expect(cells[1]).not.toBe('u1');
  });

  it('asks the dataSource to expand the lookup columns it is going to render', async () => {
    // The mechanism behind the assertion above: a host passing inline `data`
    // must not suppress the object-schema fetch that `$expand` is derived from.
    const { expandArgs } = await renderRowCells(listViewShapedTree);

    expect(expandArgs.length).toBeGreaterThan(0);
    expect(expandArgs[expandArgs.length - 1]).toContain('manager_user_id');
  });

  it('renders a select column as its option label, not the raw stored value', async () => {
    const { cells } = await renderRowCells(listViewShapedTree);

    // The type column is the third cell.
    expect(cells[2]).toBe('Business Department');
    // The reported symptom: the raw stored value.
    expect(cells[2]).not.toBe('department');
    // …and not the `humanizeLabel` fallback either. Without this line the
    // assertion above could be satisfied by the fallback alone.
    expect(cells[2]).not.toBe('Department');
  });

  it('matches a stored value to its option case-insensitively, and humanizes an unmatched one', async () => {
    // Mirrors `SelectCellRenderer`: seed data stores `Department` against a
    // declared `department`, and a value no option declares still reads as
    // words rather than as a raw token.
    // Served through the dataSource, not as inline `data`: on this mount shape
    // the tree's own query wins over anything the host passed down — the very
    // precedence that made objectui#6014 invisible from the inline path.
    const { dataSource } = makeDataSource([
      { id: 'bu9', name: 'Mixed', parent_id: null, manager_user_id: null, type: 'Department' },
      { id: 'bu8', name: 'Unknown', parent_id: null, manager_user_id: null, type: 'joint_venture' },
    ]);
    render(<ObjectTree schema={TREE_SCHEMA as never} dataSource={dataSource} />);
    await waitFor(() => expect(screen.getByTestId('object-tree')).toBeInTheDocument());
    const rows = screen.getAllByTestId('object-tree-row');
    const typeCellOf = (label: string) => {
      const row = rows.find((r) => r.textContent?.includes(label))!;
      return Array.from(row.querySelectorAll('td'))[2]?.textContent?.trim();
    };

    expect(typeCellOf('Mixed')).toBe('Business Department');
    expect(typeCellOf('Unknown')).toBe('Joint Venture');
  });

  it('renders a select option label through the fieldOptions i18n convention', async () => {
    // The exact repro: a zh session must read 「部门」, not `department`.
    // Key convention: `{appNamespace}.fieldOptions.{object}.{field}.{value}`
    // — the same one `translateOptions` resolves for the flat grid.
    const { dataSource } = makeDataSource();
    render(
      <I18nProvider
        config={{
          defaultLanguage: 'zh',
          detectBrowserLanguage: false,
          resources: {
            zh: {
              testapp: {
                // Marks `testapp` as an app namespace for `getAppNamespaces`.
                fields: {},
                fieldOptions: {
                  sys_business_unit: { type: { department: '部门' } },
                },
              },
            },
          },
        }}
      >
        <ObjectTree schema={TREE_SCHEMA as never} dataSource={dataSource} data={BARE_ROWS} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('object-tree')).toBeInTheDocument());
    const row = screen.getAllByTestId('object-tree-row')[0];
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');

    expect(cells[2]).toBe('部门');
  });

  it('still renders a plain value column untouched', async () => {
    // Counter-probe: the formatting chain must not swallow ordinary values.
    // Green both before and after the fix — it is here so a green on the four
    // assertions above cannot be explained by "the tree renders nothing".
    const { cells } = await renderRowCells(listViewShapedTree);

    expect(cells[0]).toBe('Acme');
  });
});
