/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9925 — `object-timeline` spent its row cap with a bare `??`, and
 * `??` rejects only `null`/`undefined`, so a value the contract refuses
 * survived as a real fetch window and reached the adapter as `$top`.
 *
 * ## Why "refuse it" is not this file inventing a meaning
 *
 * The element data source `limit` a `dataSource` binding lowers into
 * `schema.limit` is declared a POSITIVE INTEGER by `@objectstack/spec`
 * (`z.number().int().positive().optional()`), and so is the
 * `pagination.pageSize` of a named view that fills it. So `0` is not a spelling
 * whose meaning a consumer may choose; it is a value the contract refuses.
 *
 * ⚠️ This renderer's own `TimelineExtensionSchema.safeParse` is NOT that
 * refusal and cannot be read as one: it declares no `limit` member and is a
 * non-strict object, so an authored `limit: 0` passed it in silence. The
 * control at the foot of this file pins that separation — the parse warning
 * and the row-cap warning are different messages on the same channel.
 *
 * ## BOTH entrances, because there are two and only one of them has a gate
 *
 * The rail reads ONE key, `schema.limit`, and two authoring shapes fill it: a
 * `dataSource` binding lowers a named view's `pagination.pageSize` into it, and
 * a rail with NO binding at all carries the authored `limit` straight through.
 * A repair at the lowering layer closes only the first, so every refusal row is
 * run once per entrance and the two are asserted separately.
 *
 * ## What the assertions are, and what each control buys
 *
 * The subject is the RELATION, never a literal: a refused value does not reach
 * `$top` and the site's own default does. Each refusal is paired with a control
 * that must NOT fire, so a rail that simply ignores the member cannot pass for
 * a measurement and an always-on diagnostic cannot pass for a diagnosis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { DEFAULT_TIMELINE_LIMIT } from '../ObjectTimeline';
// Registers `object-timeline` (and the ElementDataSourceGate wiring that
// carries the bound entrance).
import '../index';

const TIMELINE = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' };

/** The three values `??` and the resolver DISAGREE about. */
const REFUSED = [0, -5, 2.5];

const viewWithPageSize = (pageSize: unknown) => ({
  name: 'hot',
  label: 'Hot campaigns',
  columns: ['name', 'stage'],
  filter: [['stage', '=', 'live']],
  pagination: { pageSize },
});

function makeAdapter(listViews: Record<string, unknown> = {}) {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'campaign',
      fields: {
        name: { type: 'text' },
        stage: { type: 'text' },
        start_date: { type: 'datetime' },
        end_date: { type: 'datetime' },
      },
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

const tops = async (adapter: ReturnType<typeof makeAdapter>) => {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return adapter.find.mock.calls.map((c: any[]) => c[1]?.$top);
};

/** ENTRANCE 1 — authored `limit`, no `dataSource` binding anywhere. */
const authoredRail = (limit: unknown) => ({
  type: 'object-timeline',
  objectName: 'campaign',
  timeline: TIMELINE,
  ...(limit === undefined ? {} : { limit }),
});

/** ENTRANCE 2 — no authored `limit`; a bound view's page size fills the key. */
const boundRail = () => ({
  type: 'object-timeline',
  timeline: TIMELINE,
  dataSource: { object: 'campaign', view: 'hot' },
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

const rowCapWarnings = () => warnings.filter((w) => w.includes('ObjectTimeline row cap'));

describe('object-timeline — a row cap the contract refuses never reaches the wire (objectui#9925)', () => {
  // ── ENTRANCE 1: AUTHORED, NO BINDING ───────────────────────────────────
  describe('authored `limit`, with no `dataSource` binding at all', () => {
    it.each(REFUSED)('never sends `$top: %s`', async (bad) => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(bad), adapter);

      const sent = await tops(adapter);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent, `the authored ${bad} reached the wire`).not.toContain(bad);
      for (const top of sent) {
        expect(typeof top).toBe('number');
        expect(Number.isInteger(top)).toBe(true);
        expect(top).toBeGreaterThan(0);
      }
    });

    it.each(REFUSED)('falls back to this rail’s OWN default instead of %s', async (bad) => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(bad), adapter);

      const sent = await tops(adapter);
      for (const top of sent) expect(top).toBe(DEFAULT_TIMELINE_LIMIT);
    });

    it('CONTROL — a legitimate authored limit still reaches `$top` unchanged', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(7), adapter);

      const sent = await tops(adapter);
      expect(sent).toContain(7);
      expect(sent).not.toContain(DEFAULT_TIMELINE_LIMIT);
    });

    it('CONTROL — declaring no limit at all still sends the default', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(undefined), adapter);

      const sent = await tops(adapter);
      expect(sent).toContain(DEFAULT_TIMELINE_LIMIT);
    });
  });

  // ── ENTRANCE 2: A BOUND VIEW'S PAGE SIZE ───────────────────────────────
  describe('a bound view’s `pagination.pageSize`, lowered into the same key', () => {
    it.each(REFUSED)('never sends `$top: %s`', async (bad) => {
      const adapter = makeAdapter({ hot: viewWithPageSize(bad) });
      renderBlock(boundRail(), adapter);

      const sent = await tops(adapter);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent, `the view's ${bad} reached the wire`).not.toContain(bad);
      for (const top of sent) expect(top).toBe(DEFAULT_TIMELINE_LIMIT);
    });

    it('CONTROL — a legitimate page size still becomes the rail’s window', async () => {
      const adapter = makeAdapter({ hot: viewWithPageSize(7) });
      renderBlock(boundRail(), adapter);

      const sent = await tops(adapter);
      expect(sent).toContain(7);
    });

    it('CONTROL — the view’s filter still arrives when its page size is refused', async () => {
      // ⛔ No capability removed: refusing one member must not cost the rest of
      // the binding.
      const adapter = makeAdapter({ hot: viewWithPageSize(0) });
      renderBlock(boundRail(), adapter);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      const [object, params] = adapter.find.mock.calls[0] as [string, any];
      expect(object).toBe('campaign');
      expect(params.$filter).toEqual([['stage', '=', 'live']]);
    });
  });

  // ── THE DIAGNOSTIC ─────────────────────────────────────────────────────
  describe('the diagnostic half', () => {
    it.each(REFUSED)('names this block, the object and the value %s', async (bad) => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(bad), adapter);

      await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
      const message = rowCapWarnings()[0];
      expect(message).toContain('object-timeline');
      expect(message).toContain('campaign');
      expect(message).toContain('limit');
      expect(message).toContain(String(bad));
    });

    it('fires exactly ONCE for one declaration, across re-renders', async () => {
      const adapter = makeAdapter();
      const { rerender } = renderBlock(authoredRail(0), adapter);

      await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
      rerender(
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={authoredRail(0) as any} />
        </SchemaRendererProvider>,
      );
      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      expect(rowCapWarnings()).toHaveLength(1);
    });

    it('CONTROL — a legitimate limit produces no such diagnostic', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(7), adapter);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      expect(rowCapWarnings()).toHaveLength(0);
    });

    it('CONTROL — declaring no limit at all produces no diagnostic', async () => {
      const adapter = makeAdapter();
      renderBlock(authoredRail(undefined), adapter);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      expect(rowCapWarnings()).toHaveLength(0);
    });

    it('is a SEPARATE message from this renderer’s own config parse warning', async () => {
      // The parse above the resolver declares no `limit` and is non-strict, so
      // it says nothing about this value. Without this row, "a warning fired"
      // could be satisfied by the pre-existing parse warning.
      const adapter = makeAdapter();
      renderBlock(authoredRail(0), adapter);

      await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
      expect(
        warnings.filter((w) => w.includes('Invalid timeline configuration')),
        'the config parse refused this value, so the row-cap warning proves nothing',
      ).toHaveLength(0);
    });
  });
});
