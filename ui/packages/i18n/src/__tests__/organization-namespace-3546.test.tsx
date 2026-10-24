/**
 * The `organization` namespace — objectui#3546 slice two — resolves **from the
 * locale packs, with a provider mounted**.
 *
 * ## What was broken, precisely
 *
 * `scripts/check-i18n-call-site-keys.mjs` measured 90 keys under
 * `organization.*` that a `t()` call site asks for and that NO pack defined.
 * All 90 carried an inline `t(key, { defaultValue: 'English' })`, so this is
 * the milder #3517 class the issue describes: English rendered correctly at
 * every call site and **all ten languages were stuck on it**. Nothing showed a
 * raw key here — slice one (PR #3583) held the sites that did.
 *
 * That also fixes what an assertion has to look like to be worth anything.
 * `en` output was already correct before this change, so **an `en` assertion
 * cannot discriminate before from after**. Every assertion below that pins the
 * fix is a `zh` one; the `en` cases are kept only to prove the key is reachable
 * through the real binding and not shadowed.
 *
 * ## Why a provider is mounted
 *
 * The seven components behind these keys — `OrganizationLayout`, `MembersPage`,
 * `InvitationsPage`, `InviteMemberDialog`, `SettingsPage`,
 * `AcceptInvitationPage` and `WorkspaceSwitcher` — all bind `t` from a bare
 * `useObjectTranslation()`, with no `createSafeTranslation` defaults map in
 * front of it (measured: none of the 93 organization call sites sits behind a
 * defaults map, and none carries a dead `||` fallback the way ObjectView did).
 * So `I18nProvider` here is not ceremony: without it i18next is not the thing
 * answering, and the test would be describing a binding the console never uses.
 *
 * ## Coverage shape
 *
 * All 90 keys are asserted structurally (present, non-empty, translated) —
 * that part is cheap and total. The provider-mounted rendering assertions are
 * a representative sample: one key per sub-namespace plus every key that
 * interpolates, which is where a bad translation actually breaks rather than
 * merely reads oddly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { builtInLocales } from '../locales/index';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799).
 *
 * It was `process.cwd()` until then, on the reasoning that
 * `scripts/vitest-invocation-guard.mjs` refuses any invocation whose vitest root
 * is not the repo root. That guard is real, but it is a DIFFERENT invariant:
 * `--root` moves VITEST's root and moves nothing about `process.cwd()`. This
 * package's own `test` script — `vitest run --root ../.. packages/i18n/`, which
 * is what `pnpm --filter … test` and `turbo run test` both run — leaves cwd at
 * `packages/i18n/`, so every read below resolved against the package directory
 * and the assertions guarding them failed.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796): `new URL(rel, import.meta.url)` is REWRITTEN by Vite into a
 * `http://localhost:3000/@fs/…` dev-server URL, so only bare `import.meta.url`
 * is read here and taken apart by hand. Measured on this card under both cwds
 * and in both the `unit` and the `dom` project, it is
 * `file:///…/packages/i18n/src/__tests__/<this file>`.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / i18n / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');


/** The 90 keys this slice backfilled, grouped as the packs group them. */
const KEYS = [
  'organization.backToList',
  'organization.notFound',
  'organization.notFoundDescription',
  'organization.tabs.members',
  'organization.tabs.invitations',
  'organization.tabs.settings',
  'organization.members.title',
  'organization.members.inviteMember',
  'organization.members.removeMember',
  'organization.members.removeConfirmTitle',
  'organization.members.removeConfirmDescription',
  'organization.members.removeConfirmAction',
  'organization.members.memberRemoved',
  'organization.members.removeFailed',
  'organization.members.roleUpdated',
  'organization.members.roleUpdateFailed',
  'organization.invitations.title',
  'organization.invitations.empty',
  'organization.invitations.expiresAt',
  'organization.invitations.linkCopied',
  'organization.invitations.copyFailed',
  'organization.invitations.canceled',
  'organization.invitations.cancelFailed',
  'organization.invitations.cancelTitle',
  'organization.invitations.cancelDescription',
  'organization.invitations.cancelAction',
  'organization.invitations.inviteTitle',
  'organization.invitations.inviteDescription',
  'organization.invitations.emailLabel',
  'organization.invitations.roleLabel',
  'organization.invitations.placementLabel',
  'organization.invitations.placementDescription',
  'organization.invitations.businessUnitLabel',
  'organization.invitations.businessUnitPlaceholder',
  'organization.invitations.positionsLabel',
  'organization.invitations.sendInvite',
  'organization.invitations.sentTitle',
  'organization.invitations.sentDescription',
  'organization.invitations.linkLabel',
  'organization.invitations.invitedAs',
  'organization.settings.generalTitle',
  'organization.settings.generalDescription',
  'organization.settings.readOnlyNote',
  'organization.settings.nameLabel',
  'organization.settings.slugLabel',
  'organization.settings.logoLabel',
  'organization.settings.logoUpload',
  'organization.settings.logoReplace',
  'organization.settings.logoClear',
  'organization.settings.logoUploaded',
  'organization.settings.logoUploadFailed',
  'organization.settings.save',
  'organization.settings.saved',
  'organization.settings.saveFailed',
  'organization.settings.leaveTitle',
  'organization.settings.leaveDescription',
  'organization.settings.leaveAction',
  'organization.settings.leaveConfirmTitle',
  'organization.settings.leaveConfirmDescription',
  'organization.settings.leaveConfirmAction',
  'organization.settings.leftOrg',
  'organization.settings.leaveFailed',
  'organization.settings.dangerZone',
  'organization.settings.deleteTitle',
  'organization.settings.deleteDescription',
  'organization.settings.deleteAction',
  'organization.settings.deleteConfirmTitle',
  'organization.settings.deleteConfirmDescription',
  'organization.settings.deleteConfirmSlugLabel',
  'organization.settings.deleteConfirmAction',
  'organization.settings.deleted',
  'organization.settings.deleteFailed',
  'organization.accept.title',
  'organization.accept.description',
  'organization.accept.errorTitle',
  'organization.accept.goToOrgs',
  'organization.accept.loading',
  'organization.accept.organization',
  'organization.accept.role',
  'organization.accept.expiresAt',
  'organization.accept.accept',
  'organization.accept.accepted',
  'organization.accept.acceptFailed',
  'organization.accept.decline',
  'organization.accept.declined',
  'organization.accept.declineFailed',
  'organization.switcher.label',
  'organization.switcher.groupLabel',
  'organization.switcher.groupHint',
  'organization.switcher.manageMembers',
] as const;

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/**
 * `lang :: key` pairs whose translation is legitimately byte-identical to `en`.
 *
 * The copy-detection below is an exact set comparison, not a subset one, so
 * this list cannot quietly grow into a blanket: a tenth identical value fails,
 * and improving one of these to something non-identical fails too and forces
 * the line to be deleted. Every entry is a loanword or a true cognate the pack
 * already spells this way elsewhere:
 *
 *   - `Logo` — `appDesigner.logoUrl` renders it untranslated in zh/fr/de/es/pt.
 *   - `Slug` — `workspace.slugLabel` keeps the English term in fr/de/es/pt.
 *   - `General` (es) and `Invitations` (fr) are simply the words in those
 *     languages; `fr` uses the same spelling for `tabs.invitations` and the
 *     page title it labels.
 */
const COGNATES = [
  'zh :: organization.settings.logoLabel',
  'fr :: organization.settings.logoLabel',
  'de :: organization.settings.logoLabel',
  'es :: organization.settings.logoLabel',
  'pt :: organization.settings.logoLabel',
  'fr :: organization.settings.slugLabel',
  'de :: organization.settings.slugLabel',
  'es :: organization.settings.slugLabel',
  'pt :: organization.settings.slugLabel',
  'es :: organization.settings.generalTitle',
  'fr :: organization.tabs.invitations',
  'fr :: organization.invitations.title',
].sort();

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const wrapperFor = (lang: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {children}
      </I18nProvider>
    );
  };

beforeEach(() => {
  // The provider persists the last language (objectstack#5406); without this a
  // stale `zh` leaks into the `en` cases.
  window.localStorage.clear();
});

describe('objectui#3546 slice two — the organization namespace', () => {
  it('covers all ten packs and all ninety keys (guards the loops from emptying)', () => {
    expect(LANGS).toHaveLength(10);
    expect(KEYS).toHaveLength(90);
    expect(new Set(KEYS).size).toBe(90);
  });

  it.each(LANGS)('%s defines every organization key as a non-empty string', (lang) => {
    for (const key of KEYS) {
      const value = at(builtInLocales[lang], key);
      expect(typeof value, `${lang}.${key}`).toBe('string');
      expect((value as string).trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('the nine non-en packs carry real translations, not the English strings', () => {
    // The failure this catches is a backfill that copy-pastes `en` into the
    // other nine packs: full key parity, ten packs green, nine languages still
    // reading English. `all-locales-key-parity.test.ts` cannot see it, because
    // it compares key sets and never looks at a value.
    const identical: string[] = [];
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      for (const key of KEYS) {
        if (at(builtInLocales[lang], key) === at(builtInLocales.en, key)) identical.push(`${lang} :: ${key}`);
      }
    }
    expect(identical.sort()).toEqual(COGNATES);
    // 12 permitted pairs out of 810 — i.e. 86 of the 90 keys differ in every
    // single pack. If that ratio ever collapses the assertion above fires.
    expect(COGNATES).toHaveLength(12);
  });

  it('interpolation placeholders survive translation in every pack', () => {
    // A translator dropping `{{email}}` produces a sentence that reads fine and
    // silently loses the only piece of information the dialog exists to show.
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
    const interpolating = KEYS.filter((k) => placeholders(at(builtInLocales.en, k) as string) !== '');
    expect(interpolating).toEqual([
      'organization.members.removeConfirmDescription',
      'organization.invitations.cancelDescription',
      'organization.invitations.invitedAs',
      'organization.settings.leaveConfirmDescription',
      'organization.settings.deleteConfirmSlugLabel',
      'organization.accept.description',
    ]);
    for (const lang of LANGS) {
      for (const key of interpolating) {
        expect(placeholders(at(builtInLocales[lang], key) as string), `${lang}.${key}`).toBe(
          placeholders(at(builtInLocales.en, key) as string),
        );
      }
    }
  });

  it('the ratchet actually shrank — no organization key is still baselined', () => {
    // `scripts/i18n-call-site-key-baseline.json` fails the build both ways: an
    // unfixed key missing from it, AND a fixed key still listed. Pinning the
    // absence here means a revert of the packs cannot quietly restore the
    // entries and go green again.
    // Rooted at THIS FILE, not at the cwd (objectui#7799) — and prove the read
    // landed before asserting on it, or a moved file would make every assertion
    // below vacuous.
    const baselinePath = join(REPO_ROOT, 'scripts/i18n-call-site-key-baseline.json');
    expect(existsSync(baselinePath), `baseline not found at ${baselinePath}`).toBe(true);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      missingKeys: Record<string, unknown>;
      missingPrefixes: Record<string, unknown>;
    };
    expect(Object.keys(baseline.missingKeys).filter((k) => k.startsWith('organization.'))).toEqual([]);
    // `organization.invitations.status.*` was left untouched by THIS slice — a
    // template key FAMILY needs a different repair (enumerate the status values)
    // than the 90 literal keys — and the assertion here used to be
    // `toContain(…)`, whose whole job was to stop the family being forgotten.
    // Slice seven enumerated it (`StatusFilter` = all/pending/accepted/rejected/
    // canceled) and emptied `missingPrefixes`, so the assertion inverts: it now
    // states the family is gone, which is the fact a reverting change breaks.
    expect(Object.keys(baseline.missingPrefixes)).not.toContain('organization.invitations.status.');
    expect(Object.keys(baseline.missingPrefixes).sort()).toEqual([]);
    // The other namespaces' debt is not this slice's to spend. Slice three
    // (auth/oauth/acceptInvitation, 54 keys) took it from 163 to 109, slice four
    // (console, 41 keys) to 68, slice five (marketplace + preview, 37 keys) to 31,
    // slice six (perm + home, 14 keys) to 17 and slice seven (the 17-key residue)
    // to ZERO; this number moved once per slice, and only downwards.
    expect(Object.keys(baseline.missingKeys).length).toBe(0);
  });

  describe('through the real binding — bare useObjectTranslation, provider mounted', () => {
    // One key per sub-namespace, at the component that owns it.
    const SAMPLE: Array<[key: string, owner: string]> = [
      ['organization.backToList', 'OrganizationLayout'],
      ['organization.tabs.settings', 'OrganizationLayout'],
      ['organization.members.title', 'MembersPage'],
      ['organization.invitations.sendInvite', 'InviteMemberDialog'],
      ['organization.settings.dangerZone', 'SettingsPage'],
      ['organization.accept.title', 'AcceptInvitationPage'],
      ['organization.switcher.groupLabel', 'WorkspaceSwitcher'],
    ];

    it.each(['en', 'zh'] as const)('%s resolves every sampled key from the pack', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      for (const [key, owner] of SAMPLE) {
        const value = result.current.t(key);
        expect(value, `${lang} ${owner} rendered the raw key for ${key}`).not.toBe(key);
        expect(value, `${lang}.${key}`).toBe(at(builtInLocales[lang], key));
      }
    });

    it('zh is Chinese — the half that was red before the backfill', () => {
      // Pre-fix each of these returned the inline English `defaultValue`, in a
      // zh session. That is the whole defect, and only a zh assertion sees it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      expect(result.current.t('organization.backToList')).toBe('返回组织列表');
      expect(result.current.t('organization.members.title')).toBe('成员');
      expect(result.current.t('organization.invitations.sendInvite')).toBe('发送邀请');
      expect(result.current.t('organization.settings.dangerZone')).toBe('危险操作');
      expect(result.current.t('organization.accept.title')).toBe('您收到一份邀请');
      expect(result.current.t('organization.switcher.groupLabel')).toBe('当前工作组织');
    });
  });

  describe('interpolating call sites render their values', () => {
    it('en fills every placeholder', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('en') });
      const { t } = result.current;
      expect(t('organization.accept.description', { orgName: 'Acme Inc', role: 'Admin' })).toBe(
        'You have been invited to join Acme Inc as Admin.',
      );
      expect(t('organization.members.removeConfirmDescription', { name: 'Ada' })).toBe(
        'This will remove Ada from the organization. They will lose access immediately.',
      );
      expect(t('organization.invitations.cancelDescription', { email: 'ada@example.com' })).toBe(
        'The invitation for ada@example.com will be revoked.',
      );
      expect(t('organization.settings.deleteConfirmSlugLabel', { slug: 'acme' })).toBe(
        'Type "acme" to confirm',
      );
      expect(t('organization.settings.leaveConfirmDescription', { name: 'Acme Inc' })).toBe(
        'Are you sure you want to leave Acme Inc? You will lose access immediately.',
      );
      expect(t('organization.invitations.invitedAs', { email: 'ada@example.com', role: 'Admin' })).toBe(
        'ada@example.com invited as Admin',
      );
    });

    it('zh fills every placeholder — and keeps full-width punctuation around them', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('organization.accept.description', { orgName: 'Acme Inc', role: '管理员' })).toBe(
        '您受邀以 管理员 身份加入 Acme Inc。',
      );
      expect(t('organization.members.removeConfirmDescription', { name: 'Ada' })).toBe(
        '将把 Ada 从该组织中移除，其访问权限会立即失效。',
      );
      expect(t('organization.invitations.cancelDescription', { email: 'ada@example.com' })).toBe(
        '将撤销发给 ada@example.com 的邀请。',
      );
      // The quoting is the zh pack's own convention (see `fields.file.uploadFailed`),
      // not a transliteration of the English straight quotes.
      expect(t('organization.settings.deleteConfirmSlugLabel', { slug: 'acme' })).toBe('输入“acme”以确认');
      expect(t('organization.settings.leaveConfirmDescription', { name: 'Acme Inc' })).toBe(
        '确定要退出 Acme Inc 吗？您的访问权限会立即失效。',
      );
    });
  });

  it('`organization` and `organizations` stay separate namespaces', () => {
    // The org MANAGEMENT surface and the org PICKER differ by one letter at
    // every call site. Merging them would silently repoint 90 keys.
    expect(at(builtInLocales.en, 'organization.tabs.members')).toBe('Members');
    // The picker's noun became "Organization" with objectui#12851; the two
    // namespaces stay separate regardless.
    expect(at(builtInLocales.en, 'organizations.title')).toBe('Organizations');
    expect(at(builtInLocales.en, 'organization.title')).toBeUndefined();
  });
});
