/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate` and a `record:related_list` bound by `dataSource`
 * (objectui#12302).
 *
 * The related list's binding is the binding of its CHILD rows (objectstack#6953):
 * its renderer is gate-wrapped and maps the binding onto `objectName`,
 * `columns`, `filter`, `sort` and `limit`. The strict authoring face refused the
 * key as undeclared before this card, so the validator told an author that a
 * binding the console honours does not exist.
 *
 * Pinned by KIND and by named subject (exit code, the block type, the key),
 * never by message wording:
 *
 *   - the validator ACCEPTS a related list bound to its child rows, at the root
 *     and inside a page region, with or without a bag beside the binding;
 *   - the one-record `limit: 1` warning (objectui#12294) never names the related
 *     list, whose rows are many by design — in the same run that warns on a
 *     one-record block (the lit control);
 *   - a block that reads no binding is still refused it, naming `dataSource`.
 *
 * Harness (fixtures under `os.tmpdir()`, `process.exit` recorded rather than
 * taken) follows `validate-record-block-binding-limit-12294.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate } from '../commands/validate.js';

/** The CSI sequences chalk may add, built without a raw escape byte in the source. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

const printed = (): string => out.join('\n').replace(ANSI, '');
/** The printed lines that name a record block as bound. */
const boundBlockWarnings = (): string[] =>
  printed().split('\n').filter((l) => /record:[a-z_]+ is bound/.test(l));

function writeSchema(name: string, schema: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(schema, null, 2), 'utf-8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-12302-'));
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

const BAG = { objectName: 'sys_member', relationshipField: 'organization_id' };

describe('objectui validate — `record:related_list` bound to its child rows (objectui#12302)', () => {
  it.each([
    ['the card\'s node: a binding with `limit: 5`', { type: 'record:related_list', dataSource: { object: 'sys_member', limit: 5 } }],
    ['a binding with no `limit` at all', { type: 'record:related_list', dataSource: { object: 'sys_member' } }],
    ['a binding beside the block\'s bag', {
      type: 'record:related_list',
      properties: BAG,
      dataSource: { object: 'sys_member', sort: [{ field: 'created_at', order: 'desc' }], limit: 5 },
    }],
  ])('accepts %s, and prints no warning', async (_why, node) => {
    await validate(writeSchema('bound.json', node));

    expect(exitCodes).toEqual([0]);
    expect(printed()).toContain('Schema is valid');
    expect(printed()).not.toContain('Warnings:');
    expect(boundBlockWarnings()).toEqual([]);
  });

  it('inside a page region, beside a one-record block the warning DOES name (lit control)', async () => {
    await validate(writeSchema('page.json', {
      type: 'page',
      regions: [{
        name: 'main',
        components: [
          { type: 'record:related_list', properties: BAG, dataSource: { object: 'sys_member', limit: 5 } },
          { type: 'record:details', dataSource: { object: 'sys_member' } },
        ],
      }],
    }));

    expect(exitCodes).toEqual([0]);
    const lines = boundBlockWarnings();
    // The warning machinery ran on this document: it named the one-record block…
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('regions → 0 → components → 1');
    expect(lines[0]).toContain('record:details');
    // …and not the related list beside it.
    expect(printed()).not.toMatch(/record:related_list is bound/);
  });

  it('a record block that reads no binding is still refused it, by name', async () => {
    await validate(writeSchema('path.json', { type: 'record:path', dataSource: { object: 'sys_member', limit: 5 } }));

    expect(exitCodes).toEqual([1]);
    expect(printed()).toContain('"dataSource"');
    expect(printed()).toContain('record:path');
  });
});
