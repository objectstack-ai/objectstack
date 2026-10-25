/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The selection bar's built-in **Delete** honours
 * `userActions.delete.visibleWhen` PER SELECTED RECORD (objectui#4420).
 *
 * The bar used to read that key as a bare boolean — bucket ∧ `userActions`
 * ∧ `apiOperations` ∧ the principal's `allowDelete`, all of which describe the
 * OBJECT — with no per-record layer at all. Tick only a record the predicate
 * excludes and the bar still offered the red Delete, and pressing it deleted
 * the record the author had written the predicate to protect. The row kebab
 * on the very same screen hid its Delete correctly, so one declared key meant
 * two different things on two surfaces.
 *
 * ## The ruled behaviour (maintainer, 2026-08-17 — behaviour 1 of three)
 *
 * Filter the operation and report the skipped: evaluate per record, run over
 * the allowed subset, report the excluded ones through `BulkActionDialog`'s
 * `bulk-skipped-notice` slot. Behaviour 2 (gate the button) and behaviour 3
 * (declare the key out of scope for sets) were rejected. So the button is
 * **never hidden or disabled** by the predicate, and an all-excluded selection
 * still opens the dialog — "a legible refusal, not a hidden button whose
 * absence is unexplained".
 *
 * ## The fixture, and which row is the excluded one
 *
 * The card's repro verbatim: `showcase_invoice` declares
 * `delete: { visibleWhen: "record.status != 'paid'" }`. **`INV-1011` is the
 * excluded row** — it is the one with `status: 'paid'`, and it is the row
 * every assertion below is really about. The all-eligible case is a deliberate
 * DEGENERATE CONTROL: its fixture has no excluded row, so it passes against
 * the unfixed code too. That is what it is for — it pins the untouched path,
 * and it is the mixed / none-eligible cases that carry the regression.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: () => true,
    }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'showcase_invoice';

/** `INV-1011` is paid — the row `visibleWhen` excludes. */
const PAID = { id: 'inv-1011', name: 'INV-1011', status: 'paid' };
/** `INV-1010` is a draft — the row `visibleWhen` admits. */
const DRAFT = { id: 'inv-1010', name: 'INV-1010', status: 'draft' };

/**
 * The object's declared per-record delete gate, in the OBJECT `userActions`
 * vocabulary (`{ enabled?, visibleWhen?, disabledWhen? }`, objectui#2614) — not
 * the VIEW's same-named toolbar block.
 */
const DELETE_VISIBLE_WHEN = { visibleWhen: "record.status != 'paid'" };

interface Harness {
  onBulkDelete: ReturnType<typeof vi.fn>;
  dataSource: any;
}

function renderGrid(opts: {
  rows: Array<Record<string, unknown>>;
  /** Omit to declare NO per-record gate — the ungated control. */
  userActionsDelete?: unknown;
}): Harness {
  const onBulkDelete = vi.fn();
  const dataSource: any = {
    find: vi.fn(async () => ({
      data: opts.rows.map(r => ({ ...r })),
      total: opts.rows.length,
      hasMore: false,
      pageSize: 50,
    })),
    delete: vi.fn(async () => ({ success: true })),
    update: vi.fn(async () => ({ success: true })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Number' },
        status: { type: 'text', label: 'Status' },
      },
      ...(opts.userActionsDelete === undefined
        ? {}
        : { userActions: { delete: opts.userActionsDelete } }),
    }),
  };
  render(
    <ObjectGrid
      schema={{
        type: 'object-grid',
        objectName: OBJECT,
        columns: [{ field: 'name', label: 'Number' }],
        pagination: { pageSize: 50 },
        operations: { delete: true },
      } as any}
      dataSource={dataSource}
      // Both handlers wired: `onDelete` is the row kebab's, `onBulkDelete` the
      // bar's. They are separate callbacks on purpose — the bulk gate must not
      // be judged by whether the ROW handler happens to be present.
      onDelete={() => {}}
      onBulkDelete={onBulkDelete}
    />,
  );
  return { onBulkDelete, dataSource };
}

/** Every `role="checkbox"` on screen; index 0 is the header's select-all. */
function checkboxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
}

/** Render, wait for rows AND the async object-schema fetch, then tick rows. */
async function renderAndSelect(
  opts: Parameters<typeof renderGrid>[0] & { selectRowNames: string[] },
): Promise<Harness> {
  const harness = renderGrid(opts);
  for (const row of opts.rows) {
    await waitFor(() => expect(screen.getByText(String(row.name))).toBeInTheDocument());
  }
  // The delete affordance is derived from `getObjectSchema`, so an assertion
  // taken before it lands would read the pre-fetch (underived) state.
  await waitFor(() => expect(checkboxes().length).toBeGreaterThan(opts.rows.length));
  const all = checkboxes();
  for (const name of opts.selectRowNames) {
    const index = opts.rows.findIndex(r => r.name === name);
    // +1 skips the header select-all checkbox.
    fireEvent.click(all[index + 1]);
  }
  return harness;
}

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * Nothing below asks for a security verdict, yet every run opened a REAL TCP
 * connection to `http://localhost:3000`. Traced with a stack probe on the
 * network-escape guard's attribution point:
 *
 *   ObjectGrid                packages/plugin-grid/src/ObjectGrid.tsx:1407
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
 * value at every read site. The subject of this file is the OBJECT's declared `userActions.delete.visibleWhen` predicate, a layer above the record verdict and evaluated without it.
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
  vi.clearAllMocks();
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

describe('selection-bar Delete vs `userActions.delete.visibleWhen` (objectui#4420)', () => {
  it('ALL-ELIGIBLE: deletes the whole selection through the host handler — the degenerate control', async () => {
    // No excluded row in this fixture, so this case passes against the unfixed
    // code as well. It is here to pin that an all-eligible selection keeps the
    // consumer's own delete flow (confirm + toast + refresh) untouched.
    const { onBulkDelete, dataSource } = await renderAndSelect({
      rows: [DRAFT, { id: 'inv-1012', name: 'INV-1012', status: 'draft' }],
      userActionsDelete: DELETE_VISIBLE_WHEN,
      selectRowNames: ['INV-1010', 'INV-1012'],
    });

    fireEvent.click(await screen.findByTestId('bulk-action-delete'));

    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));
    expect(onBulkDelete.mock.calls[0][0].map((r: any) => r.id)).toEqual(['inv-1010', 'inv-1012']);
    // Nothing was excluded, so nothing to report: no dialog interposes.
    expect(screen.queryByTestId('bulk-skipped-notice')).not.toBeInTheDocument();
    expect(dataSource.delete).not.toHaveBeenCalled();
  });

  it('MIXED: deletes only the allowed subset AND reports the skipped row', async () => {
    const { onBulkDelete, dataSource } = await renderAndSelect({
      rows: [DRAFT, PAID],
      userActionsDelete: DELETE_VISIBLE_WHEN,
      selectRowNames: ['INV-1010', 'INV-1011'],
    });

    fireEvent.click(await screen.findByTestId('bulk-action-delete'));

    // Half one — the excluded row is REPORTED, through the slot built for this
    // shape rather than by silently shrinking the count.
    expect(await screen.findByTestId('bulk-skipped-notice')).toBeInTheDocument();
    // The dialog previews what it will actually act on: the draft, not the
    // paid invoice.
    expect(screen.getByText('• INV-1010')).toBeInTheDocument();
    expect(screen.queryByText('• INV-1011')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    // Half two — the allowed subset was deleted, and ONLY it. `INV-1011` is
    // the row the predicate excludes; before this fix it was deleted too.
    await waitFor(() => expect(dataSource.delete).toHaveBeenCalledTimes(1));
    expect(dataSource.delete).toHaveBeenCalledWith(OBJECT, 'inv-1010');
    expect(dataSource.delete).not.toHaveBeenCalledWith(OBJECT, 'inv-1011');
    // The host's whole-selection handler is not the executor on this path —
    // routing back through it would confirm the same delete twice.
    expect(onBulkDelete).not.toHaveBeenCalled();
  });

  it('NONE-ELIGIBLE: the button still renders, and leads to a dialog that refuses', async () => {
    const { onBulkDelete, dataSource } = await renderAndSelect({
      rows: [DRAFT, PAID],
      userActionsDelete: DELETE_VISIBLE_WHEN,
      // The card's repro exactly: tick ONLY the paid invoice.
      selectRowNames: ['INV-1011'],
    });

    // Ruled: never hidden, never disabled by the predicate.
    const button = await screen.findByTestId('bulk-action-delete');
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    // …and the refusal is legible: the dialog opens, says what it skipped, and
    // declines to run over zero records.
    expect(await screen.findByTestId('bulk-skipped-notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(dataSource.delete).not.toHaveBeenCalled();
    expect(onBulkDelete).not.toHaveBeenCalled();
  });

  it('an object declaring NO per-record gate keeps the whole selection', async () => {
    // Control group for the fold itself: with no `visibleWhen` the partition is
    // a no-op, so the paid invoice is deleted like any other row. This is what
    // makes the exclusions above attributable to the predicate rather than to
    // some new blanket filter.
    const { onBulkDelete } = await renderAndSelect({
      rows: [DRAFT, PAID],
      selectRowNames: ['INV-1010', 'INV-1011'],
    });

    fireEvent.click(await screen.findByTestId('bulk-action-delete'));

    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));
    expect(onBulkDelete.mock.calls[0][0].map((r: any) => r.id)).toEqual(['inv-1010', 'inv-1011']);
    expect(screen.queryByTestId('bulk-skipped-notice')).not.toBeInTheDocument();
  });
});

/**
 * objectui#11322 — a BLANK `visibleWhen` on the built-in Delete keeps the
 * fold's answer: every selected record is excluded, as before.
 *
 * The same card made a blank bulk ACTION `visible` "no gate" on this bar,
 * because the action family decides "is a gate declared?" before it calls the
 * fold. This key is not an action's `visible`; it is a field-rule key, and
 * `ObjectGrid` hands it to the fold directly. If it went through the action
 * door instead, a whitespace `visibleWhen` would admit every record and hand
 * them to the host's `onBulkDelete` while the row item still hides its Delete.
 * That is the destructive widening triage ruled out. The no-gate case above is
 * the control: with nothing declared, the whole selection goes through.
 */
describe('selection-bar Delete vs a blank `visibleWhen` (objectui#11322)', () => {
  it.each([
    ['a whitespace-only string', '   '],
    ['an envelope whose `source` is whitespace', { dialect: 'cel', source: '   ' }],
  ])('%s still excludes every record: the dialog refuses, nothing is deleted', async (_label, visibleWhen) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { onBulkDelete, dataSource } = await renderAndSelect({
        rows: [DRAFT, PAID],
        userActionsDelete: { visibleWhen },
        // The draft alone: a row the real predicate above would admit, so the
        // exclusion is the blank's doing, not the record's.
        selectRowNames: ['INV-1010'],
      });

      fireEvent.click(await screen.findByTestId('bulk-action-delete'));

      expect(await screen.findByTestId('bulk-skipped-notice')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
      expect(dataSource.delete).not.toHaveBeenCalled();
      expect(onBulkDelete).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
