/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5270 — a named view's `sort` is an ARRAY, and it used to be handed
 * to a slot declared to hold ONE key.
 *
 * `NamedListView.sort` is `Array< { field, order } >`. `ObjectView` forwarded
 * the resolved view sort into `gridSchema.defaultSort`, which
 * `ObjectGridSchema` declares as a single `{ field: string; order: 'asc' |
 * 'desc' }`. Nothing complained — `ObjectViewSchema.table` collapses to a bare
 * index signature (objectui#5102), so the arity mismatch had no compile-time
 * witness — and BOTH of `ObjectGrid`'s readers then failed, in different ways:
 *
 *   header  `parseSchemaSort(schemaSort ?? (schema.defaultSort ?
 *           [schema.defaultSort] : undefined))` re-wraps an already-array
 *           `defaultSort` into `[[{ field, order }]]`. `parseSchemaSort`
 *           accepts a string or an object with a string `field` per entry; a
 *           nested ARRAY is neither, so the entry is skipped and the parse
 *           returns `[]`. The user saw NO sort indicator at all.
 *   fetch   `` params.$orderby = `${(schema.defaultSort as any).field} ${…
 *           .order}` `` reads two absent keys off an array, so the request
 *           carried the literal string `"undefined undefined"`.
 *
 * The fix routes the view segments into the CANONICAL `sort` slot — the arity
 * a view actually carries, and the same spelling the shared sort sink
 * `convertSortToQueryParams` accepts (objectui#4869), so no fourth dialect is
 * introduced to make this work. (That slot was declared
 * `string | SortConfig[]` when this was written; objectui#8221 retired the
 * string arm, which changes nothing here — the array was always the arity
 * these tests are about.)
 *
 * These tests drive the REAL `ObjectGrid` rather than a probe that records the
 * forwarded schema: the defect was invisible in the forwarded object (the array
 * was right there, in the wrong slot) and only appeared at the two consumers.
 * Pinning the forwarded shape alone would have re-pinned the bug.
 *
 * Resolution note for anyone running an ablation on this file: nothing here
 * goes through a build. `../ObjectView` is a relative source import, and
 * `@object-ui/plugin-grid` / `@object-ui/components` / `@object-ui/core` are
 * aliased to each package's own `src` directory in the root
 * `vitest.config.mts`, so a stale `dist` build cannot make a reverted source
 * read green.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectView } from '../ObjectView';
import { ActionProvider } from '@object-ui/react';
import type { ObjectViewSchema } from '@object-ui/types';

// No `registerAllFields()` here, deliberately: `@object-ui/fields` is not a
// dependency of this package, and nothing asserted below needs a registered
// cell renderer. The header cells and `$orderby` are produced by ObjectGrid
// itself; an unregistered column still renders its label and its sort
// affordance.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

function makeDataSource() {
  const find = vi.fn(async () => ({
    data: [
      { id: 'a', name: 'Alpha', status: 'open' },
      { id: 'b', name: 'Beta', status: 'open' },
    ],
    total: 2,
  }));
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      label: 'Task',
      fields: {
        name: { label: 'Name', type: 'text' },
        status: { label: 'Status', type: 'text' },
      },
    })),
  } as any;
}

/** A view whose sort lives on a named `listViews` entry — the card's subject. */
const namedViewSchema = (sort: unknown): ObjectViewSchema =>
  ({
    type: 'object-view',
    objectName: 'task',
    listViews: {
      won: { label: 'Won', columns: ['name', 'status'], sort },
    },
    defaultListView: 'won',
  }) as unknown as ObjectViewSchema;

function renderView(schema: ObjectViewSchema, ds: any) {
  return render(
    <ActionProvider>
      <ObjectView schema={schema} dataSource={ds} />
    </ActionProvider>,
  );
}

const lastFindParams = (ds: any) =>
  ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) =>
    th.textContent?.includes(label),
  ) as HTMLElement;

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * Nothing below asks for a security verdict, yet every run opened a REAL TCP
 * connection to `http://localhost:3000`. Traced with a stack probe on the
 * network-escape guard's attribution point:
 *
 *   ObjectView -> ObjectGrid  packages/plugin-grid/src/ObjectGrid.tsx:1407
 *     -> useRecordCrudVerdicts  packages/plugin-grid/src/hooks/useRecordCrudVerdicts.ts:199
 *       -> `const doFetch = apiFetch ?? fetch`      <- the escape
 *         POST /api/v1/security/explain  (batched, `recordIds` per page)
 *
 * The hook reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no host supplying one, degrades to the
 * GLOBAL `fetch` by design — a standalone embed must keep rendering rather than
 * crash. Under happy-dom that global is a real HTTP client and the document URL
 * defaults to `http://localhost:3000`, so the relative path resolved to a live
 * request. The read is best-effort (a network or parse failure leaves the verdict map empty — fail open), which is why the four cases below stayed green while the request always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on and
 * `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx`
 * carries. Deliberately NOT a blanket network stub: it records every URL it is
 * handed and `afterEach` fails on any URL that is not the explain route, so an
 * escape to somewhere else reds here instead of vanishing into that `catch`.
 *
 * What it answers, and why that changes no assertion here: the permissive
 * verdict, in the two response shapes the two hooks read (ADR-0090 D6 /
 * ADR-0095 C2) — `{ record: { visible } }` for a single `recordId`,
 * `{ records: [{ recordId, visible }] }` for a batched `recordIds`.
 * `useRecordEditable` initialises `allowed` to `true` and its failure path
 * leaves it there, and the ONLY consumer of the batched lookup is
 * `resolveRowRecordCrudAffordance`, whose rule is `recordVerdict !== false` —
 * so `true` and the absent verdict the failing request produced are the same
 * value at every read site. The sort this file measures reaches the grid through the view's `listViews` entry and leaves as `$orderby`; no verdict touches that path.
 * ──────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';

/** Every URL this render handed the global `fetch`, in request order. */
let explainCalls: string[] = [];

/** Serve `POST /api/v1/security/explain` permissively; record everything. */
function installExplainDouble() {
  explainCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      explainCalls.push(url);
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
  installExplainDouble();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the hook's best-effort `catch`.
  expect(explainCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a verdict effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe("objectui#5270 — a named view's sort reaches the grid", () => {
  it('draws the declared sort indicator before anyone clicks', async () => {
    // Half one. The array used to be re-wrapped to `[[…]]` and parsed to `[]`,
    // so the column the view was sorted by showed no arrow — and the first
    // click on it then asked for `asc` on a list already ordered `desc`.
    const ds = makeDataSource();
    const { container } = renderView(
      namedViewSchema([{ field: 'name', order: 'desc' }]),
      ds,
    );
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    const name = headerCell(container, 'Name');
    expect(name).toBeTruthy();
    expect(name.querySelector('[class*="chevron-down"]')).not.toBeNull();
  });

  it('sends the declared sort as $orderby, not the string "undefined undefined"', async () => {
    // Half two. `${arr.field} ${arr.order}` on an array is two `undefined`s,
    // and the resulting `"undefined undefined"` reached the wire verbatim —
    // `serializeOrderBy` passes a non-empty string through untouched, so the
    // server got an unparseable sort rather than none.
    const ds = makeDataSource();
    renderView(namedViewSchema([{ field: 'name', order: 'desc' }]), ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toBe('name desc');
    });
    expect(lastFindParams(ds).$orderby).not.toBe('undefined undefined');
    expect(String(lastFindParams(ds).$orderby)).not.toContain('undefined');
  });

  it('carries every key of a multi-key sort, which the legacy slot could not hold', async () => {
    // The arity is the whole point: `defaultSort` is ONE `{ field, order }`,
    // so a two-key view sort had nowhere to land even if the single-key case
    // had somehow been made to work.
    const ds = makeDataSource();
    const { container } = renderView(
      namedViewSchema([
        { field: 'status', order: 'asc' },
        { field: 'name', order: 'desc' },
      ]),
      ds,
    );
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toBe('status asc, name desc');
    });
    expect(headerCell(container, 'Status').querySelector('[class*="chevron-up"]')).not.toBeNull();
    expect(headerCell(container, 'Name').querySelector('[class*="chevron-down"]')).not.toBeNull();
  });

  it("a retired table.defaultSort sorts NOTHING on the real grid path — no $orderby, no arrow (objectui#5861)", async () => {
    // Flipped from `still honours a table.defaultSort when no view supplies
    // one`, which asserted `$orderby: 'name desc'` and a descending arrow. The
    // key is an ADR-0049 tombstone — `@objectstack/spec` refuses it by name on
    // `object-grid` — and objectui#5861 removed the forwarding here together
    // with `ObjectGrid`'s own fetch and header reads, so neither half of the
    // grid honours it. Driven through the REAL `ObjectGrid`, as this file's
    // header explains, because the forwarded object alone cannot show it.
    const ds = makeDataSource();
    const { container } = renderView(
      {
        type: 'object-view',
        objectName: 'task',
        table: { columns: ['name', 'status'], defaultSort: { field: 'name', order: 'desc' } },
      } as unknown as ObjectViewSchema,
      ds,
    );
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    const params = lastFindParams(ds);
    expect(Object.prototype.hasOwnProperty.call(params, '$orderby')).toBe(false);
    const name = headerCell(container, 'Name');
    expect(name.querySelector('[class*="chevron-down"]')).toBeNull();
    expect(name.querySelector('[class*="chevron-up"]')).toBeNull();
  });

  it("CONTROL — the canonical table.sort still sorts on the same real grid path", async () => {
    // Same view, the retired key's canonical successor. Green on both sides of
    // objectui#5861, which is what makes the cell above a statement about the
    // retired key rather than about sorting having stopped.
    const ds = makeDataSource();
    const { container } = renderView(
      {
        type: 'object-view',
        objectName: 'task',
        table: { columns: ['name', 'status'], sort: [{ field: 'name', order: 'desc' }] },
      } as unknown as ObjectViewSchema,
      ds,
    );
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    await waitFor(() => expect(lastFindParams(ds).$orderby).toBe('name desc'));
    expect(headerCell(container, 'Name').querySelector('[class*="chevron-down"]')).not.toBeNull();
  });
});
