// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema, RECYCLE_BIN_OBJECT, resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { SysRecycleBin } from './sys-recycle-bin.object.js';
import { PlatformObjectsPlugin } from '../plugin.js';

/**
 * [ADR-0148 D1/D5, card #30235] `sys_recycle_bin`'s declaration — the spec half.
 * The engine slice (#30237) writes and reads it; these pins hold the field
 * list it builds against, asserted on the BUILT value.
 */
describe('sys_recycle_bin — declaration (ADR-0148 D1)', () => {
  const fields = SysRecycleBin.fields as Record<string, any>;

  it('parses as an ObjectSchema under the name the spec fixes', () => {
    expect(() => ObjectSchema.parse(SysRecycleBin)).not.toThrow();
    expect(SysRecycleBin.name).toBe(RECYCLE_BIN_OBJECT);
  });

  it('records what was removed, who deleted and when, and the stamped purge deadline', () => {
    expect(Object.keys(fields).sort()).toEqual([
      'deleted_at',
      'deleted_by',
      'id',
      'object_name',
      'purge_after',
      'record_count',
      'record_id',
      'retention_days',
      'snapshot',
    ]);
    expect(fields.snapshot.type).toBe('json');
    expect(fields.deleted_by).toMatchObject({ type: 'lookup', reference: 'sys_user' });
    for (const key of ['object_name', 'record_id', 'record_count', 'snapshot', 'deleted_at', 'retention_days', 'purge_after']) {
      expect(fields[key].required, `${key} required`).toBe(true);
    }
    for (const key of Object.keys(fields)) expect(fields[key].readonly, `${key} readonly`).toBe(true);
  });

  it('is organization-owned like every other row (ADR-0131), on the default datasource', () => {
    expect(resolveInjectedSystemColumns(SysRecycleBin)).toContain('organization_id');
    expect((SysRecycleBin as { datasource?: string }).datasource).toBeUndefined();
  });

  it('serves no generic data-API method: the listing applies field-level security (ADR-0148 D4)', () => {
    expect(SysRecycleBin.managedBy).toBe('engine-owned');
    expect(SysRecycleBin.enable?.apiMethods).toEqual([]);
  });

  it('is not registered until the engine slice lands its writer', async () => {
    const registered: string[] = [];
    const manifest = { register: (m: { objects?: Array<{ name: string }> }) => registered.push(...(m.objects ?? []).map((o) => o.name)) };
    await new PlatformObjectsPlugin().init({ getService: (name: string) => (name === 'manifest' ? manifest : undefined), hook: () => {} });
    expect(registered).toContain('sys_secret');
    expect(registered).not.toContain(RECYCLE_BIN_OBJECT);
  });
});
