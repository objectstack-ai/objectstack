import { describe, it, expect } from 'vitest';
import { SysSession } from '@objectstack/platform-objects/identity';
import { FORCED_RESET_REVOKE_REASON } from './forced-reset-revocation';

// `sys_session.revoke_reason` is free text; its description is the only
// published vocabulary, so a value this producer writes must be named there.
describe('sys_session.revoke_reason vocabulary', () => {
  it('names the value a forced reset writes', () => {
    expect(FORCED_RESET_REVOKE_REASON).toBe('admin_password_reset');
    const description = String((SysSession.fields as any).revoke_reason.description);
    expect(description).toContain(FORCED_RESET_REVOKE_REASON);
  });
});
