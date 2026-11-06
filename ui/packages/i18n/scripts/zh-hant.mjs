// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * zh-Hans → zh-Hant: the ONE conversion the Console's Traditional Chinese pack
 * is generated with (ruling F of objectstack#29349, phase 2 of #29428, card
 * #30511).
 *
 * ## Where the rules come from
 *
 * Ported from `objectstack-ai/www.objectos.ai` `src/lib/zhconvert.ts` at
 * 9a8afd21d09a0d6005fec53045981dfd9637dd5f, the marketing site's converter,
 * which derives the site's Traditional UI strings, glossary, pages and blog
 * from their Simplified sources. The rules are copied, not re-derived, so the
 * Console and the site write one product in one Traditional vocabulary: the
 * site measured what two converters cost (an article saying 權限 under a nav
 * item saying 許可權), and a Console that converts differently from the site
 * would be the same defect across two surfaces. A change to the rules belongs
 * in both places.
 *
 * `opencc-js` is pinned to the version the site converts with (1.3.1): the
 * overrides below were derived against that release's phrase dictionaries, and
 * an upgrade that reshuffles them is exactly what {@link CONVERSION_CASES}
 * exists to catch.
 *
 * ## The conversion
 *
 * OpenCC's `s2twp` preset (Simplified → Traditional, Taiwan, with phrase
 * conversion): its phrase layer is what turns 数据 into 資料, 对象 into 物件,
 * 字段 into 欄位, 用户 into 使用者 and 默认 into 預設. A handful of its phrase
 * entries are wrong for software writing, so {@link TWP_PHRASE_OVERRIDES}
 * shadows them at the head of the phrase group (the stage that introduces the
 * defect), and {@link LOCATIVE_LI} repairs the locative 里 where a straddling
 * phrase match pinned it. OpenCC only rewrites Han characters, so keys,
 * placeholders, punctuation and code in the pack source stay byte-identical.
 *
 * ⛔ Not a post-pass rewrite of the output: rewriting 許可權 back to 權限 after
 * the fact would also rewrite a genuine 许可权 that the preset converted
 * correctly. The shadow only stops 权限 from being rewritten.
 */
import * as OpenCC from 'opencc-js';
import { ConverterBuilder } from 'opencc-js/core';

/**
 * `s2twp` phrase rules shadowed at the head of its TWPhrases group. Keyed on
 * the post-s2t form, which is what that group sees. An entry whose two sides
 * are equal disables the stock rule; a different right side substitutes for it.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const TWP_PHRASE_OVERRIDES = Object.freeze([
  // 权限 → 許可權 is a Microsoft-glossary rendering; 權限 is the ordinary term.
  ['權限', '權限'],
  // 实例 → 例項 is not standard Taiwanese usage in any register.
  ['實例', '實例'],
  // Mechanical over-substitutions: a fragment appended or swapped.
  // 全局 → 全域性 appends a 性 that turns the noun into an adjective.
  ['全局', '全域'],
  // 扩展 → 擴充套件 appends 套件 ("package"); the verb is 擴充.
  ['擴展', '擴充'],
  // 适配器 → 介面卡 is a network interface card; the adapter is 配接器.
  ['適配器', '配接器'],
  // 控件 → 控制元件 appends 元件; the UI-control term is 控制項.
  ['控件', '控制項'],
  // 镜像 → 映象 swaps the second character; an image is 映像.
  ['鏡像', '映像'],
  // 脚本 → 指令碼 is the Microsoft-glossary rendering; 腳本 is the ordinary word.
  ['腳本', '腳本'],
  // Developer vocabulary, Taiwan usage (the site's maintainer ruling of 2026-11-04).
  // The runtime as a component is 執行環境; the two longer keys keep the phase sense.
  ['運行時', '執行環境'],
  ['在運行時', '在執行時'],
  ['運行時校驗', '執行階段校驗'],
  // 平台 → 平臺 is the Ministry of Education form; 平台 is what Taiwanese writing uses.
  ['平臺', '平台'],
  // 元数据 → 後設資料 is the library-science term; zh-TW software writes 中繼資料.
  ['元數據', '中繼資料'],
  // The Console's own addition (objectstack#30511), not yet in the site's
  // converter: 操作运行时 ("when the action runs") is the verb, not the runtime
  // noun the 運行時 rule above renders as 執行環境.
  ['操作運行時', '操作執行時'],
].map((pair) => Object.freeze(pair)));

/**
 * Phrases whose Simplified form OpenCC's segmentation splits across a word
 * boundary, keyed on the SIMPLIFIED text: `s2twp` first cuts the input into
 * STPhrases matches, longest first, and converts each piece on its own, so a
 * two-character entry that straddles a boundary takes the wrong reading and no
 * later group can see across the cut. Each entry is added to the segmentation
 * dictionary (so the whole phrase is one piece) and to the head of group 0 (so
 * that piece converts as written). The Console's own additions
 * (objectstack#30511), found reading the generated pack; not yet in the site's
 * converter. None is a genuine word in its wrong reading.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const STRADDLE_OVERRIDES = Object.freeze([
  // 并发布 ("and publish") cut as 并发 (concurrency, 併發) + 布.
  ['并发布', '並發布'],
  // 头发送 ("header, sent") cut as 头发 (hair, 頭髮) + 送.
  ['头发送', '頭發送'],
  // 是只读 / 只影响 cut as 是只 / 只影, reading 只 as the measure word 隻.
  ['是只读', '是只讀'],
  ['只影响', '只影響'],
].map((pair) => Object.freeze(pair)));

/**
 * The locative 里 → 裡, only behind a listed word: a two-character STPhrases
 * entry that pins 里 (a place name, a measure word) can match across the word
 * boundary and take the locative with it. A whitelist by construction, because
 * a wrong 裡 is worse than a wrong 里.
 *
 * @type {ReadonlyArray<readonly [RegExp, string]>}
 */
export const LOCATIVE_LI = Object.freeze([
  [/(指令碼|腳本|架構|系統|週報|檔案|定義|函數|函式)里(?!程)/g, '$1裡'],
  [/(知道|報道|頻道|通道)里(?!程)/g, '$1裡'],
].map((pair) => Object.freeze(pair)));

/** 里 that is genuinely 里: only used to keep the generator's report quiet. */
export const GENUINE_LI =
  /公里|英里|海里|華里|里程|里長|里民|里弄|鄰里|故里|鄉里|萬里|千里|百里|里根|里加|里拉|阿里|巴里|德里|克里|居里/g;

/**
 * `s2twp` with {@link TWP_PHRASE_OVERRIDES} at the head of its phrase group and
 * {@link STRADDLE_OVERRIDES} in its segmentation and at the head of group 0.
 */
function buildVocabularyConverter() {
  const stock = OpenCC.Locale.configs?.s2twp;
  if (!stock || stock.conversionChain?.length !== 3) {
    throw new Error(
      'opencc-js no longer exposes an s2twp config with three conversion groups, so the ' +
        'phrase overrides in ui/packages/i18n/scripts/zh-hant.mjs have nowhere to sit. ' +
        'Re-derive them against the new shape before taking the upgrade.',
    );
  }
  const preset = {
    from: OpenCC.Locale.from,
    to: OpenCC.Locale.to,
    configs: {
      ...OpenCC.Locale.configs,
      s2twp: {
        // The straddle repairs are pieces of their own, ahead of every other
        // phrase: a longer key wins the longest-match cut.
        segmentation: [
          stock.segmentation,
          STRADDLE_OVERRIDES.map(([simplified, traditional]) => `${simplified} ${traditional}`).join('|'),
        ].join('|'),
        // Group 0 is [STPhrases, STCharacters] and group 1 is [TWPhrases]; each
        // override list goes in front of its group, so it wins.
        conversionChain: stock.conversionChain.map((group, i) =>
          i === 0 ? [STRADDLE_OVERRIDES, ...group] : i === 1 ? [TWP_PHRASE_OVERRIDES, ...group] : group,
        ),
      },
    },
  };
  return ConverterBuilder(preset)({ from: 'cn', to: 'twp' });
}

/** @type {((text: string) => string) | undefined} */
let convertVocabulary;

/**
 * Simplified (mainland) → Traditional (Taiwan, phrase conversion), with the
 * shadowed phrase entries and the straddled locative repaired.
 *
 * @param {string} text
 * @returns {string}
 */
export function s2t(text) {
  convertVocabulary ??= buildVocabularyConverter();
  let out = convertVocabulary(text);
  for (const [pattern, replacement] of LOCATIVE_LI) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Every 里 in converted text that {@link LOCATIVE_LI} did not claim, with a
 * little context: each is either a genuine 里 or a straddled locative.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function unresolvedLocatives(text) {
  const found = [];
  for (const match of text.replace(GENUINE_LI, '').matchAll(/.{0,8}里.{0,8}/g)) {
    found.push(match[0].replace(/\s+/g, ' ').trim());
  }
  return found;
}

/**
 * The conversion, pinned: both halves of every override (the wrong string is
 * gone and the ordinary term took its place), the genuine words the overrides
 * must never disturb, the rest of the preset still applying, and the Console's
 * own vocabulary. {@link generateZhHantPack} refuses to write when one fails.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const CONVERSION_CASES = Object.freeze([
  ['权限', '權限'],
  ['字段级权限', '欄位級權限'],
  ['实例', '實例'],
  ['许可权', '許可權'],
  ['例项', '例項'],
  ['全局', '全域'],
  ['扩展', '擴充'],
  ['适配器', '配接器'],
  ['介面卡', '介面卡'],
  ['控件', '控制項'],
  ['控制项', '控制項'],
  ['镜像', '映像'],
  ['脚本', '腳本'],
  ['平台', '平台'],
  ['元数据', '中繼資料'],
  ['数据 程序 对象 接口 服务器', '資料 程式 物件 介面 伺服器'],
  ['软件 信息 缓存 用户 默认 缺省', '軟體 資訊 快取 使用者 預設 預設'],
  ['流程隐藏在脚本里', '流程隱藏在腳本裡'],
  ['五公里', '五公里'],
  ['系统里程碑', '系統里程碑'],
  // The Console's own words, as its packs write them.
  ['保存', '儲存'],
  ['搜索', '搜尋'],
  ['设置', '設定'],
  ['登录', '登入'],
  ['导入', '匯入'],
  ['导出', '匯出'],
  ['菜单', '選單'],
  ['您正在以 {{user}} 的身份操作', '您正在以 {{user}} 的身份操作'],
  // The straddled phrase matches the Console's additions repair, and the
  // genuine words on either side of each that must keep converting.
  ['审阅并发布', '審閱並發布'],
  ['并发请求', '併發請求'],
  // 頭發送, then TWPhrases' 發送 → 傳送 (Taiwan's "send").
  ['请求头发送', '請求頭傳送'],
  ['头发', '頭髮'],
  ['这张表是只读的', '這張表是只讀的'],
  ['只影响当前视图', '只影響當前檢視'],
  ['一只猫', '一隻貓'],
  ['当源记录上的操作运行时', '當源記錄上的操作執行時'],
  ['本运行时未配置', '本執行環境未配置'],
].map((pair) => Object.freeze(pair)));

/**
 * The cases {@link CONVERSION_CASES} pins that the converter does not answer as
 * pinned. Empty means the conversion is the one the rules describe.
 *
 * @returns {Array<{ input: string, expected: string, actual: string }>}
 */
export function conversionFailures() {
  const failures = [];
  for (const [input, expected] of CONVERSION_CASES) {
    const actual = s2t(input);
    if (actual !== expected) failures.push({ input, expected, actual });
  }
  return failures;
}

/**
 * The header a generated catalogue opens with, in place of its source's own doc
 * comment (which names the Simplified catalogue). The marker lines are pure
 * ASCII, so a reader finds them with a plain search.
 *
 * @param {string[]} description the doc comment's lines, without the comment markers
 * @returns {string}
 */
function generatedHeader(description) {
  return [
    '// @generated by ui/packages/i18n/scripts/gen-zh-hant.mjs from ./zh-Hans.ts.',
    '// Do not edit this file: edit zh-Hans.ts (or a rule in scripts/zh-hant.mjs),',
    '// then run `pnpm --filter @object-ui/i18n gen:zh-hant` and commit both.',
    '/**',
    ...description.map((line) => ` * ${line}`),
    ' */',
    '',
  ].join('\n');
}

/** The header the generated pack opens with. */
export const GENERATED_HEADER = generatedHeader([
  '繁體中文 (zh-Hant) - Traditional Chinese language pack for Object UI,',
  'converted from the zh-Hans pack (OpenCC s2twp with the overrides in scripts/zh-hant.mjs).',
]);

/** The header a generated pack-shaped namespace catalogue opens with. */
export const NAMESPACE_GENERATED_HEADER = generatedHeader([
  '繁體中文 (zh-Hant) - a lazy namespace\'s catalogue, converted from its zh-Hans',
  'catalogue (OpenCC s2twp with the overrides in scripts/zh-hant.mjs). `./index.ts`',
  'says what the namespace is, why it is lazy, and which gates read this file.',
]);

/**
 * Where the one occurrence of `anchor` in `text` starts, or throw: a generator
 * that silently matched nothing would ship a pack still named for its source.
 *
 * @param {string} text
 * @param {string} anchor
 * @returns {number}
 */
function indexOnce(text, anchor) {
  const at = text.indexOf(anchor);
  if (at < 0 || text.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(
      `gen-zh-hant: expected exactly one ${JSON.stringify(anchor)} in zh-Hans.ts. ` +
        'The pack source changed shape; update the anchors in scripts/zh-hant.mjs.',
    );
  }
  return at;
}

/**
 * The `console.ai.*` leaves the generated pack does NOT carry: text the console
 * SENDS to the agent rather than shows (objectui#3896). They are read from the
 * `en` and `zh-Hans` packs only, by the conversation's language, and the cloud
 * confirm gate recognises exactly those two spellings, so a Traditional copy
 * would be unreachable text that reads as a third gate language.
 * `src/__tests__/outbound-agent-messages.test.ts` owns that invariant over
 * every pack; this list is how the generated pack keeps it. Each is a
 * one-line property in zh-Hans.ts, replaced line for line by a comment, so the
 * two packs' line numbers stay aligned.
 */
export const GATE_ONLY_KEYS = Object.freeze([
  'planApproveMessage',
  'planApproveDefaultsMessage',
  'planAnswerMessage',
  'planExtendExistingMessage',
  'planBuildNewAppMessage',
  'changesConfirmMessage',
]);

/**
 * The zh-Hans pack body with each {@link GATE_ONLY_KEYS} property line replaced
 * by a comment. Throws unless each key is exactly one single-line property.
 *
 * @param {string} body
 * @returns {string}
 */
function withoutGateOnlyKeys(body) {
  let out = body;
  for (const name of GATE_ONLY_KEYS) {
    const line = new RegExp(`^([ \\t]+)${name}: '[^'\\n]*',$`, 'gm');
    const hits = out.match(line) ?? [];
    if (hits.length !== 1 || out.split(`${name}:`).length !== 2) {
      throw new Error(
        `gen-zh-hant: expected ${name} exactly once in zh-Hans.ts, as a one-line property. ` +
          'The pack source changed shape; update GATE_ONLY_KEYS in scripts/zh-hant.mjs.',
      );
    }
    out = out.replace(line, `$1// ${name}: gate-only, read from zh-Hans (GATE_ONLY_KEYS, scripts/zh-hant.mjs).`);
  }
  return out;
}

/**
 * The catalogue's own declaration in the source, at the start of a line (a doc
 * comment may name it in prose), and the name the generated catalogue takes.
 */
const SOURCE_DECLARATION = '\nconst zh = {';
const SOURCE_EXPORT = 'export default zh;';

/**
 * `zhHansSource` converted: the source's doc comment becomes `header`, the
 * declaration `zh` becomes `zhHant`, and the body passes through `prepare`
 * before the conversion. Refuses (throws) when the conversion no longer answers
 * its pinned cases.
 *
 * @param {string} zhHansSource
 * @param {string} header
 * @param {(body: string) => string} prepare
 * @returns {string}
 */
function convertCatalogue(zhHansSource, header, prepare) {
  const failures = conversionFailures();
  if (failures.length > 0) {
    const lines = failures.map(
      ({ input, expected, actual }) =>
        `  ${JSON.stringify(input)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    throw new Error(`gen-zh-hant: the conversion no longer answers its pinned cases:\n${lines.join('\n')}`);
  }
  const start = indexOnce(zhHansSource, SOURCE_DECLARATION);
  const exportAt = indexOnce(zhHansSource, SOURCE_EXPORT);
  const body = s2t(prepare(zhHansSource.slice(start + SOURCE_DECLARATION.length, exportAt)));
  const tail = zhHansSource.slice(exportAt + SOURCE_EXPORT.length);
  return `${header}const zhHant = {${body}export default zhHant;${tail}`;
}

/**
 * The zh-Hant pack source, generated from the zh-Hans pack source.
 *
 * Text in, text out, so the generated module keeps the source's shape exactly:
 * the same keys in the same order, the same comments (converted), the same
 * `as const`. Only the pack's doc comment and its own name change (`zh` →
 * `zhHant`), the {@link GATE_ONLY_KEYS} lines become comments, and the header
 * says the file is generated.
 *
 * @param {string} zhHansSource the text of `src/locales/zh-Hans.ts`
 * @returns {string} the text of `src/locales/zh-Hant.ts`
 */
export function generateZhHantPack(zhHansSource) {
  return convertCatalogue(zhHansSource, GENERATED_HEADER, withoutGateOnlyKeys);
}

/**
 * A pack-shaped namespace's zh-Hant catalogue (`src/namespaces/<ns>/zh-Hant.ts`),
 * generated from its zh-Hans catalogue the way {@link generateZhHantPack}
 * generates the pack: same keys, same order, converted text. A namespace holds
 * none of the {@link GATE_ONLY_KEYS}, so nothing is dropped.
 *
 * @param {string} zhHansSource the text of `src/namespaces/<ns>/zh-Hans.ts`
 * @returns {string} the text of `src/namespaces/<ns>/zh-Hant.ts`
 */
export function generateZhHantNamespaceCatalogue(zhHansSource) {
  return convertCatalogue(zhHansSource, NAMESPACE_GENERATED_HEADER, (body) => body);
}

/**
 * Every catalogue the generator writes, package-relative: the pack, and the
 * zh-Hant catalogue of each pack-shaped lazy namespace (the ones whose keys are
 * pack keys moved out of the packs). `scripts/gen-zh-hant.mjs` writes each one
 * and `src/__tests__/zh-hant-generated.test.ts` holds each one current.
 *
 * @type {ReadonlyArray<Readonly<{ source: string; target: string; generate: (source: string) => string }>>}
 */
export const ZH_HANT_TARGETS = Object.freeze([
  Object.freeze({ source: 'src/locales/zh-Hans.ts', target: 'src/locales/zh-Hant.ts', generate: generateZhHantPack }),
  Object.freeze({
    source: 'src/namespaces/marketplace/zh-Hans.ts',
    target: 'src/namespaces/marketplace/zh-Hant.ts',
    generate: generateZhHantNamespaceCatalogue,
  }),
]);
