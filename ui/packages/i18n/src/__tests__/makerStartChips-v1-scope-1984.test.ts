/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * cloud#1984 — the maker's five start chips are the PRODUCT's own
 * recommendations, so what they ask for has to be what the product builds.
 *
 * ADR-0112 v1 (cloud#1956 / PR #1970) authors objects, fields, views, pages,
 * dashboards and sample data; it has no flows, actions or schedules. The
 * measured behaviour of the two chips that asked for automation was NOT a
 * refusal — the model silently degraded 「状态流转」 into a status board and
 * 「低库存预警」 into a filtered view — so the user was promised an alert and
 * handed a page. This suite is the standing guard on that gap.
 *
 * Three things, and the third is what keeps the other two honest:
 *
 *  1. Every shipped pack carries all five chips, non-empty. (`all-locales-key-
 *     parity` already enforces en ↔ pack KEY parity generically; the value side
 *     is what matters here.)
 *  2. No chip in any pack uses vocabulary that promises autonomous behaviour,
 *     scanned with that pack's OWN banned list — an English-only scan would
 *     have declared the five non-Latin packs clean without reading a character
 *     of them (AGENTS.md i18n forensics rule).
 *  3. A NON-VACUITY control: each pack's banned list is re-run against the
 *     RETIRED wording that pack actually shipped before this card, and must
 *     flag it. Without this, deleting a term from a banned list (or getting a
 *     locale's spelling wrong) would leave every assertion green while
 *     checking nothing.
 *
 * REVERT the wording (and relax this suite) when ADR-0112 v2 re-adds flows and
 * actions — see the note beside the keys in every pack.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** The five chips `metadataAssistantSuggestions()` renders, in order. */
const CHIP_KEYS = ['buildCrm', 'buildApp', 'buildFlow', 'buildInventory', 'buildRecruiting'] as const;

/** The pack's chip block, reached through the one shape the call site reads. */
const chipsOf = (lang: LocaleCode) =>
  (
    builtInLocales[lang] as {
      console?: { ai?: { suggestions?: { metadataAssistant?: Record<string, string> } } };
    }
  ).console?.ai?.suggestions?.metadataAssistant;

/**
 * Vocabulary that promises the product will ACT on its own — an alert, a
 * reminder, a notification, an automation, a status workflow, a trigger, a
 * schedule. Per locale, because the whole point is that the check reads each
 * pack in its own script; `u` + substring matching (never ASCII `\w`), since
 * five of the ten packs are non-Latin and CJK has no word boundaries.
 *
 * Stems, not whole words: `automat` covers automate/automatic/automation and
 * their Romance cognates, `notifi` covers notify/notification/notificación.
 */
const BANNED: Record<LocaleCode, readonly string[]> = {
  en: ['alert', 'remind', 'notif', 'automat', 'workflow', 'trigger', 'schedule'],
  zh: ['提醒', '预警', '警报', '自动', '流转', '通知', '触发', '定时'],
  de: ['automat', 'erinner', 'warnung', 'alarm', 'benachrichtig', 'workflow', 'auslös', 'ablauf'],
  fr: ['automat', 'alerte', 'rappel', 'notifi', 'workflow', 'flux', 'déclench'],
  es: ['automat', 'alerta', 'recordar', 'recordatorio', 'notifi', 'flujo', 'disparador'],
  pt: ['automa', 'alerta', 'lembr', 'notifi', 'fluxo', 'gatilho'],
  ru: ['автомат', 'оповещ', 'уведомл', 'напомин', 'триггер', 'процесс', 'поток'],
  ja: ['自動', '通知', 'アラート', 'リマイン', 'ワークフロー', 'フロー', 'トリガー'],
  ko: ['자동', '알림', '알람', '워크플로', '흐름', '트리거'],
  ar: ['أتمتة', 'مؤتمت', 'تنبيه', 'إشعار', 'تذكير', 'سير عمل'],
};

/** Every banned term this text hits, lower-cased for the case-insensitive scripts. */
function bannedHits(lang: LocaleCode, text: string): string[] {
  const haystack = text.toLocaleLowerCase(lang === 'zh' ? 'zh' : undefined);
  return BANNED[lang].filter((term) => haystack.includes(term.toLocaleLowerCase()));
}

/**
 * The wording each pack shipped BEFORE cloud#1984 — the ticket chip's status
 * workflow, plus the two the card quoted verbatim (zh's 低库存预警, ar's
 * تنبيه لانخفاض المخزون). Kept as the control sample, NOT as a fixture to
 * revert to: it is here only so a banned list that has stopped working fails
 * loudly instead of passing silently.
 */
const RETIRED: Record<LocaleCode, readonly string[]> = {
  en: ['Design a support desk — tickets with priority, a status workflow, and customer links.'],
  zh: ['设计一个工单系统：工单、优先级、状态流转。', '做一个库存管理应用：商品、库存量、供应商，以及低库存预警。'],
  de: ['Entwirf einen Support-Desk — Tickets mit Priorität, einen Status-Workflow und Kundenverknüpfungen.'],
  fr: ["Conçois un service d'assistance — tickets avec priorité, un flux de statuts et des liens vers les clients."],
  es: ['Diseña una mesa de ayuda — tickets con prioridad, un flujo de estados y vínculos con los clientes.'],
  pt: ['Projete uma central de suporte — chamados com prioridade, um fluxo de status e vínculos com clientes.'],
  ru: ['Спроектируй службу поддержки — заявки с приоритетом, процесс статусов и связи с клиентами.'],
  ja: ['サポートデスクを設計して — 優先度つきチケット、ステータスのワークフロー、顧客との紐付け。'],
  ko: ['고객 지원 데스크를 설계해 줘 — 우선순위가 있는 티켓, 상태 워크플로, 고객 연결.'],
  ar: ['صمّم مكتب دعم — تذاكر بأولوية وسير عمل للحالات وروابط بالعملاء.', 'أنشئ تطبيق مخزون — منتجات ومستويات مخزون وموردين وتنبيه لانخفاض المخزون.'],
};

describe('maker start chips — every shipped pack carries all five (cloud#1984)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s defines a non-empty string for every chip', (lang) => {
    const block = chipsOf(lang);
    expect(block, `${lang} has no console.ai.suggestions.metadataAssistant block`).toBeTruthy();
    for (const key of CHIP_KEYS) {
      expect(typeof block![key], `${lang}.${key}`).toBe('string');
      expect(block![key].trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
    }
    // No chip beyond the five the call site renders — an extra key is a chip
    // nobody sees, and a sixth chip means the call site changed without this.
    expect(Object.keys(block!).sort()).toEqual([...CHIP_KEYS].sort());
  });
});

describe('maker start chips — none promises autonomous behaviour (cloud#1984)', () => {
  it.each(LANGS)('%s: no chip uses that pack`s automation vocabulary', (lang) => {
    const block = chipsOf(lang)!;
    for (const key of CHIP_KEYS) {
      expect(bannedHits(lang, block[key]), `${lang}.${key}: "${block[key]}"`).toEqual([]);
    }
  });

  it.each(LANGS)('%s: the banned list still flags the wording this pack retired', (lang) => {
    // Non-vacuity. A green run above means nothing unless this is green too.
    for (const retired of RETIRED[lang]) {
      expect(bannedHits(lang, retired).length, `${lang} control: "${retired}"`).toBeGreaterThan(0);
    }
  });

  it('the two chips the card named read as UI, not as automation', () => {
    const zh = chipsOf('zh')!;
    // 「状态流转」 → a board grouped by status; 「低库存预警」 → a filtered view.
    expect(zh.buildFlow).toContain('看板');
    expect(zh.buildFlow).not.toContain('流转');
    expect(zh.buildInventory).toContain('视图');
    expect(zh.buildInventory).not.toContain('预警');
  });
});
