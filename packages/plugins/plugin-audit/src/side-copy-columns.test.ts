// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442] `side-copy-columns.ts`: the listed columns are omitted from every
 * ledger copy, by the writer and by the at-rest rewrite's two planners.
 */

import { describe, it, expect } from 'vitest';
import { SIDE_COPY_COLUMNS, SIDE_COPY_OBJECTS, omitSideCopyFromCopy, sideCopyColumnsOf } from './side-copy-columns.js';
import { planSideCopyActivityRowPatch, planSideCopyAuditRowPatch } from './side-copy-migration.js';
import { namedSideCopyCarriers } from './parent-field-query-guard.js';
import { redactAuditLogRows } from './audit-log-field-redaction.js';

const REQUEST = 'sys_approval_request';
const SNAPSHOT = JSON.stringify({ name: 'INV-1', cost_code: 'SYNTH-SIDE-COPY-58' });

describe('[#32442] the side-copy list', () => {
  it('names exactly the request snapshot column, and reads an inherited name as unlisted', () => {
    expect([...SIDE_COPY_COLUMNS.entries()]).toEqual([[REQUEST, ['payload_json']]]);
    expect(SIDE_COPY_OBJECTS).toEqual([REQUEST]);
    for (const name of ['constructor', '__proto__', 'toString', 'crm_note', 42, undefined]) {
      expect(sideCopyColumnsOf(name)).toEqual([]);
    }
  });

  it('omits the listed column in place, once', () => {
    const copy: Record<string, unknown> = { status: 'pending', payload_json: SNAPSHOT };
    expect(omitSideCopyFromCopy(REQUEST, copy)).toBe(true);
    expect(copy).toEqual({ status: 'pending' });
    expect(omitSideCopyFromCopy(REQUEST, copy)).toBe(false);
    const other: Record<string, unknown> = { payload_json: 'kept' };
    expect(omitSideCopyFromCopy('crm_note', other)).toBe(false);
    expect(other).toEqual({ payload_json: 'kept' });
  });
});

describe('[#32442] the at-rest rewrite plans', () => {
  it('rewrites both audit snapshots of a listed object and nothing else, idempotently', () => {
    const row = {
      object_name: REQUEST,
      old_value: JSON.stringify({ status: 'pending', payload_json: SNAPSHOT }),
      new_value: JSON.stringify({ status: 'approved', payload_json: SNAPSHOT }),
    };
    const patch = planSideCopyAuditRowPatch(row)!;
    expect(JSON.parse(patch.old_value as string)).toEqual({ status: 'pending' });
    expect(JSON.parse(patch.new_value as string)).toEqual({ status: 'approved' });
    expect(planSideCopyAuditRowPatch({ ...row, ...patch })).toBeNull();
    expect(planSideCopyAuditRowPatch({ ...row, object_name: 'crm_note' })).toBeNull();
  });

  it('rewrites both halves of an activity pair, keeping every other key', () => {
    const row = {
      object_name: REQUEST,
      metadata: JSON.stringify({ old: null, new: { status: 'pending', payload_json: SNAPSHOT }, kind: 'created' }),
    };
    const patch = planSideCopyActivityRowPatch(row)!;
    expect(JSON.parse(patch.metadata as string)).toEqual({ old: null, new: { status: 'pending' }, kind: 'created' });
    expect(planSideCopyActivityRowPatch({ ...row, ...patch })).toBeNull();
  });
});

describe('[#32442] the query guards refuse a carrying column whose reach includes a listed parent', () => {
  const named = (predicate: string[], aggregate: string[] = []) => ({ predicate, aggregate });

  it('refuses metadata on the activity stream pinned to the request, or pinned to nothing', () => {
    expect(namedSideCopyCarriers('sys_activity', REQUEST, named(['metadata']))).toEqual(named(['metadata']));
    expect(namedSideCopyCarriers('sys_activity', null, named([], ['metadata']))).toEqual(named([], ['metadata']));
    expect(namedSideCopyCarriers('sys_audit_log', REQUEST, named(['new_value', 'object_name'])))
      .toEqual(named(['new_value']));
  });

  it('admits another parent, and a column that carries no copy', () => {
    expect(namedSideCopyCarriers('sys_activity', 'crm_note', named(['metadata']))).toBeNull();
    expect(namedSideCopyCarriers('sys_activity', REQUEST, named(['summary']))).toBeNull();
    expect(namedSideCopyCarriers('sys_comment', REQUEST, named(['metadata']))).toBeNull();
  });
});

describe('[#32442] the ledger redaction drops the listed column from a copy at rest', () => {
  it('for a reader served every request field, and for one with no security answer', async () => {
    const all = { getReadableFields: async () => ['status', 'payload_json'], getQueryableFields: async () => ['status', 'payload_json'] };
    for (const security of [all, undefined]) {
      const row: Record<string, unknown> = {
        action: 'update',
        object_name: REQUEST,
        old_value: JSON.stringify({ status: 'pending', payload_json: SNAPSHOT }),
        new_value: JSON.stringify({ status: 'approved', payload_json: SNAPSHOT }),
      };
      await redactAuditLogRows([row], security, { userId: 'u_reader' });
      expect(JSON.parse(row.old_value as string)).toEqual({ status: 'pending' });
      expect(JSON.parse(row.new_value as string)).toEqual({ status: 'approved' });
    }
  });
});

