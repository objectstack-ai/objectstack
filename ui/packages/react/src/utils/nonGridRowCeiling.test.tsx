/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210 (ruling a′) — the footnote a non-grid view shows when the
 * platform row ceiling bit; reshaped by objectui#7508 (ruling A′) to take the
 * `NonGridCeilingResult` and nothing else.
 *
 * The mechanism itself — the ceiling, the probe-row query and
 * `applyNonGridRowCeiling` — lives in `@object-ui/core` and is pinned there
 * (`packages/core/src/utils/__tests__/non-grid-row-ceiling.test.ts`). This file
 * pins the two things that are this package's:
 *
 *   1. The note names BOTH numbers when the adapter reported a total, still
 *      says something DEFINITE when it did not, and every number it prints is
 *      read off the result it was handed — so a drawn/total pair that did not
 *      come from a result is not something a caller can make it print.
 *   2. This entry re-exports core's names (the same bindings, not copies) and
 *      no longer publishes the retired `NON_GRID_ROW_CEILING_TOP`.
 *
 * REVERSE VERIFICATION — direction predicted before running: make the note
 * print the constant instead of `result.rows.length` and the "drawn count is
 * the result's" case turns red, because its result is truncated at a row count
 * that is not the ceiling.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as core from '@object-ui/core';
import {
  NON_GRID_ROW_CEILING,
  applyNonGridRowCeiling,
  nonGridRowCeilingQuery,
  type NonGridCeilingResult,
} from '@object-ui/core';
import * as entry from '../index';
import { NonGridRowCeilingNote } from './nonGridRowCeiling.js';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
const PROBE_TOP = nonGridRowCeilingQuery().$top;

describe('objectui#7210 / #7508 — the non-grid row ceiling note', () => {
  it('renders NOTHING when nothing was truncated', () => {
    const { container } = render(
      <NonGridRowCeilingNote result={applyNonGridRowCeiling({ data: rows(12), total: 12 })} />,
    );
    expect(container.querySelector('[data-row-ceiling-note]')).toBeNull();
  });

  it('names BOTH numbers when the adapter reported a total', () => {
    render(
      <NonGridRowCeilingNote result={applyNonGridRowCeiling({ data: rows(PROBE_TOP), total: 41234 })} />,
    );
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain('41234');
  });

  it('still says something DEFINITE when the adapter reported no total', () => {
    render(<NonGridRowCeilingNote result={applyNonGridRowCeiling(rows(PROBE_TOP))} />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    // Definite, not a "may": the probe row proved more rows exist, and the
    // sentence says "the FIRST N" rather than hedging. It must not invent an M.
    expect(note.textContent).toMatch(/first/i);
    expect(note.textContent).not.toMatch(/undefined|NaN/);
  });

  it('the drawn count is the RESULT’s row count, never a number supplied beside it', () => {
    // A result whose rows are NOT the ceiling's length, so a note that printed
    // the constant (the old `drawn={NON_GRID_ROW_CEILING}` call-site shape)
    // cannot pass.
    const result: NonGridCeilingResult = { rows: rows(7), total: 90, truncated: true };
    render(<NonGridRowCeilingNote result={result} />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('7');
    expect(note.textContent).toContain('90');
    expect(note.textContent).not.toContain(String(NON_GRID_ROW_CEILING));
  });

  it('takes the result and nothing else — the three loose props are gone', () => {
    const result = applyNonGridRowCeiling(rows(PROBE_TOP));
    // Compile-time half, enforced by this package's `tsc -p tsconfig.test.json`
    // (the `type-check` script): each loose prop is refused by name.
    // @ts-expect-error — `drawn` is not a prop; the count comes from `result.rows`.
    void (<NonGridRowCeilingNote result={result} drawn={5} />);
    // @ts-expect-error — `total` is not a prop; it comes from `result.total`.
    void (<NonGridRowCeilingNote result={result} total={5} />);
    // @ts-expect-error — `truncated` is not a prop; it comes from `result.truncated`.
    void (<NonGridRowCeilingNote result={result} truncated />);
    // @ts-expect-error — a note without a result is not expressible.
    void (<NonGridRowCeilingNote />);

    // Runtime half: loose numbers forced past the compiler are not read. The
    // note prints the result's 3 rows and its own total, never the 5 / 999
    // supplied beside it.
    const forced = {
      result: { rows: rows(3), total: 40, truncated: true },
      drawn: 5,
      total: 999,
    } as unknown as React.ComponentProps<typeof NonGridRowCeilingNote>;
    render(<NonGridRowCeilingNote {...forced} />);
    const text = screen.getByRole('note').textContent ?? '';
    expect(text).toContain('3');
    expect(text).toContain('40');
    expect(text).not.toContain('5');
    expect(text).not.toContain('999');
  });
});

describe('objectui#7508 — `@object-ui/react` re-exports core’s names', () => {
  it('re-exports the SAME bindings core owns, not copies', () => {
    expect(entry.NON_GRID_ROW_CEILING).toBe(core.NON_GRID_ROW_CEILING);
    expect(entry.applyNonGridRowCeiling).toBe(core.applyNonGridRowCeiling);
    expect(entry.NonGridRowCeilingNote).toBe(NonGridRowCeilingNote);
  });

  it('no longer publishes `NON_GRID_ROW_CEILING_TOP` — the `+ 1` lives only in core’s query', () => {
    expect('NON_GRID_ROW_CEILING_TOP' in entry).toBe(false);
    expect('NON_GRID_ROW_CEILING_TOP' in core).toBe(false);
  });
});
