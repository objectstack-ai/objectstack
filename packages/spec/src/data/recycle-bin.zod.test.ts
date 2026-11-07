// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [ADR-0148 D5, card #30235] The recycle bin's spec half. Each surface here is
// declared ahead of its reader (#30237 engine, #30239 Console); these pins hold
// the spellings the readers assert by value.

import { describe, expect, it } from 'vitest';
import {
  RECORD_RESTORED_EVENT,
  RECYCLE_BIN_DEFAULT_RETENTION_DAYS,
  RECYCLE_BIN_ENTRY_FIELDS,
  RECYCLE_BIN_GRANT_KEYS,
  RECYCLE_BIN_OBJECT,
  RECYCLE_BIN_RESTORE_REFUSAL_CODES,
  RECYCLE_BIN_RESTORE_REFUSAL_STATUS,
  RECYCLE_BIN_RETENTION_DAYS_ENV,
  RecycleBinRetentionDaysEnvSchema,
  RecycleBinEntrySchema,
  RecycleBinRetentionDaysSchema,
  RecycleBinSnapshotSchema,
  recycleBinRetentionRefusal,
  type RecycleBinRetentionResolver,
} from './recycle-bin.zod';
import { DataEventType } from '../api/events.zod';
import { RealtimeEventType } from '../api/realtime.zod';
import { REGISTERED_ERROR_CODES } from '../api/error-code-ledger.zod';
import { ObjectPermissionSchema } from '../security/permission.zod';
import { ObjectSchema } from './object.zod';

describe('recycle bin names (ADR-0148 D1/D3, D7 ratified)', () => {
  it('fixes the object, the variable and the default', () => {
    expect(RECYCLE_BIN_OBJECT).toBe('sys_recycle_bin');
    expect(RECYCLE_BIN_RETENTION_DAYS_ENV).toBe('OS_RECYCLE_BIN_RETENTION_DAYS');
    expect(RECYCLE_BIN_DEFAULT_RETENTION_DAYS).toBe(30);
  });
});

describe('the host retention resolver hook (ADR-0148 D3)', () => {
  it('takes the resolveFeatures token and answers days or nothing', () => {
    const hook: RecycleBinRetentionResolver = (token) => (token === 'team' ? 30 : token === 'free' ? 7 : undefined);
    expect(hook('free')).toBe(7);
    expect(hook(undefined)).toBeUndefined();
  });

  it('accepts a positive whole number of days', () => {
    for (const days of [1, 7, 30, 365]) expect(RecycleBinRetentionDaysSchema.parse(days)).toBe(days);
  });

  it('refuses zero and every non-number as a configuration defect, never as now or forever', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, '30', true]) {
      const result = RecycleBinRetentionDaysSchema.safeParse(value);
      expect(result.success, `${String(value)} refused`).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(recycleBinRetentionRefusal('resolver', value));
    }
  });

  it('holds the variable to the decimal digits of a positive whole number', () => {
    for (const text of ['1', '30', '365']) expect(RecycleBinRetentionDaysEnvSchema.parse(text)).toBe(text);
    for (const text of ['0', '030', '-7', '7.5', ' 7', 'thirty', '']) {
      const result = RecycleBinRetentionDaysEnvSchema.safeParse(text);
      expect(result.success, `${JSON.stringify(text)} refused`).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(recycleBinRetentionRefusal('env', text));
    }
  });

  it('names the source and the remedy, and no plan', () => {
    const fromHook = recycleBinRetentionRefusal('resolver', 0);
    expect(fromHook).toMatch(/^The host retention resolver answered 0, /);
    expect(fromHook).toMatch(/undefined to keep the default/);
    const fromEnv = recycleBinRetentionRefusal('env', '0');
    expect(fromEnv).toMatch(/^OS_RECYCLE_BIN_RETENTION_DAYS is set to "0", /);
    expect(fromEnv).toMatch(/default of 30/);
    for (const text of [fromHook, fromEnv]) {
      expect(text).not.toMatch(/plan|tier|entitle|#\d/i);
    }
  });
});

describe('the entry snapshot (ADR-0148 D1/D2/D4)', () => {
  it('holds the cascade set, master first, and the references the delete cleared', () => {
    const snapshot = {
      rows: [
        { object: 'invoice', id: 'inv_1', values: { name: 'INV-1', created_by: 'usr_1' } },
        { object: 'invoice_line', id: 'line_1', values: { invoice: 'inv_1', amount: 10 } },
      ],
      clearedReferences: [{ object: 'payment', id: 'pay_1', field: 'invoice', value: 'inv_1' }],
    };
    expect(RecycleBinSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('refuses an entry with no rows', () => {
    expect(RecycleBinSnapshotSchema.safeParse({ rows: [], clearedReferences: [] }).success).toBe(false);
  });
});

describe('the entry field contract (ADR-0148 D1)', () => {
  const fields = RECYCLE_BIN_ENTRY_FIELDS as Record<string, { type: string; required?: boolean; readonly?: boolean; reference?: string }>;

  it('records what was removed, who deleted and when, and the stamped purge deadline', () => {
    expect(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.type]))).toEqual({
      id: 'text',
      object_name: 'text',
      record_id: 'text',
      record_count: 'number',
      snapshot: 'json',
      deleted_by: 'lookup',
      deleted_at: 'datetime',
      retention_days: 'number',
      purge_after: 'datetime',
    });
    expect(fields.deleted_by.reference).toBe('sys_user');
    for (const key of ['object_name', 'record_id', 'record_count', 'snapshot', 'deleted_at', 'retention_days', 'purge_after']) {
      expect(fields[key].required, `${key} required`).toBe(true);
    }
    for (const [key, field] of Object.entries(fields)) expect(field.readonly, `${key} readonly`).toBe(true);
  });

  it('builds a valid object under the fixed name, engine-owned with no generic API method', () => {
    expect(() => ObjectSchema.parse({
      name: RECYCLE_BIN_OBJECT,
      label: 'Recycle Bin Entry',
      isSystem: true,
      managedBy: 'engine-owned',
      fields: RECYCLE_BIN_ENTRY_FIELDS,
      enable: { apiMethods: [] },
    })).not.toThrow();
  });

  it('has a value schema key for key with the fields', () => {
    expect(Object.keys(RecycleBinEntrySchema.shape).sort()).toEqual(Object.keys(fields).sort());
    const entry = {
      object_name: 'invoice',
      record_id: 'inv_1',
      record_count: 1,
      snapshot: { rows: [{ object: 'invoice', id: 'inv_1', values: {} }], clearedReferences: [] },
      deleted_by: 'usr_1',
      deleted_at: '2026-11-05T10:00:00Z',
      retention_days: 30,
      purge_after: '2026-12-05T10:00:00Z',
    };
    expect(RecycleBinEntrySchema.parse(entry)).toEqual(entry);
    expect(RecycleBinEntrySchema.safeParse({ ...entry, retention_days: 0 }).success).toBe(false);
  });
});

describe('the restore refusals (ADR-0148 D2)', () => {
  it('are three registered codes answering 409', () => {
    for (const code of Object.values(RECYCLE_BIN_RESTORE_REFUSAL_CODES)) {
      expect(REGISTERED_ERROR_CODES).toContain(code);
    }
    expect(RECYCLE_BIN_RESTORE_REFUSAL_STATUS).toBe(409);
  });
});

describe('the restored event (ADR-0148 D2)', () => {
  it('is named in the record-event pattern, never a create', () => {
    expect(RECORD_RESTORED_EVENT).toBe('data.record.restored');
    expect(RECORD_RESTORED_EVENT).not.toBe('data.record.created');
  });

  it('is a member of both emitted-event enums, since the engine emits it', () => {
    // The enums are the emitted set (realtime.test.ts pins them equal). The
    // engine's restore (#30237) emits it, so both enums hold it, spelled as
    // this constant's value.
    expect(DataEventType.options).toContain(RECORD_RESTORED_EVENT);
    expect(RealtimeEventType.options).toContain(RECORD_RESTORED_EVENT);
  });
});

describe('the two grant keys (ADR-0148 D2/D5)', () => {
  it('are accepted object permission keys, optional and never defaulted', () => {
    const parsed = ObjectPermissionSchema.parse({
      allowRead: true,
      [RECYCLE_BIN_GRANT_KEYS.restoreOwnDeleted]: true,
      [RECYCLE_BIN_GRANT_KEYS.manage]: false,
    }) as Record<string, unknown>;
    expect(parsed.allowRestoreOwnDeleted).toBe(true);
    expect(parsed.manageRecycleBin).toBe(false);
    const bare = ObjectPermissionSchema.parse({ allowRead: true }) as Record<string, unknown>;
    expect('allowRestoreOwnDeleted' in bare).toBe(false);
    expect('manageRecycleBin' in bare).toBe(false);
  });

  it('leave the retired spellings tombstoned', () => {
    for (const key of ['allowRestore', 'allowPurge']) {
      expect(ObjectPermissionSchema.safeParse({ allowRead: true, [key]: true }).success, key).toBe(false);
    }
  });
});
