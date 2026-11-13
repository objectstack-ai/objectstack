import { describe, it, expect } from 'vitest';
import { SysApiKey, SysSession } from '@objectstack/platform-objects/identity';
import { FORCED_RESET_REVOKE_REASON } from './forced-reset-revocation';
import { MEMBERSHIP_ENDED_REVOKE_REASON } from './membership-ended-session';
import { ADMINISTRATOR_SUSPENDED_REVOKE_REASON } from './api-key-restore-guard';
import { SCIM_DEACTIVATION_REVOKE_REASON } from './scim-deactivation-key-revocation';
import { INTERACTIVE_REVOKE_REASON } from './session-tombstone';
import { managedExtensionEditableFields, managedExtensionFields } from './managed-extension-fields';

// `sys_session.revoke_reason` is free text; its description is the only
// published vocabulary, so a value this producer writes must be named there.
describe('sys_session.revoke_reason vocabulary', () => {
  it('names the value a forced reset writes', () => {
    expect(FORCED_RESET_REVOKE_REASON).toBe('admin_password_reset');
    const description = String((SysSession.fields as any).revoke_reason.description);
    expect(description).toContain(FORCED_RESET_REVOKE_REASON);
  });

  it('names every value the interactive-revoke ledger writes, the password-reset doors\' included', () => {
    const description = String((SysSession.fields as any).revoke_reason.description);
    const written = [...new Set(Object.values(INTERACTIVE_REVOKE_REASON))].sort();
    expect(written).toEqual(['admin', 'password_reset', 'user_revoked']);
    for (const value of written) {
      expect({ value, named: new RegExp(`\\b${value}\\b`).test(description) }).toEqual({ value, named: true });
    }
  });
});

// `sys_api_key.revoked_reason` is a closed select of the reasons that decide
// who may restore a key: the value the forced reset writes, the value a host
// writes when it revokes a departed member's keys, the value the restore
// guard stamps when a platform administrator revokes a key that is not theirs,
// and the value a directory deactivation stamps on every key the user owns.
// The first two are the word `sys_session.revoke_reason` carries for the same
// event; a session is never restored, so it has no counterpart of the last two.
// It is readonly and declared ours but never generically editable: an owner
// who could clear it could restore the key the reset, the removal, the
// administrator or the directory closed.
describe('sys_api_key.revoked_reason vocabulary', () => {
  it('is a readonly select whose options are exactly the forced-reset, membership-ended, administrator-suspended and directory-deactivated values', () => {
    const field = (SysApiKey.fields as any).revoked_reason;
    expect(field.type).toBe('select');
    expect(field.readonly).toBe(true);
    expect((field.options as Array<{ value: string }>).map((o) => o.value)).toEqual([
      FORCED_RESET_REVOKE_REASON,
      MEMBERSHIP_ENDED_REVOKE_REASON,
      ADMINISTRATOR_SUSPENDED_REVOKE_REASON,
      SCIM_DEACTIVATION_REVOKE_REASON,
    ]);
  });

  it('names the directory-deactivated value, and that no one restores it, in the field description', () => {
    expect(SCIM_DEACTIVATION_REVOKE_REASON).toBe('scim_deactivated');
    const description = String((SysApiKey.fields as any).revoked_reason.description);
    expect(description).toMatch(/Deactivated by the directory: the organization's directory \(SCIM\) deactivated or deleted the owner, and no one can restore the key/);
  });

  it('names the administrator-suspended value, and who restores it, in the field description', () => {
    expect(ADMINISTRATOR_SUSPENDED_REVOKE_REASON).toBe('administrator_suspended');
    const description = String((SysApiKey.fields as any).revoked_reason.description);
    expect(description).toMatch(/Suspended by an administrator: a platform administrator revoked a key that is not theirs, and only a platform administrator can restore it/);
  });

  it('reuses the session word for a membership ending, which sys_session.revoke_reason already names', () => {
    expect(MEMBERSHIP_ENDED_REVOKE_REASON).toBe('organization_membership_ended');
    const description = String((SysSession.fields as any).revoke_reason.description);
    expect(description).toContain(MEMBERSHIP_ENDED_REVOKE_REASON);
  });

  it('is declared an extension field of sys_api_key and is NOT on the D2 editable whitelist', () => {
    expect(managedExtensionFields('sys_api_key')).toContain('revoked_reason');
    expect([...managedExtensionEditableFields('sys_api_key')]).toEqual(['revoked']);
  });
});
