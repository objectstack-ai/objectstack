/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5378 + objectui#5377 + objectui#5446 — the getting-started guide's
 * own `object-grid` snippets are RENDERED here, not read.
 *
 * `content/docs/guide/building-crud-app.md` is the first-run CRUD walkthrough,
 * and four independent axes each took it from "works" to "renders nothing" (or,
 * for the fourth, to "renders something, but not what the prose claims"):
 *
 *  1. **registration** — its `setup.ts` loaded `@object-ui/components` and
 *     `@object-ui/fields` only, so `object-grid` resolved to the registry's
 *     "Unknown component type" panel.
 *  2. **wiring** (#5378) — it passed `dataSource` as a PROP on `SchemaRenderer`,
 *     which never becomes context; this block reads the adapter from
 *     `SchemaRendererProvider`. Measured `find` **0**.
 *  3. **keys** (#5377) — it named the object with `object`, and this block
 *     declares `objectName` (`GRID_QUERY_INPUTS`; `required: true` then, not
 *     since objectui#11605). Measured `find` **0** even under the right wiring.
 *  4. **capability** (#5446) — Step 7 named a top-level `view` and a
 *     `data.queryParams.$search`, neither of which `ObjectGrid` reads at all
 *     (`schema.view` — zero hits; `data` is the `ViewData` union, `queryParams`
 *     is not one of its arms). Measured identical `find` params with and
 *     without those two keys. The maintainer ruled (2026-08-22) that the guide
 *     should teach the declarative binding those blocks DO read —
 *     `dataSource: { object, view }`, resolved by `ElementDataSourceGate`
 *     against the object's saved views — and accept the resulting trade: a
 *     `view` the backend does not publish now renders a configuration-error
 *     panel instead of a silently unfiltered grid. The describe block at the
 *     bottom of this file measures that the rewritten binding really does
 *     change `find`'s params, with the old inert shape reproduced as a control.
 *
 * Every intermediate state passes a diff review and renders nothing (or, for
 * axis 4, renders the SAME thing regardless of the prose's claims), which is
 * why this file evaluates the guide's literals instead of asserting about their
 * text: the schema objects below are the ones the published page hands a reader.
 * The `find` **0 → 1** contrast for axes 1-3, and the `find`-params contrast for
 * axis 4, are pinned so a future edit that reintroduces one fails here rather
 * than on a reader's screen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold every key the
// guide's snippets name before the first render (AGENTS.md §测试纪律 — a
// `beforeAll` import is bounded by `hookTimeout` and would race the loader).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';

const GUIDE = path.resolve(__dirname, '../../../../content/docs/guide/building-crud-app.md');

// `listViews` mirrors the guide's own Step 3 `TaskSchema.listViews` exactly
// (canonical camelCase since #5362; the runtime's snake fallback is pinned by
// `ElementDataSourceGate.test.tsx`, not by this guide transcription)
// (same two ids, same `active` filter/sort) — the fourth axis below measures
// whether Step 7's `dataSource: { object, view }` binding resolves against a
// backend that publishes what the guide instructs the reader to declare, not
// against a richer fixture this file invented for its own convenience.
const TASK_SCHEMA = {
  name: 'task',
  label: 'Task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
    priority: { name: 'priority', type: 'text', label: 'Priority' },
    assignee: { name: 'assignee', type: 'text', label: 'Assignee' },
    due_date: { name: 'due_date', type: 'date', label: 'Due Date' },
  },
  listViews: {
    all: {
      label: 'All Tasks',
      columns: ['title', 'status', 'priority', 'assignee', 'due_date'],
    },
    active: {
      label: 'Active',
      columns: ['title', 'status', 'priority', 'assignee', 'due_date'],
      filter: [['status', '!=', 'Done']],
      sort: [{ field: 'priority', order: 'asc' }],
    },
  },
};

const ROW = { id: '42', title: 'Write the guide', status: 'Todo', priority: 'High' };

/**
 * Every schema literal the guide publishes for `type: '<key>'`, evaluated.
 *
 * Reading the literals out of the page is the point: a transcription kept in
 * this file would drift from the page silently, and the whole failure mode here
 * is that nothing tells you when the page stops working.
 *
 * The guide's literals close over exactly the identifiers bound below (its
 * `TaskSchema` import and the `useState` values of Steps 6 and 7), and carry no
 * TypeScript syntax inside the object, so `Function` is enough to evaluate one.
 */
function guideSchemas(key: string): any[] {
  const src = fs.readFileSync(GUIDE, 'utf8');
  const needle = `type: '${key}'`;
  const out: any[] = [];
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) {
    const start = src.lastIndexOf('{', at);
    let depth = 0;
    let end = start;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && --depth === 0) break;
    }
    const literal = src.slice(start, end + 1);
    out.push(
      new Function(
        'TaskSchema', 'editId', 'taskId', 'activeView', 'searchQuery',
        `return (${literal});`,
      )(TASK_SCHEMA, '42', '42', 'all', ''),
    );
  }
  return out;
}

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [ROW], total: 1 }),
    findOne: vi.fn().mockResolvedValue(ROW),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(TASK_SCHEMA),
  };
}

const GRID_SNIPPETS = guideSchemas('object-grid');

beforeEach(() => cleanup());

describe('guide/building-crud-app.md — every `object-grid` snippet actually renders', () => {
  it('publishes the three snippets this file is about', () => {
    // A guide that lost a snippet would otherwise make this whole file vacuous:
    // zero snippets means zero assertions and a green run.
    expect(GRID_SNIPPETS).toHaveLength(3);
  });

  it.each(GRID_SNIPPETS.map((schema, i) => [i + 1, schema] as const))(
    'snippet %i queries `task` under the provider wiring and paints the row',
    async (_i, schema) => {
      const adapter = makeAdapter();
      const { container } = render(
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={schema} />
        </SchemaRendererProvider>,
      );

      await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
      expect(adapter.find.mock.calls[0][0]).toBe('task');
      await waitFor(() => expect(container.textContent).toContain('Write the guide'));
    },
  );

  it('names the object with the key this block declares — `object` fetches nothing', async () => {
    // The #5377 axis, pinned as a contrast rather than described. Same snippet,
    // same wiring, one key re-spelled the way the page used to spell it.
    // The guide writes the grid's props in its `properties` bag, the spelling
    // the spec declares (objectui#11276); `SchemaRenderer` hoists it.
    const [first] = GRID_SNIPPETS;
    const { objectName, ...rest } = first.properties;
    const asItWas = { ...first, properties: { ...rest, object: objectName } };

    const adapter = makeAdapter();
    const { container } = render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={asItWas} />
      </SchemaRendererProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.find).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Write the guide');
  });

  it('resolves the adapter from EITHER wiring now, and the prop wins over context', async () => {
    // The #5378 axis, as it stands AFTER the convergence. It used to be a hard
    // split: `SchemaRenderer` reads only context, and this block's
    // `useSchemaContext()` THREW without a provider, so the guide's prop wiring
    // painted «Component "object-grid" failed to render» and `find` was 0.
    //
    // Both wirings resolve now. The prop wins because it is the more specific
    // signal — written on this one placement, against a provider that applies to
    // every descendant. That precedence is not new (the adapter already reached
    // `ObjectGrid` through `{...props}`, spread last, whenever a provider
    // existed); it is now stated instead of being an accident of spread order.
    const [first] = GRID_SNIPPETS;

    const propOnly = makeAdapter();
    const { unmount } = render(<SchemaRenderer schema={first} dataSource={propOnly as any} />);
    await waitFor(() => expect(propOnly.find).toHaveBeenCalledTimes(1));
    unmount();

    const ambient = makeAdapter();
    const explicit = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={ambient as any}>
        <SchemaRenderer schema={first} dataSource={explicit as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(explicit.find).toHaveBeenCalledTimes(1));
    expect(ambient.find).not.toHaveBeenCalled();
  });

  it('the page injects the adapter once, above the blocks, and on no block itself', () => {
    const src = fs.readFileSync(GUIDE, 'utf8');
    expect(src).toContain('<SchemaRendererProvider dataSource={dataSource}>');
    // AGENTS.md commandment #1 is the injection pattern; a `dataSource` written
    // on a `SchemaRenderer` in this page is the wiring #5378 measured as dead.
    // `\s` after the name is what keeps `<SchemaRendererProvider …>` out of the set.
    const calls = src.match(/<SchemaRenderer\s[\s\S]*?\/>/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => /\bdataSource=/.test(c))).toEqual([]);
  });
});

describe('object-grid — a block that resolves no adapter says so (objectui#5378 item 2)', () => {
  it('reports "No data source resolved" instead of an empty grid', async () => {
    const { findByTestId } = render(
      <SchemaRenderer schema={{ type: 'object-grid', objectName: 'task' } as any} />,
    );
    const panel = await findByTestId('object-grid-no-data-source');
    expect(panel).toHaveAttribute('role', 'alert');
    // The message has to be an ADDRESS, not a symptom: it names the block, the
    // object it was about to read, and the ancestor that injects the adapter.
    expect(panel.textContent).toContain('object-grid');
    expect(panel.textContent).toContain('task');
    expect(panel.textContent).toContain('SchemaRendererProvider');
  });

  it('stays silent for inline rows, which need no adapter', async () => {
    const { queryByTestId, container } = render(
      <SchemaRenderer
        schema={{
          type: 'object-grid',
          objectName: 'task',
          data: { provider: 'value', items: [ROW] },
        } as any}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('Write the guide'));
    expect(queryByTestId('object-grid-no-data-source')).toBeNull();
  });

  it('stays silent when a HOST owns the fetch and hands the window down as a prop', async () => {
    // `plugin-list`'s ListView renders this block through `SchemaRenderer` with
    // `data` as a REACT prop. An empty first window is a host still fetching —
    // presence of the prop is the signal, never its truthiness.
    const { queryByTestId } = render(
      <SchemaRenderer schema={{ type: 'object-grid', objectName: 'task' } as any} data={[]} />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(queryByTestId('object-grid-no-data-source')).toBeNull();
  });
});

describe('object-grid — Step 7’s rewritten dataSource binding actually changes find() (objectui#5446)', () => {
  // Control: reproduces the card's own two-row table. The OLD Step 7 shape —
  // a top-level `view` plus a `data.queryParams.$search` that is not a
  // `ViewData` arm — versus the same query with both keys dropped. Neither is
  // read by `ObjectGrid`, so `find`'s params must come out identical. This is
  // the proof the measuring instrument below actually detects a difference
  // when the guide's rewritten form causes one.
  it('control: the old inert `view` + `data.queryParams` shape changes nothing', async () => {
    const withInertKeys = {
      type: 'object-grid',
      objectName: 'task',
      view: 'active',
      data: { objectSchema: TASK_SCHEMA, queryParams: { $search: 'foo' } },
    };
    const withoutThem = { type: 'object-grid', objectName: 'task' };

    const adapterA = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapterA as any}>
        <SchemaRenderer schema={withInertKeys as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(adapterA.find).toHaveBeenCalledTimes(1));
    const paramsA = adapterA.find.mock.calls[0][1];
    cleanup();

    const adapterB = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapterB as any}>
        <SchemaRenderer schema={withoutThem as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(adapterB.find).toHaveBeenCalledTimes(1));
    const paramsB = adapterB.find.mock.calls[0][1];

    expect(paramsA).toEqual(paramsB);
    expect(paramsA.$filter).toBeUndefined();
    expect(paramsA.$orderby).toBeUndefined();
  });

  it('the guide’s own Step 7 literal DOES change find() params — same schema object, two view names', async () => {
    // The literal the published page hands a reader, read out of the doc the
    // same way the rest of this file does — not a hand-rolled analog.
    const [step7] = guideSchemas('object-grid').slice(2);
    expect(step7.dataSource).toEqual({ object: 'task', view: 'all' });

    const allView = { ...step7, dataSource: { ...step7.dataSource, view: 'all' } };
    const adapterAll = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapterAll as any}>
        <SchemaRenderer schema={allView as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(adapterAll.find).toHaveBeenCalledTimes(1));
    const paramsAll = adapterAll.find.mock.calls[0][1];
    cleanup();

    // Simulates clicking the "Active" switcher button: `activeView` becomes
    // 'active', re-evaluating the SAME schema literal with a different view.
    const activeView = { ...step7, dataSource: { ...step7.dataSource, view: 'active' } };
    const adapterActive = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapterActive as any}>
        <SchemaRenderer schema={activeView as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(adapterActive.find).toHaveBeenCalledTimes(1));
    const paramsActive = adapterActive.find.mock.calls[0][1];

    // `all` has no filter/sort of its own — same shape as the inert-key
    // control above, which is exactly the point: a correctly-resolved default
    // view is indistinguishable from "nothing was read" until you switch views.
    expect(paramsAll.$filter).toBeUndefined();
    expect(paramsAll.$orderby).toBeUndefined();
    // `active` (`status != Done`, sort `priority asc`) DOES reach the wire.
    expect(paramsActive.$filter).toEqual([['status', '!=', 'Done']]);
    expect(paramsActive.$orderby).toBe('priority asc');
    expect(paramsActive).not.toEqual(paramsAll);
  });

  it('a view name the backend does not publish renders a configuration-error panel, not a silently unfiltered grid', async () => {
    // The behavioural trade the maintainer ruled acceptable (2026-08-22):
    // `archived` is not one of `TASK_SCHEMA.listViews`'s keys.
    const [step7] = guideSchemas('object-grid').slice(2);
    const unpublished = { ...step7, dataSource: { ...step7.dataSource, view: 'archived' } };

    const adapter = makeAdapter();
    const { findByTestId } = render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={unpublished as any} />
      </SchemaRendererProvider>,
    );
    const panel = await findByTestId('object-grid-datasource-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel.textContent).toContain('archived');
    // Explicit failure, not a wider answer: the grid never queried at all.
    await new Promise((r) => setTimeout(r, 20));
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('with no adapter at all, the binding-only schema still fails loudly — no silent empty grid', async () => {
    const [step7] = guideSchemas('object-grid').slice(2);
    const { container, queryByTestId } = render(<SchemaRenderer schema={step7 as any} />);
    await new Promise((r) => setTimeout(r, 50));
    // Whichever panel this path takes (`object-grid` carries no `objectName`
    // of its own here, only `dataSource.object`, so the "no data source"
    // panel's `requiresDataSource` check does not fire the way it does for
    // Steps 5/6 — the binding's own "cannot list saved views" report takes
    // over instead), it must not be a blank/empty grid.
    expect(container.textContent).not.toContain('Write the guide');
    expect(
      queryByTestId('object-grid-no-data-source') ?? queryByTestId('object-grid-datasource-error'),
    ).not.toBeNull();
  });
});
