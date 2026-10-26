/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10078 - three more record-id declarations that the objectui#9511
 * ruling did not enumerate are strings too.
 *
 * ## What is pinned
 *
 * Director batch #195 item 1, letter A (objectui#9511) made a record id a
 * `string` wherever METADATA names one, and extended it as "the same
 * principle" to `CommentEntry.recordId` / `MentionNotification.recordId`. The
 * three below are runtime / API shapes that ruling did not name; carrying the
 * rule to them is the `domain:spec` seat's inheritance decision in the claim on
 * objectui#10078. Each carries the same id with the old `string | number`
 * spelling:
 *
 * - `CommentSearchResult.recordId` - the record a matching comment belongs to,
 *   copied from `CommentEntry.recordId` (already a string since objectui#9511);
 * - `RecordSubscription.recordId` - the record a notification bell is for;
 * - `DataSourceMutationEvent.id` - the record a `DataSource` write touched, the
 *   same id the `update` / `delete` doors already take as a string.
 *
 * All three are runtime / API shapes with NO zod mirror (nothing authors them
 * into JSON), so the compiler is the only face that can refuse a number, and
 * this file is where that refusal is asserted.
 *
 * ⚠️ This file pins these three ONLY. Other record ids in this package still
 * admit a number and are out of its scope, so a green run here says nothing
 * about the rest of the family.
 *
 * ## Where each row lives - these two halves measure different things
 *
 * The `type _...` rows and the `@ts-expect-error` controls are ERASED before
 * vitest loads this file. `tsc -p packages/types/tsconfig.test.json` (chained
 * from this package's `type-check` script) is the only thing that executes
 * them: a green vitest run says nothing about them (objectui#3009).
 *
 * The `it(...)` rows are a source-text census over the declarations, which reds
 * in a tree where `tsc` is never run and names the spelling it found. Each
 * matcher is proven to fire on a synthetic wide spelling before an absence is
 * believed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommentSearchResult, RecordSubscription } from '../views';
import type { DataSourceMutationEvent } from '../data';

/* ------------------------------------------------------------------ *
 * Compile-time half.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type _CommentSearchResultRecordIdIsAString = Expect<Equal<CommentSearchResult['recordId'], string>>;
type _RecordSubscriptionRecordIdIsAString = Expect<Equal<RecordSubscription['recordId'], string>>;
/** Optional member: `NonNullable` strips the `undefined` that `?` adds. */
type _MutationEventIdIsAString = Expect<Equal<NonNullable<DataSourceMutationEvent['id']>, string>>;

/** Stated separately so a degradation to `any` cannot pass the rows above. */
type _CommentSearchResultRecordIdIsNotAny = Expect<Equal<Equal<CommentSearchResult['recordId'], any>, false>>;
type _RecordSubscriptionRecordIdIsNotAny = Expect<Equal<Equal<RecordSubscription['recordId'], any>, false>>;
type _MutationEventIdIsNotAny = Expect<Equal<Equal<DataSourceMutationEvent['id'], any>, false>>;

/**
 * Value-site controls. Widen any member back and its directive becomes UNUSED
 * (TS2578), so each control fires for exactly the change it exists to catch.
 * The string spellings beside them must stay legal, or the refusals would
 * prove nothing.
 */
// @ts-expect-error a numeric primary key is no longer a `CommentSearchResult.recordId`
const _numericSearchHit: CommentSearchResult = { comment: { id: 'c1', text: '', author: '', createdAt: '' }, objectName: 'account', recordId: 42 };
// @ts-expect-error nor a `RecordSubscription.recordId`
const _numericSubscription: RecordSubscription = { recordId: 42, subscribed: true };
// @ts-expect-error nor a `DataSourceMutationEvent.id`
const _numericMutation: DataSourceMutationEvent = { type: 'delete', resource: 'account', id: 42 };

const _stringSearchHit: CommentSearchResult = { comment: { id: 'c1', text: '', author: '', createdAt: '' }, objectName: 'account', recordId: '42' };
const _stringSubscription: RecordSubscription = { recordId: '42', subscribed: true };
const _stringMutation: DataSourceMutationEvent = { type: 'delete', resource: 'account', id: '42' };
void [_numericSearchHit, _numericSubscription, _numericMutation, _stringSearchHit, _stringSubscription, _stringMutation];

/* ------------------------------------------------------------------ *
 * Runtime half - a census over the declaration text.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/types/src/__tests__  ->  packages/types/src
const SRC = path.resolve(here, '..');
const VIEWS_TEXT = readFileSync(path.join(SRC, 'views.ts'), 'utf8');
const DATA_TEXT = readFileSync(path.join(SRC, 'data.ts'), 'utf8');

/**
 * The declared type of `member` inside `export interface NAME ... { ... }`.
 * The body is cut at the first line that closes the interface, so a member of
 * the same name in a LATER interface cannot answer for this one.
 */
function memberType(source: string, iface: string, member: string): string | null {
  const start = source.indexOf(`export interface ${iface}`);
  if (start === -1) return null;
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end === -1 ? undefined : end);
  const m = new RegExp(`\\n\\s*${member}\\??\\s*:\\s*([^;\\n]+);`).exec(body);
  return m ? m[1].trim() : null;
}

const SITES: ReadonlyArray<readonly [string, string, string]> = [
  ['views.ts', 'CommentSearchResult', 'recordId'],
  ['views.ts', 'RecordSubscription', 'recordId'],
  ['data.ts', 'DataSourceMutationEvent', 'id'],
];

const TEXT: Record<string, string> = { 'views.ts': VIEWS_TEXT, 'data.ts': DATA_TEXT };

describe('the census instrument can fire (controls)', () => {
  it('reads the wide spelling back off a synthetic declaration', () => {
    const wide = 'export interface X {\n  /** doc */\n  recordId: string | number;\n  other: boolean;\n}';
    expect(memberType(wide, 'X', 'recordId')).toBe('string | number');
    const wideOptional = 'export interface Y {\n  id?: string | number;\n}';
    expect(memberType(wideOptional, 'Y', 'id')).toBe('string | number');
  });

  it('does not answer for an interface from a member of a later one', () => {
    const two = 'export interface A {\n  x: boolean;\n}\n\nexport interface B {\n  recordId: string | number;\n}';
    expect(memberType(two, 'A', 'recordId')).toBeNull();
  });

  it('returns null rather than a false negative when the interface is absent', () => {
    expect(memberType(VIEWS_TEXT, 'NoSuchInterface10078', 'recordId')).toBeNull();
  });

  it('reads a member the objectui#9511 ruling already narrowed (lit control)', () => {
    expect(memberType(VIEWS_TEXT, 'CommentEntry', 'recordId')).toBe('string');
  });
});

describe('the three surviving record ids are strings (objectui#10078)', () => {
  for (const [file, iface, member] of SITES) {
    it(`\`${iface}.${member}\` declares the protocol string id`, () => {
      expect(
        memberType(TEXT[file], iface, member),
        [
          `\`${iface}.${member}\` in ${file} declares a record id wider than \`string\`.`,
          'objectui#10078 carries the objectui#9511 record-id rule (a record id is a string',
          'wherever metadata names one) to this runtime shape; a host whose keys are',
          'numeric converts once, at its own adapter boundary.',
        ].join('\n'),
      ).toBe('string');
    });
  }
});
