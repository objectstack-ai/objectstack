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

// objectstack#30565 — the server answers an accepted turn-on with its own save
// notice (objectstack `plugin-auth`'s `ORGANIZATION_MFA_REQUIRED_NOTICE_COPY`),
// which names the grace period in force. The console's line would repeat it,
// with the default 7 days where Setup set another number.
describe('organizationMfaSavedNotice — the server already said it (objectstack#30565)', () => {
  const saved = { id: 'org_1', name: 'Acme', require_mfa: true };
  const turnOn = (answerNotice: string | undefined) =>
    organizationMfaSavedNotice({ objectName: 'sys_organization', storedRequireMfa: false, saved, answerNotice, t });

  // The server's notice as it answers it, in each language its copy is written in,
  // for a grace period of N days and of 0 days (two different sentences).
  const SERVER_NOTICES = {
    'en, 3 days':
      'Multi-factor authentication is now required for this organization. Every member who has not set up an ' +
      'authenticator app has 3 days to enroll one, counted from the first time they use the app while it is ' +
      'required; after that they are blocked from data until they do. Members who already use an authenticator ' +
      'app are not affected. The MFA grace period is set in Setup → Authentication.',
    'en, 0 days':
      'Multi-factor authentication is now required for this organization. Every member who has not set up an ' +
      'authenticator app is blocked from data the next time they use the app, until they enroll one: the MFA ' +
      'grace period is 0 days. Members who already use an authenticator app are not affected. The MFA grace ' +
      'period is set in Setup → Authentication.',
    'zh-CN, 3 days':
      '本组织现已强制多因素认证。尚未绑定身份验证器应用的成员有 3 天时间完成绑定，从要求生效后他们第一次使用应用时起算；' +
      '期满后，未绑定的成员将无法访问数据，直到完成绑定。已使用身份验证器应用的成员不受影响。MFA 宽限期可在“设置 → 认证”中修改。',
    'ja-JP, 0 days':
      'この組織では多要素認証が必須になりました。認証アプリをまだ登録していないメンバーは、次にアプリを利用した時点から' +
      '登録するまでデータにアクセスできなくなります（MFA 猶予期間は 0 日です）。すでに認証アプリを使っているメンバーには' +
      '影響しません。MFA 猶予期間は「設定 → 認証」で変更できます。',
    'es-ES, 3 days':
      'La autenticación multifactor ahora es obligatoria en esta organización. Cada miembro que no haya configurado ' +
      'una app de autenticación tiene 3 días para registrarla, a contar desde la primera vez que usa la app mientras ' +
      'sea obligatoria; después se le bloquea el acceso a los datos hasta que lo haga. Los miembros que ya usan un ' +
      'autenticador no se ven afectados. El periodo de gracia de MFA se configura en Configuración → Autenticación.',
  };

  it.each(Object.entries(SERVER_NOTICES))('the answer carries the server notice (%s): no console line', (_case, notice) => {
    expect(turnOn(notice)).toBeUndefined();
  });

  it('no notice on the answer (a server that does not send one): the console line, as before', () => {
    expect(turnOn(undefined)).toBe('console.organizationMfa.nowRequired');
  });

  it("another hook's notice on the same save: the console line still says who must enroll", () => {
    // The answer carries ONE notice, the last a hook or flow on the write set,
    // so a later one replaces the server's MFA notice.
    expect(turnOn('Sent to your manager for approval')).toBe('console.organizationMfa.nowRequired');
  });
});

describe('useStoredRequireMfa — the stored value while the form is open', () => {
  it('an edit reads the row once; a create is off; a closed form or another object reads nothing', async () => {
    const findOne = vi.fn(async () => ({ id: 'org_1', require_mfa: true }));
    type Props = { objectName: string; recordId: string | undefined; open: boolean };
    const initialProps: Props = { objectName: 'sys_organization', recordId: 'org_1', open: true };
    const { result, rerender } = renderHook(
      (p: Props) => useStoredRequireMfa(p.objectName, p.recordId, p.open, { findOne }),
      { initialProps },
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
