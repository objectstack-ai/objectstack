/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 2 — what `element:definition-list` and
 * `element:repeater` PUBLISH, and what their renderer does with each member.
 *
 * `@objectstack/spec` 17.5.0 gave both blocks a `ComponentPropsMap` row, and
 * the repo-wide parity guard (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`)
 * booked every difference to this card (objectui#11111 decision 3 = B): one
 * refused arm (`element:definition-list.columns`) and four member pins owed
 * (`element:definition-list.items`, `element:repeater.fields`, `.filter` and
 * `.sort`). The ruling's terms: each key is decided by its own measurement:
 * declare what the renderer honours, refuse or retire what it does not. This
 * file is that measurement kept as a pin. Every rendering row mounts the block
 * the way a page does, through the REAL `SchemaRenderer` and the real
 * registry, and asserts on what a user sees or on the query the adapter is
 * handed. Every positive row carries its control.
 *
 * What moved, per key:
 *
 *   - `element:definition-list.columns` — NARROWED from the strings `'1'` /
 *     `'2'` to the NUMBERS `1` / `2`. The renderer compares the number, so the
 *     string `'2'` drew one column; the spec refuses the strings; and the page
 *     validator (`validateTree` over the published manifest) used to refuse
 *     the number `2` that the designer writes and pass the string.
 *   - `element:definition-list.items` — no longer REQUIRED. Absent and empty
 *     both render the "No details" state, the spec row does not require it,
 *     and the validator raised `missing-required-prop` on a list both accept.
 *     Its members are pinned below.
 *   - `element:repeater.fields` — the description no longer advertises a
 *     `label` member: the list has no header row, so it was never printed, and
 *     the spec refuses it.
 *   - `element:repeater.filter` / `.sort` — declared as lists of objects
 *     (`of: 'object'`), the only member kind the spec rows accept, and their
 *     members pinned at the adapter seam below. Since objectui#12085 neither
 *     is published: `@objectstack/spec` retires the flat query keys
 *     (objectstack#11509), the registration offers the node-level
 *     `dataSource` binding alone, and the rows below mount through it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, FilterScopeProvider, SchemaRenderer } from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { SchemaElement } from '@object-ui/sdui-parser';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const DEFINITION_LIST = 'element:definition-list';
const REPEATER = 'element:repeater';

/** The published inputs of one block, by name. */
const inputsOf = (type: string) =>
  new Map((ComponentRegistry.getConfig(type)?.inputs ?? []).map((input) => [input.name, input]));

/** The values an `enum` input admits, flattened from either declaration form. */
const enumValuesOf = (type: string, name: string): unknown[] =>
  (inputsOf(type).get(name)?.enum ?? []).map((entry) =>
    typeof entry === 'object' && entry !== null ? (entry as { value: unknown }).value : entry,
  );

/** The installed spec row for one block, as a parser. */
interface SpecIssue { code: string; path: PropertyKey[]; keys?: string[] }
const specRow = (type: string) =>
  (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: SpecIssue[] } } }>)[type];

/**
 * The refusal the spec row gives one props bag, as `{ code, path }` pairs — so
 * a refusal row asserts WHICH key was refused and HOW, never a bare
 * `success: false` a sibling key could have produced.
 */
const refusal = (type: string, value: unknown) =>
  (specRow(type).safeParse(value).error?.issues ?? []).map((issue) => ({
    code: issue.code,
    path: issue.path.join('.'),
    ...(issue.keys ? { keys: issue.keys } : {}),
  }));

/** The diagnostics the page validator raises, over the manifest the registry publishes. */
const diagnose = (node: Record<string, unknown>) =>
  validateTree(
    node as unknown as SchemaElement,
    manifestFromConfigs(
      ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
    ),
  ).diagnostics.map((diagnostic) => ({ severity: diagnostic.severity, code: diagnostic.code }));

// ── element:definition-list ─────────────────────────────────────────────────

/** Mount a definition list the way a page does. */
const mountList = (properties: Record<string, unknown>) =>
  render(<SchemaRenderer schema={{ type: DEFINITION_LIST, properties } as never} />);

/** The `<dl>`'s column classes. */
const columnClasses = () =>
  (screen.getByTestId('definition-list').className.split(' ')).filter((c) => /grid-cols-/.test(c));

const ONE_ITEM = [{ term: 'Status', description: 'Active' }];

describe('element:definition-list.columns — the NUMBERS 1 and 2 (objectui#11168)', () => {
  it('publishes the numbers 1 and 2, and the installed spec row accepts each and refuses the strings', () => {
    expect(enumValuesOf(DEFINITION_LIST, 'columns')).toEqual([1, 2]);
    for (const columns of [1, 2]) {
      expect(specRow(DEFINITION_LIST).safeParse({ columns }).success, `spec refuses columns ${columns}`).toBe(true);
    }
    for (const columns of ['1', '2']) {
      expect(refusal(DEFINITION_LIST, { columns })).toEqual([{ code: 'invalid_value', path: 'columns' }]);
    }
  });

  it('the renderer compares the NUMBER: `2` draws two columns, and the string `\'2\'` draws one', () => {
    mountList({ columns: 2, items: ONE_ITEM });
    expect(columnClasses()).toEqual(['sm:grid-cols-2']);
    cleanup();
    // The string that used to be published: the comparison is `=== 2`, so it
    // collapses to the single-column default.
    mountList({ columns: '2', items: ONE_ITEM });
    expect(columnClasses()).toEqual(['grid-cols-1']);
  });

  it.each([
    ['the number 1', 1],
    ['absent', undefined],
  ])('`columns` %s draws one column', (_label, columns) => {
    mountList({ columns, items: ONE_ITEM });
    expect(columnClasses()).toEqual(['grid-cols-1']);
  });

  it('the page validator accepts `columns: 2` and reports the string as an invalid enum value', () => {
    // Before this slice the published enum was the strings, so the validator
    // refused the number the designer writes and passed the string the
    // renderer collapses — the two verdicts below, inverted.
    const items = ONE_ITEM;
    expect(diagnose({ type: DEFINITION_LIST, items, columns: 2 })).toEqual([]);
    expect(diagnose({ type: DEFINITION_LIST, items, columns: '2' })).toEqual([
      { severity: 'error', code: 'invalid-enum' },
    ]);
  });
});

describe('element:definition-list.items — optional, as the renderer and the spec read it (objectui#11168)', () => {
  it('absent `items` renders the empty state, the spec accepts it, and the validator does not report it missing', () => {
    expect(inputsOf(DEFINITION_LIST).get('items')?.required).not.toBe(true);
    expect(specRow(DEFINITION_LIST).safeParse({}).success).toBe(true);
    expect(diagnose({ type: DEFINITION_LIST })).toEqual([]);
    mountList({});
    // The bundle's `common.noData` since objectui#12910 (was "No details").
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('CONTROL: a required input on a sibling block is still reported when it is missing', () => {
    // `element:number.aggregate` IS required (the metric computes nothing
    // without it), so the empty verdict above is the declaration, not a
    // validator that stopped checking. (`element:repeater.object` was this
    // control until objectui#12085: the repeater requires nothing now, its
    // object being named by `dataSource.object`.)
    expect(diagnose({ type: 'element:number', dataSource: { object: 'contact' } })).toEqual([
      { severity: 'error', code: 'missing-required-prop' },
    ]);
  });

  it('is published as a list of objects', () => {
    const items = inputsOf(DEFINITION_LIST).get('items');
    expect(items?.type).toBe('array');
    expect(items?.of).toBe('object');
  });
});

describe('element:definition-list.items — the members the renderer reads (objectui#11168)', () => {
  /** Each row as `[term, description]`, in DOM order. */
  const rows = () =>
    [...screen.getByTestId('definition-list').querySelectorAll(':scope > div')].map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ]);

  it('`term` is the row label and `description` is shown as-is: a string or number verbatim, an object as JSON, an omitted one as an em dash', () => {
    mountList({
      items: [
        { term: 'Status', description: 'Active' },
        { term: 'Seats', description: 7 },
        { term: 'Meta', description: { tier: 'gold' } },
        { term: 'Notes' },
      ],
    });
    expect(rows()).toEqual([
      ['Status', 'Active'],
      ['Seats', '7'],
      ['Meta', '{"tier":"gold"}'],
      ['Notes', '—'],
    ]);
  });

  it('the `label` / `value` spelling is read by nothing: a blank term and an em dash, and the spec refuses it', () => {
    mountList({ items: [{ label: 'Owner', value: 'Ada' }, { term: 'Owner', description: 'Ada' }] });
    // The second item is the control: the same text under the read members.
    expect(rows()).toEqual([
      ['', '—'],
      ['Owner', 'Ada'],
    ]);
    expect(refusal(DEFINITION_LIST, { items: [{ label: 'Owner', value: 'Ada' }] })).toEqual([
      { code: 'invalid_type', path: 'items.0.term' },
      { code: 'unrecognized_keys', path: 'items.0', keys: ['label', 'value'] },
    ]);
    expect(specRow(DEFINITION_LIST).safeParse({ items: [{ term: 'Owner', description: 'Ada' }] }).success).toBe(true);
  });
});

// ── element:repeater ────────────────────────────────────────────────────────

const ROW = { id: 'r1', name: 'Ada', owner: 'u1', email: 'ada@example.com' };

/**
 * Mount a repeater over an adapter that records every query and answers
 * {@link ROW}. The object, and any `query` member (`filter`, `sort`), are
 * the node-level `dataSource` binding's: the one query door the registration
 * publishes (objectui#12085).
 */
function mountRepeater(properties: Record<string, unknown>, query: Record<string, unknown> = {}) {
  const find = vi.fn(async (_object: string, _query: Record<string, unknown>) => ({ data: [ROW] }));
  render(
    <FilterScopeProvider currentUserId="user-1" currentOrgId="org-1">
      <AdapterCtx.Provider value={{ find } as never}>
        <SchemaRenderer schema={{ type: REPEATER, dataSource: { object: 'contact', ...query }, properties } as never} />
      </AdapterCtx.Provider>
    </FilterScopeProvider>,
  );
  return find;
}

/** The query of every read the repeater issued. */
const queries = (find: ReturnType<typeof mountRepeater>) => find.mock.calls.map((call) => call[1]);

/** The printed values of the one line, in DOM order. */
const line = () => [...screen.getByTestId('repeater').querySelectorAll('li > span')].map((span) => span.textContent);

describe('element:repeater.fields — what each entry prints (objectui#11168)', () => {
  it('a bare field name and `{ field }` each print that field\'s value, in order, after the title', async () => {
    mountRepeater({ titleField: 'name', fields: ['owner', { field: 'email' }] });
    await waitFor(() => expect(screen.getByTestId('repeater')).toBeInTheDocument());
    expect(line()).toEqual(['Ada', 'u1', 'ada@example.com']);
  });

  it('an entry naming a field the record lacks prints an em dash', async () => {
    mountRepeater({ fields: ['owner', 'phone'] });
    await waitFor(() => expect(screen.getByTestId('repeater')).toBeInTheDocument());
    expect(line()).toEqual(['u1', '—']);
  });

  it('a `label` on an entry is never printed, and the spec refuses it', async () => {
    mountRepeater({ fields: [{ field: 'email', label: 'E-mail address' }] });
    await waitFor(() => expect(screen.getByTestId('repeater')).toBeInTheDocument());
    // The value is printed (the entry is read), its label is not.
    expect(line()).toEqual(['ada@example.com']);
    expect(screen.getByTestId('repeater').textContent).not.toContain('E-mail address');
    // No flat `object` in the bag: `@objectstack/spec` 18 retired it (objectui#12030);
    // the repeater's object is the node's `dataSource.object`, as mounted above.
    expect(refusal(REPEATER, { fields: [{ field: 'email', label: 'E-mail address' }] })).toEqual([
      { code: 'invalid_union', path: 'fields.0' },
    ]);
    expect(specRow(REPEATER).safeParse({ fields: ['owner', { field: 'email' }] }).success).toBe(true);
  });

  it('declares no member kind: the contract takes a field name OR `{ field }`', () => {
    expect(inputsOf(REPEATER).get('fields')?.of).toBeUndefined();
  });
});

describe('element:repeater `dataSource.filter` — the rules the adapter is handed (objectui#11168, objectui#12085)', () => {
  it('the rules reach `$filter` member for member, with a context token in `value` resolved first', async () => {
    const find = mountRepeater({}, {
      filter: [
        { field: 'owner', operator: 'equals', value: '{current_user_id}' },
        { field: 'org', operator: 'equals', value: '{current_org_id}' },
        { field: 'status', operator: 'in', value: ['open', 'won'] },
      ],
    });
    await waitFor(() => expect(find).toHaveBeenCalled());
    const expected = [
      { field: 'owner', operator: 'equals', value: 'user-1' },
      { field: 'org', operator: 'equals', value: 'org-1' },
      { field: 'status', operator: 'in', value: ['open', 'won'] },
    ];
    // Every read, so a first query carrying the raw token cannot hide behind a
    // later resolved one.
    for (const query of queries(find)) expect(query.$filter).toEqual(expected);
  });

  it('CONTROL: a token-free rule list arrives unchanged, and no `filter` sends no `$filter`', async () => {
    const rules = [{ field: 'status', operator: 'not_equals', value: 'lost' }];
    const find = mountRepeater({}, { filter: rules });
    await waitFor(() => expect(find).toHaveBeenCalled());
    for (const query of queries(find)) expect(query.$filter).toEqual(rules);
    cleanup();
    const bare = mountRepeater({});
    await waitFor(() => expect(bare).toHaveBeenCalled());
    for (const query of queries(bare)) expect(query).not.toHaveProperty('$filter');
  });

  it('is the binding\'s member, not a published flat input: the flat `filter` is retired upstream (objectui#12085)', () => {
    expect(inputsOf(REPEATER).has('dataSource')).toBe(true);
    expect(inputsOf(REPEATER).has('filter')).toBe(false);
  });
});

describe('element:repeater `dataSource.sort` — the items the adapter is handed (objectui#11168, objectui#12085)', () => {
  it('the items reach `$orderby` unchanged and in list order', async () => {
    const sort = [
      { field: 'name', order: 'desc' },
      { field: 'email', order: 'asc' },
    ];
    const find = mountRepeater({}, { sort });
    await waitFor(() => expect(find).toHaveBeenCalled());
    for (const query of queries(find)) expect(query.$orderby).toEqual(sort);
  });

  it('CONTROL: no `sort` sends no `$orderby`', async () => {
    const find = mountRepeater({});
    await waitFor(() => expect(find).toHaveBeenCalled());
    for (const query of queries(find)) expect(query).not.toHaveProperty('$orderby');
  });

  it('is the binding\'s member, not a published flat input: the flat `sort` is retired upstream (objectui#12085)', () => {
    expect(inputsOf(REPEATER).has('dataSource')).toBe(true);
    expect(inputsOf(REPEATER).has('sort')).toBe(false);
  });
});
