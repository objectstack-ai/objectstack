// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 8 — the DECISION LEDGER for the object form's COLLAPSED
// sections: the capability toggles (`enable.*`) and the `validations` row.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the seven earlier rounds of
// this card extended: one row per string leaf, each carrying its verdict per
// locale, the reason it was reached, and the `en` source it was judged against.
//
// ## The population — DERIVED from the FORM, not from the catalog's key names
//
// Round 7 raised the bar from "a prefix walk over the `en` subtree" to "a shape
// over a spec-side source that MANUFACTURES the leaves". This round keeps it
// there, with the source that actually manufactures these eleven:
//
//   `objectForm` (`packages/spec/src/data/object.form.ts`), crossed with ONE
//   predicate read off the form's own shape: a section is IN when it ships
//   `collapsed: true`. Two of the four qualify — `capabilities` and `advanced`
//   — and the walk takes every field they declare, recursively through the
//   `composite` children, in the same order and by the same recursion the CLI
//   extractor uses (`walkFormField` in `packages/cli/src/utils/i18n-extract.ts`)
//   to emit these very keys. 45 string leaves.
//
// ⛔ What the `collapsed` predicate is NOT: an explanation. It is tempting to
// say "a collapsed section is one a translator never opened", and the history
// refuses it — the OPEN `fields` section was a wall of en-echoes too until
// round 1 of this card decided it (`object-field-editor-panel-echo-decisions`).
// The open sections are authored because ROUNDS OF THIS CARD AUTHORED THEM, not
// because anybody reached them. The predicate earns its place by DERIVING and
// by EXCLUDING, below — ⛔ not by a causal story this ledger cannot support.
//
// ## The controls — one outward, TWO inward
//
//   (1) OUTWARD. The two open sections — `basics` and `fields`, 94 leaves — are
//       excluded. The sharpest single exclusion is asserted by name:
//       `fields.placeholder`, one of the five keys #19403's own body samples as
//       the echoing object field-editor panel. It is EXCLUDED here and it is
//       already authored, so a walk that wrongly swept it in would not even go
//       red — which is why the exclusion is asserted instead of trusted.
//   (2) INWARD, AUTHORED. `datasource` — label and helpText, two leaves — is IN
//       the population and comes back NON-ECHOING in all three locales, in the
//       same walk. A hand-list of the eleven echoing leaves can only ever
//       produce positives; this derivation produces a negative on two of its own
//       members.
//   (3) ⭐⭐ INWARD, TWO-LOCALE — and this one is the instrument's own upgrade.
//       `lifecycle.*` contributes 32 leaves to this population and every one of
//       them echoes in `ja-JP` and `es-ES` while `zh-CN` has all 32 authored.
//       The card's headline predicate is "echoes in ALL THREE", so its census
//       reads ZERO for them: a whole panel a Japanese author reads in English,
//       invisible to the number that is supposed to find it. This ledger's walk
//       is PER-LOCALE, so they are VISIBLE to it — counted, named by shape, and
//       carried below as a declared deferral rather than silently excluded.
//       ⛔ They are NOT decided here. Round 9 took `report.*` — the last family
//       the all-three predicate could see — so this deferral is ROUND 10's
//       declared scope, and a two-locale echo is exactly as undecided as a
//       three-locale one.
//
// ⭐ The deferral is written as a SHAPE (`lifecycle.*` in the two locales that
// echo it), never as 64 hand-listed strings, and the assertion over it is
// shrink-only: nothing OUTSIDE it may echo. So the round that empties it leaves
// this file green, while a new row arriving in a collapsed section — the way
// this defect class actually reproduces — reds it on the day it lands.
//
// ## ⚠️⚠️ The phantom-translation trap, which this family walks straight into
//
// `enable.apiEnabled.label` is `"Api Enabled"`. That is not a considered English
// rendering: `objectForm` declares NO label on that field, so the string is
// manufactured by the extractor's `humanizeFieldPath`, which splits `apiEnabled`
// on the camel boundary and title-cases each part. Its correct English is
// `"API Enabled"`.
//
// ⇒ FIXING THE ENGLISH WOULD SATISFY THE ECHO PREDICATE IN ALL THREE LOCALES,
//   drop the card's census by a key, and tell a `zh-CN` author NOTHING. An echo
//   that stops matching is ⛔ not a leaf that got translated. The row below is
//   decided against the CONCEPT, and three things are asserted so the shortcut
//   cannot be taken quietly: that the form declares no label (the English is a
//   fill), that the two English spellings differ in bytes, and that none of the
//   three renderings is either of them.
//
// ⛔ And the English is NOT fixed here. It would be an edit to
// `packages/spec/src/data/object.form.ts`, outside this round's file surface,
// and it is a SEPARATE act with its own reason that does ⛔ not discharge the
// translation. It is reported as a finding, not folded in.
//
// ## ADR-0020 and the validations schema, READ BEFORE A WORD WAS RENDERED
//
// `validations.helpText` is the longest leaf this card has decided and it names
// a JSON shape and cites an ADR. Every claim it makes is asserted at the LIVE
// schema below, so a change that falsifies one reds this file:
//
//   • "an array of rule objects" — `ObjectSchema` accepts `validations` as an
//     ARRAY and refuses the same rule passed as a bare object.
//   • the worked example parses VERBATIM as a `ValidationRuleSchema` member.
//   • "State-machine transition tables are declared here too (ADR-0020)" — the
//     union really does carry a `state_machine` member whose payload is a
//     `transitions` TABLE, which is ADR-0020's D1 (converge to the
//     `state_machine` validation rule) and D2 (retire the top-level `workflow`
//     type). ⭐ Both halves asserted: `type: 'state_machine'` parses, and
//     `type: 'workflow'` — the shape ADR-0020 retired — is REFUSED.
//   • ⭐ THE NEAR-MISS, and it is real: the prose spells it `State-machine`
//     while the value is `state_machine`. The hyphenated, capitalised form is
//     REFUSED by the discriminator, so the prose is not naming a value an author
//     writes and it is rendered. `rule` and `table` are refused the same way.
//
// ## ⭐ ONE SCHEMA KEY, ONE RENDERING — and this family had two exact twins
//
// `trackHistory` and `searchable` are `ObjectCapabilities` keys, and BOTH are
// already rendered elsewhere in this very catalog, under the identical English
// string, by an earlier hand:
//
//   object.fields['fields.trackHistory'].label  Track History  -> 历史跟踪 / 履歴追跡 / Seguimiento de historial
//   object.fields['fields.searchable'].label    Searchable     -> 可搜索 / 検索可能 / Buscable
//   field.fields.searchable.label               Searchable     -> the same three, on a second panel
//
// ⇒ those words are COPIED, not composed, and the copy is asserted: if either
// twin is reworded, this file goes red and both positions move in one act.
// ⭐ That pair is also the strongest evidence in this round that the echo was a
// fill — the same English string, the same schema key, one position authored
// and the other a byte copy. One leaf cannot be a decision and a fill at once.
//
// The neighbours this round deliberately did NOT touch, asserted so:
//   object.sections.capabilities.label      功能开关 / 機能 / Capacidades — the
//       SECTION heading, left alone by round 6 and still alone. It names the
//       group; `enable.label` names the act of turning its members on, and the
//       two must stay distinguishable in every locale.
//   hook/action .fields.body.capabilities.label  能力 / ケイパビリティ — round
//       6's token list, and round 7's third position. Untouched.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle and compare each
// `.label` leaf against `en`. Re-taken by this round on base 1f69917c5:
//
//   en string leaves / `.label` leaves            893 / 538
//   POSITIVE CONTROL — labels genuinely translated 526 (zh-CN) · 510 · 510
//   label keys echoing in ALL THREE locales          12 => 36 `.label` leaves
//
// After: 3 keys / 9 `.label` leaves, control 535 · 519 · 519 — echoes down 9 and
// the control up 9 in each locale, same population, same run. ⚠️ Those count
// `.label` leaves only; the DECIDABLE remainder (every string leaf, `helpText`
// included) reads 17 before and 6 after. ⭐ THE TWO MOVE BY DIFFERENT AMOUNTS,
// and the reason is worth stating rather than smoothing: this round decides 9
// labels AND 2 helpTexts, so the headline drops by 9 while the real remainder
// drops by 11. State which count you mean.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf is
// still a byte copy of the source revision, under a `metadataForms.` prefix the
// bundles themselves do not carry. All 11 leaves decided here carried one in all
// three locales; `pnpm i18n:extract` dropped exactly those 33 rows and added
// none, which is asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { objectForm, ObjectCapabilities, ObjectSchema, ValidationRuleSchema } from '@objectstack/spec/data';

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

const PROVENANCE: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, Record<string, any>]> = [
  ['zh-CN', zhCNGeneratedSourceHashes, zhCNObjects as Record<string, any>],
  ['ja-JP', jaJPGeneratedSourceHashes, jaJPObjects as Record<string, any>],
  ['es-ES', esESGeneratedSourceHashes, esESObjects as Record<string, any>],
];

/** `translate` — the echo was an unauthored fill. `echo` — the English IS the rendering. */
type Verdict = 'translate' | 'echo';

interface Decision {
  /**
   * The `objectForm` section that declares this row's field. Asserted equal to
   * the live form, so it is a reading rather than a label this ledger applies.
   */
  section: 'capabilities' | 'advanced';
  /** The field path under `object.fields` — also the bundle key. */
  path: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'helpText';
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle AND — for a `helpText` — to the live `objectForm` declaration that
   * manufactures it, so a reworded source reds this file instead of leaving a
   * decision standing over text nobody judged.
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

/** The worked example inside `validations.helpText`, kept byte-identical in every locale. */
const VALIDATION_SAMPLE =
  '[{ "type": "script", "name": "amount_positive", "condition": "amount > 0", "message": "Amount must be positive" }]';

const DECISIONS: readonly Decision[] = [
  {
    section: 'capabilities',
    path: 'enable',
    prop: 'label',
    en: 'Enable',
    verdict: ALL_TRANSLATE,
    reason:
      'THE BARE VERB, COPIED FROM FOUR AUTHORED POSITIONS that all spell it the same way: sys_user._actions.enable_two_factor.label ("Enable Two-Factor Auth") is 启用双因素认证 / 二要素認証を有効化 / Habilitar autenticación de dos factores, and sys_two_factor, sys_oauth_application._actions.enable_oauth_application and sys_oauth_application.fields.enable_end_session agree. ⇒ 启用 / 有効化 / Habilitar. ⭐ DELIBERATELY DISTINGUISHABLE FROM ITS OWN SECTION HEADING one line above it: object.sections.capabilities.label is 功能开关 / 機能 / Capacidades and round 6 left it alone. The heading names the GROUP of system features; this composite names the act of turning them on, and a reader who saw the same word twice would read the composite as a repeat of the heading. ⛔ What was refused: collapsing the two — the toggles hang off this composite, not off the heading, and the helpText below it is the sentence that explains them.',
  },
  {
    section: 'capabilities',
    path: 'enable',
    prop: 'helpText',
    en: 'Enable/disable system features',
    verdict: ALL_TRANSLATE,
    reason:
      'BOTH HALVES HAVE AUTHORED TWINS and the row names each. "Enable/disable": agent.fields.active.helpText and skill.fields.active.helpText are 启用或禁用此代理 / このエージェントの有効/無効 / Activa/desactiva este agente. "system features": object.sections.capabilities.description — THE SAME PANEL, one line above this leaf — is 系统功能与 API 暴露 / システム機能と API 公開 / Funciones del sistema y exposición de API. ⇒ 启用或禁用系统功能 / システム機能の有効/無効 / Activa/desactiva funciones del sistema. ⚠️ Each locale keeps its twin\'s own grammar rather than a common one: zh and es take the twin\'s verb pair, ja takes the twin\'s NOMINAL 〜の有効/無効 because that is how the authored agent and skill leaves spell exactly this sentence.',
  },
  {
    section: 'capabilities',
    path: 'enable.trackHistory',
    prop: 'label',
    en: 'Track History',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐⭐ COPIED VERBATIM FROM AN EXACT TWIN IN THIS CATALOG — object.fields["fields.trackHistory"].label, the per-field switch, carries the IDENTICAL English string and is 历史跟踪 / 履歴追跡 / Seguimiento de historial. One schema key, one rendering, and the copy is asserted below so the two positions can only ever move together. ⭐ That twin is also this round\'s sharpest evidence that the echo was a FILL rather than a rendering: the same English words, the same schema key name, one position authored by a translator and the other a byte copy. A translator who judged the English right here would not have written the Chinese a few rows up. ⛔ NOT re-worded to distinguish object-level from field-level: the schema gives them the same name on purpose (ObjectCapabilities.trackHistory\'s own contract says "pair with per-field trackHistory"), and the form\'s nesting already shows which is which.',
  },
  {
    section: 'capabilities',
    path: 'enable.searchable',
    prop: 'label',
    en: 'Searchable',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐⭐ COPIED VERBATIM FROM TWO EXACT TWINS, on two different panels, both already agreeing: object.fields["fields.searchable"].label and field.fields.searchable.label are both 可搜索 / 検索可能 / Buscable. ⇒ exactly that. The two twins agreeing with each other before this round is what makes the copy a derivation rather than a choice — there was no second answer to pick from. ⚠️ The object-level flag indexes the whole record ("Index records for global search") while the field-level one includes a column in the index; the WORD is the same in the source and stays the same here, because the distinction is carried by where the toggle sits, exactly as it is in English.',
  },
  {
    section: 'capabilities',
    path: 'enable.apiEnabled',
    prop: 'label',
    en: 'Api Enabled',
    verdict: ALL_TRANSLATE,
    reason:
      '⚠️⚠️ THE PHANTOM-TRANSLATION TRAP, AND THE ROW IS DECIDED AGAINST THE CONCEPT, NOT THE BYTES. "Api Enabled" is not an English rendering anybody wrote: objectForm declares no label on this field (asserted), so the extractor humanizes `apiEnabled` into it, and the correct English is "API Enabled". ⇒ touching up the English would differ in bytes, satisfy the echo predicate in all three locales and drop the card\'s census while telling a zh-CN author nothing. It is NOT done here and it does not discharge this row. The rendering copies the catalog\'s authored answer for the "X Enabled" pattern: sys_user.fields.two_factor_enabled.label ("Two-Factor Enabled") is 已启用双因素认证 / 二要素認証 有効 / Doble factor habilitado, and sys_user._views.two_factor.label ("2FA Enabled") repeats it as 已启用 2FA / 2FA 有効 / 2FA habilitado. ⇒ 已启用 API / API 有効 / API habilitada. ⭐ `API` is kept VERBATIM in all three, the machine-token treatment round 7 landed for API 端点 / API エンドポイント / Endpoint API, and asserted by the token guard below. ⚠️ es takes the FEMININE agreement (habilitada, not habilitado): this catalog already writes "la API" in the objects bundle, so the gender is copied rather than chosen — the two masculine twins above agree with THEIR own heads (2FA, Doble factor), not with this one.',
  },
  {
    section: 'capabilities',
    path: 'enable.files',
    prop: 'label',
    en: 'Files',
    verdict: ALL_TRANSLATE,
    reason:
      'THE BARE NOUN, from the one authored twin that holds it: sys_attachment.fields.file_id.label ("File") is 文件 / ファイル / Archivo. ⇒ 文件 / ファイル / Archivos (zh and ja carry no plural marker; es pluralises, as its own twin sys_attachment.pluralLabel does with Adjuntos). ⛔ WHAT WAS REFUSED, and it is the interesting half: rendering the CONTRACT rather than the key — this flag surfaces the record Attachments panel over sys_attachment, so 附件 / 添付ファイル / Adjuntos was available and is wrong twice over. It would translate the key into a different key\'s word, and sys_attachment.label already OWNS those three words in this same catalog; two concepts would collide on one rendering. The key is `files` and the source says Files.',
  },
  {
    section: 'capabilities',
    path: 'enable.feeds',
    prop: 'label',
    en: 'Feeds',
    verdict: ALL_TRANSLATE,
    reason:
      '⛔ NO AUTHORED TWIN FOR "feed" IN EITHER CATALOG, AND THIS ROW SAYS SO rather than leaning on one — the discipline round 5 wrote down on memoryMb. Composed from the schema\'s own contract (social collaboration: comments, mentions and the record feed; an explicit false hides the feed UI and rejects sys_comment rows): zh 动态, the Chinese term for a record collaboration stream; ja フィード, transliterated by this catalog\'s established habit for a technical noun with no Japanese term of art (データソース, タイムライン, マスキングルール are all authored that way); es Publicaciones. ⛔ es was NOT left as the loanword "Feeds": it is byte-identical to the source, so it would be a phantom — a leaf that stops looking like an echo only because nobody can tell. ⛔ And NOT "Comentarios": that is the enforcement detail, not the key\'s word, and it would take a rendering sys_comment will need. ⭐ Asserted below: this leaf stays distinguishable from its sibling `activities` in every locale, and from the authored 时间线 / タイムライン / Cronología this catalog already uses for Timeline.',
  },
  {
    section: 'capabilities',
    path: 'enable.activities',
    prop: 'label',
    en: 'Activities',
    verdict: ALL_TRANSLATE,
    reason:
      'THE HEAD NOUN IS COPIED FROM AN AUTHORED TWIN ON THIS VERY PANEL: object.fields["fields.trackHistory"].helpText ("Summarize this field on the record activity timeline") is 在记录的活动时间线上概述该字段的变更 / レコードのアクティビティタイムラインでこのフィールドを要約する / Resume este campo en la cronología de actividad del registro. ⇒ 活动 / アクティビティ / Actividades — the twin\'s own word for "activity", taken alone. That twin is the SAME feature this flag governs (the sys_activity record timeline), so the copy is the concept\'s own rendering rather than a near neighbour\'s. ⛔ NOT 时间线 / タイムライン / Cronología: this catalog already spends those on view.fields.timeline, and the flag names the activity rows, not the widget that shows them.',
  },
  {
    section: 'capabilities',
    path: 'enable.clone',
    prop: 'label',
    en: 'Clone',
    verdict: ALL_TRANSLATE,
    reason:
      '⛔ NO AUTHORED TWIN FOR "clone" OR "cloning" IN EITHER CATALOG — stated, not borrowed. The nearest thing either catalog holds is object.fields["fields.unique"].helpText ("Disallow duplicate values") 不允许重复值 / 重複値を許可しない / No permite valores duplicados, and that 重复 / 重複 / duplicado is the "repeated value" sense, ⛔ not the "make a copy of this record" sense the schema means ("Allow record deep cloning"). ⇒ composed: 克隆 / クローン / Clonación. ⚠️ es takes the NOUN (Clonación) rather than the infinitive, following its own siblings on this panel, which are nominal or adjectival throughout (Archivos, Actividades, Buscable, Seguimiento de historial) — and unlike enable.label above, which copies a twin that is itself an action label.',
  },
  {
    section: 'advanced',
    path: 'validations',
    prop: 'label',
    en: 'Validations',
    verdict: ALL_TRANSLATE,
    reason:
      'ONE AUTHORED TWIN FOR THE STEM, AND THE ROW NAMES IT AS THE ONLY ONE: tool.fields.outputSchema.helpText ("Output schema for validation") is 用于校验的输出结构 / 検証用出力スキーマ / Esquema de salida para validación ⇒ 校验 / 検証 / validación. ⚠️ AND THE THREE LOCALES DEPART FROM EACH OTHER ON PURPOSE, each following its own grammar rather than a shared template: es takes the bare nominal Validaciones, which Spanish forms cleanly; zh and ja cannot — 校验 heads no form row in Chinese and 検証 alone is thin — so both take the catalog\'s own head noun for this kind of thing, 规则 / ルール (脱敏规则 / マスキングルール, 筛选规则 / フィルタールール, 安全规则 / 安全ルール, all authored) ⇒ 校验规则 / 検証ルール. The helpText below then opens on the same two words in each locale, so the row and its tooltip read as one thing.',
  },
  {
    section: 'advanced',
    path: 'validations',
    prop: 'helpText',
    en: 'Object-level validation rules — an array of rule objects, e.g. [{ "type": "script", "name": "amount_positive", "condition": "amount > 0", "message": "Amount must be positive" }]. State-machine transition tables are declared here too (ADR-0020)',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE WORKED EXAMPLE IS KEPT BYTE-IDENTICAL IN ALL THREE LOCALES, and that is this catalog\'s own convention rather than caution: object.fields["fields.lookupFilters"].helpText keeps ({field, operator, value}) verbatim in every locale, and sys_email_template.fields.variables_json.help keeps {name,type,required,description}. Here it is load-bearing as well — `type: "script"` is a literal member of the ValidationRuleSchema discriminator (asserted), `name` must match a snake_case regex and `condition` is CEL, so a reader who copied a partly-rendered sample would author a rule the runtime refuses. ⭐ ADR-0020 WAS READ AT THE SCHEMA BEFORE A WORD WAS RENDERED and every claim is asserted below: `validations` really is an ARRAY (the same rule as a bare object is refused), the sample really parses, `state_machine` really is a member of the same union with a `transitions` table, and `workflow` — the top-level type ADR-0020 D2 retired — is refused. ⚠️ THE NEAR-MISS IS REAL AND IT IS CLEARED: the prose writes "State-machine" while the value is `state_machine`, and the discriminator REFUSES the hyphenated capitalised form, so the prose names a concept and not a value an author writes ⇒ it is rendered. "state machine" takes the authored twin in THIS ROW\'S OWN SECTION HEADING — object.sections.advanced.description ("State machines, actions, and storage.") is 状态机、动作与存储 / ステートマシン、アクション、ストレージ / Máquinas de estado, acciones y almacenamiento. "rules" takes 规则 / ルール / reglas; "array" takes 数组 / 配列 and, for es, the metadata-form catalog\'s own spelling `array` (permission.fields.rowLevelSecurity.helpText is "Array de políticas RLS", ⛔ not the objects catalog\'s Matriz — the nearer convention wins). "object" takes 对象 / オブジェクト / objeto. ⇒ 对象级校验规则——由规则对象组成的数组，例如 …。状态机转移表也在此声明（ADR-0020） / オブジェクトレベルの検証ルール — ルールオブジェクトの配列。例: …。ステートマシンの遷移テーブルもここで宣言します（ADR-0020） / Reglas de validación a nivel de objeto — un array de objetos de regla, p. ej. …. Las tablas de transición de máquinas de estado también se declaran aquí (ADR-0020). ⚠️ Punctuation copied, not chosen, from one twin that carries all three conventions at once — permission.sections.system_permissions.description: zh folds the em-dash to —— with no spaces, ja and es keep a spaced —; "e.g." is 例如 (sys_oauth_application.fields.token_endpoint_auth_method.help) / 例: / p. ej.; zh and ja take full-width （）and 。, es keeps ASCII. ⭐ `ADR-0020` is kept verbatim in all three, asserted by the token guard.',
  },
];

// ---------------------------------------------------------------------------
// The population, DERIVED from `objectForm` and one shape predicate.
// ---------------------------------------------------------------------------

type FormSection = { name?: string; collapsed?: boolean; fields?: unknown[] };
type FormField = { field?: string; label?: unknown; helpText?: unknown; fields?: unknown[] };

const FORM_SECTIONS = ((objectForm as { sections?: unknown[] }).sections ?? []) as FormSection[];

/** The shape predicate: a section is in the population when the form ships it COLLAPSED. */
const isCollapsed = (s: FormSection): boolean => s.collapsed === true;

const COLLAPSED_SECTIONS = FORM_SECTIONS.filter(isCollapsed).map((s) => String(s.name));
const OPEN_SECTIONS = FORM_SECTIONS.filter((s) => !isCollapsed(s)).map((s) => String(s.name));

interface FormRow {
  section: string;
  /** Dotted field path, accumulated exactly as the extractor's `walkFormField` does. */
  path: string;
  /** Whether the form declares an explicit label — false means the `en` leaf is a humanize. */
  declaresLabel: boolean;
  helpText?: string;
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
    });
  }
  if (Array.isArray(field.fields)) for (const child of field.fields) walkFormFields(child as FormField, section, path, out);
}

function formRows(sections: readonly string[]): FormRow[] {
  const out: FormRow[] = [];
  for (const section of FORM_SECTIONS) {
    const name = String(section.name);
    if (!sections.includes(name)) continue;
    for (const child of section.fields ?? []) walkFormFields(child as FormField, name, '', out);
  }
  return out;
}

interface PanelLeaf {
  section: string;
  path: string;
  prop: string;
  en: string;
}

/** Every `en` string leaf the given form sections manufacture, read off the catalog. */
function leavesOf(sections: readonly string[]): PanelLeaf[] {
  const fields = ((enMetadataForms as Record<string, any>).object?.fields ?? {}) as Record<string, any>;
  const out: PanelLeaf[] = [];
  for (const row of formRows(sections)) {
    const entry = fields[row.path];
    if (!entry || typeof entry !== 'object') continue;
    for (const [prop, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value === 'string') out.push({ section: row.section, path: row.path, prop, en: value });
    }
  }
  return out;
}

const PANEL_LEAVES = leavesOf(COLLAPSED_SECTIONS);
const OPEN_LEAVES = leavesOf(OPEN_SECTIONS);

/**
 * ⭐ ROUND 10's DECLARED SCOPE — a shape, never a list of 64 strings. Every leaf
 * of this subtree that still echoes is DEFERRED, not decided; the assertions
 * over it are shrink-only, so the round that empties it leaves this file green.
 *
 * ⚠️ Round 9 re-pointed this from "round 9" to "round 10" and did NOT touch the
 * shape: round 9's family was `report.*`, the last one the card's all-three
 * predicate could see. This subtree is invisible to that predicate and is the
 * larger half of what is left.
 */
const DEFERRED_SUBTREE = 'lifecycle';
const inDeferral = (leaf: PanelLeaf): boolean => leaf.path === DEFERRED_SUBTREE || leaf.path.startsWith(`${DEFERRED_SUBTREE}.`);

/** The two members of the population whose display pair was already authored — the INWARD control. */
const AUTHORED_MEMBER = 'datasource';

const catalogLeaf = (forms: Record<string, any>, path: string, prop: string): unknown =>
  forms.object?.fields?.[path]?.[prop];

const leafOf = (forms: Record<string, any>, d: Decision): unknown => catalogLeaf(forms, d.path, d.prop);

/** The provenance-table key for a decided leaf — the `metadataForms.` prefix is the whole point. */
const provenanceKey = (d: Decision): string => `metadataForms.object.fields.${d.path}.${d.prop}`;

const idOf = (d: Decision): string => `object.fields.${d.path}.${d.prop}`;

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
 * Token presence judged on UNICODE word boundaries, ⛔ NOT substring containment.
 *
 * This family's own source carries the pair that makes the difference real:
 * `rule` is a key name `ScriptValidationSchema` recognises, and
 * "Object-level validation rules" CONTAINS it inside "rules" — a substring guard
 * would flag that clause for a token that is not in it. `\p{L}`/`\p{N}` rather
 * than `[A-Za-z0-9]` because the neighbours here are CJK, kana and accented
 * Latin.
 */
function carriesToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

function flattenLeaves(o: Record<string, any>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') for (const [a, b] of flattenLeaves(v as Record<string, any>, p)) out.set(a, b);
  }
  return out;
}

/** A minimal object that parses, so each schema probe below varies ONE key at a time. */
const MINIMAL_OBJECT = { name: 'acct', label: 'Acct', fields: { id: { type: 'text' } } } as const;

describe('#19403 round 8 — the ledger itself (controls before verdicts)', () => {
  it('decides every string leaf of the two keys this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 9 form rows, 11 leaves, three
    // locales, 33 decisions.
    expect(DECISIONS.length).toBe(11);
    expect(new Set(DECISIONS.map((d) => d.path))).toEqual(
      new Set([
        'enable',
        'enable.trackHistory',
        'enable.searchable',
        'enable.apiEnabled',
        'enable.files',
        'enable.feeds',
        'enable.activities',
        'enable.clone',
        'validations',
      ]),
    );
    expect(DECISIONS.filter((d) => d.prop === 'label').length).toBe(9);
    expect(DECISIONS.filter((d) => d.prop === 'helpText').length).toBe(2);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(33);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        catalogLeaf(enMetadataForms as Record<string, any>, d.path, d.prop),
        `en ${idOf(d)} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('⭐ …and to the FORM that manufactures it — the third leg', () => {
    // The `en` leaf is not authored in this package: `objectForm` in
    // `packages/spec` declares the helpText, and the extractor derives the label
    // from the field path. Pinning only the catalog would leave a decision
    // standing over text the form had since reworded.
    const rows = formRows(COLLAPSED_SECTIONS);
    for (const d of DECISIONS) {
      const row = rows.find((r) => r.path === d.path);
      expect(row, `${d.path} is no longer declared in a collapsed section of objectForm`).toBeDefined();
      expect(row!.section, `${d.path} moved section`).toBe(d.section);
      if (d.prop === 'helpText') {
        expect(row!.helpText, `objectForm no longer declares this helpText`).toBe(d.en);
      } else {
        // No declared label ⇒ the English is the extractor's humanize of the
        // field path, which is the whole premise of the apiEnabled row.
        expect(row!.declaresLabel, `${d.path} now declares its own label — re-judge the row`).toBe(false);
      }
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must flag all 11 rows, or a green verdict
    // run means nothing.
    const flagged = DECISIONS.filter((d) => leafOf(enMetadataForms as Record<string, any>, d) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${idOf(d)} records no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses an `echo` verdict that carries no per-locale reason — proved on a synthetic row', () => {
    // Dark. Every verdict this round is `translate`, so running the predicate
    // over DECISIONS alone evaluates nothing at all. Feed it a row that IS an
    // undeclared echo and it must come back non-empty; then the same predicate
    // over the real rows means something.
    expect(undeclaredEchoes(DECISIONS)).toEqual([]);
    const synthetic: Decision = {
      section: 'capabilities',
      path: 'enable.clone',
      prop: 'label',
      en: 'Clone',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'a synthetic row that exists only to prove the predicate below can fire',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN object.fields.enable.clone.label']);
    // …and a declared one passes, so the predicate is not simply "always fires".
    expect(
      undeclaredEchoes([
        {
          ...synthetic,
          departures: {
            'zh-CN': 'a departure long enough to satisfy the bar this ledger sets for a declared echo verdict',
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('#19403 round 8 — the catalogs hold what the ledger decided', () => {
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

describe('#19403 round 8 — ADR-0020 and the validations schema, asserted AT THE SCHEMA', () => {
  it('the probe harness is lit — the minimal object parses without a validations block', () => {
    expect(ObjectSchema.safeParse({ ...MINIMAL_OBJECT }).success).toBe(true);
  });

  it('"an array of rule objects" — `validations` takes an ARRAY, and refuses a bare object', () => {
    const rule = { type: 'script', name: 'amount_positive', condition: 'amount > 0', message: 'Amount must be positive' };
    expect(ObjectSchema.safeParse({ ...MINIMAL_OBJECT, validations: [rule] }).success).toBe(true);
    expect(
      ObjectSchema.safeParse({ ...MINIMAL_OBJECT, validations: rule }).success,
      'the same rule NOT in an array — if this passes, the helpText\'s "array" is wrong',
    ).toBe(false);
  });

  it('the worked example in the helpText parses VERBATIM as a validation rule', () => {
    // The sample is copied out of the decided `en` leaf rather than retyped, so
    // a reworded example cannot drift away from the thing being asserted.
    const en = DECISIONS.find((d) => d.path === 'validations' && d.prop === 'helpText')!.en;
    expect(en).toContain(VALIDATION_SAMPLE);
    const parsed = JSON.parse(VALIDATION_SAMPLE) as unknown[];
    expect(parsed.length).toBe(1);
    expect(ValidationRuleSchema.safeParse(parsed[0]).success).toBe(true);
  });

  it('⭐ ADR-0020 D1 — `state_machine` IS a member of the same union, and its payload is a transition TABLE', () => {
    expect(
      ValidationRuleSchema.safeParse({
        type: 'state_machine',
        name: 'status_fsm',
        message: 'illegal transition',
        field: 'status',
        transitions: { draft: ['open'] },
      }).success,
    ).toBe(true);
    // The table is required and it is a record, not prose: a rendered phrase
    // cannot land in it.
    expect(
      ValidationRuleSchema.safeParse({ type: 'state_machine', name: 'x', message: 'm', field: 'status' }).success,
      '`transitions` is no longer required — the helpText names a table that is not there',
    ).toBe(false);
    expect(
      ValidationRuleSchema.safeParse({
        type: 'state_machine',
        name: 'x',
        message: 'm',
        field: 'status',
        transitions: 'transition table',
      }).success,
    ).toBe(false);
  });

  it('⭐ ADR-0020 D2 — the retired `workflow` shape is REFUSED, so the discriminator really discriminates', () => {
    for (const type of ['workflow', 'validation', 'array', 'object']) {
      expect(ValidationRuleSchema.safeParse({ type, name: 'x', message: 'm' }).success, `type: ${type}`).toBe(false);
    }
  });

  it('⚠️ THE NEAR-MISS — the prose spells `State-machine`, and THAT is refused', () => {
    // The word in the helpText looks like the value an author writes. It is not
    // one: the discriminator takes `state_machine` and refuses the hyphenated,
    // capitalised form the prose uses — which is why the prose is rendered.
    expect(
      ValidationRuleSchema.safeParse({
        type: 'State-machine',
        name: 'x',
        message: 'm',
        field: 'status',
        transitions: {},
      }).success,
    ).toBe(false);
    // `rule` and `table` read like rule kinds and are not ones either.
    for (const type of ['rule', 'table']) {
      expect(ValidationRuleSchema.safeParse({ type, name: 'x', message: 'm' }).success, `type: ${type}`).toBe(false);
    }
  });

  it('⭐ no rendered word can land in a capability key — neither as the VALUE nor as the KEY', () => {
    // The class-(c) question, answered at the schema rather than assumed: could
    // translating these labels produce metadata the runtime rejects? No — the
    // labels name keys whose values are booleans, and the block is strict.
    for (const key of ['trackHistory', 'searchable', 'apiEnabled', 'files', 'feeds', 'activities', 'clone']) {
      expect(ObjectCapabilities.safeParse({ [key]: true }).success, `${key} is a declared capability`).toBe(true);
      expect(
        ObjectCapabilities.safeParse({ [key]: 'Clone' }).success,
        `${key} accepts a string — a rendered word could land in it`,
      ).toBe(false);
    }
    // …and a rendered KEY is refused too, loudly, by the strict block.
    const rendered = ObjectCapabilities.safeParse({ 克隆: true });
    expect(rendered.success).toBe(false);
    expect(
      rendered.success ? '' : rendered.error.issues[0]?.code,
      'the block is no longer strict — a translated key would be silently stripped',
    ).toBe('unrecognized_keys');
    // Lit — the block really does parse the real thing.
    expect(ObjectCapabilities.safeParse({}).success).toBe(true);
    expect(ObjectSchema.safeParse({ ...MINIMAL_OBJECT, enable: { clone: false } }).success).toBe(true);
  });
});

describe('#19403 round 8 — machine tokens, and a guard that can say NO', () => {
  it('the tokens this round decided to KEEP are still verbatim in every locale', () => {
    const api = DECISIONS.find((d) => d.path === 'enable.apiEnabled')!;
    const help = DECISIONS.find((d) => d.path === 'validations' && d.prop === 'helpText')!;
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      expect(carriesToken(String(leafOf(forms, api)), 'API'), `${locale} dropped the API token`).toBe(true);
      const rendered = String(leafOf(forms, help));
      expect(carriesToken(rendered, 'ADR-0020'), `${locale} dropped the ADR citation`).toBe(true);
      expect(rendered, `${locale} altered the worked example`).toContain(VALIDATION_SAMPLE);
      for (const token of ['script', 'amount_positive', 'condition', 'message']) {
        expect(carriesToken(rendered, token), `${locale} dropped the ${token} token`).toBe(true);
      }
    }
  });

  it('⭐ the token predicate can say NO — and a bare `includes` could not', () => {
    // `rule` is a key name ScriptValidationSchema recognises, and this family's
    // own source contains it INSIDE "rules". A substring guard would flag the
    // clause for a token that is not in it.
    const clause = 'Object-level validation rules';
    expect(clause.includes('rule')).toBe(true);
    expect(carriesToken(clause, 'rule')).toBe(false);
    // …and the predicate still says YES where the word really stands alone, so
    // it is not simply a guard that never fires.
    expect(carriesToken('an array of rule objects', 'rule')).toBe(true);
    // The same shape on the token this round kept: `API` is present, `AP` is not.
    expect('已启用 API'.includes('AP')).toBe(true);
    expect(carriesToken('已启用 API', 'AP')).toBe(false);
    expect(carriesToken('已启用 API', 'API')).toBe(true);
  });

  it('⚠️⚠️ the phantom-translation shortcut was NOT taken on `apiEnabled`', () => {
    const api = DECISIONS.find((d) => d.path === 'enable.apiEnabled')!;
    // The English is a fill: the form declares no label for this field.
    const row = formRows(COLLAPSED_SECTIONS).find((r) => r.path === 'enable.apiEnabled')!;
    expect(row.declaresLabel).toBe(false);
    expect(api.en).toBe('Api Enabled');
    // The correct English differs in BYTES, so a case fix would satisfy the echo
    // predicate in every locale while translating nothing.
    const CORRECT_ENGLISH = 'API Enabled';
    expect(CORRECT_ENGLISH).not.toBe(api.en);
    expect(CORRECT_ENGLISH.toLowerCase()).toBe(api.en.toLowerCase());
    // …and none of the three renderings is EITHER English spelling, which is
    // what tells a real translation apart from a byte shift.
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      const value = String(leafOf(forms, api));
      expect(value, `${locale} reads the en source`).not.toBe(api.en);
      expect(value, `${locale} reads the case-fixed English — that is a phantom, not a translation`).not.toBe(
        CORRECT_ENGLISH,
      );
    }
  });
});

describe('#19403 round 8 — the provenance table agrees these leaves are now authored', () => {
  // A second, independent witness to the same fact, from a table nobody edits by
  // hand. An entry exists exactly while a leaf is still a byte copy of the
  // source revision, so re-filling a decided leaf and re-running the extract
  // brings its row back and reds this block — a different trigger than the
  // catalog assertion above (a re-fill FOLLOWED BY an extract, rather than the
  // re-fill itself), which is what makes it a witness and not a restatement.
  for (const [locale, table, objects] of PROVENANCE) {
    it(`${locale}: no decided leaf is still recorded as an extractor fill`, () => {
      // Lit — the table really loaded, so "no entry" cannot pass by the import
      // having come back empty.
      expect(Object.keys(table).length, `${locale} provenance table is empty`).toBeGreaterThan(100);
      const stillFilled = DECISIONS.filter((d) => table[provenanceKey(d)] !== undefined).map(idOf);
      expect(stillFilled, 'these leaves are still byte copies of their source revision').toEqual([]);
    });

    it(`${locale}: the provenance lookup can say "still a fill" — both directions, in this locale`, () => {
      // Dark. The verdict above is a run of `undefined`s, which is also what a
      // misspelt key shape returns — and the `metadataForms.` prefix these
      // tables carry, and the bundles do not, is exactly the misspelling that
      // reads 0 for everything and looks like a clean result.
      //
      // Leg 1 — the key rule: every `metadataForms.*` key this table holds is
      // "metadataForms." followed by the flattened path of a real `en` leaf.
      const enPaths = flattenLeaves(enMetadataForms as Record<string, any>);
      const formKeys = Object.keys(table).filter((k) => k.startsWith('metadataForms.'));
      const strays = formKeys.filter((k) => !enPaths.has(k.slice('metadataForms.'.length)));
      expect(strays, 'a provenance key names no leaf of the en catalog — the key rule moved').toEqual([]);
      // Leg 2 — the composer under test obeys that same rule, and every path it
      // composes really is a leaf of the catalog. So if a decided leaf were
      // still a fill, the lookup above would have found it.
      for (const d of DECISIONS) {
        expect(provenanceKey(d)).toBe(`metadataForms.${idOf(d)}`);
        expect(enPaths.has(idOf(d)), `${idOf(d)} is not a leaf of the en catalog`).toBe(true);
      }
      // Leg 3 — ⭐ THE DISCRIMINATION, taken over a population THIS CARD DOES
      // NOT TOUCH so it cannot shrink as rounds land: the sibling objects
      // catalog. Every leaf that still echoes there has a row, and every leaf a
      // translator wrote has none — a real positive AND a real negative from the
      // same composer, in this locale, in the same run. A lookup that answered
      // `undefined` to everything would fail the first; one that answered
      // something to everything would fail the second.
      const enObjectPaths = flattenLeaves(enObjects as Record<string, any>);
      const localeObjects = flattenLeaves(objects as Record<string, any>);
      const echoing = [...enObjectPaths].filter(([path, en]) => localeObjects.get(path) === en).map(([path]) => path);
      const authored = [...enObjectPaths]
        .filter(([path, en]) => localeObjects.has(path) && localeObjects.get(path) !== en)
        .map(([path]) => path);
      expect(echoing.length, `${locale} has no echoing objects leaf to sample`).toBeGreaterThan(50);
      expect(authored.length, `${locale} has no authored objects leaf to sample`).toBeGreaterThan(50);
      expect(
        echoing.filter((path) => table[`objects.${path}`] === undefined),
        'an echoing objects leaf carries NO provenance row — the lookup under-reports',
      ).toEqual([]);
      expect(
        authored.filter((path) => table[`objects.${path}`] !== undefined),
        'an authored objects leaf carries a provenance row — the lookup over-reports',
      ).toEqual([]);
    });

    it(`${locale}: ⭐ the second witness agrees with the round 10 deferral, and with zh-CN's own answer`, () => {
      // The companion is an independent reading of the same fact, and here it
      // carries the evidence the deferral rests on: the lifecycle leaves are
      // recorded as unauthored fills in ja-JP and es-ES and in NEITHER zh-CN's
      // bundle nor zh-CN's companion, because zh-CN answered all sixteen
      // concepts with authored words. Shrink-only in both directions: the round
      // that empties the ja/es rows leaves this green.
      const lifecycleRows = Object.keys(table).filter((k) =>
        k.startsWith(`metadataForms.object.fields.${DEFERRED_SUBTREE}.`),
      );
      if (locale === 'zh-CN') {
        expect(lifecycleRows, 'zh-CN records a lifecycle leaf as a fill — its authored answers are gone').toEqual([]);
      } else {
        expect(
          lifecycleRows.length,
          `${locale} records more lifecycle fills than the subtree has leaves`,
        ).toBeLessThanOrEqual(32);
      }
    });

    it(`${locale}: no leaf of the two COLLAPSED sections is recorded as a fill unless it is deferred`, () => {
      // The strongest form the verdict above can take for this class: not "none
      // of my eleven", but "nothing this population reaches, outside the
      // declared deferral". Lit by the table being large.
      expect(Object.keys(table).length).toBeGreaterThan(100);
      const stillFilled = PANEL_LEAVES.filter(
        (l) => !inDeferral(l) && table[`metadataForms.object.fields.${l.path}.${l.prop}`] !== undefined,
      ).map((l) => `${l.path}.${l.prop}`);
      expect(stillFilled, 'a collapsed-section leaf is still an extractor fill and no row decides it').toEqual([]);
    });
  }
});

describe('#19403 round 8 — the population, DERIVED from the form and a shape', () => {
  it('⭐ every key the form declares in these sections is a key of the catalog', () => {
    // The ratchet's anchor. The catalog is GENERATED from this form, so a field
    // added to a collapsed section arrives in both at once — which is what makes
    // this population pick up a future unauthored row without anybody adding it
    // to a list.
    const fields = ((enMetadataForms as Record<string, any>).object?.fields ?? {}) as Record<string, any>;
    const declared = formRows([...COLLAPSED_SECTIONS, ...OPEN_SECTIONS]).map((r) => r.path);
    expect(declared.length).toBeGreaterThan(60);
    expect(declared.filter((p) => !(p in fields)), 'the form declares a field the catalog has no entry for').toEqual([]);
    expect(
      Object.keys(fields).filter((k) => !declared.includes(k)),
      'the catalog holds an object field the form does not declare',
    ).toEqual([]);
  });

  it('the COLLAPSED predicate splits that population, and is read off the SHAPE not a name list', () => {
    // Lit.
    expect(FORM_SECTIONS.length).toBe(4);
    expect(COLLAPSED_SECTIONS).toEqual(['capabilities', 'advanced']);
    expect(OPEN_SECTIONS).toEqual(['basics', 'fields']);
    // 45 leaves: 9 this round decides, 2 already authored, 32 deferred.
    expect(PANEL_LEAVES.length).toBe(45);
    expect(PANEL_LEAVES.every((l) => l.prop === 'label' || l.prop === 'helpText')).toBe(true);
    expect(PANEL_LEAVES.filter((l) => l.section === 'capabilities').length).toBe(9);
    expect(PANEL_LEAVES.filter((l) => l.section === 'advanced').length).toBe(36);
  });

  it('⭐ DARK, OUTWARD — the open sections are excluded, and `fields.placeholder` is the one that proves it', () => {
    // 94 leaves are left out. The sharpest single exclusion is a key #19403's
    // own body samples as the echoing field-editor panel: it is OUT, and it is
    // already authored, so a walk that wrongly swept it in would not go red.
    expect(OPEN_LEAVES.length).toBe(94);
    expect(PANEL_LEAVES.some((l) => l.path === 'fields.placeholder')).toBe(false);
    expect(OPEN_LEAVES.some((l) => l.path === 'fields.placeholder')).toBe(true);
    for (const path of ['name', 'label', 'fields', 'fields.valueDomain', 'fields.deleteBehavior', 'fields.expression']) {
      expect(PANEL_LEAVES.some((l) => l.path === path), `${path} sits in an open section`).toBe(false);
    }
    // …and nothing in the open sections echoes, in any locale — the exclusion
    // removes only leaves that earlier rounds of this card already decided.
    const openEchoes: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of OPEN_LEAVES) {
        if (catalogLeaf(forms, leaf.path, leaf.prop) === leaf.en) openEchoes.push(`${locale} ${leaf.path}.${leaf.prop}`);
      }
    }
    expect(openEchoes, 'an open-section leaf echoes — that belongs to the field-editor ledger, not this one').toEqual(
      [],
    );
  });

  it('⭐ DARK, INWARD — `datasource` is IN the population and comes back NON-ECHOING', () => {
    // A hand-list of the eleven echoing leaves can only ever produce positives.
    // This derivation produces a negative on two of its own members, in the same
    // walk, in all three locales. Without it, "all eleven were echoes" would be
    // unfalsifiable.
    const leaves = PANEL_LEAVES.filter((l) => l.path === AUTHORED_MEMBER);
    expect(leaves.length, 'datasource contributes no leaf to the population').toBe(2);
    for (const leaf of leaves) {
      for (const [locale, forms] of TRANSLATED_LOCALES) {
        expect(
          catalogLeaf(forms, leaf.path, leaf.prop),
          `${locale} ${leaf.path}.${leaf.prop} is an echo, not a control`,
        ).not.toBe(leaf.en);
      }
    }
  });

  it('⭐⭐ DARK, INWARD, TWO-LOCALE — the lifecycle panel is VISIBLE to this walk, not excluded by it', () => {
    // The card's headline predicate is "echoes in ALL THREE locales" and it
    // reads ZERO for this subtree, because zh-CN authored all of it. A ja-JP
    // author still reads the whole panel in English. This walk is per-locale, so
    // it SEES them — and they are deferred to round 10, not decided here.
    const deferred = PANEL_LEAVES.filter(inDeferral);
    expect(deferred.length, 'the walk no longer reaches the lifecycle subtree').toBe(32);
    expect(deferred.filter((l) => l.prop === 'label').length).toBe(16);
    expect(deferred.filter((l) => l.prop === 'helpText').length).toBe(16);
    // ⭐ zh-CN answered all sixteen concepts with authored words — the sibling
    // locale that makes this an unauthored fill rather than a rendering. Its
    // count is asserted at ZERO and stays there.
    const zh = (zhCNMetadataForms as Record<string, any>);
    const zhEchoes = deferred.filter((l) => catalogLeaf(zh, l.path, l.prop) === l.en).map((l) => `${l.path}.${l.prop}`);
    expect(zhEchoes, 'zh-CN started echoing the lifecycle panel — the sibling-locale evidence is gone').toEqual([]);
    // The other two are where the deferral lives.
    const twoLocale = deferred.filter((l) =>
      TRANSLATED_LOCALES.filter(([, forms]) => catalogLeaf(forms, l.path, l.prop) === l.en).length > 0,
    );
    // ⚠️ ROUND 9'S REPAIR OF A ROUND 8 SLIP, in the block round 9 had to edit
    // anyway. This line read `toBeLessThanOrEqual(deferred.length)` — and
    // `twoLocale` is `deferred.filter(…)`, so a subset was being bounded by the
    // set it came out of: TRUE FOR EVERY TREE, a tautology sitting inside this
    // round's ⭐⭐ headline control. The bound is now the RECORDED LITERAL, the
    // spelling this same file already uses 105 lines up, and the two legs below
    // prove what the old one could not.
    const RECORDED_DEFERRAL = 32;
    const withinRecorded = (n: number): boolean => n <= RECORDED_DEFERRAL;
    expect(withinRecorded(twoLocale.length)).toBe(true);
    // Dark, leg 1 — IT CAN SAY NO. A 33rd two-locale echo (a field added to a
    // collapsed section tomorrow) breaks the bound. The OLD spelling is run on
    // the same input beside it and still reads true, which is the defect
    // executed rather than described.
    const oldBound = (subset: readonly PanelLeaf[], superset: readonly PanelLeaf[]): boolean =>
      subset.length <= superset.length;
    const grown = [...deferred, deferred[0]];
    expect(grown.length, 'the synthetic population is one larger than the recorded one').toBe(RECORDED_DEFERRAL + 1);
    expect(oldBound(grown, grown), 'the OLD bound, on a population that grew past the recorded literal').toBe(true);
    expect(withinRecorded(grown.length), 'the NEW bound, on the same input').toBe(false);
    // …and the old bound is not merely weak, it is unfalsifiable: `twoLocale` is
    // drawn FROM `deferred`, so no tree can make a subset outgrow its superset.
    expect(oldBound(twoLocale, deferred), 'a filtered subset can never exceed the set it came from').toBe(true);
    // Dark, leg 2 — SHRINK-ONLY. Round 10 empties the deferral and this stays
    // green, which is the property the bound exists to have.
    expect(withinRecorded(0)).toBe(true);
  });

  it('no leaf of this population reads its `en` source unless it is decided or declared DEFERRED', () => {
    // The ratchet. A field added to a collapsed section tomorrow, or a re-fill of
    // a decided one, is red on the day it lands. Round 9 shrinking the deferral
    // leaves it green.
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of PANEL_LEAVES) {
        if (catalogLeaf(forms, leaf.path, leaf.prop) !== leaf.en) continue;
        if (inDeferral(leaf)) continue;
        const decided = DECISIONS.find((d) => d.path === leaf.path && d.prop === leaf.prop);
        if (decided?.verdict[locale] === 'echo') continue;
        undecided.push(`${locale} object.fields.${leaf.path}.${leaf.prop} (${JSON.stringify(leaf.en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf in the population', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog: every leaf
    // must come back flagged, or the green above means only that the walk found
    // nothing.
    const flagged = PANEL_LEAVES.filter(
      (l) => catalogLeaf(enMetadataForms as Record<string, any>, l.path, l.prop) === l.en,
    );
    expect(flagged.length).toBe(PANEL_LEAVES.length);
  });

  it('⭐ the capability block is now DONE — zero of its 9 leaves echoes in any locale', () => {
    const capability = PANEL_LEAVES.filter((l) => l.section === 'capabilities');
    const echoing = capability.filter((l) =>
      TRANSLATED_LOCALES.some(([, forms]) => catalogLeaf(forms, l.path, l.prop) === l.en),
    );
    expect(echoing.map((l) => `${l.path}.${l.prop}`)).toEqual([]);
    // Lit — and it really walked the section, which a zero alone would not show.
    expect(capability.length).toBe(9);
  });
});

describe('#19403 round 8 — one schema key, one rendering', () => {
  it('⭐ `trackHistory` and `searchable` are COPIED from their authored twins, byte for byte', () => {
    const fields = (forms: Record<string, any>, key: string, prop: string): string =>
      String(forms.object?.fields?.[key]?.[prop]);
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      // The twin and this round's leaf carry the identical English string…
      expect(catalogLeaf(enMetadataForms as Record<string, any>, 'fields.trackHistory', 'label')).toBe('Track History');
      expect(catalogLeaf(enMetadataForms as Record<string, any>, 'fields.searchable', 'label')).toBe('Searchable');
      // …so they must carry the identical rendering. Rewording either reds this.
      expect(fields(forms, 'enable.trackHistory', 'label'), `${locale} trackHistory diverged from its twin`).toBe(
        fields(forms, 'fields.trackHistory', 'label'),
      );
      expect(fields(forms, 'enable.searchable', 'label'), `${locale} searchable diverged from its twin`).toBe(
        fields(forms, 'fields.searchable', 'label'),
      );
      // …and the SECOND panel that declares `searchable` agrees with both.
      expect(
        String((forms as Record<string, any>).field?.fields?.searchable?.label),
        `${locale} the field panel's searchable diverged`,
      ).toBe(fields(forms, 'enable.searchable', 'label'));
    }
  });

  it('⛔ the neighbouring senses of "Capabilities" are still deliberately untouched', () => {
    // Round 6 landed 能力 / ケイパビリティ for the HookBodyCapability token list
    // and left the object panel's feature-toggle heading alone; round 7 asserted
    // both. Nothing here moves either, and `enable.label` stays distinguishable
    // from the heading it sits under.
    const expected: Record<string, { section: string; tokens: string }> = {
      'zh-CN': { section: '功能开关', tokens: '能力' },
      'ja-JP': { section: '機能', tokens: 'ケイパビリティ' },
      'es-ES': { section: 'Capacidades', tokens: 'Capacidades' },
    };
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      expect(String(forms.object?.sections?.capabilities?.label), `${locale} section heading moved`).toBe(
        expected[locale].section,
      );
      for (const type of ['hook', 'action']) {
        expect(
          String(forms[type]?.fields?.['body.capabilities']?.label),
          `${locale} ${type} body.capabilities moved`,
        ).toBe(expected[locale].tokens);
      }
      // The composite this round renders must not collide with its own heading.
      expect(
        String(catalogLeaf(forms, 'enable', 'label')),
        `${locale} enable.label reads as a repeat of its section heading`,
      ).not.toBe(expected[locale].section);
    }
  });

  it('⭐ `feeds` and `activities` stay distinguishable — from each other, and from Timeline', () => {
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      const feeds = String(catalogLeaf(forms, 'enable.feeds', 'label'));
      const activities = String(catalogLeaf(forms, 'enable.activities', 'label'));
      expect(feeds, `${locale} feeds and activities collapsed onto one word`).not.toBe(activities);
      const timeline = String(forms.view?.fields?.timeline?.label);
      expect(timeline.length, `${locale} view.fields.timeline is missing`).toBeGreaterThan(0);
      expect(feeds, `${locale} feeds took the Timeline rendering`).not.toBe(timeline);
      expect(activities, `${locale} activities took the Timeline rendering`).not.toBe(timeline);
    }
  });

  it('the objects-catalog evidence the `files` and `activities` rows were derived from is still there', () => {
    // Round 5's discipline, from the other side: a row that names a twin has to
    // be able to point at it. These are the two twins that live in the objects
    // catalog rather than the metadata-form one.
    const en = enObjects as Record<string, any>;
    expect(en.sys_attachment?.fields?.file_id?.label).toBe('File');
    expect(en.sys_user?.fields?.two_factor_enabled?.label).toBe('Two-Factor Enabled');
    const expected: Record<string, readonly [string, string]> = {
      'zh-CN': ['文件', '已启用双因素认证'],
      'ja-JP': ['ファイル', '二要素認証 有効'],
      'es-ES': ['Archivo', 'Doble factor habilitado'],
    };
    for (const [locale, objects] of TRANSLATED_OBJECTS) {
      expect(String(objects.sys_attachment?.fields?.file_id?.label), `${locale} the File twin moved`).toBe(
        expected[locale][0],
      );
      expect(
        String(objects.sys_user?.fields?.two_factor_enabled?.label),
        `${locale} the "X Enabled" twin moved`,
      ).toBe(expected[locale][1]);
    }
  });
});
