/**
 * The organisation is called by ONE noun per pack, and it is that pack's word
 * for "organization" (objectui#5215, then objectui#12851).
 *
 * ## History
 *
 * objectui#5215 found the `organizations.*` PICKER family (avatar menu /
 * console picker — distinct from `organization.*` org MANAGEMENT, see the
 * separating comment in `en.ts`) mixing two nouns inside one dropdown: `de.ts`
 * read `create: "Workspace erstellen"` beside `mine: "Meine Organisationen"`.
 * It settled the family on "workspace".
 *
 * objectui#12851 executes the maintainer's ruling on objectstack-ai/cloud#2939
 * (letter A): "workspace" was naming two different things — the organisation
 * members and billing belong to, and the running environment an app lives in.
 * The organisation is now "Organization" (zh 组织, ja 組織, es Organización, …)
 * and "workspace" retires from it. The one-noun-per-pack invariant #5215
 * pinned still holds; only the noun turned around.
 *
 * ## What this pins
 *
 * For every one of the ten packs, every value in the two families that name
 * the organisation — the `organizations.*` picker and the `workspace.*`
 * switcher / create-dialog keys (the keys keep their historical name; only
 * the values moved) — contains the pack's organisation stem and none of the
 * pack's retired workspace stems. A future edit that brings the old noun back
 * into one key, the exact shape of #5215's defect, fails here.
 *
 * ## Why no other gate sees this class
 *
 * `all-locales-key-parity` is a key-set invariant; `check:i18n-drift` only
 * follows an `en` value that moved; `check:i18n-keys` compares call sites with
 * `en` only. None of them reads same-language vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;

/** The keys whose value names the organisation. */
const ORG_KEYS = [
  'organizations.mine',
  'organizations.create',
  'organizations.title',
  'organizations.heading',
  'organizations.subtitle',
  'organizations.searchPlaceholder',
  'organizations.new',
  'organizations.current',
  'organizations.emptyTitle',
  'organizations.emptyDescription',
  'organizations.noMatches',
  'workspace.label',
  'workspace.default',
  'workspace.switch',
  'workspace.createTitle',
  'workspace.createDescription',
  'workspace.createButton',
  'workspace.nameLabel',
  'workspace.settings',
  'workspace.createFailed',
] as const;

// Stems are deliberately SHORT so they survive each pack's inflection
// (Spanish "organización" / "organizaciones" share "organizaci"; Russian
// "организация" / "организации" share "организац"; Arabic "مؤسسة" /
// "مؤسسات" / "مؤسستي" share "مؤسس"). Comparisons are case-insensitive.
// The retired stems are each pack's former word for the organisation —
// Spanish and French keep only the invariant second word of "espacio de
// trabajo" / "espace de travail", and Arabic the root of "مساحة" / "مساحات".
const PACKS: Record<LocaleCode, { orgStem: string; retiredStems: string[] }> = {
  en: { orgStem: 'organization', retiredStems: ['workspace'] },
  zh: { orgStem: '组织', retiredStems: ['工作区'] },
  ar: { orgStem: 'مؤسس', retiredStems: ['مساح'] },
  de: { orgStem: 'organisation', retiredStems: ['workspace', 'arbeitsbereich'] },
  es: { orgStem: 'organizaci', retiredStems: ['trabajo'] },
  fr: { orgStem: 'organisation', retiredStems: ['travail'] },
  ja: { orgStem: '組織', retiredStems: ['ワークスペース'] },
  ko: { orgStem: '조직', retiredStems: ['워크스페이스', '작업 공간'] },
  pt: { orgStem: 'organizaç', retiredStems: ['workspace', 'trabalho'] },
  ru: { orgStem: 'организац', retiredStems: ['пространств'] },
};

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

describe('objectui#12851 — the organisation speaks one noun per pack, and it is "organization"', () => {
  it('covers all ten packs', () => {
    expect(Object.keys(PACKS).sort()).toEqual(Object.keys(builtInLocales).sort());
  });

  it.each(Object.keys(PACKS) as LocaleCode[])('%s: every organisation value carries the organisation noun', (lang) => {
    const { orgStem } = PACKS[lang];
    for (const key of ORG_KEYS) {
      const value = at(builtInLocales[lang], key);
      expect(typeof value, `${key} in ${lang}`).toBe('string');
      expect(
        (value as string).toLowerCase().includes(orgStem.toLowerCase()),
        `${key} in ${lang} does not contain "${orgStem}": ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it.each(Object.keys(PACKS) as LocaleCode[])('%s: no organisation value still carries the retired workspace noun', (lang) => {
    const { retiredStems } = PACKS[lang];
    for (const key of ORG_KEYS) {
      const value = at(builtInLocales[lang], key) as string;
      for (const stem of retiredStems) {
        expect(
          value.toLowerCase().includes(stem.toLowerCase()),
          `${key} in ${lang} still contains "${stem}": ${JSON.stringify(value)}`,
        ).toBe(false);
      }
    }
  });

  it('the sibling organization.* (singular, management) namespace already used the organisation noun', () => {
    // The management family never moved; it and the picker now agree.
    for (const lang of Object.keys(PACKS) as LocaleCode[]) {
      const backToList = at(builtInLocales[lang], 'organization.backToList');
      expect(typeof backToList, `organization.backToList in ${lang}`).toBe('string');
      expect(
        (backToList as string).toLowerCase().includes(PACKS[lang].orgStem.toLowerCase()),
        `organization.backToList in ${lang}: ${JSON.stringify(backToList)}`,
      ).toBe(true);
    }
  });
});
