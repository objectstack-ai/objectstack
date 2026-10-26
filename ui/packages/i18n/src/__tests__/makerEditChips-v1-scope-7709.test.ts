/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7709 — the maker's EDIT-mode start chips, the sibling family of the
 * five guarded by `makerStartChips-v1-scope-1984.test.ts`.
 *
 * `editAppSuggestions()` renders four starters when the build surface is bound
 * to an EXISTING app (`?package=`). Three of them ask for structure — a field,
 * an object, a dashboard — and all three are inside ADR-0112 v1's whitelist.
 * The fourth was `addAutomation`: 「加一个自动化 —— 审批、状态流转或通知」,
 * and approval / status flow / notification are ALL refused by v1 (cloud#1956 /
 * PR #1970). Worse than a refusal, measured on the sibling chips: the model
 * silently DEGRADES such a request into a view, so the chip promised an
 * automation and delivered a page.
 *
 * The product ruling (epic cloud#1955, 2026-09-05) replaced it rather than
 * dropping it: the three surviving chips all add STRUCTURE, and what an
 * existing app most often lacks is DATA — `seed` is on v1's whitelist
 * (`V1_METADATA_TYPES` in cloud `service-ai-studio/src/authoring-whitelist.ts`,
 * commented "sample data"), so the fourth chip now asks for sample records.
 *
 * Same three-part shape as the 1984 suite, and the third part is what keeps the
 * other two honest:
 *
 *  1. Every shipped pack carries all four chips, non-empty, and no fifth.
 *  2. No chip in any pack uses vocabulary that promises autonomous behaviour or
 *     an approval, scanned with that pack's OWN banned list — an English-only
 *     scan would have declared the five non-Latin packs clean without reading a
 *     character of them (AGENTS.md i18n forensics rule).
 *  3. A NON-VACUITY control: each pack's banned list is re-run against the
 *     `addAutomation` wording that pack actually shipped before this card, and
 *     must flag it.
 *
 * REVERT the wording (and relax this suite) when ADR-0112 v2 re-adds flows and
 * actions — the note beside the keys in every pack says so, and RETIRED below
 * is where that pack's automation sentence is kept.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** The four chips `editAppSuggestions()` renders, in order. */
const CHIP_KEYS = ['addField', 'addObject', 'addDashboard', 'addSampleData'] as const;

/** The pack's edit-mode chip block, reached through the shape the call site reads. */
const chipsOf = (lang: LocaleCode) =>
  (
    builtInLocales[lang] as {
      console?: { ai?: { suggestions?: { editApp?: Record<string, string> } } };
    }
  ).console?.ai?.suggestions?.editApp;

/**
 * Vocabulary that promises the product will ACT on its own — an automation, an
 * approval, a status workflow, an alert, a reminder, a notification, a trigger,
 * a schedule. Per locale, because the whole point is that the check reads each
 * pack in its own script; substring matching with no ASCII word classes, since
 * five of the ten packs are non-Latin and CJK has no word boundaries.
 *
 * The automation half is the `makerStartChips-v1-scope-1984` list verbatim (one
 * v1 boundary, two families reading it). The approval half is added here: this
 * chip's retired wording led with 审批 / approval, which that list did not name.
 *
 * Stems, not whole words: `automat` covers automate/automatic/automation and
 * their Romance cognates, `notifi` covers notify/notification/notificación,
 * `aprob` covers aprobación/aprobar.
 */
const BANNED: Record<LocaleCode, readonly string[]> = {
  en: ['alert', 'remind', 'notif', 'automat', 'workflow', 'trigger', 'schedule', 'approv'],
  zh: ['提醒', '预警', '警报', '自动', '流转', '通知', '触发', '定时', '审批'],
  de: ['automat', 'erinner', 'warnung', 'alarm', 'benachrichtig', 'workflow', 'auslös', 'ablauf', 'freigabe', 'genehmig'],
  fr: ['automat', 'alerte', 'rappel', 'notifi', 'workflow', 'flux', 'déclench', 'approbation', 'approuv'],
  es: ['automat', 'alerta', 'recordar', 'recordatorio', 'notifi', 'flujo', 'disparador', 'aprob'],
  pt: ['automa', 'alerta', 'lembr', 'notifi', 'fluxo', 'gatilho', 'aprova'],
  ru: ['автомат', 'оповещ', 'уведомл', 'напомин', 'триггер', 'процесс', 'поток', 'согласован', 'утвержд'],
  ja: ['自動', '通知', 'アラート', 'リマイン', 'ワークフロー', 'フロー', 'トリガー', '承認'],
  ko: ['자동', '알림', '알람', '워크플로', '흐름', '트리거', '승인'],
  ar: ['أتمتة', 'مؤتمت', 'تنبيه', 'إشعار', 'تذكير', 'سير عمل', 'موافقة', 'اعتماد'],
};

/** Every banned term this text hits, lower-cased for the case-insensitive scripts. */
function bannedHits(lang: LocaleCode, text: string): string[] {
  const haystack = text.toLocaleLowerCase(lang === 'zh' ? 'zh' : undefined);
  return BANNED[lang].filter((term) => haystack.includes(term.toLocaleLowerCase()));
}

/**
 * The `addAutomation` sentence each pack shipped BEFORE this card. Kept as the
 * control sample AND as the record of what ADR-0112 v2 restores — not as a
 * fixture to revert to today.
 */
const RETIRED: Record<LocaleCode, string> = {
  en: 'Add an automation — an approval, a status flow, or a notification.',
  zh: '加一个自动化 —— 审批、状态流转或通知。',
  de: 'Füge eine Automatisierung hinzu — eine Freigabe, einen Statusablauf oder eine Benachrichtigung.',
  fr: 'Ajoute une automatisation — une approbation, un flux de statuts ou une notification.',
  es: 'Añade una automatización — una aprobación, un flujo de estados o una notificación.',
  pt: 'Adicione uma automação — uma aprovação, um fluxo de status ou uma notificação.',
  ru: 'Добавь автоматизацию — согласование, процесс статусов или уведомление.',
  ja: '自動化を追加してください — 承認、ステータスフロー、または通知。',
  ko: '자동화를 추가해 주세요 — 승인, 상태 흐름 또는 알림.',
  ar: 'أضف أتمتة — موافقة أو سير حالات أو إشعارًا.',
};

describe('maker edit-mode chips — every shipped pack carries all four (objectui#7709)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s defines a non-empty string for every chip', (lang) => {
    const block = chipsOf(lang);
    expect(block, `${lang} has no console.ai.suggestions.editApp block`).toBeTruthy();
    for (const key of CHIP_KEYS) {
      expect(typeof block![key], `${lang}.${key}`).toBe('string');
      expect(block![key].trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
    }
    // No chip beyond the four the call site renders, and — the half that
    // matters here — no `addAutomation` left behind in any pack.
    expect(Object.keys(block!).sort()).toEqual([...CHIP_KEYS].sort());
  });

  it.each(LANGS)('%s: the four chips are four DIFFERENT asks', (lang) => {
    // The replacement had to avoid duplicating the three chips beside it —
    // that is precisely why "reword it like the other five" was not available
    // and this became its own product call.
    const block = chipsOf(lang)!;
    const values = CHIP_KEYS.map((k) => block[k].trim());
    expect(new Set(values).size, `${lang}: ${values.join(' | ')}`).toBe(CHIP_KEYS.length);
  });
});

describe('maker edit-mode chips — none promises autonomous behaviour (objectui#7709)', () => {
  it.each(LANGS)('%s: no chip uses that pack`s automation/approval vocabulary', (lang) => {
    const block = chipsOf(lang)!;
    for (const key of CHIP_KEYS) {
      expect(bannedHits(lang, block[key]), `${lang}.${key}: "${block[key]}"`).toEqual([]);
    }
  });

  it.each(LANGS)('%s: the banned list still flags the wording this pack retired', (lang) => {
    // Non-vacuity. A green run above means nothing unless this is green too.
    expect(bannedHits(lang, RETIRED[lang]).length, `${lang} control: "${RETIRED[lang]}"`).toBeGreaterThan(0);
  });

  it('the replaced chip asks for DATA, in the two languages the card quoted', () => {
    expect(chipsOf('en')!.addSampleData).toContain('sample records');
    expect(chipsOf('zh')!.addSampleData).toContain('示例数据');
  });
});
