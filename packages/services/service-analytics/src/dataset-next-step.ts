// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  DatasetNextStep,
  DatasetNextStepDecision,
  DatasetProvenance,
  DatasetTermCandidate,
  DatasetToolCatalogEntry,
} from '@objectstack/spec/ai';
import { platformLocaleTagOf, type PlatformLocaleTag } from '@objectstack/spec/system';

/**
 * [ADR-0149 M1, the amendment note under it; ruling #34894 = A] The two
 * finished sentences the dataset tools hand a caller: `list_datasets`'
 * `nextStep` (which case of the D3 selection rule the caller's words are in,
 * and that case in words) and `query_dataset`'s `sourceLine` (the answer's
 * source as one line to cite). The spec declares the shapes
 * (`DatasetNextStepSchema`, `QueryDatasetOutputSchema.sourceLine`) and fixes no
 * wording; the wording is this file's.
 *
 * A model handed a finished string copies it, and one that assembles the same
 * sentence from parts often does not: that is why the platform writes the
 * sentence instead of leaving `matches`, `candidates` and `provenance` for each
 * client to phrase.
 *
 * ## Only from the admitted answer
 *
 * Both sentences are composed from the answer the caller is served and from
 * nothing else: `nextStep` from that answer's catalogue entries (their
 * `matches`, and the labels of the members they list) and its `candidates`,
 * `sourceLine` from the answer's `provenance`. A withheld member, an
 * `internal`-field member and a dataset the caller may not query are not in
 * that answer, so no sentence can name them (ADR-0149 D2, ADR-0100). The
 * caller's own terms are quoted back as sent.
 *
 * ## The decision for one term
 *
 * A term's case counts MEASURES, as D3 selects a measure: the distinct
 * measures, across the listed datasets, whose `matches` entry carries the term.
 *
 * - exactly one ⇒ `one_measure`; more than one ⇒ `several_measures`;
 * - none, and `candidates` holds entries for the term ⇒ `candidates_only`
 *   (a term with any hit, a dimension hit included, has no candidate);
 * - otherwise ⇒ `no_measure`, which is also the case of a term that equals
 *   only a dimension (a grouping is not a number, D3 rule 5).
 *
 * A term sent twice is one term, and a member it equals is counted once.
 *
 * ## Which candidates ask
 *
 * The decision counts candidates of either kind, as the spec declares
 * `candidates_only` ("it matched no member and has entries in `candidates`").
 * The SENTENCE asks back only for a term with a measure among its candidates:
 * that is the word being measured, and a possible reading of it is a question
 * worth asking. A term whose candidates are all dimensions (「按行业」 near
 * 行业, "this quarter" near `quarter`) is at most a possible grouping: the
 * sentence offers it as one, never asks about it, and never lets it stop a
 * matched measure. What counts as a match does not change (ADR-0149 D3,
 * ruling #34691 F1 = B): such a candidate is offered, never selected.
 *
 * ## Precedence among the terms' cases
 *
 * One answer carries one `nextStep`, reporting one case, and `terms` names
 * every term sent (each once, in the order sent) that is in it. When the terms
 * are in different cases, the reported case is the first of:
 *
 *  1. `several_measures` — a word for a measure is ambiguous. Nothing can be
 *     computed for it until the user picks, and an answer computed for the
 *     other words alone would answer a question the user did not ask.
 *  2. `one_measure` — every remaining measure word is decided. An exact
 *     equality outranks a possible reading, and a dimension-matched term never
 *     outranks a measure-matched one: `["营收", "销售阶段"]` is `one_measure`
 *     with `terms: ["营收"]`, the grouping left in `matches`.
 *  3. `candidates_only` — no word equals a measure, and a possible reading is
 *     a question worth asking before falling back.
 *  4. `no_measure` — no measure and no reading for any word.
 *
 * The terms of an unreported case keep their entries in `matches` and
 * `candidates`; `decision` and `terms` name only the case that comes first.
 * When that case is `one_measure` or `candidates_only`, `note` still names
 * every word it leaves out (seat ruling B on the L1-c N1 finding, extended to
 * `candidates_only` by the seat's L2 S3): under `one_measure`, a word with a
 * measure among its candidates together with those candidates, each by its
 * label and its dataset's label, and the instruction to ask before using it,
 * and a word whose candidates are all dimensions as a possible grouping, asked
 * about by nobody; under either, an unknown word with its labelled fallback to
 * the object query tools and a word that equals only a dimension as that
 * grouping. `["营收", "churn"]` computes 营收's measure and asks about churn's
 * measure candidates in one sentence; `["按行业", "销售额"]` computes 销售额's
 * measure and offers 行业 as a possible grouping, with no question;
 * `["库存周转", "金额"]` asks about 金额's candidates and names 库存周转 with
 * its fallback. A reported `candidates_only` word whose candidates are all
 * dimensions is offered the same way, and with no measure word beside it the
 * note asks which number is meant, as a grouping word does (D3 rule 5). (`several_measures` asks before anything is computed, so its
 * note needs no such tail.) Two words that equal the same measure are one
 * metric, and the note says so.
 *
 * ## An incomplete catalogue
 *
 * A `partial: true` answer still carries `nextStep`, computed from what it
 * lists (every invariant of the shape holds over that answer), and its `note`
 * ends by saying that the catalogue was incomplete, that a measure missing from
 * it may exist, and that the answer's `warning` is to be repeated. `no_measure`
 * on a degraded read is the case most likely to be an artefact of the read, and
 * the sentence says so where a bare omission would leave the reader to the
 * tool description's rule alone.
 *
 * ## Language
 *
 * The caller's locale, read the way every platform-composed sentence reads it
 * (`ApiErrorSchema.userMessage`, `@objectstack/spec/api` `contract.zod.ts`):
 * the request's locale, else the workspace default, else `en`. Both values are
 * the ones the door already put on the caller's `ExecutionContext` (`locale`,
 * `workspaceLocale`), the context the executor resolves every label with, so
 * the HTTP door and the stdio door get the same sentence for the same caller.
 * A code is read through the platform locale table (`platformLocaleTagOf`),
 * whole and then one subtag shorter at a time; a language with no sentences
 * here takes the next rung.
 */

/** The languages this file writes, keyed by platform locale tag; `en` is the floor. */
type NextStepLocale = Extract<PlatformLocaleTag, 'en' | 'zh-Hans' | 'zh-Hant' | 'ja'>;

/** A member as a sentence names it: its label and its dataset's label, both as the answer lists them. */
interface NamedMember {
  readonly label: string;
  readonly datasetLabel: string;
  readonly datasetName: string;
  readonly name: string;
}

interface DatasetToolCopy {
  /** Joins the sentences of one note. */
  readonly sentenceGap: string;
  readonly member: (m: NamedMember) => string;
  readonly list: (items: readonly string[]) => string;
  readonly oneHit: (term: string, m: NamedMember) => string;
  readonly oneTail: (count: number) => string;
  readonly severalHit: (term: string, members: string) => string;
  readonly severalTail: string;
  readonly candidateHit: (term: string, members: string) => string;
  readonly candidateTail: string;
  /** A word with no match whose candidates are all dimensions: offered as a possible grouping. */
  readonly groupingCandidateHit: (term: string, members: string) => string;
  /** After the possible groupings: not a question, and no stop for a matched measure. */
  readonly groupingCandidateTail: string;
  readonly groupingHit: (term: string, members: string) => string;
  readonly unknownHit: (term: string) => string;
  readonly fallbackTail: string;
  readonly groupingTail: string;
  readonly partialTail: string;
  /** After a `one_measure` note: the left-out words with a measure among their candidates are asked about before use. */
  readonly leftCandidateTail: string;
  /** After a `one_measure` or `candidates_only` note: the left-out words with no measure and no reading fall back, labelled. */
  readonly leftFallbackTail: string;
  readonly source: (measures: readonly string[], dataset: string, dimensions: readonly string[]) => string;
}

const COPY: Readonly<Record<NextStepLocale, DatasetToolCopy>> = {
  en: {
    sentenceGap: ' ',
    member: (m) => `${m.label} (dataset: ${m.datasetLabel})`,
    list: (items) => items.join('; '),
    oneHit: (t, m) => `"${t}" equals one measure: ${m.label} (dataset: ${m.datasetLabel}), queried as datasetName "${m.datasetName}", measure "${m.name}".`,
    oneTail: (n) => (n === 1
      ? 'Answer with query_dataset using that measure, and cite the answer\'s sourceLine as its source.'
      : 'Each is its own metric: compute every one with query_dataset, and cite each answer\'s sourceLine as its source.'),
    severalHit: (t, ms) => `"${t}" equals several measures: ${ms}.`,
    severalTail: 'Ask the user which one they mean, listing each one\'s label, dataset label and description; do not pick one, and compute nothing until they answer.',
    candidateHit: (t, ms) => `"${t}" matches no member exactly; possible readings: ${ms}.`,
    candidateTail: 'Ask the user which one they mean, listing each one\'s label, dataset label and description (with a single reading, ask whether it is the one meant); do not pick one, never treat a reading as a match, and compute nothing until they answer.',
    groupingCandidateHit: (t, ms) => `"${t}" matches no member exactly; it may name a grouping: ${ms}.`,
    groupingCandidateTail: 'A possible grouping is not a question: do not ask the user about it, and it does not stop a matched measure; group the answer only as the question asks.',
    groupingHit: (t, ms) => `"${t}" equals a grouping, not a number: ${ms}.`,
    unknownHit: (t) => `"${t}" equals no measure and has no possible reading.`,
    fallbackTail: 'Answer with the object query tools (query_records, aggregate_records) and say in the answer that no governed metric was used.',
    groupingTail: 'A grouping alone is no answer: ask the user which number they mean.',
    partialTail: 'The catalogue was incomplete (see warning): a measure missing from this answer may still exist, so repeat the warning in the answer.',
    leftCandidateTail: 'For each word above with possible readings, ask the user which one is meant before using it; do not pick one.',
    leftFallbackTail: 'For those words, use the object query tools (query_records, aggregate_records) and say in the answer that no governed metric was used for them.',
    source: (ms, ds, dims) => `${ms.length === 1 ? 'Metric' : 'Metrics'}: ${ms.join(', ')} (dataset: ${ds})${dims.length > 0 ? `; grouped by: ${dims.join(', ')}` : ''}`,
  },
  'zh-Hans': {
    sentenceGap: '',
    member: (m) => `${m.label}（数据集：${m.datasetLabel}）`,
    list: (items) => items.join('、'),
    oneHit: (t, m) => `「${t}」只等于一个指标：${m.label}（数据集：${m.datasetLabel}），查询时 datasetName 为 "${m.datasetName}"、measure 为 "${m.name}"。`,
    oneTail: (n) => (n === 1
      ? '用 query_dataset 按这个指标回答，并引用返回的 sourceLine 作为来源。'
      : '每个词是一个独立的指标：逐个用 query_dataset 计算，并引用每次返回的 sourceLine 作为来源。'),
    severalHit: (t, ms) => `「${t}」等于多个指标：${ms}。`,
    severalTail: '先问用户指的是哪一个，列出每一个的名称、所属数据集名称和说明；不要替用户选，用户回答前不要计算。',
    candidateHit: (t, ms) => `「${t}」没有精确匹配任何成员，可能指的是：${ms}。`,
    candidateTail: '先问用户指的是哪一个，列出每一个的名称、所属数据集名称和说明（只有一个时，问是不是它）；不要替用户选，也不要把它当作匹配，用户回答前不要计算。',
    groupingCandidateHit: (t, ms) => `「${t}」没有精确匹配任何成员，可能指分组维度：${ms}。`,
    groupingCandidateTail: '可能的分组维度不需要追问：不要就它问用户，它也不妨碍计算已匹配的指标；只按问题本身的要求分组。',
    groupingHit: (t, ms) => `「${t}」是分组维度，不是数字：${ms}。`,
    unknownHit: (t) => `「${t}」没有匹配任何指标，也没有可能的候选。`,
    fallbackTail: '改用对象查询工具（query_records、aggregate_records）回答，并在回答中注明未使用治理指标（非指标口径）。',
    groupingTail: '只有分组维度还不能回答：问用户想看哪个数字。',
    partialTail: '数据集目录不完整（见 warning）：这里没有列出的指标仍可能存在，请在回答中转述该警告。',
    leftCandidateTail: '上面有候选的词，先问用户指的是哪一个再使用；不要替用户选。',
    leftFallbackTail: '这些词改用对象查询工具（query_records、aggregate_records），并在回答中注明它们未使用治理指标（非指标口径）。',
    source: (ms, ds, dims) => `指标：${ms.join('、')}（数据集：${ds}）${dims.length > 0 ? `；维度：${dims.join('、')}` : ''}`,
  },
  'zh-Hant': {
    sentenceGap: '',
    member: (m) => `${m.label}（資料集：${m.datasetLabel}）`,
    list: (items) => items.join('、'),
    oneHit: (t, m) => `「${t}」只等於一個指標：${m.label}（資料集：${m.datasetLabel}），查詢時 datasetName 為 "${m.datasetName}"、measure 為 "${m.name}"。`,
    oneTail: (n) => (n === 1
      ? '用 query_dataset 按這個指標回答，並引用回傳的 sourceLine 作為來源。'
      : '每個詞是一個獨立的指標：逐一用 query_dataset 計算，並引用每次回傳的 sourceLine 作為來源。'),
    severalHit: (t, ms) => `「${t}」等於多個指標：${ms}。`,
    severalTail: '先問使用者指的是哪一個，列出每一個的名稱、所屬資料集名稱和說明；不要替使用者選，使用者回答前不要計算。',
    candidateHit: (t, ms) => `「${t}」沒有精確符合任何成員，可能指的是：${ms}。`,
    candidateTail: '先問使用者指的是哪一個，列出每一個的名稱、所屬資料集名稱和說明（只有一個時，問是不是它）；不要替使用者選，也不要把它當作符合，使用者回答前不要計算。',
    groupingCandidateHit: (t, ms) => `「${t}」沒有精確符合任何成員，可能指分組維度：${ms}。`,
    groupingCandidateTail: '可能的分組維度不需要追問：不要就它問使用者，它也不妨礙計算已符合的指標；只按問題本身的要求分組。',
    groupingHit: (t, ms) => `「${t}」是分組維度，不是數字：${ms}。`,
    unknownHit: (t) => `「${t}」沒有符合任何指標，也沒有可能的候選。`,
    fallbackTail: '改用物件查詢工具（query_records、aggregate_records）回答，並在回答中註明未使用治理指標（非指標口徑）。',
    groupingTail: '只有分組維度還不能回答：問使用者想看哪個數字。',
    partialTail: '資料集目錄不完整（見 warning）：這裡沒有列出的指標仍可能存在，請在回答中轉述該警告。',
    leftCandidateTail: '上面有候選的詞，先問使用者指的是哪一個再使用；不要替使用者選。',
    leftFallbackTail: '這些詞改用物件查詢工具（query_records、aggregate_records），並在回答中註明它們未使用治理指標（非指標口徑）。',
    source: (ms, ds, dims) => `指標：${ms.join('、')}（資料集：${ds}）${dims.length > 0 ? `；維度：${dims.join('、')}` : ''}`,
  },
  ja: {
    sentenceGap: '',
    member: (m) => `${m.label}（データセット：${m.datasetLabel}）`,
    list: (items) => items.join('、'),
    oneHit: (t, m) => `「${t}」は一つの指標だけに一致します：${m.label}（データセット：${m.datasetLabel}）。クエリでは datasetName "${m.datasetName}"、measure "${m.name}" です。`,
    oneTail: (n) => (n === 1
      ? 'query_dataset でその指標を使って回答し、回答の sourceLine を出典として引用してください。'
      : 'それぞれが別の指標です：一つずつ query_dataset で計算し、各回答の sourceLine を出典として引用してください。'),
    severalHit: (t, ms) => `「${t}」は複数の指標に一致します：${ms}。`,
    severalTail: 'どれを指しているかユーザーに確認し、それぞれの名前、データセット名、説明を示してください。代わりに選ばず、回答があるまで計算しないでください。',
    candidateHit: (t, ms) => `「${t}」はどのメンバーにも完全には一致しません。候補：${ms}。`,
    candidateTail: 'どれを指しているかユーザーに確認し、それぞれの名前、データセット名、説明を示してください（候補が一つなら、それで合っているか確認してください）。代わりに選ばず、候補を一致として扱わず、回答があるまで計算しないでください。',
    groupingCandidateHit: (t, ms) => `「${t}」はどのメンバーにも完全には一致しません。グループ分けの候補：${ms}。`,
    groupingCandidateTail: 'グループ分けの候補は確認の対象ではありません。ユーザーに確認せず、一致した指標の計算も止めないでください。グループ分けは質問が求めるとおりにしてください。',
    groupingHit: (t, ms) => `「${t}」は数値ではなくグループ分けです：${ms}。`,
    unknownHit: (t) => `「${t}」はどの指標にも一致せず、候補もありません。`,
    fallbackTail: 'オブジェクトのクエリツール（query_records、aggregate_records）で回答し、管理された指標を使っていないことを回答に明記してください。',
    groupingTail: 'グループ分けだけでは回答になりません：どの数値を知りたいかユーザーに確認してください。',
    partialTail: 'データセットのカタログは不完全です（warning を参照）：ここにない指標が存在する可能性があるため、回答でその警告を伝えてください。',
    leftCandidateTail: '候補のある上記の語は、使う前にどれを指しているかユーザーに確認してください。代わりに選ばないでください。',
    leftFallbackTail: 'これらの語にはオブジェクトのクエリツール（query_records、aggregate_records）を使い、管理された指標を使っていないことを回答に明記してください。',
    source: (ms, ds, dims) => `指標：${ms.join('、')}（データセット：${ds}）${dims.length > 0 ? `；ディメンション：${dims.join('、')}` : ''}`,
  },
};

/**
 * The platform locale a code names, or `undefined`: the whole code through
 * `platformLocaleTagOf`, then each shorter prefix one subtag at a time (RFC
 * 4647 lookup: `zh-CN` → `zh-Hans`, `en-GB` → `en`, `zh-Hant-TW` → `zh-Hant`).
 * The first prefix the table names decides, so a Traditional Chinese code is
 * never handed the Simplified sentence.
 */
function platformLocaleNamedBy(code: string | undefined): PlatformLocaleTag | undefined {
  if (typeof code !== 'string' || code.length === 0) return undefined;
  const subtags = code.split('-');
  for (let n = subtags.length; n > 0; n -= 1) {
    const tag = platformLocaleTagOf(subtags.slice(0, n).join('-'));
    if (tag !== undefined) return tag;
  }
  return undefined;
}

/**
 * The language a sentence is written in for an ordered list of candidate codes
 * (the request's locale, then the workspace default): the first that names a
 * language this file writes, else `en`.
 */
export function datasetToolSentenceLocale(locales: readonly (string | undefined)[]): NextStepLocale {
  for (const code of locales) {
    const tag = platformLocaleNamedBy(code);
    if (tag !== undefined && Object.prototype.hasOwnProperty.call(COPY, tag)) return tag as NextStepLocale;
  }
  return 'en';
}

/**
 * The decisions in reporting order: the first a term is in is the case
 * `nextStep` reports (the precedence above). `list_datasets`' description names
 * this order from this constant, and the MCP `initialize` rule is pinned to it,
 * so the order a client is told is the order the executor applies.
 */
export const DATASET_NEXT_STEP_PRECEDENCE: readonly DatasetNextStepDecision[] = Object.freeze([
  'several_measures',
  'one_measure',
  'candidates_only',
  'no_measure',
]);

interface TermReading {
  readonly term: string;
  readonly decision: DatasetNextStepDecision;
  readonly measures: readonly NamedMember[];
  readonly dimensions: readonly NamedMember[];
  readonly candidates: readonly NamedMember[];
  /**
   * A `candidates_only` reading whose candidates are all dimensions: a
   * possible grouping, offered and never asked about. `false` for any other
   * decision, and for a term with a measure among its candidates.
   */
  readonly groupingOnly: boolean;
}

/** The member a `kind.name` pointer names in `entry`, as the entry lists it, or `undefined`. */
function memberOf(entry: DatasetToolCatalogEntry, pointer: string): (NamedMember & { kind: string }) | undefined {
  const dot = pointer.indexOf('.');
  const kind = pointer.slice(0, dot);
  const name = pointer.slice(dot + 1);
  const list = kind === 'measures' ? entry.measures : kind === 'dimensions' ? entry.dimensions : undefined;
  const member = list?.find((m) => m.name === name);
  if (!member) return undefined;
  return { kind, label: member.label, datasetLabel: entry.label, datasetName: entry.name, name: member.name };
}

/** How one term reads in this answer ({@link composeDatasetNextStep}). */
function readTerm(
  term: string,
  datasets: readonly DatasetToolCatalogEntry[],
  candidates: readonly DatasetTermCandidate[],
): TermReading {
  const measures: NamedMember[] = [];
  const dimensions: NamedMember[] = [];
  datasets.forEach((entry) => {
    // A term sent twice repeats its entries in `matches`: one member counts once.
    const seen = new Set<string>();
    for (const match of entry.matches ?? []) {
      if (match.term !== term || seen.has(match.member)) continue;
      seen.add(match.member);
      const member = memberOf(entry, match.member);
      if (member?.kind === 'measures') measures.push(member);
      else if (member?.kind === 'dimensions') dimensions.push(member);
    }
  });
  const offered: (NamedMember & { kind: string })[] = [];
  for (const candidate of candidates) {
    if (candidate.term !== term) continue;
    // A candidate points at a member the same answer lists (the shape's invariant).
    for (const entry of datasets) {
      if (entry.name !== candidate.dataset) continue;
      const member = memberOf(entry, candidate.member);
      if (member) {
        offered.push(member);
        break;
      }
    }
  }
  const decision: DatasetNextStepDecision = measures.length === 1
    ? 'one_measure'
    : measures.length > 1
      ? 'several_measures'
      : offered.length > 0
        ? 'candidates_only'
        : 'no_measure';
  const groupingOnly = decision === 'candidates_only' && offered.every((m) => m.kind === 'dimensions');
  return { term, decision, measures, dimensions, candidates: offered, groupingOnly };
}

/**
 * The words among `readings` whose candidates are all dimensions, each offered
 * as a possible grouping, then the one sentence saying that is no question and
 * no stop for a matched measure; nothing when there is none.
 */
function groupingCandidateSentences(
  readings: readonly TermReading[],
  copy: DatasetToolCopy,
  members: (ms: readonly NamedMember[]) => string,
): string[] {
  const groupings = readings.filter((r) => r.groupingOnly);
  if (groupings.length === 0) return [];
  return [...groupings.map((r) => copy.groupingCandidateHit(r.term, members(r.candidates))), copy.groupingCandidateTail];
}

/**
 * The sentences naming the words the reported case leaves out (seat ruling B,
 * extended to `candidates_only`): under `one_measure` a word with a measure
 * among its candidates with those candidates and the ask-first instruction,
 * and a word whose candidates are all dimensions as a possible grouping, never
 * asked about; under `one_measure` and `candidates_only` an unknown word with
 * its labelled fallback, and a word that equals only a dimension as that
 * grouping. A `no_measure` word is never the reported case here, so every
 * `no_measure` reading is a left-out word.
 */
function leftOutSentences(
  decision: DatasetNextStepDecision,
  readings: readonly TermReading[],
  copy: DatasetToolCopy,
  members: (ms: readonly NamedMember[]) => string,
): string[] {
  const sentences: string[] = [];
  const leftOut = readings.filter((r) => r.decision === 'candidates_only' && r.decision !== decision);
  const asked = leftOut.filter((r) => !r.groupingOnly);
  for (const r of asked) sentences.push(copy.candidateHit(r.term, members(r.candidates)));
  if (asked.length > 0) sentences.push(copy.leftCandidateTail);
  sentences.push(...groupingCandidateSentences(leftOut, copy, members));
  const unknown = readings.filter((r) => r.decision === 'no_measure' && r.dimensions.length === 0);
  for (const r of unknown) sentences.push(copy.unknownHit(r.term));
  if (unknown.length > 0) sentences.push(copy.leftFallbackTail);
  for (const r of readings) {
    if (r.decision === 'no_measure' && r.dimensions.length > 0) sentences.push(copy.groupingHit(r.term, members(r.dimensions)));
  }
  return sentences;
}

/** What {@link composeDatasetNextStep} reads: the answer `list_datasets` is about to serve, and the caller's locales. */
export interface DatasetNextStepSource {
  /** The caller's terms, as sent. */
  readonly terms: readonly string[];
  /** The answer's catalogue entries, each with its `matches`. */
  readonly datasets: readonly DatasetToolCatalogEntry[];
  /** The answer's `candidates`. */
  readonly candidates: readonly DatasetTermCandidate[];
  /** The answer is `partial: true`. */
  readonly partial: boolean;
  /** The request's locale, then the workspace default. */
  readonly locales: readonly (string | undefined)[];
}

/**
 * [ADR-0149 M1 note] `list_datasets`' `nextStep` for the answer it is about to
 * serve: the case the precedence above reports, every term sent that is in it,
 * and the sentence. `undefined` when no term was sent. Reads nothing but
 * `source`, which is the served answer.
 */
export function composeDatasetNextStep(source: DatasetNextStepSource): DatasetNextStep | undefined {
  const unique = [...new Set(source.terms)];
  if (unique.length === 0) return undefined;
  const readings = unique.map((term) => readTerm(term, source.datasets, source.candidates));
  const decision = DATASET_NEXT_STEP_PRECEDENCE.find((d) => readings.some((r) => r.decision === d))!;
  const reported = readings.filter((r) => r.decision === decision);
  const copy = COPY[datasetToolSentenceLocale(source.locales)];
  const members = (ms: readonly NamedMember[]) => copy.list(ms.map(copy.member));

  const sentences: string[] = [];
  switch (decision) {
    case 'one_measure': {
      for (const r of reported) sentences.push(copy.oneHit(r.term, r.measures[0]));
      // Two words that equal the same measure are one metric, not two.
      const metrics = new Set(reported.map((r) => `${r.measures[0].datasetName}.${r.measures[0].name}`));
      sentences.push(copy.oneTail(metrics.size));
      sentences.push(...leftOutSentences(decision, readings, copy, members));
      break;
    }
    case 'several_measures':
      for (const r of reported) sentences.push(copy.severalHit(r.term, members(r.measures)));
      sentences.push(copy.severalTail);
      break;
    case 'candidates_only': {
      // A word with a measure among its candidates is asked about; a word
      // whose candidates are all dimensions is offered as a grouping, and
      // with no such measure word beside it the note asks which number is
      // meant, as a grouping word does (D3 rule 5).
      const asked = reported.filter((r) => !r.groupingOnly);
      for (const r of asked) sentences.push(copy.candidateHit(r.term, members(r.candidates)));
      if (asked.length > 0) sentences.push(copy.candidateTail);
      sentences.push(...groupingCandidateSentences(reported, copy, members));
      if (asked.length === 0) sentences.push(copy.groupingTail);
      sentences.push(...leftOutSentences(decision, readings, copy, members));
      break;
    }
    case 'no_measure': {
      for (const r of reported) {
        sentences.push(r.dimensions.length > 0 ? copy.groupingHit(r.term, members(r.dimensions)) : copy.unknownHit(r.term));
      }
      // A word for a thing measured that names nothing falls back (D3 rule 4);
      // a grouping word asks which number is meant (rule 5), beside the
      // fallback too when the words are mixed.
      if (reported.some((r) => r.dimensions.length === 0)) sentences.push(copy.fallbackTail);
      if (reported.some((r) => r.dimensions.length > 0)) sentences.push(copy.groupingTail);
      break;
    }
  }
  if (source.partial) sentences.push(copy.partialTail);
  return { decision, terms: reported.map((r) => r.term), note: sentences.join(copy.sentenceGap) };
}

/**
 * [ADR-0149 M1 note] `query_dataset`'s `sourceLine`: the answer's
 * `provenance` as one line to cite — each measure's label and the dataset's
 * label, then each dimension's label — in the caller's language. Composed from
 * `provenance` alone, which names only the members the selection asked for and
 * the service answered, after the query ran.
 */
export function composeDatasetSourceLine(
  provenance: DatasetProvenance,
  locales: readonly (string | undefined)[],
): string {
  const copy = COPY[datasetToolSentenceLocale(locales)];
  return copy.source(
    provenance.measures.map((m) => m.label),
    provenance.dataset.label,
    (provenance.dimensions ?? []).map((d) => d.label),
  );
}
