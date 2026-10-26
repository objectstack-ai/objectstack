/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9925 — `object-kanban` spent its row cap with a bare `??`, and `??`
 * rejects only `null`/`undefined`, so a value the contract refuses survived as
 * a real fetch window and reached the adapter as `$top`.
 *
 * ## Why "refuse it" is not this file inventing a meaning
 *
 * `@objectstack/spec` already answers what `limit: 0` means. The
 * `object-kanban` props declare the member a POSITIVE INTEGER
 * (`z.number().int().positive().optional()`), and the element data source
 * `limit` a `dataSource` binding lowers into this same key is declared positive
 * as well. So `0` is not a spelling whose meaning a consumer may choose; it is
 * a value the contract refuses.
 *
 * ## BOTH entrances, because there are two and only one of them has a gate
 *
 * The board reads ONE key, `schema.limit`, and two different authoring shapes
 * fill it: a `dataSource` binding lowers a named view's `pagination.pageSize`
 * into it before this component sees it, and a board with NO binding at all
 * carries the authored `limit` straight through. A repair at the lowering layer
 * closes only the first. Every refusal row below is therefore run twice, once
 * per entrance, and the two are asserted separately rather than in one loop
 * whose failure would not say which entrance broke.
 *
 * ## What the assertions are, and what each control buys
 *
 * The subject is the RELATION, never a literal: a refused value does not reach
 * `$top` and the site's own default does. Each refusal is paired with a control
 * that must NOT fire, so a board that simply ignores the member and always
 * sends its default cannot pass for a measurement, and an always-on diagnostic
 * cannot pass for a diagnosis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { DEFAULT_KANBAN_FETCH_BATCH_SIZE } from '../ObjectKanban';
// Registers `object-kanban` (and the ElementDataSourceGate wiring that carries
// the bound entrance).
import '../index';
// The lane titles render inside `KanbanRenderer`'s `React.lazy` boundary;
// importing the chunk at module scope bills the cold transform to the import
// phase instead of racing a `waitFor` budget (the objectui#3010 rule).
import '../KanbanImpl';

const LANES = [
  { id: 'open', title: 'Open' },
  { id: 'won', title: 'Won' },
];

/** The three values `??` and the resolver DISAGREE about. */
const REFUSED = [0, -5, 2.5];

/**
 * A view whose `pagination.pageSize` is what the binding lowers into
 * `schema.limit`. Built per test so each row can name its own page size.
 */
const viewWithPageSize = (pageSize: unknown) => ({
  name: 'hot',
  label: 'Hot accounts',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  pagination: { pageSize },
});

function makeAdapter(listViews: Record<string, unknown> = {}) {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', status: 'open' }] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { name: { type: 'text' }, status: { type: 'text' }, rating: { type: 'text' } },
      listViews,
    }),
  };
}

const renderBlock = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

/** Every `$top` that left this board, in call order. */
const tops = async (adapter: ReturnType<typeof makeAdapter>) => {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return adapter.find.mock.calls.map((c: any[]) => c[1]?.$top);
};

/** ENTRANCE 1 — authored `limit`, no `dataSource` binding anywhere. */
const authoredBoard = (limit: unknown) => ({
  type: 'object-kanban',
  objectName: 'account',
  groupBy: 'status',
  columns: LANES,
  ...(limit === undefined ? {} : { limit }),
});

/** ENTRANCE 2 — no authored `limit`; a bound view's page size fills the key. */
const boundBoard = () => ({
  type: 'object-kanban',
  groupBy: 'status',
  columns: LANES,
  dataSource: { object: 'account', view: 'hot' },
});

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The channel prefix the board's diagnostic carries; objectui#9853 renamed the
// board's default to a fetch batch, and the prefix with it.
const rowCapWarnings = () => warnings.filter((w) => w.includes('ObjectKanban fetch batch'));

describe('object-kanban — a row cap the contract refuses never reaches the wire (objectui#9925)', () => {
  // ── ENTRANCE 1: AUTHORED, NO BINDING ───────────────────────────────────
  describe('authored `limit`, with no `dataSource` binding at all', () => {
    it.each(REFUSED)('never sends `$top: %s`', async (bad) => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(bad), adapter);

      const sent = await tops(adapter);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent, `the authored ${bad} reached the wire`).not.toContain(bad);
      for (const top of sent) {
        expect(typeof top).toBe('number');
        expect(Number.isInteger(top)).toBe(true);
        expect(top).toBeGreaterThan(0);
      }
    });

    it.each(REFUSED)('falls back to this board’s OWN default instead of %s', async (bad) => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(bad), adapter);

      const sent = await tops(adapter);
      // The relation, not the literal: whatever this site documents as its
      // default is what a refused declaration falls back to.
      for (const top of sent) expect(top).toBe(DEFAULT_KANBAN_FETCH_BATCH_SIZE);
    });

    it('CONTROL — a legitimate authored limit still reaches `$top` unchanged', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(7), adapter);

      const sent = await tops(adapter);
      // Without this row, "never 0" is satisfied by a board that ignores the
      // member entirely and always sends its own default.
      expect(sent).toContain(7);
      expect(sent).not.toContain(DEFAULT_KANBAN_FETCH_BATCH_SIZE);
    });

    it('CONTROL — declaring no limit at all still sends the default', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(undefined), adapter);

      const sent = await tops(adapter);
      expect(sent).toContain(DEFAULT_KANBAN_FETCH_BATCH_SIZE);
    });
  });

  // ── ENTRANCE 2: A BOUND VIEW'S PAGE SIZE ───────────────────────────────
  describe('a bound view’s `pagination.pageSize`, lowered into the same key', () => {
    it.each(REFUSED)('never sends `$top: %s`', async (bad) => {
      const adapter = makeAdapter({ hot: viewWithPageSize(bad) });
      renderBlock(boundBoard(), adapter);

      const sent = await tops(adapter);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent, `the view's ${bad} reached the wire`).not.toContain(bad);
      for (const top of sent) expect(top).toBe(DEFAULT_KANBAN_FETCH_BATCH_SIZE);
    });

    it('CONTROL — a legitimate page size still becomes the board’s window', async () => {
      const adapter = makeAdapter({ hot: viewWithPageSize(7) });
      renderBlock(boundBoard(), adapter);

      const sent = await tops(adapter);
      expect(sent).toContain(7);
    });

    it('CONTROL — the view’s filter still arrives when its page size is refused', async () => {
      // ⛔ No capability removed: refusing one member must not cost the rest of
      // the binding.
      const adapter = makeAdapter({ hot: viewWithPageSize(0) });
      renderBlock(boundBoard(), adapter);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      const [object, params] = adapter.find.mock.calls[0] as [string, any];
      expect(object).toBe('account');
      expect(params.$filter).toEqual([['rating', '=', 'hot']]);
    });
  });

  // ── THE DIAGNOSTIC ─────────────────────────────────────────────────────
  describe('the diagnostic half', () => {
    it.each(REFUSED)('names this block, the object and the value %s', async (bad) => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(bad), adapter);

      await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
      const message = rowCapWarnings()[0];
      // Substituting a number the author never wrote is the quieter half of the
      // same defect; this is what makes it a diagnosis.
      expect(message).toContain('object-kanban');
      expect(message).toContain('account');
      expect(message).toContain('limit');
      expect(message).toContain(String(bad));
    });

    it('fires exactly ONCE for one declaration, across re-renders', async () => {
      const adapter = makeAdapter();
      const { rerender } = renderBlock(authoredBoard(0), adapter);

      await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
      // A fresh schema OBJECT carrying the same declaration. The effect is
      // keyed on the declared primitives, so this must say nothing more.
      rerender(
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={authoredBoard(0) as any} />
        </SchemaRendererProvider>,
      );
      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      expect(rowCapWarnings()).toHaveLength(1);
    });

    it('CONTROL — a legitimate limit produces no such diagnostic', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(7), adapter);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      // An always-on marker states nothing.
      expect(rowCapWarnings()).toHaveLength(0);
    });

    it('CONTROL — declaring no limit at all produces no diagnostic', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredBoard(undefined), adapter);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      expect(rowCapWarnings()).toHaveLength(0);
    });
  });
});
