// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ask kinds: what kind of question each ask of a round is ({@link ASK_KINDS}).
 *
 * A question names its kind in the card (`askKind`). The unit a round counts
 * is the TURN, as the runner asks it: a question once per persona it lists
 * (or once as the admin when it lists none), a dataset question once as the
 * admin. A turn whose persona truth is `withheld` is a `forbidden` ask, read
 * off the card's personas, whatever kind the question declares: the same
 * question asked as a persona who may see it is the kind it names.
 *
 * The loader holds each declaration to what the card states
 * ({@link checkAskKinds}), so a kind is never a label the card's own truth
 * contradicts. The runner stamps each turn's kind on its result
 * (`QuestionResult.askKind`, `DatasetQuestionResult.askKind`), and the
 * scorecard counts the round kind by kind (`kindTally` in
 * `runner/scorecard.ts`).
 */

import { ASK_KINDS, type AskKind, type DatasetQuestion, type ScenarioCard } from './schema.js';
import type { Truth } from './truth.js';

type IssuePath = ReadonlyArray<string | number>;
type Refuse = (path: IssuePath, message: string) => void;
type Question = ScenarioCard['run']['questions'][number];

/** The kinds a question with a truth may declare beside `forbidden` and `unanswerable`, each with the rule its truth must meet. */
const FIGURE_KINDS = ['count', 'group_sum', 'top_n', 'time_range', 'join', 'owner_latest'] as const satisfies readonly AskKind[];

/**
 * The kind one question turn asks: `forbidden` when the persona's truth is
 * `withheld`, otherwise the kind the question declares (`undefined` when it
 * declares none).
 */
export function questionTurnKind(declared: AskKind | undefined, personaTruth: Truth | undefined): AskKind | undefined {
  return personaTruth?.kind === 'withheld' ? 'forbidden' : declared;
}

/** The dataset-question route each ask kind is held to: every route has exactly one kind or a figure kind. */
function datasetKindProblem(q: DatasetQuestion): string | undefined {
  const k = q.askKind;
  if (k === undefined) return undefined;
  const route = q.expect.kind;
  if (route === 'metric_selected') return k === 'business_term' ? undefined : 'a `metric_selected` question asks a business word that names one governed metric: its kind is `business_term`';
  if (route === 'asked_back') return k === 'ambiguous' ? undefined : 'an `asked_back` question turns on a word that names more than one metric, or none exactly: its kind is `ambiguous`';
  return (FIGURE_KINDS as readonly string[]).includes(k)
    ? undefined
    : `a \`fallback_labelled\` question is answered by an object query: its kind is what it asks for (${FIGURE_KINDS.map((x) => `\`${x}\``).join(', ')}), never \`${k}\``;
}

/** Why a question's declared kind contradicts its truth, or `undefined` when it does not. */
function questionKindProblem(q: Question, personaTruths: Readonly<Record<string, Truth>> | undefined): string | undefined {
  const k = q.askKind;
  if (k === undefined) return undefined;
  const t = q.truth;
  if (t.kind === 'unanswerable') return k === 'unanswerable' ? undefined : 'the truth is `unanswerable`: its kind is `unanswerable`';
  const paths = [...(t.filter ?? []).map((f) => f.field), ...(t.groupBy !== undefined ? [t.groupBy] : [])];
  switch (k) {
    case 'unanswerable':
      return 'only a question whose truth is `unanswerable` is of kind `unanswerable`';
    case 'business_term':
    case 'ambiguous':
      return `\`${k}\` is graded on the route the answer took: ask it as a dataset question (\`run.datasetQuestions\`), not as a question with a truth`;
    case 'forbidden': {
      const listed = q.personas ?? [];
      const all = listed.length > 0 && listed.every((p) => personaTruths?.[p]?.kind === 'withheld');
      return all
        ? undefined
        : 'a question declared `forbidden` is asked only as personas it is withheld from; one asked as a persona who may see it names the kind that persona asks, and its withheld turns count as `forbidden`';
    }
    case 'count':
      return t.kind !== 'topN' && t.groupBy === undefined ? undefined : 'a `count` question asks one figure: its truth is a count, sum, average, minimum or maximum with no `groupBy`';
    case 'group_sum':
      return t.kind !== 'topN' && t.groupBy !== undefined ? undefined : 'a `group_sum` question asks a figure per group: its truth is a count, sum, average, minimum or maximum with a `groupBy`';
    case 'top_n':
      return t.kind === 'topN' ? undefined : 'a `top_n` question ranks: its truth is a `topN`';
    case 'time_range':
      return (t.filter ?? []).some((f) => f.op === 'in_window') ? undefined : 'a `time_range` question reads a time window: its truth filters with `in_window`';
    case 'join':
      return paths.some((p) => p.includes('.')) ? undefined : 'a `join` question reads across a lookup: its truth filters or groups on a relation path (`order.status`)';
    case 'owner_latest':
      return t.groupBy !== undefined ? undefined : 'an `owner_latest` question asks who: its truth groups by the person field it names (`groupBy`)';
  }
}

/**
 * Hold every declared kind to what the card states, and require one on every
 * question and dataset question of a card that asks dataset questions (the
 * cards an ask round runs over). `personaTruths` are the loader's, so a
 * `forbidden` declaration is judged against the very truths the round grades.
 */
export function checkAskKinds(card: ScenarioCard, personaTruths: Readonly<Record<string, Record<string, Truth>>>, refuse: Refuse): void {
  const required = card.run.datasetQuestions !== undefined;
  const missing = 'a card that asks dataset questions names the kind of every question it asks (`askKind`): one of ' + ASK_KINDS.map((k) => `\`${k}\``).join(', ');
  card.run.questions.forEach((q, i) => {
    const at: IssuePath = ['run', 'questions', i, 'askKind'];
    if (q.askKind === undefined) {
      if (required) refuse(at, missing);
      return;
    }
    const problem = questionKindProblem(q, personaTruths[q.id]);
    if (problem) refuse(at, `\`${q.askKind}\` does not fit this question: ${problem}`);
  });
  (card.run.datasetQuestions ?? []).forEach((q, i) => {
    const at: IssuePath = ['run', 'datasetQuestions', i, 'askKind'];
    if (q.askKind === undefined) {
      refuse(at, missing);
      return;
    }
    const problem = datasetKindProblem(q);
    if (problem) refuse(at, `\`${q.askKind}\` does not fit this question: ${problem}`);
  });
}

/** One turn an ask round asks once: the question, the persona it is asked as (`null`: the admin), and its kind. */
export interface AskTurn {
  question: string;
  persona: string | null;
  /** `undefined` when the question names no kind. */
  askKind: AskKind | undefined;
}

/**
 * Every turn one ask round of the card asks (each asked once), in the order
 * the runner asks them: the questions, each as its personas or as the admin,
 * then the dataset questions as the admin.
 */
export function askTurns(card: ScenarioCard, personaTruths: Readonly<Record<string, Record<string, Truth>>>): AskTurn[] {
  const turns: AskTurn[] = [];
  for (const q of card.run.questions) {
    const personas = q.personas?.length ? q.personas : [null];
    for (const persona of personas) {
      turns.push({ question: q.id, persona, askKind: questionTurnKind(q.askKind, persona === null ? undefined : personaTruths[q.id]?.[persona]) });
    }
  }
  for (const q of card.run.datasetQuestions ?? []) turns.push({ question: q.id, persona: null, askKind: q.askKind });
  return turns;
}

/** How many turns of one ask round of the card ask each kind; every kind present, 0 where none does. */
export function askKindCounts(card: ScenarioCard, personaTruths: Readonly<Record<string, Record<string, Truth>>>): Record<AskKind, number> {
  const counts = Object.fromEntries(ASK_KINDS.map((k) => [k, 0])) as Record<AskKind, number>;
  for (const t of askTurns(card, personaTruths)) if (t.askKind !== undefined) counts[t.askKind]++;
  return counts;
}
