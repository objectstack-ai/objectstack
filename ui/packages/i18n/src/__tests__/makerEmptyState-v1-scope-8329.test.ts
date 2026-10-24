/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8329 — the maker's EMPTY-STATE prose, third and last member of the
 * ADR-0112 v1 boundary family on the build surface:
 *
 *   1. the five from-scratch start chips  — cloud#1984 / objectui#7710
 *   2. the four edit-mode start chips     — objectui#7709
 *   3. the model's own closing suggestions— cloud#2020 / cloud#2022
 *   4. ⬅ THIS: the two sentences ABOVE all of them
 *
 * `agentEmptyState()` renders a title and a description under the build
 * surface's heading. The description is the FIRST sentence a new user reads on
 * that page, and both variants were promising capabilities v1 refuses:
 *
 *   build.description   'Describe an app or workflow in plain language — I draft
 *                        the objects, screens and automations, …'
 *   editApp.description '… add a field, object, view or automation, …'
 *
 * v1 has no flows, actions or schedules (`V1_METADATA_TYPES` in cloud
 * `service-ai-studio/src/authoring-whitelist.ts`), so a user who took either
 * sentence at its word was refused outright — and unlike a chip, this one is
 * read before anything else on the screen. Both now name only what v1 builds.
 *
 * Same three-part shape as the 1984 / 7709 suites, and part 3 is what keeps the
 * other two honest:
 *
 *  1. Every shipped pack defines both descriptions, non-empty.
 *  2. Neither description in any pack uses vocabulary that promises autonomous
 *     behaviour, scanned with that pack's OWN banned list — an English-only
 *     scan would have declared the five non-Latin packs clean without reading a
 *     character of them (AGENTS.md i18n forensics rule). This is not
 *     hypothetical here: all ten packs shipped a translated violation, so the
 *     issue's premise that "only en and zh have this key" was wrong.
 *  3. A NON-VACUITY control: each pack's banned list is re-run against the two
 *     sentences that pack actually shipped before this card, and must flag both.
 *
 * ⚠️ Scope note — this suite guards the AI-AUTHORING promise, not the word
 * "automation". The platform's manual automation surfaces are real and are
 * deliberately NOT covered: `home.build.subtitle` (its card opens Studio, which
 * genuinely authors flows), `engine.studio.landing.description`,
 * `packagedAutomation.*`, the marketplace
 * `automation` category, and the approvals / flow-runner groups.
 *
 * REVERT the wording (and relax this suite) when ADR-0112 v2 re-adds flows and
 * actions — same line of the roadmap as the chips. RETIRED below is where each
 * pack's automation sentence is kept.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** The two descriptions `agentEmptyState()` can render on the build surface. */
const VARIANTS = ['build', 'editApp'] as const;
type Variant = (typeof VARIANTS)[number];

/** The pack's empty-state block, reached through the shape the call site reads. */
const emptyOf = (lang: LocaleCode) =>
  (
    builtInLocales[lang] as {
      console?: {
        ai?: { empty?: Record<string, { title?: string; description?: string }> };
      };
    }
  ).console?.ai?.empty;

const descriptionOf = (lang: LocaleCode, v: Variant) => emptyOf(lang)?.[v]?.description;

/**
 * Vocabulary that promises the product will ACT on its own. The automation half
 * is the `makerStartChips-v1-scope-1984` / `makerEditChips-v1-scope-7709` list
 * verbatim — one v1 boundary, three families reading it. Added here: the
 * "workflow" noun each pack used in the RETIRED build sentence, which the chip
 * lists did not all need (`流程` for zh, whose chip wording said `流转`).
 *
 * Stems, not whole words, and substring matching with no ASCII word classes —
 * five of the ten packs are non-Latin and CJK has no word boundaries.
 */
const BANNED: Record<LocaleCode, readonly string[]> = {
  en: ['alert', 'remind', 'notif', 'automat', 'workflow', 'trigger', 'schedule', 'approv'],
  zh: ['提醒', '预警', '警报', '自动', '流转', '流程', '工作流', '通知', '触发', '定时', '审批'],
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
 * The two sentences each pack shipped BEFORE this card. Kept as the control
 * sample AND as the record of what ADR-0112 v2 restores — not as a fixture to
 * revert to today.
 */
const RETIRED: Record<LocaleCode, Record<Variant, string>> = {
  en: {
    build: 'Describe an app or workflow in plain language — I draft the objects, screens and automations, then you review and publish.',
    editApp: 'What would you like to change? I’ll modify this app in place — add a field, object, view or automation, or adjust what’s already there.',
  },
  zh: {
    build: '用自然语言描述一个应用或流程 —— 我会起草对象、界面和自动化，随后你审阅并发布。',
    editApp: '想改点什么？我会就地修改这个应用 —— 加字段、对象、视图或自动化，或调整已有内容。',
  },
  de: {
    build: 'Beschreiben Sie eine App oder einen Workflow in einfachen Worten — ich entwerfe die Objekte, Bildschirme und Automatisierungen, dann prüfen und veröffentlichen Sie.',
    editApp: 'Was möchten Sie ändern? Ich passe diese App direkt an — ein Feld, Objekt, eine Ansicht oder Automatisierung hinzufügen oder Vorhandenes anpassen.',
  },
  fr: {
    build: 'Décrivez une application ou un flux de travail en langage courant — je rédige les objets, les écrans et les automatisations, puis vous vérifiez et publiez.',
    editApp: "Que souhaitez-vous changer ? Je modifie cette application sur place — ajouter un champ, un objet, une vue ou une automatisation, ou ajuster l'existant.",
  },
  es: {
    build: 'Describa una aplicación o un flujo de trabajo en lenguaje natural — yo redacto los objetos, las pantallas y las automatizaciones, y luego usted revisa y publica.',
    editApp: '¿Qué desea cambiar? Modifico esta aplicación sobre la marcha — añadir un campo, un objeto, una vista o una automatización, o ajustar lo que ya existe.',
  },
  pt: {
    build: 'Descreva um aplicativo ou fluxo de trabalho em linguagem simples — eu rascunho os objetos, telas e automações, e então você revisa e publica.',
    editApp: 'O que você quer mudar? Eu altero este aplicativo no lugar — adicionar um campo, objeto, visão ou automação, ou ajustar o que já existe.',
  },
  ru: {
    build: 'Опишите приложение или процесс обычными словами — я подготовлю объекты, экраны и автоматизации, а вы проверите и опубликуете.',
    editApp: 'Что нужно изменить? Я изменю это приложение на месте — добавлю поле, объект, представление или автоматизацию либо скорректирую существующее.',
  },
  ja: {
    build: 'アプリやワークフローを普通の言葉で説明してください — オブジェクト、画面、自動化を下書きしますので、確認して公開してください。',
    editApp: '何を変更しますか？このアプリをその場で変更します — 項目、オブジェクト、ビュー、自動化の追加や、既存部分の調整ができます。',
  },
  ko: {
    build: '앱이나 워크플로를 일상 언어로 설명해 주세요 — 객체, 화면, 자동화를 초안으로 만들어 드리면 검토 후 게시하시면 됩니다.',
    editApp: '무엇을 바꿀까요? 이 앱을 그 자리에서 수정합니다 — 필드, 객체, 뷰, 자동화를 추가하거나 기존 내용을 조정할 수 있습니다.',
  },
  ar: {
    build: 'صف تطبيقًا أو سير عمل بلغة بسيطة — سأعدّ مسودة الكائنات والشاشات والأتمتة، ثم تراجعها وتنشرها.',
    editApp: 'ما الذي تريد تغييره؟ سأعدّل هذا التطبيق في مكانه — إضافة حقل أو كائن أو عرض أو أتمتة، أو تعديل ما هو موجود.',
  },
};

describe('maker empty state — every shipped pack carries both descriptions (objectui#8329)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s defines a non-empty description for both variants', (lang) => {
    const block = emptyOf(lang);
    expect(block, `${lang} has no console.ai.empty block`).toBeTruthy();
    for (const v of VARIANTS) {
      const d = descriptionOf(lang, v);
      expect(typeof d, `${lang}.empty.${v}.description`).toBe('string');
      expect(d!.trim().length, `${lang}.empty.${v}.description is empty`).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)('%s still carries the titles the two variants render', (lang) => {
    // The fix touched descriptions only; a pack that lost a title would fall
    // back to the English defaultValue without any test noticing.
    const block = emptyOf(lang)!;
    expect(block.build?.title?.trim()).toBeTruthy();
    expect(block.editApp?.title?.trim()).toBeTruthy();
  });
});

describe('maker empty state — neither description promises autonomous behaviour (objectui#8329)', () => {
  it.each(LANGS)("%s: neither description uses that pack's automation vocabulary", (lang) => {
    for (const v of VARIANTS) {
      const d = descriptionOf(lang, v)!;
      expect(bannedHits(lang, d), `${lang}.empty.${v}.description: "${d}"`).toEqual([]);
    }
  });

  it.each(LANGS)('%s: the banned list still flags BOTH sentences this pack retired', (lang) => {
    // Non-vacuity. A green run above means nothing unless this is green too —
    // and it must flag both variants, not just the louder `build` one.
    for (const v of VARIANTS) {
      const retired = RETIRED[lang][v];
      expect(
        bannedHits(lang, retired).length,
        `${lang} control (${v}): "${retired}"`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)('%s: the description actually changed from what it retired', (lang) => {
    // Guards the reverse mistake of a pack being "fixed" by copying its own old
    // string back in during a merge.
    for (const v of VARIANTS) {
      expect(descriptionOf(lang, v), `${lang}.${v}`).not.toBe(RETIRED[lang][v]);
    }
  });
});

describe('maker empty state — the replacement names v1 capabilities (objectui#8329)', () => {
  it('en/zh build: offers an app (not a workflow) and sample data', () => {
    const en = descriptionOf('en', 'build')!;
    expect(en).toMatch(/describe an app/i);
    expect(en).toContain('sample data');

    const zh = descriptionOf('zh', 'build')!;
    expect(zh).toContain('示例数据');
    expect(zh).not.toContain('或流程');
  });

  it('en/zh editApp: offers a dashboard in the slot automation used to hold', () => {
    expect(descriptionOf('en', 'editApp')!).toContain('dashboard');
    expect(descriptionOf('zh', 'editApp')!).toContain('仪表盘');
  });

  it('en editApp keeps the in-place framing its own unit test asserts', () => {
    // `packages/app-shell/src/console/ai/__tests__/editModeEmptyState.test.ts`
    // matches /change/i and /in place/i against the defaultValue; the pack and
    // that fallback must not drift apart.
    const en = descriptionOf('en', 'editApp')!;
    expect(en).toMatch(/change/i);
    expect(en).toMatch(/in place/i);
  });
});
