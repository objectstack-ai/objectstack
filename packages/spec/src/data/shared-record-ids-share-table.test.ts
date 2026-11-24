// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D2] The fixed inner read `SharedRecordIds` describes names the
 * `sys_record_share` declaration's own table, columns and index.
 *
 * That table lives in `@objectstack/plugin-sharing`, which spec cannot import.
 * So the description is reconciled with that declaration's SOURCE, read from
 * disk: the one home of the predicate every evaluator compiles must name real
 * columns. The read leaves this package, so this file runs in the `repo` vitest
 * project (`vitest.repo-tests.json`), whose turbo inputs carry every package's
 * object declarations.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SharedRecordIds } from './shared-record-ids';

describe('the inner read names the sys_record_share declaration\'s own table, columns and index', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(HERE, '../../../plugins/plugin-sharing/src/objects/sys-record-share.object.ts'), 'utf8');
  const read = SharedRecordIds.innerRead(SharedRecordIds.write('account', 'u1', ['edit']));

  it('the table is the object that file declares', () => {
    expect(source).toMatch(new RegExp(`\\bname:\\s*'${read.table}'`));
  });

  it('the projected column and every predicate column are fields of it', () => {
    for (const column of [read.column, ...Object.keys(read.equals), ...Object.keys(read.memberOf)]) {
      expect(source, column).toMatch(new RegExp(`^\\s*${column}:\\s*Field\\.`, 'm'));
    }
  });

  it('`user` is a recipient_type the table stores', () => {
    const select = source.slice(source.search(/^\s*recipient_type:\s*Field\.select\(/m));
    expect(select.slice(0, select.indexOf('label:'))).toContain(`value: '${read.equals.recipient_type}'`);
  });

  it('the equality columns are the index the read is backed by (ADR-0155 D2)', () => {
    expect(source).toContain(`{ fields: [${['object_name', 'recipient_type', 'recipient_id'].map((c) => `'${c}'`).join(', ')}] }`);
    expect(Object.keys(read.equals)).toEqual(['object_name', 'recipient_type', 'recipient_id']);
  });
});
