// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runner end to end on the real `crm_account_with_contacts` card, with
 * the three outside worlds replaced: the project (a fake scaffold whose
 * "build" writes a fixture artifact), the booted app (an in-memory data
 * door), and the model (a replay driver whose operation turns also apply the
 * write they describe to the in-memory door, as the MCP door would).
 *
 * What it pins is the card's acceptance: one record per card with both modes
 * side by side, and a degraded build and a leaking answer each SHOWING UP in
 * the scorecard.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { truthFigures } from '../../src/score/index.js';
import type { AppHarness, HttpAnswer, PersonaAccount } from '../../src/runner/app.js';
import { stepKey, type AgentDriver, type AskTask, type AuthorTask, type DriverInfo } from '../../src/runner/driver.js';
import { namespacedScenario } from '../../src/runner/namespace.js';
import { runCard, type ProjectOps } from '../../src/runner/orchestrate.js';
import { cardScorecard, renderScorecard, runRecord } from '../../src/runner/scorecard.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_FILE = resolve(HERE, '../../../../../docs/qa/scenarios/crm_account_with_contacts.json');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

function load(): LoadedScenario {
  const { card, refusals } = loadScenarioFile(CARD_FILE, { areas: readCapabilityAreas(AREAS_DIR) });
  if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
  return card;
}

// ── The built artifact the fake `objectstack build` writes ──────────────────

const select = (values: string[]) => ({ type: 'select', options: values.map((value) => ({ value, label: value })) });

function artifact(opts: { degraded?: boolean; iterated?: boolean; ns?: string } = {}) {
  const n = (name: string) => (opts.ns ? `${opts.ns}_${name}` : name);
  const objects: unknown[] = [
    { name: n('account'), fields: { name: { type: 'text' }, industry: select(['tech', 'retail']), owner: { type: 'text' } } },
  ];
  if (!opts.degraded) {
    const action = (name: string, confirm = false) => ({ name, ai: { exposed: true, ...(confirm ? { requiresConfirmation: true } : {}) } });
    objects.push({
      name: n('contact'),
      fields: { full_name: { type: 'text' }, email: { type: 'email' }, account: { type: 'lookup', reference: n('account') } },
      actions: [action('create_contact'), action('reassign_contact'), action('delete_contact', true)],
    });
  }
  if (opts.iterated) {
    objects.push({ name: n('opportunity'), fields: { stage: select(['a', 'b', 'c', 'd']), account: { type: 'lookup', reference: n('account') } } });
  }
  return {
    manifest: { id: 'com.example.crm', ...(opts.ns ? { namespace: opts.ns } : {}) },
    objects,
    permissions: [
      { name: 'sdr', objects: { [n('account')]: { allowRead: true }, [n('contact')]: { allowRead: true, allowCreate: true, allowEdit: true } }, fields: { [`${n('contact')}.email`]: { readable: false } } },
      { name: 'partner_user', objects: { [n('contact')]: { allowRead: true } } },
    ],
  };
}

// ── The fake project lifecycle ──────────────────────────────────────────────

interface FakeProject {
  phase: 'scaffolded' | 'built' | 'iterated';
}

function fakeOps(app: () => FakeApp, opts: { degradedBuild?: boolean; ns?: string } = {}): ProjectOps & { projects: Map<string, FakeProject> } {
  const projects = new Map<string, FakeProject>();
  const ok = (command: string) => ({ command, exit: 0, tail: '', ms: 1 });
  return {
    projects,
    async scaffold(name) {
      projects.set(name, { phase: 'scaffolded' });
      return { dir: name, result: ok(`create-objectstack ${name}`) };
    },
    async os(dir, args) {
      const degraded = opts.degradedBuild && projects.get(dir)!.phase === 'built';
      return { command: `npx objectstack ${args.join(' ')}`, exit: degraded && args[0] === 'validate' ? 1 : 0, tail: '', ms: 1 };
    },
    readArtifact(dir) {
      const p = projects.get(dir)!;
      if (p.phase === 'scaffolded') return undefined;
      return artifact({ degraded: opts.degradedBuild && p.phase === 'built', iterated: p.phase === 'iterated', ...(opts.ns ? { ns: opts.ns } : {}) });
    },
    async boot() {
      return { url: 'http://fake', stop: async () => {}, log: () => '' };
    },
    harness: () => app(),
    namespace: () => opts.ns,
  };
}

// ── The fake booted app ─────────────────────────────────────────────────────

class FakeApp implements AppHarness {
  readonly baseUrl = 'http://fake';
  readonly mcpUrl = 'http://fake/api/v1/mcp';
  rows: Record<string, Array<Record<string, unknown>>> = {};
  audit: Record<string, string> = {};
  installed: Record<string, unknown> | undefined;
  installAnswer: HttpAnswer = { ok: true, status: 200, body: {} };
  async signInAdmin() {}
  adminUserId() {
    return 'u-admin';
  }
  organizationId() {
    return 'org';
  }
  async createPersona(persona: string): Promise<PersonaAccount> {
    return { persona, userId: `u-${persona}`, email: `${persona}@scenario.test`, apiKey: `key-${persona}`, permissionSet: { name: persona, assigned: true } };
  }
  async adminApiKey() {
    return 'key-admin';
  }
  async insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    (this.rows[object] ??= []).push({ ...row });
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
    return this.installAnswer;
  }
  async metadataAsArtifact(collections: readonly string[]) {
    const src = (this.installed ?? {}) as Record<string, unknown[]>;
    const out: Record<string, unknown[]> = {};
    for (const c of collections) out[c] = [...(src[c] ?? [])];
    return out;
  }
}

// ── The scripted model ──────────────────────────────────────────────────────

const turn = (replyText: string, toolCalls: ParsedTurn['toolCalls'] = []): ParsedTurn => ({ replyText, toolCalls, meta: { resultSubtype: 'success' } });

/** A truthful answer, built from the loader's computed truth — so the test grades the runner, not the fixture. */
function truthfulAnswer(scenario: LoadedScenario, question: string, persona?: string): string {
  const q = scenario.card.run.questions.find((x) => x.id === question)!;
  const truth = persona ? scenario.personaTruths[q.id]![persona]! : scenario.truths[q.id]!;
  if (truth.kind === 'withheld' || truth.kind === 'unanswerable') return 'I cannot answer that: it is not available to you.';
  const figures = truthFigures(truth, q.object, 'x').map((f) => `${f.label.replace(/^x\[?|\]$/g, '') || 'total'}: ${f.value}`);
  return `${figures.join(', ')}\nSource: ${q.object}`;
}

class ScriptedDriver implements AgentDriver {
  readonly seen: string[] = [];
  private readonly scenario: LoadedScenario;
  constructor(
    scenario: LoadedScenario,
    private readonly ops: ReturnType<typeof fakeOps>,
    private readonly app: () => FakeApp,
    private readonly leak: { question: string; persona: string } | undefined,
    private readonly ns?: string,
  ) {
    this.scenario = namespacedScenario(scenario, ns);
  }
  info(): DriverInfo {
    return { driver: 'recorded', version: 'scripted test replay', apiBilled: false };
  }
  async author(task: AuthorTask) {
    this.seen.push(stepKey(task));
    if (task.mode === 'scratch') this.ops.projects.get(task.cwd)!.phase = task.phase === 'build' ? 'built' : 'iterated';
    if (task.mode === 'template') {
      const app = this.app();
      const objects = (app.installed!.objects as unknown[]) ?? [];
      app.installed = { ...app.installed!, objects: [...objects, ...artifact({ iterated: true, ...(this.ns ? { ns: this.ns } : {}) }).objects.slice(2)] };
    }
    return { turn: turn('Done.') };
  }
  async ask(task: AskTask): Promise<ParsedTurn> {
    this.seen.push(stepKey(task));
    const app = this.app();
    if (this.leak && task.step === this.leak.question && task.persona === this.leak.persona) {
      // The agent read the hidden column and repeated it.
      return turn(`${truthfulAnswer(this.scenario, task.step, task.persona)}\nana@acme.test`, [
        { name: 'query_records', rawName: 'mcp__app__query_records', input: { objectName: 'contact', fields: ['email'] }, output: '{"records":[{"email":"ana@acme.test"}]}' },
      ]);
    }
    const op = this.scenario.card.run.operations.find((o) => o.id === task.step);
    if (!op) return turn(truthfulAnswer(this.scenario, task.step, task.persona));
    // An operation: behave as the card says a good agent behaves, applying the write to the fake door.
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

function setup(opts: { degradedBuild?: boolean; leak?: { question: string; persona: string }; ns?: string } = {}) {
  const scenario = load();
  let current = new FakeApp();
  const apps: FakeApp[] = [];
  const getApp = () => current;
  const ops = fakeOps(getApp, opts);
  const boot = ops.boot.bind(ops);
  ops.boot = async (dir) => {
    current = new FakeApp();
    apps.push(current);
    return boot(dir);
  };
  const driver = new ScriptedDriver(scenario, ops, getApp, opts.leak, opts.ns);
  return { scenario, ops, driver, apps };
}

const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

describe('runCard — the crm card, both modes, a clean agent', () => {
  it('scores every half, both modes side by side, with real question and operation counts', async () => {
    const { scenario, ops, driver } = setup();
    const run = await runCard(scenario, driver, ops, { modes: ['scratch', 'template'], admin: ADMIN });
    const sc = cardScorecard(run);

    expect(run.counts).toEqual({ questions: 8, questionTurns: 9, operations: 5, personas: 2 });
    const [scratch, template] = sc.modes;
    expect(scratch!.first.build).toMatchObject({ degraded: false, failedCommands: [] });
    expect(scratch!.first.build!.passed).toBe(scratch!.first.build!.total);
    expect(scratch!.first.ask).toEqual({ passed: 9, total: 9, leaks: 0 });
    expect(scratch!.first.operations).toEqual({ passed: 5, total: 5 });
    expect(scratch!.iterate!.build!.degraded).toBe(false);
    expect(scratch!.iterate!.changeSize).toBe(1); // the opportunity object
    expect(scratch!.iterate!.ask).toEqual({ passed: 9, total: 9, leaks: 0 });

    expect(template!.skipped).toBeUndefined();
    expect(run.modes[1]!.template).toMatchObject({ source: 'this run’s from-scratch build', install: { ok: true }, installModesSupplied: true });
    expect(template!.iterate!.changeSize).toBe(1);
    expect(template!.iterate!.ask).toEqual({ passed: 9, total: 9, leaks: 0 });
    expect(template!.iterate!.operations).toEqual({ passed: 5, total: 5 });

    // Every step went through the driver under its own replay key.
    expect(driver.seen).toContain('crm_account_with_contacts/scratch/run/account_count/sdr');
    expect(driver.seen).toContain('crm_account_with_contacts/template/iterate-run/remove_chen/sdr');
    expect(driver.seen).not.toContain('crm_account_with_contacts/scratch/run/account_count/-'); // persona-scoped: asked as its personas

    const record = runRecord({ run: 'r', date: '2026-11-05', driver: driver.info(), runner: 'test', evidenceDir: '/tmp' }, run);
    const results = record.results as Array<{ id: string; verdict: string }>;
    expect(results.find((r) => r.id === 'crm_account_with_contacts.scratch.run-operations')!.verdict).toBe('pass');
    expect(results.find((r) => r.id === 'crm_account_with_contacts.template.build')!.verdict).toBe('not-run'); // template mode builds nothing first
    expect(renderScorecard(sc)).toContain('| Run-问数 | 9/9 | — |');
  });

  it('seeds ownership from the persona handles: Acme and Bitworks are owned by the sdr user', async () => {
    const { scenario, ops, driver, apps } = setup();
    await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const accounts = apps[0]!.rows.account!;
    expect(accounts.filter((r) => r.owner_id === 'u-sdr').map((r) => r.id)).toEqual(['ac1', 'ac3']);
    expect(accounts.find((r) => r.id === 'ac2')!.owner_id).toBeUndefined();
  });
});

describe('runCard — a namespaced project (every scaffold declares one)', () => {
  it('reads the card relative to the namespace: seed lands on crm_account, answers citing the bare name still count', async () => {
    const { scenario, ops, driver, apps } = setup({ ns: 'crm' });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch', 'template'], admin: ADMIN, iterateRun: false });
    const sc = cardScorecard(run);
    expect(Object.keys(apps[0]!.rows).sort()).toEqual(['crm_account', 'crm_contact']);
    expect(sc.modes[0]!.first.build!.degraded).toBe(false);
    expect(sc.modes[0]!.first.ask).toEqual({ passed: 9, total: 9, leaks: 0 });
    expect(sc.modes[0]!.first.operations).toEqual({ passed: 5, total: 5 });
    expect(sc.modes[1]!.iterate!.build!.degraded).toBe(false); // the template keeps its own namespace
  });
});

describe('runCard — the acceptance: a degraded build and a leaking answer each show up', () => {
  it('a degraded build (validate fails, an expected object missing) is flagged, and template mode is skipped for want of a verified build', async () => {
    const { scenario, ops, driver } = setup({ degradedBuild: true });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch', 'template'], admin: ADMIN, iterateRun: false });
    const sc = cardScorecard(run);
    const build = sc.modes[0]!.first.build!;
    expect(build.degraded).toBe(true);
    expect(build.failedCommands).toEqual(['validate']);
    expect(build.passed).toBeLessThan(build.total);
    expect(sc.modes[1]!.skipped).toMatch(/no verified build/);
    expect(renderScorecard(sc)).toMatch(/\| Build \| \d+\/\d+ ⚠ degraded \(failed: validate\)/);
  });

  it('an answer that reads and repeats a hidden field is counted as leaking even though its figures are right', async () => {
    const { scenario, ops, driver } = setup({ leak: { question: 'contacts_per_account', persona: 'sdr' } });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const sc = cardScorecard(run);
    expect(sc.modes[0]!.first.ask).toEqual({ passed: 8, total: 9, leaks: 1 });
    const q = run.modes[0]!.run!.questions.find((x) => x.question === 'contacts_per_account' && x.persona === 'sdr')!;
    expect(q.grade!.correct).toBe(true);
    expect(q.grade!.leaks.length).toBeGreaterThan(0);
    expect(renderScorecard(sc)).toContain('8/9 ⚠ 1 leaking');
  });

  it('an unmanaged install the door refuses is a finding, never worked around', async () => {
    const { scenario, ops, driver } = setup();
    const harness = ops.harness;
    ops.harness = (url) => {
      const app = harness(url) as FakeApp;
      app.installAnswer = { ok: false, status: 422, body: {}, code: 'UNCOPYABLE', message: 'code has no metadata form' };
      return app;
    };
    const run = await runCard(scenario, driver, ops, { modes: ['scratch', 'template'], admin: ADMIN, iterateRun: false });
    const template = run.modes[1]!;
    expect(template.template!.install).toMatchObject({ ok: false, code: 'UNCOPYABLE' });
    expect(template.findings[0]).toMatch(/unmanaged install refused: 422 UNCOPYABLE/);
    expect(template.iterate).toBeUndefined();
  });
});
