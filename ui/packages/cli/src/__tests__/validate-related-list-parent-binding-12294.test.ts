/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate` and a `record:related_list` whose PARENT record is bound
 * by `parentDataSource` (objectui#12294's related-list leg, ruling B on
 * objectui#12296).
 *
 * The key is a member of the spec row (`RecordRelatedListProps.parentDataSource`),
 * so it is authored in the block's `properties` bag, the spec's props door, and
 * the strict authoring face carries it there by reference to the row. This file
 * pins what the validator says about it, by KIND and named subject (exit code,
 * block type, key), never by message wording:
 *
 *   - the bag form is ACCEPTED, at the root and inside a page region, beside the
 *     child-row `dataSource` binding the block also reads;
 *   - a parent binding without `limit: 1` is accepted with the one-record
 *     warning that names the key — the existing single-record rule on one more
 *     carrier of it — and a binding WITH `limit: 1` prints nothing;
 *   - the node-level spelling is refused toward `properties.parentDataSource`,
 *     the door the spec row puts it behind;
 *   - a block that reads no parent binding is still refused the key, by name.
 *
 * Harness (fixtures under `os.tmpdir()`, `process.exit` recorded rather than
 * taken) follows `validate-related-list-binding-12302.test.ts`.
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
/** The printed warning lines that name a parent binding. */
const parentBindingWarnings = (): string[] =>
  printed().split('\n').filter((l) => l.includes('properties.parentDataSource') && l.includes('limit: 1'));

function writeSchema(name: string, schema: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(schema, null, 2), 'utf-8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-12294-parent-'));
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

const BAG = { objectName: 'sys_member', relationshipField: 'environment_id' };
const PRODUCTION = [{ field: 'environment_type', operator: 'equals', value: 'production' }];
const PARENT = { object: 'sys_environment', filter: PRODUCTION, limit: 1 };

describe('objectui validate — `record:related_list` bound to its parent by `parentDataSource` (objectui#12294)', () => {
  it.each([
    ['at the root', { type: 'record:related_list', properties: { ...BAG, parentDataSource: PARENT } }],
    ['beside the child-row `dataSource` binding', {
      type: 'record:related_list',
      properties: { ...BAG, parentDataSource: { ...PARENT, sort: [{ field: 'created_at', order: 'desc' }] } },
      dataSource: { object: 'sys_member', limit: 5 },
    }],
    ['inside a page region', {
      type: 'page',
      regions: [{ name: 'main', components: [{ type: 'record:related_list', properties: { ...BAG, parentDataSource: PARENT } }] }],
    }],
  ])('accepts the bag form %s, and prints no warning', async (_where, node) => {
    await validate(writeSchema('bound.json', node));

    expect(exitCodes).toEqual([0]);
    expect(printed()).toContain('Schema is valid');
    expect(printed()).not.toContain('Warnings:');
  });

  it('warns on a parent binding without `limit: 1`, naming the block, the key and where it sits', async () => {
    await validate(writeSchema('page.json', {
      type: 'page',
      regions: [{
        name: 'main',
        components: [
          { type: 'record:related_list', properties: { ...BAG, parentDataSource: { object: 'sys_environment', filter: PRODUCTION } } },
        ],
      }],
    }));

    // Advisory: the document is still valid.
    expect(exitCodes).toEqual([0]);
    expect(printed()).toContain('Schema is valid');
    const lines = parentBindingWarnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('regions → 0 → components → 0');
    expect(lines[0]).toContain('record:related_list');
    expect(lines[0]).toContain('"sys_environment"');
  });

  it('the CHILD-row binding alone still draws no warning — the control for the parent one', async () => {
    await validate(writeSchema('child.json', {
      type: 'record:related_list',
      properties: BAG,
      dataSource: { object: 'sys_member' },
    }));

    expect(exitCodes).toEqual([0]);
    expect(printed()).not.toContain('Warnings:');
  });

  it('refuses the node-level spelling, toward the `properties` bag the spec row puts it in', async () => {
    await validate(writeSchema('flat.json', { type: 'record:related_list', properties: BAG, parentDataSource: PARENT }));

    expect(exitCodes).toEqual([1]);
    expect(printed()).toContain('properties.parentDataSource');
    expect(printed()).toContain('record:related_list');
  });

  it('a block that reads no parent binding is still refused it, by name — `record:details`', async () => {
    // Control first: the same node without the key is valid, so the refusal
    // below is the key's and not a malformed fixture's.
    await validate(writeSchema('details.json', { type: 'record:details', properties: { fields: ['name'] } }));
    expect(exitCodes).toEqual([0]);

    out.length = 0;
    exitCodes.length = 0;
    await validate(writeSchema('details-parent.json', {
      type: 'record:details',
      properties: { fields: ['name'], parentDataSource: PARENT },
    }));
    expect(exitCodes).toEqual([1]);
    expect(printed()).toContain('"parentDataSource"');
    expect(printed()).toContain('record:details');
  });
});
