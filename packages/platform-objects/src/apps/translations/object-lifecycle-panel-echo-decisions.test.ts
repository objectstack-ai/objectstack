// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 10 — the DECISION LEDGER for the object form's DATA LIFECYCLE
// panel (ADR-0057) and for the `email_template` JSON-sample rows.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the nine earlier rounds of
// this card extended: one row per string leaf, each carrying its verdict per
// locale, the reason it was reached, and the `en` source it was judged against.
//
// ## What this round took — the WHOLE remainder of #19403
//
// Two populations, each DERIVED from a spec-side source that manufactures its
// leaves, never hand-listed:
//
//   (1) `object.fields.lifecycle.*` — 32 `en` leaves (16 `label` + 16
//       `helpText`), echoing in `ja-JP` AND `es-ES` while `zh-CN` had all 32
//       authored. Round 8 saw them, named them by shape and DEFERRED them
//       (`DEFERRED_SUBTREE = 'lifecycle'`, `RECORDED_DEFERRAL = 32`); round 9
//       repaired that bound so the round which empties it leaves round 8's file
//       green. This is that round.
//   (2) `email_template.fields.variables.helpText` — 1 `en` leaf, same two
//       locales. It did not ride round 9 because that round's declared file
//       surface was `report.*`.
//
// => 33 `en` leaves x 2 locales = 66 locale-leaves. Re-measured on base
// 236cec19a before a word was written, and the reading is below.
//
// ## ⭐ The sibling locale is EVIDENCE, ⛔ not a translation
//
// `zh-CN` had answered all thirty-three with authored words. That is the
// strongest asset any round of this card has had and the sharpest trap: it
// proves the `ja-JP`/`es-ES` leaves are unauthored FILLS (one hand looked at
// these concepts and wrote Chinese; nothing wrote Japanese or Spanish), and it
// settles what each leaf MEANS. It does ⛔ not tell anyone the Japanese or the
// Spanish word. Every row below therefore says which of the two it leaned on —
// the `en` source and the live schema for the CONTRACT, `zh-CN` for the
// CONCEPT — and each locale is rendered on its own terms from its own catalog's
// authored twins.
//
// ⚠️ And `zh-CN`'s own choices are not automatically right to copy. `TTL 过期`
// keeps the machine token `TTL` verbatim, which is a decision with a reason;
// this round keeps it and ASSERTS it with a predicate that can say NO. Where
// this round DEPARTS from `zh-CN` — `lifecycle.storage.label`, which `zh-CN`
// expands to 存储策略 while an exact authored twin for the bare word sits one
// line up in this same panel — the row says so and says why.
//
// ## ⚠️⚠️ The phantom-translation trap, and this family is made of it
//
// `objectForm` declares NO label on ANY of the sixteen lifecycle fields
// (asserted below, all sixteen). Every `en` label here is therefore the
// extractor's `humanizeFieldPath` of the field path, ⛔ not English anybody
// wrote — and one of them is WRONG English: `lifecycle.ttl` humanizes to
// `"Ttl"`, whose correct English is `"TTL"`, the initialism the form's own
// helpText and `LifecycleSchema`'s own TSDoc both spell.
//
// => Correcting `"Ttl"` to `"TTL"` would differ in bytes, satisfy the echo
//    predicate in all three locales, drop this card's census by a leaf and tell
//    a Japanese author NOTHING. It is ⛔ NOT done here, it does ⛔ not discharge
//    the row, and the row is decided against the CONCEPT. Round 8 recorded the
//    identical shape on `enable.apiEnabled` (`"Api Enabled"` / `"API Enabled"`)
//    and it is still unfiled; this is the second instance of one producer.
//
// ## ⭐ One schema key, one rendering — what was copied and what was NOT
//
// Rounds 8 and 9 both delivered this by copying an authored twin byte for byte
// and asserting the copy. This round copies where a twin exists — and where
// none exists it SAYS SO in the row rather than leaning on one. Three families
// have NO authored twin in either catalog and the rows name that fact:
// `shard` (ja/es), `driver` (ja/es) and `telemetry` (ja/es); `cold` too.
//
// ⚠️ And one twin was LOOKED UP AND REFUSED: `sys_oauth_resource.fields
// .access_token_ttl.label` ("Access Token TTL") is byte-identical in all three
// locales and looks like a standing decision to keep `TTL` verbatim. It is not
// a decision at all — it carries a provenance row in `zh-CN`'s companion too,
// so it is an unauthored fill in every locale. It is asserted below as a fill
// precisely so nobody leans on it later. The `TTL` verdict rests on `zh-CN`'s
// own authored answers and on round 7's landed machine-token treatment instead.
//
// ## ⭐ The second population is three-quarters its own control
//
// `emailTemplateForm`'s JSON-sample rows are derived by ONE shape predicate —
// `widget: 'json'` — which reaches exactly two fields, `variables` and
// `fromOverride`, four leaves. THREE of the four were already authored and come
// back NON-ECHOING in the same walk; only `variables.helpText` was a fill. And
// `fromOverride.helpText` is not merely a control, it is the exact structural
// twin this row copies: the same shape (a bare JSON worked example as the whole
// `en` string), on the same form, already answered 示例：/ 例: / Ejemplo: with
// the JSON kept byte-identical. One leaf of a matched pair authored and the
// other a byte copy is the strongest evidence this file holds that the echo was
// a fill.
//
// ## The instrument, with its controls — re-taken on base 236cec19a
//
//   en string leaves / `.label` leaves            893 / 538
//   ⭐ POSITIVE CONTROL, labels genuinely translated 538 (zh-CN) · 522 · 522
//   the card's headline (`.label` echoing in ALL THREE)   0
//   per-locale `.label` echoes                    0 / 16 / 16
//   every string leaf echoing, per locale         0 / 33 / 33
//
// After: the positive control reads 538 · 538 · 538 (+16 in each of the two
// locales, unchanged in `zh-CN`) and EVERY count above reads 0. ⛔ The headline
// read 0 BEFORE this round too — it is blind to a two-locale echo — so the two
// predicates are asserted as DIFFERENT QUESTIONS below, on a synthetic catalog
// where the all-three one returns 0 while the per-locale one does not.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf is
// still a byte copy of the source revision, under a `metadataForms.` prefix the
// bundles themselves do not carry. All 33 leaves carried one in `ja-JP` and
// `es-ES` and NONE in `zh-CN`; `pnpm i18n:extract` dropped exactly those 66 rows
// and added none, which is asserted below as SET EQUALITY.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { objectForm, LifecycleSchema, LifecycleClassSchema, LIFECYCLE_DURATION_REGEX } from '@objectstack/spec/data';
import { emailTemplateForm } from '@objectstack/spec/system';

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

type Rec = Record<string, any>;

const FORMS: ReadonlyArray<readonly [string, Rec]> = [
  ['zh-CN', zhCNMetadataForms as Rec],
  ['ja-JP', jaJPMetadataForms as Rec],
  ['es-ES', esESMetadataForms as Rec],
];

const OBJECTS: ReadonlyArray<readonly [string, Rec]> = [
  ['zh-CN', zhCNObjects as Rec],
  ['ja-JP', jaJPObjects as Rec],
  ['es-ES', esESObjects as Rec],
];

const PROVENANCE: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['zh-CN', zhCNGeneratedSourceHashes],
  ['ja-JP', jaJPGeneratedSourceHashes],
  ['es-ES', esESGeneratedSourceHashes],
];

/** The two locales this round decides. `zh-CN` had already authored all 33. */
const DECIDED_LOCALES = ['ja-JP', 'es-ES'] as const;

function flattenLeaves(o: Rec, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') for (const [a, b] of flattenLeaves(v as Rec, p)) out.set(a, b);
  }
  return out;
}

const FLAT_FORMS = new Map<string, Map<string, string>>([
  ['en', flattenLeaves(enMetadataForms as Rec)],
  ...FORMS.map(([l, f]) => [l, flattenLeaves(f)] as const),
]);
const FLAT_OBJECTS = new Map<string, Map<string, string>>([
  ['en', flattenLeaves(enObjects as Rec)],
  ...OBJECTS.map(([l, f]) => [l, flattenLeaves(f)] as const),
]);

/** A twin lookup that spans BOTH catalogs — several rows copy from `objects.`. */
const twinValue = (catalog: 'metadataForms' | 'objects', key: string, locale: string): string | undefined =>
  (catalog === 'metadataForms' ? FLAT_FORMS : FLAT_OBJECTS).get(locale)?.get(key);

/** `translate` — the echo was an unauthored fill. `echo` — the English IS the rendering. */
type Verdict = 'translate' | 'echo';

/**
 * A copy this row makes from an authored twin, asserted against the LIVE
 * catalogs so the two positions can only ever move together.
 *
 * Per-locale mode:
 *   `in`   — this leaf's rendering CONTAINS the twin's whole value.
 *   `from` — the twin's whole value CONTAINS this leaf's rendering (the leaf is
 *            a word lifted out of an authored sentence).
 *   anything else — a literal FRAGMENT that must appear in BOTH. Used where the
 *            copy is a head noun rather than a whole value; the fragment is the
 *            shared bytes, so the assertion is still about the twin.
 *
 * Comparison is case-insensitive: Spanish sentence-cases a copied noun phrase
 * when it lands mid-string, and case carries no information in CJK or kana.
 */
interface Copy {
  catalog: 'metadataForms' | 'objects';
  key: string;
  modes: Readonly<Record<string, string>>;
}

interface Decision {
  /** Which derived population this row belongs to — asserted, never asserted-by-name. */
  population: 'lifecycle' | 'email-json';
  /** The metadata type whose `fields` map holds this key. */
  type: 'object' | 'email_template';
  /** The field path under `<type>.fields` — also the bundle key. */
  path: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'helpText';
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle AND to the live form declaration that manufactures it, so a reworded
   * source reds this file instead of leaving a decision standing over text
   * nobody judged.
   */
  en: string;
  /** The verdict per translated locale. */
  verdict: Readonly<Record<string, Verdict>>;
  /** Why — recorded for `translate` as much as for `echo`. */
  reason: string;
  /** Required for every `echo` verdict: why the English is right in THAT locale. */
  departures?: Readonly<Record<string, string>>;
  /** Machine tokens that must survive VERBATIM in EVERY locale, `zh-CN` included. */
  verbatim?: readonly string[];
  /** Authored twins this row copies, asserted per locale against the live tree. */
  copies?: readonly Copy[];
}

const BOTH_TRANSLATE: Readonly<Record<string, Verdict>> = {
  'ja-JP': 'translate',
  'es-ES': 'translate',
};

/** The `agent` panel's own authored `Lifecycle` — the head noun two rows copy. */
const AGENT_LIFECYCLE: Copy = {
  catalog: 'metadataForms',
  key: 'agent.fields.lifecycle.label',
  modes: { 'ja-JP': 'in', 'es-ES': 'in' },
};

const DECISIONS: readonly Decision[] = [
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle',
    prop: 'label',
    en: 'Lifecycle',
    verdict: BOTH_TRANSLATE,
    verbatim: [],
    copies: [AGENT_LIFECYCLE],
    reason:
      'THE HEAD NOUN IS COPIED FROM AN EXACT AUTHORED TWIN and then QUALIFIED, because the bare word is already spent. agent.fields.lifecycle.label carries the IDENTICAL English string and is 生命周期 / ライフサイクル / Ciclo de vida — but it names the AGENT conversation state machine, a different concept on a different panel, and this block is ADR-0057 DATA lifecycle. Leaving both as the bare word would collide two contracts on one rendering. ⇒ the twin is copied and the catalog word for "data" is prefixed: データ from object.sections.fields.description (データモデル), datos from the same twin (modelo de datos). ⇒ データライフサイクル / Ciclo de vida de los datos. ⭐ CONCEPT settled by zh-CN, which reached the same qualification independently (数据生命周期 against the agent panel plain 生命周期); the WORDS come from each locale own authored twin, and the containment of the twin is asserted below.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle',
    prop: 'helpText',
    en: 'Data lifecycle contract (ADR-0057): how long rows live and how space is reclaimed. Leave empty for permanent record semantics. Non-record classes require at least one bounding policy (retention, TTL, or rotation).',
    verdict: BOTH_TRANSLATE,
    verbatim: ['ADR-0057', 'record', 'TTL'],
    copies: [
      { catalog: 'objects', key: 'sys_setting.description', modes: { 'ja-JP': 'コントラクト', 'es-ES': 'contrato' } },
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
    ],
    reason:
      'THE SENTENCE NAMES THREE MACHINE TOKENS AND ALL THREE STAY VERBATIM — ADR-0057, the class value `record`, and TTL — asserted by the token guard below in every locale including zh-CN, which is what makes the rule a reading rather than this round house style. "contract" takes the authored twin sys_setting.description (SettingsManifest コントラクト / el contrato SettingsManifest), so ja takes the katakana the catalog already spends on this word rather than 契約. "rows" takes report.fields.rows.label 行 / Filas. ⚠️ "Leave empty" takes the catalog own authored idiom for the empty input, ⛔ not a literal: sys_user._actions.create_user.params.password.label is （空欄の場合は自動生成）/ (dejar en blanco para generarla) ⇒ 空欄 / en blanco. ⇒ ja データライフサイクルのコントラクト（ADR-0057）: 行をどれだけ保持し、容量をどう回収するか。空欄の場合は永続的な record セマンティクスになります。record 以外のクラスは、少なくとも 1 つの境界ポリシー（保持期間、TTL、ローテーション）を宣言する必要があります。 / es Contrato de ciclo de vida de los datos (ADR-0057): cuánto viven las filas y cómo se recupera el espacio. Déjalo en blanco para una semántica record permanente. Las clases distintas de record requieren al menos una política acotante (retención, TTL o rotación). ⚠️ Punctuation copied rather than chosen: ja takes full-width （） and 。 from object.fields.datasource.helpText one row up, es keeps ASCII from the same twin.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.class',
    prop: 'label',
    en: 'Class',
    verdict: BOTH_TRANSLATE,
    copies: [AGENT_LIFECYCLE],
    reason:
      'THE HUMANIZE IS A BARE WORD AND THE BARE WORD IS AMBIGUOUS IN BOTH LOCALES. objectForm declares no label (asserted), so "Class" is humanizeFieldPath of the path leaf; bare クラス and bare Clase read as a programming class or a CSS class, and the form nests this row under a composite whose own label is now the qualified one. ⇒ qualified with the parent block, copying AGENT_LIFECYCLE the same way the row above does: ライフサイクルクラス / Clase de ciclo de vida. ⭐ CONCEPT from the live LifecycleSchema, ⛔ not from zh-CN: `class` is LifecycleClassSchema, a five-member enum (record | audit | telemetry | transient | event) asserted below, i.e. the persistence contract of the object rows — zh-CN independently reached the same qualification (生命周期类别), which is corroboration rather than the source.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.class',
    prop: 'helpText',
    en: 'Persistence contract for the rows of this object',
    verdict: BOTH_TRANSLATE,
    copies: [
      { catalog: 'objects', key: 'sys_setting.description', modes: { 'ja-JP': 'コントラクト', 'es-ES': 'contrato' } },
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
    ],
    reason:
      'EVERY TERM HAS AN AUTHORED TWIN AND THE ROW NAMES EACH. "contract" from sys_setting.description (コントラクト / contrato) — the same twin the block helpText above takes, so the two read as one thing. "rows" from report.fields.rows.label (行 / Filas). "object" from object.sections.fields.description (オブジェクト / objeto), the twin on this very form. ⇒ このオブジェクトの行の永続化コントラクト / Contrato de persistencia de las filas de este objeto. ⚠️ zh-CN wrote 本对象数据的持久化契约, replacing "rows" with 数据 — a reasonable Chinese move that is NOT copied here, because the schema statement is about ROWS specifically (the reaper deletes rows, the archiver copies rows) and both target locales have an authored word for it.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.retention',
    prop: 'label',
    en: 'Retention',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'objects',
        key: 'sys_user._actions.delete_my_account.description',
        modes: { 'ja-JP': '保持', 'es-ES': 'retención' },
      },
    ],
    reason:
      'THE STEM IS COPIED FROM THE ONE AUTHORED TWIN EITHER CATALOG HOLDS FOR THIS SENSE: sys_user._actions.delete_my_account.description says "per the configured retention policy" and is 保留策略 / 保持ポリシー / política de retención ⇒ 保持 / retención, asserted as a shared fragment below. ⚠️ THE TWO LOCALES THEN DEPART ON PURPOSE. es forms the bare nominal cleanly ⇒ Retención. ja cannot: bare 保持 is a verb stem and heads no form row, so it takes the catalog own head noun for a bounded span, 期間 (sys_job_run.fields.duration_ms is 所要時間, hook.fields.retryPolicy.maxRetries is 最大再試行回数 — the pattern is stem + a concrete head) ⇒ 保持期間. ⭐ That choice is load-bearing twice over: lifecycle.archive.keep below copies it back, because LifecycleSchema own guidance pairs `keep` (COLD rows) against `retention.maxAge` (the HOT window) and a reader must see the pairing.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.retention',
    prop: 'helpText',
    en: 'Age-based retention window',
    verdict: BOTH_TRANSLATE,
    copies: [
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
    ],
    reason:
      'THREE WORDS, TWO WITH TWINS AND ONE WITHOUT, AND THE ROW SAYS WHICH. "retention" repeats this block own label, asserted. "rows" from report.fields.rows.label. ⛔ "window" has NO authored twin for the time-span sense in either catalog — the only 「window」 in the corpus is sys_job_queue.fields.idempotency_key.help, where es keeps the English `(queue, window)` verbatim as a tuple of machine names and ja writes ウィンドウ for exactly that tuple. So ja takes ウィンドウ on the strength of that single occurrence and es composes ventana, and neither is presented as a copy. ⇒ 行の経過時間にもとづく保持ウィンドウ / Ventana de retención basada en la antigüedad de las filas. ⚠️ "Age-based" is rendered as the age OF THE ROWS rather than an abstract age, because the schema says so: maxAge reaps by created_at.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.retention.maxAge',
    prop: 'label',
    en: 'Max Age',
    verdict: BOTH_TRANSLATE,
    copies: [
      { catalog: 'metadataForms', key: 'object.fields.fields.maxLength.label', modes: { 'ja-JP': '最大', 'es-ES': 'máxima' } },
    ],
    reason:
      '⭐ THE "Max X" PATTERN IS COPIED FROM AN AUTHORED TWIN ON THIS SAME FORM: object.fields["fields.maxLength"].label ("Max Length") is 最大长度 / 最大長 / Longitud máxima ⇒ ja prefixes 最大, es postposes máxima, each following its own twin word order, asserted as shared fragments. The head noun is "age": ja 経過時間, es antigüedad — ⛔ NO authored twin for either (the catalog 所要時間 in sys_job_run.fields.duration_ms is the ELAPSED-DURATION sense of a finished job, not the age of a row, and it is refused), so both are composed and the row says so. ⇒ 最大経過時間 / Antigüedad máxima. ⭐ Those two head nouns are then re-used by lifecycle.archive.after below, because ADR-0057 requires archive.after to EQUAL retention.maxAge (asserted at the schema) and a reader who cannot see the two rows as the same quantity cannot obey the constraint.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.retention.maxAge',
    prop: 'helpText',
    en: 'Rows older than this (by created_at) are reaped. Duration literal: h/d/w/y, e.g. "30d"',
    verdict: BOTH_TRANSLATE,
    verbatim: ['created_at', 'h/d/w/y', '30d'],
    copies: [
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
      { catalog: 'metadataForms', key: 'hook.fields.events.helpText', modes: { 'ja-JP': '例: ', 'es-ES': 'p. ej.' } },
    ],
    reason:
      '⭐ THREE MACHINE TOKENS KEPT VERBATIM AND ASSERTED — the column name created_at, the unit alphabet h/d/w/y and the sample "30d" — because LIFECYCLE_DURATION_REGEX is asserted below to ACCEPT "30d" and REFUSE "30 days": a reader who copied a rendered sample would author a value the schema rejects, so the literal is not translatable text. The ASCII double quotes around it are copied from object.fields.datasource.helpText one row up, which keeps "default" in ASCII quotes in all three locales. "e.g." takes the catalog own authored spellings from hook.fields.events.helpText (（例: beforeInsert, afterUpdate） / (p. ej. beforeInsert, afterUpdate)) ⇒ 例: / p. ej., asserted. "reaped" is rendered as plain deletion (削除 / se eliminan) rather than a metaphor, matching the schema own describe text ("are deleted by the Reaper"). ⇒ これより古い行（created_at 基準）は削除されます。期間リテラル: h/d/w/y、例: "30d" / Las filas más antiguas que este valor (según created_at) se eliminan. Literal de duración: h/d/w/y, p. ej. "30d".',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.ttl',
    prop: 'label',
    en: 'Ttl',
    verdict: BOTH_TRANSLATE,
    verbatim: ['TTL'],
    reason:
      '⚠️⚠️ THE PHANTOM-TRANSLATION TRAP, AND THE ROW IS DECIDED AGAINST THE CONCEPT, NOT THE BYTES. "Ttl" is not an English rendering anybody wrote: objectForm declares no label on this composite (asserted), so the extractor humanizes the path leaf `ttl` into it, and the correct English is the initialism "TTL" — which the form own helpText one line down and LifecycleSchema own TSDoc both spell. ⇒ touching up the English would differ in bytes, satisfy the echo predicate in all three locales and drop this card census while telling a Japanese author nothing. It is ⛔ NOT done here and it does ⛔ not discharge this row; it is reported as a finding with its producer named. ⭐ TTL ITSELF STAYS VERBATIM in all three — the machine-token treatment round 7 landed for API 端点 / API エンドポイント / Endpoint API, corroborated by zh-CN own authored TTL 过期, and asserted below by a predicate that can say NO. ⛔ It does NOT rest on sys_oauth_resource.fields.access_token_ttl.label, which looks like the same decision and is an unauthored fill in all three locales — asserted as such. The head is each locale own authored word for expiry: ja 期限切れ (sys_invitation.fields.status.options.expired), es caducidad (the same twin reads Caducada, and sys_session.fields.expires_at.label reads Caduca el — the catalog stem is caducar, ⛔ not expirar). ⇒ TTL 期限切れ / Caducidad por TTL.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.ttl',
    prop: 'helpText',
    en: 'Per-row TTL expiry',
    verdict: BOTH_TRANSLATE,
    verbatim: ['TTL'],
    reason:
      'THE SAME TWO STEMS AS THE LABEL ABOVE, plus "per-row" from report.fields.rows.label (行 / filas). ⇒ 行ごとの TTL による期限切れ / Caducidad por TTL de cada fila. ⚠️ es repeats the label wording verbatim as its opening rather than varying it: the helpText of a composite in this catalog restates the row (see object.fields.lifecycle.storage.strategy, whose en helpText "Storage strategy" is literally the row name plus its parent), and varying it would suggest a second concept.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.ttl.field',
    prop: 'label',
    en: 'Field',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'metadataForms',
        key: 'object.fields.fields.summaryOperations.field.label',
        modes: { 'ja-JP': 'in', 'es-ES': 'in' },
      },
      {
        catalog: 'objects',
        key: 'sys_device_code.fields.last_polled_at.help',
        modes: { 'ja-JP': 'タイムスタンプ', 'es-ES': 'marca temporal' },
      },
    ],
    reason:
      '⭐ AN EXACT TWIN EXISTS AND IS COPIED — AND THEN QUALIFIED, WHICH IS THE INTERESTING HALF. object.fields["fields.summaryOperations.field"].label carries the IDENTICAL humanized English "Field", in the IDENTICAL structural position (a bare path leaf inside a composite), and is 字段 / フィールド / Campo. That word is copied and its containment asserted. ⛔ But the precedent answers only the question it contains: there the composite is a roll-up and any child field will do, while here LifecycleSchema declares `field` as the TIMESTAMP the TTL is measured from, and a form row reading only フィールド / Campo inside a TTL block invites an author to name any column. ⇒ qualified with the catalog authored word for a timestamp, sys_device_code.fields.last_polled_at.help (タイムスタンプ / Marca temporal), asserted as a shared fragment. ⇒ タイムスタンプフィールド / Campo de marca temporal. ⭐ zh-CN reached the same qualification (时间字段) from the same source; two hands and one schema agreeing is why this is a derivation and not a preference.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.ttl.field',
    prop: 'helpText',
    en: 'Timestamp field the TTL is measured from (e.g. expires_at)',
    verdict: BOTH_TRANSLATE,
    verbatim: ['TTL', 'expires_at'],
    copies: [
      { catalog: 'metadataForms', key: 'hook.fields.events.helpText', modes: { 'ja-JP': '例: ', 'es-ES': 'p. ej.' } },
    ],
    reason:
      'THE LABEL TERMS RESTATED, plus the column name expires_at kept verbatim (it is a real column an author types, and the schema describe names created_at and expires_at as the two candidates) and the catalog own e.g. spellings copied from hook.fields.events.helpText. ⇒ TTL の起点となるタイムスタンプフィールド（例: expires_at） / Campo de marca temporal desde el que se mide el TTL (p. ej. expires_at). ⚠️ ja takes 起点 for "measured from" rather than a literal calque; the sentence names the ORIGIN of a countdown, and the catalog offers no twin for the measuring verb, which the row records rather than papering over.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.ttl.expireAfter',
    prop: 'label',
    en: 'Expire After',
    verdict: BOTH_TRANSLATE,
    reason:
      'THE HUMANIZE IS A VERB PHRASE AND BOTH LOCALES TAKE A NOMINAL, each following its own siblings on this very panel, which are nominal throughout (最大経過時間 / シャード数 / 保持期間; Antigüedad máxima / Retención / Número de fragmentos). ja 期限切れまでの期間 keeps this block own 期限切れ and this panel own 期間; es Plazo de caducidad keeps the catalog caducar stem and takes plazo, the Spanish head noun for a bounded term. ⛔ NOT es "Caducar después de": a bare infinitive with a dangling preposition reads as a button, and no sibling on this form is spelled that way. ⭐ CONCEPT from the schema, corroborated by zh-CN: expireAfter is a DURATION (LIFECYCLE_DURATION_REGEX, asserted), not a date, so both renderings name a span — the same reading zh-CN reached with 过期时长.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.ttl.expireAfter',
    prop: 'helpText',
    en: 'Rows expire this long after the field, e.g. "1d"',
    verdict: BOTH_TRANSLATE,
    verbatim: ['1d'],
    copies: [
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
      { catalog: 'metadataForms', key: 'hook.fields.events.helpText', modes: { 'ja-JP': '例: ', 'es-ES': 'p. ej.' } },
    ],
    reason:
      'SAME THREE COPIED ELEMENTS AS THE maxAge helpText — rows, the e.g. spelling, and the ASCII-quoted duration literal kept verbatim and asserted. ⇒ 行はこのフィールドの時刻からこの期間が経過すると期限切れになります。例: "1d" / Las filas caducan este tiempo después del campo, p. ej. "1d". ⚠️ ja spells out 「このフィールドの時刻から」 where English says only "after the field": Japanese cannot leave a field standing for its value here, and the schema is explicit that the countdown starts at the timestamp the field holds.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage',
    prop: 'label',
    en: 'Storage',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'metadataForms',
        key: 'object.sections.advanced.description',
        modes: { 'ja-JP': 'from', 'es-ES': 'from' },
      },
    ],
    reason:
      '⭐⭐ THE ONE ROW WHERE THIS ROUND DEPARTS FROM zh-CN, AND THE DEPARTURE IS THE POINT. zh-CN renders this 存储策略 ("storage strategy"), qualifying the bare word — but an EXACT authored twin for the bare word sits in this same panel section heading, object.sections.advanced.description ("State machines, actions, and storage."), which is ステートマシン、アクション、ストレージ。 / Máquinas de estado, acciones y almacenamiento. ⇒ ストレージ / Almacenamiento, lifted from that sentence and asserted by containment. ⛔ zh-CN qualification is NOT copied because it would collide downward: the child row lifecycle.storage.strategy is itself "Strategy", so a parent already called 存储策略 leaves the child with the parent own word. English keeps them distinct and so does this. ⚠️ The word is unambiguous here in a way 「Class」 and 「Field」 were not, which is why those two rows qualified and this one does not — the test is ambiguity in the target locale, ⛔ not a policy of always expanding a humanize.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage',
    prop: 'helpText',
    en: 'Physical rotation for high-frequency telemetry (SQLite: O(1) shard DROP)',
    verdict: BOTH_TRANSLATE,
    verbatim: ['SQLite', 'DROP', 'O(1)'],
    reason:
      '⛔ THREE OF THIS SENTENCE FOUR CONTENT WORDS HAVE NO AUTHORED TWIN IN EITHER CATALOG, AND THE ROW SAYS SO RATHER THAN LEANING ON ONE — the discipline round 5 wrote down on memoryMb and round 8 repeated on `feed`. There is no authored rendering anywhere in these bundles for "shard", for "telemetry" or for "cold storage" in ja-JP or es-ES (probed, zero hits in both catalogs). Composed: ja transliterates, the habit this catalog already follows for a technical noun with no Japanese term of art (データソース, タイムライン, マスキングルール are all authored that way) ⇒ シャード, テレメトリー, ローテーション; es takes its own ordinary terms ⇒ fragmento, telemetría, rotación. ⭐ The machine half is kept verbatim and asserted: SQLite, the DROP statement and the complexity class O(1) — all three are things a reader matches against a driver log, ⛔ not prose. ⇒ 高頻度テレメトリー向けの物理ローテーション（SQLite: O(1) のシャード DROP） / Rotación física para telemetría de alta frecuencia (SQLite: DROP de fragmento en O(1)). ⚠️ es reorders the parenthesis so the complexity class attaches to the operation rather than to the shard, which is what the schema means (SQLite DROPs the oldest shard whole, an O(1) reclaim).',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage.strategy',
    prop: 'label',
    en: 'Strategy',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'objects',
        key: 'sys_metadata.fields.strategy.label',
        modes: { 'ja-JP': 'from', 'es-ES': 'in' },
      },
    ],
    reason:
      'ONE AUTHORED TWIN, AND THE TWO LOCALES TAKE IT DIFFERENTLY BECAUSE THE TWIN ITSELF IS ASYMMETRIC. sys_metadata.fields.strategy.label carries the IDENTICAL English "Strategy" and is 策略 / マージ戦略 / Estrategia — es answered the bare word, ja answered it CONTEXT-EXPANDED (「merge strategy」, because that row is about metadata merge). ⇒ es copies the twin whole (Estrategia, containment asserted), ja takes the twin head noun 戦略 alone (asserted by the reverse containment: the twin contains this rendering). ⛔ What was refused: copying マージ戦略 across, which would tell an author this row picks a MERGE strategy. The live schema says otherwise and it is asserted — storage.strategy is z.literal(rotation), a one-member union.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage.strategy',
    prop: 'helpText',
    en: 'Storage strategy',
    verdict: BOTH_TRANSLATE,
    reason:
      'THE TWO WORDS THIS ROW PARENT AND THIS ROW LABEL ALREADY OWN, joined: ストレージ (from the section heading, via lifecycle.storage.label above) + 戦略 ⇒ ストレージ戦略; Almacenamiento + Estrategia ⇒ Estrategia de almacenamiento. ⭐ zh-CN rendered this leaf 存储策略 — the SAME string it gave the PARENT lifecycle.storage.label, so in zh-CN the composite and its child tooltip read identically. That is a consequence of the zh-CN expansion this ledger declined one row up; ja and es keep the parent and the child distinguishable, exactly as the English does. ⛔ Not filed as a zh-CN defect: it is a landed decision of an earlier hand on a leaf this round does not own, and both strings are authored.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage.shards',
    prop: 'label',
    en: 'Shards',
    verdict: BOTH_TRANSLATE,
    reason:
      '⛔ NO AUTHORED TWIN FOR "shard" IN EITHER CATALOG, IN EITHER LOCALE — probed and stated, ⛔ not borrowed. Composed by each locale own habit (ja transliterates ⇒ シャード, es takes fragmento). ⭐ THE COUNT MARKER IS READ OFF THE LIVE SCHEMA, ⛔ not off the English plural: shards is z.number().int().min(2) whose describe reads "Number of shards retained" (the min is asserted below by refusing shards: 1), so the row names a COUNT and both locales say so — 数 in ja, Número de in es. English "Shards" alone leaves that to the widget; a Japanese form row reading シャード would read as a shard picker. ⭐ zh-CN reached the identical reading with 分片数, from the same schema.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage.shards',
    prop: 'helpText',
    en: 'Shards retained; total window = shards × unit',
    verdict: BOTH_TRANSLATE,
    verbatim: ['×'],
    reason:
      'THE FORMULA IS KEPT AS A FORMULA — the multiplication sign U+00D7 survives verbatim in all three locales (asserted), because the sentence is an equation an author computes, not prose. Its two operands are rendered with the SAME words as the two rows they name, so the equation can be read against the form: シャード数 × 単位 reuses this row label and the unit row label; fragmentos × unidad does the same. ⇒ 保持するシャード数。合計ウィンドウ = シャード数 × 単位 / Número de fragmentos que se conservan; ventana total = fragmentos × unidad. ⚠️ ja replaces the semicolon with 。 and es keeps it: the catalog authored punctuation habit, same as round 8 recorded on permission.sections.system_permissions.description.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage.unit',
    prop: 'label',
    en: 'Unit',
    verdict: BOTH_TRANSLATE,
    reason:
      'THE HUMANIZE IS A BARE WORD AND 「unit」 IS ALREADY SPENT IN BOTH LOCALES BY A DIFFERENT CONCEPT: this catalog authored ビジネスユニット / Unidad de negocio across sys_business_unit and sys_user.primary_business_unit_id, so a form row reading ユニット / Unidad inside an object panel reads as an org node. ⇒ qualified with this block own word, exactly as the shards row above: シャード単位 / Unidad de fragmento. ⭐ CONCEPT from the live schema, asserted: unit is z.enum([day, week, month]) whose describe is "Time width of one shard" — it is the width of a SHARD, so the qualifier is the schema own and not a disambiguation invented for the UI. ⛔ NOT rendered as 期間 / periodo: that would collide with the retention and expireAfter rows, which really are durations, while this is a granularity.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.storage.unit',
    prop: 'helpText',
    en: 'Time width of one shard',
    verdict: BOTH_TRANSLATE,
    reason:
      'THE LABEL TERMS RESTATED WITH THE SCHEMA OWN NOUN: シャード 1 つあたりの時間幅 / Amplitud temporal de un fragmento. ⚠️ ja writes the numeral 1 with spaces around it, which is this catalog authored habit for a digit inside Japanese running text (hook.fields.body.memoryMb.helpText is 呼び出しごとのメモリ上限（MB、最大 256）, sys_oauth... spells 256 KiB the same way). ⛔ No twin for "width" in this sense in either catalog; composed, and the row says so.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive',
    prop: 'label',
    en: 'Archive',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'objects',
        key: 'sys_metadata.fields.state.options.archived',
        modes: { 'ja-JP': 'from', 'es-ES': 'in' },
      },
    ],
    reason:
      'THE STEM IS COPIED FROM AN AUTHORED TWIN THAT EXISTS TWICE OVER: sys_metadata.fields.state.options.archived and sys_view_definition.fields.state.options.archived are both アーカイブ済み / Archivado (the view one reads Archivada, agreeing with its own feminine head). ⇒ ja takes the stem without the 済み completion marker, because this row names a POLICY that will run and not a state a row has reached — asserted by the reverse containment (the twin contains this rendering). es copies the masculine Archivado whole, which in Spanish reads as the act of archiving. ⇒ アーカイブ / Archivado. ⭐ zh-CN 归档 agrees on the act-not-state reading.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive',
    prop: 'helpText',
    en: 'Cold-store hand-off (audit class). Rows are never hot-deleted before the archive copy succeeded.',
    verdict: BOTH_TRANSLATE,
    verbatim: ['audit'],
    copies: [
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
    ],
    reason:
      '⭐ `audit` IS A MACHINE VALUE AND STAYS VERBATIM — asserted below, and asserted at the schema: LifecycleClassSchema is a five-member enum whose members include audit, so the parenthesis names a value an author types into the class row above, ⛔ not the English word for auditing (which this catalog does translate elsewhere: sys_metadata_audit.label is メタデータ監査 / Auditoría de metadatos). Rendering it would send an author to type 監査. ⛔ "cold store" has no authored twin in either locale (probed, zero hits) and is composed — コールドストレージ / almacenamiento en frío — which the row states. "rows" copied from report.fields.rows.label. ⇒ コールドストレージへの引き渡し（audit クラス）。アーカイブのコピーが成功する前に、行がホット側から削除されることはありません。 / Traspaso al almacenamiento en frío (clase audit). Las filas nunca se eliminan en caliente antes de que la copia de archivado haya finalizado correctamente. ⚠️ Both locales keep the guarantee in the NEGATIVE ("never ... before"), which is the durability claim the schema makes; turning it positive would read as best-effort.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive.after',
    prop: 'label',
    en: 'After',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'metadataForms',
        key: 'object.fields.lifecycle.retention.maxAge.label',
        modes: { 'ja-JP': '経過時間', 'es-ES': 'antigüedad' },
      },
    ],
    reason:
      '⭐⭐ THE HEAD NOUN IS COPIED FROM ANOTHER ROW OF THIS LEDGER, AND THE SCHEMA IS WHY. ADR-0057 requires archive.after to EQUAL retention.maxAge — asserted below by a parse that is REFUSED when they differ — so the two rows are the same quantity measured once, and a reader who cannot see that in the form cannot satisfy the constraint. ⇒ both take the maxAge row head noun: アーカイブ対象の経過時間 / Antigüedad de archivado, containment asserted against the live sibling leaf so the two can only ever move together. ⛔ The bare humanize "After" is unrenderable as a label in either locale (a bare preposition heads no form row), which is why this is a qualification and not an expansion of taste. ⚠️ DEPARTS FROM zh-CN, which wrote 归档时点 ("archive point in time"): a point is what the runtime computes, an AGE is what the author types, and the schema types it as a duration literal.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive.after',
    prop: 'helpText',
    en: 'Archive rows older than this — must equal retention.maxAge',
    verdict: BOTH_TRANSLATE,
    verbatim: ['retention.maxAge'],
    copies: [
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
    ],
    reason:
      'THE METADATA PATH retention.maxAge STAYS VERBATIM (asserted) — it is the key an author writes, and the schema refusal message quotes it back. "rows" copied. ⇒ これより古い行をアーカイブします — retention.maxAge と一致している必要があります / Archiva las filas más antiguas que este valor — debe coincidir con retention.maxAge. ⚠️ The SPACED em dash is copied rather than chosen: the en source spaces it, zh-CN kept it spaced on this very leaf, and permission.sections.system_permissions.description carries the same spaced form in ja and es. ⭐ The obligation is rendered as an obligation in both (必要があります / debe), ⛔ not as advice — a mismatch is a parse failure, asserted below.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive.to',
    prop: 'label',
    en: 'To',
    verdict: BOTH_TRANSLATE,
    copies: [
      { catalog: 'metadataForms', key: 'object.fields.datasource.label', modes: { 'ja-JP': 'in', 'es-ES': 'in' } },
    ],
    reason:
      '⭐ THE HEAD NOUN IS COPIED BYTE FOR BYTE FROM AN AUTHORED TWIN ON THIS SAME PANEL, four rows up: object.fields.datasource.label ("Datasource") is 数据源 / データソース / Fuente de datos, and datasource.label is ALSO the top-level metadata type label in this catalog (datasource.label, the same three words) — the two agreed with each other before this round, so the copy is a derivation and not a pick. ⇒ アーカイブ先データソース / Fuente de datos de archivado, containment asserted. ⛔ The humanize "To" is a bare preposition and unrenderable as a label in either locale. ⭐ The schema is what names the head: `to` is z.string() describing "Target datasource name for cold storage", so the qualifier is read off the contract, and zh-CN 归档数据源 agrees.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive.to',
    prop: 'helpText',
    en: 'Target datasource name for cold storage',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'metadataForms',
        key: 'object.fields.datasource.helpText',
        modes: { 'ja-JP': '対象データソース', 'es-ES': 'fuente de datos de destino' },
      },
    ],
    reason:
      '⭐ THE WHOLE NOUN PHRASE IS COPIED FROM THE AUTHORED TWIN ONE PANEL ROW UP, asserted as a shared fragment: object.fields.datasource.helpText ("Target datasource ID") is 对象数据源 ID / 対象データソース ID（既定: "default"）/ ID de fuente de datos de destino ⇒ 対象データソース / fuente de datos de destino, with ID swapped for 名 / Nombre because this schema field is the datasource NAME and the other is its ID (both asserted at their own declarations). ⇒ コールドストレージ用の対象データソース名 / Nombre de la fuente de datos de destino para el almacenamiento en frío. ⛔ "cold storage" is composed, as on the archive block above, and the row says so again rather than pointing at the sibling as though it were a twin.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive.keep',
    prop: 'label',
    en: 'Keep',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'metadataForms',
        key: 'object.fields.lifecycle.retention.label',
        modes: { 'ja-JP': 'in', 'es-ES': 'in' },
      },
    ],
    reason:
      '⭐⭐ COPIED WHOLE FROM ANOTHER ROW OF THIS LEDGER, AND THE SCHEMA OWN GUIDANCE IS THE REASON. LifecycleSchema archive block tells an author who writes `keep` in the wrong place: 「`keep` belongs to the archive block ... it is how long COLD rows are kept. The HOT window is `retention.maxAge`」 — the two are one distinction, and rendering them with unrelated words would hide it. ⇒ this row takes the retention row rendering WHOLE and qualifies it with the archive one: アーカイブ保持期間 / Retención en archivado, containment asserted against the live sibling leaf. ⛔ The humanize "Keep" is a bare verb and unrenderable as a label in either locale. ⭐ zh-CN 归档保留 reached the same pairing.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.archive.keep',
    prop: 'helpText',
    en: 'How long the archive keeps rows (empty = forever), e.g. "7y"',
    verdict: BOTH_TRANSLATE,
    verbatim: ['7y'],
    copies: [
      { catalog: 'metadataForms', key: 'report.fields.rows.label', modes: { 'ja-JP': '行', 'es-ES': 'filas' } },
      { catalog: 'metadataForms', key: 'hook.fields.events.helpText', modes: { 'ja-JP': '例: ', 'es-ES': 'p. ej.' } },
    ],
    reason:
      'THE DURATION LITERAL "7y" IS KEPT VERBATIM IN ASCII QUOTES and asserted, on the same reading as maxAge: LIFECYCLE_DURATION_REGEX accepts it and refuses prose. "empty" takes the catalog own authored idiom for a blank input — sys_user._actions.create_user.params.password.label is （空欄の場合は自動生成）/ (dejar en blanco para generarla) ⇒ 空欄 / en blanco — ⛔ not a literal "vacío", which no authored leaf in either catalog uses for this. "rows" and the e.g. spelling copied as elsewhere. ⇒ アーカイブが行を保持する期間（空欄 = 無期限）。例: "7y" / Cuánto tiempo conserva las filas el archivado (en blanco = para siempre), p. ej. "7y". ⚠️ The `=` is kept as a symbol in both, matching the source and this catalog habit for a key-to-meaning gloss.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.reclaim',
    prop: 'label',
    en: 'Reclaim',
    verdict: BOTH_TRANSLATE,
    reason:
      '⛔ NO AUTHORED TWIN FOR THE DISK-SPACE SENSE IN EITHER CATALOG, AND ONE NEAR TWIN WAS LOOKED UP AND REFUSED. ja: every 領域 this catalog holds is the LAYOUT-REGION sense (page.sections.layout.description, page.fields.regions.helpText, app.fields.areas.label = 領域), so reusing it would collide two concepts on one word; composed as 容量の回収. es: the two authored espacio leaves are the layout sense (dashboard.fields.gap.helpText) and the namespace sense (sys_metadata.fields.namespace.label = Espacio de nombres), and Spanish does not distinguish those from disk space lexically anyway, so espacio is taken without a collision ⇒ Recuperación de espacio. ⭐ Both are NOMINAL where the humanize is a verb, following this panel siblings. ⛔ The humanize "Reclaim" is otherwise correct English, so this row is a plain unauthored-fill translation with no English defect behind it — stated, because two siblings on this same panel do have one.',
  },
  {
    population: 'lifecycle',
    type: 'object',
    path: 'lifecycle.reclaim',
    prop: 'helpText',
    en: 'Reclaim driver space after sweeps (default on for non-record classes)',
    verdict: BOTH_TRANSLATE,
    verbatim: ['record'],
    reason:
      '⭐ `record` IS A MACHINE VALUE AND STAYS VERBATIM — asserted, and asserted at LifecycleClassSchema, whose five members include it; "non-record classes" names the four others, so rendering it would send an author to type a word the enum refuses. ⛔ "driver" HAS NO AUTHORED TWIN in either locale (probed, zero hits for ドライバー and for controlador) and the two locales answer it DIFFERENTLY, each by its own catalog habit: ja transliterates ⇒ ドライバー; es keeps the English term verbatim ⇒ driver, the treatment es already gives this platform machine nouns (lookup, preset, permission sets, array all stand un-translated in authored es leaves). ⚠️ That asymmetry is deliberate and recorded: a single policy applied to both locales would be a template, and the instruction is to render each locale on its own terms. "default" takes the authored twin object.fields.datasource.helpText (（既定: "default"）/ valor predeterminado) ⇒ 既定 / de forma predeterminada. ⇒ スイープ後にドライバーの容量を回収します（record 以外のクラスでは既定で有効） / Recupera el espacio del driver después de los barridos (activado de forma predeterminada en las clases distintas de record).',
  },
  {
    population: 'email-json',
    type: 'email_template',
    path: 'variables',
    prop: 'helpText',
    en: '[{ "name": "user.name", "type": "string", "required": true, "description": "..." }]',
    verdict: BOTH_TRANSLATE,
    copies: [
      {
        catalog: 'metadataForms',
        key: 'email_template.fields.fromOverride.helpText',
        modes: { 'ja-JP': '例: ', 'es-ES': 'Ejemplo: ' },
      },
    ],
    reason:
      '⭐⭐ AN EXACT STRUCTURAL TWIN, ON THE SAME FORM, DERIVED BY THE SAME PREDICATE, ALREADY ANSWERED — and it is what makes this echo provably a fill rather than a decision. email_template.fields.fromOverride.helpText is the other widget: json row of emailTemplateForm and its whole en string is a bare JSON worked example too; it is 示例：{...} / 例: {...} / Ejemplo: {...}, with the JSON byte-identical inside. One leaf of a matched pair authored by a translator and the other left as a byte copy: one leaf cannot be a decision and a fill at once. ⇒ the lead-in is COPIED from that twin (例:  / Ejemplo: , asserted as a shared fragment) and the JSON SAMPLE IS KEPT BYTE-IDENTICAL, asserted in all three locales as containment of the whole en string. ⭐ Keeping it verbatim is this catalog own convention and load-bearing here: the keys name, type, required and description are read by sendTemplate(), so a reader who copied a rendered sample would author a template the service rejects. ⛔ What was refused: translating the description value "..." or the sample name "user.name" — both are inside the JSON the author copies. ⚠️ The verdict is `translate`, ⛔ NOT `echo`, and the distinction is the whole row: the JSON is untranslatable, but the LEAF was not — a bare sample with no lead-in tells a Japanese reader nothing about what it is, which is exactly why the sibling row got one.',
  },
];

// ---------------------------------------------------------------------------
// The two populations, DERIVED — one from a SCHEMA SHAPE, one from a WIDGET.
// ---------------------------------------------------------------------------

type FormSection = { name?: string; label?: string; collapsed?: boolean; fields?: unknown[] };
type FormField = { field?: string; label?: unknown; helpText?: unknown; widget?: unknown; type?: unknown; fields?: unknown[] };

const OBJECT_SECTIONS = ((objectForm as { sections?: unknown[] }).sections ?? []) as FormSection[];
const EMAIL_SECTIONS = ((emailTemplateForm as { sections?: unknown[] }).sections ?? []) as FormSection[];

interface FormRow {
  section: string;
  /** Dotted field path, accumulated exactly as the extractor `walkFormField` does. */
  path: string;
  /** Whether the form declares an explicit label — false means the `en` leaf is a humanize. */
  declaresLabel: boolean;
  helpText?: string;
  widget?: string;
}

function walkFormFields(field: FormField, section: string, parent: string, out: FormRow[]): void {
  if (!field || typeof field !== 'object') return;
  const name = typeof field.field === 'string' ? field.field : undefined;
  const path = name ? (parent ? `${parent}.${name}` : name) : parent;
  if (path) {
    out.push({
      section,
      path,
      declaresLabel: typeof field.label === 'string',
      helpText: typeof field.helpText === 'string' ? field.helpText : undefined,
      widget: typeof field.widget === 'string' ? field.widget : undefined,
    });
  }
  if (Array.isArray(field.fields)) for (const c of field.fields) walkFormFields(c as FormField, section, path, out);
}

/** Section name exactly as the extractor derives it (`normalizeSectionName`). */
const sectionName = (s: FormSection): string =>
  typeof s.name === 'string' && s.name.length > 0
    ? s.name
    : String(s.label ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function formRows(sections: readonly FormSection[]): FormRow[] {
  const out: FormRow[] = [];
  for (const s of sections) for (const c of s.fields ?? []) walkFormFields(c as FormField, sectionName(s), '', out);
  return out;
}

const OBJECT_ROWS = formRows(OBJECT_SECTIONS);
const EMAIL_ROWS = formRows(EMAIL_SECTIONS);

/**
 * ⭐ THE FIRST SHAPE PREDICATE — read off the LIVE SCHEMA, never off a name.
 *
 * `LifecycleSchema` declares exactly six top-level keys; the form composite that
 * manufactures this panel is the one whose DIRECT children are exactly those six.
 * So the population follows a rename of the form field, grows when ADR-0057 grows,
 * and can be wrong in a way a `startsWith('lifecycle')` walk never could.
 */
const LIFECYCLE_SHAPE_KEYS = Object.keys(((LifecycleSchema as any).shape ?? {}) as Rec).sort();

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const directChildNames = (f: FormField): string[] =>
  (Array.isArray(f.fields) ? f.fields : []).map((c) => String((c as FormField).field)).sort();

function schemaShapedRoots(): FormField[] {
  const found: FormField[] = [];
  const visit = (f: FormField): void => {
    if (!f || typeof f !== 'object') return;
    if (sameSet(directChildNames(f), LIFECYCLE_SHAPE_KEYS)) found.push(f);
    for (const c of f.fields ?? []) visit(c as FormField);
  };
  for (const s of OBJECT_SECTIONS) for (const c of s.fields ?? []) visit(c as FormField);
  return found;
}

const LIFECYCLE_ROOTS = schemaShapedRoots();
const LIFECYCLE_ROOT_PATH = LIFECYCLE_ROOTS.length === 1 ? String(LIFECYCLE_ROOTS[0].field) : '\u0000NONE';
const inLifecycle = (path: string): boolean =>
  path === LIFECYCLE_ROOT_PATH || path.startsWith(`${LIFECYCLE_ROOT_PATH}.`);

/** ⭐ THE SECOND SHAPE PREDICATE — the `json`-widget rows of the email template form. */
const EMAIL_JSON_ROWS = EMAIL_ROWS.filter((r) => r.widget === 'json');

interface PanelLeaf {
  population: 'lifecycle' | 'email-json';
  type: 'object' | 'email_template';
  path: string;
  prop: string;
  en: string;
}

function leavesOf(
  population: 'lifecycle' | 'email-json',
  type: 'object' | 'email_template',
  rows: readonly FormRow[],
): PanelLeaf[] {
  const fields = ((enMetadataForms as Rec)[type]?.fields ?? {}) as Rec;
  const out: PanelLeaf[] = [];
  for (const row of rows) {
    const entry = fields[row.path];
    if (!entry || typeof entry !== 'object') continue;
    for (const [prop, value] of Object.entries(entry as Rec)) {
      if (typeof value === 'string') out.push({ population, type, path: row.path, prop, en: value });
    }
  }
  return out;
}

const LIFECYCLE_LEAVES = leavesOf('lifecycle', 'object', OBJECT_ROWS.filter((r) => inLifecycle(r.path)));
const EMAIL_JSON_LEAVES = leavesOf('email-json', 'email_template', EMAIL_JSON_ROWS);
const PANEL_LEAVES = [...LIFECYCLE_LEAVES, ...EMAIL_JSON_LEAVES];

/** Everything these two forms manufacture that this round did NOT take. */
const OUTSIDE_LEAVES = [
  ...leavesOf('lifecycle', 'object', OBJECT_ROWS.filter((r) => !inLifecycle(r.path))),
  ...leavesOf('email-json', 'email_template', EMAIL_ROWS.filter((r) => r.widget !== 'json')),
];

const leafKey = (l: { type: string; path: string; prop: string }): string => `${l.type}.fields.${l.path}.${l.prop}`;
const idOf = (d: Decision): string => leafKey(d);
const live = (locale: string, l: { type: string; path: string; prop: string }): string | undefined =>
  FLAT_FORMS.get(locale)?.get(leafKey(l));

/** The provenance-table key for a decided leaf — the `metadataForms.` prefix is the whole point. */
const provenanceKey = (l: { type: string; path: string; prop: string }): string => `metadataForms.${leafKey(l)}`;

/** Match the extractor fallback label for form fields that declare none. */
function humanizeFieldPath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Token presence judged on UNICODE word boundaries, ⛔ NOT substring containment.
 *
 * Round 9 recorded this predicate LIMIT and this round asserts it executably
 * rather than restating it: Japanese writes no word boundaries, so
 * `キャンセル` CONTAINS `セル` — a substring guard would flag a token that is not
 * there — while this predicate correctly says no, AND it also says no to a
 * GENUINE standalone `セル` inside running kana (`このセルを編集`). The guard is
 * therefore sound and INCOMPLETE on kana, and both halves are proved below.
 */
function carriesToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

const fold = (s: string): string => s.toLowerCase();

/** Every `echo` verdict that carries no per-locale departure reason. */
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

/** The card headline predicate — a leaf echoing in ALL THREE locales. */
const echoesInAllThree = (catalogs: ReadonlyArray<readonly [string, Map<string, string>]>, key: string, en: string): boolean =>
  catalogs.every(([, m]) => m.get(key) === en);

/** The per-locale predicate — a leaf echoing in AT LEAST ONE locale. */
const echoesSomewhere = (catalogs: ReadonlyArray<readonly [string, Map<string, string>]>, key: string, en: string): boolean =>
  catalogs.some(([, m]) => m.get(key) === en);

describe('#19403 round 10 — the ledger itself (controls before verdicts)', () => {
  it('decides every string leaf of the remainder this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 33 leaves, two locales, 66 decisions.
    expect(DECISIONS.length).toBe(33);
    expect(DECISIONS.filter((d) => d.prop === 'label').length).toBe(16);
    expect(DECISIONS.filter((d) => d.prop === 'helpText').length).toBe(17);
    expect(DECISIONS.filter((d) => d.population === 'lifecycle').length).toBe(32);
    expect(DECISIONS.filter((d) => d.population === 'email-json').length).toBe(1);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(66);
    expect(new Set(DECISIONS.map((d) => idOf(d))).size, 'a leaf is decided twice').toBe(33);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names the two locales this round decides`).toEqual([
        'es-ES',
        'ja-JP',
      ]);
    }
  });

  it('⭐ zh-CN is deliberately absent from every verdict — and it really had all 33 authored', () => {
    // The row shape says this round decides two locales. That is only honest if
    // the third was already answered, so the claim is MEASURED, not asserted by
    // the absence of a key: zh-CN differs from `en` on every one of the 33, and
    // its provenance table records none of them as a fill.
    const zh = FLAT_FORMS.get('zh-CN')!;
    const table = zhCNGeneratedSourceHashes as Readonly<Record<string, string>>;
    const stillEchoing = DECISIONS.filter((d) => zh.get(idOf(d)) === d.en).map((d) => idOf(d));
    expect(stillEchoing, 'zh-CN echoes a leaf this round assumed it had authored').toEqual([]);
    const recordedAsFill = DECISIONS.filter((d) => table[provenanceKey(d)] !== undefined).map((d) => idOf(d));
    expect(recordedAsFill, 'zh-CN records one of these leaves as an unauthored fill').toEqual([]);
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        FLAT_FORMS.get('en')!.get(idOf(d)),
        `en ${idOf(d)} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('⭐ …and to the FORM that manufactures it — the third leg', () => {
    // The `en` leaf is not authored in this package: the forms in `packages/spec`
    // declare the helpText, and the extractor derives every label here from the
    // field path. Pinning only the catalog would leave a decision standing over
    // text the form had since reworded.
    const rowsFor = (d: Decision): FormRow[] => (d.type === 'object' ? OBJECT_ROWS : EMAIL_ROWS);
    for (const d of DECISIONS) {
      const row = rowsFor(d).find((r) => r.path === d.path);
      expect(row, `${d.type}.${d.path} is no longer declared by its form`).toBeDefined();
      if (d.prop === 'helpText') {
        expect(row!.helpText, `the form no longer declares this helpText (${idOf(d)})`).toBe(d.en);
      } else {
        // No declared label ⇒ the English is the extractor humanize of the field
        // path, which is the premise of the whole phantom-translation section.
        expect(row!.declaresLabel, `${d.path} now declares its own label — re-judge the row`).toBe(false);
      }
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must flag all 33, or a green verdict run
    // means nothing.
    const flagged = DECISIONS.filter((d) => FLAT_FORMS.get('en')!.get(idOf(d)) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) expect(d.reason.length, `${idOf(d)} records no reason`).toBeGreaterThan(120);
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Dark. Every verdict this round is `translate`, so running the predicate
    // over DECISIONS alone evaluates nothing at all. Feed it a row that IS an
    // undeclared echo and it must come back non-empty.
    expect(undeclaredEchoes(DECISIONS)).toEqual([]);
    const synthetic: Decision = {
      population: 'lifecycle',
      type: 'object',
      path: 'lifecycle.reclaim',
      prop: 'label',
      en: 'Reclaim',
      verdict: { 'ja-JP': 'echo', 'es-ES': 'translate' },
      reason: 'a synthetic row that declares an echo and gives no per-locale reason for it at all',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['ja-JP object.fields.lifecycle.reclaim.label']);
    // …and a departure that is present but too thin is refused the same way.
    expect(undeclaredEchoes([{ ...synthetic, departures: { 'ja-JP': 'because.' } }])).toEqual([
      'ja-JP object.fields.lifecycle.reclaim.label',
    ]);
    expect(
      undeclaredEchoes([
        { ...synthetic, departures: { 'ja-JP': 'the English initialism IS the Japanese rendering here, and here is the reason why' } },
      ]),
    ).toEqual([]);
  });
});

describe('#19403 round 10 — the populations, DERIVED from a schema shape and a widget', () => {
  it('⭐ the lifecycle root is found by SHAPE — the live LifecycleSchema keys, not a name', () => {
    expect(LIFECYCLE_SHAPE_KEYS).toEqual(['archive', 'class', 'reclaim', 'retention', 'storage', 'ttl']);
    expect(LIFECYCLE_ROOTS.length, 'the form composite matching LifecycleSchema shape is no longer unique').toBe(1);
    expect(LIFECYCLE_ROOT_PATH).toBe('lifecycle');
    // …and it really is the ADR-0057 block: the row sits in the object form and
    // declares the contract helpText.
    const root = OBJECT_ROWS.find((r) => r.path === LIFECYCLE_ROOT_PATH)!;
    expect(root.section).toBe('advanced');
    expect(root.helpText).toContain('ADR-0057');
    // Dark — the predicate DISCRIMINATES. Not every composite in this form
    // matches, and the count of composites it walked past is non-trivial.
    const composites = OBJECT_ROWS.filter((r) => (r.path.match(/\./g) ?? []).length === 0);
    expect(composites.length).toBeGreaterThan(8);
  });

  it('⭐ the email-json population is found by WIDGET — and three of its four leaves are controls', () => {
    expect(EMAIL_JSON_ROWS.map((r) => r.path).sort()).toEqual(['fromOverride', 'variables']);
    expect(EMAIL_JSON_LEAVES.length).toBe(4);
    // Dark — the predicate discriminates: the form has many more rows than this.
    expect(EMAIL_ROWS.length).toBeGreaterThan(10);
    expect(EMAIL_ROWS.filter((r) => r.widget === 'json').length).toBe(2);
  });

  it('the two populations are the size this round claims, and the ledger covers them exactly', () => {
    expect(LIFECYCLE_LEAVES.length).toBe(32);
    expect(LIFECYCLE_LEAVES.filter((l) => l.prop === 'label').length).toBe(16);
    expect(LIFECYCLE_LEAVES.filter((l) => l.prop === 'helpText').length).toBe(16);
    expect(PANEL_LEAVES.length).toBe(36);
    expect(PANEL_LEAVES.every((l) => l.prop === 'label' || l.prop === 'helpText')).toBe(true);
    // Every decided leaf is a member of a derived population — the ledger cannot
    // decide a leaf the walk does not reach.
    const derived = new Set(PANEL_LEAVES.map((l) => leafKey(l)));
    expect(DECISIONS.filter((d) => !derived.has(idOf(d))).map((d) => idOf(d))).toEqual([]);
  });

  it('⭐ DARK, OUTWARD — everything else these two forms manufacture is excluded, and named', () => {
    // 94+ leaves are left out. The sharpest exclusions are asserted by name:
    // the two object rows round 8 decided and the ones it left authored, plus the
    // email rows that are NOT json widgets.
    expect(OUTSIDE_LEAVES.length).toBeGreaterThan(90);
    for (const path of ['validations', 'datasource', 'enable.apiEnabled', 'fields.placeholder', 'name']) {
      expect(PANEL_LEAVES.some((l) => l.type === 'object' && l.path === path), `${path} is not this round`).toBe(false);
      expect(OUTSIDE_LEAVES.some((l) => l.type === 'object' && l.path === path), `${path} is reachable`).toBe(true);
    }
    for (const path of ['subject', 'bodyHtml', 'replyTo']) {
      expect(PANEL_LEAVES.some((l) => l.type === 'email_template' && l.path === path)).toBe(false);
      expect(OUTSIDE_LEAVES.some((l) => l.type === 'email_template' && l.path === path)).toBe(true);
    }
    // …and nothing excluded echoes, in any locale — the exclusion removes only
    // leaves earlier rounds of this card already decided or a translator authored.
    const outsideEchoes: string[] = [];
    for (const [locale] of FORMS) {
      for (const l of OUTSIDE_LEAVES) if (live(locale, l) === l.en) outsideEchoes.push(`${locale} ${leafKey(l)}`);
    }
    expect(outsideEchoes, 'an excluded leaf echoes — it belongs to some ledger, and not to this one').toEqual([]);
  });

  it('⭐ DARK, INWARD, AUTHORED — 3 of the 4 email-json leaves are NOT decided here and come back NON-ECHOING', () => {
    // A hand-list of the 33 echoing leaves can only ever produce positives. This
    // derivation produces a negative on three of its own members, in the same
    // walk, in all three locales — and one of those three is the exact twin the
    // decided row copies from.
    const decided = new Set(DECISIONS.map((d) => idOf(d)));
    const controls = EMAIL_JSON_LEAVES.filter((l) => !decided.has(leafKey(l)));
    expect(controls.map((l) => leafKey(l)).sort()).toEqual([
      'email_template.fields.fromOverride.helpText',
      'email_template.fields.fromOverride.label',
      'email_template.fields.variables.label',
    ]);
    for (const l of controls) {
      for (const [locale] of FORMS) {
        expect(live(locale, l), `${locale} ${leafKey(l)} is an echo, not a control`).not.toBe(l.en);
      }
    }
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf in both populations', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog: every leaf
    // must come back flagged, or the greens above mean only that the walk found
    // nothing.
    const flagged = PANEL_LEAVES.filter((l) => FLAT_FORMS.get('en')!.get(leafKey(l)) === l.en);
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });
});

describe('#19403 round 10 — the verdicts, on the live bundles', () => {
  it('every `translate` row really moved, in both decided locales', () => {
    for (const d of DECISIONS) {
      for (const locale of DECIDED_LOCALES) {
        if (d.verdict[locale] !== 'translate') continue;
        const v = live(locale, d);
        expect(v, `${locale} ${idOf(d)} is missing from the bundle`).toBeTypeOf('string');
        expect(v, `${locale} ${idOf(d)} still reads its en source — the row says it was translated`).not.toBe(d.en);
      }
    }
  });

  it('no leaf of either population reads its `en` source, in ANY locale', () => {
    // The ratchet. A field added to the lifecycle composite tomorrow, or a
    // re-fill of a decided one, is red on the day it lands — and there is no
    // deferral left to skip it through.
    const undecided: string[] = [];
    for (const [locale] of FORMS) {
      for (const l of PANEL_LEAVES) {
        if (live(locale, l) !== l.en) continue;
        const d = DECISIONS.find((x) => idOf(x) === leafKey(l));
        if (d?.verdict[locale] === 'echo') continue;
        undecided.push(`${locale} ${leafKey(l)} (${JSON.stringify(l.en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('⭐⭐ the WHOLE metadata-form catalog now reads zero — and the two predicates are DIFFERENT QUESTIONS', () => {
    // The card headline is "echoes in ALL THREE locales". It read ZERO before
    // this round too, over 33 leaves a Japanese author was reading in English.
    // Both readings are taken here, and the difference between them is proved on
    // a SYNTHETIC catalog so it holds whatever the tree contains.
    const en = FLAT_FORMS.get('en')!;
    const catalogs = FORMS.map(([l]) => [l, FLAT_FORMS.get(l)!] as const);
    const headline = [...en].filter(([k, v]) => k.endsWith('.label') && echoesInAllThree(catalogs, k, v));
    const perLocale = [...en].filter(([k, v]) => echoesSomewhere(catalogs, k, v));
    expect(headline.map(([k]) => k), 'the all-three predicate').toEqual([]);
    expect(perLocale.map(([k]) => k), 'the per-locale predicate — the question that actually found this round').toEqual([]);
    // POSITIVE CONTROL, moving the other way: the count of genuinely translated
    // `.label` leaves, which a parser matching everything could not produce.
    for (const [locale, m] of catalogs) {
      const translated = [...en].filter(([k, v]) => k.endsWith('.label') && m.get(k) !== undefined && m.get(k) !== v);
      // 583 since #19331: that card gave 45 declared-but-unoffered scalar keys a
      // form row each across ten forms, and authored every one of their labels
      // in all three locales rather than leaving it an extractor fill — so this
      // control moves by exactly the number of rows that landed, in every
      // locale, which is the reading a per-locale count is for.
      expect(translated.length, `${locale} positive control`).toBe(583);
    }
    // ⭐ DARK — the blindness, executable. On a synthetic two-locale catalog the
    // all-three predicate returns 0 while the per-locale one returns 1, so the
    // zero above is two different facts and not one repeated.
    const synthEn = new Map([['x.label', 'Ttl']]);
    const synth = [
      ['zh-CN', new Map([['x.label', 'TTL 過期']])],
      ['ja-JP', new Map([['x.label', 'Ttl']])],
      ['es-ES', new Map([['x.label', 'Ttl']])],
    ] as ReadonlyArray<readonly [string, Map<string, string>]>;
    expect([...synthEn].filter(([k, v]) => echoesInAllThree(synth, k, v)).length, 'the blind predicate').toBe(0);
    expect([...synthEn].filter(([k, v]) => echoesSomewhere(synth, k, v)).length, 'the seeing predicate').toBe(1);
  });

  it('⭐ machine tokens survive VERBATIM in all three locales — with a predicate that can say NO', () => {
    let asserted = 0;
    for (const d of DECISIONS) {
      for (const token of d.verbatim ?? []) {
        for (const [locale] of FORMS) {
          const v = live(locale, d);
          expect(typeof v, `${locale} ${idOf(d)}`).toBe('string');
          expect(carriesToken(v as string, token), `${locale} ${idOf(d)} lost the machine token ${token}`).toBe(true);
          asserted++;
        }
      }
    }
    // Lit — the loop really ran, which a green over an empty `verbatim` set would not show.
    expect(asserted).toBe(57);
    // Dark, the NO leg — the predicate is capable of failing on these very strings.
    for (const [locale] of FORMS) {
      const v = live(locale, DECISIONS.find((d) => d.path === 'lifecycle.storage' && d.prop === 'helpText')!)!;
      expect(carriesToken(v, 'PostgreSQL'), `${locale} — a token that is NOT there`).toBe(false);
    }
  });

  it('⭐ …and the guard states where it STOPS working, executably, on kana', () => {
    // Round 9 recorded this limit in prose. Here it is run.
    // (a) A substring guard LIES on kana: キャンセル contains セル.
    expect('キャンセル'.includes('セル')).toBe(true);
    // (b) This predicate does not make that mistake …
    expect(carriesToken('キャンセル', 'セル')).toBe(false);
    // (c) … and it pays for that with an UNDER-REACH: a genuine standalone セル
    //     inside running Japanese, which writes no word boundaries, is MISSED.
    expect(carriesToken('このセルを編集', 'セル')).toBe(false);
    // (d) It only sees a kana token that happens to be delimited.
    expect(carriesToken('セル', 'セル')).toBe(true);
    // ⇒ sound and INCOMPLETE on kana. Every token this ledger guards is Latin,
    //    a digit-unit literal or a dotted path, so the limit does not bite here —
    //    but a later round adding a kana token must read this block first.
    expect((DECISIONS.flatMap((d) => d.verbatim ?? [])).every((t) => /^[\x20-\x7E×]+$/.test(t))).toBe(true);
  });

  it('⭐ every declared copy really is a copy — asserted against the live twins', () => {
    let asserted = 0;
    for (const d of DECISIONS) {
      for (const c of d.copies ?? []) {
        for (const [locale, mode] of Object.entries(c.modes)) {
          const twin = twinValue(c.catalog, c.key, locale);
          const leaf = live(locale, d);
          expect(twin, `${locale} twin ${c.catalog}.${c.key} is gone — re-judge ${idOf(d)}`).toBeTypeOf('string');
          expect(leaf, `${locale} ${idOf(d)}`).toBeTypeOf('string');
          if (mode === 'in') {
            expect(fold(leaf as string), `${locale} ${idOf(d)} no longer contains its twin ${c.key}`).toContain(
              fold(twin as string),
            );
          } else if (mode === 'from') {
            expect(fold(twin as string), `${locale} twin ${c.key} no longer contains ${idOf(d)}`).toContain(
              fold(leaf as string),
            );
          } else {
            expect(fold(twin as string), `${locale} twin ${c.key} lost the shared fragment`).toContain(fold(mode));
            expect(fold(leaf as string), `${locale} ${idOf(d)} lost the shared fragment`).toContain(fold(mode));
          }
          asserted++;
        }
      }
    }
    // Lit — 22 of the 33 rows declare a copy, 56 locale assertions. The other
    // eleven rows are the ones that say NO TWIN EXISTS, which is why this count
    // is pinned rather than left to "some copies were checked".
    expect(DECISIONS.filter((d) => (d.copies ?? []).length > 0).length).toBe(22);
    expect(DECISIONS.filter((d) => (d.copies ?? []).length === 0).length).toBe(11);
    expect(asserted).toBe(56);
  });

  it('⭐ the JSON worked example survives BYTE-IDENTICAL in all three locales', () => {
    const d = DECISIONS.find((x) => x.population === 'email-json')!;
    for (const [locale] of FORMS) {
      expect(live(locale, d), `${locale} rewrote the JSON sample`).toContain(d.en);
    }
    // …and the twin it copies its lead-in from does the same with its own sample,
    // which is what made the pair evidence in the first place.
    const twinEn = FLAT_FORMS.get('en')!.get('email_template.fields.fromOverride.helpText')!;
    for (const [locale] of FORMS) {
      expect(twinValue('metadataForms', 'email_template.fields.fromOverride.helpText', locale)).toContain(twinEn);
    }
    // Dark — containment is not vacuous: the sample is long and structured.
    expect(d.en.length).toBeGreaterThan(60);
    expect(twinEn.length).toBeGreaterThan(30);
  });
});

describe('#19403 round 10 — ⚠️⚠️ the phantom-translation trap, asserted three ways', () => {
  it('objectForm declares NO label on ANY of the sixteen lifecycle fields', () => {
    const rows = OBJECT_ROWS.filter((r) => inLifecycle(r.path));
    expect(rows.length).toBe(16);
    expect(rows.filter((r) => r.declaresLabel).map((r) => r.path)).toEqual([]);
  });

  it('…so every `en` label here is the extractor humanize of the field path', () => {
    const rows = OBJECT_ROWS.filter((r) => inLifecycle(r.path));
    for (const r of rows) {
      const shipped = FLAT_FORMS.get('en')!.get(`object.fields.${r.path}.label`);
      expect(shipped, `object.fields.${r.path}.label is not shipped`).toBeTypeOf('string');
      expect(shipped, `${r.path}: the shipped en label is no longer a humanize of the path`).toBe(
        humanizeFieldPath(r.path),
      );
    }
    // Lit — the humanize really does something, on this very family.
    expect(humanizeFieldPath('lifecycle.retention.maxAge')).toBe('Max Age');
    expect(humanizeFieldPath('lifecycle.archive.to')).toBe('To');
  });

  it('⭐ `Ttl` is WRONG English, and fixing it would discharge nothing — all three halves asserted', () => {
    // (1) The shipped English and the correct English differ in BYTES, so a
    //     touch-up would satisfy the echo predicate in every locale.
    const shipped = FLAT_FORMS.get('en')!.get('object.fields.lifecycle.ttl.label')!;
    expect(shipped).toBe('Ttl');
    expect(shipped).not.toBe('TTL');
    expect(humanizeFieldPath('lifecycle.ttl')).toBe('Ttl');
    // (2) The form and the schema both spell the initialism correctly, so this is
    //     a humanize artefact and not a house spelling.
    const helpText = OBJECT_ROWS.find((r) => r.path === 'lifecycle.ttl')!.helpText!;
    expect(carriesToken(helpText, 'TTL')).toBe(true);
    // (3) No rendering is EITHER English spelling — the rows were decided against
    //     the concept — while the initialism itself survives in all three.
    for (const [locale] of FORMS) {
      const v = live(locale, { type: 'object', path: 'lifecycle.ttl', prop: 'label' })!;
      expect(v, `${locale} took the English`).not.toBe('Ttl');
      expect(v, `${locale} took the corrected English`).not.toBe('TTL');
      expect(carriesToken(v, 'TTL'), `${locale} dropped the machine token`).toBe(true);
    }
  });

  it('⭐ the near-twin that was LOOKED UP AND REFUSED is asserted to be a fill, not a decision', () => {
    // `Access Token TTL` is byte-identical in all three locales and reads like a
    // standing decision to keep TTL verbatim. It is an unauthored fill in every
    // locale — including zh-CN — and the provenance tables say so. Asserted so
    // that no later round leans on it.
    const key = 'sys_oauth_resource.fields.access_token_ttl.label';
    const en = FLAT_OBJECTS.get('en')!.get(key);
    expect(en).toBe('Access Token TTL');
    for (const [locale, table] of PROVENANCE) {
      expect(FLAT_OBJECTS.get(locale)!.get(key), `${locale} ${key}`).toBe(en);
      expect(
        table[`objects.${key}`],
        `${locale} no longer records ${key} as a fill — if a translator authored it, this ledger note is stale`,
      ).toBeTypeOf('string');
    }
  });
});

describe('#19403 round 10 — the SECOND WITNESS, over the `metadataForms.`-prefixed companions', () => {
  for (const [locale, table] of PROVENANCE) {
    it(`${locale}: ⭐ exactly this round leaves dropped, 0 added — SET EQUALITY with a perturbed control`, () => {
      // The companion is an independent reading of the same fact, keyed under a
      // `metadataForms.` prefix the bundles themselves do not carry. An entry
      // exists exactly while the leaf IS a byte copy of the source revision, so
      // a leaf this round authored must have lost its row.
      const keys = Object.keys(table);
      expect(keys.length, 'the provenance table is empty — the witness cannot testify').toBeGreaterThan(300);
      const metadataFormRows = keys.filter((k) => k.startsWith('metadataForms.'));
      // The reading: NOTHING under the metadataForms. prefix is a fill any more.
      expect(metadataFormRows, `${locale} still records a metadata-form leaf as an unauthored fill`).toEqual([]);
      // …and the bundles do NOT carry that prefix, which is what makes this an
      // independent witness rather than a second view of the same bytes.
      expect([...FLAT_FORMS.get(locale)!.keys()].some((k) => k.startsWith('metadataForms.'))).toBe(false);
      // Dark — a PERTURBED expectation must read false, or set equality proves
      // nothing: the same comparison against a one-row-larger expectation fails.
      const setEq = (a: readonly string[], b: readonly string[]): boolean =>
        a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
      expect(setEq(metadataFormRows, []), 'the reading').toBe(true);
      expect(setEq(metadataFormRows, ['metadataForms.__synthetic.perturbation']), 'the perturbed control').toBe(false);
      expect(setEq([...metadataFormRows, 'metadataForms.__synthetic.perturbation'], []), 'the other direction').toBe(
        false,
      );
    });

    it(`${locale}: the provenance lookup still over- and under-reports correctly on the untouched \`objects.\` slice`, () => {
      // Dark, drawn from a population THIS CARD DOES NOT TOUCH, so the witness is
      // shown to discriminate on a slice this round cannot have arranged.
      const en = FLAT_OBJECTS.get('en')!;
      const loc = FLAT_OBJECTS.get(locale)!;
      const echoing = [...en].filter(([k, v]) => loc.get(k) === v).map(([k]) => k);
      const authored = [...en].filter(([k, v]) => loc.get(k) !== undefined && loc.get(k) !== v).map(([k]) => k);
      expect(echoing.length, `${locale} has no echoing objects leaf to sample`).toBeGreaterThan(50);
      expect(authored.length, `${locale} has no authored objects leaf to sample`).toBeGreaterThan(50);
      expect(
        echoing.filter((k) => table[`objects.${k}`] === undefined),
        'an echoing objects leaf carries NO provenance row — the lookup under-reports',
      ).toEqual([]);
      expect(
        authored.filter((k) => table[`objects.${k}`] !== undefined),
        'an authored objects leaf carries a provenance row — the lookup over-reports',
      ).toEqual([]);
    });
  }
});

describe('#19403 round 10 — ADR-0057, read at the LIVE schema before a word was rendered', () => {
  const parse = (v: unknown) => (LifecycleSchema as any).safeParse(v);

  it('`record` and `audit` are enum VALUES, which is why the prose keeps them verbatim', () => {
    const members = ((LifecycleClassSchema as any).options ?? (LifecycleClassSchema as any).def?.entries) as string[];
    expect([...members].sort()).toEqual(['audit', 'event', 'record', 'telemetry', 'transient']);
    // Dark — the discriminator really refuses a rendered spelling, so a locale
    // that translated the word would send an author to type a refused value.
    expect(parse({ class: 'registro', retention: { maxAge: '30d' } }).success).toBe(false);
    expect(parse({ class: 'record' }).success).toBe(true);
  });

  it('§3.1 and §3.5 — the two refusals the block helpText describes', () => {
    // "Leave empty for permanent record semantics": a record class may carry no
    // bounding policy at all.
    expect(parse({ class: 'record', retention: { maxAge: '30d' } }).success, '§3.1').toBe(false);
    // "Non-record classes require at least one bounding policy".
    expect(parse({ class: 'audit' }).success, '§3.5').toBe(false);
    expect(parse({ class: 'audit', retention: { maxAge: '30d' } }).success, '§3.5 satisfied').toBe(true);
  });

  it('⭐ archive.after MUST equal retention.maxAge — which is why the two rows share a head noun', () => {
    expect(
      parse({ class: 'audit', retention: { maxAge: '30d' }, archive: { after: '7y', to: 'cold' } }).success,
      'a mismatch must be refused',
    ).toBe(false);
    expect(
      parse({ class: 'audit', retention: { maxAge: '7y' }, archive: { after: '7y', to: 'cold' } }).success,
      'the aligned pair must parse',
    ).toBe(true);
  });

  it('the duration literals in these helpTexts are VALUES an author types, not prose', () => {
    for (const d of ['30d', '1d', '7y']) expect(LIFECYCLE_DURATION_REGEX.test(d), d).toBe(true);
    // Dark — the regex refuses the rendered form, so translating the sample would
    // hand the reader a value the schema rejects.
    for (const bad of ['30 days', '30 天', '30 días']) expect(LIFECYCLE_DURATION_REGEX.test(bad), bad).toBe(false);
    // …and each sample really appears in the leaf that names it.
    const enMap = FLAT_FORMS.get('en')!;
    expect(enMap.get('object.fields.lifecycle.retention.maxAge.helpText')).toContain('"30d"');
    expect(enMap.get('object.fields.lifecycle.ttl.expireAfter.helpText')).toContain('"1d"');
    expect(enMap.get('object.fields.lifecycle.archive.keep.helpText')).toContain('"7y"');
  });

  it('⭐ storage is a COUNT and a GRANULARITY — which is what the two labels say and English does not', () => {
    const rotation = { class: 'telemetry' as const, storage: { strategy: 'rotation', shards: 7, unit: 'day' } };
    expect(parse(rotation).success).toBe(true);
    // `shards` is an integer with a minimum of 2 ⇒ the row names a number.
    expect(parse({ ...rotation, storage: { ...rotation.storage, shards: 1 } }).success, 'min 2').toBe(false);
    // `unit` is a three-member enum ⇒ the row names a granularity, not a duration.
    expect(parse({ ...rotation, storage: { ...rotation.storage, unit: 'quarter' } }).success, 'enum').toBe(false);
    // `strategy` is a one-member literal ⇒ ja refusing the twin マージ戦略 matters.
    expect(parse({ ...rotation, storage: { ...rotation.storage, strategy: 'merge' } }).success, 'literal').toBe(false);
  });
});
