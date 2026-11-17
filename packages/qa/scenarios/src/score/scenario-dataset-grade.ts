// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The three dataset graders (ADR-0149 D3, the cloud ask-accuracy kinds of D5):
 * one answer's ROUTE through the governed semantic layer, judged from the
 * turn's transcript, never from a figure.
 *
 *   - `metric-selected`: the answer came through `query_dataset` with the
 *     expected dataset and measure. Read off the tool's own `provenance`
 *     block (`DatasetProvenanceSchema`), which the tool composes from the
 *     dataset it resolved and the model never types — not off the arguments
 *     the model sent.
 *   - `asked-back`: the reply asks which reading is meant, names every
 *     candidate, and states no figure. For a near-miss word it reads the
 *     reply alone, so it grades an ask-back the agent reasoned its way to
 *     (a skill's text, the tool description) and one `list_datasets` led it
 *     to, alike; when a `list_datasets` answer carries `candidates`, the
 *     grade's detail names them, so a record shows which way it went.
 *   - `fallback-labelled`: the answer came from an object query (and from no
 *     dataset), and the reply says it is not from a governed metric.
 *
 * Mechanical where the transcript allows: the route (which tool answered,
 * with which provenance) is read off tool outputs; whether the reply ASKS,
 * NAMES a candidate and LABELS a fallback are read off its words, against the
 * closed word lists below. A reply that says the same thing in other words is
 * graded a miss: widen the list, never loosen the check.
 */

import { LIST_DATASETS_TOOL_NAME, OBJECT_QUERY_SOURCE_TOOL_NAMES, QUERY_DATASET_TOOL_NAME } from '@objectstack/spec/ai';

import { datasetMembers, memberKey, type DatasetMemberWords } from '../datasets.js';
import type { DatasetExpectation, DatasetQuestion } from '../schema.js';
import { numbersIn, refusalOf, type RunToolCall, type RunTranscript } from './scenario-run-grade.js';
import type { CheckResult } from './scenario-score.js';

/** The grader names, as the ruling spells them; one per {@link DatasetQuestion} kind. */
export const DATASET_GRADERS = { metric_selected: 'metric-selected', asked_back: 'asked-back', fallback_labelled: 'fallback-labelled' } as const;
export type DatasetGrader = (typeof DATASET_GRADERS)[keyof typeof DATASET_GRADERS];

export interface DatasetGrade {
  grader: DatasetGrader;
  /** Every check passed. */
  pass: boolean;
  checks: CheckResult[];
  /** What the turn did on the way, for the reader; never graded (the skill it loaded, the candidates a tool offered). */
  notes: string[];
}

/**
 * The app tools that answer a question from object records: the MCP door's
 * (`query_records`, `aggregate_records`, `get_record`) and the product AI's
 * Ask data tools, whose result states an object-query `source`
 * (`OBJECT_QUERY_SOURCE_TOOL_NAMES`).
 */
export const OBJECT_QUERY_TOOLS: readonly string[] = [...new Set(['query_records', 'aggregate_records', 'get_record', ...OBJECT_QUERY_SOURCE_TOOL_NAMES])];

/** The tool a session loads a skill through. */
const SKILL_TOOL = 'Skill';

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A tool output as the JSON value it carries (the whole text, else from its first `{`). */
function outputJson(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  for (const text of [output, output.slice(Math.max(0, output.indexOf('{')))]) {
    try {
      return JSON.parse(text);
    } catch {
      // the next reading
    }
  }
  return undefined;
}

type Call = RunToolCall & { isError?: boolean };

/** A call the door answered: no error flag, no coded refusal, an output it carries. */
const answered = (c: Call): boolean => c.output !== undefined && c.isError !== true && refusalOf(c.output) === undefined;

/** The `provenance` of a `query_dataset` answer: the dataset name and the measure names it states. */
function provenanceOf(c: Call): { dataset: string; measures: string[] } | undefined {
  const v = outputJson(c.output);
  const p = isBag(v) ? v.provenance : undefined;
  if (!isBag(p) || p.kind !== 'dataset' || !isBag(p.dataset) || typeof p.dataset.name !== 'string') return undefined;
  const measures = Array.isArray(p.measures) ? p.measures.filter(isBag).map((m) => m.name).filter((n): n is string => typeof n === 'string') : [];
  return { dataset: p.dataset.name, measures };
}

/**
 * The reply asks the person something: a question mark (either width), or
 * one of the asking phrases below at a line's or sentence's start.
 */
const ASKS = /[?？]|(?:^|[.。!！\n]\s*)(?:please (?:confirm|clarify|specify|tell me|let me know)|could you (?:clarify|confirm|specify)|which (?:one|of)|请(?:确认|说明|告诉我|明确)|您是指|你是指)/i;

/** Numbered-list markers (`1.`, `2)`, `3、`) at a line's start: an option list's numbering, never a figure. */
const LIST_MARKER = /^[ \t]*(?:[-*][ \t]+)?\(?\d{1,2}(?:[.)][ \t]+|、[ \t]*)/gm;

/** A number's edges: no digit, decimal or thousands separator, percent or currency sign touches it. */
const NUMBER_BEFORE = String.raw`(?<![\d$¥￥€£]|\d[.,，])`;
const NUMBER_AFTER = String.raw`(?![\d%％]|[.,，]\d)`;

/**
 * A count of the options the reply offers (`I found 2 metrics`, `2 possible
 * readings`, 「对应 2 个指标」, 「有 2 种口径」): a one- or two-digit whole number,
 * then a candidate noun, at most one qualifier from the closed list between.
 * It counts the readings the person chooses from, never a figure of the data,
 * so a count of anything else (`42 orders`, 「3 张发票」) stays a figure. A count
 * written as a word (`two metrics`, 「两个指标」) has no digit to read at all.
 */
const OPTION_COUNT = new RegExp(
  [
    String.raw`${NUMBER_BEFORE}\b\d{1,2}${NUMBER_AFTER}\s+(?:(?:matching|possible|different|distinct|separate|candidate|defined|governed|related|relevant|available)\s+)?(?:metrics?|measures?|options?|readings?|datasets?|candidates?|choices?|interpretations?|definitions?|meanings?|matches)\b`,
    String.raw`${NUMBER_BEFORE}\d{1,2}${NUMBER_AFTER}\s*[个种项]\s*(?:(?:可能|不同|相关|匹配|对应|可选|候选)的?)?(?:指标|口径|选项|数据集|度量|候选|含义|理解|解释|读法)`,
  ].join('|'),
  'gi',
);

/**
 * Words ending in -s that follow a year as its subject or as grammar, not as
 * what a number counts (`In 2025 sales grew`, `since 2020 earnings`, `in 2025
 * its revenue`, `In 2025 was`). Closed: widen it when a year reads as a figure.
 */
const YEAR_FOLLOWERS = String.raw`(?:sales|earnings|revenues|profits|results|figures|numbers|totals|margins|costs|expenses|this|its|his|was|has|is|as|thus|plus|versus|across)`;

/**
 * A year written alone (`revenue in 2025?`, 「2025 年的营收」): a 19xx/20xx
 * number behind a word that puts a time on it, or before 年. It names a
 * period, it counts nothing. Without that word it stays a figure (`Revenue is
 * 2025`, `a total of 2025 orders`), and so does one with a unit or currency,
 * or one a counted noun follows (`payments for 2031 orders`, `from 1980
 * invoices`): any word ending in -s, or `people` / `staff`, unless it is one
 * of {@link YEAR_FOLLOWERS}. So a word this misses reads as a figure (a graded
 * miss), never as a year.
 */
const BARE_YEAR = new RegExp(
  [
    String.raw`(?<=\b(?:in|for|during|since|from|through|until|till|before|after|year|fiscal year|calendar year|FY)\s+)(?:19|20)\d{2}${NUMBER_AFTER}(?!\s*(?:万|亿|元|thousand|million|billion|mn|bn|dollars?|yuan|USD|EUR|RMB|CNY|[kKmMbB]\b))(?!\s+(?:(?!${YEAR_FOLLOWERS}\b)[A-Za-z]+s|people|staff)\b)`,
    String.raw`${NUMBER_BEFORE}(?:19|20)\d{2}(?=\s*年)`,
  ].join('|'),
  'gi',
);

/**
 * The figures a reply states, an option list's numbering, a count of the
 * options it offers ({@link OPTION_COUNT}) and a year written alone
 * ({@link BARE_YEAR}) left out.
 */
export function statedFigures(replyText: string): number[] {
  return numbersIn(replyText.replace(LIST_MARKER, '').replace(OPTION_COUNT, ' ').replace(BARE_YEAR, ' '));
}

/**
 * Words that say an answer is not from a governed metric (ADR-0149 D3 rule 4:
 * 「来源：对象 … 合计（非指标口径）」). English: a negation within a few words
 * of `governed`, `dataset`, `semantic layer`, `defined metric`, `certified` or
 * `official metric`; Chinese: 非指标口径 and its close spellings.
 */
const NOT_GOVERNED = [
  /\b(?:not|no|isn['’]t|aren['’]t|without|none of|outside)\b[^.\n]{0,60}\b(?:governed|datasets?|semantic layer|defined metrics?|certified|official metrics?)\b/i,
  /\b(?:ungoverned|non-governed)\b/i,
  /非指标口径|非口径|不是指标口径|非(?:治理|受控)指标|没有(?:对应的?|匹配的?)?(?:指标|数据集)|未(?:使用|命中)(?:任何)?(?:指标|数据集)|不是来自(?:指标|数据集)|并非(?:指标|数据集)/,
];

/** Does the reply carry a not-governed label ({@link NOT_GOVERNED})? */
export function labelsFallback(replyText: string): boolean {
  return NOT_GOVERNED.some((re) => re.test(replyText));
}

/**
 * Does the reply name `member`: its label, its name, or one of its synonyms,
 * compared without case — other than the question's own words? An ambiguous
 * word is a synonym of every candidate, so echoing it ("which revenue?")
 * names none of them.
 */
function names(replyText: string, member: DatasetMemberWords, questionWords: readonly string[]): boolean {
  const spelled = (w: string) => w.normalize('NFKC').toLowerCase();
  const asked = new Set(questionWords.map(spelled));
  const reply = spelled(replyText);
  return member.words.filter((w) => !asked.has(spelled(w))).some((w) => reply.includes(spelled(w)) || reply.includes(spelled(w).replace(/_/g, ' ')));
}

/** The member names a `list_datasets` answer offers as `candidates` (a zero-match answer that lists the near ones), when it carries any. */
function offeredCandidates(calls: readonly Call[]): string[] {
  const out: string[] = [];
  for (const c of calls) {
    if (c.name !== LIST_DATASETS_TOOL_NAME || !answered(c)) continue;
    const v = outputJson(c.output);
    const list = isBag(v) ? v.candidates : undefined;
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      if (typeof x === 'string') out.push(x);
      else if (isBag(x)) {
        const member = typeof x.member === 'string' ? x.member : typeof x.name === 'string' ? x.name : undefined;
        const dataset = typeof x.dataset === 'string' ? x.dataset : isBag(x.dataset) && typeof x.dataset.name === 'string' ? x.dataset.name : undefined;
        if (member !== undefined) out.push(dataset !== undefined ? `${dataset}.${member}` : member);
      }
    }
  }
  return [...new Set(out)];
}

/** What the turn did on the way: the skills it loaded and what `list_datasets` offered. Never graded. */
function routeNotes(calls: readonly Call[]): string[] {
  const notes: string[] = [];
  const skills = calls.filter((c) => c.name === SKILL_TOOL).map((c) => (isBag(c.input) && typeof c.input.skill === 'string' ? c.input.skill : '(unnamed)'));
  if (skills.length) notes.push(`loaded skill ${[...new Set(skills)].join(', ')}`);
  if (!calls.some((c) => c.name === LIST_DATASETS_TOOL_NAME)) notes.push('called no list_datasets');
  const offered = offeredCandidates(calls);
  if (offered.length) notes.push(`list_datasets offered candidates ${offered.join(', ')}`);
  return notes;
}

const check = (name: string, pass: boolean, detail?: string): CheckResult => ({ check: name, pass, ...(detail !== undefined && !pass ? { detail } : {}) });

/**
 * Grade one dataset question's turn against the route its card declares.
 * `datasets` are the card's (`expect.datasets`), namespace-relative as the
 * run's card is: dataset names are plain, base objects carry the prefix.
 */
export function gradeDatasetQuestion(datasets: readonly DatasetExpectation[], question: DatasetQuestion, turn: RunTranscript): DatasetGrade {
  const calls = turn.toolCalls as readonly Call[];
  const e = question.expect;
  const grader = DATASET_GRADERS[e.kind];
  const notes = routeNotes(calls);
  const dsAnswers = calls.filter((c) => c.name === QUERY_DATASET_TOOL_NAME && answered(c));
  const provenances = dsAnswers.map(provenanceOf).filter((p): p is NonNullable<typeof p> => p !== undefined);
  const checks: CheckResult[] = [];

  if (e.kind === 'metric_selected') {
    const want = memberKey(e);
    const hit = provenances.some((p) => p.dataset === e.dataset && p.measures.includes(e.measure));
    const seen = provenances.flatMap((p) => p.measures.map((m) => `${p.dataset}.${m}`));
    checks.push(
      check(
        `${grader}:query_dataset`,
        hit,
        dsAnswers.length === 0
          ? `no query_dataset call answered${calls.some((c) => c.name === QUERY_DATASET_TOOL_NAME) ? ' (every one was refused)' : ''}`
          : seen.length
            ? `query_dataset answered with ${seen.join(', ')}, not ${want}`
            : 'query_dataset answered with no provenance naming a measure',
      ),
    );
  } else if (e.kind === 'asked_back') {
    const members = datasetMembers(datasets);
    const candidates = e.candidates.map((c) => members.find((m) => m.kind === 'measure' && m.dataset === c.dataset && m.name === c.measure)!).filter(Boolean);
    const figures = statedFigures(turn.replyText);
    checks.push(check(`${grader}:asks`, ASKS.test(turn.replyText), 'the reply asks the person nothing'));
    const unnamed = candidates.filter((m) => !names(turn.replyText, m, question.words)).map((m) => memberKey(m));
    checks.push(check(`${grader}:names-candidates`, unnamed.length === 0, `the reply does not name ${unnamed.join(', ')}`));
    checks.push(check(`${grader}:no-figure`, figures.length === 0, `the reply states ${figures.join(', ')}`));
  } else {
    const objectAnswers = calls.filter((c) => OBJECT_QUERY_TOOLS.includes(c.name) && answered(c));
    const onObject = objectAnswers.filter((c) => isBag(c.input) && c.input.objectName === e.object);
    checks.push(
      check(
        `${grader}:object-query`,
        onObject.length > 0 && provenances.length === 0,
        provenances.length
          ? `the answer came through query_dataset (${provenances.map((p) => p.dataset).join(', ')}), not an object query`
          : objectAnswers.length
            ? `no object query on ${e.object} answered (object queries on ${[...new Set(objectAnswers.map((c) => (isBag(c.input) ? String(c.input.objectName) : '?')))].join(', ')})`
            : 'no object query answered',
      ),
    );
    checks.push(check(`${grader}:label`, labelsFallback(turn.replyText), 'the reply does not say the figure is not from a governed metric'));
  }
  return { grader, pass: checks.every((c) => c.pass), checks, notes };
}
