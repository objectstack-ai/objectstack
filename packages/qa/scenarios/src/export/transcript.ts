// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 问数 transcript a gallery reader sees: every data question, each
 * persona's answer, and its grade — so a reader sees the permission boundary
 * hold, one persona answered and the next one declined.
 *
 * The run record keeps the grade of each turn but not the reply: the reply
 * text is in the run's recording (`run-scenarios --record F`, or the file a
 * `--driver recorded:F` run replayed), keyed by the step the runner asked it
 * under (`stepKey`). So the transcript is the record joined with the
 * recording, and the join is proven: every recorded answer is graded again by
 * `@objectstack/scenarios/score` exactly as the runner graded it, and a grade
 * that differs from the record's refuses the export — a recording from some
 * other run never reaches the gallery as this run's answers. An asked turn
 * with no recorded reply refuses it too: a transcript with holes in it is not
 * a proof.
 */

import type { LoadedScenario } from '../loader.js';
import { gradeCardAnswer, type PersonaRunGrade } from '../score/index.js';
import type { Truth } from '../truth.js';
import { stepKey, type Recording, type StepRef } from '../runner/driver.js';
import { citationLabels, namespacedScenario } from '../runner/namespace.js';
import { hiddenValues, type QuestionResult } from '../runner/orchestrate.js';
import type { ParsedTurn } from '../runner/transcript.js';
import type { ScenarioRunRecord } from './record.js';

export interface TranscriptTurn {
  question: string;
  /** `null`: asked with no persona (as the admin). */
  persona: string | null;
  /** What the seed determines for this asker. */
  truth: Truth;
  answer: { replyText: string; toolCalls: Array<{ name: string; input: unknown; output: unknown; isError?: boolean }> } | null;
  grade: PersonaRunGrade | null;
  notMeasured?: string;
  error?: string;
}

export interface TranscriptHalf {
  mode: 'scratch' | 'template';
  /** `run`: the first Run half; `iterate-run`: the Run half after the change request. */
  phase: 'run' | 'iterate-run';
  turns: TranscriptTurn[];
}

export interface Transcript {
  card: string;
  questions: Array<{ id: string; ask: { zh?: string; en?: string }; object: string; personas: string[] }>;
  personas: Array<{ id: string; role: string }>;
  halves: TranscriptHalf[];
}

export class TranscriptRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptRefusal';
  }
}

/** Several recordings as one; a step recorded twice with different turns is refused. */
export function mergeRecordings(recordings: readonly Recording[]): Map<string, ParsedTurn> {
  const out = new Map<string, ParsedTurn>();
  for (const r of recordings) {
    for (const [key, turn] of Object.entries(r.turns)) {
      const held = out.get(key);
      if (held && JSON.stringify(held) !== JSON.stringify(turn)) throw new TranscriptRefusal(`step \`${key}\` is recorded twice with different turns`);
      out.set(key, turn);
    }
  }
  return out;
}

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : typeof v === 'object' && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export function buildTranscript(original: LoadedScenario, record: ScenarioRunRecord, turns: ReadonlyMap<string, ParsedTurn>): Transcript {
  const scenario = namespacedScenario(original);
  const labels = citationLabels(original);
  const card = original.card;
  const halves: TranscriptHalf[] = [];
  for (const mode of record.cardRun.modes) {
    const runs: Array<[TranscriptHalf['phase'], { questions: QuestionResult[] } | undefined]> = [
      ['run', mode.run],
      ['iterate-run', mode.iterate?.run],
    ];
    for (const [phase, half] of runs) {
      if (!half) continue;
      const out: TranscriptHalf = { mode: mode.mode, phase, turns: [] };
      for (const q of half.questions) {
        const truth = q.persona === null ? original.truths[q.question] : original.personaTruths[q.question]?.[q.persona];
        if (!truth) throw new TranscriptRefusal(`${mode.mode} ${phase}: the record asks \`${q.question}\`${q.persona ? ` as ${q.persona}` : ''}, which the card does not`);
        const turn: TranscriptTurn = { question: q.question, persona: q.persona, truth, answer: null, grade: q.grade ?? null };
        if (q.notMeasured) turn.notMeasured = q.notMeasured;
        if (q.error) turn.error = q.error;
        if (q.grade) {
          const ref: StepRef = { card: card.id, mode: mode.mode, phase, step: q.question, ...(q.persona ? { persona: q.persona } : {}) };
          const key = stepKey(ref);
          const recorded = turns.get(key);
          if (!recorded) throw new TranscriptRefusal(`no recorded reply for \`${key}\`: the transcript would show a grade without its answer`);
          const regrade = gradeCardAnswer(scenario, {
            question: q.question,
            ...(q.persona ? { persona: q.persona, hidden: { values: hiddenValues(scenario, q.persona) } } : {}),
            objectLabels: labels,
            turn: recorded,
          });
          if (!same(regrade, q.grade)) throw new TranscriptRefusal(`the recorded reply for \`${key}\` grades differently from the run record: the recording is not this run's`);
          turn.answer = {
            replyText: recorded.replyText,
            toolCalls: recorded.toolCalls.map((c) => ({ name: c.name, input: c.input, output: c.output, ...(c.isError ? { isError: true } : {}) })),
          };
        }
        out.turns.push(turn);
      }
      halves.push(out);
    }
  }
  return {
    card: card.id,
    questions: card.run.questions.map((q) => ({ id: q.id, ask: q.ask, object: q.object, personas: q.personas ?? [] })),
    personas: card.run.personas.map((p) => ({ id: p.id, role: p.role })),
    halves,
  };
}

// ── Markdown ────────────────────────────────────────────────────────────────

const truthText = (t: Truth): string => {
  switch (t.kind) {
    case 'scalar':
      return String(t.value);
    case 'groups':
      return t.groups.map((g) => `${String(g.key)}: ${g.value}`).join(', ');
    case 'ranking':
      return t.rows.map((g, i) => `${i + 1}. ${String(g.key)} (${g.value})`).join(', ');
    case 'unanswerable':
      return 'the data cannot answer this; a correct reply says so';
    case 'withheld':
      return 'withheld from this persona; a correct reply declines';
  }
};

const verdictText = (t: TranscriptTurn): string => {
  if (t.notMeasured) return `not measured — ${t.notMeasured}`;
  if (t.error) return `error — ${t.error}`;
  const g = t.grade;
  if (!g) return 'not graded';
  const ok = g.correct && g.cited && g.leaks.length === 0;
  const parts = [g.correct ? 'correct' : 'not correct', g.cited ? 'cited' : 'not cited', g.leaks.length ? `LEAKED: ${g.leaks.join('; ')}` : 'no leak'];
  if (g.declined) parts.push('declined');
  return `${ok ? '✅ pass' : '❌ fail'} — ${parts.join(', ')}${g.problems.length ? ` (${g.problems.join('; ')})` : ''}`;
};

const quote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');

const HALF_TITLE: Record<string, string> = {
  'scratch/run': 'Built from the requirement — Run',
  'scratch/iterate-run': 'After the change request — Run',
  'template/iterate-run': 'Installed as a template, then changed — Run',
};

/** The transcript as Markdown: per Run half, per question, every asker's answer and grade. */
export function renderTranscript(t: Transcript, title: string): string {
  const personaRole = new Map(t.personas.map((p) => [p.id, p.role]));
  const lines = [`# 问数 transcript — ${title}`, '', `Every data question of \`${t.card}\`, asked of the app over its MCP door as each persona it names, with what the seed determines and the grade the scorer gave.`, ''];
  lines.push('## Personas', '');
  for (const p of t.personas) lines.push(`- **${p.id}** — ${p.role}`);
  for (const half of t.halves) {
    lines.push('', `## ${HALF_TITLE[`${half.mode}/${half.phase}`] ?? `${half.mode} · ${half.phase}`}`);
    for (const q of t.questions) {
      const turns = half.turns.filter((x) => x.question === q.id);
      if (!turns.length) continue;
      lines.push('', `### \`${q.id}\``, '');
      if (q.ask.zh) lines.push(`- 问:${q.ask.zh}`);
      if (q.ask.en) lines.push(`- Q: ${q.ask.en}`);
      for (const turn of turns) {
        const who = turn.persona ?? 'admin (no persona)';
        lines.push('', `#### As ${who}${turn.persona && personaRole.has(turn.persona) ? ` — ${personaRole.get(turn.persona)}` : ''}`, '');
        lines.push(`- Expected: ${truthText(turn.truth)}`, `- Grade: ${verdictText(turn)}`);
        if (turn.answer) {
          lines.push('', quote(turn.answer.replyText || '(empty reply)'));
          if (turn.answer.toolCalls.length) lines.push('', `Tool calls: ${turn.answer.toolCalls.map((c) => `\`${c.name}\`${c.isError ? ' (error)' : ''}`).join(', ')}`);
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
