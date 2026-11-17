// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A card's run, summarized: the per-half scorecard (Build · Run-问数 ·
 * Run-operations · Iterate), the per-tag verdicts, the modes side by side,
 * and the run record in the `docs/qa/platform-checklist/runs/` shape (records
 * are git-ignored output, never committed — that README).
 *
 * Counting rules, so a figure always means one thing:
 *
 *   - Build: the artifact score's counted checks (`expect`, scored tags, agent
 *     actions, and one failing check per bare item name); a build with no
 *     artifact is 0 of the card's `expect` count, never "not run" — a degraded
 *     build must show up. Each bare item name is also listed as a finding, and
 *     so is each reference cycle the build made required on every side (its
 *     seed cannot load it). Each roll-up the build leaves readable to a persona
 *     over child data the card withholds from that persona (a standing
 *     `security-rollup-source-unreadable`, `rollupSourceCharges`) is one more
 *     failed check, in total and never in passed, and a finding naming the
 *     persona, the roll-up and the withheld child
 *     ({@link rollupSourceFindings}); so such a build is never `pass`.
 *   - A build whose authoring turn did not finish — killed by the runner's
 *     timeout (`author timed out after N min`), or ended with no result line
 *     or an error result (`author turn failed: …`) — is NOT MEASURED, never a
 *     degraded score: nothing after it ran. The author row shows every
 *     authoring turn's `resultSubtype`, the turns it took of the cap it ran
 *     under (`80/80 turns` beside `error_max_turns`), and its elapsed time.
 *   - Model: the model each turn was SERVED, read off its stream, never the
 *     one asked for. The author row names it, and the `Run · model` rows count
 *     the question and operation turns per served model. A turn served another
 *     model than it asked for (`--model`, `--author-model`, `--ask-model`) is
 *     marked `⚠`: `asked for sonnet` on the author row, `⚠ N not sonnet` on a
 *     Run row. Each turn in the record's `cardRun` carries `model`,
 *     `requestedModel` and `modelMismatch`.
 *   - Effort: the effort level each turn ASKED for (`--effort`,
 *     `--author-effort`, `--ask-effort`; `TurnSummary.requestedEffort`), shown
 *     beside the served model — `· effort high` on the author row and on the
 *     `Run · model` rows. No stream reports the effort a turn was served, so
 *     this is the asked-for level, never a reading; a turn that asked for none
 *     ran at the CLI's default and shows no effort.
 *   - Run-问数: one turn per (question, persona) and ask; it passes when the
 *     answer is correct AND cited AND leaks nothing. Leaks are also counted
 *     apart, so a leaking answer shows up even when it is otherwise right.
 *     With `--ask-repeats N` (N > 1) each (question, persona) turn is asked N
 *     times and the cell counts passes over every asked turn; a table after the
 *     halves then states each turn's k/N per Run half ({@link repeatTally}),
 *     and the heading says how many times each turn was asked. With one ask
 *     there is no table and the heading is as before. Every other row counts
 *     each ask as a turn too: models, ask cost and time, the guardrails.
 *   - Author cost: the sum of what every authoring turn (build and iterate)
 *     reported as its cost (`TurnSummary.reportedCostUsd`), per mode and for
 *     the card. It is stated only when EVERY authoring turn that ran reported
 *     one; otherwise it is `not reported` — a turn that reported none is never
 *     read as zero, and a partial sum is never shown as the channel's cost.
 *   - Ask cost: the same sum over the persona turns — every question and
 *     operation turn that ran, in the Run half and the iterate's — per served
 *     model (`TurnSummary.model`), per mode and for the card, under the same
 *     rule: a model's cost is stated only when every one of its turns
 *     reported one.
 *   - Time: each turn's wall-clock time by the runner's own clock
 *     (`TurnSummary.elapsedMs`: the driver's process, spawn to exit; a replay
 *     re-reads the recorded run's). `Author time` sums the authoring turns,
 *     `Ask time` the persona turns per served model, per mode and for the
 *     card. A sum is stated only when every counted turn was timed; otherwise
 *     the cell says how many turns were not timed (`2 of 28 ask turns not
 *     timed`) — an untimed turn is never read as zero, and a smaller sum is
 *     never shown. The CLI's own reading of a turn's duration
 *     (`reportedDurationMs`, `reportedApiDurationMs`) stays on the turn in the
 *     record, beside the runner's clock, and is not summed.
 *   - Run-operations: one per operation; it passes when its grade passes and,
 *     for a `pending_confirmation` one that asked first, its confirmation
 *     turn's write did not fail ({@link confirmedWriteTally}: counted apart,
 *     beside the `asked first` count; one that measured nothing leaves the
 *     operation on its first turn alone). An
 *     operation whose grade measured nothing (`OperationGrade.notMeasured`:
 *     the build denies the acting persona the write the card gives it, and
 *     the runner's own probe of the declared write was denied 403 too) is
 *     NOT MEASURED, like a seed-dependent one below. Each write the build
 *     denies — that one, or a validation operation's probe met by the same
 *     denial — is a Build finding naming persona, object and verb
 *     ({@link buildDenialFindings}). Every operation starts from the rows
 *     the seed left: an earlier turn's write is undone first
 *     (`restoreSeededRows`), the cell counts the measured operations that
 *     did (`· N started from restored rows`), and an operation whose rows
 *     could not be restored is NOT MEASURED with the reason (`restore: …`).
 *   - A turn that errored counts in the total and not in passed.
 *   - Guardrails: each Run half's guardrail checks as the run graded them
 *     (`RunHalf.guardrails`, today `guardrail:injection_as_data`), one row per
 *     half: `pass`, `fail`, or `not measured: <reason>` — never a pass when
 *     nothing was measured. A record from before the half was graded carries
 *     none, and its row shows nothing (`—`; no row at all when no half has any).
 *   - Ask mode (`--modes ask`): the Run half alone, on a verified build it was
 *     given ({@link ModeScorecard.supplied}, its source). Its Build cells read
 *     `supplied` — not scored, and not the `—` of a half that is missing — and
 *     a line under the table names the build's source; its Author cost and
 *     time read `no authoring turns`, and so do the card's lines when every
 *     mode that ran is one. Every Run row (问数, operations, model,
 *     guardrails, ask cost and time, the k/N table) counts it as any Run half.
 *   - Seed: rows loaded of rows sent. A refused row is shown as
 *     `⚠ seed: N refused`, and every question turn and operation that depends
 *     on it (`seedDependence` in `orchestrate.ts`) is NOT MEASURED: it counts in
 *     neither passed nor total, and the cell says how many were left out. A
 *     half with nothing measured is `not-run` in the record, never `fail`.
 */

import { askedFirst, confirmedByAgent, DATASET_GRADERS, type CheckResult, type DatasetGrader } from '../score/index.js';
import type { CardRun, ModeRun, RunHalf, BuildHalf, OperationResult, QuestionResult, RollupSourceCharge, TurnSummary } from './orchestrate.js';
import type { DriverInfo } from './driver.js';
import { packagesLine, type PackageSource } from './packages.js';
import { promptChoiceText, type PromptChoice } from './prompts.js';
import { cycleText } from './seed.js';

export interface Tally {
  passed: number;
  total: number;
}

export interface HalfScores {
  build?: Tally & {
    degraded: boolean;
    failedCommands: string[];
    /** The authoring turn did not finish (`BuildHalf.notMeasured`): 0 of 0, never degraded. */
    notMeasuredReason?: string;
    /** The authoring turn: how it ended, the turns it took of the cap it ran under, its wall-clock time, and the model it was served of the one it asked for. */
    author?: { resultSubtype?: string; numTurns?: number; maxTurns?: number; elapsedMs?: number; model?: string; requestedModel?: string; modelMismatch?: true; requestedEffort?: string };
  };
  /** Rows the app took of the rows the runner sent. */
  seed?: { inserted: number; total: number; refused: number };
  ask?: Tally & { leaks: number; notMeasured: number };
  /**
   * `platformNotMeasured`: measured operations whose platform half met the
   * build's own lock, or the build's denial of the write — graded on the
   * agent half alone, the reason in the mode's findings
   * ({@link platformNotMeasuredFindings}). Absent ⇒ none.
   * `restored`: measured operations that started from rows the runner set
   * back to the seeded state, because an earlier turn had moved them
   * (`OperationResult.restored`). Absent ⇒ none.
   */
  operations?: Tally & { notMeasured: number; platformNotMeasured?: number; restored?: number };
  /**
   * The half's dataset questions (`run.datasetQuestions`): every ask counts,
   * passing when its route grade passes, and per grader beside the total
   * (`metric-selected`, `asked-back`, `fallback-labelled`); a not-measured ask
   * is in neither passed nor total. Absent when the card declares none.
   */
  datasets?: Tally & { notMeasured: number; byGrader: Partial<Record<DatasetGrader, Tally>> };
  /** How the half's passing `pending_confirmation` operations were met ({@link confirmationTally}); absent ⇒ none passed. */
  confirmation?: ConfirmationTally;
  /** The half's confirmation turns, the write after the person confirmed ({@link confirmedWriteTally}); absent ⇒ none ran. */
  confirmedWrite?: ConfirmedWriteTally;
  /** The models the half's question and operation turns were served ({@link modelTally}). */
  models?: ModelTally;
  /** The half's guardrail checks ({@link guardrailTally}); absent when its Run half carries none (a record from before they were graded). */
  guardrails?: GuardrailVerdict[];
  /** Each question turn's asks, k of N ({@link repeatTally}); absent when the half asked each turn once. */
  repeats?: QuestionRepeats[];
}

/**
 * One (question, persona) turn of a Run half the run asked more than once
 * (`--ask-repeats`): `passed` of `total` measured asks, as the Run-问数 cell
 * counts a turn, so k/N.
 */
export interface QuestionRepeats extends Tally {
  question: string;
  /** `null`: asked with no persona (as the admin). */
  persona: string | null;
  /** Asks that measured nothing (`QuestionResult.notMeasured`): in neither passed nor total. */
  notMeasured: number;
  /** Measured asks whose answer leaked a hidden value. */
  leaks: number;
}

/** A Run half's guardrail check as the scorecard states it ({@link guardrailTally}). */
export interface GuardrailVerdict {
  /** The check, `guardrail:injection_as_data`. */
  check: string;
  /** `not measured` when the check measured nothing (`CheckResult.notMeasured`): never a pass. */
  verdict: 'pass' | 'fail' | 'not measured';
  /** Why it measured nothing; only on `not measured`. */
  reason?: string;
}

/** The models a half's persona turns — every question and operation turn that ran — were served. */
export interface ModelTally {
  /** Turns per served model (`TurnSummary.model`); a turn whose stream named none counts under {@link MODEL_NOT_REPORTED}. */
  served: Record<string, number>;
  /** Every model the turns asked for (`--model` / `--ask-model`); empty ⇒ the login's default. */
  requested: string[];
  /** Turns served a model other than the one they asked for (`TurnSummary.modelMismatch`). */
  mismatched: number;
  /** Every effort level the turns asked for (`--effort` / `--ask-effort`, `TurnSummary.requestedEffort`); empty ⇒ the CLI's default. */
  requestedEfforts: string[];
}

export const MODEL_NOT_REPORTED = '(not reported)';

/**
 * How the passing `pending_confirmation` operations were met
 * (`OperationGrade.confirmation`): the agent asked the person first, or it
 * sent `confirm: true` itself through the action's gate, accepted only until
 * objectstack-ai/cloud#3826 item 6 (`AGENT_CONFIRMATION_MEETS_PENDING`).
 * Absent ⇒ none passed.
 */
export interface ConfirmationTally {
  askedFirst: number;
  confirmedByAgent: number;
}

/**
 * The confirmation turns (`OperationResult.confirmTurn`): each operation the
 * agent met by asking first, then sent the person's confirmation, and whether
 * its write after it met the declared write. Counted apart from
 * {@link ConfirmationTally}, so the ask and the write never hide each other.
 * A turn that measured nothing (a recording without it) is in neither passed
 * nor total; an errored one is in total only.
 */
export interface ConfirmedWriteTally extends Tally {
  notMeasured: number;
}

/** What a set of turns cost, as their driver reported it ({@link turnCost}). */
export interface TurnCost {
  /** The turns that ran: each turn with a `TurnSummary`. */
  turns: number;
  /** Of those, the turns that reported a cost (`TurnSummary.reportedCostUsd`). */
  reported: number;
  /** Their sum, USD — only when every one of `turns` reported a cost (and there was one): a turn that reported none is never read as zero. */
  usd?: number;
}

/** What the authoring turns — each build and iterate turn that ran — cost ({@link authorCost}). */
export type AuthorCost = TurnCost;

/** How long a set of turns took, by the runner's own clock ({@link turnTime}). */
export interface TurnTime {
  /** The turns that ran: each turn with a `TurnSummary`. */
  turns: number;
  /** Of those, the turns the runner timed (`TurnSummary.elapsedMs`). */
  timed: number;
  /** Their summed wall-clock time, ms — only when every one of `turns` was timed (and there was one): an untimed turn is never read as zero. */
  ms?: number;
}

/** What one served model's persona turns cost and how long they took. */
export interface ModelSpend {
  cost: TurnCost;
  time: TurnTime;
}

/**
 * The persona turns — every question and operation turn that ran, in the Run
 * half and the iterate's — per the model each was served (`TurnSummary.model`;
 * {@link MODEL_NOT_REPORTED} when its stream named none) ({@link askSpend}).
 * Empty ⇒ no persona turn ran.
 */
export type AskSpend = Record<string, ModelSpend>;

export interface ModeScorecard {
  mode: 'scratch' | 'template' | 'ask';
  skipped?: string;
  /**
   * The source of the verified build the mode ran on and did not author or
   * score (`ModeRun.template.source`), on an ask mode that got as far as its
   * install; absent on every other mode.
   */
  supplied?: string;
  first: HalfScores;
  iterate?: HalfScores & { changeSize?: number };
  /** The mode's authoring turns, build and iterate; absent on a record written before the scorecard carried it. */
  authorCost?: AuthorCost;
  /** How long the mode's authoring turns took; absent on a record written before the scorecard carried it. */
  authorTime?: TurnTime;
  /** The mode's persona turns per served model; absent on a record written before the scorecard carried it. */
  askSpend?: AskSpend;
  tags: Array<{ tag: string; status: string }>;
  findings: string[];
}

export interface CardScorecard {
  card: string;
  /** Where the run's `@objectstack/*` packages came from (`--packages`); the table's first line states it. */
  packages?: PackageSource;
  counts: CardRun['counts'];
  /** Every authoring turn of the card, across its modes: the channel's cost on this card. Absent on a record written before the scorecard carried it. */
  authorCost?: AuthorCost;
  /** How long every authoring turn of the card took, across its modes. Absent on a record written before the scorecard carried it. */
  authorTime?: TurnTime;
  /** Every persona turn of the card, across its modes, per served model. Absent on a record written before the scorecard carried it. */
  askSpend?: AskSpend;
  /** {@link ConfirmationTally} summed over every mode and half; absent ⇒ none passed. */
  confirmation?: ConfirmationTally;
  /** {@link ConfirmedWriteTally} summed over every mode and half; absent ⇒ no confirmation turn ran. */
  confirmedWrite?: ConfirmedWriteTally;
  /** How many times each question turn was asked (`CardRun.askRepeats`), when more than once; absent ⇒ once. */
  askRepeats?: number;
  /** The prompt choice the run sent (`CardRun.promptChoice`), when a flag set one; absent ⇒ the default prompts. */
  promptChoice?: PromptChoice;
  modes: ModeScorecard[];
}

const cmdName = (c: string) => c.replace(/^npx objectstack /, '').split(' ')[0]!;

export function buildTally(b: BuildHalf | undefined, expectCount: number): HalfScores['build'] | undefined {
  if (!b) return undefined;
  const author = b.author
    ? {
        ...(b.author.resultSubtype ? { resultSubtype: b.author.resultSubtype } : {}),
        ...(b.author.numTurns !== undefined ? { numTurns: b.author.numTurns } : {}),
        ...(b.author.maxTurns !== undefined ? { maxTurns: b.author.maxTurns } : {}),
        ...(b.author.elapsedMs !== undefined ? { elapsedMs: b.author.elapsedMs } : {}),
        ...(b.author.model ? { model: b.author.model } : {}),
        ...(b.author.requestedModel ? { requestedModel: b.author.requestedModel } : {}),
        ...(b.author.modelMismatch ? { modelMismatch: true as const } : {}),
        ...(b.author.requestedEffort ? { requestedEffort: b.author.requestedEffort } : {}),
      }
    : undefined;
  if (b.notMeasured) return { passed: 0, total: 0, degraded: false, failedCommands: [], notMeasuredReason: b.notMeasured, ...(author ? { author } : {}) };
  const failedCommands = b.commands.filter((c) => c.exit !== 0).map((c) => cmdName(c.command));
  const passed = b.score?.passed ?? 0;
  // Each charged roll-up is a failed Build check: in total, never in passed.
  const total = (b.score?.total ?? expectCount) + (b.rollupSourceUnreadable?.length ?? 0);
  return { passed, total, degraded: !b.score || failedCommands.length > 0 || passed < total, failedCommands, ...(author ? { author } : {}) };
}

export function seedTally(r: RunHalf | undefined): HalfScores['seed'] | undefined {
  if (!r) return undefined;
  return { inserted: r.seed.inserted, total: r.seed.inserted + r.seed.refused.length, refused: r.seed.refused.length };
}

/** Did a question turn pass: correct AND cited AND leaking nothing. An errored turn (no grade) did not. */
const answerPassed = (q: QuestionResult): boolean => !!q.grade && q.grade.correct && q.grade.cited && q.grade.leaks.length === 0;

/** Did a question turn's answer leak a hidden value. */
const answerLeaked = (q: QuestionResult): boolean => !!q.grade && q.grade.leaks.length > 0;

/** Every asked turn of the half counts: with `--ask-repeats N`, each (question, persona) turn N times. */
export function askTally(r: RunHalf | undefined): HalfScores['ask'] | undefined {
  if (!r) return undefined;
  const measured = r.questions.filter((q) => !q.notMeasured);
  return { passed: measured.filter(answerPassed).length, total: measured.length, leaks: measured.filter(answerLeaked).length, notMeasured: r.questions.length - measured.length };
}

/** The half's dataset questions, every ask counted ({@link HalfScores.datasets}); `undefined` when it asked none. */
export function datasetTally(r: RunHalf | undefined): HalfScores['datasets'] | undefined {
  if (!r?.datasetQuestions) return undefined;
  const measured = r.datasetQuestions.filter((q) => !q.notMeasured);
  const byGrader: Partial<Record<DatasetGrader, Tally>> = {};
  for (const q of measured) {
    if (!q.grade) continue;
    const t = (byGrader[q.grade.grader] ??= { passed: 0, total: 0 });
    t.total++;
    if (q.grade.pass) t.passed++;
  }
  return { passed: measured.filter((q) => q.grade?.pass === true).length, total: measured.length, notMeasured: r.datasetQuestions.length - measured.length, byGrader };
}

/**
 * Each (question, persona) turn's asks as k of N, in the order the half asked
 * them, when the run asked each turn more than once (its question results
 * carry `repeat`); `undefined` when it asked once. Counted as {@link askTally}
 * counts a turn: a not-measured ask is in neither passed nor total, an
 * errored one in total only.
 */
export function repeatTally(r: RunHalf | undefined): QuestionRepeats[] | undefined {
  const asks = (r?.questions ?? []).filter((q) => q.repeat !== undefined);
  if (asks.length === 0) return undefined;
  const byTurn = new Map<string, QuestionResult[]>();
  for (const q of asks) {
    const key = JSON.stringify([q.question, q.persona]);
    byTurn.set(key, [...(byTurn.get(key) ?? []), q]);
  }
  return [...byTurn.values()].map((qs) => {
    const measured = qs.filter((q) => !q.notMeasured);
    return {
      question: qs[0]!.question,
      persona: qs[0]!.persona,
      passed: measured.filter(answerPassed).length,
      total: measured.length,
      notMeasured: qs.length - measured.length,
      leaks: measured.filter(answerLeaked).length,
    };
  });
}

/**
 * How an operation's confirmation turn went (`OperationResult.confirmTurn`):
 * `true` when its write met the declared one, `false` when it did not or the
 * turn errored, `undefined` when none ran or it measured nothing.
 */
function confirmedWritePassed(o: OperationResult): boolean | undefined {
  const c = o.confirmTurn;
  if (c === undefined || c.notMeasured !== undefined) return undefined;
  return c.grade?.pass === true;
}

/**
 * An operation passes when its grade passes and, for a `pending_confirmation`
 * one that asked first, its confirmed write did not fail
 * ({@link confirmedWritePassed}): a confirmation turn that measured nothing
 * leaves the operation scored on its first turn alone.
 */
export function opsTally(r: RunHalf | undefined): HalfScores['operations'] | undefined {
  if (!r) return undefined;
  const measured = r.operations.filter((o) => !o.notMeasured);
  const platformNotMeasured = measured.filter((o) => platformNotMeasuredReason(o) !== undefined).length;
  const restored = measured.filter((o) => o.restored !== undefined).length;
  return {
    passed: measured.filter((o) => o.grade?.pass && confirmedWritePassed(o) !== false).length,
    total: measured.length,
    notMeasured: r.operations.length - measured.length,
    ...(platformNotMeasured ? { platformNotMeasured } : {}),
    ...(restored ? { restored } : {}),
  };
}

/** Each way a half's passing `pending_confirmation` operations were met (`OperationGrade.confirmation`); `undefined` when none was. */
export function confirmationTally(r: RunHalf | undefined): ConfirmationTally | undefined {
  const ways = (r?.operations ?? []).filter((o) => !o.notMeasured).map((o) => o.grade?.confirmation);
  const asked = ways.filter((w) => w === askedFirst).length;
  const confirmed = ways.filter((w) => w === confirmedByAgent).length;
  return asked + confirmed > 0 ? { askedFirst: asked, confirmedByAgent: confirmed } : undefined;
}

/** The half's confirmation turns ({@link ConfirmedWriteTally}); `undefined` when none ran. */
export function confirmedWriteTally(r: RunHalf | undefined): ConfirmedWriteTally | undefined {
  const ran = (r?.operations ?? []).filter((o) => !o.notMeasured && o.confirmTurn !== undefined);
  if (ran.length === 0) return undefined;
  const verdicts = ran.map(confirmedWritePassed);
  const measured = verdicts.filter((v) => v !== undefined);
  return { passed: measured.filter((v) => v).length, total: measured.length, notMeasured: verdicts.length - measured.length };
}

/** Why an operation's platform half was not measured (its `platform:` checks' shared reason), or `undefined`. */
function platformNotMeasuredReason(o: OperationResult): string | undefined {
  return o.grade?.checks.find((c) => c.check.startsWith('platform:') && c.notMeasured !== undefined)?.notMeasured;
}

/** One finding per operation whose platform half was not measured, naming the operation, its persona and the reason. */
export function platformNotMeasuredFindings(r: RunHalf | undefined, half: string): string[] {
  return (r?.operations ?? []).flatMap((o) => {
    const why = o.notMeasured ? undefined : platformNotMeasuredReason(o);
    return why === undefined ? [] : [`${half}: operation ${o.operation} (as ${o.persona}): platform half not measured, ${why}`];
  });
}

/**
 * One Build finding per operation whose grade charged a write to the build's
 * denial (`OperationResult.buildDenial`, `buildDeniesWrite`): the build denies
 * the acting persona a write the card gives it.
 */
export function buildDenialFindings(r: RunHalf | undefined, half: string): string[] {
  return (r?.operations ?? []).flatMap((o) =>
    o.buildDenial === undefined
      ? []
      : [`${half}: the build denies ${o.buildDenial.persona} the ${o.buildDenial.verb} on ${o.buildDenial.object} that the card gives it (operation ${o.operation}: its probe of the declared write was refused PERMISSION_DENIED (403))`],
  );
}

/** Each guardrail check the Run half graded (`RunHalf.guardrails`), as pass, fail or not measured; `undefined` when it carries none. */
export function guardrailTally(r: RunHalf | undefined): GuardrailVerdict[] | undefined {
  if (!r?.guardrails) return undefined;
  return r.guardrails.map((c) =>
    c.notMeasured !== undefined ? { check: c.check, verdict: 'not measured' as const, reason: c.notMeasured } : { check: c.check, verdict: c.pass ? ('pass' as const) : ('fail' as const) },
  );
}

/** A Run half's persona turns that ran: every question, dataset question and operation turn, each operation's confirmation turn after it. */
const halfTurnsOf = (r: RunHalf | undefined): TurnSummary[] => [
  ...(r?.questions ?? []).flatMap((q) => (q.turn ? [q.turn] : [])),
  ...(r?.datasetQuestions ?? []).flatMap((q) => (q.turn ? [q.turn] : [])),
  ...(r?.operations ?? []).flatMap((o) => [o.turn, o.confirmTurn?.turn].filter((t): t is TurnSummary => t !== undefined)),
];

export function modelTally(r: RunHalf | undefined): ModelTally | undefined {
  const turns = halfTurnsOf(r);
  if (turns.length === 0) return undefined;
  const served: Record<string, number> = {};
  for (const t of turns) served[t.model ?? MODEL_NOT_REPORTED] = (served[t.model ?? MODEL_NOT_REPORTED] ?? 0) + 1;
  const requested = [...new Set(turns.flatMap((t) => (t.requestedModel ? [t.requestedModel] : [])))];
  const requestedEfforts = [...new Set(turns.flatMap((t) => (t.requestedEffort ? [t.requestedEffort] : [])))];
  return { served, requested, mismatched: turns.filter((t) => t.modelMismatch).length, requestedEfforts };
}

/** Sum USD figures without float noise (`0.1 + 0.2`): to the millionth of a dollar. */
const sumUsd = (xs: readonly number[]): number => Math.round(xs.reduce((a, x) => a + x, 0) * 1e6) / 1e6;

/**
 * What these turns cost: the sum of their reported costs, stated only when
 * every turn reported one. A turn that reported none (a driver that does not
 * report cost, a command that left the field out, a turn that failed before
 * it answered) leaves the whole figure unstated — never a zero, never a
 * partial sum read as the channel's cost.
 */
export function turnCost(turns: ReadonlyArray<{ reportedCostUsd?: number }>): TurnCost {
  const costs = turns.flatMap((t) => (t.reportedCostUsd !== undefined ? [t.reportedCostUsd] : []));
  return { turns: turns.length, reported: costs.length, ...(turns.length > 0 && costs.length === turns.length ? { usd: sumUsd(costs) } : {}) };
}

/** What these authoring turns cost: {@link turnCost} over them. */
export function authorCost(turns: ReadonlyArray<{ reportedCostUsd?: number }>): AuthorCost {
  return turnCost(turns);
}

/**
 * How long these turns took: the sum of their wall-clock times by the
 * runner's clock (`elapsedMs`), stated only when every turn was timed. A turn
 * with no process on its record (a replay of a recording made before the
 * runner kept one) leaves the whole figure unstated — never a zero, never a
 * smaller sum.
 */
export function turnTime(turns: ReadonlyArray<{ elapsedMs?: number }>): TurnTime {
  const times = turns.flatMap((t) => (t.elapsedMs !== undefined ? [t.elapsedMs] : []));
  return { turns: turns.length, timed: times.length, ...(turns.length > 0 && times.length === turns.length ? { ms: times.reduce((a, x) => a + x, 0) } : {}) };
}

/** {@link TurnCost} and {@link TurnTime} of persona turns, per the model each was served. */
export function askSpend(turns: readonly TurnSummary[]): AskSpend {
  const byModel = new Map<string, TurnSummary[]>();
  for (const t of turns) {
    const model = t.model ?? MODEL_NOT_REPORTED;
    byModel.set(model, [...(byModel.get(model) ?? []), t]);
  }
  return Object.fromEntries([...byModel].map(([model, ts]) => [model, { cost: turnCost(ts), time: turnTime(ts) }]));
}

/** A mode's authoring turns that ran, build and iterate, in that order. */
const authorTurnsOf = (m: ModeRun): TurnSummary[] => [m.build?.author, m.iterate?.build.author].filter((t): t is TurnSummary => t !== undefined);

/** A mode's persona turns that ran: every question and operation turn (and confirmation turn) of the Run half, then of the iterate's. */
const askTurnsOf = (m: ModeRun): TurnSummary[] => [m.run, m.iterate?.run].flatMap(halfTurnsOf);

/** `$0.42`; `$0.0031` under a cent; `$0`. */
export const usdText = (usd: number): string => (usd === 0 ? '$0' : usd < 0.01 ? `$${Number(usd.toPrecision(2))}` : `$${usd.toFixed(2)}`);

/** `3 author turns`, `1 ask turn`. */
const turnsOf = (n: number, kind: 'author' | 'ask'): string => `${n} ${kind} turn${n === 1 ? '' : 's'}`;

/** `$0.84 over 3 author turns`; `not reported (2 of 3 author turns reported a cost)`; `not reported`. */
const costText = (c: TurnCost, kind: 'author' | 'ask'): string =>
  c.usd !== undefined ? `${usdText(c.usd)} over ${turnsOf(c.turns, kind)}` : c.reported > 0 ? `not reported (${c.reported} of ${turnsOf(c.turns, kind)} reported a cost)` : 'not reported';

/** `25m 10s over 3 author turns`; `2 of 28 ask turns not timed`. */
const timeText = (t: TurnTime, kind: 'author' | 'ask'): string =>
  t.ms !== undefined ? `${elapsedText(t.ms)} over ${turnsOf(t.turns, kind)}` : `${t.turns - t.timed} of ${turnsOf(t.turns, kind)} not timed`;

/**
 * `$0.84 over 3 author turns`; `not reported (2 of 3 author turns reported a
 * cost)`; `not reported`. A record written before the scorecard carried the
 * cost has no {@link AuthorCost}, and reads as not reported.
 */
export function authorCostText(c: AuthorCost | undefined): string {
  return c ? costText(c, 'author') : 'not reported';
}

/** `25m 10s over 3 author turns`; `1 of 3 author turns not timed`; `not recorded` on a record written before the scorecard carried it. */
export function authorTimeText(t: TurnTime | undefined): string {
  return t ? timeText(t, 'author') : 'not recorded';
}

/** The served models of an {@link AskSpend}, most turns first; the model is named unless no turn's stream named one. */
function perModel(s: AskSpend, text: (m: ModelSpend) => string): string {
  const models = Object.entries(s).sort(([an, a], [bn, b]) => b.cost.turns - a.cost.turns || an.localeCompare(bn));
  if (models.length === 1 && models[0]![0] === MODEL_NOT_REPORTED) return text(models[0]![1]);
  return models.map(([name, m]) => `${name === MODEL_NOT_REPORTED ? 'model not reported' : name}: ${text(m)}`).join('; ');
}

/**
 * Per served model: `claude-haiku-5-5: $0.31 over 28 ask turns`;
 * `claude-haiku-5-5: not reported (27 of 28 ask turns reported a cost)`;
 * models joined by `; `. `—` when no persona turn ran; `not recorded` on a
 * record written before the scorecard carried it.
 */
export function askCostText(s: AskSpend | undefined): string {
  if (!s) return 'not recorded';
  return Object.keys(s).length ? perModel(s, (m) => costText(m.cost, 'ask')) : '—';
}

/**
 * Per served model: `claude-haiku-5-5: 6m 12s over 28 ask turns`;
 * `claude-haiku-5-5: 2 of 28 ask turns not timed`; models joined by `; `.
 * `—` when no persona turn ran; `not recorded` on a record written before the
 * scorecard carried it.
 */
export function askTimeText(s: AskSpend | undefined): string {
  if (!s) return 'not recorded';
  return Object.keys(s).length ? perModel(s, (m) => timeText(m.time, 'ask')) : '—';
}

/** An artifact-less build scores 0 of 1 — a degraded build is never "nothing to score". */
const NO_ARTIFACT_TOTAL = 1;

/** One finding per bare item name a build declared, named per item. */
export function bareNameFindings(b: BuildHalf | undefined, half: string): string[] {
  return (b?.score?.naming ?? []).map((c) => `${half}: bare item name ${c.check.slice('bare-name:'.length).replace(':', ' ')} (${c.detail})`);
}

/** One finding per reference cycle a build made required on every side, naming the cycle. */
export function requiredCycleFindings(b: BuildHalf | undefined, half: string): string[] {
  return (b?.requiredCycles ?? []).map(
    (c) => `${half}: the reference cycle ${cycleText(c)} is required on every side, so the seed cannot load it (at least one side of a reference cycle must be optional)`,
  );
}

/** `client_viewer` from the object `demoproject_task` / the field `demoproject_task.estimate_hours`. */
const withheldText = (c: RollupSourceCharge): string => ('object' in c.withheld ? `the object ${c.withheld.object}` : `the field ${c.withheld.field}`);

/**
 * One Build finding per roll-up the build leaves readable over child data the
 * card withholds ({@link BuildHalf.rollupSourceUnreadable}), naming the
 * persona, the roll-up and the withheld child.
 */
export function rollupSourceFindings(b: BuildHalf | undefined, half: string): string[] {
  return (b?.rollupSourceUnreadable ?? []).map(
    (c) =>
      `${half}: the roll-up ${c.rollup} stays readable to ${c.persona} (permission set ${c.permissionSet}) over ${c.child}, while the card withholds ${withheldText(c)} from ${c.persona}: ${c.finding.rule} stands, so ${c.persona} reads an aggregate of what it may not see`,
  );
}

/** The record's evidence for each charged roll-up: a failed check, `rollup-source-unreadable:<persona>:<parent.field>`. */
export function rollupSourceChecks(b: BuildHalf | undefined): CheckResult[] {
  return (b?.rollupSourceUnreadable ?? []).map((c) => ({
    check: `rollup-source-unreadable:${c.persona}:${c.rollup}`,
    pass: false,
    detail: `card withholds ${withheldText(c)}; ${c.finding.where}: ${c.finding.message}`,
  }));
}

export function modeScorecard(m: ModeRun): ModeScorecard {
  const first: HalfScores = {};
  const b = buildTally(m.build, NO_ARTIFACT_TOTAL);
  if (b) first.build = b;
  const sd = seedTally(m.run);
  if (sd) first.seed = sd;
  const a = askTally(m.run);
  if (a) first.ask = a;
  const o = opsTally(m.run);
  if (o) first.operations = o;
  const mt = modelTally(m.run);
  if (mt) first.models = mt;
  const cf = confirmationTally(m.run);
  if (cf) first.confirmation = cf;
  const cw = confirmedWriteTally(m.run);
  if (cw) first.confirmedWrite = cw;
  const gr = guardrailTally(m.run);
  if (gr) first.guardrails = gr;
  const rp = repeatTally(m.run);
  if (rp) first.repeats = rp;
  const ds = datasetTally(m.run);
  if (ds) first.datasets = ds;
  const out: ModeScorecard = {
    mode: m.mode,
    first,
    authorCost: authorCost(authorTurnsOf(m)),
    authorTime: turnTime(authorTurnsOf(m)),
    askSpend: askSpend(askTurnsOf(m)),
    tags: (m.build?.score ?? m.iterate?.build.score)?.tags.map((t) => ({ tag: t.tag, status: t.status })) ?? [],
    findings: [
      ...m.findings,
      ...bareNameFindings(m.build, 'build'),
      ...requiredCycleFindings(m.build, 'build'),
      ...rollupSourceFindings(m.build, 'build'),
      ...buildDenialFindings(m.run, 'build'),
      ...platformNotMeasuredFindings(m.run, 'run'),
      ...bareNameFindings(m.iterate?.build, 'iterate build'),
      ...requiredCycleFindings(m.iterate?.build, 'iterate build'),
      ...rollupSourceFindings(m.iterate?.build, 'iterate build'),
      ...buildDenialFindings(m.iterate?.run, 'iterate build'),
      ...platformNotMeasuredFindings(m.iterate?.run, 'iterate run'),
    ],
  };
  if (m.skipped) out.skipped = m.skipped;
  if (m.mode === 'ask' && m.template) out.supplied = m.template.source;
  if (m.iterate) {
    const it: HalfScores & { changeSize?: number } = {};
    const ib = buildTally(m.iterate.build, NO_ARTIFACT_TOTAL);
    if (ib) it.build = ib;
    const isd = seedTally(m.iterate.run);
    if (isd) it.seed = isd;
    const ia = askTally(m.iterate.run);
    if (ia) it.ask = ia;
    const io = opsTally(m.iterate.run);
    if (io) it.operations = io;
    const imt = modelTally(m.iterate.run);
    if (imt) it.models = imt;
    const icf = confirmationTally(m.iterate.run);
    if (icf) it.confirmation = icf;
    const icw = confirmedWriteTally(m.iterate.run);
    if (icw) it.confirmedWrite = icw;
    const igr = guardrailTally(m.iterate.run);
    if (igr) it.guardrails = igr;
    const irp = repeatTally(m.iterate.run);
    if (irp) it.repeats = irp;
    const ids = datasetTally(m.iterate.run);
    if (ids) it.datasets = ids;
    if (m.iterate.changeSize) it.changeSize = m.iterate.changeSize.total;
    out.iterate = it;
  }
  return out;
}

export function cardScorecard(run: CardRun, packages?: PackageSource): CardScorecard {
  const modes = run.modes.map((m) => modeScorecard(m));
  const halves = modes.flatMap((m) => [m.first.confirmation, m.iterate?.confirmation]);
  const asked = halves.reduce((n, c) => n + (c?.askedFirst ?? 0), 0);
  const confirmed = halves.reduce((n, c) => n + (c?.confirmedByAgent ?? 0), 0);
  const writes = modes.flatMap((m) => [m.first.confirmedWrite, m.iterate?.confirmedWrite]).filter((c): c is ConfirmedWriteTally => c !== undefined);
  const confirmedWrite = writes.length
    ? { passed: writes.reduce((n, c) => n + c.passed, 0), total: writes.reduce((n, c) => n + c.total, 0), notMeasured: writes.reduce((n, c) => n + c.notMeasured, 0) }
    : undefined;
  return {
    card: run.card,
    ...(packages ? { packages } : {}),
    counts: run.counts,
    authorCost: authorCost(run.modes.flatMap(authorTurnsOf)),
    authorTime: turnTime(run.modes.flatMap(authorTurnsOf)),
    askSpend: askSpend(run.modes.flatMap(askTurnsOf)),
    ...(asked + confirmed > 0 ? { confirmation: { askedFirst: asked, confirmedByAgent: confirmed } } : {}),
    ...(confirmedWrite ? { confirmedWrite } : {}),
    ...(run.askRepeats !== undefined && run.askRepeats > 1 ? { askRepeats: run.askRepeats } : {}),
    ...(run.promptChoice !== undefined ? { promptChoice: run.promptChoice } : {}),
    modes,
  };
}

const cell = (t: (Tally & { notMeasured?: number; platformNotMeasured?: number; restored?: number }) | undefined) =>
  t
    ? `${t.passed}/${t.total}${t.notMeasured ? ` · ${t.notMeasured} not measured` : ''}${t.platformNotMeasured ? ` · ${t.platformNotMeasured} platform half not measured` : ''}${t.restored ? ` · ${t.restored} started from restored rows` : ''}`
    : '—';
/** `1 asked first · 1 confirmed by the agent`: how the passing irreversible operations were met. */
const confirmationText = (c: ConfirmationTally): string => `${c.askedFirst} asked first · ${c.confirmedByAgent} confirmed by the agent`;
/** `confirmed write 1/1`; `confirmed write 0/0 · 1 not measured`: the writes after the person confirmed ({@link ConfirmedWriteTally}). */
const confirmedWriteText = (c: ConfirmedWriteTally): string => `confirmed write ${cell(c)}`;
const opsCell = (h: HalfScores | undefined) =>
  `${cell(h?.operations)}${h?.confirmation ? ` (irreversible: ${confirmationText(h.confirmation)}${h.confirmedWrite ? ` · ${confirmedWriteText(h.confirmedWrite)}` : ''})` : ''}`;
const seedCell = (s: HalfScores['seed']) => (s ? `${s.inserted}/${s.total}${s.refused ? ` ⚠ seed: ${s.refused} refused` : ''}` : '—');

/** `42s`, `15m 00s`. */
export const elapsedText = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

const buildCell = (b: HalfScores['build']) =>
  !b ? '—' : b.notMeasuredReason ? `not measured: ${b.notMeasuredReason}` : `${cell(b)}${b.degraded ? ' ⚠ degraded' : ''}${b.failedCommands.length ? ` (failed: ${b.failedCommands.join(', ')})` : ''}`;
/** `300/300 turns`; `?/300 turns` when no result line reported a count; `17 turns` on a recording without the cap; nothing when neither is known. */
const turnsText = (a: { numTurns?: number; maxTurns?: number }): string | undefined =>
  a.maxTurns !== undefined ? `${a.numTurns ?? '?'}/${a.maxTurns} turns` : a.numTurns !== undefined ? `${a.numTurns} turn${a.numTurns === 1 ? '' : 's'}` : undefined;
/** `claude-opus-5-5`; `claude-opus-5-5 ⚠ asked for sonnet`; `model not reported (asked for sonnet)`; nothing when neither is known. */
const servedText = (a: { model?: string; requestedModel?: string; modelMismatch?: true }): string | undefined =>
  a.model
    ? `${a.model}${a.modelMismatch ? ` ⚠ asked for ${a.requestedModel}` : ''}`
    : a.requestedModel
      ? `model not reported (asked for ${a.requestedModel})`
      : undefined;
/** `effort high`; `effort low / high` when a half's turns asked for more than one; nothing when none asked for any. */
const effortText = (efforts: readonly string[]): string | undefined => (efforts.length ? `effort ${efforts.join(' / ')}` : undefined);
const authorCell = (b: HalfScores['build']) =>
  b?.author
    ? [
        b.author.resultSubtype ?? '(no result)',
        turnsText(b.author),
        b.author.elapsedMs !== undefined ? elapsedText(b.author.elapsedMs) : 'elapsed not recorded',
        servedText(b.author),
        effortText(b.author.requestedEffort ? [b.author.requestedEffort] : []),
      ]
        .filter(Boolean)
        .join(' · ')
    : '—';
/**
 * `claude-sonnet-4-5 ×20, claude-opus-5-5 ×4 ⚠ 4 not sonnet · effort medium`;
 * `—` when no turn named a model and none asked for a model or an effort.
 */
const modelCell = (t: ModelTally | undefined): string => {
  if (!t) return '—';
  const efforts = t.requestedEfforts;
  const served = Object.entries(t.served).sort(([an, a], [bn, b]) => b - a || an.localeCompare(bn));
  if (t.requested.length === 0 && efforts.length === 0 && served.every(([name]) => name === MODEL_NOT_REPORTED)) return '—';
  const effort = effortText(efforts);
  return `${served.map(([name, n]) => `${name} ×${n}`).join(', ')}${t.mismatched ? ` ⚠ ${t.mismatched} not ${t.requested.join(' / ')}` : ''}${effort ? ` · ${effort}` : ''}`;
};

/** `guardrail:injection_as_data pass`; `guardrail:injection_as_data not measured: no turn read …`; checks joined by ` · `; `—` when the half carries none. */
const guardrailCell = (g: readonly GuardrailVerdict[] | undefined): string =>
  g?.length ? g.map((v) => `${v.check} ${v.verdict}${v.reason !== undefined ? `: ${v.reason}` : ''}`).join(' · ') : '—';

/** `` `account_count` as sdr ``; `` `account_count` `` when asked with no persona. */
const turnLabel = (t: { question: string; persona: string | null }): string => `\`${t.question}\`${t.persona !== null ? ` as ${t.persona}` : ''}`;

/** `3/3`; `1/2 · 1 not measured ⚠ 1 leaking`: one question turn's asks, as the Run-问数 cell states a half. */
const repeatCell = (t: QuestionRepeats | undefined): string => (t ? `${cell(t)}${t.leaks ? ` ⚠ ${t.leaks} leaking` : ''}` : '—');

/**
 * The k/N table: one row per (question, persona) turn, one column per Run
 * half that asked its turns more than once ({@link HalfScores.repeats}).
 * Nothing when no half did.
 */
function repeatTable(sc: CardScorecard): string[] {
  const halves = sc.modes.flatMap((m) =>
    m.skipped
      ? []
      : [
          ...(m.first.repeats ? [{ label: `${m.mode} · Run`, repeats: m.first.repeats }] : []),
          ...(m.iterate?.repeats ? [{ label: `${m.mode} · Iterate`, repeats: m.iterate.repeats }] : []),
        ],
  );
  if (halves.length === 0) return [];
  const key = (t: { question: string; persona: string | null }) => JSON.stringify([t.question, t.persona]);
  const turns = new Map<string, { question: string; persona: string | null }>();
  for (const h of halves) for (const t of h.repeats) if (!turns.has(key(t))) turns.set(key(t), { question: t.question, persona: t.persona });
  return [
    '',
    `| Question turn (k/N${sc.askRepeats !== undefined ? `, N = ${sc.askRepeats} asks` : ''}) | ${halves.map((h) => h.label).join(' | ')} |`,
    `|:---|${halves.map(() => ':---').join('|')}|`,
    ...[...turns].map(([k, t]) => `| ${turnLabel(t)} | ${halves.map((h) => repeatCell(h.repeats.find((x) => key(x) === k))).join(' | ')} |`),
  ];
}

/** What a supplied build's Build cells and an ask mode's author rows read: it authored nothing, and nothing of it was scored. */
const SUPPLIED_BUILD = 'supplied';
const NO_AUTHORING_TURNS = 'no authoring turns';

/** Did every mode that ran run on a supplied build ({@link ModeScorecard.supplied}): then the card authored nothing either. */
const suppliedOnly = (sc: CardScorecard): boolean => sc.modes.some((m) => m.supplied !== undefined) && sc.modes.every((m) => m.supplied !== undefined || m.skipped !== undefined);

/** `2/4 (metric-selected 1/2 · asked-back 1/1 · fallback-labelled 0/1)`: a half's dataset questions, then each grader's. */
const datasetCell = (t: HalfScores['datasets']): string =>
  t
    ? `${cell(t)}${Object.keys(t.byGrader).length ? ` (${(Object.values(DATASET_GRADERS) as DatasetGrader[]).flatMap((g) => (t.byGrader[g] ? [`${g} ${t.byGrader[g]!.passed}/${t.byGrader[g]!.total}`] : [])).join(' · ')})` : ''}`
    : '—';

/** The scorecard as a markdown table: the modes side by side, one row per half. */
export function renderScorecard(sc: CardScorecard): string {
  const noAuthoring = suppliedOnly(sc);
  const lines = [
    `### \`${sc.card}\` — ${sc.counts.questions} questions (${sc.counts.questionTurns} persona turns${sc.askRepeats !== undefined && sc.askRepeats > 1 ? `, each asked ${sc.askRepeats} times` : ''}), ${sc.counts.operations} operations, ${sc.counts.personas} personas`,
    '',
    ...(sc.packages ? [packagesLine(sc.packages), ''] : []),
    ...(sc.promptChoice ? [`prompts: ${promptChoiceText(sc.promptChoice)}`, ''] : []),
    `author cost: ${noAuthoring ? NO_AUTHORING_TURNS : authorCostText(sc.authorCost)}`,
    `author time: ${noAuthoring ? NO_AUTHORING_TURNS : authorTimeText(sc.authorTime)}`,
    `ask cost: ${askCostText(sc.askSpend)}`,
    `ask time: ${askTimeText(sc.askSpend)}`,
    '',
    ...(sc.confirmation ? [`irreversible operations: ${confirmationText(sc.confirmation)} (accepted until real human confirmation lands)`, ''] : []),
    ...(sc.confirmedWrite ? [`irreversible operations, the write after the person confirmed: ${cell(sc.confirmedWrite)} (graded apart from the ask, and in the operations score)`, ''] : []),
    `| Half | ${sc.modes.map((m) => m.mode).join(' | ')} |`,
    `|:---|${sc.modes.map(() => ':---').join('|')}|`,
  ];
  const row = (label: string, f: (m: ModeScorecard) => string) => lines.push(`| ${label} | ${sc.modes.map((m) => (m.skipped ? `skipped` : f(m))).join(' | ')} |`);
  row('Build', (m) => (m.supplied !== undefined ? SUPPLIED_BUILD : buildCell(m.first.build)));
  row('Build · author', (m) => (m.supplied !== undefined ? SUPPLIED_BUILD : authorCell(m.first.build)));
  row('Seed', (m) => seedCell(m.first.seed));
  row('Run-问数', (m) => (m.first.ask ? `${cell(m.first.ask)}${m.first.ask.leaks ? ` ⚠ ${m.first.ask.leaks} leaking` : ''}` : '—'));
  row('Run-operations', (m) => opsCell(m.first));
  row('Run · model', (m) => modelCell(m.first.models));
  if (sc.modes.some((m) => !m.skipped && m.first.guardrails)) row('Run · guardrails', (m) => guardrailCell(m.first.guardrails));
  if (sc.modes.some((m) => !m.skipped && m.first.datasets)) row('Run · datasets', (m) => datasetCell(m.first.datasets));
  row('Iterate · Build', (m) => buildCell(m.iterate?.build));
  row('Iterate · author', (m) => authorCell(m.iterate?.build));
  row('Iterate · Seed', (m) => seedCell(m.iterate?.seed));
  row('Iterate · Run-问数', (m) => (m.iterate?.ask ? `${cell(m.iterate.ask)}${m.iterate.ask.leaks ? ` ⚠ ${m.iterate.ask.leaks} leaking` : ''}` : '—'));
  row('Iterate · Run-operations', (m) => opsCell(m.iterate));
  row('Iterate · Run · model', (m) => modelCell(m.iterate?.models));
  if (sc.modes.some((m) => !m.skipped && m.iterate?.guardrails)) row('Iterate · Run · guardrails', (m) => guardrailCell(m.iterate?.guardrails));
  if (sc.modes.some((m) => !m.skipped && m.iterate?.datasets)) row('Iterate · Run · datasets', (m) => datasetCell(m.iterate?.datasets));
  row('AI change size (items)', (m) => (m.iterate?.changeSize !== undefined ? String(m.iterate.changeSize) : '—'));
  row('Author cost', (m) => (m.supplied !== undefined ? NO_AUTHORING_TURNS : m.authorCost === undefined || m.authorCost.turns > 0 ? authorCostText(m.authorCost) : '—'));
  row('Author time', (m) => (m.supplied !== undefined ? NO_AUTHORING_TURNS : m.authorTime === undefined || m.authorTime.turns > 0 ? authorTimeText(m.authorTime) : '—'));
  row('Ask cost', (m) => askCostText(m.askSpend));
  row('Ask time', (m) => askTimeText(m.askSpend));
  lines.push(...repeatTable(sc));
  const tags = sc.modes.find((m) => m.tags.length)?.tags ?? [];
  if (tags.length) {
    lines.push('', '| Tag | ' + sc.modes.map((m) => m.mode).join(' | ') + ' |', '|:---|' + sc.modes.map(() => ':---').join('|') + '|');
    for (const t of tags) lines.push(`| \`${t.tag}\` | ${sc.modes.map((m) => m.tags.find((x) => x.tag === t.tag)?.status ?? '—').join(' | ')} |`);
  }
  for (const m of sc.modes) {
    if (m.skipped) lines.push('', `- ${m.mode}: skipped — ${m.skipped}`);
    if (m.supplied !== undefined) lines.push('', `- ${m.mode}: the build is supplied (${m.supplied}), installed as it is; it is not scored, and no authoring turn ran`);
    for (const f of m.findings) lines.push(`- ${m.mode} finding: ${f}`);
  }
  return lines.join('\n');
}

// ── The run record (docs/qa/platform-checklist/runs/README.md shape) ────────

type Verdict = 'pass' | 'partial' | 'fail' | 'blocked' | 'not-run';

const verdictOf = (t: Tally | undefined, error?: string): Verdict =>
  error && !t ? 'blocked' : !t ? 'not-run' : t.total === 0 ? 'not-run' : t.passed === t.total ? 'pass' : t.passed === 0 ? 'fail' : 'partial';

export interface RunRecordMeta {
  run: string;
  date: string;
  framework?: string;
  /** Where the run's `@objectstack/*` packages came from — every record states it (`env.packages`). */
  packages: PackageSource;
  driver: DriverInfo;
  runner: string;
  evidenceDir: string;
}

export function runRecord(meta: RunRecordMeta, cardRun: CardRun): Record<string, unknown> {
  const sc = cardScorecard(cardRun, meta.packages);
  const results: Array<Record<string, unknown>> = [];
  for (const m of cardRun.modes) {
    const s = sc.modes.find((x) => x.mode === m.mode)!;
    // A half that never ran because the build before it was not measured says so.
    const firstOut = m.build?.notMeasured ? `not run: the build was not measured (${m.build.notMeasured})` : undefined;
    // An ask mode authors nothing: its Build half is the supplied build's, never scored, and it has no iterate.
    const supplied = s.supplied !== undefined ? `${SUPPLIED_BUILD} (${s.supplied}): not scored` : undefined;
    const noIterate = m.mode === 'ask' ? 'not run: ask mode authors no iterate' : undefined;
    const iterateOut = firstOut ?? noIterate ?? (m.iterate?.build.notMeasured ? `not run: the iterate build was not measured (${m.iterate.build.notMeasured})` : undefined);
    const buildNote = (b: HalfScores['build']) => supplied ?? (b?.notMeasuredReason ? `not measured: ${b.notMeasuredReason}` : b ? cell(b) : '');
    const halves: Array<[string, Tally | undefined, string | undefined, unknown[], string]> = [
      ['build', s.first.build, m.build?.error, m.build?.score ? [...m.build.score.expect.checks, ...m.build.score.tags.flatMap((t) => t.checks), ...m.build.score.agentActions, ...m.build.score.personaGrants, ...m.build.score.naming, ...rollupSourceChecks(m.build)] : rollupSourceChecks(m.build), buildNote(s.first.build)],
      ['run-ask', s.first.ask, m.run?.error, m.run?.questions ?? [], s.first.ask ? cell(s.first.ask) : (firstOut ?? '')],
      ['run-operations', s.first.operations, m.run?.error, m.run?.operations ?? [], s.first.operations ? cell(s.first.operations) : (firstOut ?? '')],
      // Only a card that declares dataset questions has this half: every other record keeps its results.
      ...(m.run?.datasetQuestions ? [['run-datasets', s.first.datasets, m.run.error, m.run.datasetQuestions, datasetCell(s.first.datasets)] as [string, Tally | undefined, string | undefined, unknown[], string]] : []),
      ['iterate-build', s.iterate?.build, m.iterate?.build.error, m.iterate?.build.score ? [...m.iterate.build.score.expect.checks, ...m.iterate.build.score.naming, ...rollupSourceChecks(m.iterate.build)] : rollupSourceChecks(m.iterate?.build), s.iterate?.build ? buildNote(s.iterate.build) : (firstOut ?? noIterate ?? '')],
      ['iterate-run-ask', s.iterate?.ask, m.iterate?.run?.error, m.iterate?.run?.questions ?? [], s.iterate?.ask ? cell(s.iterate.ask) : (iterateOut ?? '')],
      ['iterate-run-operations', s.iterate?.operations, m.iterate?.run?.error, m.iterate?.run?.operations ?? [], s.iterate?.operations ? cell(s.iterate.operations) : (iterateOut ?? '')],
    ];
    for (const [half, tally, error, evidence, note] of halves) {
      results.push({
        id: `${cardRun.card}.${m.mode}.${half}`,
        verdict: m.skipped ? 'not-run' : verdictOf(tally, error),
        clauses: evidence.map((e, i) => ({ clause: i, evidence: e })),
        issues: [],
        notes: [note, error ?? '', m.skipped ?? ''].filter(Boolean).join(' · '),
      });
    }
  }
  return {
    run: meta.run,
    date: meta.date,
    scope: `scenario card ${cardRun.card}`,
    app: cardRun.card,
    env: { framework: meta.framework ?? 'unknown', packages: meta.packages, packagesLine: packagesLine(meta.packages), driver: meta.driver },
    runner: meta.runner,
    evidenceDir: meta.evidenceDir,
    results,
    scorecard: sc,
    cardRun,
  };
}
