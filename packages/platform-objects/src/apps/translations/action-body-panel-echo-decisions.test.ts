// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 5 — the DECISION LEDGER for the ACTION panel's body/ai en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for ONE panel family, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the four earlier rounds of
// this card extended (`object-field-editor-panel-`, `page-interface-panel-`,
// `dataset-panel-` and `field-panel-echo-decisions.test.ts`): one row per
// string leaf, each carrying its verdict per locale, the reason it was
// reached, and the `en` source it was judged against.
//
// ## The family, and why it and not the other 12-leaf row
//
// Two rows of round 5's table tie at 12 leaves: the five children of
// `action.fields.body` plus `action.fields.ai` (6 keys / 12 leaves), and six
// bare type-display pairs (`seed`/`mapping`/`api`/`doc`/`book`/`capability`,
// 6 keys / 12 leaves). The tie is broken here, in writing:
//
//   1. THE INSTRUMENT SURVIVES ONLY ONE OF THEM. The card's second property is
//      a population DERIVED from `en` with a dark control. `action` is one
//      panel, so that is one derivation over one metadata type and the dark
//      control has something to exclude. The six type-display pairs are six
//      unrelated types with no panel around them — the derivation degenerates
//      into six one-entry lookups and the control has nothing to be dark
//      about.
//   2. EVIDENCE DENSITY FORCES PER-LEAF WORK. Four of these six keys have an
//      authored twin at a byte-identical `en` one metadata type over
//      (`hook.fields.body.*`), one has a twin that is ITSELF an echo, and one
//      has no twin at all. A family that cannot be answered wholesale is
//      exactly what this card's prohibition asks for.
//   3. THE #19430 TRAP IS LIVE HERE, on three of the twelve leaves, and is
//      discharged at the schema below rather than deferred.
//   4. LEAVING IT COSTS MORE. A bare `<type>.label` pair has no siblings, so
//      deferring it leaves nothing half-done; deferring this one leaves the
//      `action` panel's Behavior and Advanced sections reading half Chinese
//      and half English around a single composite.
//
//   => decided here: 6 keys · 12 string leaves · 3 locales = 36 decisions.
//
// The card's extension rule also takes in the SECTION HEADING each key sits
// under and the type's own display pair. Both were ALREADY authored here —
// `action.label` is 操作 / アクション / Acción, and all four
// `action.sections.*` label+description pairs carry their own text in every
// locale — so the family adds no leaf there. That is a measurement, not an
// omission: the derived pin below walks all 79 string leaves of the `action`
// entry and requires every one of them to be non-echoing in every locale.
//
// ## THE CONTROL THIS PANEL SUPPLIES: the same SCHEMA rendered by two forms
//
// `actionForm` and `hookForm` declare the SAME composite over the SAME schema
// — `HookBodySchema` (`packages/spec/src/data/hook-body.zod.ts`), five
// children with identical field names and byte-identical `helpText` sources.
// Four of the five are authored on the `hook` panel and were echoing on this
// one. So the precedent is not a same-string match found elsewhere in the
// catalog: it is the other rendering of this very schema key.
//
// The fifth, `memoryMb`, is an echo on BOTH panels — the twin rule supplies
// nothing there, and that row says so instead of borrowing evidence it does
// not have.
//
// ## The #19430 trap, met and checked AT THE SCHEMA before a word was rendered
//
//   • `body.language.helpText` names `expression` and `js`. They are the two
//     discriminator values of `HookBodySchema` — `z.literal('expression')` and
//     `z.literal('js')`. Kept English.
//   • `body.capabilities.helpText` names `api.read`, `api.write`,
//     `crypto.uuid` and `log` — four of the five members of the
//     `HookBodyCapability` z.enum (`api.transaction` is the fifth and the
//     prose names it not at all). Kept English, as is `ctx`.
//   • `ai.helpText` names `ai.exposed=true` and `ai.description`. `exposed`
//     and `description` are `ActionAiSchema`'s two canonical keys
//     (`packages/spec/src/ui/action.zod.ts`), a strictObject that declares
//     `enabled`/`enable`/`aiEnabled`/`expose`/`visible` as ALIASES of
//     `exposed` — so a rendered spelling is a spelling the schema refuses.
//     Kept English, and `40` stays a numeral because it is `.min(40)`.
//
// ⭐ Round 4 recorded that a precedent answers only the question it actually
// contains: its twin settled the prose and named no token, so the schema had
// to settle the tokens. THIS family's twin settles BOTH halves for `language`
// and `capabilities` — `hook.fields.body.language.helpText` and
// `.capabilities.helpText` are authored AND they name the tokens AND they keep
// them English. Same rule, opposite reading: the twin is sufficient here
// precisely because the question is inside it. For `ai.helpText` there is no
// twin at all and only the schema answers.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle, compare each
// `.label` leaf against `en`. On base 4045781fa, before this change:
//
//   en string leaves / `.label` leaves            893 / 538
//   POSITIVE CONTROL — labels genuinely translated 509 (zh-CN) · 493 · 493
//   label keys echoing in ALL THREE locales          29 ⇒ 87 `.label` leaves
//
// After: 23 keys / 69 `.label` leaves, control 515 · 499 · 499 — echoes down 6
// and the control up 6, same population, same run. A parser matching too
// broadly cannot produce that agreement. (⚠️ 87 and 69 count `.label` leaves;
// the DECIDABLE sibling remainder — label plus its `helpText`/`description` —
// is a different question and reads 51 before, 39 after.)
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf
// is still a byte copy of the source revision. All 12 leaves decided here
// carried one in all three locales; `pnpm i18n:extract` dropped exactly those
// 36 rows and added none, which is asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { hookForm } from '@objectstack/spec/data';
import { actionForm } from '@objectstack/spec/ui';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';

const TRANSLATED_LOCALES: ReadonlyArray<readonly [string, Record<string, any>]> = [
  ['zh-CN', zhCNMetadataForms as Record<string, any>],
  ['ja-JP', jaJPMetadataForms as Record<string, any>],
  ['es-ES', esESMetadataForms as Record<string, any>],
];

const PROVENANCE: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['zh-CN', zhCNGeneratedSourceHashes],
  ['ja-JP', jaJPGeneratedSourceHashes],
  ['es-ES', esESGeneratedSourceHashes],
];

/** `translate` — the echo was an unauthored fill. `echo` — the English IS the rendering. */
type Verdict = 'translate' | 'echo';

interface Decision {
  /**
   * `type` for the metadata type's own display pair, `fields` for a form
   * field, `sections` for a section heading. Every row this round is `fields`;
   * the other two are carried because the derived population below reaches
   * them and a later round on this panel would need them.
   */
  scope: 'type' | 'fields' | 'sections';
  /** The bundle key under `action.<scope>` (`action` itself for `type`). */
  key: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'helpText' | 'description';
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle, so a reworded source reds this file instead of leaving a decision
   * standing over text nobody judged.
   */
  en: string;
  /** The verdict per translated locale. */
  verdict: Readonly<Record<string, Verdict>>;
  /** Why — recorded for `translate` as much as for `echo`. */
  reason: string;
  /** Required for every `echo` verdict: why the English is right in THAT locale. */
  departures?: Readonly<Record<string, string>>;
}

const ALL_TRANSLATE: Readonly<Record<string, Verdict>> = {
  'zh-CN': 'translate',
  'ja-JP': 'translate',
  'es-ES': 'translate',
};

const DECISIONS: readonly Decision[] = [
  {
    scope: 'fields',
    key: 'body.language',
    prop: 'label',
    en: 'Language',
    verdict: ALL_TRANSLATE,
    reason:
      'THE AUTHORED TWIN AT THE SAME SCHEMA KEY, byte-identical en: hook.fields.body.language.label is 语言 / 言語 / Idioma. hookForm and actionForm declare the same composite over HookBodySchema (packages/spec/src/data/hook-body.zod.ts) — the same five children, the same field names, the same helpText sources — so this is not a same-string precedent found elsewhere in the catalog but the OTHER rendering of this very schema key. Copied verbatim, which is also the invariant this file goes on to assert: one schema key, one rendering, across both panels that declare it.',
  },
  {
    scope: 'fields',
    key: 'body.language',
    prop: 'helpText',
    en: 'expression = pure formula; js = sandboxed JavaScript',
    verdict: ALL_TRANSLATE,
    reason:
      'THE FIRST #19430 TRAP LEAF OF THIS FAMILY, and the schema was read before a word was rendered. `expression` and `js` are the two DISCRIMINATOR values of HookBodySchema — z.literal("expression") on ExpressionBodySchema and z.literal("js") on ScriptBodySchema — so rendering either as a word tells an author in their own language to write a value the discriminated union refuses. KEPT ENGLISH. ⭐ Contrast round 4: there the authored twin named no token and therefore could not settle the token half. Here it does — hook.fields.body.language.helpText is authored AND names both tokens AND keeps both English (expression = 纯公式；js = 沙箱 JavaScript and its ja/es) — so the twin is sufficient on both halves, because the question is inside the precedent. Copied verbatim.',
  },
  {
    scope: 'fields',
    key: 'body.source',
    prop: 'label',
    en: 'Source',
    verdict: ALL_TRANSLATE,
    reason:
      'DECIDED BETWEEN THREE AUTHORED SENSES OF ONE WORD, not by string match. This catalog answers the bare word `Source` three ways: 源码 / Código fuente (a CODE source — hook.fields.body.source.label, the twin at this schema key), 数据来源 / Origen de datos (a DATA source — page.fields.interfaceConfig.source.label and dataset.sections.source.label), and 来源 / Origen (provenance — sys_metadata.fields.source.label in the objects catalog). This key is ScriptBodySchema.source, a function-body string, so it takes the first; ja-JP renders all three ソース, so no choice arises there and the twin is copied unchanged.',
  },
  {
    scope: 'fields',
    key: 'body.source',
    prop: 'helpText',
    en: 'Function body source — no top-level imports',
    verdict: ALL_TRANSLATE,
    reason:
      'The twin hook.fields.body.source.helpText is authored over a byte-identical en: 函数体源码——禁止顶层 import / 関数 body ソース — トップレベル import 不可 / Código fuente del body de la función — sin imports de nivel superior. `import` is KEPT ENGLISH in all three — it is the JavaScript keyword the sandbox rejects, named as `import` in ScriptBodySchema\'s own forbidden list, not an English noun. ⚠️ A per-locale departure copied rather than re-decided: ja-JP and es-ES keep the spec key `body` inside the prose while zh-CN folds it into 函数体. That asymmetry is the twin\'s judgement and this row does not disturb it.',
  },
  {
    scope: 'fields',
    key: 'body.capabilities',
    prop: 'label',
    en: 'Capabilities',
    verdict: ALL_TRANSLATE,
    reason:
      'THE AUTHORED TWIN AT THE SAME SCHEMA KEY, byte-identical en: hook.fields.body.capabilities.label is 功能 / 機能 / Capacidades. ⚠️ Recorded rather than improved: zh-CN 功能 and ja-JP 機能 read "feature", while the value is a capability TOKEN from the HookBodyCapability enum, and the catalog\'s other `Capabilities` (object.sections.capabilities.label, the capability CHECKBOXES) is 功能开关 — a third sense. The twin is the landed answer for this exact schema key, and diverging here to improve the word would BE the defect the cross-panel invariant below guards. Rewording it is a hook-family edit, not an action-family one.',
  },
  {
    scope: 'fields',
    key: 'body.capabilities',
    prop: 'helpText',
    en: 'Allowed ctx APIs (api.read, api.write, crypto.uuid, log, …)',
    verdict: ALL_TRANSLATE,
    reason:
      'THE SECOND #19430 TRAP LEAF. `api.read`, `api.write`, `crypto.uuid` and `log` are four of the five members of HookBodyCapability, a z.enum (hook-body.zod.ts) — `api.transaction` is the fifth and this prose names it not at all. KEPT ENGLISH, as is `ctx`, the sandbox binding an author writes in the body. The twin hook.fields.body.capabilities.helpText is authored and already keeps all four, so this row copies an existing decision about this exact string. ⚠️ Per-locale departure copied from it: zh-CN renders the trailing ellipsis as 等 and uses the ideographic comma 、 between tokens, while ja-JP and es-ES keep `…` and ASCII commas.',
  },
  {
    scope: 'fields',
    key: 'body.timeoutMs',
    prop: 'label',
    en: 'Timeout Ms',
    verdict: ALL_TRANSLATE,
    reason:
      'THE en IS NOT AUTHORED ENGLISH — it is the extractor\'s humanize of the camelCase schema key `timeoutMs`, which is why it reads "Timeout Ms" rather than "Timeout (ms)". The authored twin hook.fields.body.timeoutMs.label renders the CONCEPT and moves the unit into a parenthetical instead of transliterating the mechanical title: 超时（毫秒） / タイムアウト（ms） / Tiempo de espera (ms). Copied verbatim — and that shape is the only precedent the two rows below have.',
  },
  {
    scope: 'fields',
    key: 'body.timeoutMs',
    prop: 'helpText',
    en: 'Per-invocation timeout (ms)',
    verdict: ALL_TRANSLATE,
    reason:
      'The twin hook.fields.body.timeoutMs.helpText is authored over a byte-identical en: 单次调用超时时间（毫秒） / 呼び出しごとのタイムアウト（ms） / Tiempo de espera por invocación (ms). Copied verbatim. The unit `ms` is kept as a unit in ja-JP and es-ES and spelled 毫秒 in zh-CN, which is the twin\'s per-locale judgement and not this round\'s to re-open.',
  },
  {
    scope: 'fields',
    key: 'body.memoryMb',
    prop: 'label',
    en: 'Memory Mb',
    verdict: ALL_TRANSLATE,
    reason:
      '⛔ THE ONE KEY IN THIS FAMILY WITH NO AUTHORED TWIN: hook.fields.body.memoryMb.label is ITSELF an en-echo in all three locales — the same schema key, the same mechanical en, unauthored on BOTH panels. The twin rule is evidence only while the twin is authored, and here it supplies none; this row says so rather than borrowing evidence it does not have. Decided instead from the SIBLING key one row up, whose twin IS authored: "Timeout Ms" → 超时（毫秒） / タイムアウト（ms） / Tiempo de espera (ms) is concept + unit in parentheses, reproduced exactly as 内存（MB） / メモリ（MB） / Memoria (MB). Nothing was added that the sibling\'s rendering does not have, and `MB` stays a unit symbol in every locale.',
  },
  {
    scope: 'fields',
    key: 'body.memoryMb',
    prop: 'helpText',
    en: 'Per-invocation memory cap (MB, max 256)',
    verdict: ALL_TRANSLATE,
    reason:
      'No twin, for the reason the row above records. The sentence frame is the sibling\'s authored twin hook.fields.body.timeoutMs.helpText — 单次调用…（毫秒） / 呼び出しごとの…（ms） / … por invocación (ms) — and `cap` takes 上限 / 上限 / Límite. ⭐ `256` is KEPT AS A NUMERAL because it is ScriptBodySchema\'s .max(256): it is the number an author is measured against, not an English word. `max` takes this catalog\'s own authored answers — 最大 / 最大 / máx. from object.fields.fields.maxLength.helpText (最大字符数 / 最大文字数 / Máximo de caracteres) and action.fields.params.maxSize.label (最大大小（字节） / 最大サイズ（バイト） / Tamaño máximo (bytes)).',
  },
  {
    scope: 'fields',
    key: 'ai',
    prop: 'label',
    en: 'Ai',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE LEAF THAT SHOWS WHY THIS CARD REFUSES A WHOLESALE ANSWER. The en is the extractor\'s humanize of the two-letter key `ai`, so the obvious repair is the case fix "Ai" → "AI" — which would differ from the source in bytes, pass the echo predicate in every locale, and tell a zh-CN author exactly as much as the echo did. REJECTED as a phantom translation. The concept is named, in all three locales, by the authored section description this very field sits under: action.sections.advanced.description is AI 暴露与 API 请求体结构 / AI 公開と API リクエスト形状。 / Exposición a IA y forma de la solicitud API. — the authored twin ONE ENTRY UP THE SAME PANEL, which is the evidence shape the four earlier rounds leaned on. ⚠️ Per-locale departure taken from it: es-ES renders the acronym as IA, zh-CN and ja-JP keep AI.',
  },
  {
    scope: 'fields',
    key: 'ai',
    prop: 'helpText',
    en: 'AI exposure (opt-in): set ai.exposed=true and write ai.description (≥40 chars) to make this callable by agents.',
    verdict: ALL_TRANSLATE,
    reason:
      'THE THIRD #19430 TRAP LEAF, and the only leaf in this family with no twin of any kind — hookForm declares no `ai` field. Read at the schema: ActionAiSchema (packages/spec/src/ui/action.zod.ts) is a strictObject whose canonical keys are `exposed` (z.boolean().default(false)) and `description` (z.string().min(40)), and it declares enabled/enable/aiEnabled/expose/visible as ALIASES of `exposed` — so a rendered spelling is precisely a spelling the schema refuses. `ai.exposed=true` and `ai.description` are KEPT ENGLISH VERBATIM and `40` stays a numeral because it is that .min(40). Everything around them is rendered from this catalog\'s own authored answers: `AI exposure` from the section description one entry up (row above), `chars` from 字符 / 文字 / caracteres (object.fields.fields.maxLength.helpText), and `call` from this very panel\'s authored 调用 / 呼び出す / llamar (action.fields.target.helpText). `agents` takes 代理 / エージェント / agente: among en leaves containing the word "agent", zh-CN renders it 代理 in 11 and 智能体 in 3, and the type\'s own display name agent.label is AI 代理, so the minority 智能体 (app.fields.defaultAgent.*) is DELIBERATELY NOT USED. ⚠️ `opt-in` is the one term in this family chosen with no precedent in either catalog — 需显式开启 / オプトイン / voluntaria.',
  },
];

function leafOf(bundle: Record<string, any>, d: Decision): unknown {
  const action = bundle.action;
  return d.scope === 'type' ? action?.[d.prop] : action?.[d.scope]?.[d.key]?.[d.prop];
}

/** The provenance-table key for a decided leaf. */
function provenanceKey(d: Decision): string {
  return d.scope === 'type'
    ? `metadataForms.action.${d.prop}`
    : `metadataForms.action.${d.scope}.${d.key}.${d.prop}`;
}

/** The dotted id a decision is reported under. */
function idOf(d: Decision): string {
  return d.scope === 'type' ? `action.${d.prop}` : `action.${d.scope}.${d.key}.${d.prop}`;
}

/**
 * Every `echo` verdict that carries no per-locale departure reason. A predicate
 * rather than an inlined loop so the suite can prove it FIRES — with every
 * verdict in this round `translate`, asserting it over DECISIONS alone would
 * evaluate nothing.
 */
function undeclaredEchoes(rows: readonly Decision[]): string[] {
  const bad: string[] = [];
  for (const d of rows) {
    for (const [locale, verdict] of Object.entries(d.verdict)) {
      if (verdict !== 'echo') continue;
      if ((d.departures?.[locale] ?? '').length <= 40) bad.push(`${locale} ${idOf(d)}`);
    }
  }
  return bad;
}

interface PanelLeaf {
  scope: 'type' | 'fields' | 'sections';
  key: string;
  prop: string;
  en: string;
}

/** Every string leaf of one metadata type's panel, DERIVED from the `en` catalog. */
function panelLeaves(type: string): PanelLeaf[] {
  const out: PanelLeaf[] = [];
  const entry = (enMetadataForms as Record<string, any>)[type] ?? {};
  for (const [prop, value] of Object.entries(entry)) {
    if (typeof value === 'string') out.push({ scope: 'type', key: type, prop, en: value });
  }
  for (const scope of ['fields', 'sections'] as const) {
    for (const [key, sub] of Object.entries(entry[scope] ?? {})) {
      if (!sub || typeof sub !== 'object') continue;
      for (const [prop, value] of Object.entries(sub as Record<string, unknown>)) {
        if (typeof value === 'string') out.push({ scope, key, prop, en: value });
      }
    }
  }
  return out;
}

const PANEL_LEAVES = panelLeaves('action');

function liveLeaf(bundle: Record<string, any>, type: string, l: PanelLeaf): unknown {
  const entry = bundle[type];
  return l.scope === 'type' ? entry?.[l.prop] : entry?.[l.scope]?.[l.key]?.[l.prop];
}

/**
 * The two halves of the blind spot, re-derived from a form by the rule
 * `repeater-row-properties.test.ts` uses — a field that enumerates `fields` is
 * walked for its children ONLY when `type === 'repeater'`.
 *
 * `covered` is what that pin sees on the form; `skipped` is what it does not,
 * and the extractor emits catalog keys for BOTH because it walks a form
 * field's declared `fields` whatever the declared type is.
 */
function enumeratedChildren(form: unknown): { covered: string[]; skipped: string[] } {
  const covered: string[] = [];
  const skipped: string[] = [];
  const walk = (fields: any[] | undefined, prefix = ''): void => {
    for (const f of fields ?? []) {
      if (!f || typeof f !== 'object' || !f.field) continue;
      const path = prefix ? `${prefix}.${f.field}` : String(f.field);
      if (Array.isArray(f.fields)) {
        const sink = f.type === 'repeater' ? covered : skipped;
        for (const child of f.fields) if (child?.field) sink.push(`${path}.${child.field}`);
        walk(f.fields, path);
      }
    }
  };
  walk(((form as any).sections ?? []).flatMap((s: any) => s.fields ?? []));
  return { covered, skipped };
}

const ACTION_ENUMERATED = enumeratedChildren(actionForm);
const HOOK_ENUMERATED = enumeratedChildren(hookForm);

/** The five `HookBodySchema` children both forms declare. */
const SHARED_BODY_CHILDREN = ['language', 'source', 'capabilities', 'timeoutMs', 'memoryMb'] as const;

describe('#19403 round 5 — the ledger itself (controls before verdicts)', () => {
  it('decides every echoing string leaf of the 6 keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 6 keys, 12 leaves, three
    // locales, 36 decisions.
    expect(DECISIONS.length).toBe(12);
    expect(new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`)).size).toBe(6);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(36);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
    // Every decided key is decided on BOTH of its string leaves — a panel
    // whose field name is translated and whose tooltip is not is the same
    // defect half fixed.
    for (const id of new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`))) {
      expect(
        DECISIONS.filter((d) => `${d.scope}.${d.key}` === id)
          .map((d) => d.prop)
          .sort()
          .join('+'),
        `${id} is decided on one leaf only`,
      ).toBe('helpText+label');
    }
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        leafOf(enMetadataForms as Record<string, any>, d),
        `en ${idOf(d)} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must flag all 12 rows, or a green
    // verdict run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${idOf(d)} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Every verdict in this round is `translate`, so the rule has nothing to
    // evaluate over DECISIONS. Assert it there AND prove the predicate fires,
    // or the requirement is a phantom check that deleting would leave green.
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no reason').toEqual([]);

    const synthetic: Decision = {
      scope: 'fields',
      key: 'body.language',
      prop: 'label',
      en: 'Language',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN action.fields.body.language.label']);
    expect(
      undeclaredEchoes([
        {
          ...synthetic,
          departures: {
            'zh-CN': 'A departure reason long enough to satisfy the rule, standing in for a real judgement.',
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('#19403 round 5 — the catalogs hold what the ledger decided', () => {
  for (const [locale, forms] of TRANSLATED_LOCALES) {
    it(`${locale}: every decided leaf matches its verdict`, () => {
      for (const d of DECISIONS) {
        const id = `${locale} ${idOf(d)}`;
        const value = leafOf(forms, d);
        expect(typeof value, `${id} is missing from the catalog`).toBe('string');
        expect((value as string).length, `${id} is empty`).toBeGreaterThan(0);
        if (d.verdict[locale] === 'translate') {
          expect(value, `${id} reads its en source again — the decision was that this echo is a fill`).not.toBe(d.en);
        } else {
          expect(value, `${id} is a declared echo and must stay the en source`).toBe(d.en);
        }
      }
    });
  }

  it('the machine tokens the ledger decided to KEEP are still English in every locale', () => {
    // The #19430 half, asserted rather than described. These are enum members,
    // a discriminated-union discriminator, two canonical spec keys, a reserved
    // word and a schema bound; a later reword that renders one of them writes
    // metadata the schema refuses, or misstates a limit.
    const kept: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      ['body.language', 'helpText', ['expression', 'js']],
      ['body.source', 'helpText', ['import']],
      ['body.capabilities', 'helpText', ['ctx', 'api.read', 'api.write', 'crypto.uuid', 'log']],
      ['body.memoryMb', 'helpText', ['256']],
      ['ai', 'helpText', ['ai.exposed=true', 'ai.description', '40']],
    ];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const [key, prop, tokens] of kept) {
        const text = forms.action?.fields?.[key]?.[prop];
        expect(typeof text, `${locale} action.fields.${key}.${prop}`).toBe('string');
        for (const token of tokens) {
          expect(
            (text as string).includes(token),
            `${locale} action.fields.${key}.${prop} no longer carries the token ${token} verbatim`,
          ).toBe(true);
        }
      }
    }
    // Dark — the same lookup with tokens none of them carries must NOT pass,
    // so a green above cannot come from an `includes` that matches anything.
    // `api.transaction` is a REAL HookBodyCapability member that this prose
    // deliberately does not name, which makes it the sharpest negative here.
    const sample = (zhCNMetadataForms as Record<string, any>).action?.fields?.['body.capabilities']
      ?.helpText as string;
    expect(sample.includes('api.transaction')).toBe(false);
    expect(sample.includes('crypto.hash')).toBe(false);
  });
});

describe('#19403 round 5 — the provenance table agrees these leaves are now authored', () => {
  // A second, independent witness to the same fact, from a table nobody edits
  // by hand. An entry exists exactly while a leaf is still a byte copy of the
  // source revision, so re-filling a decided leaf and re-running the extract
  // brings its row back and reds this block — even in the locale where no
  // second locale exists to disagree with it. It fires on a different trigger
  // than the catalog assertion above (a re-fill FOLLOWED BY an extract, rather
  // than the re-fill itself), which is what makes it a witness and not a
  // restatement.
  for (const [locale, table] of PROVENANCE) {
    it(`${locale}: no decided leaf is still recorded as an extractor fill`, () => {
      // Lit — the table really loaded, so "no entry" cannot pass by the import
      // having come back empty.
      expect(Object.keys(table).length, `${locale} provenance table is empty`).toBeGreaterThan(100);
      const stillFilled = DECISIONS.filter((d) => table[provenanceKey(d)] !== undefined).map(idOf);
      expect(stillFilled, 'these leaves are still byte copies of their source revision').toEqual([]);
    });

    it(`${locale}: the provenance lookup can say "still a fill"`, () => {
      // Dark. The verdict above is a run of `undefined`s, which is also what a
      // misspelt key shape returns. So take a key the table DOES hold, prove it
      // has the very shape `provenanceKey` composes, and prove the same lookup
      // finds it. Deliberately matched by PATTERN rather than pinned to a
      // family, so a later round of this card cannot red this control by
      // fixing one.
      const sample = Object.keys(table).find((k) => /^metadataForms\.[^.]+\.(fields|sections)\..+\.[^.]+$/.test(k));
      expect(sample, `${locale} provenance table records no metadata-form leaf`).toBeTruthy();
      const parts = /^metadataForms\.([^.]+)\.(fields|sections)\.(.+)\.([^.]+)$/.exec(sample!);
      expect(parts, 'the table key does not decompose').toBeTruthy();
      const [, type, scope, key, prop] = parts!;
      expect(`metadataForms.${type}.${scope}.${key}.${prop}`, 'composing the key back must reproduce it').toBe(sample);
      expect(table[sample!], 'the lookup this file performs finds a key the table holds').toBeTruthy();
      // And the composer under test builds exactly those two templates.
      expect(provenanceKey({ ...DECISIONS[0], scope: 'fields', key: 'k', prop: 'label' })).toBe(
        'metadataForms.action.fields.k.label',
      );
      expect(provenanceKey({ ...DECISIONS[0], scope: 'type', key: 'action', prop: 'label' })).toBe(
        'metadataForms.action.label',
      );
    });
  }
});

describe('#19403 round 5 — the panel population, DERIVED (the pin no census had)', () => {
  it('the derivation reaches this panel, and only this panel', () => {
    // Lit — floors, not exact counts, so a key added to the action form is
    // caught by the echo rule below rather than by a number nobody can
    // interpret. Measured on base 4045781fa: 79 string leaves on the `action`
    // entry (the 12 decided here plus 67 already-authored neighbours).
    expect(PANEL_LEAVES.length).toBeGreaterThan(70);
    expect(new Set(PANEL_LEAVES.map((l) => `${l.scope}.${l.key}`)).size).toBeGreaterThan(40);
    for (const key of ['body', 'body.language', 'body.memoryMb', 'ai', 'params', 'params.carryOver']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} is on the action panel`,
      ).toBe(true);
    }
    for (const key of ['basics', 'behavior', 'placement', 'advanced']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(true);
    }
    expect(PANEL_LEAVES.some((l) => l.scope === 'type' && l.prop === 'label')).toBe(true);
    // Dark — the derivation is the `action` entry and nothing else. These keys
    // exist in the catalog on OTHER types, several of them on `hook`, whose
    // `body.*` children carry byte-identical `en` sources — so a walk that read
    // the whole bundle, or that keyed on the leaf text, would pick them up.
    for (const key of ['handler', 'retryPolicy', 'retryPolicy.maxRetries', 'valueDomain', 'drilldown', 'enable']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} belongs to another type and is not an action leaf`,
      ).toBe(false);
    }
    for (const key of ['identity', 'legacy_handler', 'execution', 'dataset_binding']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(false);
    }
    expect(PANEL_LEAVES.every((l) => ['label', 'helpText', 'description'].includes(l.prop))).toBe(true);
  });

  it('no leaf on this panel reads its `en` source unless the ledger decided it is an echo', () => {
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of PANEL_LEAVES) {
        if (liveLeaf(forms, 'action', leaf) !== leaf.en) continue;
        const decided = DECISIONS.find(
          (d) => d.scope === leaf.scope && d.key === leaf.key && d.prop === leaf.prop,
        );
        if (decided?.verdict[locale] === 'echo') continue;
        const id = leaf.scope === 'type' ? `action.${leaf.prop}` : `action.${leaf.scope}.${leaf.key}.${leaf.prop}`;
        undecided.push(`${locale} ${id} (${JSON.stringify(leaf.en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf on the panel', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog: every
    // leaf must come back flagged, or the green above means only that the walk
    // found nothing.
    const flagged = PANEL_LEAVES.filter(
      (l) => liveLeaf(enMetadataForms as Record<string, any>, 'action', l) === l.en,
    );
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });
});

describe('#19403 round 5 — the blind spot, FIFTH shape: one schema, two forms, invisible in OPPOSITE ways', () => {
  it('what the existing pin CAN see on this panel was already translated — the covered slice is its own control', () => {
    // `repeater-row-properties.test.ts` derives a row property for every child
    // of a `type: 'repeater'` field. On `actionForm` that is exactly ONE
    // repeater — `params`, with eighteen children — and every one of those
    // carried its own text in all three locales before this round.
    expect(ACTION_ENUMERATED.covered.length).toBe(18);
    expect(ACTION_ENUMERATED.covered).toContain('params.carryOver');
    expect(ACTION_ENUMERATED.covered).toContain('params.requiresFeature');
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const key of ACTION_ENUMERATED.covered) {
        const en = (enMetadataForms as Record<string, any>).action?.fields?.[key]?.label;
        expect(typeof en, `en action.fields.${key}.label`).toBe('string');
        expect(
          forms.action?.fields?.[key]?.label,
          `${locale} action.fields.${key}.label was translated before this round and must stay so`,
        ).not.toBe(en);
      }
    }
  });

  it('what it CANNOT see on this panel is the `body` composite, whose five children were the broken ones', () => {
    // `body` declares five children exactly as `params` does, so the EXTRACTOR
    // emits a catalog key for each — it walks a form field's declared `fields`
    // whatever the declared type is. The pin does not: it filters
    // `type === 'repeater'`, and `body` is a `composite`. All five echoed in
    // all three locales, and they are five of the six keys this round decides.
    expect(ACTION_ENUMERATED.skipped.length).toBe(5);
    for (const child of SHARED_BODY_CHILDREN) {
      expect(ACTION_ENUMERATED.skipped).toContain(`body.${child}`);
      expect(
        ACTION_ENUMERATED.covered.includes(`body.${child}`),
        `body.${child} is NOT derived by the repeater pin`,
      ).toBe(false);
      // …and the extractor emitted it anyway, which is why the gap was invisible
      // rather than merely uncovered.
      expect(
        typeof (enMetadataForms as Record<string, any>).action?.fields?.[`body.${child}`]?.label,
        `the catalog carries a key for body.${child}`,
      ).toBe('string');
    }
    const decidedUnwalked = DECISIONS.filter((d) => ACTION_ENUMERATED.skipped.includes(d.key));
    expect(decidedUnwalked.length, 'both string leaves of all five unwalked children are decided here').toBe(10);
    // The sixth key is outside BOTH slices — `ai` is a plain form field with no
    // enumerated children at all, so no derivation over repeaters or composites
    // would ever have reached it.
    expect(ACTION_ENUMERATED.covered.includes('ai')).toBe(false);
    expect(ACTION_ENUMERATED.skipped.includes('ai')).toBe(false);
    expect(DECISIONS.filter((d) => d.key === 'ai').length).toBe(2);
  });

  it('⭐ the same composite on `hookForm` is invisible to that pin the OPPOSITE way — through a control that is CORRECT', () => {
    // This is the shape worth writing down, and it is not round 4's.
    //
    // Round 4 measured a LIT vacuity control passing over the gap:
    // `repeater-row-properties.test.ts` asserts `carrying.has('field') === true`
    // and that passes on the repeater that was never broken. The same is true
    // here for `action` — `params` supplies the green while `body` was broken.
    expect(ACTION_ENUMERATED.covered.length, 'action DOES carry repeater row properties').toBeGreaterThan(0);
    const decidedInside = DECISIONS.filter((d) => ACTION_ENUMERATED.covered.includes(d.key)).map(idOf);
    expect(decidedInside, 'no leaf decided here is one the existing pin already derives').toEqual([]);
    //
    // ⭐ But `hookForm` declares the IDENTICAL composite over the IDENTICAL
    // schema, and there the same pin is blind through its DARK control instead:
    // it asserts `carrying.has('hook') === false`, and that assertion is TRUE
    // and CORRECT — `hookForm` enumerates no repeater at all — while seven
    // children sit enumerated and outside it.
    expect(HOOK_ENUMERATED.covered.length, 'hookForm enumerates no repeater row properties').toBe(0);
    expect(HOOK_ENUMERATED.skipped.length).toBe(7);
    for (const child of SHARED_BODY_CHILDREN) expect(HOOK_ENUMERATED.skipped).toContain(`body.${child}`);
    expect(HOOK_ENUMERATED.skipped).toContain('retryPolicy.maxRetries');
    expect(HOOK_ENUMERATED.skipped).toContain('retryPolicy.backoffMs');
    //
    // ⇒ one composite, two forms, two different greens: a lit control that
    // passes on a sibling repeater, and a dark control that is right about
    // repeaters and silent about composites. Neither can be repaired by
    // deriving harder on ONE panel, which is the half below.
    const coveredParents = new Set(ACTION_ENUMERATED.covered.map((k) => k.replace(/\.[^.]+$/, '')));
    const skippedParents = new Set(ACTION_ENUMERATED.skipped.map((k) => k.replace(/\.[^.]+$/, '')));
    expect([...coveredParents]).toEqual(['params']);
    expect([...skippedParents]).toEqual(['body']);
    for (const parent of ['params', 'body']) {
      expect(ACTION_ENUMERATED.covered.includes(parent), `${parent} is not itself a row property`).toBe(false);
      expect(ACTION_ENUMERATED.skipped.includes(parent), `${parent} is not itself an unwalked child`).toBe(false);
    }
  });

  it('⭐ the half NO single-panel pin can see: two panels render one schema, and nothing compared them', () => {
    // Before this round `action.fields.body.*` echoed on 5 of 5 children and
    // `hook.fields.body.*` echoed on 1 of 5 — the same five schema keys, the
    // same five `en` sources, two different states, and no assertion anywhere
    // that they should agree. A pin derived from ONE form cannot see that by
    // construction: the disagreement is BETWEEN two derivations.
    //
    // This is the assertion that closes it for the keys this round decides:
    // wherever the `hook` twin is authored, `action` renders it identically.
    const en = enMetadataForms as Record<string, any>;
    const divergent: string[] = [];
    const noTwinEvidence: string[] = [];
    for (const child of SHARED_BODY_CHILDREN) {
      for (const prop of ['label', 'helpText'] as const) {
        const enAction = en.action?.fields?.[`body.${child}`]?.[prop];
        const enHook = en.hook?.fields?.[`body.${child}`]?.[prop];
        // The premise: both forms declare the same source text for this leaf.
        expect(typeof enAction, `en action body.${child}.${prop}`).toBe('string');
        expect(enHook, `hookForm declares a different en for body.${child}.${prop}`).toBe(enAction);
        for (const [locale, forms] of TRANSLATED_LOCALES) {
          const hookValue = forms.hook?.fields?.[`body.${child}`]?.[prop];
          const actionValue = forms.action?.fields?.[`body.${child}`]?.[prop];
          if (hookValue === enHook) {
            // The twin is itself an echo — it carries no evidence, and this
            // round says so rather than borrowing it.
            noTwinEvidence.push(`${child}.${prop}`);
            continue;
          }
          if (actionValue !== hookValue) divergent.push(`${locale} body.${child}.${prop}`);
        }
      }
    }
    expect(
      divergent,
      'one schema key rendered two ways on the two panels that declare it — make them agree, do not pick a favourite',
    ).toEqual([]);
    // Lit — the invariant above is not vacuous: it really compared leaves.
    // 5 children x 2 props x 3 locales = 30 pairs, of which the `memoryMb`
    // pair carries no authored twin in any locale (6 exclusions).
    expect(noTwinEvidence.length).toBe(6);
    expect([...new Set(noTwinEvidence)].sort()).toEqual(['memoryMb.helpText', 'memoryMb.label']);
    // …and that exclusion is exactly the family a later round of this card
    // still owes. When it lands, this assertion starts covering `memoryMb`
    // too, and reds if that round renders it differently from this one.
    const stillEchoingOnHook = SHARED_BODY_CHILDREN.filter((c) =>
      TRANSLATED_LOCALES.some(([, forms]) => forms.hook?.fields?.[`body.${c}`]?.label === en.hook?.fields?.[`body.${c}`]?.label),
    );
    expect(stillEchoingOnHook).toEqual(['memoryMb']);
  });
});
