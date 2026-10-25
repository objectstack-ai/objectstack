/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9897 — one authored `pagination.pageSize` is resolved ONCE in this
 * view and then feeds six consumers, and `??` let a refused value through to
 * all of them.
 *
 * ## What the author suffers, measured rather than inferred
 *
 * `??` only rejects `null`/`undefined`, so an authored `pageSize: 0` was not
 * nullish and survived as a real page size. Measured in this renderer over a
 * twelve-row fixture: `$top: 0` went out on the wire, the data source was
 * asked for nothing, no rows came back, and the view drew its EMPTY STATE —
 * the child grid never rendered at all, so there was no table, no record-count
 * bar, no pager and nothing on screen naming the cause. A negative goes the
 * same way (`$top: -10`). A non-integer is worse than silent: `25.5` reached
 * the wire as `$top`, became the child grid's page size, and turning the page
 * asked for a fractional `$skip`.
 *
 * ## Why "refuse it" is not this file inventing a meaning
 *
 * `@objectstack/spec` already answers what `pageSize: 0` means. Its view
 * pagination config declares the member a positive integer with a default, and
 * its own suite pins the refusal under the names `should reject zero pageSize`
 * and `should reject negative pageSize`. The `limit` that this package's
 * `ElementDataSourceMapping` lowers `pagination.pageSize` into is declared
 * positive as well. So `0` is not a spelling whose meaning a consumer may
 * choose; it is a value the contract refuses.
 *
 * ## What is pinned, and why each consumer gets its own assertion
 *
 * A pin that reddens on one consumer and tolerates the others is the shape
 * triage warned about on the sibling card, so the wire, the window step, the
 * hand-off to the child grid, the on-screen record cap and the diagnostic are
 * asserted SEPARATELY. Each refusal row is paired with a control that must NOT
 * fire, so a pin that is simply always-on cannot pass for a measurement.
 *
 * ⚠️ The values are chosen for what the two spellings DISAGREE about. At this
 * view's single read point the operator is `??`, which passes `0`, `-10` and
 * `25.5` alike, so all three disagree with the resolver — unlike the sibling's
 * flat `||` site, where `0` was already falsy and no assertion about `0` could
 * redden it. The truthy-invalid rows are kept regardless: they are the ones
 * that reach the screen instead of being swallowed by an empty state.
 *
 * ## Test-source note
 *
 * `plugin-grid` is not a dependency of `plugin-list` (cycle), so the child
 * `object-grid` is a registry stub that records the props this view hands it —
 * the same arrangement `ListView.serverPagination.test.tsx` uses. The view
 * itself, its `SchemaRenderer` hand-off and the registry are all real.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const TOTAL = 12;

/** Records the props this view hands the child grid on the most recent render. */
let lastGridProps: any = null;

/**
 * A data source that honours `$top` the way a server does: asked for nothing,
 * it returns nothing. `$top` and `$skip` are recorded verbatim, so the wire
 * assertions read the value that actually left this view rather than an
 * internal one.
 */
function makeDataSource(opts: { ignoreTop?: boolean } = {}) {
  const calls: Array<Record<string, any>> = [];
  const find = vi.fn(async (_object: string, params: any) => {
    calls.push(params);
    const skip = params.$skip ?? 0;
    const top = params.$top;
    const window = opts.ignoreTop
      ? TOTAL
      : (typeof top === 'number' && top > 0 ? Math.floor(top) : 0);
    const rows = Array.from(
      { length: Math.max(0, Math.min(window, TOTAL - Math.max(0, Math.floor(skip)))) },
      (_, i) => ({ id: `id-${skip + i}`, name: `Row ${skip + i}` }),
    );
    return { data: rows, total: TOTAL };
  });
  return {
    calls,
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

let prevObjectGrid: any;
let prevObjectGallery: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
  // The record-cap rows below mount the gallery view, which lives in this same
  // package but is reached through the registry; stubbing it keeps those rows
  // measuring the cap this view renders rather than a "component not
  // registered" placeholder.
  prevObjectGallery = ComponentRegistry.get('object-gallery');
  ComponentRegistry.register('object-gallery', () => <div data-testid="gallery-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
  if (prevObjectGallery) ComponentRegistry.register('object-gallery', prevObjectGallery);
  else ComponentRegistry.unregister('object-gallery');
});

let warnings: string[] = [];
beforeEach(() => {
  lastGridProps = null;
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  cleanup();
  lastGridProps = null;
  vi.restoreAllMocks();
});

const pageSizeWarnings = () =>
  warnings.filter((w) => w.includes('ListView pagination'));

const renderList = (schemaExtra: Record<string, unknown>, ds: any) =>
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{
          type: 'list-view',
          objectName: 'task',
          fields: ['name'],
          ...schemaExtra,
        } as any}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );

const tops = (ds: any) => ds.calls.map((p: any) => p.$top);

describe('ListView — a page size the contract refuses never reaches its consumers (objectui#9897)', () => {
  // ── CONSUMER 1: THE WIRE ────────────────────────────────────────────────
  it('never sends `$top: 0` when the author declares `pagination.pageSize: 0`', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 0 } }, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(tops(ds).length).toBeGreaterThan(0);
    expect(
      tops(ds),
      'the authored 0 reached the wire and the list asked the server for nothing',
    ).not.toContain(0);
    for (const top of tops(ds)) {
      expect(typeof top).toBe('number');
      expect(Number.isInteger(top)).toBe(true);
      expect(top).toBeGreaterThan(0);
    }
  });

  it('never sends a negative or fractional `$top` either', async () => {
    for (const bad of [-10, 25.5]) {
      const ds = makeDataSource();
      renderList({ pagination: { pageSize: bad } }, ds);
      await waitFor(() => expect(ds.find).toHaveBeenCalled());
      expect(tops(ds), `pageSize: ${bad} reached the wire`).not.toContain(bad);
      for (const top of tops(ds)) {
        expect(Number.isInteger(top)).toBe(true);
        expect(top).toBeGreaterThan(0);
      }
      cleanup();
      warnings = [];
    }
  });

  it('CONTROL — a valid page size does reach the wire as `$top`', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 5 } }, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // Without this row, "never 0" is satisfied by a view that ignores the
    // member entirely and always sends its own default.
    expect(tops(ds)).toContain(5);
  });

  // ── CONSUMER 2: THE ROWS THAT COME BACK, COUNTED ───────────────────────
  it('still renders the rows when the author declares `pagination.pageSize: 0`', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 0 } }, ds);

    // Before this change the fetch returned nothing, so `data.length === 0`
    // took the empty-state branch and the child grid never rendered at all.
    await waitFor(() => expect(lastGridProps).not.toBeNull());
    expect(
      lastGridProps.data?.length,
      'the list drew its empty state because it asked the server for zero rows',
    ).toBe(TOTAL);
  });

  // ── CONSUMER 3: THE HAND-OFF TO THE CHILD GRID ─────────────────────────
  it('never hands the child grid a refused `pageSize`', async () => {
    for (const bad of [0, 25.5]) {
      const ds = makeDataSource({ ignoreTop: true });
      renderList({ pagination: { pageSize: bad } }, ds);
      await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
      expect(
        lastGridProps.pageSize,
        `pageSize: ${bad} became the child grid's page size`,
      ).not.toBe(bad);
      expect(Number.isInteger(lastGridProps.pageSize)).toBe(true);
      expect(lastGridProps.pageSize).toBeGreaterThan(0);
      cleanup();
      lastGridProps = null;
      warnings = [];
    }
  });

  it('CONTROL — a valid page size is handed to the child grid unchanged', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 5 } }, ds);

    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(lastGridProps.pageSize).toBe(5);
  });

  // ── CONSUMER 4: THE WINDOW STEP (`$skip`) ──────────────────────────────
  it('turns the page by a whole-number window step', async () => {
    const ds = makeDataSource({ ignoreTop: true });
    renderList({ pagination: { pageSize: 25.5 } }, ds);

    await waitFor(() => expect(lastGridProps?.onPageChange).toBeTypeOf('function'));
    await act(async () => {
      lastGridProps.onPageChange(2);
    });
    await waitFor(() => expect(ds.calls.length).toBeGreaterThan(1));
    const skips = ds.calls.map((p: any) => p.$skip).filter((s: any) => s !== undefined);
    expect(skips.length).toBeGreaterThan(0);
    for (const skip of skips) {
      // `(page - 1) * 25.5` is the fractional offset the old chain produced.
      expect(Number.isInteger(skip), `a fractional $skip (${skip}) left this view`).toBe(true);
    }
  });

  // ── CONSUMER 5: THE RECORD CAP ON SCREEN ───────────────────────────────
  it('never prints a refused page size as the on-screen record cap', async () => {
    // A view that does not page server-side (gallery) shows the
    // "showing first N" cap, and N is this same resolved page size. The data
    // source ignores `$top` here, which is what makes the cap reachable: the
    // rows come back regardless, so the banner renders and states its limit.
    //
    // ⚠️ The value is `2.5` and not `25.5` DELIBERATELY, and the first draft of
    // this row got it wrong. The cap only renders when the rows that came back
    // reach it (`items.length >= size`), so with twelve rows a size of `25.5`
    // suppressed the banner entirely and the row passed against the UNFIXED
    // source — a green that measured nothing. `2.5` is below the row count, so
    // the banner renders and prints the refused number.
    const ds = makeDataSource({ ignoreTop: true });
    const { container } = renderList(
      { viewType: 'gallery', pagination: { pageSize: 2.5 } },
      ds,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-count-bar"]')).toBeTruthy(),
    );
    expect(
      container.textContent ?? '',
      'the refused page size was printed to the reader as the record cap',
    ).not.toContain('2.5');
  });

  it('CONTROL — a valid page size still prints as the record cap', async () => {
    const ds = makeDataSource({ ignoreTop: true });
    const { container } = renderList(
      { viewType: 'gallery', pagination: { pageSize: 5 } },
      ds,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="data-limit-warning"]')).toBeTruthy(),
    );
    // Without this row, "never 25.5" is satisfied by a banner that never
    // states any limit at all.
    expect(
      container.querySelector('[data-testid="data-limit-warning"]')?.textContent ?? '',
    ).toContain('5');
  });

  // ── CONSUMER 6: THE RUNTIME CHOICE, NOT ONLY THE AUTHORED ONE ──────────
  it('refuses a non-positive size chosen through the rows-per-page control', async () => {
    // `pageSizeOptions` is authored metadata too, so an author can put a
    // refused number in the control itself; choosing it used to overwrite a
    // perfectly good authored size with `0`.
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 5, pageSizeOptions: [0, 5, 25] } }, ds);

    await waitFor(() => expect(lastGridProps?.onPageSizeChange).toBeTypeOf('function'));
    await act(async () => {
      lastGridProps.onPageSizeChange(0);
    });
    await waitFor(() => expect(ds.calls.length).toBeGreaterThan(1));
    expect(tops(ds)).not.toContain(0);
    for (const top of tops(ds)) expect(top).toBeGreaterThan(0);
  });

  it('CONTROL — a valid size chosen through that control does reach the wire', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 5, pageSizeOptions: [5, 25] } }, ds);

    await waitFor(() => expect(lastGridProps?.onPageSizeChange).toBeTypeOf('function'));
    await act(async () => {
      lastGridProps.onPageSizeChange(25);
    });
    await waitFor(() => expect(tops(ds)).toContain(25));
  });

  // ── THE DIAGNOSTIC ─────────────────────────────────────────────────────
  it('says so, naming the member and the value it refused', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 0 } }, ds);

    await waitFor(() => expect(pageSizeWarnings().length).toBeGreaterThan(0));
    const message = pageSizeWarnings()[0];
    // Dropping the value and substituting a number the author never wrote is
    // the quieter half of the same defect; this is what makes it a diagnosis.
    expect(message).toContain('pageSize');
    expect(message).toContain('0');
  });

  it('names a negative and a non-integer the same way', async () => {
    for (const bad of [-10, 25.5]) {
      const ds = makeDataSource({ ignoreTop: true });
      renderList({ pagination: { pageSize: bad } }, ds);
      await waitFor(() => expect(pageSizeWarnings().length).toBeGreaterThan(0));
      expect(pageSizeWarnings()[0]).toContain(String(bad));
      cleanup();
      warnings = [];
    }
  });

  it('CONTROL — a valid page size produces no such diagnostic', async () => {
    const ds = makeDataSource();
    renderList({ pagination: { pageSize: 5 } }, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // An always-on marker states nothing.
    expect(pageSizeWarnings()).toHaveLength(0);
  });

  it('CONTROL — declaring no pagination at all produces no diagnostic', async () => {
    const ds = makeDataSource();
    renderList({}, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(pageSizeWarnings()).toHaveLength(0);
  });
});
