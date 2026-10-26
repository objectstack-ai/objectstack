/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordContextValue` shape ↔ memo dep list, pinned together (objectui#3773).
 *
 * `RecordContextProvider` spreads all of its props into one object and hands
 * consumers a `useMemo`'d reference. That makes the dep list a hand-maintained
 * mirror of the interface: a key added to `RecordContextValue` and forgotten in
 * the dep list gives consumers a STALE value with no type error — the drift
 * shape that let `loading` / `error` sit in the dep list for months after they
 * had zero producers and zero consumers (they were retired in #3773).
 *
 * Two halves, deliberately joined:
 *
 * - a compile-time assertion that `MEMO_DEP_KEYS` is exactly
 *   `keyof RecordContextValue` (adding a key to the interface without listing
 *   it here fails `tsc`); and
 * - a runtime sweep proving every listed key really re-memoizes, i.e. is in
 *   the dep list (adding it here without wiring the dep list fails vitest).
 *
 * So a new context key cannot land half-wired, and a dead one cannot linger:
 * removing it from the interface forces its removal from this list, which
 * forces its removal from the dep list.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { DataSource } from '@object-ui/types';
import {
  RecordContextProvider,
  useRecordContext,
  type RecordContextValue,
} from '../RecordContext';

/**
 * A distinct `DataSource` adapter per call. `dataSource` holds the ADAPTER the
 * host resolved, not an id (objectui#9197) — so the "before" and "after" of the
 * `dataSource` mutation below have to be two different adapter objects, and the
 * re-memoization they prove is by reference, which is how the real producer
 * (`app-shell/views/RecordDetailView`) hands it down.
 */
let adapterSeq = 0;
const makeDataSource = (): DataSource => {
  const tag = `adapter_${++adapterSeq}`;
  return {
    find: async () => ({ data: [], total: 0 }),
    findOne: async () => null,
    create: async (_r, d) => d,
    update: async (_r, _id, d) => d,
    delete: async () => true,
    getObjectSchema: async () => ({ name: tag }),
  };
};

/** The keys `RecordContextProvider`'s `useMemo` dep list names, in its order. */
const MEMO_DEP_KEYS = [
  'objectName',
  'recordId',
  'dataSource',
  'data',
  'objectSchema',
  'refresh',
  'embedded',
  'headerSystemActions',
  'isFavorite',
  'onToggleFavorite',
  'objectLabelNote',
] as const;

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * Compile-time half. Red when `RecordContextValue` gains or loses a key
 * without this list following — including the retired `loading` / `error`,
 * which cannot come back silently.
 */
type _EveryContextKeyIsDepListed = Expect<
  Equal<keyof RecordContextValue, (typeof MEMO_DEP_KEYS)[number]>
>;

/** A complete, valid value for every key — the "before" of each mutation. */
const BASE: RecordContextValue = {
  objectName: 'account',
  recordId: 'rec_1',
  dataSource: makeDataSource(),
  data: { id: 'rec_1', name: 'Acme' },
  objectSchema: { name: 'account' },
  refresh: () => {},
  embedded: false,
  headerSystemActions: [],
  isFavorite: false,
  onToggleFavorite: () => {},
  objectLabelNote: 'Managed by the identity provider',
};

/** A different value for every key — the "after" of each mutation. */
const CHANGED: RecordContextValue = {
  objectName: 'contact',
  recordId: 'rec_2',
  dataSource: makeDataSource(),
  data: { id: 'rec_2', name: 'Globex' },
  objectSchema: { name: 'contact' },
  refresh: () => {},
  embedded: true,
  headerSystemActions: [{ name: 'edit' }],
  isFavorite: true,
  onToggleFavorite: () => {},
  objectLabelNote: 'Administrator configuration',
};

/** Render the provider and capture the context object handed to consumers. */
function renderWithProbe(value: RecordContextValue) {
  const seen: Array<RecordContextValue | null> = [];
  const Probe: React.FC = () => {
    seen.push(useRecordContext());
    return null;
  };
  const ui = (v: RecordContextValue) => (
    <RecordContextProvider {...v}>
      <Probe />
    </RecordContextProvider>
  );
  const { rerender } = render(ui(value));
  return { seen, rerender: (v: RecordContextValue) => rerender(ui(v)) };
}

describe('RecordContextProvider — value shape and memo dep list (#3773)', () => {
  it('hands consumers exactly the declared keys', () => {
    const { seen } = renderWithProbe(BASE);
    expect(Object.keys(seen[0]!).sort()).toEqual([...MEMO_DEP_KEYS].sort());
  });

  it('keeps one reference when nothing changes', () => {
    const { seen, rerender } = renderWithProbe(BASE);
    rerender({ ...BASE });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });

  it.each(MEMO_DEP_KEYS)('re-memoizes when `%s` changes', (key) => {
    const { seen, rerender } = renderWithProbe(BASE);
    const before = seen[0]!;
    rerender({ ...BASE, [key]: CHANGED[key] });
    const after = seen[seen.length - 1]!;

    // A new reference AND the new value visible: a key missing from the dep
    // list fails the first expectation, a key dropped from the spread the
    // second.
    expect(after).not.toBe(before);
    expect(after[key]).toBe(CHANGED[key]);
  });
});
