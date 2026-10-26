/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9511 - the record-id rule is ONE rule, stated once on `DataSource`.
 *
 * ## What is pinned
 *
 * `@objectstack/spec` declares a record id as `z.string()` on every record
 * door. objectui#9333 narrowed `update` alone, which left this interface
 * saying two different things about the same value depending on which method
 * you read. The ruling on this card (director batch #136 item 5, letter B)
 * extends the rule to the rest of the surface; `delete`, `bulkUpdate` and
 * `bulkDelete` closed at objectui#9712, and their sibling
 * `data-source-update-id-9333.test.ts` pins the first one.
 *
 * ⭐ `findOne` — the fifth and last door — is asserted here TOO, as of the
 * ruling that closed it (director batch #195 item 1, letter A). It is the
 * expensive one: its readers are AUTHORABLE metadata keys, so it could not
 * narrow until those keys narrowed on BOTH published faces. The parse half of
 * that move lives in `authorable-record-id-string-9511.test.ts`; this file
 * keeps the TypeScript half. ⛔ There is no longer a door held open, and the
 * docblock census at the bottom is what stops the old exception from being
 * re-introduced as prose.
 *
 * ## Where each row lives - these two halves measure different things
 *
 * The `type _...` rows below are ERASED before vitest loads this file. `tsc -p
 * packages/types/tsconfig.test.json` (chained from this package's `type-check`
 * script) is the only thing that executes them, which is the objectui#3009
 * lesson: a green vitest run says nothing about a compile-time assertion.
 *
 * The `it(...)` rows are a source-text census over the declarations themselves,
 * and they are NOT redundant with the type rows: they red even in a tree where
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

/** `findOne` takes the protocol's string id — the fifth door (objectui#9511). */
type _FindOneIdIsTheProtocolString = Expect<Equal<Parameters<DataSource['findOne']>[1], string>>;

/** Stated separately so a degradation to `any` cannot pass the row above. */
type _FindOneIdIsNotAny = Expect<Equal<Equal<Parameters<DataSource['findOne']>[1], any>, false>>;

/** `delete` takes the protocol's string id. */
type _DeleteIdIsTheProtocolString = Expect<Equal<Parameters<DataSource['delete']>[1], string>>;

/** Stated separately so a degradation to `any` cannot pass the row above. */
type _DeleteIdIsNotAny = Expect<Equal<Equal<Parameters<DataSource['delete']>[1], any>, false>>;

/**
 * The bulk pair carries the rule per ELEMENT. `NonNullable` is needed because
 * both members are optional; without it the row would read `undefined` and
 * pass for the wrong reason.
 */
type _BulkUpdateIdsAreProtocolStrings =
  Expect<Equal<Parameters<NonNullable<DataSource['bulkUpdate']>>[1], ReadonlyArray<string>>>;
type _BulkDeleteIdsAreProtocolStrings =
  Expect<Equal<Parameters<NonNullable<DataSource['bulkDelete']>>[1], ReadonlyArray<string>>>;

declare const adapter: DataSource;

/**
 * Call-site controls, held inside a function that is referenced and never
 * invoked. `declare const adapter` is erased, so the body would throw if it
 * ever ran - keeping it unreachable is what makes these rows compile-time-only
 * in a file vitest also loads.
 *
 * Control: the checker really resolves these signatures. Widen any of them
 * back and its directive becomes UNUSED (TS2578), so each control fires for
 * exactly the change it exists to catch. The neighbouring string calls must
 * stay legal, or the refusals above would prove nothing.
 */
function recordIdCallSiteControls(): void {
  // @ts-expect-error a numeric primary key is no longer a `DataSource.findOne` id
  void adapter.findOne('account', 7);
  // @ts-expect-error a numeric primary key is no longer a `DataSource.delete` id
  void adapter.delete('account', 7);
  // @ts-expect-error nor a `bulkUpdate` id
  void adapter.bulkUpdate?.('account', [7], {});
  // @ts-expect-error nor a `bulkDelete` id
  void adapter.bulkDelete?.('account', [7]);

  void adapter.findOne('account', 'rec_1');
  void adapter.delete('account', 'rec_1');
  void adapter.bulkUpdate?.('account', ['rec_1'], {});
  void adapter.bulkDelete?.('account', ['rec_1']);
}
void recordIdCallSiteControls;

/* ------------------------------------------------------------------ *
 * Runtime half - a census over the declaration text.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/types/src/__tests__  ->  packages/types/src
const SRC = path.resolve(here, '..');
const DATA_TS = path.join(SRC, 'data.ts');

/** `findOne(resource: string, id: <TYPE>,` - whitespace and newlines tolerated. */
const FIND_ONE_ID = /\bfindOne\s*\(\s*resource\s*:\s*string\s*,\s*id\s*:\s*([^,\n]+?)\s*,/s;
/** `delete(\n resource: string,\n id: <TYPE>,` - whitespace and newlines tolerated. */
const DELETE_ID = /\bdelete\s*\(\s*resource\s*:\s*string\s*,\s*id\s*:\s*([^,\n]+?)\s*,/s;
/** `bulkUpdate?(\n resource: string,\n ids: <TYPE>,` */
const BULK_UPDATE_IDS = /\bbulkUpdate\?\(\s*resource\s*:\s*string\s*,\s*ids\s*:\s*([^,\n]+?)\s*,/s;
/** `bulkDelete?(\n resource: string,\n ids: <TYPE>,` */
const BULK_DELETE_IDS = /\bbulkDelete\?\(\s*resource\s*:\s*string\s*,\s*ids\s*:\s*([^,\n]+?)\s*,/s;

function typeOf(re: RegExp, source: string): string | null {
  const m = re.exec(source);
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

const DATA_SOURCE_TEXT = readFileSync(DATA_TS, 'utf8');

const DOORS: ReadonlyArray<readonly [string, RegExp, string]> = [
  ['findOne', FIND_ONE_ID, 'string'],
  ['delete', DELETE_ID, 'string'],
  ['bulkUpdate', BULK_UPDATE_IDS, 'ReadonlyArray<string>'],
  ['bulkDelete', BULK_DELETE_IDS, 'ReadonlyArray<string>'],
];

describe('the census instrument can fire (controls)', () => {
  it('anchors on this file, not on the cwd', () => {
    expect(DATA_SOURCE_TEXT.length).toBeGreaterThan(0);
    expect(DATA_SOURCE_TEXT).toContain('export interface DataSource');
  });

  it('reads the wide spelling back off a synthetic `findOne`', () => {
    const wide = 'findOne(resource: string, id: string | number, params?: X): Y;';
    expect(typeOf(FIND_ONE_ID, wide)).toBe('string | number');
  });

  it('reads the wide spelling back off a synthetic `delete`', () => {
    const wide = 'delete(\n    resource: string,\n    id: string | number,\n    opts?: X,\n  ): Y;';
    expect(typeOf(DELETE_ID, wide)).toBe('string | number');
  });

  it('reads the wide spelling back off a synthetic bulk pair', () => {
    const wideUpdate =
      'bulkUpdate?(\n    resource: string,\n    ids: ReadonlyArray<string | number>,\n    patch: X,\n  ): Y;';
    const wideDelete =
      'bulkDelete?(\n    resource: string,\n    ids: ReadonlyArray<string | number>,\n  ): Y;';
    expect(typeOf(BULK_UPDATE_IDS, wideUpdate)).toBe('ReadonlyArray<string | number>');
    expect(typeOf(BULK_DELETE_IDS, wideDelete)).toBe('ReadonlyArray<string | number>');
  });

  it('returns null rather than a false negative when the member is absent', () => {
    for (const [, re] of DOORS) expect(typeOf(re, 'export interface Empty {}')).toBeNull();
  });
});

describe('every narrowed DataSource door declares the protocol record id (objectui#9511)', () => {
  for (const [name, re, expected] of DOORS) {
    it(`\`${name}\` takes the protocol string id, not a union with \`number\``, () => {
      expect(
        typeOf(re, DATA_SOURCE_TEXT),
        [
          `\`DataSource.${name}\` declares a record id wider than the protocol.`,
          '@objectstack/spec declares every record door as `z.string()`; a backend',
          'whose keys are numeric maps at its own adapter boundary rather than',
          'widening this contract for every caller in the monorepo.',
        ].join('\n'),
      ).toBe(expected);
    });
  }
});

describe('the rule is stated where the next reader will be (objectui#9511)', () => {
  /**
   * The ruling's acceptance names the docblock, not just the signatures: a
   * reader who meets one method must be able to learn the rule for all of them
   * without re-deriving it. These are substring reads, deliberately short, so
   * the prose can be edited freely around them.
   */
  it('the `DataSource` docblock states the one rule and names the held-open door', () => {
    const docStart = DATA_SOURCE_TEXT.lastIndexOf('/**', DATA_SOURCE_TEXT.indexOf('export interface DataSource'));
    const doc = DATA_SOURCE_TEXT.slice(docStart, DATA_SOURCE_TEXT.indexOf('export interface DataSource'));
    expect(doc).toContain('One rule for record ids');
    expect(doc).toContain('findOne');
    expect(doc, 'the docblock has to say WHY the last door is still open, or the next reader re-derives it')
      .toContain('objectui#9511');
  });

  it('the docblock carries NO held-open exception any more (objectui#9511)', () => {
    // The old prose described `findOne` as deliberately wide and told the next
    // reader not to narrow it. That instruction is now false, and prose that is
    // false is worse than prose that is missing - a reader who finds it will
    // re-open a decision that has been made. Asserted as an ABSENCE, which is
    // only meaningful next to the slice control below: that row proves this
    // string is read off the docblock and not off an empty accidental slice.
    const docStart = DATA_SOURCE_TEXT.lastIndexOf('/**', DATA_SOURCE_TEXT.indexOf('export interface DataSource'));
    const doc = DATA_SOURCE_TEXT.slice(docStart, DATA_SOURCE_TEXT.indexOf('export interface DataSource'));
    for (const retired of ['ONE door is still wide', 'Do not narrow `findOne`', 'held open']) {
      expect(doc, `the docblock still describes the fifth door as open: "${retired}"`)
        .not.toContain(retired);
    }
    // ...and the positive half, so the absence above cannot pass by the docblock
    // having lost its content altogether.
    expect(doc).toContain('All five doors');
  });

  it('the census reads the docblock and not the whole file (control)', () => {
    const docStart = DATA_SOURCE_TEXT.lastIndexOf('/**', DATA_SOURCE_TEXT.indexOf('export interface DataSource'));
    const doc = DATA_SOURCE_TEXT.slice(docStart, DATA_SOURCE_TEXT.indexOf('export interface DataSource'));
    // A token that exists in the file but NOT in this docblock: if the slice
    // silently became "the whole file", this row reds.
    expect(DATA_SOURCE_TEXT).toContain('export interface BatchTransactionOperation');
    expect(doc).not.toContain('export interface BatchTransactionOperation');
  });
});
