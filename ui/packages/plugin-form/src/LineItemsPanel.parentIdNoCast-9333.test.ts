/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9333 - the line-items parent id needs no assertion, because the two
 * declarations now agree.
 *
 * ## What was here before
 *
 * objectui#9304 removed the whole-context assertions on `useRecordContext()`
 * and found that the INNER assertion on the parent id was not redundant: with
 * it deleted, `tsc` answered TS2345, `string | number` is not assignable to
 * `string`. It kept the assertion and documented it as evidence, because both
 * repairs available inside that card moved bytes on the wire.
 *
 * The ruling on objectui#9333 discharged that evidence by repairing the
 * DECLARATION instead: `RecordContextValue.recordId` is the protocol's
 * `string`, narrowed once at the `RecordContextProvider` injection boundary.
 * The assertion is therefore gone, and this file pins the two halves of "gone"
 * that fail for different reasons.
 *
 * ## Where each row lives
 *
 * The `type _...` row is erased before vitest loads this file; `tsc -p
 * packages/plugin-form/tsconfig.test.json` is the only thing that executes it,
 * and it resolves `@object-ui/react` through the built `.d.ts` rather than
 * sibling sources (this project drops the root `paths`). The `it(...)` rows
 * are a source-text census over `LineItemsPanel.tsx` and run under vitest; a
 * green run of one is not a reading on the other.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments as sharedMask } from '../../../scripts/js-comment-mask.mjs';
import type { RecordContextValue } from '@object-ui/react';
import type { buildMasterDetailEditBatch } from './masterDetailTx';

/** Local annotation, since the import above is untyped -- the call site stays checked. */
const mask: (source: string) => string = sharedMask;

/* ------------------------------------------------------------------ *
 * Compile-time half.
 * ------------------------------------------------------------------ */

type Expect<T extends true> = T;

type ParentIdParam = Parameters<typeof buildMasterDetailEditBatch>[1];

/**
 * The whole point of the card: a record id read off the context fits the
 * helper's parameter with no assertion in between. Widen either declaration
 * and this row reds.
 */
type _ContextRecordIdFitsParentId = Expect<
  NonNullable<RecordContextValue['recordId']> extends ParentIdParam ? true : false
>;

/**
 * Control: the row above is not vacuously true through an `any` on either
 * side. `unknown` is assignable to neither, so a degraded `ParentIdParam`
 * would make this directive UNUSED (TS2578).
 */
// @ts-expect-error `unknown` is not a `buildMasterDetailEditBatch` parent id
type _UnknownIsRefusedAsParentId = Expect<unknown extends ParentIdParam ? true : false>;

/* ------------------------------------------------------------------ *
 * Runtime half - the assertion has not come back.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(here, 'LineItemsPanel.tsx');

/**
 * Comments out so prose about the old defect is not a census hit, through
 * `scripts/js-comment-mask.mjs` -- the one reader graded against a parser.
 *
 * `maskComments` rather than `stripComments`: blanking is the module's safer
 * default, the only projection that can carry a byte offset, and the one whose
 * name this function already carried. The cost that argues the other way --
 * a lazy `[\s\S]*?` walking the whitespace runs a blank leaves behind -- does
 * not apply, because the census pattern below has no lazy quantifier.
 *
 * ⚠️ The private projection this replaced was a HYBRID rather than a masker:
 * it blanked block comments in place but DELETED line comments, so the offsets
 * its shape implied were already gone. This is the first version of this reader
 * for which "preserves byte offsets" is true.
 */
function maskComments(src: string): string {
  return mask(src);
}

/** A type assertion applied to any `...recordId` read. */
const RECORD_ID_ASSERTION = /\brecord(?:\?)?\.recordId\s*\)?\s*\bas\b/g;

function assertionCount(src: string): number {
  RECORD_ID_ASSERTION.lastIndex = 0;
  return (maskComments(src).match(RECORD_ID_ASSERTION) || []).length;
}

const PANEL_TEXT = readFileSync(PANEL, 'utf8');

describe('the census instrument can fire (controls)', () => {
  it('anchors on this file, not on the cwd', () => {
    expect(PANEL_TEXT).toContain('LineItemsPanel');
    expect(PANEL_TEXT).toContain('useRecordContext');
  });

  it('flags the assertion this card removed', () => {
    // Assembled from fragments so the control is not itself a census hit if
    // the scan is ever widened to this file.
    const wide = 'const parentId = schema.parentId || (record?.recordId' + ' as ' + 'string);';
    expect(assertionCount(wide)).toBe(1);
  });

  it('does not flag the repaired read', () => {
    expect(assertionCount('const parentId = schema.parentId || record?.recordId;')).toBe(0);
  });

  it('masks comments, so prose about the old defect is not a defect', () => {
    const commented = '// record?.recordId' + ' as ' + 'string\nconst x = 1;';
    expect(assertionCount(commented)).toBe(0);
    const block = '/* record?.recordId' + ' as ' + 'string */\nconst x = 1;';
    expect(assertionCount(block)).toBe(0);
  });
});

describe('LineItemsPanel reads the parent id through the declaration (objectui#9333)', () => {
  it('carries no type assertion on the record-context id', () => {
    expect(
      assertionCount(PANEL_TEXT),
      [
        'The parent id is asserted again.',
        '`RecordContextValue.recordId` is the protocol`s `string` and',
        '`buildMasterDetailEditBatch` takes a `string` parent id, so the two',
        'meet without help. An assertion here means one of those declarations',
        'moved - repair the declaration, not the read site (objectui#9333).',
      ].join('\n'),
    ).toBe(0);
  });
});
