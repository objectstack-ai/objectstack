import { describe, it, expect } from 'vitest';
import { SysApiKey, SysSession } from '@objectstack/platform-objects/identity';
import { FORCED_RESET_REVOKE_REASON } from './forced-reset-revocation';
import { managedExtensionEditableFields, managedExtensionFields } from './managed-extension-fields';

// `sys_session.revoke_reason` is free text; its description is the only
// published vocabulary, so a value this producer writes must be named there.
describe('sys_session.revoke_reason vocabulary', () => {
  it('names the value a forced reset writes', () => {
    expect(FORCED_RESET_REVOKE_REASON).toBe('admin_password_reset');
    const description = String((SysSession.fields as any).revoke_reason.description);
    expect(description).toContain(FORCED_RESET_REVOKE_REASON);
  });
});

// `sys_api_key.revoked_reason` is a closed select: the forced reset is its one
// writer, so the value it writes is the whole option set. It is readonly and
// declared ours but never generically editable: an owner who could clear it
// could restore the key the reset closed.
describe('sys_api_key.revoked_reason vocabulary', () => {
  it('is a readonly select whose only option is the value the forced reset writes', () => {
    const field = (SysApiKey.fields as any).revoked_reason;
    expect(field.type).toBe('select');
    expect(field.readonly).toBe(true);
    expect((field.options as Array<{ value: string }>).map((o) => o.value)).toEqual([FORCED_RESET_REVOKE_REASON]);
  });

  it('is declared an extension field of sys_api_key and is NOT on the D2 editable whitelist', () => {
    expect(managedExtensionFields('sys_api_key')).toContain('revoked_reason');
    expect([...managedExtensionEditableFields('sys_api_key')]).toEqual(['revoked']);
  });
});
