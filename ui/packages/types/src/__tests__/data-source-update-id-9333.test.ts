/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9333 - `DataSource.update` takes the protocol's `string` record id.
 *
 * ## What is pinned, and why the adapter contract is the second half of one card
 *
 * `@objectstack/spec` declares a record id as `z.string()` on every record
 * door. `RecordContextValue.recordId` was one consumer type wider than that;
 * `DataSource.update`'s `id: string | number` is the same defect class on the
 * adapter contract, ruled to narrow in the same card (director seat, decision
 * batch #129 item 5). A backend whose primary keys are numeric maps at ITS
 * adapter boundary rather than making every caller in this monorepo carry a
 * union the protocol does not have.
 *
 * ## Where each row lives - these two halves measure different things
 *
 * The `type _...` rows below are ERASED before vitest loads this file. `tsc -p
 * packages/types/tsconfig.test.json` (chained from this package's `type-check`
 * script) is the only thing that executes them, which is the objectui#3009
 * lesson: a green vitest run says nothing about a compile-time assertion.
 *
 * The `it(...)` rows are a source-text census over the declaration itself, and
 * they are NOT redundant with the type rows: they red even in a tree where
 * `tsc` is never run, and they name the offending spelling in the failure
 * message. Every matcher below is proven to fire on a synthetic wide signature
 * before any absence is believed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSource } from '../data';

/* ------------------------------------------------------------------ *
 * Compile-time half.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The ruled narrowing. */
type _UpdateIdIsTheProtocolString = Expect<Equal<Parameters<DataSource['update']>[1], string>>;

/** Stated separately so a degradation to `any` cannot pass the row above. */
type _UpdateIdIsNotAny = Expect<Equal<Equal<Parameters<DataSource['update']>[1], any>, false>>;

declare const adapter: DataSource;

/**
 * Two call-site controls, held inside a function that is referenced and never
 * invoked. `declare const adapter` is erased, so the body would throw if it
 * ever ran - keeping it unreachable is what makes these rows compile-time-only
 * in a file vitest also loads.
 *
 * Control: the checker really resolves this signature. Widen `id` back and the
 * directive becomes UNUSED (TS2578), so the control fires for exactly the
 * change it exists to catch. The neighbouring string call must stay legal, or
 * the refusal above would prove nothing.
 */
function updateIdCallSiteControls(): void {
  // @ts-expect-error a numeric primary key is no longer a `DataSource.update` id
  void adapter.update('account', 7, {});
  void adapter.update('account', 'rec_1', {});
}
void updateIdCallSiteControls;

/* ------------------------------------------------------------------ *
 * Runtime half - a census over the declaration text.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/types/src/__tests__  ->  packages/types/src
const SRC = path.resolve(here, '..');
const DATA_TS = path.join(SRC, 'data.ts');

/** `update(resource: string, id: <TYPE>,` - whitespace and newlines tolerated. */
const UPDATE_ID = /\bupdate\s*\(\s*resource\s*:\s*string\s*,\s*id\s*:\s*([^,\n]+?)\s*,/s;

function updateIdTypeOf(source: string): string | null {
  const m = UPDATE_ID.exec(source);
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

const DATA_SOURCE_TEXT = readFileSync(DATA_TS, 'utf8');

describe('the census instrument can fire (controls)', () => {
  it('anchors on this file, not on the cwd', () => {
    expect(DATA_SOURCE_TEXT.length).toBeGreaterThan(0);
    expect(DATA_SOURCE_TEXT).toContain('export interface DataSource');
  });

  it('reads the wide spelling back off a synthetic declaration', () => {
    const wide = 'update(\n    resource: string,\n    id: string | number,\n    data: X,\n  ): Y;';
    expect(updateIdTypeOf(wide)).toBe('string | number');
  });

  it('reads the narrow spelling back off a synthetic declaration', () => {
    const narrow = 'update(\n    resource: string,\n    id: string,\n    data: X,\n  ): Y;';
    expect(updateIdTypeOf(narrow)).toBe('string');
  });

  it('returns null rather than a false negative when the member is absent', () => {
    expect(updateIdTypeOf('export interface Empty {}')).toBeNull();
  });
});

describe('DataSource.update declares the protocol record id (objectui#9333)', () => {
  it('takes `id: string`, not a union with `number`', () => {
    expect(
      updateIdTypeOf(DATA_SOURCE_TEXT),
      [
        '`DataSource.update` declares a record id wider than the protocol.',
        '@objectstack/spec declares every record door as `z.string()`; a backend',
        'whose keys are numeric maps at its own adapter boundary rather than',
        'widening this contract for every caller in the monorepo.',
      ].join('\n'),
    ).toBe('string');
  });
});
