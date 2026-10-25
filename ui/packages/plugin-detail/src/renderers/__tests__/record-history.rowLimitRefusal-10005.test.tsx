/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:history` REFUSES a row cap the contract rejects, and falls back to
 * its own default — it does not repair one (objectui#10005).
 *
 * `@objectstack/spec` declares this block's member a POSITIVE INTEGER:
 * `RecordHistoryProps.limit` is `z.number().int().positive().optional()`,
 * described there as "Maximum history entries displayed, and the `$top` of the
 * self-fetch query (renderer default: 50)". So a negative and a fractional cap
 * are not spellings this renderer may interpret; they are values the contract
 * refuses.
 *
 * Before this pin the derivation was `Number(...) || 50` with a
 * `Math.max(1, limit)` at the wire. `||` caught `0`, `NaN` and `''`, but a
 * negative is TRUTHY and survived it — `Math.max` then REPAIRED `-5` into a
 * one-row window, and forwarded a fractional `2.5` untouched as `$top`. Both
 * reached the adapter with no cause named anywhere.
 *
 * ⭐ Why this file exists at all: the sibling `record:activity` answers the
 * same question through `normalizeLimit` and its answer IS pinned
 * (`recordActivityFeed.test.ts`, `normalizeLimit(0)` / `(-3)` / `(undefined)` /
 * `('lots')`). `record:history`'s was pinned by nothing, which is why only this
 * one rotted. This pin therefore covers the sibling's whole value set PLUS the
 * two it does not cover: a NON-INTEGER, and the pass-through control.
 *
 * ⛔ The assertions read the `$top` that reaches `DataSource.find()`, not an
 * exported helper: a normalizer that refuses correctly is defeated by a
 * `Math.max(1, …)` re-appearing at the call site, and only the wire sees both.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHistoryRenderer } from '../record-history';

/**
 * Spelled here rather than imported so this pin fails if the renderer's default
 * MOVES. `record:history` defaults to 50 and `record:activity` to 20; they
 * differ deliberately and objectui#10005 is not where they get unified.
 */
const RENDERER_DEFAULT = 50;

/** The `$top` the self-fetch put on the wire for one authored node. */
async function topFor(schema: Record<string, unknown>): Promise<unknown> {
  const dataSource = { find: vi.fn(async () => ({ data: [], total: 0 })) } as any;
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="rec-alpha"
      data={{ id: 'rec-alpha', name: 'Alpha' }}
      dataSource={dataSource}
    >
      <RecordHistoryRenderer schema={schema as any} />
    </RecordContextProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return (dataSource.find.mock.calls[0][1] as any).$top;
}

beforeEach(() => {
  cleanup();
});

describe('record:history — a refused row cap falls back, it is not repaired (objectui#10005)', () => {
  it('refuses a NEGATIVE cap — ⛔ not a one-row window', async () => {
    const top = await topFor({ limit: -5 });
    expect(top).toBe(RENDERER_DEFAULT);
    // The defect's exact signature, named so a re-introduced `Math.max(1, …)`
    // cannot pass this file by agreeing with it.
    expect(top).not.toBe(1);
  });

  it('refuses a NON-INTEGER cap — ⛔ not a fractional `$top`, ⛔ not a floor', async () => {
    const top = await topFor({ limit: 2.5 });
    expect(top).toBe(RENDERER_DEFAULT);
    expect(top).not.toBe(2.5);
    expect(Number.isInteger(top)).toBe(true);
  });

  it('refuses `0`', async () => {
    expect(await topFor({ limit: 0 })).toBe(RENDERER_DEFAULT);
  });

  it('refuses a NaN cap', async () => {
    expect(await topFor({ limit: Number.NaN })).toBe(RENDERER_DEFAULT);
  });

  it('refuses a non-numeric string', async () => {
    expect(await topFor({ limit: 'lots' })).toBe(RENDERER_DEFAULT);
  });

  it('an ABSENT cap is not a refusal — it is the renderer default', async () => {
    expect(await topFor({})).toBe(RENDERER_DEFAULT);
  });

  it('CONTROL — a usable cap passes through UNCHANGED', async () => {
    // The card's own control row: if this one moves, the harness is wrong
    // rather than the renderer.
    expect(await topFor({ limit: 10 })).toBe(10);
  });

  it('refuses a numeric STRING — ⛔ no `Number()` coercion (objectui#10145, flipped)', async () => {
    // FLIPPED from `.toBe(5)`: while the family kept `Number(value)`, `'5'`
    // resolved to a five-row window. The spec refuses a string outright
    // (`z.number()`), and the ruling on objectui#10145 is STOP.
    const top = await topFor({ limit: '5' });
    expect(top).toBe(RENDERER_DEFAULT);
    expect(top).not.toBe(5);
  });

  it('refuses the other shapes `Number()` used to admit (objectui#10145)', async () => {
    expect(await topFor({ limit: ' 5 ' })).toBe(RENDERER_DEFAULT); // was 5
    expect(await topFor({ limit: '0x10' })).toBe(RENDERER_DEFAULT); // was 16
    expect(await topFor({ limit: true })).toBe(RENDERER_DEFAULT); // was 1
    expect(await topFor({ limit: [7] })).toBe(RENDERER_DEFAULT); // was 7
  });

  it('CONTROL — the same cap as a NUMBER still passes through', async () => {
    // Lit control beside the flip above.
    expect(await topFor({ limit: 5 })).toBe(5);
  });

  it('the `properties` read point answers identically — refused', async () => {
    expect(await topFor({ properties: { limit: -5 } })).toBe(RENDERER_DEFAULT);
  });

  it('the `properties` read point answers identically — honoured', async () => {
    expect(await topFor({ properties: { limit: 7 } })).toBe(7);
  });
});

describe('record:history — the refusal is LOUD (objectui#10097, objectui#10145)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  /**
   * Calls on the developer channel that are ABOUT this block's row cap. A
   * FILTER rather than a blanket count: MEASURED on this harness, rendering the
   * timeline emits an unrelated `react-i18next` `NO_I18NEXT_INSTANCE` warning
   * whose presence in this spy's window depends on test order.
   */
  function rowCapWarnings(): string[] {
    return (warn.mock.calls as unknown[][])
      .map((args) => args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '))
      .filter((text) => text.includes('record:history row cap'));
  }

  /**
   * FLIPPED from "names nothing on the developer channel when it refuses":
   * that pin recorded the family's silence as a decision awaiting a ruling.
   * objectui#10097 ruled "always warn"; objectui#10145 ruled STOP with a loud
   * fallback. The warning names the block and spells the raw value WITH its
   * type, so `'5'` and `5` cannot be confused in the message.
   */
  it.each([
    ['a numeric string', '5', '"5" (string)'],
    ['a padded numeric string', ' 5 ', '" 5 " (string)'],
    ['a hex string', '0x10', '"0x10" (string)'],
    ['a boolean', true, 'true (boolean)'],
    ['an array', [7], '[7] (array)'],
    ['a fraction', 1.5, '1.5 (number)'],
    ['zero', 0, '0 (number)'],
    ['a negative', -5, '-5 (number)'],
    ['NaN', Number.NaN, 'NaN (number)'],
    ['Infinity', Number.POSITIVE_INFINITY, 'Infinity (number)'],
  ])('warns once, naming the block and the raw value, for %s', async (_label, authored, spelled) => {
    expect(await topFor({ limit: authored })).toBe(RENDERER_DEFAULT);
    const hits = rowCapWarnings();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('record:history');
    expect(hits[0]).toContain(`declared limit: ${spelled}`);
  });

  it('CONTROL — a usable cap and an absent cap say nothing', async () => {
    expect(await topFor({ limit: 10 })).toBe(10);
    expect(await topFor({})).toBe(RENDERER_DEFAULT);
    expect(rowCapWarnings()).toEqual([]);
  });

  it('the `properties` read point warns identically', async () => {
    expect(await topFor({ properties: { limit: '5' } })).toBe(RENDERER_DEFAULT);
    expect(rowCapWarnings()).toHaveLength(1);
  });
});
