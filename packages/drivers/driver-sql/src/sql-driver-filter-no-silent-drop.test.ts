// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A filter that cannot be compiled must THROW, never be skipped. (#3948)
 *
 * `applyFilters` walked the filter array and `continue`d past anything that was
 * not a join keyword or a condition array. For a BARE comparison triple —
 * `['close_date', 'before', '2024-01-01']` — the three elements are all strings,
 * so every one was skipped and **no WHERE clause was emitted at all**: the caller
 * asked to filter and silently received every row.
 *
 * ## What #5158 changed here, and what it deliberately did not
 *
 * #3948's CONDITION is unchanged and is the reason this file still exists: an
 * unapplied filter must not look like a satisfied one. What changed is WHERE
 * that condition is enforced, because the array walk it guarded is gone.
 *
 * `FilterArray` is INPUT-ONLY authoring sugar (spec `data/filter.zod.ts`,
 * #5285). Both doors into the runtime lower it through `parseFilterAST` before
 * a driver is reached — the protocol face (`metadata-protocol`) and the engine
 * (`ObjectQL`, maintainer ruling C on #5158). This driver used to carry a
 * SECOND compiler for the array spelling, including an INFIX join dialect
 * (`[condA, 'or', condB]`) that no schema declared and `parseFilterAST` cannot
 * express; cloud's `RemoteTransport.buildWhereSQL` has refused the same input
 * since cloud#1075. That fork — same query, two answers — is what the deletion
 * closes.
 *
 * So the pins below moved rather than vanished:
 *
 * | #3948 shape | refused now by |
 * |---|---|
 * | bare triple with an off-vocabulary operator | the engine door (`engine-filter-array-lowering.test.ts`), and here as an array |
 * | `[42]` / `[null]` element | same |
 * | `['and']` with nothing to join | same |
 * | unsupported operator inside a well-formed condition | THIS driver, on the lowered `FilterCondition` (below) |
 * | `[]` — "no filter" | unchanged everywhere: still no filter |
 *
 * The two cases this file used to assert COMPILED — a nested condition array
 * and an infix logical join — are the dialect itself. They are pinned as
 * refusals now, deliberately (#5158 ruling C), not dropped.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';

describe('SqlDriver rejects an uncompilable filter instead of dropping it', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
        },
      } as any,
    ]);

    await driver.create('deal', { id: '1', stage: 'won', amount: 10 });
    await driver.create('deal', { id: '2', stage: 'lost', amount: 20 });
  });

  // The cast is the point of the file: every `where` below is a shape the
  // declared contract forbids, fed in deliberately to prove the driver throws
  // rather than dropping it. `unknown` is the honest parameter type; the cast
  // is what lets an off-spec value reach a parameter that forbids it. Note
  // `FilterCondition` is an index-signature type, so an array is ASSIGNABLE to
  // it — the type layer never excluded this input, which is exactly why the
  // runtime refusal has to.
  const find = (where: unknown) =>
    driver.find('deal', { fields: ['id'], where: where as FilterCondition });

  // ── the array dialect is gone: every array shape is refused ───────────

  it.each([
    ['bare triple whose operator the AST gate refused', ['close_date', 'before', '2024-01-01']],
    ['bare triple with a bogus operator', ['stage', 'sounds_like', 'won']],
    ['element that is neither a keyword nor a condition', [42]],
    ['null element', [null]],
    ['nested condition array (the legacy compiled form)', [['stage', '=', 'won']]],
    ['infix logical join (the undeclared dialect)', [['stage', '=', 'won'], 'or', ['stage', '=', 'lost']]],
    ['logical node with nothing to join', ['and']],
  ])('refuses an array %s', async (_label, where) => {
    await expect(find(where)).rejects.toThrow(/A filter ARRAY reached the driver/);
  });

  it('does not silently return every row for any of them', async () => {
    // The original regression: before #3948 this resolved with BOTH rows.
    await expect(find(['stage', 'sounds_like', 'won'])).rejects.toThrow();
  });

  it('the refusal names the lowering, so the caller knows where the fix goes', async () => {
    const err = await find([['stage', '=', 'won']]).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('parseFilterAST');
    expect(err?.message).toContain('input-only');
    // The infix form has no lowering at all — say so, or the reader assumes
    // `parseFilterAST` would have handled it.
    expect(err?.message).toContain('prefix form');
  });

  it('carries the ADR-0112 envelope, like every sibling filter refusal', async () => {
    const err = await find([42]).then(() => null, (e: any) => e);
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
    expect(err?.message).not.toContain('[sql-driver]');
  });

  // ── what the authored shapes do instead: lower, then compile ──────────

  it('the authored nested condition compiles once lowered', async () => {
    const rows = await find(parseFilterAST([['stage', '=', 'won']]));
    expect(rows.map((r: any) => r.id)).toEqual(['1']);
  });

  it('a logical join compiles once lowered — in its declared PREFIX spelling', async () => {
    // `['or', condA, condB]` is the spec's spelling and the only one with a
    // lowering. The infix form this driver used to compile has none, which is
    // why it is refused above rather than translated.
    const rows = await find(parseFilterAST(['or', ['stage', '=', 'won'], ['stage', '=', 'lost']]));
    expect(rows.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });

  // ── unchanged: the object form, and the meaning of `[]` ───────────────

  it('still throws on an unsupported operator inside a well-formed condition', async () => {
    // Pre-existing behaviour on the shape the driver still compiles, pinned so
    // the refusal cannot regress into a silent drop one layer down.
    await expect(find({ stage: { $sounds_like: 'won' } }))
      .rejects.toThrow(/Unsupported filter operator "\$sounds_like"/);
  });

  it('compiles an object-form filter', async () => {
    const rows = await find({ stage: 'lost' });
    expect(rows.map((r: any) => r.id)).toEqual(['2']);
  });

  it('leaves an empty filter alone (no filter is not a failed filter)', async () => {
    // Unchanged by #5158 and deliberately so: `[]` means "no filter" at every
    // layer — `parseFilterAST([])` is `undefined`, the engine deletes the key,
    // and this driver returns early rather than refusing.
    const rows = await find([]);
    expect(rows).toHaveLength(2);
  });
});
