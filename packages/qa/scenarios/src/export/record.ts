// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The run records the local runner writes (`run-scenarios --out DIR`, one
 * `<date>-scenario-<card>.json` per card and day, `runner/scorecard.ts`
 * `runRecord`), read back for the gallery exporter.
 *
 * Only what the exporter reads is checked, and checked loudly: a file that
 * says it is a scenario-runner record and does not parse stops the whole
 * export before anything in the output is touched. Every other key passes
 * through (`looseObject`), and the record is written to the gallery from the
 * file as it was read, never from this parse.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { CardRun } from '../runner/orchestrate.js';

/** The verdict of one half, as `runRecord` writes it. */
export const VerdictSchema = z.enum(['pass', 'partial', 'fail', 'blocked', 'not-run']);
export type Verdict = z.infer<typeof VerdictSchema>;

const QuestionResultSchema = z.looseObject({
  question: z.string().min(1),
  persona: z.string().min(1).nullable(),
  notMeasured: z.string().optional(),
  grade: z.looseObject({ correct: z.boolean(), cited: z.boolean(), leaks: z.array(z.string()) }).optional(),
  error: z.string().optional(),
});

const RunHalfSchema = z.looseObject({ questions: z.array(QuestionResultSchema) });

const ModeRunSchema = z.looseObject({
  mode: z.enum(['scratch', 'template']),
  run: RunHalfSchema.optional(),
  iterate: z.looseObject({ run: RunHalfSchema.optional() }).optional(),
  skipped: z.string().optional(),
});

/** The part of a run record the exporter reads. */
export const ScenarioRunRecordSchema = z.looseObject({
  run: z.string().min(1),
  date: z.iso.date(),
  app: z.string().min(1),
  runner: z.literal('scenario-runner'),
  env: z.looseObject({ framework: z.string().min(1), driver: z.looseObject({ driver: z.string().min(1) }) }),
  evidenceDir: z.string().min(1),
  results: z.array(z.looseObject({ id: z.string().min(1), verdict: VerdictSchema })),
  scorecard: z.looseObject({ card: z.string().min(1), modes: z.array(z.unknown()) }),
  cardRun: z.looseObject({
    card: z.string().min(1),
    counts: z.strictObject({ questions: z.number().int(), questionTurns: z.number().int(), operations: z.number().int(), personas: z.number().int() }),
    modes: z.array(ModeRunSchema).min(1),
  }),
});

export interface ScenarioRunRecord extends z.infer<typeof ScenarioRunRecordSchema> {
  cardRun: z.infer<typeof ScenarioRunRecordSchema>['cardRun'] & CardRun;
}

/** One record file, parsed, with the bytes it was read from. */
export interface RecordFile {
  file: string;
  record: ScenarioRunRecord;
  /** The file's JSON as read — what the gallery receives (less the work directory, see `redactWorkDir`). */
  raw: unknown;
}

export interface ReadRecordsResult {
  /** The newest record of each card, by `date` (then by file name, so a tie is still decided one way). */
  newest: Map<string, RecordFile>;
  /** JSON files in the directory that are not scenario-runner records (platform-checklist runs, …). */
  ignored: string[];
}

export class RunRecordError extends Error {
  constructor(file: string, detail: string) {
    super(`${file}: not a readable scenario run record: ${detail}`);
    this.name = 'RunRecordError';
  }
}

/** Read every `*.json` in `runsDir` (not recursive); refuse the whole directory on one unreadable scenario record. */
export function readRunRecords(runsDir: string): ReadRecordsResult {
  const newest = new Map<string, RecordFile>();
  const ignored: string[] = [];
  const files = readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();
  for (const name of files) {
    const file = join(runsDir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new RunRecordError(file, e instanceof Error ? e.message : String(e));
    }
    if ((raw as { runner?: unknown } | null)?.runner !== 'scenario-runner') {
      ignored.push(file);
      continue;
    }
    const parsed = ScenarioRunRecordSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0]!;
      throw new RunRecordError(file, `${first.path.join('.') || '(root)'}: ${first.message}`);
    }
    const record = parsed.data as ScenarioRunRecord;
    if (record.cardRun.card !== record.app) throw new RunRecordError(file, `\`app\` is \`${record.app}\` but \`cardRun.card\` is \`${record.cardRun.card}\``);
    const held = newest.get(record.app);
    // Files are visited in name order, so on an equal date the later name wins.
    if (!held || record.date >= held.record.date) newest.set(record.app, { file, record, raw });
  }
  return { newest, ignored };
}

/** Every string in `value` with the run's local work directory replaced by `$WORK`: a local path is not gallery content. */
export function redactWorkDir<T>(value: T, workDir: string): T {
  if (workDir.replace(/\/+$/, '') === '') return value; // `/` names no run of its own
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.split(workDir).join('$WORK');
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
