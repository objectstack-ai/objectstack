// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { StorageNameMapping } from '@objectstack/spec/system';
import { SysAuditLog, SysActivity, SysComment } from './index.js';

/**
 * Canonical-identity coverage for the audit/collaboration objects this plugin
 * owns after the ADR-0029 K2 move out of @objectstack/platform-objects. Locks
 * in the short names, system flag, and the storage-name resolution so a future
 * rename can't silently change the physical table.
 */
const ownedObjects = [
  ['SysAuditLog', SysAuditLog, 'sys_audit_log'],
  ['SysActivity', SysActivity, 'sys_activity'],
  ['SysComment', SysComment, 'sys_comment'],
] as const;

describe('@objectstack/plugin-audit objects', () => {
  it.each(ownedObjects)('%s uses a canonical sys_ short name', (_name, object, name) => {
    expect(object.name).toBe(name);
  });

  it.each(ownedObjects)('%s resolves to the same physical table name', (_name, object, name) => {
    expect(StorageNameMapping.resolveTableName(object)).toBe(name);
  });

  it.each(ownedObjects)('%s is marked as a system object', (_name, object) => {
    expect(object.isSystem).toBe(true);
  });

  it.each(ownedObjects)('%s does not carry deprecated storage identity fields', (_name, object) => {
    expect((object as any).namespace).toBeUndefined();
    expect((object as any).tableName).toBeUndefined();
  });
});
