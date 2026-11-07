// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A real run of the real `crm_account_with_contacts` card, for the gallery
 * exporter's tests: `runCard` end to end (both modes) with its three outside
 * worlds replaced — a project lifecycle that writes a REAL project directory
 * under a temp work directory (the layout the runner CLI scaffolds into), an
 * in-memory app, and a scripted model wrapped in the runner's own
 * `RecordingDriver` — then the run record exactly as the CLI writes it.
 *
 * No model, no network, no browser: what booting a generated app needs (a
 * model to write it, npm to scaffold it) is not available here, so the
 * project is a fixture and the screenshots are a double.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, loadScenarioFile, loadScenarios, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { truthFigures } from '../../src/score/index.js';
import type { AppHarness, HttpAnswer, PersonaAccount, ToolAnswer } from '../../src/runner/app.js';
import { RecordingDriver, type AgentDriver, type AskTask, type AuthorTask, type DriverInfo, type Recording } from '../../src/runner/driver.js';
import { namespacedScenario } from '../../src/runner/namespace.js';
import { runCard, type CardRun, type ProjectOps } from '../../src/runner/orchestrate.js';
import { runRecord } from '../../src/runner/scorecard.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CARDS_DIR = resolve(HERE, '../../../../../docs/qa/scenarios');
export const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');
export const CARD_ID = 'crm_account_with_contacts';
export const NS = 'democrm';

export function loadCrm(): LoadedScenario {
  const { card, refusals } = loadScenarioFile(join(CARDS_DIR, `${CARD_ID}.json`), { areas: readCapabilityAreas(AREAS_DIR) });
  if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
  return card;
}

export function loadAllCards(): LoadedScenario[] {
  return loadScenarios(CARDS_DIR, { areas: readCapabilityAreas(AREAS_DIR) }).cards;
}

export const tempDir = (prefix: string) => mkdtempSync(join(tmpdir(), `gallery-${prefix}-`));

// ── The build the fake `objectstack build` writes ───────────────────────────

const select = (values: string[]) => ({ type: 'select', options: values.map((value) => ({ value, label: value })) });
const n = (name: string) => `${NS}_${name}`;

export function crmArtifact(iterated: boolean) {
  const action = (name: string, confirm = false) => ({ name, ai: { exposed: true, ...(confirm ? { requiresConfirmation: true } : {}) } });
  const objects: unknown[] = [
    { name: n('account'), fields: { name: { type: 'text' }, industry: select(['tech', 'retail']), owner: { type: 'text' } } },
    {
      name: n('contact'),
      fields: { full_name: { type: 'text' }, email: { type: 'email' }, account: { type: 'lookup', reference: n('account') } },
      actions: [action(n('create_contact')), action(n('reassign_contact')), action(n('delete_contact'), true)],
    },
  ];
  if (iterated) objects.push({ name: n('opportunity'), fields: { stage: select(['a', 'b', 'c', 'd']), account: { type: 'lookup', reference: n('account') } } });
  return {
    manifest: { id: `com.example.${NS}`, namespace: NS },
    objects,
    permissions: [
      { name: n('sdr'), objects: { [n('account')]: { allowRead: true }, [n('contact')]: { allowRead: true, allowCreate: true, allowEdit: true } }, fields: { [`${n('contact')}.email`]: { readable: false } } },
      { name: n('partner_user'), objects: { [n('contact')]: { allowRead: true, allowCreate: true } } },
    ],
  };
}

// ── The project lifecycle: a real directory per mode ────────────────────────

const FIXTURE_FILES: Record<string, string> = {
  'objectstack.config.ts': `import { defineStack } from '@objectstack/spec';\nexport default defineStack({ manifest: { id: 'com.example.${NS}', namespace: '${NS}' } });\n`,
  'objectstack.manifest.json': '{ "id": "com.example.democrm" }\n',
  'package.json': JSON.stringify({ name: NS, private: true, dependencies: { '@objectstack/spec': '18.3.0', '@objectstack/runtime': '18.3.0' } }, null, 2),
  'tsconfig.json': '{}\n',
  'src/objects/account.object.ts': "export const account = { name: 'democrm_account' };\n",
  'src/objects/contact.object.ts': "export const contact = { name: 'democrm_contact' };\n",
  // What the gallery must NOT receive: dependencies, build output, installed skills, scaffold boilerplate, local state.
  'node_modules/@objectstack/spec/package.json': '{ "version": "18.3.0" }\n',
  '.agents/skills/objectstack-data/SKILL.md': '# skill\n',
  '.claude/settings.json': '{}\n',
  '.objectstack/dev.db': 'local state\n',
  'README.md': '# scaffold readme\n',
  'Dockerfile': 'FROM node\n',
  '.env': 'SECRET=never-exported\n',
};

function fakeOps(work: string, app: () => FakeApp): ProjectOps & { phase: Map<string, 'scaffolded' | 'built' | 'iterated'> } {
  const phase = new Map<string, 'scaffolded' | 'built' | 'iterated'>();
  const ok = (command: string) => ({ command, exit: 0, tail: '', ms: 1 });
  return {
    phase,
    async scaffold(name, under) {
      const dir = join(work, under, name);
      for (const [rel, text] of Object.entries(FIXTURE_FILES)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
      }
      phase.set(dir, 'scaffolded');
      return { dir, result: ok(`create-objectstack ${name}`) };
    },
    async os(dir, args) {
      const p = phase.get(dir)!;
      if (args[0] === 'build' && p !== 'scaffolded') {
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(crmArtifact(p === 'iterated')));
      }
      // A command tail naming the work directory, as a real refusal would: the export must not carry it.
      return { command: `npx objectstack ${args.join(' ')}`, exit: 0, tail: `ran in ${dir}`, ms: 1 };
    },
    readArtifact(dir) {
      const p = phase.get(dir)!;
      return p === 'scaffolded' ? undefined : crmArtifact(p === 'iterated');
    },
    async boot() {
      return { url: 'http://fake', stop: async () => {}, log: () => '' };
    },
    harness: () => app(),
    namespace: (dir) => dir.slice(dir.lastIndexOf('/') + 1),
  };
}

// ── The in-memory app ───────────────────────────────────────────────────────

export class FakeApp implements AppHarness {
  readonly baseUrl = 'http://fake';
  readonly mcpUrl = 'http://fake/api/v1/mcp';
  rows: Record<string, Array<Record<string, unknown>>> = {};
  audit: Record<string, string> = {};
  installed: Record<string, unknown> | undefined;
  /** Seed rows this app refuses, `object/id`. */
  refuse = new Set<string>();
  signedIn = 0;
  async signInAdmin() {
    this.signedIn++;
  }
  adminUserId() {
    return 'u-admin';
  }
  organizationId() {
    return 'org';
  }
  async createPersona(persona: string, permissionSet: string): Promise<PersonaAccount> {
    return { persona, userId: `u-${persona}`, email: `${persona}@scenario.test`, apiKey: `key-${persona}`, permissionSet: { name: permissionSet, assigned: true } };
  }
  async adminApiKey() {
    return 'key-admin';
  }
  async insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    if (this.refuse.has(`${object}/${String(row.id)}`)) return { ok: false, status: 400, body: {}, code: 'VALIDATION_FAILED', message: 'refused by the double' };
    (this.rows[object] ??= []).push({ ...row });
    return { ok: true, status: 200, body: {} };
  }
  /** The seed's second pass (a lookup that closes a reference cycle). */
  async updateRow(object: string, id: string, patch: Record<string, unknown>): Promise<HttpAnswer> {
    const row = (this.rows[object] ?? []).find((r) => r.id === id);
    if (!row) return { ok: false, status: 404, body: {}, code: 'NOT_FOUND', message: 'no such row in the double' };
    Object.assign(row, patch);
    return { ok: true, status: 200, body: {} };
  }
  async listRows(object: string) {
    return { ok: true, status: 200, body: {}, rows: (this.rows[object] ?? []).map((r) => ({ ...r })) };
  }
  async auditActorUserId(_object: string, recordId: string) {
    return this.audit[recordId] ?? null;
  }
  async installUnmanaged(manifest: Record<string, unknown>) {
    this.installed = manifest;
    return { ok: true, status: 200, body: {} };
  }
  async metadataAsArtifact(collections: readonly string[]) {
    const src = (this.installed ?? {}) as Record<string, unknown[]>;
    const out: Record<string, unknown[]> = {};
    for (const c of collections) out[c] = [...(src[c] ?? [])];
    return out;
  }
  /** The validation probe's door: this double validates, so it refuses every write it is sent. */
  async callTool(): Promise<ToolAnswer> {
    return { output: JSON.stringify({ error: { code: 'VALIDATION_FAILED', status: 400 } }), isError: true };
  }
}

// ── The scripted model ──────────────────────────────────────────────────────

const turn = (replyText: string, toolCalls: ParsedTurn['toolCalls'] = []): ParsedTurn => ({ replyText, toolCalls, meta: { resultSubtype: 'success' } });

/** A truthful answer, built from the loader's computed truth. */
function truthfulAnswer(scenario: LoadedScenario, question: string, persona?: string): string {
  const q = scenario.card.run.questions.find((x) => x.id === question)!;
  const truth = persona ? scenario.personaTruths[q.id]![persona]! : scenario.truths[q.id]!;
  if (truth.kind === 'withheld' || truth.kind === 'unanswerable') return 'I cannot answer that: it is not available to you.';
  const figures = truthFigures(truth, q.object, 'x').map((f) => `${f.label.replace(/^x\[?|\]$/g, '') || 'total'}: ${f.value}`);
  return `${figures.join(', ')}\nSource: ${q.object}`;
}

class ScriptedDriver implements AgentDriver {
  private readonly scenario: LoadedScenario;
  constructor(
    scenario: LoadedScenario,
    private readonly ops: ReturnType<typeof fakeOps>,
    private readonly app: () => FakeApp,
  ) {
    this.scenario = namespacedScenario(scenario);
  }
  info(): DriverInfo {
    return { driver: 'recorded', version: 'scripted test replay', apiBilled: false };
  }
  async author(task: AuthorTask) {
    if (task.mode === 'scratch') this.ops.phase.set(task.cwd, task.phase === 'build' ? 'built' : 'iterated');
    if (task.mode === 'template') {
      const app = this.app();
      const objects = (app.installed!.objects as unknown[]) ?? [];
      app.installed = { ...app.installed!, objects: [...objects, ...crmArtifact(true).objects.slice(2)] };
    }
    return { turn: turn('Done.') };
  }
  async ask(task: AskTask): Promise<ParsedTurn> {
    const app = this.app();
    const op = this.scenario.card.run.operations.find((o) => o.id === task.step);
    if (!op) return turn(truthfulAnswer(this.scenario, task.step, task.persona), [{ name: 'query_records', rawName: 'mcp__app__query_records', input: { objectName: 'x' }, output: '{"records":[]}' }]);
    const rows = (app.rows[op.object] ??= []);
    if (op.outcome.kind === 'applied') {
      if (op.kind === 'create') rows.push({ id: `new-${op.id}`, ...op.values });
      if (op.kind === 'update') Object.assign(rows.find((r) => r.id === op.target)!, op.values);
      app.audit[op.target ?? `new-${op.id}`] = `u-${op.actingAs}`;
      return turn('Done.', [{ name: `${op.kind}_record`, rawName: 'x', input: { objectName: op.object }, output: '{"ok":true}' }]);
    }
    if (op.outcome.kind === 'refused') {
      return turn('That was refused.', [{ name: `${op.kind}_record`, rawName: 'x', input: { objectName: op.object }, output: JSON.stringify({ error: { code: op.outcome.code } }), isError: true }]);
    }
    return turn('This cannot be undone — do you want me to delete it? Please confirm.');
  }
}

export const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

export interface FixtureRun {
  scenario: LoadedScenario;
  work: string;
  cardRun: CardRun;
  record: Record<string, unknown>;
  recording: Recording;
}

/** One run of the crm card, both modes; `iterateRun: false` leaves the iterate Run halves not run; `refuse` makes every booted app refuse those seed rows. */
export async function runCrm(
  opts: { work?: string; date?: string; iterateRun?: boolean; modes?: Array<'scratch' | 'template'>; /** Seed rows every booted app refuses, `object/id`. */ refuse?: string[] } = {},
): Promise<FixtureRun> {
  const scenario = loadCrm();
  const work = opts.work ?? tempDir('work');
  const fresh = () => {
    const app = new FakeApp();
    for (const r of opts.refuse ?? []) app.refuse.add(r);
    return app;
  };
  let current = fresh();
  const ops = fakeOps(work, () => current);
  const boot = ops.boot.bind(ops);
  ops.boot = async (dir) => {
    current = fresh();
    return boot(dir);
  };
  const driver = new RecordingDriver(new ScriptedDriver(scenario, ops, () => current));
  const cardRun = await runCard(scenario, driver, ops, { modes: opts.modes ?? ['scratch', 'template'], admin: ADMIN, ...(opts.iterateRun === false ? { iterateRun: false } : {}) });
  const date = opts.date ?? '2026-11-06';
  const record = runRecord({ run: `${date}-scenario-${CARD_ID}`, date, framework: 'abc1234', driver: driver.info(), runner: 'scenario-runner', evidenceDir: work }, cardRun);
  return { scenario, work, cardRun, record, recording: driver.recording };
}

/** Write a record where the runner CLI writes it: `<runs>/<date>-scenario-<card>.json`. */
export function writeRecord(runs: string, record: Record<string, unknown>): string {
  mkdirSync(runs, { recursive: true });
  const file = join(runs, `${String(record.date)}-scenario-${String(record.app)}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}
