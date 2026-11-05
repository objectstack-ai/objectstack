/**
 * What the organization record form says around `require_mfa`
 * (objectstack#30295): the notice before saving while two-factor is off, and
 * the line an accepted save that turned it on adds to its toast.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  organizationMfaFormNotice,
  organizationMfaSavedNotice,
  useStoredRequireMfa,
} from '../organizationMfaNotices';

const t = ((key: string) => key) as Parameters<typeof organizationMfaFormNotice>[0]['t'];
const FIELDS = ['name', 'require_mfa', 'timezone'];

describe('organizationMfaFormNotice — before saving', () => {
  it('two-factor off: the organization form says requiring MFA needs it', () => {
    expect(
      organizationMfaFormNotice({ objectName: 'sys_organization', fields: FIELDS, features: { twoFactor: false }, t }),
    ).toBe('console.organizationMfa.needsTwoFactor');
  });

  it('two-factor on, or not read yet: nothing', () => {
    for (const features of [{ twoFactor: true }, {}]) {
      expect(organizationMfaFormNotice({ objectName: 'sys_organization', fields: FIELDS, features, t })).toBeUndefined();
    }
  });

  it('another object, or a form without the field: nothing', () => {
    expect(
      organizationMfaFormNotice({ objectName: 'sys_team', fields: FIELDS, features: { twoFactor: false }, t }),
    ).toBeUndefined();
    expect(
      organizationMfaFormNotice({ objectName: 'sys_organization', fields: ['name'], features: { twoFactor: false }, t }),
    ).toBeUndefined();
  });
});

describe('organizationMfaSavedNotice — after an accepted save', () => {
  const saved = { id: 'org_1', name: 'Acme', require_mfa: true };

  it('a save that turned it on says who must enroll and when the block starts', () => {
    expect(organizationMfaSavedNotice({ objectName: 'sys_organization', storedRequireMfa: false, saved, t })).toBe(
      'console.organizationMfa.nowRequired',
    );
    // An unread stored value counts as off.
    expect(organizationMfaSavedNotice({ objectName: 'sys_organization', storedRequireMfa: undefined, saved, t })).toBe(
      'console.organizationMfa.nowRequired',
    );
  });

  it('a row that already required it, a save that leaves it off, another object: nothing', () => {
    expect(organizationMfaSavedNotice({ objectName: 'sys_organization', storedRequireMfa: true, saved, t })).toBeUndefined();
    expect(
      organizationMfaSavedNotice({ objectName: 'sys_organization', storedRequireMfa: false, saved: { ...saved, require_mfa: false }, t }),
    ).toBeUndefined();
    expect(organizationMfaSavedNotice({ objectName: 'sys_team', storedRequireMfa: false, saved, t })).toBeUndefined();
  });
});

describe('useStoredRequireMfa — the stored value while the form is open', () => {
  it('an edit reads the row once; a create is off; a closed form or another object reads nothing', async () => {
    const findOne = vi.fn(async () => ({ id: 'org_1', require_mfa: true }));
    const { result, rerender } = renderHook(
      (p: { objectName: string; recordId?: string; open: boolean }) =>
        useStoredRequireMfa(p.objectName, p.recordId, p.open, { findOne }),
      { initialProps: { objectName: 'sys_organization', recordId: 'org_1', open: true } },
    );
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ objectName: 'sys_organization', recordId: 'org_1', open: true });
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith('sys_organization', 'org_1');

    rerender({ objectName: 'sys_organization', recordId: undefined, open: true });
    expect(result.current).toBe(false);
    rerender({ objectName: 'sys_organization', recordId: 'org_1', open: false });
    expect(result.current).toBeUndefined();
    rerender({ objectName: 'sys_team', recordId: 'team_1', open: true });
    expect(result.current).toBeUndefined();
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('a failed read leaves it unread', async () => {
    const findOne = vi.fn(async () => { throw new Error('403'); });
    const { result } = renderHook(() => useStoredRequireMfa('sys_organization', 'org_1', true, { findOne }));
    await waitFor(() => expect(findOne).toHaveBeenCalledTimes(1));
    expect(result.current).toBeUndefined();
  });
});
