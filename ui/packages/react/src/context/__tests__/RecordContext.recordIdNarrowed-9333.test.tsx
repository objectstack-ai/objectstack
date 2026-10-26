/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9333 - `RecordContextValue.recordId` is a `string`, and the ONE
 * place a wider host value is narrowed is this provider.
 *
 * ## What is pinned
 *
 * `@objectstack/spec` declares a record id as `z.string()` on every record
 * door (get, update, delete, and the batch operation), so a consumer type may
 * not be wider than the protocol (director seat, decision batch #129 item 5).
 * `RecordContextValue.recordId` used to be `string | number | null |
 * undefined`, which is how a numeric primary key reached
 * `buildMasterDetailEditBatch` - declared `parentId: string` - and why
 * `LineItemsPanel` carried a type assertion to make the two meet.
 *
 * The repair has a shape, not just a direction: the conversion is paid ONCE,
 * at the injection boundary, and never as `String(...)` at a read site. So
 * this file pins BOTH halves, and each half reddens on a different mistake:
 *
 *  - narrow the READ type but drop the conversion  -> the runtime half reds
 *    (a consumer sees the number it was handed).
 *  - keep the conversion but widen the READ type back -> the compile-time
 *    half reds (`Equal` fails and the `@ts-expect-error` control goes unused,
 *    TS2578).
 *  - narrow the PROVIDER PROP too, pushing `String(...)` out to hosts -> the
 *    prop-shape assertion below reds.
 *
 * ## Where each row lives
 *
 * The `type _...` rows are erased before vitest ever sees this file; `tsc -p
 * packages/react/tsconfig.test.json` is the only thing that executes them. The
 * `it(...)` rows are the runtime half and run under vitest. A green vitest run
 * is therefore NOT a reading on the type rows, and vice versa.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  RecordContextProvider,
  useRecordContext,
  type RecordContextValue,
  type RecordContextProviderProps,
} from '../RecordContext';

/* ------------------------------------------------------------------ *
 * Compile-time half.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The read surface every `record:*` consumer gets: the protocol's `string`. */
type _RecordIdIsTheProtocolString = Expect<
  Equal<RecordContextValue['recordId'], string | null | undefined>
>;

/** Stated separately so a degradation to `any` cannot pass the row above. */
type _RecordIdIsNotAny = Expect<Equal<Equal<RecordContextValue['recordId'], any>, false>>;

/**
 * The injection boundary keeps the wider shape. Removing this is the
 * `String(...)`-at-call-sites anti-pattern the ruling names in its own title,
 * so it is pinned rather than left to review.
 */
type _ProviderPropStaysWide = Expect<
  Equal<RecordContextProviderProps['recordId'], string | number | null | undefined>
>;

/**
 * Control: this file's checker really resolves the declaration. Widen
 * `recordId` back and the directive becomes UNUSED (TS2578) - i.e. the control
 * fires for the same reason the assertions above would stop meaning anything.
 */
// @ts-expect-error a numeric primary key is no longer a `RecordContextValue.recordId`
const _numericRecordIdIsRefused: RecordContextValue['recordId'] = 7;
void _numericRecordIdIsRefused;

/* ------------------------------------------------------------------ *
 * Runtime half - the conversion is really paid, and paid here.
 * ------------------------------------------------------------------ */

function renderWithProbe(recordId: RecordContextProviderProps['recordId']) {
  const seen: Array<RecordContextValue | null> = [];
  const Probe: React.FC = () => {
    seen.push(useRecordContext());
    return null;
  };
  render(
    <RecordContextProvider objectName="account" recordId={recordId}>
      <Probe />
    </RecordContextProvider>,
  );
  return seen;
}

describe('RecordContextProvider narrows the host record id (objectui#9333)', () => {
  it('hands a numeric primary key to consumers as a string', () => {
    const seen = renderWithProbe(42);
    // Removing the conversion in the provider makes this the number 42: the
    // control that proves this row is not vacuous.
    expect(seen[0]!.recordId).toBe('42');
    expect(typeof seen[0]!.recordId).toBe('string');
  });

  it('leaves a string primary key byte-identical', () => {
    const seen = renderWithProbe('rec_1');
    expect(seen[0]!.recordId).toBe('rec_1');
  });

  it('keeps "no record bound" distinguishable from a stringified nothing', () => {
    // `String(undefined)` is the string "undefined" and `String(null)` is
    // "null" - both would be read downstream as a real id. The conversion is
    // deliberately typeof-gated, and these two rows are what reds if someone
    // simplifies it to an unconditional `String(...)`.
    expect(renderWithProbe(undefined)[0]!.recordId).toBeUndefined();
    expect(renderWithProbe(null)[0]!.recordId).toBeNull();
  });

  it('narrows zero rather than treating it as absent', () => {
    // `0` is falsy; a conversion written as `recordId && String(recordId)`
    // would hand back `0` (a number) and pass the first test in this file.
    const seen = renderWithProbe(0);
    expect(seen[0]!.recordId).toBe('0');
    expect(typeof seen[0]!.recordId).toBe('string');
  });
});
