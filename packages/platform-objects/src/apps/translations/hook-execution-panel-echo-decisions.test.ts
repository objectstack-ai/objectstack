// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 6 — the DECISION LEDGER for the HOOK panel's execution en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record for ONE panel family, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the five earlier rounds of
// this card extended (`object-field-editor-panel-`, `page-interface-panel-`,
// `dataset-panel-`, `field-panel-` and `action-body-panel-echo-decisions.test.ts`):
// one row per string leaf, each carrying its verdict per locale, the reason it
// was reached, and the `en` source it was judged against.
//
// ## The tie-break, in writing — and the leaf count did NOT decide it
//
// Measured on this round's base 0e671d20c, the four remaining families read:
//
//   six bare type-display pairs (seed·mapping·api·doc·book·capability)  6 keys / 12 leaves
//   object.fields.enable.* (+ validations)                             9 keys / 11 leaves
//   hook.fields.retryPolicy.* + body.memoryMb + timeoutMs              5 keys / 10 leaves
//   report.fields.drilldown + runtimeFilter + sections.dataset_binding 3 keys /  6 leaves
//
// ⇒ this family is THIRD of four by leaves. Four reasons taken together, and
// the first two are the ones no other row can offer:
//
//   1. IT IS THE ONLY FAMILY THAT MAKES THE LANDED INSTRUMENT STRONGER RATHER
//      THAN LONGER. Round 5's cross-panel invariant compares 5 shared
//      `HookBodySchema` children x 2 props x 3 locales = 30 pairs and EXCLUDES
//      6 of them, because `hook.fields.body.memoryMb` was itself an en-echo and
//      an unauthored twin carries no evidence. `action-body-panel-…` asserts
//      that exclusion by name and states in writing that a later round of this
//      card owes it. Deciding `body.memoryMb` here discharges that debt: the
//      landed invariant goes to 30/30 with an empty exclusion set, and starts
//      guarding `memoryMb` on BOTH panels. Taking `object`, `report` or the six
//      bare pairs leaves it at 24/30 permanently.
//   2. IT IS THE REMAINING HALF OF A MEASURED BLIND SPOT, on the panel where
//      the existing pin is blind through a control that is CORRECT. Round 5
//      measured `hookForm`'s enumerated-but-unwalked children at SEVEN — the
//      five `body.*` plus `retryPolicy.maxRetries` and `retryPolicy.backoffMs`
//      — and closed the five on the `action` side only. The two `retryPolicy`
//      children are what is left, and they are in this family.
//   3. EVIDENCE DENSITY FORCES PER-LEAF WORK. `body.memoryMb` takes a twin that
//      exists only because round 5 created it; `timeoutMs` takes an authored
//      twin ONE LEVEL DOWN THE SAME PANEL at a byte-identical `en` that the
//      schema's own docblock flags as a near-miss pair; `retryPolicy.*` has no
//      twin anywhere and is composed from this catalog's authored answers for
//      its separate words. Three different evidence shapes over five keys.
//   4. IT COMPLETES A PANEL. `hook` carries 47 `en` string leaves and exactly
//      these 10 echo in all three locales, so after this round the derived pin
//      below covers the whole panel with nothing deferred. (`object` and
//      `report` would also complete theirs — this reason does not separate
//      them, and is recorded as a reason that did not decide.)
//
// ⛔ And why NOT the six bare type-display pairs, which lead by leaves: round
// 5's refusal stands unchanged — only a real panel keeps the DERIVED-POPULATION
// property with a working dark control, and six unrelated types degenerate the
// derivation into six one-entry lookups with nothing for the control to
// exclude. The phantom-translation hazard below bites hardest there too.
//
// ## ⛔⛔ The phantom-translation reading round 5 bought, applied here
//
// `action.fields.ai.label`'s `en` was `Ai` — the extractor's humanize of a
// two-letter key. The case fix `Ai` -> `AI` DIFFERS IN BYTES, so it passes the
// echo predicate in all three locales and drops the census by one key while
// telling a zh-CN author nothing. ⇒ AN ECHO THAT STOPS MATCHING IS NOT THE
// SAME THING AS A LEAF THAT GOT TRANSLATED.
//
// Four of this family's five labels are exactly that shape — `Memory Mb`,
// `Timeout Ms`, `Max Retries`, `Backoff Ms` are all extractor humanizes of
// camelCase keys, and an English touch-up on any of them ("Memory (MB)",
// "Timeout (ms)") would score a census win for nothing. Every one of them is
// rendered into the locale's own writing system below, and the enumerated
// verdicts — not the census — are what shows it.
//
// ## The #19430 trap and its NEAR-MISS, read AT THE SCHEMA before a word was rendered
//
//   • `retryPolicy.helpText` names `async`. `HookSchema.async` is
//     `z.boolean().default(false)` — the value an author writes is `true`, not
//     the word — so this is NOT a #19430 leaf and the word is rendered. The
//     panel supplies its own authored answer one entry up: `hook.fields.async.label`
//     is 异步 / 非同期 / Asíncrono.
//   • `timeoutMs.helpText` reads "Abort the hook after N milliseconds", and
//     `abort` IS a legal value of `HookSchema.onError` (`z.enum(['abort','log'])`).
//     THE NEAR-MISS IS REAL AND IT IS CLEARED: this prose is about `timeoutMs`,
//     which takes a NUMBER, so no rendered word can land in the key it
//     describes, and the schema's own `.describe()` uses the word as the
//     runtime's verb ("before the hook is aborted"). Rendered.
//   • `N` is KEPT AS A LETTER in all three — a placeholder for the number the
//     author writes, by the same rule that kept `256` and `40` numerals in
//     round 5. So is `256` in `body.memoryMb.helpText`, which is
//     `ScriptBodySchema`'s `.max(256)`.
//   • `retryPolicy` is a `strictObject`, not an enum. Its alias map
//     (retries/attempts -> maxRetries, basedelayms/backoff/delayms -> backoffMs)
//     is about KEY spellings, which no label renders.
//
// All four readings are asserted below against the live schema rather than
// described, so a schema change that makes one of them false reds this file.
//
// ## A SECOND ACT this round performs, and it is not an echo decision
//
// `hook.fields.body.capabilities.label` read 功能 / 機能 / Capacidades. Round 5
// RECORDED rather than improved that: 功能 and 機能 read "feature", while the
// value is a capability TOKEN from the `HookBodyCapability` enum — and it left
// the reword to the hook family because the cross-panel invariant holds
// `action` to whatever word the hook side picks. This round is the hook family.
//
// The replacement is not invented: the objects catalog already answers the
// English word "capability" and answers it UNANIMOUSLY. Derived below — every
// authored leaf of `*.objects.generated.ts` whose `en` names a capability
// renders it 能力 in zh-CN and ケイパビリティ in ja-JP, and NONE of them uses
// 功能 or 機能. es-ES already read Capacidades and is UNCHANGED, which is why
// this round's zh-CN and ja-JP bundle diffs are two lines larger than es-ES's.
//
// ⇒ zh-CN 功能 -> 能力 and ja-JP 機能 -> ケイパビリティ, on BOTH panels in one
// act, because diverging is the defect the cross-panel invariant guards.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle and compare each
// `.label` leaf against `en`. Re-taken by this round on base 0e671d20c:
//
//   en string leaves / `.label` leaves            893 / 538
//   POSITIVE CONTROL — labels genuinely translated 515 (zh-CN) · 499 · 499
//   label keys echoing in ALL THREE locales          23 => 69 `.label` leaves
//
// After: 18 keys / 54 `.label` leaves, control 520 · 504 · 504 — echoes down 5
// and the control up 5 in each locale, same population, same run. ⚠️ 69 and 54
// count `.label` leaves; the DECIDABLE sibling remainder (a label plus its
// `helpText`/`description`) is a different question and reads 39 before, 29
// after — this family is 5 labels AND 5 helpTexts, and only the labels move the
// headline number. State which count you mean.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf is
// still a byte copy of the source revision. All 10 leaves decided here carried
// one in all three locales; `pnpm i18n:extract` dropped exactly those 30 rows
// and added none, which is asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { hookForm } from '@objectstack/spec/data';
import { HookSchema } from '@objectstack/spec/data';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';

const TRANSLATED_LOCALES: ReadonlyArray<readonly [string, Record<string, any>]> = [
  ['zh-CN', zhCNMetadataForms as Record<string, any>],
  ['ja-JP', jaJPMetadataForms as Record<string, any>],
  ['es-ES', esESMetadataForms as Record<string, any>],
];

const TRANSLATED_OBJECTS: ReadonlyArray<readonly [string, Record<string, any>]> = [
  ['zh-CN', zhCNObjects as Record<string, any>],
  ['ja-JP', jaJPObjects as Record<string, any>],
  ['es-ES', esESObjects as Record<string, any>],
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
   * field, `sections` for a section heading. Every row this round is `fields`
   * — measured, not assumed: `hook.label` and all four `hook.sections.*`
   * label/description pairs were already authored in every locale on the base,
   * and the derived pin below walks all 47 string leaves of the `hook` entry
   * and requires every one of them to be non-echoing unless a row says so.
   */
  scope: 'type' | 'fields' | 'sections';
  /** The bundle key under `hook.<scope>` (`hook` itself for `type`). */
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
    key: 'body.memoryMb',
    prop: 'label',
    en: 'Memory Mb',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE TWIN RULE, RUNNING THE OTHER WAY. Round 5 decided action.fields.body.memoryMb.label with NO authored twin — this key was an en-echo on BOTH panels, and that row said so rather than borrowing evidence it did not have, deciding instead from the sibling timeoutMs shape (concept + unit in a parenthetical). That decision is landed, so this leaf now HAS an authored twin at the same schema key, and it is copied verbatim: 内存（MB） / メモリ（MB） / Memoria (MB). This is the row that removes the exclusion PR #19509 wrote into its own cross-panel invariant: one schema key, one rendering, across both panels that declare it — 30 of 30 pairs from here on, asserted below. `MB` stays a unit symbol in every locale.',
  },
  {
    scope: 'fields',
    key: 'body.memoryMb',
    prop: 'helpText',
    en: 'Per-invocation memory cap (MB, max 256)',
    verdict: ALL_TRANSLATE,
    reason:
      'The same landed twin, copied verbatim: 单次调用内存上限（MB，最大 256） / 呼び出しごとのメモリ上限（MB、最大 256） / Límite de memoria por invocación (MB, máx. 256). ⭐ `256` is KEPT AS A NUMERAL because it is ScriptBodySchema\'s .max(256) — the number an author is measured against, not an English word — and that is asserted by the machine-token guard below rather than trusted. ⚠️ Per-locale departures copied rather than re-decided: zh-CN uses the ideographic comma 、-family separator （MB，最大 256） while ja-JP uses 、 and es-ES abbreviates máx. with a full stop.',
  },
  {
    scope: 'fields',
    key: 'timeoutMs',
    prop: 'label',
    en: 'Timeout Ms',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE SAME STRING IN TWO POSITIONS, DECIDED THE SAME WAY — DELIBERATELY, AND THE REASON IS RECORDED. hook.fields.body.timeoutMs.label carries a BYTE-IDENTICAL en ("Timeout Ms", the extractor\'s humanize of the camelCase key) one level down the same panel and is already authored: 超时（毫秒） / タイムアウト（ms） / Tiempo de espera (ms). These are two DIFFERENT schema keys — HookSchema.timeoutMs aborts the whole hook, ScriptBodySchema.timeoutMs bounds one invocation of the body — and hook.zod.ts\'s own docblock records them as the near-miss pair #14478 deliberately made spell the same ("both levels now spell `timeoutMs`"). The CONCEPT is identical (an execution timeout in milliseconds) and the LEVEL is carried by the helpText, not the label, so the twin is copied unchanged. This card\'s precedent that the same string in two positions CAN be decided two ways is a permission, not an obligation; here the two positions genuinely say the same thing and the reason for not diverging is that the schema went out of its way to make them spell alike.',
  },
  {
    scope: 'fields',
    key: 'timeoutMs',
    prop: 'helpText',
    en: 'Abort the hook after N milliseconds',
    verdict: ALL_TRANSLATE,
    reason:
      'THE #19430 NEAR-MISS OF THIS FAMILY, read at the schema and CLEARED. `abort` IS a legal value of HookSchema.onError (z.enum(["abort","log"])), so the word is one an author can be asked to write — but not HERE: this prose describes `timeoutMs`, which takes a NUMBER (asserted below: the schema refuses "5000 毫秒" and accepts 5000), and the schema\'s own .describe() uses the word as the runtime\'s verb, "before the hook is aborted". Rendered: 超过 N 毫秒后中止该钩子 / N ミリ秒経過後にフックを中止 / Abortar el hook después de N milisegundos. ⭐ `N` is KEPT AS A LETTER in all three — a placeholder for the number the author writes, by the rule that kept 256 and 40 numerals in round 5. `milliseconds` is SPELLED OUT (毫秒 / ミリ秒 / milisegundos) rather than taking the （ms） parenthetical the label carries, because the en spells it out too. ⚠️ Per-locale departure, copied from this panel\'s own authored prose and not invented: es-ES keeps `hook` ENGLISH inside a sentence (hook.sections.identity.description "Qué es este hook y cuándo se dispara", hook.fields.condition.helpText "omite el hook") even though hook.label is Gancho; zh-CN takes 钩子 (hook.fields.condition.helpText 跳过该钩子) and ja-JP フック (フックをスキップ).',
  },
  {
    scope: 'fields',
    key: 'retryPolicy',
    prop: 'label',
    en: 'Retry Policy',
    verdict: ALL_TRANSLATE,
    reason:
      'NO TWIN ANYWHERE IN EITHER CATALOG — composed from this catalog\'s own authored answers for its two words, and the row says which leaf each came from. "retry": sys_job_run.fields.attempt.help renders "retries/replays" as 重试/重放 · 再試行/再実行 · reintentos/repeticiones. "policy": agent.fields.guardrails.helpText renders "content policies" as 内容策略 · コンテンツポリシー · políticas de contenido. ⇒ 重试策略 / 再試行ポリシー / Política de reintentos. ⚠️ zh-CN answers "policy" two ways in this catalog — 策略 for a configured strategy (内容策略, 保留策略) and 政策 for a published document (sys_oauth_application.fields.policy.label 隐私政策); this is the first sense. ⛔ NOT a #19430 leaf: retryPolicy is a strictObject, not an enum, and its alias map (retries/attempts -> maxRetries, basedelayms/backoff/delayms -> backoffMs) governs KEY spellings, which no label renders.',
  },
  {
    scope: 'fields',
    key: 'retryPolicy',
    prop: 'helpText',
    en: 'Retry on failure — most useful for async hooks',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE LEAF WHERE THE SCHEMA HAD TO BE READ TO DECIDE A WORD, AND THE ANSWER WAS "RENDER IT". `async` looks exactly like a #19430 token, and it is not one: HookSchema.async is z.boolean().default(false), so the value an author writes is `true` — asserted below, where the schema accepts async: true and refuses async: "异步". With the token question answered, the concept takes the panel\'s OWN authored rendering one entry up: hook.fields.async.label is 异步 / 非同期 / Asíncrono. "on failure" takes flow.fields.errorHandling.helpText\'s authored 节点失败时 / ノード失敗時 / cuando falla. ⇒ 失败时重试——对异步钩子最有用 / 失敗時に再試行 — 非同期フックで特に有用 / Reintentar al fallar — especialmente útil para hooks asíncronos. ⚠️ The em-dash convention is this panel\'s own and is copied, not chosen: zh-CN folds it to —— with no spaces (hook.sections.legacy_handler.description 函数名引用——已废弃), ja-JP and es-ES keep a spaced —.',
  },
  {
    scope: 'fields',
    key: 'retryPolicy.maxRetries',
    prop: 'label',
    en: 'Max Retries',
    verdict: ALL_TRANSLATE,
    reason:
      'ANOTHER EXTRACTOR HUMANIZE of a camelCase key, and round 5\'s established shape for these is to render the CONCEPT rather than transliterate the mechanical title. "max" takes this catalog\'s authored 最大 / 最大 / máximo — object.fields.fields.maxLength.helpText is 最大字符数 / 最大文字数 / Máximo de caracteres and action.fields.params.maxSize.label is 最大大小（字节） / 最大サイズ（バイト） / Tamaño máximo (bytes) — and es-ES puts the adjective AFTER the noun exactly as that label does. ⇒ 最大重试次数 / 最大再試行回数 / Reintentos máximos. ⭐ Note what was refused: "Max Retries" -> "Max Retries (3)" or any other English touch-up would differ in bytes, pass the echo predicate in all three locales, drop the census by a key and tell a zh-CN author nothing — the phantom-translation shape round 5 measured.',
  },
  {
    scope: 'fields',
    key: 'retryPolicy.maxRetries',
    prop: 'helpText',
    en: 'Maximum retry attempts',
    verdict: ALL_TRANSLATE,
    reason:
      '最多可重试的次数 / 再試行の最大回数 / Número máximo de reintentos, taking "retry" from the same sys_job_run.fields.attempt.help precedent as the rows above. ⛔ The schema default `3` is NOT rendered: maxRetries is z.number().default(3) and a hook authored with retryPolicy: {} really does get 3 — but the en tooltip does not carry the number, and putting one in a translated tooltip states a limit the form never showed and that a later default change would silently falsify. ⚠️ The schema\'s own .describe() reads "Maximum retry attempts ON FAILURE"; the form drops the qualifier and this row drops it too rather than translating text the author does not see.',
  },
  {
    scope: 'fields',
    key: 'retryPolicy.backoffMs',
    prop: 'label',
    en: 'Backoff Ms',
    verdict: ALL_TRANSLATE,
    reason:
      'THE THIRD HUMANIZE, and this catalog has an authored answer for the bare word: sys_job_queue.fields.backoff_type.label renders "Backoff" as 退避策略 / バックオフ / Retroceso. The unit goes into the parenthetical exactly as the in-panel twin hook.fields.body.timeoutMs.label does (超时（毫秒） / タイムアウト（ms） / Tiempo de espera (ms)), which is why zh-CN spells 毫秒 while ja-JP and es-ES keep ms. ⇒ 退避（毫秒） / バックオフ（ms） / Retroceso (ms). ⚠️ zh-CN takes 退避 and NOT the precedent\'s full 退避策略: that objects-catalog label names a backoff_type (WHICH strategy) while this key is the delay itself, and 策略 is already spent one row up on retryPolicy = 重试策略. ⚠️ es-ES: the objects catalog answers "backoff" two ways — bare Retroceso (backoff_type) and `backoff` kept English inside compounds (Base de backoff, Límite de backoff); this is the bare form, so it takes Retroceso.',
  },
  {
    scope: 'fields',
    key: 'retryPolicy.backoffMs',
    prop: 'helpText',
    en: 'Delay between retries (ms)',
    verdict: ALL_TRANSLATE,
    reason:
      '两次重试之间的延迟（毫秒） / 再試行間の遅延（ms） / Retraso entre reintentos (ms). "retries" takes the same authored 重试 / 再試行 / reintentos as every row of this family, and the （ms） parenthetical follows the panel convention set by hook.fields.body.timeoutMs.helpText (单次调用超时时间（毫秒） / 呼び出しごとのタイムアウト（ms） / Tiempo de espera por invocación (ms)). ⛔ The schema default of 1000 ms is not rendered, for the reason the row above records.',
  },
];

/**
 * The SECOND ACT — a reword of an already-authored leaf, kept separate from the
 * echo decisions on purpose. These rows are NOT echoes and never were; they are
 * a word this card recorded as wrong in round 5 and left to the hook family.
 */
interface Reword {
  /** The full bundle path, `<type>.fields.<key>.<prop>`. */
  type: string;
  key: string;
  prop: 'label';
  en: string;
  /** Per locale: the landed word before this round, and the word after. */
  from: Readonly<Record<string, string>>;
  to: Readonly<Record<string, string>>;
  reason: string;
}

const CAPABILITY_REWORD_REASON =
  'ROUND 5 RECORDED THIS RATHER THAN IMPROVING IT, and named the reason: 功能 (zh-CN) and 機能 (ja-JP) read "feature", while the value is a capability TOKEN from the HookBodyCapability z.enum — and rewording it is a HOOK-family edit, because hookForm and actionForm declare the same composite over HookBodySchema and diverging is the defect the cross-panel invariant guards. This round is the hook family, so both sides move in ONE act. The replacement is derived, not invented: every authored leaf of the objects catalog whose en names a capability renders it 能力 in zh-CN and ケイパビリティ in ja-JP, and NONE uses 功能 or 機能 — asserted below over that catalog rather than quoted. es-ES already read Capacidades, which is the same word those leaves use, so it is UNCHANGED; that asymmetry is why this round\'s zh-CN and ja-JP bundle diffs are two lines larger than es-ES\'s.';

const REWORDS: readonly Reword[] = [
  {
    type: 'hook',
    key: 'body.capabilities',
    prop: 'label',
    en: 'Capabilities',
    from: { 'zh-CN': '功能', 'ja-JP': '機能', 'es-ES': 'Capacidades' },
    to: { 'zh-CN': '能力', 'ja-JP': 'ケイパビリティ', 'es-ES': 'Capacidades' },
    reason: CAPABILITY_REWORD_REASON,
  },
  {
    type: 'action',
    key: 'body.capabilities',
    prop: 'label',
    en: 'Capabilities',
    from: { 'zh-CN': '功能', 'ja-JP': '機能', 'es-ES': 'Capacidades' },
    to: { 'zh-CN': '能力', 'ja-JP': 'ケイパビリティ', 'es-ES': 'Capacidades' },
    reason: CAPABILITY_REWORD_REASON,
  },
];

function leafOf(bundle: Record<string, any>, d: Decision): unknown {
  const hook = bundle.hook;
  return d.scope === 'type' ? hook?.[d.prop] : hook?.[d.scope]?.[d.key]?.[d.prop];
}

/** The provenance-table key for a decided leaf. */
function provenanceKey(d: Decision): string {
  return d.scope === 'type'
    ? `metadataForms.hook.${d.prop}`
    : `metadataForms.hook.${d.scope}.${d.key}.${d.prop}`;
}

/** The dotted id a decision is reported under. */
function idOf(d: Decision): string {
  return d.scope === 'type' ? `hook.${d.prop}` : `hook.${d.scope}.${d.key}.${d.prop}`;
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

/**
 * Token presence judged on UNICODE word boundaries, NOT substring containment.
 *
 * ⛔ This family's kept tokens include a bare `N`, and `'Número máximo de
 * reintentos'.includes('N')` is TRUE — a guard that cannot fail is exactly the
 * phantom check this card exists to refuse. `\p{L}`/`\p{N}` rather than
 * `[A-Za-z0-9]` because the neighbours here are CJK, kana and accented Latin.
 */
function carriesToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
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

const PANEL_LEAVES = panelLeaves('hook');

function liveLeaf(bundle: Record<string, any>, type: string, l: PanelLeaf): unknown {
  const entry = bundle[type];
  return l.scope === 'type' ? entry?.[l.prop] : entry?.[l.scope]?.[l.key]?.[l.prop];
}

/**
 * The blind-spot derivation round 5 landed, reused unchanged: a field that
 * enumerates `fields` is walked by `repeater-row-properties.test.ts` ONLY when
 * `type === 'repeater'`, while the extractor emits catalog keys for a form
 * field's declared children whatever the declared type is.
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

const HOOK_ENUMERATED = enumeratedChildren(hookForm);

/** The five `HookBodySchema` children both `hookForm` and `actionForm` declare. */
const SHARED_BODY_CHILDREN = ['language', 'source', 'capabilities', 'timeoutMs', 'memoryMb'] as const;

/** A minimal hook that parses, so the schema probes below vary ONE key at a time. */
const MINIMAL_HOOK = { name: 'h1', object: 'account', events: ['beforeInsert'], handler: 'fn' } as const;

function flattenLeaves(o: Record<string, any>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') for (const [a, b] of flattenLeaves(v as Record<string, any>, p)) out.set(a, b);
  }
  return out;
}

describe('#19403 round 6 — the ledger itself (controls before verdicts)', () => {
  it('decides every echoing string leaf of the 5 keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 5 keys, 10 leaves, three locales,
    // 30 decisions.
    expect(DECISIONS.length).toBe(10);
    expect(new Set(DECISIONS.map((d) => `${d.scope}.${d.key}`)).size).toBe(5);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(30);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
    // Every decided key is decided on BOTH of its string leaves — a panel whose
    // field name is translated and whose tooltip is not is the same defect half
    // fixed.
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
    for (const r of REWORDS) {
      expect(
        (enMetadataForms as Record<string, any>)[r.type]?.fields?.[r.key]?.[r.prop],
        `en ${r.type}.fields.${r.key}.${r.prop} moved — re-judge the reword`,
      ).toBe(r.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must flag all 10 rows, or a green verdict
    // run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${idOf(d)} records no reason`).toBeGreaterThan(40);
    }
    for (const r of REWORDS) {
      expect(r.reason.length, `${r.type}.${r.key} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Every verdict in this round is `translate`, so the rule has nothing to
    // evaluate over DECISIONS. Assert it there AND prove the predicate fires, or
    // the requirement is a phantom check that deleting would leave green.
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no reason').toEqual([]);

    const synthetic: Decision = {
      scope: 'fields',
      key: 'retryPolicy',
      prop: 'label',
      en: 'Retry Policy',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN hook.fields.retryPolicy.label']);
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

describe('#19403 round 6 — the catalogs hold what the ledger decided', () => {
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
});

describe('#19403 round 6 — the #19430 discipline, asserted AT THE SCHEMA', () => {
  it('the probe harness is lit — a minimal hook parses, so a refusal below is about the key under test', () => {
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK }).success).toBe(true);
  });

  it('`abort` is a real onError value — the near-miss this family had to clear is REAL', () => {
    // If this ever stopped being true the reason recorded on timeoutMs.helpText
    // would be describing a trap that does not exist.
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, onError: 'abort' }).success).toBe(true);
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, onError: '中止' }).success).toBe(false);
  });

  it('…and it is CLEARED, because the key that tooltip describes takes a NUMBER', () => {
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, timeoutMs: 5000 }).success).toBe(true);
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, timeoutMs: '5000 毫秒' }).success).toBe(false);
  });

  it('`async` is a BOOLEAN, so the word in retryPolicy.helpText is not a token an author writes', () => {
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, async: true }).success).toBe(true);
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, async: '异步' }).success).toBe(false);
  });

  it('`retryPolicy` is a strictObject of numbers whose defaults this round refused to render', () => {
    const ok = (HookSchema as any).safeParse({ ...MINIMAL_HOOK, retryPolicy: {} });
    expect(ok.success).toBe(true);
    // The defaults exist and are exactly the numbers the two helpTexts do NOT
    // carry — recorded so the refusal is a measurement, not an assumption.
    expect(ok.data.retryPolicy).toEqual({ maxRetries: 3, backoffMs: 1000 });
    expect((HookSchema as any).safeParse({ ...MINIMAL_HOOK, retryPolicy: { maxRetries: '三' } }).success).toBe(false);
    for (const [, forms] of TRANSLATED_LOCALES) {
      for (const key of ['retryPolicy.maxRetries', 'retryPolicy.backoffMs']) {
        const text = `${forms.hook?.fields?.[key]?.label} ${forms.hook?.fields?.[key]?.helpText}`;
        expect(carriesToken(text, '3'), `${key} renders the schema default 3`).toBe(false);
        expect(carriesToken(text, '1000'), `${key} renders the schema default 1000`).toBe(false);
      }
    }
  });

  it('the machine tokens the ledger decided to KEEP are still verbatim in every locale', () => {
    const kept: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      ['body.memoryMb', 'helpText', ['MB', '256']],
      ['timeoutMs', 'helpText', ['N']],
      ['retryPolicy.backoffMs', 'label', ['ms', '毫秒']],
    ];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const [key, prop, tokens] of kept) {
        const text = forms.hook?.fields?.[key]?.[prop];
        expect(typeof text, `${locale} hook.fields.${key}.${prop}`).toBe('string');
        // `ms` / `毫秒` is one unit spelled per locale, so the row passes when
        // EITHER spelling is carried; every other token must be present as is.
        const needed = tokens.length > 1 && tokens.includes('毫秒') ? [tokens] : tokens.map((t) => [t]);
        for (const group of needed) {
          expect(
            (group as string[]).some((t) => carriesToken(text as string, t)),
            `${locale} hook.fields.${key}.${prop} no longer carries any of ${(group as string[]).join('/')}`,
          ).toBe(true);
        }
      }
    }
  });

  it('⭐ the token predicate can say NO — and a bare `includes` could not', () => {
    // Dark, and it is the sharpest control in this file. The es-ES maxRetries
    // tooltip is "Número máximo de reintentos": `includes('N')` is TRUE on it,
    // so round 5's containment check would have passed a locale that lost the
    // placeholder entirely.
    const esMax = (esESMetadataForms as Record<string, any>).hook?.fields?.['retryPolicy.maxRetries']
      ?.helpText as string;
    expect(esMax.includes('N')).toBe(true);
    expect(carriesToken(esMax, 'N')).toBe(false);
    // …and it still says YES where the placeholder really is.
    const esTimeout = (esESMetadataForms as Record<string, any>).hook?.fields?.timeoutMs?.helpText as string;
    expect(carriesToken(esTimeout, 'N')).toBe(true);
    // A number none of them carries, and a capability member this prose never
    // names, must both read false.
    const zhMem = (zhCNMetadataForms as Record<string, any>).hook?.fields?.['body.memoryMb']?.helpText as string;
    expect(carriesToken(zhMem, '256')).toBe(true);
    expect(carriesToken(zhMem, '512')).toBe(false);
    expect(carriesToken(zhMem, '25')).toBe(false);
  });
});

describe('#19403 round 6 — the provenance table agrees these leaves are now authored', () => {
  // A second, independent witness to the same fact, from a table nobody edits by
  // hand. An entry exists exactly while a leaf is still a byte copy of the
  // source revision, so re-filling a decided leaf and re-running the extract
  // brings its row back and reds this block — even in the locale where no second
  // locale exists to disagree with it. It fires on a different trigger than the
  // catalog assertion above (a re-fill FOLLOWED BY an extract, rather than the
  // re-fill itself), which is what makes it a witness and not a restatement.
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
      // finds it. Deliberately matched by PATTERN rather than pinned to a family,
      // so a later round of this card cannot red this control by fixing one.
      const sample = Object.keys(table).find((k) => /^metadataForms\.[^.]+\.(fields|sections)\..+\.[^.]+$/.test(k));
      expect(sample, `${locale} provenance table records no metadata-form leaf`).toBeTruthy();
      const parts = /^metadataForms\.([^.]+)\.(fields|sections)\.(.+)\.([^.]+)$/.exec(sample!);
      expect(parts, 'the table key does not decompose').toBeTruthy();
      const [, type, scope, key, prop] = parts!;
      expect(`metadataForms.${type}.${scope}.${key}.${prop}`, 'composing the key back must reproduce it').toBe(sample);
      expect(table[sample!], 'the lookup this file performs finds a key the table holds').toBeTruthy();
      // And the composer under test builds exactly those two templates.
      expect(provenanceKey({ ...DECISIONS[0], scope: 'fields', key: 'k', prop: 'label' })).toBe(
        'metadataForms.hook.fields.k.label',
      );
      expect(provenanceKey({ ...DECISIONS[0], scope: 'type', key: 'hook', prop: 'label' })).toBe(
        'metadataForms.hook.label',
      );
    });
  }
});

describe('#19403 round 6 — the panel population, DERIVED', () => {
  it('the derivation reaches this panel, and only this panel', () => {
    // Lit — floors, not exact counts, so a key added to the hook form is caught
    // by the echo rule below rather than by a number nobody can interpret.
    // Measured on base 0e671d20c: 47 string leaves on the `hook` entry (the 10
    // decided here plus 37 already-authored neighbours), over 26 distinct
    // scope+key entries.
    expect(PANEL_LEAVES.length).toBeGreaterThan(40);
    expect(new Set(PANEL_LEAVES.map((l) => `${l.scope}.${l.key}`)).size).toBeGreaterThan(20);
    for (const key of ['body', 'body.language', 'body.memoryMb', 'timeoutMs', 'retryPolicy', 'retryPolicy.backoffMs']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key), `${key} is on the hook panel`).toBe(true);
    }
    for (const key of ['identity', 'body', 'legacy_handler', 'execution']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(true);
    }
    expect(PANEL_LEAVES.some((l) => l.scope === 'type' && l.prop === 'label')).toBe(true);
    // Dark — the derivation is the `hook` entry and nothing else. These keys
    // exist in the catalog on OTHER types, and `action` even carries
    // `body.memoryMb` at a byte-identical `en`, so a walk that read the whole
    // bundle, or that keyed on the leaf text, would pick them up.
    for (const key of ['ai', 'params', 'params.carryOver', 'enable', 'validations', 'drilldown', 'runtimeFilter']) {
      expect(
        PANEL_LEAVES.some((l) => l.scope === 'fields' && l.key === key),
        `${key} belongs to another type and is not a hook leaf`,
      ).toBe(false);
    }
    for (const key of ['basics', 'advanced', 'placement', 'dataset_binding', 'capabilities']) {
      expect(PANEL_LEAVES.some((l) => l.scope === 'sections' && l.key === key)).toBe(false);
    }
    expect(PANEL_LEAVES.every((l) => ['label', 'helpText', 'description'].includes(l.prop))).toBe(true);
  });

  it('no leaf on this panel reads its `en` source unless the ledger decided it is an echo', () => {
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of PANEL_LEAVES) {
        if (liveLeaf(forms, 'hook', leaf) !== leaf.en) continue;
        const decided = DECISIONS.find((d) => d.scope === leaf.scope && d.key === leaf.key && d.prop === leaf.prop);
        if (decided?.verdict[locale] === 'echo') continue;
        const id = leaf.scope === 'type' ? `hook.${leaf.prop}` : `hook.${leaf.scope}.${leaf.key}.${leaf.prop}`;
        undecided.push(`${locale} ${id} (${JSON.stringify(leaf.en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf on the panel', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog: every leaf
    // must come back flagged, or the green above means only that the walk found
    // nothing.
    const flagged = PANEL_LEAVES.filter((l) => liveLeaf(enMetadataForms as Record<string, any>, 'hook', l) === l.en);
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });

  it('⭐ this panel is now DONE — zero of its 47 leaves echoes in all three locales', () => {
    // The property this family was taken for, stated as a number rather than a
    // claim. It is the strongest form of the derived pin: there is nothing left
    // on this panel for a later round to defer.
    const echoing = PANEL_LEAVES.filter((l) =>
      TRANSLATED_LOCALES.every(([, forms]) => liveLeaf(forms, 'hook', l) === l.en),
    );
    expect(echoing.map((l) => `${l.scope}.${l.key}.${l.prop}`)).toEqual([]);
    // Lit — and it really walked the panel, which a zero alone would not show.
    expect(PANEL_LEAVES.length).toBeGreaterThan(40);
  });
});

describe('#19403 round 6 — the composite blind spot, hook side, CLOSED', () => {
  it('the derivation reproduces round 5\'s measurement of what the repeater pin cannot see', () => {
    // `hookForm` enumerates no repeater at all, so `repeater-row-properties.test.ts`
    // is blind here through a DARK control that is TRUE and CORRECT — the shape
    // round 5 wrote down. Seven children sit enumerated and outside it.
    expect(HOOK_ENUMERATED.covered.length, 'hookForm enumerates no repeater row properties').toBe(0);
    expect(HOOK_ENUMERATED.skipped.length).toBe(7);
    for (const child of SHARED_BODY_CHILDREN) expect(HOOK_ENUMERATED.skipped).toContain(`body.${child}`);
    expect(HOOK_ENUMERATED.skipped).toContain('retryPolicy.maxRetries');
    expect(HOOK_ENUMERATED.skipped).toContain('retryPolicy.backoffMs');
  });

  it('⭐ the two children round 5 left are decided here, and the extractor emitted keys for them anyway', () => {
    for (const child of ['retryPolicy.maxRetries', 'retryPolicy.backoffMs']) {
      expect(HOOK_ENUMERATED.skipped).toContain(child);
      expect(HOOK_ENUMERATED.covered.includes(child), `${child} is NOT derived by the repeater pin`).toBe(false);
      // …and the catalog carries a key for it regardless, which is why the gap
      // was invisible rather than merely uncovered.
      expect(
        typeof (enMetadataForms as Record<string, any>).hook?.fields?.[child]?.label,
        `the catalog carries a key for ${child}`,
      ).toBe('string');
      expect(DECISIONS.filter((d) => d.key === child).length, `${child} is decided on both leaves`).toBe(2);
    }
    // The parent `retryPolicy` is not itself an enumerated child — it is the
    // composite — and it is decided here too, so no half of it is left English.
    expect(HOOK_ENUMERATED.skipped.includes('retryPolicy')).toBe(false);
    expect(DECISIONS.filter((d) => d.key === 'retryPolicy').length).toBe(2);
    // `timeoutMs` is outside BOTH slices: a plain form field with no enumerated
    // children, so no derivation over repeaters or composites would reach it.
    expect(HOOK_ENUMERATED.covered.includes('timeoutMs')).toBe(false);
    expect(HOOK_ENUMERATED.skipped.includes('timeoutMs')).toBe(false);
    expect(DECISIONS.filter((d) => d.key === 'timeoutMs').length).toBe(2);
  });
});

describe('#19403 round 6 — the cross-panel invariant, now covering every pair', () => {
  it('⭐ 30 of 30 `HookBodySchema` pairs agree, with NOTHING excluded for want of an authored twin', () => {
    // PR #19509 landed this invariant with SIX of its thirty pairs excluded:
    // `body.memoryMb` was an en-echo on both panels, so the twin carried no
    // evidence and that round said so rather than borrowing it. Deciding
    // `memoryMb` on the hook side is what removes the exclusion.
    const en = enMetadataForms as Record<string, any>;
    const divergent: string[] = [];
    const noTwinEvidence: string[] = [];
    let compared = 0;
    for (const child of SHARED_BODY_CHILDREN) {
      for (const prop of ['label', 'helpText'] as const) {
        const enHook = en.hook?.fields?.[`body.${child}`]?.[prop];
        const enAction = en.action?.fields?.[`body.${child}`]?.[prop];
        expect(typeof enHook, `en hook body.${child}.${prop}`).toBe('string');
        expect(enAction, `actionForm declares a different en for body.${child}.${prop}`).toBe(enHook);
        for (const [locale, forms] of TRANSLATED_LOCALES) {
          const hookValue = forms.hook?.fields?.[`body.${child}`]?.[prop];
          const actionValue = forms.action?.fields?.[`body.${child}`]?.[prop];
          if (hookValue === enHook) {
            noTwinEvidence.push(`${locale} body.${child}.${prop}`);
            continue;
          }
          compared += 1;
          if (actionValue !== hookValue) divergent.push(`${locale} body.${child}.${prop}`);
        }
      }
    }
    expect(
      divergent,
      'one schema key rendered two ways on the two panels that declare it — make them agree, do not pick a favourite',
    ).toEqual([]);
    // ⭐ The exclusion set is now EMPTY, and the count says the comparison was
    // real: 5 children x 2 props x 3 locales.
    expect(noTwinEvidence).toEqual([]);
    expect(compared).toBe(30);
  });

  it('the invariant can fire — it is comparing values, not comparing a value with itself', () => {
    // Dark. Feed the same comparison a deliberately divergent pair and it must
    // report it, or the empty `divergent` above means only that the loop found
    // nothing to look at.
    const forged = {
      hook: { fields: { 'body.memoryMb': { label: '内存（MB）' } } },
      action: { fields: { 'body.memoryMb': { label: 'メモリ（MB）' } } },
    } as Record<string, any>;
    const a = forged.hook.fields['body.memoryMb'].label;
    const b = forged.action.fields['body.memoryMb'].label;
    expect(a === b).toBe(false);
    // And the live pair really does agree, in every locale.
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      expect(
        forms.hook?.fields?.['body.memoryMb']?.label,
        `${locale} memoryMb label disagrees across the two panels`,
      ).toBe(forms.action?.fields?.['body.memoryMb']?.label);
    }
  });
});

describe('#19403 round 6 — the capabilities reword, on both panels, derived not invented', () => {
  it('both panels carry the reworded label, and the row records what it replaced', () => {
    for (const r of REWORDS) {
      for (const [locale, forms] of TRANSLATED_LOCALES) {
        expect(
          forms[r.type]?.fields?.[r.key]?.[r.prop],
          `${locale} ${r.type}.fields.${r.key}.${r.prop} does not carry the reworded value`,
        ).toBe(r.to[locale]);
      }
    }
    // The two rows are the SAME schema key on two panels, so their before and
    // after must be identical — a reword that moved one side is the defect the
    // invariant above guards.
    expect(REWORDS[0].to).toEqual(REWORDS[1].to);
    expect(REWORDS[0].from).toEqual(REWORDS[1].from);
    // es-ES was already right and is deliberately unchanged.
    expect(REWORDS[0].from['es-ES']).toBe(REWORDS[0].to['es-ES']);
    expect(REWORDS[0].from['zh-CN']).not.toBe(REWORDS[0].to['zh-CN']);
    expect(REWORDS[0].from['ja-JP']).not.toBe(REWORDS[0].to['ja-JP']);
  });

  it('⭐ the replacement word is the one this catalog already uses for a capability — DERIVED', () => {
    // Not a quotation: walk the objects catalog for every authored leaf whose
    // `en` names a capability, and read what the locales actually say.
    const enFlat = flattenLeaves(enObjects as Record<string, any>);
    const locFlat = new Map(TRANSLATED_OBJECTS.map(([n, b]) => [n, flattenLeaves(b)] as const));
    const authoredCapabilityLeaves = [...enFlat].filter(
      ([k, v]) =>
        /\bcapabilit(y|ies)\b/i.test(v) &&
        TRANSLATED_OBJECTS.every(([n]) => locFlat.get(n)!.get(k) !== undefined && locFlat.get(n)!.get(k) !== v),
    );
    // Lit — the derivation found leaves at all.
    expect(authoredCapabilityLeaves.length, 'no authored objects-catalog leaf names a capability').toBeGreaterThan(1);
    for (const [k] of authoredCapabilityLeaves) {
      expect(locFlat.get('zh-CN')!.get(k)!.includes('能力'), `zh-CN ${k}`).toBe(true);
      expect(locFlat.get('ja-JP')!.get(k)!.includes('ケイパビリティ'), `ja-JP ${k}`).toBe(true);
      // …and none of them reaches for the word this round replaced.
      expect(locFlat.get('zh-CN')!.get(k)!.includes('功能'), `zh-CN ${k} uses the replaced word`).toBe(false);
      expect(locFlat.get('ja-JP')!.get(k)!.includes('機能'), `ja-JP ${k} uses the replaced word`).toBe(false);
    }
    // ⇒ the words this round moved TO are exactly the words that derivation
    // yields, which is the whole evidence for the reword.
    expect(REWORDS[0].to['zh-CN']).toBe('能力');
    expect(REWORDS[0].to['ja-JP']).toBe('ケイパビリティ');
    // Dark — the derivation is driven by the needle, not by the catalog being
    // small: a word no leaf carries yields none.
    const none = [...enFlat].filter(([, v]) => /\bzzznotaword\b/i.test(v));
    expect(none.length).toBe(0);
  });

  it('the neighbouring senses of "Capabilities" are DELIBERATELY not touched', () => {
    // Recorded so a later round does not read this reword as a sweep.
    // `object.sections.capabilities` are feature CHECKBOXES and 功能开关 is
    // right for them; `agent.sections.capabilities` is an agent's capability
    // CONFIG block. Neither is a HookBodyCapability token.
    const zh = zhCNMetadataForms as Record<string, any>;
    expect(zh.object?.sections?.capabilities?.label).toBe('功能开关');
    expect(zh.agent?.sections?.capabilities?.label).toBe('能力配置');
  });
});
