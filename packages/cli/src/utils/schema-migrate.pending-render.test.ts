// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3954 — how `os migrate plan` renders the pending work.
 *
 * The additive section carries an implicit promise: what it lists is created,
 * never data-losing, and needs no `--allow-destructive` thought. The datetime
 * convergence (#3912/#3942) rewrites rows and rebuilds columns, so folding it
 * into that section would quietly extend the promise to cover a table rewrite.
 * These tests pin the split, and pin that the summary line — the one an operator
 * reads before typing "yes" — never omits in-place work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderPendingSchemaWork,
  summarizePendingSchemaWork,
  type PendingSchemaWork,
} from './schema-migrate.js';

let lines: string[];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const out = () => lines.join('\n');

const ADDITIVE: PendingSchemaWork[] = [
  { table: 'widgets', kind: 'create_table', columns: ['sku', 'qty'] },
  { table: 'orders', kind: 'add_columns', columns: ['note'] },
];

const IN_PLACE: PendingSchemaWork[] = [
  { table: 'evt', kind: 'normalize_datetime_storage', columns: ['at'], rows: 1234567 },
  { table: 'legacy', kind: 'widen_datetime_columns', columns: ['at', 'created_at'], rows: 42 },
  { table: 'shift', kind: 'normalize_time_storage', columns: ['starts_at'], rows: 7 },
  { table: 'shift_my', kind: 'widen_time_columns', columns: ['starts_at'], rows: 9 },
];

describe('renderPendingSchemaWork (#3954)', () => {
  it('renders nothing at all when there is nothing pending', async () => {
    await renderPendingSchemaWork([]);
    expect(out()).toBe('');
  });

  it('keeps the additive section exactly as it was when only additive work is pending', async () => {
    await renderPendingSchemaWork(ADDITIVE);
    expect(out()).toContain('New (additive — created when you apply)');
    expect(out()).toContain('widgets');
    expect(out()).toContain('[create_table, 2 column(s)]');
    expect(out()).toContain('[add_columns: note]');
    // No second heading appears when there is no in-place work.
    expect(out()).not.toContain('In place');
  });

  it('puts the datetime convergence under its OWN heading, not the additive one', async () => {
    await renderPendingSchemaWork(IN_PLACE);
    expect(out()).toContain('In place (existing rows converged when you apply)');
    // The additive heading claims the work is never data-losing; a row rewrite
    // must never be listed beneath it.
    expect(out()).not.toContain('New (additive');
  });

  it('names the columns and the size of each in-place step', async () => {
    await renderPendingSchemaWork(IN_PLACE);
    expect(out()).toContain('normalize_datetime_storage: at');
    expect(out()).toContain('1,234,567 row update(s)');
    expect(out()).toContain('widen_datetime_columns: at, created_at');
    // A MySQL widen is ALTER … MODIFY — a rebuild, said outright.
    expect(out()).toContain('42 row table rebuild');
    // The Field.time twins (#3994) take the same rendering rules.
    expect(out()).toContain('normalize_time_storage: starts_at');
    expect(out()).toContain('7 row update(s)');
    expect(out()).toContain('widen_time_columns: starts_at');
    expect(out()).toContain('9 row table rebuild');
  });

  it('shows both sections when both kinds are pending', async () => {
    await renderPendingSchemaWork([...ADDITIVE, ...IN_PLACE]);
    expect(out()).toContain('New (additive — created when you apply)');
    expect(out()).toContain('In place (existing rows converged when you apply)');
  });

  it('reads an unmeasured count as unknown rather than zero', async () => {
    await renderPendingSchemaWork([{ table: 'evt', kind: 'normalize_datetime_storage', columns: ['at'] }]);
    expect(out()).toContain('? row update(s)');
    expect(out()).not.toContain('0 row update(s)');
  });
});

describe('summarizePendingSchemaWork (#3954)', () => {
  it('is unchanged for purely additive work', async () => {
    expect(await summarizePendingSchemaWork(ADDITIVE)).toBe('1 table(s) to create, 1 column(s) to add');
  });

  it('is unchanged when nothing is pending', async () => {
    expect(await summarizePendingSchemaWork([])).toBe('0 table(s) to create, 0 column(s) to add');
  });

  it('never omits in-place work — this is the line read before confirming', async () => {
    const summary = await summarizePendingSchemaWork([...ADDITIVE, ...IN_PLACE]);
    expect(summary).toContain('1 table(s) to create');
    expect(summary).toContain('1 column(s) to add');
    expect(summary).toContain('5 temporal column(s) to converge in place');
    expect(summary).toContain('~1,234,625 rows');
  });
});
