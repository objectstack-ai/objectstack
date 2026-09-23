// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19403 round 7 — the DECISION LEDGER for the BARE metadata types'
// display pairs.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// This file is that record, in the shape #19355 landed in
// `report-dataset-panel-echo-decisions.test.ts` and the six earlier rounds of
// this card extended (`object-field-editor-panel-`, `page-interface-panel-`,
// `dataset-panel-`, `field-panel-`, `action-body-panel-` and
// `hook-execution-panel-echo-decisions.test.ts`): one row per string leaf, each
// carrying its verdict per locale, the reason it was reached, and the `en`
// source it was judged against.
//
// ## ⛔⛔ THE EXIT THIS ROUND TAKES, WRITTEN DOWN
//
// Rounds 5 and 6 both refused this family on one standing reason:
//
//     only a real panel keeps the DERIVED-POPULATION property with a working
//     dark control — six unrelated types degenerate the derivation into six
//     one-entry lookups and the control has nothing to exclude.
//
// This round takes EXIT 1: it takes them, and it names a SUBSTITUTE for that
// property. The refusal was right about what it refused. It was reasoning about
// a population spelled `['seed','mapping','api','doc','book','capability']` —
// a hand-list, which derives nothing and excludes nothing. That is not the only
// population available.
//
//   WHAT DERIVES THE POPULATION, IF NOT ONE PANEL'S `en` SUBTREE.
//   `DEFAULT_METADATA_TYPE_REGISTRY` — the spec-side list of every metadata
//   type the platform declares — crossed with ONE predicate read off the
//   catalog's shape: a type is BARE when its catalog entry has no `fields` and
//   no `sections`, i.e. the registry entry IS the whole panel. Both halves are
//   derived and neither is this ledger's own opinion: the registry lives in
//   `packages/spec` (a package this round does not touch) and is the very thing
//   that MANUFACTURES these leaves — `seed.label` in the catalog is the
//   registry entry's own `label`, asserted below. Ten types satisfy the
//   predicate. The six this round decides are the six of them that echo.
//
//   WHAT THE DARK CONTROL CAN EXCLUDE — and it excludes twice, once outward and
//   once INSIDE the population, which is the half a panel walk never has.
//     (1) OUTWARD: the 17 types that DO carry a form are excluded, and their
//         own type-level display pairs are already authored in all three
//         locales. The sharpest single exclusion is `dataset`: it carries a
//         registry `description` exactly as these six do, so any walk keyed on
//         "registry entries with a description" would sweep it in — the BARE
//         predicate is what leaves it out, and it is authored, so a walk that
//         wrongly included it would not even go red. Asserted by name.
//     (2) INWARD: FOUR of the ten bare types — `job`, `datasource`,
//         `external_catalog`, `translation` — are IN the population and come
//         back NON-ECHOING. A hand-list of six cannot produce a negative
//         result; this derivation does, on four of its own members, in the same
//         run. That is the control the refusal said this family could not have.
//
//   ⭐ AND THE SUBSTITUTE IS STRICTLY STRONGER THAN A PANEL WALK IN ONE
//   MEASURABLE WAY. A panel walk is bounded by a type that already exists. This
//   one is bounded by a SHAPE over the registry, so the arrival of a NEW
//   metadata type — the actual way this defect class reproduces, since every
//   one of these six leaves was born the day its registry entry was added —
//   lands in the population automatically and reds this file until somebody
//   decides it. No single-panel ledger in this series can do that.
//
// ⛔ What this round did NOT claim: that the property is preserved unchanged.
// It is SUBSTITUTED. The panel rounds derive a population from one `en`
// subtree; this one derives it from the registry and a shape predicate. Both
// controls below are real, and they are not the same controls.
//
// ## ⛔⛔ The phantom-translation trap, and why the shortcut is out of reach HERE
//
// Round 5 measured the hazard on `action.fields.ai.label`: `Ai` -> `AI` DIFFERS
// IN BYTES, so it passes the echo predicate in all three locales and drops the
// census by a key while telling a zh-CN author nothing. ⇒ AN ECHO THAT STOPS
// MATCHING IS NOT THE SAME THING AS A LEAF THAT GOT TRANSLATED. The dispatch
// named this family as where that bites hardest, because twelve short strings
// are exactly what an English touch-up flatters.
//
// ⭐ Here the shortcut is not merely refused, it is STRUCTURALLY UNREACHABLE,
// and that is a property of this family nobody chose: the `en` side of every
// row is the registry entry in `packages/spec/src/kernel/metadata-plugin.zod.ts`,
// NOT a string in this package. Touching up the English would be an edit to
// another package, outside the file surface this round was given. The only edit
// reachable from here is the one that actually renders the leaf. Every row is
// pinned to the LIVE REGISTRY as well as to the live `en` catalog below, so a
// reworded source reds this file rather than leaving a decision standing over
// text nobody judged.
//
// ## The #19430 discipline — FIVE readings, each asserted AT THE SCHEMA
//
// This family's prose is unusually rich in words that LOOK like values an
// author writes. Each was read at the live schema, resolved through
// `getMetadataTypeSchema` (the registry's own schema map) rather than a
// hand-picked import, before a word was rendered:
//
//   • `doc.description` and `capability.description` both open with "Package".
//     `package` IS a legal value — of `MetadataProvenanceSchema`
//     ("package"|"org"|"env-forced"), which every metadata schema splices in as
//     `_provenance`. THE NEAR-MISS IS REAL on both types and it is CLEARED
//     three ways, all asserted: (i) the key is `_provenance`, an underscore
//     envelope field the LOADER sets — the item parses without it and the whole
//     `en` metadata-forms catalog names no `_`-prefixed key anywhere, so no
//     form ever asks an author for it; (ii) these types are BARE, so their
//     display pair labels no input at all — the same predicate that derives the
//     population; (iii) where this catalog DOES render a leaf whose stored
//     value is literally `package`, it renders the DISPLAY and keeps the value
//     (`sys_metadata.fields.managed_by.options.package` is 包 / パッケージ /
//     Paquete), so rendering the English noun follows the catalog's own
//     convention rather than breaking it.
//   • `mapping.description` reads "(rename + transforms)". `rename` is NOT a
//     `TransformType` member — the enum is
//     none/constant/lookup/split/join/javascript/map — so no author is ever
//     asked to write it and it is rendered. ⭐ But `map` IS a member, and
//     "field mapping" CONTAINS it: `'field mapping'.includes('map')` is TRUE
//     while the word-boundary predicate says NO. That pair is the dark control
//     for the token guard below; a substring guard here would have been a
//     phantom that fires on the word it is supposed to pass.
//   • `seed.description` ends "applied on publish". `publish` LOOKS like a
//     `SeedMode` and is not one (insert/update/upsert/replace/ignore), so the
//     word is rendered — and rendered with this catalog's own authored answer,
//     since `sys_metadata_history.fields.operation_type.options.publish` is
//     already 发布 / 公開 / Publicar.
//   • `api.description` says "over an existing pipeline". `pipeline` LOOKS like
//     an `ApiEndpointSchema.type` and is not one (flow/script/object_operation/
//     proxy), so it is rendered.
//   • `book.description` says "ordered groups". `groups` is a KEY of
//     `BookSchema` that takes an ARRAY, not an enum value — no rendered word
//     can land in it, by the rule round 6 used to clear `timeoutMs`.
//
// All five are asserted below rather than described, so a schema change that
// makes one of them false reds this file — round 6 raised the bar from
// "checked" to "pinned" and this round keeps it there.
//
// ## ⭐ THE SAME ENGLISH STEM IN THREE POSITIONS, DECIDED TWO WAYS
//
// `capability.label` is the third position in this catalog for the word round 6
// reworded, and this round does NOT simply copy that decision — the precedent
// answers only the question it contains.
//
//   `hook.fields.body.capabilities.label` / `action.fields.body.capabilities.label`
//       a HookBodyCapability TOKEN list. Round 6 moved both off 功能 / 機能 to
//       能力 / ケイパビリティ in ONE act. UNTOUCHED here, and asserted so.
//   `object.sections.capabilities.label`
//       the object's FEATURE TOGGLES (trackHistory, searchable, …). Reads
//       功能开关 / 機能 / Capacidades and round 6 left it deliberately alone.
//       Still untouched, and asserted so — this is the position that proves the
//       word was decided per meaning and not swept.
//   `capability.label`  ← THIS ROUND
//       the ADR-0066 metadata TYPE, whose instances are named authorization
//       capability keys (`export_data`, `billing.refund` — the schema's own
//       name-regex message). That is the SAME concept as the token list, so it
//       takes the same word — but it is derived, not borrowed: the objects
//       catalog renders exactly that sense at `sys_user.fields.ai_access.help`
//       (the `ai_seat` capability) and `sys_email.fields.attachments_json.help`
//       (the file-storage capability) as 能力 / ケイパビリティ, which is the
//       evidence round 6 derived from too. ⇒ zh-CN and ja-JP agree with the
//       landed pair by DERIVATION; es-ES deliberately differs in NUMBER
//       (Capacidad, not Capacidades) because this leaf names one capability and
//       that one names a list.
//
// ## The instrument, with its controls
//
// Census: flatten every `*.metadata-forms.generated.ts` bundle and compare each
// `.label` leaf against `en`. Re-taken by this round on base 88920d153:
//
//   en string leaves / `.label` leaves            893 / 538
//   POSITIVE CONTROL — labels genuinely translated 520 (zh-CN) · 504 · 504
//   label keys echoing in ALL THREE locales          18 => 54 `.label` leaves
//
// After: 12 keys / 36 `.label` leaves, control 526 · 510 · 510 — echoes down 6
// and the control up 6 in each locale, same population, same run. ⚠️ 54 and 36
// count `.label` leaves; the DECIDABLE sibling remainder (a label plus its
// `description`/`helpText`) is a different question and reads 29 before, 17
// after. ⭐ THE TWO NUMBERS MOVE BY DIFFERENT AMOUNTS HERE FOR A REASON WORTH
// STATING: this round decides 6 labels AND 6 descriptions, so the headline
// drops by 6 while the decidable remainder drops by 12. State which count you
// mean.
//
// Per-leaf control: this package's provenance table
// (`<locale>.source-hashes.generated.ts`) holds an entry exactly while a leaf is
// still a byte copy of the source revision. All 12 leaves decided here carried
// one in all three locales; `pnpm i18n:extract` dropped exactly those 36 rows
// and added none, which is asserted below.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own per-locale reason
// precisely so that recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema } from '@objectstack/spec/kernel';

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
   * `type` for a metadata type's own display pair. Every row in this ledger is
   * `type` and that is the family's definition rather than an observation: a
   * BARE type has no `fields` and no `sections` for a row to point at.
   */
  scope: 'type';
  /** The metadata type — also the top-level bundle key. */
  key: string;
  /** Which string leaf of that entry this row decides. */
  prop: 'label' | 'description';
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle AND to the live registry entry that manufactures it, so a reworded
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
}

const ALL_TRANSLATE: Readonly<Record<string, Verdict>> = {
  'zh-CN': 'translate',
  'ja-JP': 'translate',
  'es-ES': 'translate',
};

const DECISIONS: readonly Decision[] = [
  {
    scope: 'type',
    key: 'seed',
    prop: 'label',
    en: 'Seed Data',
    verdict: ALL_TRANSLATE,
    reason:
      'NO AUTHORED TWIN FOR "seed" IN EITHER CATALOG, AND THIS ROW SAYS SO rather than leaning on one — the discipline round 5 wrote down on memoryMb. "data" is composed from this catalog\'s own answer (view.fields.data.label 数据 / データ / Datos), and "seed" is rendered 种子 / シード / semilla. ⇒ 种子数据 / シードデータ / Datos semilla. ⚠️ ja transliterates rather than translating, which is this catalog\'s established habit for a technical noun with no Japanese term of art (データソース, データセット, バックグラウンドジョブ are all authored that way). ⛔ What was refused: leaving the label and letting the description carry the concept — the type chooser shows the LABEL, and an author picking a metadata type sees this string and nothing else.',
  },
  {
    scope: 'type',
    key: 'seed',
    prop: 'description',
    en: 'Fixture / initialization data applied on publish',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ "publish" READS LIKE A SeedMode AND IS NOT ONE — asserted below: SeedSchema accepts mode "upsert" and refuses mode "publish", so the enum is insert/update/upsert/replace/ignore and this word is prose, not a value an author writes. With that settled it takes this catalog\'s OWN authored answer for the word: sys_metadata_history.fields.operation_type.options.publish is 发布 / 公開 / Publicar. "Fixture" is read from SeedSchema\'s own docblock (system bootstrapping, reference data, demo data — preset rows, NOT test fixtures) and rendered 预置 / フィクスチャ / predefinidos. ⇒ 发布时应用的预置/初始化数据 / 公開時に適用されるフィクスチャ／初期化データ / Datos predefinidos / de inicialización aplicados al publicar. ⚠️ Separator copied, not chosen: zh keeps the ASCII slash this catalog uses in 共享/个人层 and 度量/维度, ja folds it to the full-width ／ it uses in 共有／個人レイヤー, es keeps a spaced /.',
  },
  {
    scope: 'type',
    key: 'mapping',
    prop: 'label',
    en: 'Import Mapping',
    verdict: ALL_TRANSLATE,
    reason:
      'BOTH WORDS HAVE AUTHORED TWINS and the row names each. "import": sys_import_job.label is 导入任务 / インポートジョブ / Trabajo de importación. "mapping": sys_sso_provider.fields.oidc_config.help renders the bare word as 映射 / マッピング / mapeo. ⇒ 导入映射 / インポートマッピング / Mapeo de importación. ⚠️ es follows its own twin\'s shape — noun + "de" + noun, as Trabajo de importación does — rather than the adjectival form.',
  },
  {
    scope: 'type',
    key: 'mapping',
    prop: 'description',
    en: 'Reusable import/export field mapping (rename + transforms), referenced by name at import',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ THE ROW THAT MADE THE TOKEN GUARD EARN ITS WORD BOUNDARIES. `map` IS a legal TransformType value and "field mapping" CONTAINS it, so a substring guard would flag this leaf for a token that is not in it; the word-boundary predicate says NO and both halves are asserted below. `rename` is the mirror image — it READS like a transform kind and the enum refuses it (none/constant/lookup/split/join/javascript/map, asserted), so it is prose and it is rendered: 重命名 / リネーム / renombrado. ⭐ "referenced by name" is copied from an EXACT authored twin, dataset.sections.measures.description: 按名称引用 / 名前で参照 / referenciados por nombre. "field" takes field.fields.type.helpText (字段 / フィールド / campo). ⇒ 可复用的导入/导出字段映射（重命名 + 转换），在导入时按名称引用 / 再利用可能なインポート／エクスポートのフィールドマッピング（リネーム + 変換）。インポート時に名前で参照します / Mapeo de campos de importación/exportación reutilizable (renombrado + transformaciones), referenciado por nombre al importar. ⛔ AND THE ONE PIECE OF EVIDENCE THIS ROW DOES NOT HAVE, stated rather than papered over: "export" appears in NEITHER catalog in any authored leaf. zh 导出 and ja エクスポート are composed by symmetry with the authored 导入 / インポート half, not copied from a twin; es exportación mirrors the authored importación. ⚠️ Parenthesis convention copied: zh and ja take full-width （）, es keeps ASCII.',
  },
  {
    scope: 'type',
    key: 'api',
    prop: 'label',
    en: 'API Endpoint',
    verdict: ALL_TRANSLATE,
    reason:
      'COPIED VERBATIM FROM ONE AUTHORED TWIN THAT ANSWERS THE WHOLE PHRASE: action.fields.target.helpText ("URL, flow name, or API endpoint to call") is 调用的 URL、流程名或 API 端点 / 呼び出す URL、フロー名、または API エンドポイント / URL, nombre de flujo o endpoint API que llamar. ⇒ API 端点 / API エンドポイント / Endpoint API. ⭐ `API` stays a machine token in all three and es keeps `endpoint` ENGLISH — that is the twin\'s spelling, not a stylistic choice, and es keeps it in every authored endpoint leaf (Método de autenticación del endpoint de token, endpoint OIDC de finalización de sesión). ⛔ es was NOT restyled to "Endpoint de API": the authored twin spells the compound "endpoint API" and copying it is the whole rule.',
  },
  {
    scope: 'type',
    key: 'api',
    prop: 'description',
    en: 'Declarative HTTP endpoint — a stable URL and policy layer over an existing pipeline (ADR-0121)',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐ "pipeline" READS LIKE AN ApiEndpointSchema.type AND IS NOT ONE — asserted below: the schema accepts type "proxy" and refuses type "pipeline" (flow/script/object_operation/proxy), so the word is prose and is rendered 管道 / パイプライン / pipeline. "policy" takes the sense this catalog already separates and round 6 recorded: 策略 for a configured strategy (hook.fields.retryPolicy.label 重试策略), NOT 政策 which is reserved for a published document (sys_oauth_application.fields.policy.label 隐私政策); ja ポリシー, es política. "layer" takes sys_view_definition.description (软件包层 / パッケージレイヤー / La capa de paquete) — ⚠️ zh renders it 层 and ja レイヤー there, but this leaf\'s ja reads 層 in the compound ポリシー層 because the twin\'s レイヤー is itself attached to a katakana head; the reading is recorded rather than silently harmonised. ⭐ `HTTP`, `URL` and `ADR-0121` are KEPT VERBATIM in all three — machine tokens by the rule that kept 256 and N in round 6, asserted by the token guard below. ⚠️ em-dash convention copied: zh folds to —— with no spaces (hook.sections.legacy_handler.description 函数名引用——已废弃), ja and es keep a spaced —.',
  },
  {
    scope: 'type',
    key: 'doc',
    prop: 'label',
    en: 'Documentation',
    verdict: ALL_TRANSLATE,
    reason:
      'object.fields.description.helpText ("Developer documentation") is 开发文档说明 / 開発者向けドキュメント / Documentación para desarrolladores, so the bare word is 文档 / ドキュメント / Documentación. ⇒ exactly that. ⛔ NOT 文档说明 — the twin\'s 说明 belongs to "helpText for a description field", not to the noun.',
  },
  {
    scope: 'type',
    key: 'doc',
    prop: 'description',
    en: 'Package documentation — flat Markdown items (ADR-0046)',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐⭐ ONE OF THE TWO ROWS WHERE THE #19430 NEAR-MISS IS REAL. `package` IS a legal MetadataProvenanceSchema value and DocSchema really does accept `_provenance: "package"` while refusing a rendered one — both asserted below, so the trap is proved to exist before it is cleared. It is CLEARED three ways, each asserted: the key is `_provenance`, which the loader sets and no form asks for (a doc parses without it, and the whole en metadata-forms catalog names no `_`-prefixed key); `doc` is BARE, so this string labels no input at all; and where this catalog DOES render a leaf whose stored value is literally `package` it renders the display and keeps the value (sys_metadata.fields.managed_by.options.package is 包 / パッケージ / Paquete). ⇒ rendered. "flat" takes position.sections.position.description (扁平的 / フラットな / plano); "items" takes app.sections.navigation.description (侧边栏菜单项 / サイドバー項目 / Elementos de barra lateral). ⇒ 软件包文档——扁平的 Markdown 文档项（ADR-0046） / パッケージのドキュメント — フラットな Markdown 項目（ADR-0046） / Documentación del paquete — elementos Markdown planos (ADR-0046). ⚠️ zh answers "package" two ways in this catalog — 包 inside compounds (包 ID, 包版本) and 软件包 in running prose (软件包层) — and this is prose, so it takes 软件包. ⭐ `Markdown` is KEPT as a format proper noun in all three, the same treatment the catalog gives HTML in sys_email_template.fields.body_text.help; asserted by the token guard.',
  },
  {
    scope: 'type',
    key: 'book',
    prop: 'label',
    en: 'Documentation Book',
    verdict: ALL_TRANSLATE,
    reason:
      'NO AUTHORED TWIN FOR "book" IN EITHER CATALOG — stated, not borrowed. The head noun is copied from the doc rows above (文档 / ドキュメント / documentación) and only "book" is composed: zh 手册, because BookSchema is the reader-facing artifact a spine assembles and 书 alone reads as a printed volume; ja ブック, transliterated by the same habit as シード above; es Libro, the literal, which Spanish documentation tooling uses unchanged. ⇒ 文档手册 / ドキュメントブック / Libro de documentación. ⭐ The pair is deliberately distinguishable from doc.label (文档 / ドキュメント / Documentación) in every locale, because the two types sit side by side in the same chooser.',
  },
  {
    scope: 'type',
    key: 'book',
    prop: 'description',
    en: 'Documentation navigation spine — ordered groups with derived membership (ADR-0046 §6)',
    verdict: ALL_TRANSLATE,
    reason:
      '`groups` IS A KEY, NOT AN ENUM VALUE — asserted below by the rule round 6 used to clear timeoutMs: BookSchema.groups takes an ARRAY (it refuses the string "ordered"), so no rendered word can land in it. "navigation" takes app.sections.navigation.label (导航 / ナビゲーション / Navegación); "ordered" takes report.fields.order.label (排序 / 並び順 / Orden); "derived" takes dataset.fields.measures.derived.label (派生自 / 派生元 / Derivada de). "spine" and "membership" have no authored twin and the row says so: spine is rendered 主干 / 骨格 / Columna vertebral and membership 成员 / メンバーシップ / pertenencia. ⇒ 文档导航主干——有序分组，成员由派生确定（ADR-0046 §6） / ドキュメントナビゲーションの骨格 — 順序付きグループと派生されたメンバーシップ（ADR-0046 §6） / Columna vertebral de navegación de la documentación — grupos ordenados con pertenencia derivada (ADR-0046 §6). ⭐ `ADR-0046` AND `§6` are both kept verbatim — the section mark is part of the citation and is asserted as its own token, because dropping it is the kind of loss no census can see.',
  },
  {
    scope: 'type',
    key: 'capability',
    prop: 'label',
    en: 'Capability',
    verdict: ALL_TRANSLATE,
    reason:
      '⭐⭐ THE THIRD POSITION OF THE WORD ROUND 6 REWORDED, AND IT IS DERIVED RATHER THAN BORROWED. A precedent answers only the question it contains: round 6 decided a HookBodyCapability TOKEN list, not this metadata type. This leaf is the ADR-0066 authorization capability, whose instances are named keys (the schema\'s own name-regex message offers export_data and billing.refund), and the objects catalog renders exactly that sense twice — sys_user.fields.ai_access.help (the ai_seat capability) and sys_email.fields.attachments_json.help (the file-storage capability) — as 能力 / ケイパビリティ. That is the evidence round 6 derived from, reaching a third position on its own, so zh-CN and ja-JP AGREE with the landed pair without copying it. ⇒ 能力 / ケイパビリティ / Capacidad. ⚠️ es-ES deliberately DIFFERS from the landed pair in NUMBER: Capacidad, not Capacidades, because this leaf names one capability and hook/action.fields.body.capabilities.label names a list. ⛔ AND THE POSITION THAT WAS NOT SWEPT: object.sections.capabilities.label stays 功能开关 / 機能 / Capacidades — it is the object\'s FEATURE TOGGLES, a different concept wearing the same English stem, and round 6 left it alone on purpose. Both the agreement and the non-agreement are asserted below.',
  },
  {
    scope: 'type',
    key: 'capability',
    prop: 'description',
    en: 'Package-declared authorization capability — the DEFINITION side of ADR-0066 D1 (grants live on permission sets; requirements on resources)',
    verdict: ALL_TRANSLATE,
    reason:
      'THE SECOND REAL `package` NEAR-MISS, cleared exactly as the doc row above and asserted separately on CapabilityDeclarationSchema rather than inherited — the two schemas splice the same protection mixin but that is a fact to assert, not to assume. ⭐ The clause "grants live on permission sets" has a STRUCTURAL authored twin one panel away: position.sections.position.description renders "Capability lives on permission sets" as 能力在权限集上 / 能力は権限セットに / La capacidad reside en los permission sets, and this row copies the frame while substituting 授予 / 付与 / las concesiones for "grants". "authorization" takes sys_oauth_application._actions.enable_oauth_application.description (授权 / 認可 / la autorización) — ⚠️ ja answers this word two ways and the row picks deliberately: 認可 (authz, that leaf) over 認証 (authn, sys_device_code.description), because ADR-0066 is about what a principal MAY do. "resources" takes sys_organization._actions.leave_organization.confirmText (资源 / リソース / recursos). ⇒ 软件包声明的授权能力——ADR-0066 D1 的定义侧（授予在权限集上；要求在资源上） / パッケージが宣言する認可ケイパビリティ — ADR-0066 D1 の定義側（付与は権限セットに、要件はリソースに） / Capacidad de autorización declarada por el paquete — el lado de la DEFINICIÓN de ADR-0066 D1 (las concesiones residen en los conjuntos de permisos; los requisitos, en los recursos). ⚠️ es answers "permission sets" two ways — conjuntos de permisos (permission.sections.identity.description) and the English permission sets (position.sections.position.description) — and this row takes the Spanish one, because the leaf it is describing IS the permission domain\'s own definition side. ⭐ `ADR-0066` and `D1` are kept verbatim and asserted; the en\'s uppercase DEFINITION is carried as case in es and as plain text in zh/ja, which have no case to carry it with.',
  },
];

/** The live registry entry for a metadata type — the OUTSIDE anchor of this ledger. */
function registryEntry(type: string): Record<string, any> | undefined {
  return (DEFAULT_METADATA_TYPE_REGISTRY as ReadonlyArray<Record<string, any>>).find((e) => e.type === type);
}

function leafOf(bundle: Record<string, any>, d: Decision): unknown {
  return bundle[d.key]?.[d.prop];
}

/** The provenance-table key for a decided leaf. */
function provenanceKey(d: Decision): string {
  return `metadataForms.${d.key}.${d.prop}`;
}

/** The dotted id a decision is reported under. */
function idOf(d: Decision): string {
  return `${d.key}.${d.prop}`;
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
 * ⛔ This family's kept tokens include `API` and `D1`, and this family's prose
 * contains "field mapping" while `map` is a legal TransformType value —
 * `'field mapping'.includes('map')` is TRUE. A guard that cannot say NO is
 * exactly the phantom check this card exists to refuse. `\p{L}`/`\p{N}` rather
 * than `[A-Za-z0-9]` because the neighbours here are CJK, kana and accented
 * Latin.
 */
function carriesToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/**
 * The BARE predicate — the substitute for one panel's `en` subtree. A metadata
 * type is bare when the catalog gives it no form at all, so its registry entry
 * IS its whole panel. Read off the catalog's SHAPE, never off a name list.
 */
function isBare(type: string): boolean {
  const entry = (enMetadataForms as Record<string, any>)[type];
  return !!entry && entry.fields === undefined && entry.sections === undefined;
}

interface BareLeaf {
  type: string;
  prop: string;
  en: string;
}

const REGISTRY_TYPES: readonly string[] = (
  DEFAULT_METADATA_TYPE_REGISTRY as ReadonlyArray<Record<string, any>>
).map((e) => String(e.type));

const BARE_TYPES: readonly string[] = REGISTRY_TYPES.filter(isBare);
const PANEL_TYPES: readonly string[] = REGISTRY_TYPES.filter((t) => !isBare(t));

/** Every string leaf of every bare type, DERIVED from the registry and the catalog's shape. */
const BARE_LEAVES: readonly BareLeaf[] = BARE_TYPES.flatMap((type) => {
  const entry = (enMetadataForms as Record<string, any>)[type] ?? {};
  return Object.entries(entry)
    .filter(([, v]) => typeof v === 'string')
    .map(([prop, v]) => ({ type, prop, en: v as string }));
});

/** The four bare types whose display pair was already authored — the INWARD dark control. */
const AUTHORED_BARE_TYPES = ['job', 'datasource', 'external_catalog', 'translation'] as const;

const S = (type: string): any => getMetadataTypeSchema(type);

/** Minimal items that parse, so each schema probe below varies ONE key at a time. */
const MINIMAL: Readonly<Record<string, Record<string, unknown>>> = {
  seed: { object: 'account', records: [] },
  mapping: { name: 'demo_map', targetObject: 'account', fieldMapping: [] },
  api: { name: 'demo_api', path: '/demo', method: 'GET', type: 'proxy' },
  doc: { name: 'demo_doc', content: '# hi' },
  book: { name: 'demo_book', groups: [] },
  capability: { name: 'demo_cap' },
};

function flattenLeaves(o: Record<string, any>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') for (const [a, b] of flattenLeaves(v as Record<string, any>, p)) out.set(a, b);
  }
  return out;
}

describe('#19403 round 7 — the ledger itself (controls before verdicts)', () => {
  it('decides every echoing string leaf of the 6 types this round takes, and nothing else', () => {
    // Lit — the ledger is the size it claims: 6 types, 12 leaves, three locales,
    // 36 decisions.
    expect(DECISIONS.length).toBe(12);
    expect(new Set(DECISIONS.map((d) => d.key)).size).toBe(6);
    expect(DECISIONS.flatMap((d) => Object.keys(d.verdict)).length).toBe(36);
    for (const d of DECISIONS) {
      expect(Object.keys(d.verdict).sort(), `${idOf(d)} names every translated locale`).toEqual([
        'es-ES',
        'ja-JP',
        'zh-CN',
      ]);
    }
    // Every decided type is decided on BOTH of its string leaves — a chooser
    // whose type name is translated and whose blurb is not is the same defect
    // half fixed.
    for (const key of new Set(DECISIONS.map((d) => d.key))) {
      expect(
        DECISIONS.filter((d) => d.key === key)
          .map((d) => d.prop)
          .sort()
          .join('+'),
        `${key} is decided on one leaf only`,
      ).toBe('description+label');
    }
    expect(DECISIONS.every((d) => d.scope === 'type')).toBe(true);
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(
        leafOf(enMetadataForms as Record<string, any>, d),
        `en ${idOf(d)} moved — re-judge the decision, do not refresh this row`,
      ).toBe(d.en);
    }
  });

  it('⭐ …and to the REGISTRY entry that manufactures it — the third leg', () => {
    // The `en` catalog is generated FROM the registry, so pinning only the
    // catalog would leave a reworded registry entry to be discovered by an
    // extract run nobody reads. Pin the source itself. This is also what puts
    // the phantom-translation shortcut out of reach from this package: the
    // English lives in `packages/spec`, not here.
    for (const d of DECISIONS) {
      const entry = registryEntry(d.key);
      expect(entry, `${d.key} is not in DEFAULT_METADATA_TYPE_REGISTRY`).toBeTruthy();
      expect(entry?.[d.prop], `registry ${idOf(d)} moved — re-judge the decision`).toBe(d.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `translated !== en` is the whole verdict test below; run it against
    // the source catalog itself and it must flag all 12 rows, or a green verdict
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
    // Every verdict in this round is `translate`, so the rule has nothing to
    // evaluate over DECISIONS. Assert it there AND prove the predicate fires, or
    // the requirement is a phantom check that deleting would leave green.
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no reason').toEqual([]);

    const synthetic: Decision = {
      scope: 'type',
      key: 'capability',
      prop: 'label',
      en: 'Capability',
      verdict: { 'zh-CN': 'echo', 'ja-JP': 'translate', 'es-ES': 'translate' },
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['zh-CN capability.label']);
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

describe('#19403 round 7 — the catalogs hold what the ledger decided', () => {
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

describe('#19403 round 7 — the #19430 discipline, asserted AT THE SCHEMA', () => {
  it('the probe harness is lit — every one of the six minimal items parses', () => {
    // So a refusal below is about the key under test and not about the fixture.
    for (const type of Object.keys(MINIMAL)) {
      const schema = S(type);
      expect(schema, `${type} resolves no schema through the registry's own map`).toBeTruthy();
      expect(schema.safeParse({ ...MINIMAL[type] }).success, `${type} minimal item does not parse`).toBe(true);
    }
  });

  it('⭐ `package` IS a real _provenance value — the near-miss on doc AND capability is REAL', () => {
    // Asserted per type rather than once: the two schemas splice the same
    // protection mixin, and that is a fact to check, not to assume.
    for (const type of ['doc', 'capability']) {
      expect(S(type).safeParse({ ...MINIMAL[type], _provenance: 'package' }).success, type).toBe(true);
      expect(S(type).safeParse({ ...MINIMAL[type], _provenance: '软件包' }).success, type).toBe(false);
      expect(S(type).safeParse({ ...MINIMAL[type], _provenance: 'パッケージ' }).success, type).toBe(false);
    }
  });

  it('…and it is CLEARED — no form asks an author for that key, on these types or any other', () => {
    // (i) the key is optional envelope state the loader sets: the item parses
    // without it.
    for (const type of ['doc', 'capability']) {
      expect(S(type).safeParse({ ...MINIMAL[type] }).success).toBe(true);
    }
    // (ii) and nothing in the metadata-form catalog — the surface these leaves
    // render on — names an underscore-prefixed key at all, so no rendered word
    // can reach one. Derived over the whole catalog rather than these two types.
    const underscored = [...flattenLeaves(enMetadataForms as Record<string, any>).keys()].filter((k) =>
      k.split('.').some((seg) => seg.startsWith('_')),
    );
    expect(underscored, 'a form leaf names an envelope key — re-read the clearing on doc/capability').toEqual([]);
    // (iii) and where this catalog renders a leaf whose STORED value is literally
    // `package`, it renders the display and keeps the value — so rendering the
    // English noun follows the convention rather than breaking it.
    const managedBy = 'sys_metadata.fields.managed_by.options.package';
    expect(flattenLeaves(enObjects as Record<string, any>).get(managedBy)).toBe('package');
    const rendered = TRANSLATED_OBJECTS.map(([, o]) => flattenLeaves(o as Record<string, any>).get(managedBy));
    expect(rendered).toEqual(['包', 'パッケージ', 'Paquete']);
  });

  it('⭐ `rename` is NOT a TransformType — but `map` is, and "field mapping" contains it', () => {
    const withTransform = (t: string) => ({
      ...MINIMAL.mapping,
      fieldMapping: [{ source: 'a', target: 'b', transform: t }],
    });
    expect(S('mapping').safeParse(withTransform('map')).success, '`map` is a legal transform').toBe(true);
    expect(S('mapping').safeParse(withTransform('rename')).success, '`rename` is not one').toBe(false);
    // The dark control for the token guard, on this family's own prose: a
    // substring check flags the leaf for a token that is not in it.
    const mappingEn = DECISIONS.find((d) => d.key === 'mapping' && d.prop === 'description')!.en;
    expect(mappingEn.includes('map'), 'substring containment says YES').toBe(true);
    expect(carriesToken(mappingEn, 'map'), 'the word-boundary predicate says NO').toBe(false);
  });

  it('`publish` LOOKS like a SeedMode and is not one', () => {
    expect(S('seed').safeParse({ ...MINIMAL.seed, mode: 'upsert' }).success).toBe(true);
    expect(S('seed').safeParse({ ...MINIMAL.seed, mode: 'publish' }).success).toBe(false);
  });

  it('`pipeline` LOOKS like an api `type` and is not one', () => {
    expect(S('api').safeParse({ ...MINIMAL.api, type: 'proxy' }).success).toBe(true);
    expect(S('api').safeParse({ ...MINIMAL.api, type: 'pipeline' }).success).toBe(false);
  });

  it('`groups` is a KEY that takes an ARRAY, so no rendered word can land in it', () => {
    expect(S('book').safeParse({ ...MINIMAL.book, groups: [] }).success).toBe(true);
    expect(S('book').safeParse({ ...MINIMAL.book, groups: 'ordered' }).success).toBe(false);
  });

  it('the machine tokens the ledger decided to KEEP are still verbatim in every locale', () => {
    const KEPT: ReadonlyArray<readonly [string, 'label' | 'description', readonly string[]]> = [
      ['api', 'label', ['API']],
      ['api', 'description', ['HTTP', 'URL', 'ADR-0121']],
      ['doc', 'description', ['Markdown', 'ADR-0046']],
      ['book', 'description', ['ADR-0046', '§6']],
      ['capability', 'description', ['ADR-0066', 'D1']],
    ];
    for (const [type, prop, tokens] of KEPT) {
      for (const [locale, forms] of TRANSLATED_LOCALES) {
        const text = forms[type]?.[prop] as string;
        expect(typeof text, `${locale} ${type}.${prop}`).toBe('string');
        for (const token of tokens) {
          expect(carriesToken(text, token), `${locale} ${type}.${prop} dropped the token ${token}`).toBe(true);
        }
      }
    }
  });

  it('⭐ the token predicate can say NO — and a bare `includes` could not', () => {
    // Dark. Without this the assertion above could be a guard that is true of
    // every string. `§6` must not be found as `§7`, and `D1` must not be found
    // inside `ADR-0121`'s digits.
    const zhBook = (zhCNMetadataForms as Record<string, any>).book.description as string;
    expect(carriesToken(zhBook, '§6')).toBe(true);
    expect(carriesToken(zhBook, '§7')).toBe(false);
    const zhApi = (zhCNMetadataForms as Record<string, any>).api.description as string;
    expect(zhApi.includes('D1'), 'substring says nothing here').toBe(false);
    expect(carriesToken(zhApi, 'ADR-0121')).toBe(true);
    expect(carriesToken(zhApi, 'ADR-012')).toBe(false);
    expect(carriesToken(zhApi, 'URL')).toBe(true);
    expect(carriesToken(zhApi, 'UR')).toBe(false);
  });
});

describe('#19403 round 7 — the provenance table agrees these leaves are now authored', () => {
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
      // misspelt key shape returns.
      //
      // ⚠️ AND THE EARLIER ROUNDS' CONTROL CANNOT BE COPIED HERE, for a reason
      // this round created: it samples a key of the SAME SHAPE as the one under
      // test, and after this round there is no type-level row left to sample —
      // `metadataForms.<type>.<prop>` is now EMPTY in all three tables, where
      // the base carried exactly these twelve. So the control is rebuilt on the
      // table's RULE instead of on a look-alike sample, which does not depend on
      // any row surviving.
      //
      // Leg 1 — the rule: every `metadataForms.*` key this table holds is
      // "metadataForms." followed by the flattened path of a real `en` leaf.
      const enPaths = flattenLeaves(enMetadataForms as Record<string, any>);
      const formKeys = Object.keys(table).filter((k) => k.startsWith('metadataForms.'));
      // ⚠️ NO FLOOR ON THIS COUNT, and the reason is this card's own shape: the
      // metadata-form surface of these tables SHRINKS every time a round of
      // #19403 lands, so any measured floor here is a reading that expires. It
      // was `> 10`, and round 8 took zh-CN to 6. The floor is not lowered — it
      // is removed, and leg 3 below carries the discrimination instead, over a
      // population this card does not touch.
      const strays = formKeys.filter((k) => !enPaths.has(k.slice('metadataForms.'.length)));
      expect(strays, 'a provenance key names no leaf of the en catalog — the key rule moved').toEqual([]);
      // Leg 2 — the composer under test obeys that same rule for a type-level
      // row, and the path it composes really is a leaf of the catalog. So if any
      // decided leaf were still a fill, the lookup above would have found it.
      for (const d of DECISIONS) {
        expect(provenanceKey(d)).toBe(`metadataForms.${idOf(d)}`);
        expect(enPaths.has(idOf(d)), `${idOf(d)} is not a leaf of the en catalog`).toBe(true);
      }
      expect(provenanceKey({ ...DECISIONS[0], key: 'k', prop: 'label' })).toBe('metadataForms.k.label');
      // Leg 3 — and the lookup mechanism itself returns something, so `undefined`
      // is not simply what this table says to everything. Sampled off the whole
      // table rather than its metadata-form slice, which is what makes it
      // survive the next round of this card emptying that slice.
      const anyKey = Object.keys(table)[0];
      expect(anyKey, `${locale} provenance table is empty`).toBeTruthy();
      expect(table[anyKey], 'the lookup this file performs finds a key the table holds').toBeTruthy();
    });

    it(`${locale}: ⭐ the type-level provenance surface is now EMPTY — this round emptied it`, () => {
      // The strongest form the verdict above can take for this class: not "none
      // of my twelve is still a fill", but "no metadata type's own display pair
      // is still a fill, anywhere in this table". Lit by the table being large,
      // so a zero cannot come from an empty import.
      expect(Object.keys(table).length).toBeGreaterThan(100);
      const typeLevel = Object.keys(table).filter((k) => /^metadataForms\.[^.]+\.(label|description)$/.test(k));
      expect(typeLevel, 'a metadata type display pair is still an extractor fill').toEqual([]);
    });
  }
});

describe('#19403 round 7 — the population, DERIVED from the registry and a shape', () => {
  it('⭐ the registry and the catalog describe the same 27 metadata types', () => {
    // The ratchet's anchor. The catalog is GENERATED from this registry, so a
    // new metadata type arrives in both at once — which is what makes the bare
    // class below pick up a future unauthored display pair without anybody
    // adding it to a list.
    expect(REGISTRY_TYPES.length).toBe(27);
    expect([...REGISTRY_TYPES].sort()).toEqual(Object.keys(enMetadataForms as Record<string, any>).sort());
  });

  it('the BARE predicate splits that population, and is read off the SHAPE not a name list', () => {
    // Lit.
    expect(BARE_TYPES.length).toBe(10);
    expect(PANEL_TYPES.length).toBe(17);
    expect(BARE_TYPES.length + PANEL_TYPES.length).toBe(REGISTRY_TYPES.length);
    for (const type of ['seed', 'mapping', 'api', 'doc', 'book', 'capability']) {
      expect(BARE_TYPES, `${type} is bare`).toContain(type);
    }
    for (const type of AUTHORED_BARE_TYPES) expect(BARE_TYPES, `${type} is bare`).toContain(type);
    // 16 leaves: ten labels, and a description on the six that carry one.
    expect(BARE_LEAVES.length).toBe(16);
    expect(BARE_LEAVES.filter((l) => l.prop === 'label').length).toBe(10);
    expect(BARE_LEAVES.filter((l) => l.prop === 'description').length).toBe(6);
    expect(BARE_LEAVES.every((l) => ['label', 'description'].includes(l.prop))).toBe(true);
  });

  it('⭐ DARK, OUTWARD — every panel type is excluded, and `dataset` is the one that proves it', () => {
    // Round 6's `hook` and round 5's `action` are panel types, so a walk that
    // read the whole bundle would sweep in leaves this ledger has no business
    // deciding.
    for (const type of ['object', 'hook', 'action', 'report', 'view', 'page', 'dataset']) {
      expect(BARE_TYPES, `${type} carries a form and is not bare`).not.toContain(type);
    }
    // …and the sharpest exclusion, by name: `dataset` carries a registry
    // `description` exactly as the six do, so a walk keyed on "registry entries
    // with a description" would take it. The BARE predicate is what leaves it
    // out — and it is already authored, so a walk that wrongly included it would
    // not even go red. That is why the exclusion is asserted rather than trusted.
    expect(registryEntry('dataset')?.description, 'dataset carries a registry description like the six').toBeTruthy();
    expect(isBare('dataset')).toBe(false);
    const described = REGISTRY_TYPES.filter((t) => typeof registryEntry(t)?.description === 'string');
    expect([...described].sort()).toEqual(['api', 'book', 'capability', 'dataset', 'doc', 'mapping', 'seed']);
    expect(described.filter(isBare).sort()).toEqual(['api', 'book', 'capability', 'doc', 'mapping', 'seed']);
    // And no panel type's own display pair echoes — the exclusion removes only
    // leaves that are already decided elsewhere or already authored.
    const panelEchoes: string[] = [];
    for (const type of PANEL_TYPES) {
      const entry = (enMetadataForms as Record<string, any>)[type] ?? {};
      for (const [prop, en] of Object.entries(entry)) {
        if (typeof en !== 'string') continue;
        if (TRANSLATED_LOCALES.every(([, forms]) => forms[type]?.[prop] === en)) panelEchoes.push(`${type}.${prop}`);
      }
    }
    expect(panelEchoes, 'a panel type-level display leaf echoes — it belongs to that panel\'s round').toEqual([]);
  });

  it('⭐⭐ DARK, INWARD — four members of the population come back NON-ECHOING', () => {
    // THE CONTROL ROUNDS 5 AND 6 SAID THIS FAMILY COULD NOT HAVE. A hand-list of
    // the six echoing types can only ever produce positives; this derivation
    // produces a negative on four of its own members, in the same run, from the
    // same walk. Without it, "all twelve were echoes" would be unfalsifiable.
    for (const type of AUTHORED_BARE_TYPES) {
      const leaves = BARE_LEAVES.filter((l) => l.type === type);
      expect(leaves.length, `${type} contributes no leaf to the population`).toBe(1);
      for (const leaf of leaves) {
        for (const [locale, forms] of TRANSLATED_LOCALES) {
          expect(forms[type]?.[leaf.prop], `${locale} ${type}.${leaf.prop} is an echo, not a control`).not.toBe(
            leaf.en,
          );
        }
      }
    }
    // Stated as a count as well, so the control cannot quietly shrink to zero.
    const authoredOnBase = BARE_LEAVES.filter((l) =>
      TRANSLATED_LOCALES.some(([, forms]) => forms[l.type]?.[l.prop] !== l.en),
    );
    expect(authoredOnBase.length).toBe(BARE_LEAVES.length);
  });

  it('no leaf in the bare class reads its `en` source unless the ledger decided it is an echo', () => {
    const undecided: string[] = [];
    for (const [locale, forms] of TRANSLATED_LOCALES) {
      for (const leaf of BARE_LEAVES) {
        if (forms[leaf.type]?.[leaf.prop] !== leaf.en) continue;
        const decided = DECISIONS.find((d) => d.key === leaf.type && d.prop === leaf.prop);
        if (decided?.verdict[locale] === 'echo') continue;
        undecided.push(`${locale} ${leaf.type}.${leaf.prop} (${JSON.stringify(leaf.en)})`);
      }
    }
    expect(
      undecided,
      'these leaves read their en source and no row in this ledger says that is right — decide them, do not refresh anything',
    ).toEqual([]);
  });

  it('the derived predicate can fire — fed the `en` catalog it flags every leaf in the class', () => {
    // Dark. Same walk, with `en` standing in for a translated catalog: every leaf
    // must come back flagged, or the green above means only that the walk found
    // nothing.
    const flagged = BARE_LEAVES.filter((l) => (enMetadataForms as Record<string, any>)[l.type]?.[l.prop] === l.en);
    expect(flagged.length).toBe(BARE_LEAVES.length);
  });

  it('⭐ this class is now DONE — zero of its 16 leaves echoes in all three locales', () => {
    const echoing = BARE_LEAVES.filter((l) =>
      TRANSLATED_LOCALES.every(([, forms]) => forms[l.type]?.[l.prop] === l.en),
    );
    expect(echoing.map((l) => `${l.type}.${l.prop}`)).toEqual([]);
    // Lit — and it really walked the class, which a zero alone would not show.
    expect(BARE_LEAVES.length).toBe(16);
  });
});

describe('#19403 round 7 — "Capability" in three positions, decided two ways', () => {
  it('⭐ zh-CN and ja-JP AGREE with round 6\'s landed pair, by derivation', () => {
    const forms: Record<string, Record<string, any>> = {
      'zh-CN': zhCNMetadataForms as Record<string, any>,
      'ja-JP': jaJPMetadataForms as Record<string, any>,
      'es-ES': esESMetadataForms as Record<string, any>,
    };
    for (const locale of ['zh-CN', 'ja-JP']) {
      const landed = forms[locale].hook?.fields?.['body.capabilities']?.label;
      expect(typeof landed, `${locale} hook body.capabilities.label is missing`).toBe('string');
      expect(forms[locale].action?.fields?.['body.capabilities']?.label, 'the landed pair still agrees').toBe(landed);
      expect(forms[locale].capability?.label, `${locale} capability.label diverges from the landed word`).toBe(landed);
    }
    // es-ES deliberately differs in NUMBER — one capability, not a list — and the
    // row records that. Asserted so the difference is a decision, not a drift.
    expect(forms['es-ES'].capability?.label).toBe('Capacidad');
    expect(forms['es-ES'].hook?.fields?.['body.capabilities']?.label).toBe('Capacidades');
  });

  it('⛔ the FEATURE-TOGGLE sense is still deliberately untouched', () => {
    // `object.sections.capabilities` wears the same English stem and means
    // something else. Round 6 left it alone on purpose; this round takes the
    // metadata type without sweeping it either. If this ever goes red, somebody
    // harmonised a word across two concepts.
    expect((zhCNMetadataForms as Record<string, any>).object?.sections?.capabilities?.label).toBe('功能开关');
    expect((jaJPMetadataForms as Record<string, any>).object?.sections?.capabilities?.label).toBe('機能');
    expect((enMetadataForms as Record<string, any>).object?.sections?.capabilities?.label).toBe('Capabilities');
    expect((enMetadataForms as Record<string, any>).capability?.label).toBe('Capability');
  });

  it('the evidence the zh/ja rendering was DERIVED from is still in the objects catalog', () => {
    // ⛔ Not borrowed from round 6's decision: re-derived here from the leaves
    // that carry the ADR-0066 sense — a NAMED capability key — so this row
    // stands on its own evidence.
    const en = flattenLeaves(enObjects as Record<string, any>);
    const CARRIERS = ['sys_user.fields.ai_access.help', 'sys_email.fields.attachments_json.help'];
    for (const key of CARRIERS) {
      const source = en.get(key);
      expect(typeof source, `${key} left the objects catalog`).toBe('string');
      expect(carriesToken(source!, 'capability'), `${key} no longer names a capability`).toBe(true);
    }
    const zh = flattenLeaves(zhCNObjects as Record<string, any>);
    const ja = flattenLeaves(jaJPObjects as Record<string, any>);
    for (const key of CARRIERS) {
      expect(zh.get(key)?.includes('能力'), `zh-CN ${key}`).toBe(true);
      expect(ja.get(key)?.includes('ケイパビリティ'), `ja-JP ${key}`).toBe(true);
      expect(zh.get(key)?.includes('功能'), `zh-CN ${key} uses the refused word`).toBe(false);
      expect(ja.get(key)?.includes('機能'), `ja-JP ${key} uses the refused word`).toBe(false);
    }
  });
});
