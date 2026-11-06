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
 * Names: the app is always in the card's own namespace, `demo` + its code
 * (`democrm`). Scratch mode scaffolds the project under that name; template
 * mode installs a template that declares it into a host of its own
 * (`templateHostName`). A project or template declaring any other namespace is
 * skipped with the reason, never read against it.
 *
 * Scoring is `@objectstack/scenarios/score` (ruling D on #30291) and nothing
 * else; this module only gathers what the graders take.
 */

import { applyExpectDelta, type LoadedScenario } from '../loader.js';
import { scenarioNamespace } from '../schema.js';
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
import { citationLabels, namespaceOfArtifact, namespacedScenario, permissionSetName, templateHostName } from './namespace.js';
import { observeOperation, touchedRowId, type Row } from './observe.js';
import type { CommandResult } from './project.js';
import { buildPrompt, iteratePrompt, operationPrompt, personaHandles, questionPrompt, templateIteratePrompt, userHandleFields, verifyArgs } from './prompts.js';
import type { ParsedTurn } from './transcript.js';

// ── What the orchestrator needs from the outside world ──────────────────────

export interface BootedApp {
  url: string;
  stop(): Promise<void>;
  log(): string;
}

export interface ProjectOps {
  /**
   * `npm create objectstack <name>` in a directory of its own, `under` (one per
   * card and mode): the project name is what the scaffolder derives the
   * namespace from, so two modes of one card cannot share a parent.
   */
  scaffold(name: string, under: string): Promise<{ dir: string; result: CommandResult }>;
  os(dir: string, args: readonly string[]): Promise<CommandResult>;
  readArtifact(dir: string): unknown | undefined;
  boot(dir: string): Promise<BootedApp>;
  harness(url: string): AppHarness;
  /** The `namespace` the scaffolded project's manifest declares; checked against the card's own before a build. */
  namespace?(dir: string): string | undefined;
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
  /** Why this turn was not asked: it reads a row the seed could not load ({@link seedDependence}). Not measured, never a fail. */
  notMeasured?: string;
  grade?: PersonaRunGrade;
  turn?: TurnSummary;
  error?: string;
}

export interface OperationResult {
  operation: string;
  persona: string;
  /** Why this operation was not run: it acts on a row the seed could not load ({@link seedDependence}). Not measured, never a fail. */
  notMeasured?: string;
  observation?: OperationObservation;
  grade?: OperationGrade;
  turn?: TurnSummary;
  error?: string;
}

export interface RunHalf {
  personas: Array<Omit<PersonaAccount, 'apiKey'>>;
  seed: {
    inserted: number;
    refused: Array<{ object: string; id: string; code?: string; message?: string }>;
    /** Handles a user-handle field named that no persona holds, each loaded as the admin user (`u_tia`). */
    handlesAsAdmin?: string[];
  };
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

/** `artifact` less every item `baseline` carries (by collection and name): an environment's metadata minus what was there before. */
export function withoutItems(artifact: Record<string, unknown[]>, baseline: Record<string, unknown[]>): Record<string, unknown[]> {
  const nameOf = (item: unknown) => (typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : undefined);
  return Object.fromEntries(
    Object.entries(artifact).map(([key, items]) => {
      const there = new Set((baseline[key] ?? []).map(nameOf));
      return [key, items.filter((item) => !there.has(nameOf(item)))];
    }),
  );
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

/**
 * The values a persona's hidden fields hold in the seed — the leak grader's
 * `hidden.values`, which it leaves to the caller to compute. Only distinctive
 * values are passed (the grader's own advice): strings of four characters or
 * more, numbers of magnitude 100 or more.
 */
export function hiddenValues(scenario: LoadedScenario, personaId: string): Array<string | number> {
  const p = scenario.card.run.personas.find((x) => x.id === personaId);
  const out = new Set<string | number>();
  for (const f of p?.hidden.fields ?? []) {
    for (const row of scenario.card.run.seed[f.object] ?? []) {
      const v = row[f.field];
      if (typeof v === 'string' && v.length >= 4) out.add(v);
      if (typeof v === 'number' && Math.abs(v) >= 100) out.add(v);
    }
  }
  return [...out];
}

type Card = LoadedScenario['card'];
type Question = Card['run']['questions'][number];
type Operation = Card['run']['operations'][number];

/**
 * What a refused seed row takes out of the Run half, read from what the card
 * names. The rows out are the refused ones plus, transitively, every seed row
 * whose declared lookup (`expect.lookups`) names a row that is out — a contact
 * of a refused account, whether or not the app refused it too. Then:
 *
 *   - a question is not measured when its `object` has a row that is out: its
 *     truth was computed over rows the app does not hold;
 *   - an operation is not measured when its `target`, a lookup value it writes,
 *     or a post-state row (`id`, or a lookup value in its `values`) names a row
 *     that is out.
 *
 * Everything else grades as usual. A not-measured turn is not asked and counts
 * in neither passed nor total.
 */
export function seedDependence(
  card: Card,
  refused: ReadonlyArray<{ object: string; id: string }>,
): { out: Map<string, string>; question(q: Question): string | undefined; operation(op: Operation): string | undefined } {
  /** `object/id` → the refused row it hangs off, as `object id`. */
  const out = new Map<string, string>(refused.map((r) => [`${r.object}/${r.id}`, `${r.object} ${r.id}`]));
  const lookups = card.expect.lookups ?? [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of lookups) {
      for (const row of card.run.seed[l.object] ?? []) {
        const parent = out.get(`${l.to}/${String(row[l.field])}`);
        if (parent !== undefined && !out.has(`${l.object}/${row.id}`)) {
          out.set(`${l.object}/${row.id}`, parent);
          grew = true;
        }
      }
    }
  }
  const why = (object: string, id: unknown): string | undefined => {
    const root = typeof id === 'string' ? out.get(`${object}/${id}`) : undefined;
    if (root === undefined) return undefined;
    return root === `${object} ${String(id)}` ? `seed: needs ${root}, which the app refused` : `seed: needs ${object} ${String(id)}, a child of ${root}, which the app refused`;
  };
  const viaLookups = (object: string, values: Record<string, unknown> | undefined): string | undefined => {
    for (const l of lookups) {
      const w = l.object === object && values && l.field in values ? why(l.to, values[l.field]) : undefined;
      if (w) return w;
    }
    return undefined;
  };
  return {
    out,
    question: (q) => {
      for (const row of card.run.seed[q.object] ?? []) {
        const w = why(q.object, row.id);
        if (w) return w;
      }
      return undefined;
    },
    operation: (op) => {
      const direct = (op.target !== undefined ? why(op.object, op.target) : undefined) ?? viaLookups(op.object, op.values);
      if (direct) return direct;
      if (op.outcome.kind !== 'applied') return undefined;
      for (const st of op.outcome.state) {
        const w = (st.id !== undefined ? why(st.object, st.id) : undefined) ?? viaLookups(st.object, st.values);
        if (w) return w;
      }
      return undefined;
    },
  };
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
  half.commands.push(await ops.os(dir, verifyArgs(scenario.card))); // the invocation every authoring prompt names
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

/**
 * Load the card's seed into a booted app, as the admin, in lookup order.
 *
 * Row ownership is mapped from the persona handles. A row whose direct scope
 * field names a persona's handle is owned (`owner_id`, the platform's record
 * owner) by that persona's user. A user-handle field (`account.owner`,
 * `userHandleFields`) is itself loaded with a user id — the persona's, or the
 * admin's for a handle no persona holds (`u_tia`), and every handle is the
 * admin's when no persona account is passed (the gallery's screenshot boot) —
 * because a faithful build models it as a user lookup, which refuses the
 * handle text. Any other scope field names a row or an option and is sent
 * verbatim.
 */
export async function seedApp(scenario: LoadedScenario, app: AppHarness, accounts: readonly PersonaAccount[]): Promise<RunHalf['seed']> {
  const { card } = scenario;
  const seed: RunHalf['seed'] = { inserted: 0, refused: [] };
  const handles = personaHandles(card);
  const ownerFields = new Set(card.run.personas.flatMap((p) => (p.scope ?? []).filter((s) => !s.field.includes('.')).map((s) => `${s.object}.${s.field}`)));
  const userFields = userHandleFields(card);
  for (const object of seedOrder(scenario)) {
    for (const row of card.run.seed[object] ?? []) {
      const body: Record<string, unknown> = { ...row };
      for (const [k, v] of Object.entries(row)) {
        if (typeof v !== 'string' || !ownerFields.has(`${object}.${k}`)) continue;
        const persona = handles.get(v);
        const acct = persona ? accounts.find((a) => a.persona === persona) : undefined;
        if (acct) body.owner_id = acct.userId;
        if (userFields.has(`${object}.${k}`)) {
          const userId = acct?.userId ?? app.adminUserId();
          body[k] = userId;
          body.owner_id = userId;
          if (!acct) seed.handlesAsAdmin = [...new Set([...(seed.handlesAsAdmin ?? []), v])].sort();
        }
      }
      const r = await app.insertRow(object, body);
      if (r.ok) seed.inserted++;
      else seed.refused.push({ object, id: row.id, ...(r.code ? { code: r.code } : {}), ...(r.message ? { message: r.message.slice(0, 300) } : {}) });
    }
  }
  return seed;
}

/** Seed, personas, every question and every operation, against one booted app. */
export async function runHalf(
  scenario: LoadedScenario,
  app: AppHarness,
  driver: AgentDriver,
  ref: Pick<StepRef, 'card' | 'mode' | 'phase'>,
  objectLabels?: Record<string, string[]>,
): Promise<RunHalf> {
  const { card } = scenario;
  const half: RunHalf = { personas: [], seed: { inserted: 0, refused: [] }, questions: [], operations: [] };
  const accounts: PersonaAccount[] = [];
  try {
    await app.signInAdmin();
    for (const p of card.run.personas) {
      const acct = await app.createPersona(p.id, permissionSetName(card, p.id));
      accounts.push(acct);
      const { apiKey: _k, ...shown } = acct;
      half.personas.push(shown);
    }
    const adminKey = await app.adminApiKey();

    half.seed = await seedApp(scenario, app, accounts);

    const keyOf = (persona: string | null) => (persona === null ? adminKey : accounts.find((a) => a.persona === persona)!.apiKey);
    // A refused seed row makes what reads it not measured — never a fail of the app's answer.
    const dependence = seedDependence(card, half.seed.refused);

    for (const q of card.run.questions) {
      const notMeasured = dependence.question(q);
      for (const persona of [null, ...(q.personas ?? [])]) {
        if (persona === null && q.personas?.length) continue; // a persona-scoped question is asked as its personas
        const res: QuestionResult = { question: q.id, persona };
        if (notMeasured) {
          half.questions.push({ ...res, notMeasured });
          continue;
        }
        try {
          const turn = await driver.ask({ ...ref, step: q.id, ...(persona ? { persona } : {}), prompt: questionPrompt(scenario, q.id), mcp: { url: app.mcpUrl, apiKey: keyOf(persona) } });
          res.turn = summarize(turn);
          res.grade = gradeCardAnswer(scenario, {
            question: q.id,
            ...(persona ? { persona, hidden: { values: hiddenValues(scenario, persona) } } : {}),
            ...(objectLabels ? { objectLabels } : {}),
            turn,
          });
        } catch (e) {
          res.error = errText(e);
        }
        half.questions.push(res);
      }
    }

    for (const op of card.run.operations) {
      const res: OperationResult = { operation: op.id, persona: op.actingAs };
      const notMeasured = dependence.operation(op);
      if (notMeasured) {
        half.operations.push({ ...res, notMeasured });
        continue;
      }
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

/**
 * The directory, under the run's work directory, a mode's project is
 * scaffolded in (`ProjectOps.scaffold`'s `under`): one per card and mode. The
 * gallery exporter finds a run's scratch project by it.
 */
export const modeDir = (card: { id: string }, mode: 'scratch' | 'template'): string => `${card.id.replace(/_/g, '-')}-${mode}`;

/** Did the build pass — every counted check of the card's `expect`, and no bare item name? */
export const buildPassed = (b: BuildHalf | undefined): boolean =>
  !!b?.score && b.score.expect.checks.length > 0 && [...b.score.expect.checks, ...b.score.naming].every((c) => c.pass);

async function scratchMode(original: LoadedScenario, driver: AgentDriver, ops: ProjectOps, opts: RunOptions): Promise<{ mode: ModeRun; verified?: unknown }> {
  const mode: ModeRun = { mode: 'scratch', findings: [] };
  // The project is named after the card's namespace, which is what the scaffolder derives its namespace from.
  const ns = scenarioNamespace(original.card);
  const { dir, result } = await ops.scaffold(ns, modeDir(original.card, 'scratch'));
  if (result.exit !== 0) {
    mode.skipped = `scaffold failed: ${result.tail.slice(-500)}`;
    return { mode };
  }
  const declared = ops.namespace ? ops.namespace(dir) : ns;
  if (declared !== ns) {
    mode.skipped = `the scaffolded project declares namespace \`${declared ?? '(none)'}\`, not the card's \`${ns}\`: its names would not be the card's`;
    return { mode };
  }
  const scenario = namespacedScenario(original);
  const labels = citationLabels(original);
  const card = scenario.card;
  const ref = { card: card.id, mode: 'scratch' as const };
  mode.build = await buildHalf(scenario, dir, ops, async () => (await driver.author({ ...ref, phase: 'build', step: 'author', cwd: dir, prompt: buildPrompt(card) })).turn, scenario);
  const builtArtifact = ops.readArtifact(dir);
  if (builtArtifact !== undefined) mode.run = await withApp(ops, dir, mode.findings, (app) => runHalf(scenario, app, driver, { ...ref, phase: 'run' }, labels));

  const iterated = iteratedScenario(scenario);
  const build = await buildHalf(iterated, dir, ops, async () => (await driver.author({ ...ref, phase: 'iterate', step: 'author', cwd: dir, prompt: iteratePrompt(card) })).turn, iterated);
  const after = ops.readArtifact(dir);
  mode.iterate = { build, ...(builtArtifact !== undefined && after !== undefined ? { changeSize: changeSize(builtArtifact, after) } : {}) };
  if (opts.iterateRun !== false && after !== undefined) {
    const run = await withApp(ops, dir, mode.findings, (app) => runHalf(scenario, app, driver, { ...ref, phase: 'iterate-run' }, labels));
    if (run) mode.iterate.run = run;
  }
  return { mode, ...(buildPassed(mode.build) ? { verified: builtArtifact } : {}) };
}

async function templateMode(original: LoadedScenario, driver: AgentDriver, ops: ProjectOps, opts: RunOptions, verified: { artifact: unknown; source: string } | undefined): Promise<ModeRun> {
  // The installed copy keeps the TEMPLATE's namespace, which must be the card's own.
  const ns = scenarioNamespace(original.card);
  const scenario = namespacedScenario(original);
  const labels = citationLabels(original);
  const card = scenario.card;
  const mode: ModeRun = { mode: 'template', findings: [] };
  if (!verified) {
    mode.skipped = 'no verified build of this card to install: the from-scratch build did not pass and no template was supplied';
    return mode;
  }
  const templateNs = namespaceOfArtifact(verified.artifact);
  if (templateNs !== ns) {
    mode.skipped = `the template declares namespace \`${templateNs ?? '(none)'}\`, not the card's \`${ns}\`: its names would not be the card's`;
    return mode;
  }
  // The blank host gets a namespace of its own (`templateHostName` says why).
  const { dir, result } = await ops.scaffold(templateHostName(original.card), modeDir(card, 'template'));
  if (result.exit !== 0) {
    mode.skipped = `scaffold failed: ${result.tail.slice(-500)}`;
    return mode;
  }
  const iterated = iteratedScenario(scenario);
  await withApp(ops, dir, mode.findings, async (app, booted) => {
    await app.signInAdmin();
    const { manifest, installModesSupplied } = installableManifest(verified.artifact);
    const collections = Object.keys(manifest).filter((k) => Array.isArray(manifest[k]));
    // What the environment serves before the copy lands — the platform's own items (`setup`, `admin_full_access`, …) and the host's — is not the app.
    const baseline = await app.metadataAsArtifact(collections);
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
      build.score = scoreCardArtifact(iterated, withoutItems(after, baseline));
    } catch (e) {
      build.error = build.error ?? `score: ${errText(e)}`;
    }
    mode.iterate = { build, changeSize: changeSize(before, after) };
    mode.iterate.run = await runHalf(scenario, app, driver, { card: card.id, mode: 'template', phase: 'iterate-run' }, labels);
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
