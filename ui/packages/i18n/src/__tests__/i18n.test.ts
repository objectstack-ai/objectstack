import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { I18N_PROBE_FLAG } from '../i18n';
import {
  createI18n,
  getDirection,
  getAvailableLanguages,
  isRTL,
  RTL_LANGUAGES,
  formatDate,
  formatCurrency,
  formatNumber,
} from '../index';
// ⚠️ From the ALL-TEN door, not the entry (objectui#7479). The entry
// re-exports `en` alone; these cases compare every pack against every other,
// which is what that door is for and why it is a separate specifier.
//
// ⭐ `registerBuiltInLocales()` comes from the same door: the nine non-`en`
// catalogues are `import()`ed on demand, so nothing below would be resident
// when `createI18n` reads the registry and this file's synchronous assertions
// would see the `en` fallback. Called at MODULE SCOPE so the cost sits in the
// import phase, next to the import that already paid for these modules, rather
// than in a `beforeAll` bounded by `hookTimeout` (AGENTS.md, "测试纪律").
//
// ⚠️ This is the ONE file that says it for itself. Every other suite in this
// repository that needs the catalogues resident renders, so it runs in a DOM
// project and `vitest.setup.i18n-catalogues.ts` has already done it. This file
// runs in `unit`, whose setup chain is deliberately kept cheap for pure-logic
// node tests that pull no i18n at all — read that module's "Cost" section.
import { builtInLocales, registerBuiltInLocales } from '../locales';

registerBuiltInLocales();

describe('@object-ui/i18n', () => {
  describe('createI18n', () => {
    it('creates an i18next instance with default config', () => {
      const i18n = createI18n({ detectBrowserLanguage: false });
      expect(i18n).toBeDefined();
      expect(i18n.language).toBe('en');
    });

    it('creates an instance with specified default language', () => {
      const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
      expect(i18n.language).toBe('zh');
    });

    it('loads all built-in locales', () => {
      const i18n = createI18n({ detectBrowserLanguage: false });
      const langs = getAvailableLanguages(i18n);
      expect(langs).toContain('en');
      expect(langs).toContain('zh');
      expect(langs).toContain('ja');
      expect(langs).toContain('ko');
      expect(langs).toContain('de');
      expect(langs).toContain('fr');
      expect(langs).toContain('es');
      expect(langs).toContain('pt');
      expect(langs).toContain('ru');
      expect(langs).toContain('ar');
      expect(langs.length).toBeGreaterThanOrEqual(10);
    });

    it('translates common keys in English', () => {
      const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
      expect(i18n.t('common.save')).toBe('Save');
      expect(i18n.t('common.cancel')).toBe('Cancel');
      expect(i18n.t('common.delete')).toBe('Delete');
      // U+2026, not three ASCII dots (objectui#3878 converged the ten packs).
      expect(i18n.t('common.loading')).toBe('Loading…');
      expect(i18n.t('common.selectOption')).toBe('Select an option');
      expect(i18n.t('common.select')).toBe('Select…');
    });

    it('translates new form keys in English', () => {
      const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
      expect(i18n.t('form.createTitle', { object: 'Contact' })).toBe('Create Contact');
      expect(i18n.t('form.editTitle', { object: 'Contact' })).toBe('Edit Contact');
      expect(i18n.t('form.saveRecord')).toBe('Save');
    });

    it('translates common keys in Chinese', () => {
      const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
      expect(i18n.t('common.save')).toBe('保存');
      expect(i18n.t('common.cancel')).toBe('取消');
      expect(i18n.t('common.delete')).toBe('删除');
      // U+2026, not three ASCII dots (objectui#3878 converged the ten packs).
      expect(i18n.t('common.loading')).toBe('加载中…');
      expect(i18n.t('common.selectOption')).toBe('请选择');
      expect(i18n.t('common.select')).toBe('选择…');
    });

    it('translates new form keys in Chinese', () => {
      const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
      expect(i18n.t('form.createTitle', { object: '联系人' })).toBe('新建联系人');
      expect(i18n.t('form.editTitle', { object: '联系人' })).toBe('编辑联系人');
      expect(i18n.t('form.saveRecord')).toBe('保存');
    });

    it('translates toolbarEnabledCount in Chinese (not English fallback)', () => {
      const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
      expect(i18n.t('console.objectView.toolbarEnabledCount', { count: 3, total: 5 })).toBe('已启用 3/5 项');
    });

    it('translates the AI "Proposed plan" card keys in Chinese (not English fallback)', () => {
      const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
      expect(i18n.t('console.ai.planTitle')).toBe('方案预览');
      expect(i18n.t('console.ai.planQuestions')).toBe('搭建前请确认');
      expect(i18n.t('console.ai.planAssumptions')).toBe('假设');
      expect(i18n.t('console.ai.planApproveHint')).toBe('回复以确认或调整该方案。');
      expect(i18n.t('console.ai.planApprove')).toBe('开始搭建');
      expect(i18n.t('console.ai.planAdjust')).toBe('调整方案');
      expect(i18n.t('console.ai.planApproveMessage')).toBe('确认，开始搭建。');
      expect(i18n.t('console.ai.planApproveDefaultsMessage')).toBe('确认搭建，未决问题按你的合理假设和默认处理。');
      expect(i18n.t('console.ai.nextSteps')).toBe('下一步');
    });

    // Regression guard: the plan card's "Build it" and the change card's
    // "Confirm" buttons SEND these messages to the agent, and the cloud confirm
    // gate (service-ai-studio confirm-gate.ts APPROVAL_RE) decides whether the
    // text counts as approval. Text the gate does not recognise fails SILENTLY:
    // the agent re-proposes instead of acting and the button just looks inert.
    //
    // `GATE` below is a verbatim mirror of that regex. It is duplicated across
    // repo boundaries on purpose — objectui cannot import from cloud — so when
    // APPROVAL_RE changes there, update this copy in the same breath.
    //
    // How this guard earned its keep: it originally mirrored only the CHINESE
    // clause, and the English half was reduced to "starts with Confirm, contains
    // apply" because nothing here could see the real pattern. That weaker check
    // passed while the shipped English string ("…apply what you just proposed")
    // did NOT match the gate — every English conversation's Confirm button was
    // dead, and so were all eight locales that fall back to English.
    const GATE =
      /直接搭建|直接建|直接帮我(建|搭)|不用再?问我?|别再?问我?|无需确认|不用确认|确认[，,、]?\s*(开始|可以|并|要)?\s*(搭建|创建|生成|构建|修改|应用|执行|继续)|应用(你|您|刚才|这个?|那个?|该|上述|提议|建议)+的?\s*(改动|修改|变更|更改)|^\s*确[认定][。.!！\s]*$|just build it|go ahead and build|start building|build it now|don'?t ask|without confirmation|build it as proposed|build it with your best|apply (this|the) change/i;

    // Only the APPROVAL messages. `planAnswerMessage` is deliberately absent: it
    // answers a structure question so the agent can continue, and must NOT read
    // as blanket approval.
    const APPROVAL_KEYS = [
      'console.ai.planApproveMessage',
      'console.ai.planApproveDefaultsMessage',
      'console.ai.changesConfirmMessage',
    ] as const;

    it.each(['zh', 'en'])(
      'every outbound approval message the %s console sends satisfies the cloud confirm gate',
      (lang) => {
        const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
        for (const key of APPROVAL_KEYS) {
          const msg = i18n.t(key);
          expect(msg, `${key} must not fall through to its raw key`).not.toBe(key);
          expect(msg, `${lang} ${key} does not match the cloud APPROVAL_RE`).toMatch(GATE);
        }
      },
    );

    it('the gate stays narrow — a plain build request is not approval', () => {
      // If these ever match, the preview-first gate has been widened into
      // uselessness and the mirror above is no longer worth trusting.
      expect('帮我搭建一个 CRM').not.toMatch(GATE);
      expect('Please build me a CRM app').not.toMatch(GATE);
      expect('我不确定这样对不对').not.toMatch(GATE);
    });

    it('planAnswerMessage answers a question without reading as approval', () => {
      const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
      const msg = i18n.t('console.ai.planAnswerMessage', {
        question: 'One shelf or many?',
        option: 'many',
      });
      expect(msg).not.toMatch(GATE);
    });

    it('the inline HITL deny reason never reads as approval, in any pack (objectui#11667)', () => {
      // `console.ai.toolDenyReason` is a label — it follows the UI locale, so
      // all ten packs define it — but it does not stay on screen: the reject
      // request stores it, and `useHitlInChat` embeds it in the continuation
      // prompt it sends into the thread after the reject. A translation the
      // gate read as approval would turn the operator's rejection into a
      // go-ahead in that thread.
      for (const lang of ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar']) {
        const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
        const msg = i18n.t('console.ai.toolDenyReason');
        expect(msg, `${lang} toolDenyReason must not fall through to its raw key`).not.toBe(
          'console.ai.toolDenyReason',
        );
        expect(msg, `${lang} toolDenyReason reads as approval to the cloud APPROVAL_RE`).not.toMatch(GATE);
      }
    });

    it('translates common keys in Japanese', () => {
      const i18n = createI18n({ defaultLanguage: 'ja', detectBrowserLanguage: false });
      expect(i18n.t('common.save')).toBe('保存');
      expect(i18n.t('common.cancel')).toBe('キャンセル');
    });

    it('translates common keys in Korean', () => {
      const i18n = createI18n({ defaultLanguage: 'ko', detectBrowserLanguage: false });
      expect(i18n.t('common.save')).toBe('저장');
      expect(i18n.t('common.cancel')).toBe('취소');
    });

    it('supports interpolation in validation messages', () => {
      const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
      expect(i18n.t('validation.required', { field: 'Name' })).toBe('Name is required');
      expect(i18n.t('validation.minLength', { field: 'Password', min: 8 })).toBe(
        'Password must be at least 8 characters',
      );
    });

    it('supports interpolation in Chinese', () => {
      const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
      expect(i18n.t('validation.required', { field: '姓名' })).toBe('姓名不能为空');
    });

    it('falls back to English for unknown language', () => {
      const i18n = createI18n({ defaultLanguage: 'xx', fallbackLanguage: 'en', detectBrowserLanguage: false });
      expect(i18n.t('common.save')).toBe('Save');
    });

    // objectui#7572 — ADDING a group and OVERRIDING a group are two different
    // operations on `resources`, and only the first used to be pinned. The old
    // single test was called 'merges custom resources with built-in locales',
    // which reads as though it covered both; it supplied `custom` (a key no pack
    // has) and then checked `common.save`, i.e. a DIFFERENT group. So the merge
    // never had to survive a collision, and the shallow-merge defect below read
    // as already-covered. One test per operation, each named for the one it pins.
    it('adds a NEW top-level group and leaves the built-in groups intact', () => {
      const i18n = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: {
          en: { custom: { greeting: 'Hello!' } },
        },
      });
      expect(i18n.t('custom.greeting')).toBe('Hello!');
      // Built-in translations still work
      expect(i18n.t('common.save')).toBe('Save');
    });

    it('overrides ONE key of an EXISTING group and keeps that group\'s other keys', () => {
      // The card's exact shape. Under the one-level merge this replaced the whole
      // `calendar` group, so the seven siblings vanished from the instance and
      // `t('calendar.allDay')` returned the bare key — which reaches the DOM as
      // the literal text `calendar.allDay`.
      const i18n = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: {
          en: { calendar: { today: 'Heute' } },
        },
      });

      expect(i18n.t('calendar.today')).toBe('Heute');

      // Every other key of the SAME group survives the partial override.
      expect(i18n.t('calendar.month')).toBe('Month');
      expect(i18n.t('calendar.week')).toBe('Week');
      expect(i18n.t('calendar.day')).toBe('Day');
      expect(i18n.t('calendar.allDay')).toBe('All Day');
      expect(i18n.t('calendar.newEvent')).toBe('New event');
      expect(i18n.t('calendar.moreEvents')).toBe('+{{count}} more');
      expect(i18n.t('calendar.unscheduled')).toBe('Unscheduled ({{count}})');

      // Assert the failure mode directly, not just the happy value: a dropped key
      // resolves to its own name, so this is what the defect looked like.
      expect(i18n.t('calendar.allDay')).not.toBe('calendar.allDay');
    });

    it('merges below the group level, not just one level deeper', () => {
      // Packs nest up to four levels below the group, so a fixed "one more level"
      // would still drop siblings here: `capability.group.platform` is three deep.
      const i18n = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: {
          en: { capability: { group: { platform: 'Plattform' } } },
        },
      });

      expect(i18n.t('capability.group.platform')).toBe('Plattform');
      // Siblings at the overridden level...
      expect(i18n.t('capability.group.org')).toBe('Organization');
      expect(i18n.t('capability.group.other')).toBe('Other');
      // ...and the untouched sibling subtree one level up.
      expect(i18n.t('capability.label.manage_users')).toBe('Manage Users');
    });

    it('replaces an array value instead of concatenating it', () => {
      // The array question, answered explicitly (objectui#7572). No built-in pack
      // carries an array today, so this pins the decision rather than existing
      // behaviour: an author who writes an array is naming the whole list, so a
      // shorter override must be able to shorten it.
      const withArray = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: {
          en: { customList: { items: ['a', 'b', 'c'] } },
        },
      });
      expect(withArray.t('customList.items', { returnObjects: true })).toEqual(['a', 'b', 'c']);

      // A second instance whose override is shorter must NOT inherit a stale tail.
      const overridden = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: {
          en: { calendar: { today: ['only-one'] } },
        },
      });
      expect(overridden.t('calendar.today', { returnObjects: true })).toEqual(['only-one']);
      expect(overridden.t('calendar.allDay')).toBe('All Day');
    });

    it('re-supplying an identical built-in pack changes nothing', () => {
      // The shape `packages/plugin-grid/demo` uses: it hands the built-in packs
      // straight back through `resources`. Deep-merging a pack over itself must
      // be a no-op, not a rebuild that could reorder or drop anything.
      const i18n = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: { en: builtInLocales.en as unknown as Record<string, unknown> },
      });
      expect(i18n.getResourceBundle('en', 'translation')).toEqual(builtInLocales.en);
    });

    it('does not let a resource key reach Object.prototype', () => {
      // The merge assigns recursively where the old code spread; assignment is the
      // form that can reach the prototype setter, so the guard is pinned here.
      const i18n = createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: JSON.parse('{"en":{"__proto__":{"polluted":"yes"}}}') as Record<
          string,
          Record<string, unknown>
        >,
      });
      expect(i18n.t('common.save')).toBe('Save');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('polluted');
    });

    it('changes language dynamically', async () => {
      const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
      expect(i18n.t('common.save')).toBe('Save');

      await i18n.changeLanguage('zh');
      expect(i18n.language).toBe('zh');
      expect(i18n.t('common.save')).toBe('保存');

      await i18n.changeLanguage('ja');
      expect(i18n.language).toBe('ja');
      expect(i18n.t('common.save')).toBe('保存');
    });
  });

  describe('getDirection', () => {
    it('returns ltr for English', () => {
      expect(getDirection('en')).toBe('ltr');
    });

    it('returns ltr for Chinese', () => {
      expect(getDirection('zh')).toBe('ltr');
    });

    it('returns rtl for Arabic', () => {
      expect(getDirection('ar')).toBe('rtl');
    });

    it('returns ltr for unknown languages', () => {
      expect(getDirection('xx')).toBe('ltr');
    });
  });

  describe('isRTL', () => {
    it('returns true for Arabic', () => {
      expect(isRTL('ar')).toBe(true);
    });

    it('returns false for English', () => {
      expect(isRTL('en')).toBe(false);
    });

    it('returns false for Chinese', () => {
      expect(isRTL('zh')).toBe(false);
    });
  });

  describe('RTL_LANGUAGES', () => {
    it('includes Arabic', () => {
      expect(RTL_LANGUAGES).toContain('ar');
    });

    it('includes Hebrew', () => {
      expect(RTL_LANGUAGES).toContain('he');
    });
  });

  describe('builtInLocales', () => {
    it('has 10 built-in language packs', () => {
      expect(Object.keys(builtInLocales).length).toBe(10);
    });

    it('all locales have the same top-level keys', () => {
      // Keyed off the map itself rather than `Object.entries`, which erases
      // which keys it enumerated and leaves `locale` as `unknown` — the same
      // convention `all-locales-key-parity.test.ts` states next door.
      const codes = Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>;
      const enKeys = Object.keys(builtInLocales.en).sort();
      for (const code of codes) {
        expect(Object.keys(builtInLocales[code]).sort()).toEqual(enKeys);
      }
    });

    it('all locales have common section keys matching English', () => {
      const codes = Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>;
      const enCommonKeys = Object.keys(builtInLocales.en.common).sort();
      // The one key a pack may hold that `en` lacks: the slot of an `en` count
      // family for a CLDR category the pack's OWN language selects — `ru`
      // `itemCount_few`, `ar` `itemCount_two` (objectui#11432 / objectui#11445;
      // `all-locales-key-parity.test.ts` owns that rule repo-wide).
      const SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
      const stem = (k: string) => {
        const s = SUFFIXES.find((x) => k.endsWith(x));
        return s ? { base: k.slice(0, -s.length), category: s.slice(1) } : undefined;
      };
      const enFamilies = new Set(enCommonKeys.flatMap((k) => (stem(k) ? [stem(k)!.base] : [])));
      const isLocalSlot = (code: string, k: string) => {
        const s = stem(k);
        return (
          s !== undefined &&
          !enCommonKeys.includes(k) &&
          enFamilies.has(s.base) &&
          (new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[]).includes(s.category)
        );
      };
      for (const code of codes) {
        const keys = Object.keys(builtInLocales[code].common).filter((k) => !isLocalSlot(code, k));
        expect(keys.sort()).toEqual(enCommonKeys);
      }
    });
  });

  describe('formatDate', () => {
    it('formats a date with default options', () => {
      const result = formatDate(new Date(2026, 0, 15), { locale: 'en' });
      expect(result).toContain('Jan');
      expect(result).toContain('15');
      expect(result).toContain('2026');
    });

    it('formats a date with short style', () => {
      const result = formatDate(new Date(2026, 0, 15), { locale: 'en', style: 'short' });
      expect(result).toContain('15');
    });

    it('returns string for invalid dates', () => {
      const result = formatDate('invalid-date');
      expect(result).toBe('invalid-date');
    });
  });

  describe('formatCurrency', () => {
    it('formats USD by default', () => {
      const result = formatCurrency(1234.56, { locale: 'en' });
      expect(result).toContain('1,234.56');
    });

    it('formats EUR', () => {
      const result = formatCurrency(1234.56, { locale: 'de', currency: 'EUR' });
      expect(result).toContain('1.234,56');
    });

    it('formats CNY', () => {
      const result = formatCurrency(1234.56, { locale: 'zh', currency: 'CNY' });
      expect(result).toContain('1,234.56');
    });
  });

  describe('formatNumber', () => {
    it('formats a number with default locale', () => {
      const result = formatNumber(1234567.89, { locale: 'en' });
      expect(result).toContain('1,234,567.89');
    });

    it('formats with compact notation', () => {
      const result = formatNumber(1234567, { locale: 'en', notation: 'compact' });
      expect(result).toContain('M'); // e.g. 1.2M
    });
  });

  // ── M2: dev-mode missing-key warnings (issue #1319) ────────────────────────
  describe('warnMissingKeys', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns once when a static key is missing', () => {
      const i18n = createI18n({ detectBrowserLanguage: false, warnMissingKeys: true });
      i18n.t('totally.missing.key');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('totally.missing.key');
    });

    it('dedupes repeated lookups of the same missing key', () => {
      const i18n = createI18n({ detectBrowserLanguage: false, warnMissingKeys: true });
      i18n.t('repeat.me');
      i18n.t('repeat.me');
      i18n.t('repeat.me');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('does not warn for resolved keys', () => {
      const i18n = createI18n({ detectBrowserLanguage: false, warnMissingKeys: true });
      i18n.t('common.save');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('stays silent for flagged convention-key probes', () => {
      const i18n = createI18n({ detectBrowserLanguage: false, warnMissingKeys: true });
      i18n.t('crm.objects.lead.label', { defaultValue: '', [I18N_PROBE_FLAG]: true });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn at all when disabled', () => {
      const i18n = createI18n({ detectBrowserLanguage: false, warnMissingKeys: false });
      i18n.t('another.missing.key');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
