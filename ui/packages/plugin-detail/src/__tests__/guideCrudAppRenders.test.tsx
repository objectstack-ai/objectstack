/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5378 item 1 — `detail-view` resolves its adapter the way its siblings
 * do, and the getting-started guide's own `detail-view` snippet is RENDERED here.
 *
 * ## The split this closes
 *
 * `object-grid` and `object-form` are registered through wrappers that read the
 * adapter from `SchemaRendererContext`. `detail-view` was registered as the RAW
 * `DetailView`, which reads a React `dataSource` PROP. `SchemaRenderer` itself
 * reads only context, so the two wirings were mutually exclusive and a page
 * could satisfy exactly one of them. Measured on `origin/main`, keys held
 * correct in every cell:
 *
 * | wiring                                  | `object-grid` | `detail-view` |
 * |-----------------------------------------|---------------|---------------|
 * | `SchemaRendererProvider dataSource={…}`  | `find` 1      | `findOne` 0   |
 * | `SchemaRenderer dataSource={…}` (prop)   | `find` 0      | `findOne` 1   |
 *
 * Neither cell reported anything. The whole page could therefore be wired
 * "correctly" and still render half of itself as an empty shell.
 *
 * ## What is pinned below
 *
 * The maintainer ruling of 2026-08-20 made the wrapper ADDITIVE — the
 * `dataSource`-prop form stays accepted, no prop is removed — so all three
 * wirings are asserted: context alone (the new one), prop alone (the one that
 * must not break), and both at once, where the explicit prop wins because it is
 * the more specific signal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold `detail-view` and the
// field widgets it renders into before the first render (AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';

const GUIDE = path.resolve(__dirname, '../../../../content/docs/guide/building-crud-app.md');

const TASK_SCHEMA = {
  name: 'task',
  label: 'Task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
};

const RECORD = { id: '42', title: 'Write the guide', status: 'Todo' };

/** See the twin helper in `plugin-grid`'s probe — same rule, same reason. */
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
    out.push(
      new Function(
        'TaskSchema', 'editId', 'taskId', 'activeView', 'searchQuery',
        `return (${src.slice(start, end + 1)});`,
      )(TASK_SCHEMA, '42', '42', 'all', ''),
    );
  }
  return out;
}

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [RECORD], total: 1 }),
    findOne: vi.fn().mockResolvedValue(RECORD),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(TASK_SCHEMA),
  };
}

const DETAIL_SNIPPETS = guideSchemas('detail-view');
const SNIPPET = DETAIL_SNIPPETS[0];

/* ─────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's TWO network escapes, both served here.
 *
 * Nothing below asks for a security verdict or for a REST record, yet every run
 * opened real TCP connections to `http://localhost:3000`. Traced with a stack
 * probe on the network-escape guard's attribution point (measured, not
 * inferred) — this file is the only one in its batch that reaches two routes:
 *
 *   SchemaRenderer -> the guide's `detail-view` snippet
 *     -> DetailView           packages/plugin-detail/src/DetailView.tsx:290, :296
 *       -> useRecordEditable  packages/plugin-detail/src/useRecordEditable.ts:76
 *         -> `const doFetch = apiFetch ?? fetch`      [escape 1, 12 calls]
 *           POST /api/v1/security/explain  (twice per render: edit, then delete)
 *
 *   the `api`-sourced case at the bottom of this file
 *     -> DetailView           packages/plugin-detail/src/DetailView.tsx:616
 *       -> `fetch(`${schema.api}/${schema.resourceId}`)`   [escape 2, 1 call]
 *         GET /api/task/42
 *
 * `useRecordEditable` reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no host supplying one, degrades to the
 * GLOBAL `fetch` by design — a standalone embed must keep rendering rather than
 * crash. `DetailView`'s `api` branch has no such seam at all: it calls the
 * global directly. Under happy-dom that global is a real HTTP client and the
 * document URL defaults to `http://localhost:3000`, so both relative paths
 * resolved to live requests. Both reads are best-effort (each failure is
 * caught), which is why the cases below stayed green while the requests always
 * failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and by
 * this burn-down's earlier batches (see
 * `packages/plugin-gantt/src/ObjectGantt.navWidthDefault.test.tsx`).
 * Deliberately NOT a blanket network stub: it records every URL it is handed and
 * `afterEach` fails on any URL outside the set it serves, so an escape to
 * somewhere else reds here instead of vanishing into one of those `catch`es.
 *
 * What it answers, and why that changes no assertion here:
 *
 *   - `/api/v1/security/explain` — the permissive verdict, in the two response
 *     shapes the two explain hooks read: `{ record: { visible } }` for a single
 *     `recordId` and `{ records: [{ recordId, visible }] }` for a batched
 *     `recordIds`. Only the first is reached from this file; the batched branch
 *     is kept so this router stays byte-identical to its siblings in this batch.
 *     `useRecordEditable` initialises `allowed` to `true` and its failure path
 *     leaves it there, so `true` and the absent verdict the failing request
 *     produced are the same value at every read site.
 *   - `/api/task/42` — the RECORD, which is the shape its reader consumes:
 *     `DetailView` does `res.json()` then `setData(result?.data || result)`.
 *     The one case that reaches it asserts only that the "No data source
 *     resolved" panel stays absent, and that panel is a WIRING gate
 *     (`ElementDataSourceGate`) decided before any response arrives — it is
 *     absent here because the block declares `api`, not because the request
 *     failed. Serving the record therefore exercises the success path this
 *     route always had, without moving any assertion.
 * ─────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';

/** `DetailView`'s `api`-sourced read — `${schema.api}/${schema.resourceId}`. */
const RECORD_ROUTE = '/api/task/42';

const SERVED_ROUTES: readonly string[] = [EXPLAIN_ROUTE, RECORD_ROUTE];

/** Every URL this file's renders handed the global `fetch`, in request order. */
let servedCalls: string[] = [];

/** Serve both routes; record everything; 404 anything else. */
function installFetchDouble() {
  servedCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      servedCalls.push(url);
      if (url === RECORD_ROUTE) return { ok: true, status: 200, json: async () => RECORD };
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      let body: { recordId?: unknown; recordIds?: unknown } = {};
      try {
        body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      } catch {
        /* a non-JSON body is not a request this route can answer */
      }
      const recordIds = Array.isArray(body.recordIds) ? body.recordIds : null;
      return {
        ok: true,
        status: 200,
        json: async () =>
          recordIds
            ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
            : { record: { visible: true } },
      };
    }),
  );
}

beforeEach(() => {
  cleanup();
  installFetchDouble();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into one of the readers' best-effort `catch`es.
  expect(servedCalls.filter((url) => !SERVED_ROUTES.includes(url))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a verdict effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('guide/building-crud-app.md — the `detail-view` snippet actually renders', () => {
  it('publishes exactly one detail snippet', () => {
    expect(DETAIL_SNIPPETS).toHaveLength(1);
  });

  it('loads the record under the PROVIDER wiring — the convergence', async () => {
    // This is the cell that was `findOne` 0 before the wrapper existed.
    const adapter = makeAdapter();
    const { container } = render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={SNIPPET} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(adapter.findOne).toHaveBeenCalledTimes(1));
    expect(adapter.findOne.mock.calls[0].slice(0, 2)).toEqual(['task', '42']);
    await waitFor(() => expect(container.textContent).toContain('Write the guide'));
  });

  it('still loads it under the PROP wiring — the ruling kept that form accepted', async () => {
    const adapter = makeAdapter();
    const { container } = render(<SchemaRenderer schema={SNIPPET} dataSource={adapter as any} />);

    await waitFor(() => expect(adapter.findOne).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.textContent).toContain('Write the guide'));
  });

  it('lets the explicit prop win when both are present', async () => {
    const ambient = makeAdapter();
    const explicit = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={ambient as any}>
        <SchemaRenderer schema={SNIPPET} dataSource={explicit as any} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(explicit.findOne).toHaveBeenCalledTimes(1));
    expect(ambient.findOne).not.toHaveBeenCalled();
  });

  it('sources the record id from `resourceId` — `recordId` loads nothing here', async () => {
    // objectui#5377's correction, pinned so it cannot be lost again: the
    // `recordId` → `resourceId` rename is right ONLY for this block.
    // `object-form` genuinely reads `recordId`, and a blanket rename across the
    // guide's five snippets would have broken the form instead.
    const asItWas = { ...SNIPPET, recordId: SNIPPET.resourceId };
    delete asItWas.resourceId;

    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={asItWas} />
      </SchemaRendererProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.findOne).not.toHaveBeenCalled();
  });

  it('names the object with `objectName` — `object` loads nothing', async () => {
    const asItWas = { ...SNIPPET, object: SNIPPET.objectName };
    delete asItWas.objectName;

    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={asItWas} />
      </SchemaRendererProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.findOne).not.toHaveBeenCalled();
  });

  it('carries no `data` — on this block `data` MEANS "already loaded, do not fetch"', async () => {
    // Why the guide's `data: { objectSchema: TaskSchema }` had to go from this
    // snippet and not merely be re-spelled: `DetailView` returns early on any
    // `schema.data`, so the object's METADATA was being installed as the record
    // and `findOne` never ran. Inert on `object-grid`, load-bearing here — which
    // is why each snippet was judged on its own rather than swept.
    expect(SNIPPET.data).toBeUndefined();

    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={{ ...SNIPPET, data: { objectSchema: TASK_SCHEMA } }} />
      </SchemaRendererProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.findOne).not.toHaveBeenCalled();
  });
});

describe('detail-view — a block that resolves no adapter says so (objectui#5378 item 2)', () => {
  it('reports "No data source resolved" instead of rendering nothing at all', async () => {
    const { findByTestId } = render(<SchemaRenderer schema={SNIPPET} />);
    const panel = await findByTestId('detail-view-no-data-source');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel.textContent).toContain('detail-view');
    expect(panel.textContent).toContain('task');
    expect(panel.textContent).toContain('SchemaRendererProvider');
  });

  it('stays silent for an inline record, which needs no adapter', async () => {
    const { queryByTestId, container } = render(
      <SchemaRenderer
        schema={{ type: 'detail-view', objectName: 'task', resourceId: '42', data: RECORD } as any}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('Write the guide'));
    expect(queryByTestId('detail-view-no-data-source')).toBeNull();
  });

  it('stays silent for an `api`-sourced record, which fetches without an adapter', async () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        schema={{ type: 'detail-view', objectName: 'task', resourceId: '42', api: '/api/task' } as any}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(queryByTestId('detail-view-no-data-source')).toBeNull();
  });
});
