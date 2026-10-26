/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate` and a record block bound by `dataSource` (objectui#12294).
 *
 * `record:details`, `record:highlights` and `record:quick_actions` show ONE
 * record. Bound through the spec's per-element `dataSource`, they draw the
 * FIRST row of the bound set by the binding's `sort`, so a binding without
 * `limit: 1` is valid, and the validator WARNS on it: the author says which
 * record they mean.
 *
 * Pinned by KIND and by named subject (the path and the block type), never by
 * the warning's wording:
 *
 *   - the strict authoring face ACCEPTS the binding on the three blocks (it
 *     refused it as an undeclared key before), and the document validates;
 *   - a binding with no `limit: 1` is warned about once, at its path, in a page
 *     region as at the root;
 *   - `limit: 1` silences it; a node with no binding is not a bound block;
 *   - `record:related_list` is never warned about: its binding is the binding of
 *     its CHILD rows, which are many by design.
 *
 * Harness (fixtures under `os.tmpdir()`, `process.exit` recorded rather than
 * taken) follows `validate-root-path-line.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate } from '../commands/validate.js';
import { findRecordBindingsWithoutLimitOne } from '../utils/record-block-binding-hint.js';

/** The CSI sequences chalk may add, built without a raw escape byte in the source. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const PRODUCTION = [{ field: 'environment_type', operator: 'equals', value: 'production' }];

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

const printed = (): string => out.join('\n').replace(ANSI, '');
/** The lines of the warning block that name a record block. */
const recordWarnings = (): string[] =>
  printed().split('\n').filter((l) => /record:(details|highlights|quick_actions|related_list) is bound/.test(l));

function writeSchema(name: string, schema: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(schema, null, 2), 'utf-8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-12294-'));
  out = [];
  exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restore = () => {
    console.log = originalLog;
    console.error = originalError;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

describe.each(['record:details', 'record:highlights', 'record:quick_actions'])(
  'objectui validate — %s bound by `dataSource` (objectui#12294)',
  (type) => {
    it('accepts the binding, and warns when it has no `limit: 1`', async () => {
      await validate(writeSchema('bound.json', { type, dataSource: { object: 'sys_environment', filter: PRODUCTION } }));

      expect(exitCodes).toEqual([0]);
      expect(printed()).toContain('Schema is valid');
      expect(printed()).toContain('Warnings:');
      const lines = recordWarnings();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('(root)');
      expect(lines[0]).toContain(type);
      expect(lines[0]).toContain('limit: 1');
    });

    it('is silent with `limit: 1`', async () => {
      await validate(writeSchema('bound.json', { type, dataSource: { object: 'sys_environment', filter: PRODUCTION, limit: 1 } }));

      expect(exitCodes).toEqual([0]);
      expect(recordWarnings()).toEqual([]);
      expect(printed()).not.toContain('Warnings:');
    });

    it('a `limit` other than 1 still warns', async () => {
      await validate(writeSchema('bound.json', { type, dataSource: { object: 'sys_environment', limit: 5 } }));

      expect(exitCodes).toEqual([0]);
      expect(recordWarnings()).toHaveLength(1);
    });
  },
);

describe('objectui validate — where the warning applies (objectui#12294)', () => {
  it('names the block\'s path inside a page region', async () => {
    await validate(writeSchema('page.json', {
      type: 'page',
      regions: [{
        name: 'main',
        components: [
          { type: 'record:highlights', properties: { fields: ['name'] }, dataSource: { object: 'sys_environment', limit: 1 } },
          { type: 'record:details', dataSource: { object: 'sys_environment', sort: [{ field: 'created_at', order: 'desc' }] } },
        ],
      }],
    }));

    expect(exitCodes).toEqual([0]);
    const lines = recordWarnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('regions → 0 → components → 1');
    expect(lines[0]).toContain('record:details');
  });

  it('an unbound record block is not a bound block, and is not warned about', async () => {
    await validate(writeSchema('plain.json', { type: 'record:details' }));

    expect(exitCodes).toEqual([0]);
    expect(printed()).not.toContain('Warnings:');
  });

  it('never names `record:related_list` for its `dataSource`, whose binding is its child rows', () => {
    // Read off the detector directly: the strict face's verdict on a related
    // list's binding is a separate question this card does not touch.
    expect(findRecordBindingsWithoutLimitOne({
      type: 'record:related_list',
      dataSource: { object: 'sys_member' },
    })).toEqual([]);
    // The same binding on a one-record block is named — the control.
    expect(findRecordBindingsWithoutLimitOne({
      type: 'record:details',
      dataSource: { object: 'sys_member' },
    })).toHaveLength(1);
  });
});
