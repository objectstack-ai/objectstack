// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7, ruling of record 6257510973, Q2 A] `sys_identity_email` is
 * `sys_email`'s deployment-level sibling: the same row shape, so one mail
 * pipeline serves both, and no organization column.
 */

import { describe, it, expect } from 'vitest';
import { SysEmail } from './sys-email.object.js';
import { SysIdentityEmail } from './sys-identity-email.object.js';

describe('sys_identity_email — the identity-mail sibling of sys_email', () => {
  it('declares exactly sys_email\'s fields — the row shape the pipeline reads and writes', () => {
    expect(Object.keys(SysIdentityEmail.fields)).toEqual(Object.keys(SysEmail.fields));
    expect(SysIdentityEmail.fields).toEqual(SysEmail.fields);
  });

  it('keys the same indexes, so the by-status and by-id reads cost the same', () => {
    expect(SysIdentityEmail.indexes).toEqual(SysEmail.indexes);
  });

  it('opts out of the injected organization column; sys_email keeps it', () => {
    expect(SysIdentityEmail.systemFields).toEqual({ tenant: false });
    // Non-vacuity: the tenant log does not opt out (neither `false` nor `{ tenant: false }`).
    const tenantLog = SysEmail.systemFields;
    expect(tenantLog === false || (typeof tenantLog === 'object' && tenantLog.tenant === false)).toBe(false);
    expect(Object.keys(SysIdentityEmail.fields)).not.toContain('organization_id');
  });

  it('is append-only, readable by get/list, and behind the platform-only capability', () => {
    expect(SysIdentityEmail.managedBy).toBe('append-only');
    expect(SysIdentityEmail.enable?.apiMethods).toEqual(['get', 'list']);
    expect(SysIdentityEmail.requiredPermissions).toEqual(['manage_platform_settings']);
  });
});
