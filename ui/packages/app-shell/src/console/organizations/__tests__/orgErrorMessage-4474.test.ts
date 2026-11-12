// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4474 family 2 — the code -> message mapping, unit level.
 *
 * ## Why a `code` and never the text
 *
 * The three server-echoed sites the card measured render better-auth's English
 * `message` verbatim. Translating that by matching the English string would bind
 * the console to a third party's copy-editing: better-auth is free to reword
 * "Organization already exists" in any release, and a string match would go
 * silently English again with nothing red. The `code` is the stable half of the
 * pair — `ORGANIZATION_ALREADY_EXISTS` is the identifier, the sentence is its
 * rendering — so the mapping is keyed by the code and the text is never read.
 *
 * ## Prefer mapped, degrade to verbatim
 *
 * The shape is the repo's existing one, not a new invention: `LoginForm` and
 * `RegisterForm` already resolve `(code && map[code]) || error.message`. An
 * unmapped code must still show the server's own sentence — English beats a
 * blank box or a generic "something went wrong", both of which destroy the only
 * information the user has. Both directions are pinned below, because only one
 * of them is the interesting failure: a mapping that swallows unknown codes
 * passes every "known code" test there is.
 *
 * ## Codes covered, and why exactly these
 *
 * Each entry is a rejection the five console files can actually provoke — not a
 * mirror of better-auth's 60-code table. Speculative rows would be ten pack
 * translations apiece for a screen that cannot reach them, and an uncovered code
 * already degrades correctly, so the cost of NOT listing one is bounded.
 */

import { describe, it, expect } from 'vitest';
import {
  ORG_ERROR_MESSAGE_KEYS,
  orgDeleteRefusalRows,
  readOrgDeleteRefusal,
  resolveOrgErrorMessage,
} from '../orgErrorMessage';
import { builtInLocales } from '@object-ui/i18n/locales';

const zh = builtInLocales['zh-Hans'];

/**
 * A translator with the real zh pack behind it — the mapping helper's contract
 * is "return what `t` gives for the key I chose", and a stub that echoes keys
 * could not tell a right key from a wrong one.
 */
const at = (path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], zh);

const tZh = (key: string, options?: Record<string, unknown>): string => {
  const hit = at(key);
  return typeof hit === 'string' ? hit : String(options?.defaultValue ?? key);
};

/** `t` that resolves nothing — stands in for a pack that lacks the key. */
const tEn = (key: string, options?: Record<string, unknown>): string =>
  String(options?.defaultValue ?? key);

const withCode = (code: string, message: string): Error => {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
};

describe('#4474 — resolveOrgErrorMessage', () => {
  it('maps a KNOWN code to the zh message, ignoring the English text entirely', () => {
    expect(
      resolveOrgErrorMessage(
        withCode(
          'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
          'You are not allowed to invite users to this organization',
        ),
        tZh,
      ),
    ).toBe('您无权邀请用户加入该组织。');
    expect(
      resolveOrgErrorMessage(
        withCode('ORGANIZATION_ALREADY_EXISTS', 'Organization already exists'),
        tZh,
      ),
    ).toBe('该组织已存在。');
    expect(
      resolveOrgErrorMessage(
        withCode(
          'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
          'You are not the recipient of the invitation',
        ),
        tZh,
      ),
    ).toBe('您不是该邀请的收件人。');
  });

  it('reads the code, not the sentence — a reworded message maps identically', () => {
    // The whole reason the mapping is code-keyed. If better-auth rewrites this
    // sentence tomorrow, the console still says the right thing in zh.
    expect(
      resolveOrgErrorMessage(
        withCode('ORGANIZATION_ALREADY_EXISTS', 'That workspace name is taken already'),
        tZh,
      ),
    ).toBe('该组织已存在。');
  });

  it('an English sentence with NO code is passed through, never guessed at', () => {
    // The inverse of the rule above: matching the text would "translate" this
    // one, which is exactly the behaviour the ruling forbids.
    expect(resolveOrgErrorMessage(new Error('Organization already exists'), tZh)).toBe(
      'Organization already exists',
    );
  });

  it('an UNKNOWN code degrades to the server message verbatim', () => {
    expect(
      resolveOrgErrorMessage(
        withCode('TEAM_MEMBER_LIMIT_REACHED', 'Team member limit reached'),
        tZh,
      ),
    ).toBe('Team member limit reached');
  });

  it('a known code whose pack entry is missing still yields the English default', () => {
    // `tEn` resolves nothing, so this exercises the defaultValue leg — the pack
    // being incomplete must not produce a bare i18n key on screen.
    expect(
      resolveOrgErrorMessage(
        withCode('ORGANIZATION_ALREADY_EXISTS', 'Organization already exists'),
        tEn,
      ),
    ).toBe('Organization already exists');
  });

  it('a non-Error rejection falls back to a translated generic, not "[object Object]"', () => {
    expect(resolveOrgErrorMessage({ nope: true }, tZh)).toBe(
      at('organization.errors.unknown'),
    );
    expect(resolveOrgErrorMessage(undefined, tZh)).toBe(at('organization.errors.unknown'));
  });

  it('an Error with an empty message falls back rather than rendering a blank box', () => {
    expect(resolveOrgErrorMessage(new Error(''), tZh)).toBe(at('organization.errors.unknown'));
    expect(resolveOrgErrorMessage(new Error('   '), tZh)).toBe(at('organization.errors.unknown'));
  });
});

describe('#12977 — ORGANIZATION_CREATION_DISABLED (objectstack registered code)', () => {
  // The server refuses a create with this code when the deployment's tenancy
  // posture enforces no organization wall — the same posture the create dialog's
  // own guard reads as `multiOrgEnabled === false`. It is a deployment setting,
  // not a missing grant, so it maps to the guard's sentence.
  it('maps to the localized workspace.multiOrgDisabled sentence in zh, ignoring the English text', () => {
    expect(
      resolveOrgErrorMessage(
        withCode(
          'ORGANIZATION_CREATION_DISABLED',
          'Creating additional organizations is disabled on this deployment.',
        ),
        tZh,
      ),
    ).toBe('此实例已禁用创建新组织。');
  });

  it('CONTROL: an unmapped code still degrades to the server sentence', () => {
    expect(
      resolveOrgErrorMessage(
        withCode(
          'ORGANIZATION_SLUG_LOCKED_BY_ACTIVE_ENVIRONMENTS',
          'The slug is locked while the organization has an active environment.',
        ),
        tZh,
      ),
    ).toBe('The slug is locked while the organization has an active environment.');
  });
});

describe('#28124 — YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS (the per-user creation cap)', () => {
  // better-auth refuses a create past `organizationLimit` (`OS_ORG_LIMIT`) with
  // 403 and this code, and the body is its bare `{ code, message }`: no limit
  // in it, and none in `/auth/config` either. So the console explains the cap
  // without a number, and no pack may carry one.
  const CODE = 'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS';
  const SERVER_SENTENCE = 'You have reached the maximum number of organizations';
  const KEY = 'organization.errors.organizationLimitReached';
  const packValue = (lang: string): unknown =>
    KEY.split('.').reduce<unknown>(
      (n, k) => (n as Record<string, unknown> | undefined)?.[k],
      builtInLocales[lang as keyof typeof builtInLocales],
    );
  const tPack = (lang: string) => (key: string, options?: Record<string, unknown>): string => {
    const hit = key
      .split('.')
      .reduce<unknown>(
        (n, k) => (n as Record<string, unknown> | undefined)?.[k],
        builtInLocales[lang as keyof typeof builtInLocales],
      );
    return typeof hit === 'string' ? hit : String(options?.defaultValue ?? key);
  };

  it('zh: the refusal renders the zh pack sentence, not better-auth\'s English', () => {
    const shown = resolveOrgErrorMessage(withCode(CODE, SERVER_SENTENCE), tPack('zh-Hans'));
    expect(shown).toBe(packValue('zh-Hans'));
    expect(shown).not.toBe(SERVER_SENTENCE);
    expect(shown).toMatch(/\p{Script=Han}/u);
  });

  it('en: the refusal renders the en pack sentence, which says invited organizations do not count', () => {
    const shown = resolveOrgErrorMessage(withCode(CODE, SERVER_SENTENCE), tPack('en'));
    expect(shown).toBe(packValue('en'));
    expect(shown).not.toBe(SERVER_SENTENCE);
  });

  it('every pack defines the key, with its own sentence and no number in it', () => {
    const en = packValue('en');
    for (const lang of Object.keys(builtInLocales)) {
      const value = packValue(lang);
      expect(typeof value, `${lang} lacks ${KEY}`).toBe('string');
      expect(value as string, `${lang} names a number the server never sent`).not.toMatch(/\p{Nd}/u);
      if (lang !== 'en') expect(value, `${lang} still serves the English sentence`).not.toBe(en);
    }
  });
});

describe('#4474 — the mapping table itself', () => {
  it('every mapped code resolves to a key the zh pack actually defines', () => {
    // Guards the class of typo that only shows up as a raw i18n key on screen,
    // in a locale the author does not read.
    for (const [code, entry] of Object.entries(ORG_ERROR_MESSAGE_KEYS)) {
      expect(typeof at(entry.key), `${code} -> ${entry.key} missing from zh`).toBe('string');
      expect((at(entry.key) as string).length, `${entry.key} is empty`).toBeGreaterThan(0);
    }
  });

  it('every mapped code is a real organization code (better-auth or objectstack-registered), spelled exactly', () => {
    // A code with a typo is unreachable: it maps nothing and degrades forever,
    // which reads as "the translation is missing" rather than "the key is wrong".
    // Every member is better-auth's own code except `ORGANIZATION_CREATION_DISABLED`,
    // which is objectstack's registered code (ADR-0112) for the same refusal.
    expect(Object.keys(ORG_ERROR_MESSAGE_KEYS).sort()).toEqual(
      [
        'INVITATION_NOT_FOUND',
        'ORGANIZATION_ALREADY_EXISTS',
        'ORGANIZATION_CREATION_DISABLED',
        'ORGANIZATION_SLUG_ALREADY_TAKEN',
        'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION',
        'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION',
        'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS',
        'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
        'YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE',
        'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
      ].sort(),
    );
  });

  it('the three codes the card measured are all present', () => {
    // Named separately from the set above so a future trim of the table cannot
    // quietly drop one of the sites the issue was filed for.
    expect(ORG_ERROR_MESSAGE_KEYS).toHaveProperty(
      'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
    );
    expect(ORG_ERROR_MESSAGE_KEYS).toHaveProperty('ORGANIZATION_ALREADY_EXISTS');
    expect(ORG_ERROR_MESSAGE_KEYS).toHaveProperty('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION');
  });

  it('every English defaultValue is non-empty — the fallback leg is real', () => {
    for (const [code, entry] of Object.entries(ORG_ERROR_MESSAGE_KEYS)) {
      expect(entry.defaultValue.trim().length, `${code} has an empty defaultValue`).toBeGreaterThan(0);
    }
  });
});

describe('objectstack#32648 — the refused organization delete, read by code and listed by label', () => {
  /** The thrown value `@object-ui/auth` hands over for plugin-auth's 409. */
  const refused = (extra: Record<string, unknown> = {}): Error => {
    const err = new Error(
      'This organization still owns records in sys_environment (2), sys_billing_invoice_line (1). ' +
        'Delete or move those records first, then delete the organization.',
    ) as Error & Record<string, unknown>;
    err.code = 'DELETE_RESTRICTED';
    err.dependents = [
      { object: 'sys_environment', count: 2 },
      { object: 'sys_billing_invoice_line', count: 1 },
    ];
    Object.assign(err, extra);
    return err;
  };

  it('reads the dependents of a DELETE_RESTRICTED rejection, and never the message', () => {
    const refusal = readOrgDeleteRefusal(refused());
    expect(refusal).toEqual({
      dependents: [
        { object: 'sys_environment', count: 2 },
        { object: 'sys_billing_invoice_line', count: 1 },
      ],
    });
    expect(JSON.stringify(refusal)).not.toContain('Delete or move');
  });

  it('is the refusal even with no usable list, and keeps a producer-marked userMessage', () => {
    expect(readOrgDeleteRefusal(refused({ dependents: undefined }))).toEqual({ dependents: [] });
    expect(readOrgDeleteRefusal(refused({ dependents: [{ count: 2 }, 'sys_x'] }))).toEqual({ dependents: [] });
    expect(readOrgDeleteRefusal(refused({ userMessage: '该组织仍有数据。' }))?.userMessage).toBe('该组织仍有数据。');
    expect(readOrgDeleteRefusal(refused({ userMessage: ' ' }))).not.toHaveProperty('userMessage');
  });

  it('answers undefined for every other rejection, whatever its text says', () => {
    expect(readOrgDeleteRefusal(withCode('ORGANIZATION_ALREADY_EXISTS', 'still owns records'))).toBeUndefined();
    expect(readOrgDeleteRefusal(new Error('This organization still owns records in sys_domain (2).'))).toBeUndefined();
    expect(readOrgDeleteRefusal('DELETE_RESTRICTED')).toBeUndefined();
    expect(readOrgDeleteRefusal(null)).toBeUndefined();
  });

  it('lists each dependent under its label, and gathers the unlabelled ones on one last line', () => {
    const labels: Record<string, string> = { sys_environment: '环境', crm_account: '客户' };
    const rows = orgDeleteRefusalRows(
      [
        { object: 'sys_environment', count: 2 },
        { object: 'sys_billing_invoice_line', count: 1 },
        { object: 'crm_account', count: 3 },
        { object: 'sys_domain', count: 2 },
      ],
      (object) => labels[object] ?? '',
      '其他记录',
    );
    expect(rows).toEqual([
      { object: 'sys_environment', label: '环境', count: 2 },
      { object: 'crm_account', label: '客户', count: 3 },
      { object: null, label: '其他记录', count: 3 },
    ]);
    // An API name is never shown in a label's place.
    expect(rows.map((r) => r.label).join(' ')).not.toMatch(/sys_|_line|_domain/);
  });

  it('adds no "other" line when every object resolves, and withholds its count when a member’s is withheld', () => {
    expect(orgDeleteRefusalRows([{ object: 'a', count: 1 }], () => 'A', 'Other records')).toEqual([
      { object: 'a', label: 'A', count: 1 },
    ]);
    expect(
      orgDeleteRefusalRows([{ object: 'a', count: 1 }, { object: 'b' }, { object: 'c' }], () => '', 'Other records'),
    ).toEqual([{ object: null, label: 'Other records' }]);
    expect(orgDeleteRefusalRows([{ object: 'a' }], () => 'A', 'Other records')).toEqual([{ object: 'a', label: 'A' }]);
  });
});
