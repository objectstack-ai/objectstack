// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One card, end to end, in up to two modes:
 *
 *   scratch   scaffold → the agent builds from the card prompt → `os validate`,
 *             `os build`, `os verify` (opt-in proofs from the tags) → score the
 *             artifact → boot, seed, one user + key per persona → the Run half
 *             (every question as every persona it names, every operation as
 *             its persona, each over the app's own MCP) → the iterate change →
 *             rebuild + re-score Build, and (unless disabled) re-run the Run half.
 *   template  scaffold a blank project → boot → install a VERIFIED build of the
 *             same card unmanaged (ADR-0131 D6) → the agent applies the iterate
 *             change to the installed copy → score it → seed → the Run half.
 *             A refused install (`UNCOPYABLE`, …) is a finding, recorded and
 *             never worked around.
 *
 * Scoring is `@objectstack/scenarios/score` (ruling D on #30291) and nothing
 * else; this module only gathers what the graders take.
 */

import { applyExpectDelta, type LoadedScenario } from '../loader.js';
import {
  gradeCardAnswer,
  gradeCardOperation,
  scoreCardArtifact,
  type OperationGrade,
  type OperationObservation,
  type PersonaRunGrade,
  type ScenarioArtifactScore,
} from '../score/index.js';
import type { AppHarness, PersonaAccount } from './app.js';
import type { AgentDriver, StepRef } from './driver.js';
import { observeOperation, touchedRowId, type Row } from './observe.js';
import type { CommandResult } from './project.js';
import { buildPrompt, iteratePrompt, operationPrompt, personaHandles, questionPrompt, templateIteratePrompt, verifyFlags } from './prompts.js';
import type { ParsedTurn } from './transcript.js';

// ── What the orchestrator needs from the outside world ──────────────────────

export interface BootedApp {
  url: string;
  stop(): Promise<void>;
  log(): string;
}

export interface ProjectOps {
  scaffold(name: string): Promise<{ dir: string; result: CommandResult }>;
  os(dir: string, args: readonly string[]): Promise<CommandResult>;
  readArtifact(dir: string): unknown | undefined;
  boot(dir: string): Promise<BootedApp>;
  harness(url: string): AppHarness;
}

export interface RunOptions {
  modes: ReadonlyArray<'scratch' | 'template'>;
  /** Re-run the Run half after the iterate (scratch mode). Default true. */
  iterateRun?: boolean;
  /** A verified build to install in template mode (e.g. the gallery's last passing export). */
  templateArtifact?: unknown;
  /** The dev admin the runner signs in as (`os dev --fresh` seeds it). */
  admin: { email: string; password: string };
}

// ── The record of one card ──────────────────────────────────────────────────

export interface TurnSummary {
  resultSubtype?: string;
  numTurns?: number;
  toolCalls: number;
  model?: string;
}

export interface BuildHalf {
  commands: CommandResult[];
  author?: TurnSummary;
  /** `null` when there is no artifact to score (a build that never produced one). */
  score: ScenarioArtifactScore | null;
  error?: string;
}

export interface QuestionResult {
  question: string;
  persona: string | null;
  grade?: PersonaRunGrade;
  turn?: TurnSummary;
  error?: string;
}

export interface OperationResult {
  operation: string;
  persona: string;
  observation?: OperationObservation;
  grade?: OperationGrade;
  turn?: TurnSummary;
  error?: string;
}

export interface RunHalf {
  personas: Array<Omit<PersonaAccount, 'apiKey'>>;
  seed: { inserted: number; refused: Array<{ object: string; id: string; code?: string; message?: string }> };
  questions: QuestionResult[];
  operations: OperationResult[];
  error?: string;
}

export interface ChangeSize {
  added: string[];
  removed: string[];
  changed: string[];
  /** added + removed + changed metadata items. */
  total: number;
}

export interface ModeRun {
  mode: 'scratch' | 'template';
  build?: BuildHalf;
  run?: RunHalf;
  iterate?: { build: BuildHalf; run?: RunHalf; changeSize?: ChangeSize };
  template?: { source: string; install: { ok: boolean; status: number; code?: string; message?: string }; installModesSupplied: boolean };
  skipped?: string;
  findings: string[];
}

export interface CardRun {
  card: string;
  title: string;
  capabilities: string[];
  counts: { questions: number; questionTurns: number; operations: number; personas: number };
  modes: ModeRun[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const summarize = (t: ParsedTurn): TurnSummary => ({
  ...(t.meta.resultSubtype ? { resultSubtype: t.meta.resultSubtype } : {}),
  ...(t.meta.numTurns !== undefined ? { numTurns: t.meta.numTurns } : {}),
  ...(t.meta.model ? { model: t.meta.model } : {}),
  toolCalls: t.toolCalls.length,
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 2000);

/** The card with its iterate delta applied to `expect` — what the post-iterate build is scored against. */
export function iteratedScenario(scenario: LoadedScenario): LoadedScenario {
  return { ...scenario, card: { ...scenario.card, expect: applyExpectDelta(scenario.card.expect, scenario.card.iterate.expectDelta) } };
}

/** The named metadata items of an artifact, `collection/name` → canonical JSON. */
export function metadataItems(artifact: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof artifact !== 'object' || artifact === null) return out;
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : typeof v === 'object' && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  for (const [key, value] of Object.entries(artifact as Record<string, unknown>)) {
    if (!Array.isArray(value) || key === 'plugins' || key === 'requires') continue;
    for (const item of value) {
      const name = typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : undefined;
      if (typeof name === 'string') out.set(`${key}/${name}`, JSON.stringify(canon(item)));
    }
  }
  return out;
}

/** The size of the change between two artifacts, in metadata items. */
export function changeSize(before: unknown, after: unknown): ChangeSize {
  const a = metadataItems(before);
  const b = metadataItems(after);
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).sort();
  return { added, removed, changed, total: added.length + removed.length + changed.length };
}

/** Seed objects in lookup order: a row's lookup target is inserted before it. */
export function seedOrder(scenario: LoadedScenario): string[] {
  const { seed } = scenario.card.run;
  const deps = new Map<string, Set<string>>();
  for (const o of Object.keys(seed)) deps.set(o, new Set());
  for (const l of scenario.card.expect.lookups ?? []) if (l.object !== l.to && deps.has(l.object) && deps.has(l.to)) deps.get(l.object)!.add(l.to);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (o: string, stack: Set<string>) => {
    if (seen.has(o) || stack.has(o)) return;
    stack.add(o);
    for (const d of deps.get(o) ?? []) visit(d, stack);
    seen.add(o);
    out.push(o);
  };
  for (const o of Object.keys(seed)) visit(o, new Set());
  return out;
}

/** The persona (not a card artifact) a scenario's audit trail names, from the user id the app recorded. */
function personaOfUser(userId: string | null, accounts: readonly PersonaAccount[], adminId: string): string | null {
  if (userId === null) return null;
  const hit = accounts.find((a) => a.userId === userId);
  if (hit) return hit.persona;
  return userId === adminId ? 'admin' : userId;
}

/** A stack's flat manifest for the unmanaged install door: the artifact's manifest plus its collections. */
export function installableManifest(artifact: unknown): { manifest: Record<string, unknown>; installModesSupplied: boolean } {
  const a = (artifact ?? {}) as Record<string, unknown>;
  const head = (typeof a.manifest === 'object' && a.manifest !== null ? a.manifest : {}) as Record<string, unknown>;
  const manifest: Record<string, unknown> = { ...head };
  for (const [k, v] of Object.entries(a)) {
    if (k === 'manifest' || k === 'plugins' || k === 'requires' || k === 'packages') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    manifest[k] = v;
  }
  const declared = Array.isArray(head.installModes) && head.installModes.includes('unmanaged');
  if (!declared) manifest.installModes = ['unmanaged'];
  return { manifest, installModesSupplied: !declared };
}

// ── The halves ──────────────────────────────────────────────────────────────

async function buildHalf(
  scenario: LoadedScenario,
  dir: string,
  ops: ProjectOps,
  author: () => Promise<ParsedTurn>,
  scoreAgainst: LoadedScenario,
): Promise<BuildHalf> {
  const half: BuildHalf = { commands: [], score: null };
  try {
    half.author = summarize(await author());
  } catch (e) {
    half.error = `author: ${errText(e)}`;
  }
  half.commands.push(await ops.os(dir, ['validate']));
  half.commands.push(await ops.os(dir, ['build']));
  half.commands.push(await ops.os(dir, ['verify', ...verifyFlags(scenario.card)]));
  const artifact = ops.readArtifact(dir);
  if (artifact === undefined) {
    half.error = half.error ?? 'no dist/objectstack.json after `objectstack build`';
    return half;
  }
  try {
    half.score = scoreCardArtifact(scoreAgainst, artifact);
  } catch (e) {
    half.error = `score: ${errText(e)}`;
  }
  return half;
}

/** Seed, personas, every question and every operation, against one booted app. */
export async function runHalf(
  scenario: LoadedScenario,
  app: AppHarness,
  driver: AgentDriver,
  ref: Pick<StepRef, 'card' | 'mode' | 'phase'>,
): Promise<RunHalf> {
  const { card } = scenario;
  const half: RunHalf = { personas: [], seed: { inserted: 0, refused: [] }, questions: [], operations: [] };
  const accounts: PersonaAccount[] = [];
  try {
    await app.signInAdmin();
    for (const p of card.run.personas) {
      const acct = await app.createPersona(p.id);
      accounts.push(acct);
      const { apiKey: _k, ...shown } = acct;
      half.personas.push(shown);
    }
    const adminKey = await app.adminApiKey();

    // Seed, with row ownership mapped from the persona handles.
    const handles = personaHandles(card);
    const ownerFields = new Set(card.run.personas.flatMap((p) => (p.scope ?? []).filter((s) => !s.field.includes('.')).map((s) => `${s.object}.${s.field}`)));
    for (const object of seedOrder(scenario)) {
      for (const row of card.run.seed[object] ?? []) {
        const body: Record<string, unknown> = { ...row };
        for (const [k, v] of Object.entries(row)) {
          const persona = typeof v === 'string' && ownerFields.has(`${object}.${k}`) ? handles.get(v) : undefined;
          const acct = persona ? accounts.find((a) => a.persona === persona) : undefined;
          if (acct) body.owner_id = acct.userId;
        }
        const r = await app.insertRow(object, body);
        if (r.ok) half.seed.inserted++;
        else half.seed.refused.push({ object, id: row.id, ...(r.code ? { code: r.code } : {}), ...(r.message ? { message: r.message.slice(0, 300) } : {}) });
      }
    }

    const keyOf = (persona: string | null) => (persona === null ? adminKey : accounts.find((a) => a.persona === persona)!.apiKey);

    for (const q of card.run.questions) {
      for (const persona of [null, ...(q.personas ?? [])]) {
        if (persona === null && q.personas?.length) continue; // a persona-scoped question is asked as its personas
        const res: QuestionResult = { question: q.id, persona };
        try {
          const turn = await driver.ask({ ...ref, step: q.id, ...(persona ? { persona } : {}), prompt: questionPrompt(scenario, q.id), mcp: { url: app.mcpUrl, apiKey: keyOf(persona) } });
          res.turn = summarize(turn);
          res.grade = gradeCardAnswer(scenario, { question: q.id, ...(persona ? { persona } : {}), turn });
        } catch (e) {
          res.error = errText(e);
        }
        half.questions.push(res);
      }
    }

    for (const op of card.run.operations) {
      const res: OperationResult = { operation: op.id, persona: op.actingAs };
      try {
        const before = (await app.listRows(op.object)).rows as Row[];
        const turn = await driver.ask({ ...ref, step: op.id, persona: op.actingAs, prompt: operationPrompt(card, op.id), mcp: { url: app.mcpUrl, apiKey: keyOf(op.actingAs) } });
        res.turn = summarize(turn);
        const after = (await app.listRows(op.object)).rows as Row[];
        const rowsByObject: Record<string, Row[]> = { [op.object]: after };
        if (op.outcome.kind === 'applied') {
          for (const s of op.outcome.state) if (!rowsByObject[s.object]) rowsByObject[s.object] = (await app.listRows(s.object)).rows as Row[];
        }
        let auditActor: string | null | undefined;
        if (op.outcome.kind === 'applied' && op.outcome.auditActor !== undefined) {
          const id = touchedRowId(op, rowsByObject);
          auditActor = id === undefined ? null : personaOfUser(await app.auditActorUserId(op.object, id), accounts, app.adminUserId());
        }
        res.observation = observeOperation({ op, turn, before, after, rowsByObject, ...(auditActor !== undefined ? { auditActor } : {}) });
        res.grade = gradeCardOperation(scenario, op.id, res.observation);
      } catch (e) {
        res.error = errText(e);
      }
      half.operations.push(res);
    }
  } catch (e) {
    half.error = errText(e);
  }
  return half;
}

async function withApp<T>(ops: ProjectOps, dir: string, findings: string[], use: (app: AppHarness, booted: BootedApp) => Promise<T>): Promise<T | undefined> {
  let booted: BootedApp | undefined;
  try {
    booted = await ops.boot(dir);
    return await use(ops.harness(booted.url), booted);
  } catch (e) {
    findings.push(`boot/run: ${errText(e)}`);
    return undefined;
  } finally {
    await booted?.stop();
  }
}

// ── The modes ───────────────────────────────────────────────────────────────

/** Did the build pass — every counted check of the card's `expect`? */
export const buildPassed = (b: BuildHalf | undefined): boolean => !!b?.score && b.score.expect.checks.length > 0 && b.score.expect.checks.every((c) => c.pass);

async function scratchMode(scenario: LoadedScenario, driver: AgentDriver, ops: ProjectOps, opts: RunOptions): Promise<{ mode: ModeRun; verified?: unknown }> {
  const card = scenario.card;
  const mode: ModeRun = { mode: 'scratch', findings: [] };
  const { dir, result } = await ops.scaffold(`${card.id.replace(/_/g, '-')}-scratch`);
  if (result.exit !== 0) {
    mode.skipped = `scaffold failed: ${result.tail.slice(-500)}`;
    return { mode };
  }
  const ref = { card: card.id, mode: 'scratch' as const };
  mode.build = await buildHalf(scenario, dir, ops, async () => (await driver.author({ ...ref, phase: 'build', step: 'author', cwd: dir, prompt: buildPrompt(card) })).turn, scenario);
  const builtArtifact = ops.readArtifact(dir);
  if (builtArtifact !== undefined) mode.run = await withApp(ops, dir, mode.findings, (app) => runHalf(scenario, app, driver, { ...ref, phase: 'run' }));

  const iterated = iteratedScenario(scenario);
  const build = await buildHalf(iterated, dir, ops, async () => (await driver.author({ ...ref, phase: 'iterate', step: 'author', cwd: dir, prompt: iteratePrompt(card) })).turn, iterated);
  const after = ops.readArtifact(dir);
  mode.iterate = { build, ...(builtArtifact !== undefined && after !== undefined ? { changeSize: changeSize(builtArtifact, after) } : {}) };
  if (opts.iterateRun !== false && after !== undefined) {
    const run = await withApp(ops, dir, mode.findings, (app) => runHalf(scenario, app, driver, { ...ref, phase: 'iterate-run' }));
    if (run) mode.iterate.run = run;
  }
  return { mode, ...(buildPassed(mode.build) ? { verified: builtArtifact } : {}) };
}

async function templateMode(scenario: LoadedScenario, driver: AgentDriver, ops: ProjectOps, opts: RunOptions, verified: { artifact: unknown; source: string } | undefined): Promise<ModeRun> {
  const card = scenario.card;
  const mode: ModeRun = { mode: 'template', findings: [] };
  if (!verified) {
    mode.skipped = 'no verified build of this card to install: the from-scratch build did not pass and no template was supplied';
    return mode;
  }
  const { dir, result } = await ops.scaffold(`${card.id.replace(/_/g, '-')}-template`);
  if (result.exit !== 0) {
    mode.skipped = `scaffold failed: ${result.tail.slice(-500)}`;
    return mode;
  }
  const iterated = iteratedScenario(scenario);
  await withApp(ops, dir, mode.findings, async (app, booted) => {
    await app.signInAdmin();
    const { manifest, installModesSupplied } = installableManifest(verified.artifact);
    const install = await app.installUnmanaged(manifest);
    mode.template = {
      source: verified.source,
      install: { ok: install.ok, status: install.status, ...(install.code ? { code: install.code } : {}), ...(install.message ? { message: install.message.slice(0, 500) } : {}) },
      installModesSupplied,
    };
    if (!install.ok) {
      mode.findings.push(`unmanaged install refused: ${install.status} ${install.code ?? ''} ${install.message ?? ''}`.trim());
      return;
    }
    const collections = Object.keys(manifest).filter((k) => Array.isArray(manifest[k]));
    const before = await app.metadataAsArtifact(collections);
    const build: BuildHalf = { commands: [], score: null };
    try {
      const turn = (await driver.author({ card: card.id, mode: 'template', phase: 'iterate', step: 'author', cwd: dir, prompt: templateIteratePrompt(card, { baseUrl: booted.url, adminEmail: opts.admin.email, adminPassword: opts.admin.password }) })).turn;
      build.author = summarize(turn);
    } catch (e) {
      build.error = `author: ${errText(e)}`;
    }
    const after = await app.metadataAsArtifact(collections);
    try {
      build.score = scoreCardArtifact(iterated, after);
    } catch (e) {
      build.error = build.error ?? `score: ${errText(e)}`;
    }
    mode.iterate = { build, changeSize: changeSize(before, after) };
    mode.iterate.run = await runHalf(scenario, app, driver, { card: card.id, mode: 'template', phase: 'iterate-run' });
  });
  return mode;
}

/** Run one card in the requested modes. */
export async function runCard(scenario: LoadedScenario, driver: AgentDriver, ops: ProjectOps, opts: RunOptions): Promise<CardRun> {
  const { card } = scenario;
  const questionTurns = card.run.questions.reduce((n, q) => n + (q.personas?.length ? q.personas.length : 1), 0);
  const out: CardRun = {
    card: card.id,
    title: card.title,
    capabilities: card.capabilities,
    counts: { questions: card.run.questions.length, questionTurns, operations: card.run.operations.length, personas: card.run.personas.length },
    modes: [],
  };
  let verified: { artifact: unknown; source: string } | undefined =
    opts.templateArtifact !== undefined ? { artifact: opts.templateArtifact, source: 'supplied template' } : undefined;
  if (opts.modes.includes('scratch')) {
    const r = await scratchMode(scenario, driver, ops, opts);
    out.modes.push(r.mode);
    if (!verified && r.verified !== undefined) verified = { artifact: r.verified, source: 'this run’s from-scratch build' };
  }
  if (opts.modes.includes('template')) out.modes.push(await templateMode(scenario, driver, ops, opts, verified));
  return out;
}
