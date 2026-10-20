// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24625] Both mail logs gate their BODY columns on the platform-only
 * capability, at the field: the 18.0 identity rows still in `sys_email` carry
 * reset and sign-in links and no column tells them apart from tenant mail, so
 * the gate is on the columns of every row, while the row itself stays readable
 * by an organization administrator.
 */

import { describe, it, expect } from 'vitest';
import { SysEmail } from './sys-email.object.js';
import { SysIdentityEmail } from './sys-identity-email.object.js';
import { MAIL_LOG_BODY_FIELDS, MAIL_LOG_OBJECTS, isMailLogObject } from './mail-log-body.js';

type FieldDecl = { requiredPermissions?: string[] };

describe('the mail logs\' body columns', () => {
  it('names exactly the two mail logs', () => {
    expect([...MAIL_LOG_OBJECTS].sort()).toEqual(['sys_email', 'sys_identity_email']);
    expect(isMailLogObject('sys_email')).toBe(true);
    expect(isMailLogObject('sys_identity_email')).toBe(true);
    expect(isMailLogObject('sys_email_template')).toBe(false);
  });

  it.each([SysEmail, SysIdentityEmail])('$name gates each body column, and only those, on manage_platform_settings', (def) => {
    const fields = def.fields as Record<string, FieldDecl>;
    const gated = Object.entries(fields)
      .filter(([, f]) => (f.requiredPermissions ?? []).length > 0)
      .map(([name]) => name)
      .sort();
    expect(gated).toEqual([...MAIL_LOG_BODY_FIELDS].sort());
    for (const name of MAIL_LOG_BODY_FIELDS) expect(fields[name].requiredPermissions).toEqual(['manage_platform_settings']);
  });

  it('leaves sys_email itself without an object-level read gate: the organization administrator keeps the row', () => {
    expect(SysEmail.requiredPermissions).toBeUndefined();
  });
});
