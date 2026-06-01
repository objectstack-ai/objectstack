// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysPresence } from './sys-presence.object.js';
import { StorageNameMapping } from '@objectstack/spec/system';

describe('SysPresence object definition', () => {
  it('should use the literal sys_presence short name', () => {
    expect(SysPresence.name).toBe('sys_presence');
  });

  it('should resolve to physical table name sys_presence', () => {
    expect(StorageNameMapping.resolveTableName(SysPresence)).toBe('sys_presence');
  });

  it('should be a system object', () => {
    expect(SysPresence.isSystem).toBe(true);
  });

  it('should have label and pluralLabel', () => {
    expect(SysPresence.label).toBe('Presence');
    expect(SysPresence.pluralLabel).toBe('Presences');
  });

  it('should define all presence protocol fields', () => {
    const fieldKeys = Object.keys(SysPresence.fields);
    expect(fieldKeys).toContain('id');
    expect(fieldKeys).toContain('created_at');
    expect(fieldKeys).toContain('updated_at');
    expect(fieldKeys).toContain('user_id');
    expect(fieldKeys).toContain('session_id');
    expect(fieldKeys).toContain('status');
    expect(fieldKeys).toContain('last_seen');
    expect(fieldKeys).toContain('current_location');
    expect(fieldKeys).toContain('device');
    expect(fieldKeys).toContain('custom_status');
    expect(fieldKeys).toContain('metadata');
  });

  it('should have status field with correct options', () => {
    const statusField = SysPresence.fields.status;
    expect(statusField.type).toBe('select');
    expect(statusField.options).toEqual([
      { value: 'online', label: 'Online' },
      { value: 'away', label: 'Away' },
      { value: 'busy', label: 'Busy' },
      { value: 'offline', label: 'Offline' },
    ]);
  });

  it('should have device field with correct options', () => {
    const deviceField = SysPresence.fields.device;
    expect(deviceField.type).toBe('select');
    expect(deviceField.options).toEqual([
      { value: 'desktop', label: 'Desktop' },
      { value: 'mobile', label: 'Mobile' },
      { value: 'tablet', label: 'Tablet' },
      { value: 'other', label: 'Other' },
    ]);
  });

  it('should have indexes on user_id, session_id, and status', () => {
    expect(SysPresence.indexes).toEqual([
      { fields: ['user_id'], unique: false, type: 'btree' },
      { fields: ['session_id'], unique: true, type: 'btree' },
      { fields: ['status'], unique: false, type: 'btree' },
    ]);
  });

  it('should have API enabled', () => {
    expect(SysPresence.enable?.apiEnabled).toBe(true);
  });
});
