/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9722 — the bulk executor's data-source face is DERIVED from
 * `DataSource`, and the one in-tree hand-off is a real check again.
 *
 * ## What went wrong, and what is pinned
 *
 * `BulkExecutorOptions.dataSource` used to RESTATE the members it consumes.
 * The restatement drifted: it still spelled the pre-objectui#9511
 * `ReadonlyArray<string | number>` for `bulkUpdate` / `bulkDelete` after the
 * interface narrowed to `ReadonlyArray<string>`. Both members are declared
 * with property syntax, so `strictFunctionTypes` compares their parameters
 * CONTRAVARIANTLY — the narrowed `DataSource` was therefore not assignable to
 * this face at all. Nothing failed only because the single hand-off
 * (`ObjectGrid` → `BulkActionDialog`) erased the check with an `as any`.
 *
 * ⇒ the reading "narrowing those doors costs zero call sites" was true BY
 * CAST, not because the consumer agreed. That is what these rows exist to
 * stop from recurring, from BOTH sides:
 *
 * - the two bulk doors are the interface's own members, not copies of them;
 * - a whole `DataSource` is assignable to the face, which is the check the
 *   `as any` was erasing;
 * - neither hand-off site re-introduces a cast.
 *
 * ## Where each half runs — they measure different things
 *
 * The `type _...` rows are ERASED before vitest loads this file; only
 * `tsc -p packages/plugin-grid/tsconfig.test.json` (chained from this
 * package's `type-check` script) executes them. A green vitest run says
 * nothing about a compile-time assertion.
 *
 * The `it(...)` rows are a source-text census, and they are NOT redundant:
 * they red in a tree where `tsc` never runs, and they name the offending
 * spelling. ⚠️ Every one of them reads a SCOPED SLICE, never the whole file —
 * the prose above each declaration quotes the very spellings being refused
 * (`ReadonlyArray<string | number>`, `as any`), and a count over the file
 * cannot tell a live declaration from a quotation that retires one. The
 * controls below assert that difference directly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSource } from '@object-ui/types';
import type { BulkExecutorOptions } from '../hooks/useBulkExecutor';

/* ------------------------------------------------------------------ *
 * Compile-time half.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type ExecutorFace = BulkExecutorOptions['dataSource'];

/**
 * The two bulk doors ARE the interface's members — identity, not a copy that
 * happens to agree today. A restatement that re-drifts fails this row even if
 * it is momentarily equivalent in some other spelling.
 */
type _BulkUpdateIsTheInterfaceMember =
  Expect<Equal<ExecutorFace['bulkUpdate'], DataSource['bulkUpdate']>>;
type _BulkDeleteIsTheInterfaceMember =
  Expect<Equal<ExecutorFace['bulkDelete'], DataSource['bulkDelete']>>;

declare const adapter: DataSource;

/**
 * The assignability the `as any` used to erase, stated where it cannot be
 * cast away: a whole `DataSource` satisfies the executor's face.
 *
 * Held inside a function that is referenced and never invoked — `declare
 * const adapter` is erased, so the body would throw if it ever ran; keeping
 * it unreachable is what makes these rows compile-time-only in a file vitest
 * also loads.
 */
function handOffControls(): void {
  const face: ExecutorFace = adapter;
  void face;

  // Control: the narrowed record-id rule reaches CALLERS through this face,
  // not only through `DataSource`. Re-widen either side and the directive
  // becomes UNUSED (TS2578), so it fires for exactly the drift it guards.
  // @ts-expect-error a numeric primary key is not a bulk id
  void face.bulkUpdate?.('account', [7], {});
  // @ts-expect-error nor a bulk-delete id
  void face.bulkDelete?.('account', [7]);

  // The neighbouring string calls must stay legal, or the refusals above
  // would prove nothing.
  void face.bulkUpdate?.('account', ['rec_1'], {});
  void face.bulkDelete?.('account', ['rec_1']);
}
void handOffControls;

/* ------------------------------------------------------------------ *
 * Runtime half — a census over the declaration text.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-grid/src/__tests__  ->  packages/plugin-grid/src
const SRC = path.resolve(here, '..');

const EXECUTOR_TEXT = readFileSync(path.join(SRC, 'hooks', 'useBulkExecutor.ts'), 'utf8');
const GRID_TEXT = readFileSync(path.join(SRC, 'ObjectGrid.tsx'), 'utf8');

/** The `dataSource: { … };` member of `BulkExecutorOptions`, and nothing else. */
function executorFaceBlock(source: string): string | null {
  const start = source.indexOf('  dataSource: {');
  if (start < 0) return null;
  const end = source.indexOf('\n  };', start);
  return end < 0 ? null : source.slice(start, end + 5);
}

/** The opening tag of one JSX element, `<Name` through the first `>`. */
function openTag(source: string, name: string): string | null {
  const start = source.indexOf(`<${name}`);
  if (start < 0) return null;
  const end = source.indexOf('>', start);
  return end < 0 ? null : source.slice(start, end + 1);
}

const WIDE_IDS = 'ReadonlyArray<string | number>';
const ERASING_CAST = 'dataSource={dataSource as any}';

describe('the census instrument can fire (controls)', () => {
  it('anchors on this file, not on the cwd', () => {
    expect(EXECUTOR_TEXT).toContain('export interface BulkExecutorOptions');
    expect(GRID_TEXT).toContain('export interface ObjectGridComponentProps');
  });

  it('reads a restated wide face back off a synthetic declaration', () => {
    const restated = [
      '  dataSource: {',
      '    update: (resource: string, id: string, patch: Record<string, unknown>) => Promise<unknown>;',
      `    bulkUpdate?: (resource: string, ids: ${WIDE_IDS}, patch: Record<string, unknown>) => Promise<number>;`,
      '  };',
    ].join('\n');
    const block = executorFaceBlock(restated);
    expect(block).not.toBeNull();
    expect(block).toContain(WIDE_IDS);
    expect(block).not.toContain("DataSource['bulkUpdate']");
  });

  it('reads an erasing cast back off a synthetic hand-off', () => {
    const tag = openTag(`<BulkActionDialog\n  ${ERASING_CAST}\n/>`, 'BulkActionDialog');
    expect(tag).toContain(ERASING_CAST);
  });

  it('returns null rather than a false negative when the subject is absent', () => {
    expect(executorFaceBlock('export interface Empty {}')).toBeNull();
    expect(openTag('const x = 1;', 'BulkActionDialog')).toBeNull();
  });

  /**
   * ⭐ The control that matters most here. Both spellings the rows below
   * refuse are QUOTED in the prose that explains why they were refused, so a
   * whole-file count reads them as present and cannot tell a live declaration
   * from its own tombstone. These two reads prove the slices are narrower
   * than the files.
   */
  it('the slices are narrower than the files they come from', () => {
    expect(EXECUTOR_TEXT, 'the docblock quotes the retired spelling').toContain(WIDE_IDS);
    expect(GRID_TEXT, 'ObjectGrid casts plenty of other values').toContain('as any');
  });
});

describe('the executor derives the bulk doors instead of restating them (objectui#9722)', () => {
  it('the face names `DataSource`s own members for both bulk doors', () => {
    const block = executorFaceBlock(EXECUTOR_TEXT);
    expect(block).not.toBeNull();
    expect(
      block,
      'restating a member of an interface this file already imports is what drifted: pin the member, not a copy of it',
    ).toContain("bulkUpdate?: DataSource['bulkUpdate'];");
    expect(block).toContain("bulkDelete?: DataSource['bulkDelete'];");
  });

  it('the face no longer spells the pre-objectui#9511 union', () => {
    const block = executorFaceBlock(EXECUTOR_TEXT);
    expect(
      block,
      [
        'The executor face carries a record-id union again.',
        '`DataSource` narrowed these doors to `ReadonlyArray<string>` at objectui#9511;',
        'a face that re-states the union is only assignable behind a cast, which is',
        'exactly how this drift went unread for as long as it did.',
      ].join('\n'),
    ).not.toContain(WIDE_IDS);
  });
});

describe('neither hand-off erases the check (objectui#9722)', () => {
  for (const name of ['BulkActionDialog', 'RecordDetailPanel'] as const) {
    it(`\`${name}\` is handed the grid's \`dataSource\` without \`as any\``, () => {
      const tag = openTag(GRID_TEXT, name);
      expect(tag).not.toBeNull();
      expect(tag).toContain('dataSource={dataSource');
      expect(
        tag,
        [
          `The \`${name}\` hand-off erases the data-source check again.`,
          'An `as any` here does not merely hide one error: it lets the two faces',
          'drift apart in EITHER direction, silently, for as long as it stands.',
        ].join('\n'),
      ).not.toContain(ERASING_CAST);
    });
  }
});
