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
 * the scorecard. And the names: every project is in the card's own namespace
 * (`democrm`), and a build naming any non-object item without that prefix
 * fails its Build half.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { truthFigures } from '../../src/score/index.js';
import type { AppHarness, HttpAnswer, PersonaAccount, ToolAnswer } from '../../src/runner/app.js';
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

const NS = 'democrm';

function artifact(opts: { degraded?: boolean; iterated?: boolean; ns?: string; bareItems?: boolean } = {}) {
  const ns = opts.ns ?? NS;
  const n = (name: string) => `${ns}_${name}`;
  const objects: unknown[] = [
    { name: n('account'), fields: { name: { type: 'text' }, industry: select(['tech', 'retail']), owner: { type: 'text' } } },
  ];
  if (!opts.degraded) {
    const action = (name: string, confirm = false) => ({ name, ai: { exposed: true, ...(confirm ? { requiresConfirmation: true } : {}) } });
    objects.push({
      name: n('contact'),
      fields: { full_name: { type: 'text' }, email: { type: 'email' }, account: { type: 'lookup', reference: n('account') } },
      actions: [action(n('create_contact')), action(n('reassign_contact')), action(n('delete_contact'), true)],
    });
  }
  if (opts.iterated) {
    objects.push({ name: n('opportunity'), fields: { stage: select(['a', 'b', 'c', 'd']), account: { type: 'lookup', reference: n('account') } } });
  }
  return {
    manifest: { id: `com.example.${ns}`, namespace: ns },
    objects,
    permissions: [
      { name: n('sdr'), objects: { [n('account')]: { allowRead: true }, [n('contact')]: { allowRead: true, allowCreate: true, allowEdit: true } }, fields: { [`${n('contact')}.email`]: { readable: false } } },
      { name: n('partner_user'), objects: { [n('contact')]: { allowRead: true, allowCreate: true } } },
    ],
    // A build that names a view and a dashboard bare: the objects are prefixed (defineStack insists), these are not.
    ...(opts.bareItems ? { views: [{ name: 'all_accounts', object: n('account') }], dashboards: [{ name: 'overview', widgets: [] }] } : {}),
  };
}

// ── The fake project lifecycle ──────────────────────────────────────────────

interface FakeProject {
  phase: 'scaffolded' | 'built' | 'iterated';
}

function fakeOps(app: () => FakeApp, opts: { degradedBuild?: boolean; bareItems?: boolean; declares?: string } = {}): ProjectOps & { projects: Map<string, FakeProject>; scaffolded: string[] } {
  const projects = new Map<string, FakeProject>();
  const scaffolded: string[] = [];
  const ok = (command: string) => ({ command, exit: 0, tail: '', ms: 1 });
  return {
    projects,
    scaffolded,
    async scaffold(name, under) {
      const dir = `${under}/${name}`;
      scaffolded.push(dir);
      projects.set(dir, { phase: 'scaffolded' });
      return { dir, result: ok(`create-objectstack ${name}`) };
    },
    async os(dir, args) {
      const degraded = opts.degradedBuild && projects.get(dir)!.phase === 'built';
      return { command: `npx objectstack ${args.join(' ')}`, exit: degraded && args[0] === 'validate' ? 1 : 0, tail: '', ms: 1 };
    },
    readArtifact(dir) {
      const p = projects.get(dir)!;
      if (p.phase === 'scaffolded') return undefined;
      return artifact({ degraded: opts.degradedBuild && p.phase === 'built', iterated: p.phase === 'iterated', ...(opts.bareItems ? { bareItems: true } : {}) });
    },
    async boot() {
      return { url: 'http://fake', stop: async () => {}, log: () => '' };
    },
    harness: () => app(),
    // As create-objectstack does: the namespace is the project name, unless a test says otherwise.
    namespace: (dir) => opts.declares ?? dir.slice(dir.lastIndexOf('/') + 1),
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
  grants: string[] = [];
  /** What a fresh environment already serves without any prefix (measured: `setup`, `admin_full_access`, …). */
  platform: Record<string, unknown[]> = { apps: [{ name: 'setup' }], permissions: [{ name: 'admin_full_access', objects: {} }] };
  async signInAdmin() {}
  adminUserId() {
    return 'u-admin';
  }
  organizationId() {
    return 'org';
  }
  async createPersona(persona: string, permissionSet: string): Promise<PersonaAccount> {
    this.grants.push(permissionSet);
    return { persona, userId: `u-${persona}`, email: `${persona}@scenario.test`, apiKey: `key-${persona}`, permissionSet: { name: permissionSet, assigned: true } };
  }
  async adminApiKey() {
    return 'key-admin';
  }
  async insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    (this.rows[object] ??= []).push({ ...row });
    return { ok: true, status: 200, body: {} };
  }
  async updateRow(object: string, id: string, patch: Record<string, unknown>): Promise<HttpAnswer> {
    const row = (this.rows[object] ?? []).find((r) => r.id === id);
    if (!row) return { ok: false, status: 404, body: {}, code: 'NOT_FOUND', message: `no ${object} ${id}` };
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
    return this.installAnswer;
  }
  async metadataAsArtifact(collections: readonly string[]) {
    const src = (this.installed ?? {}) as Record<string, unknown[]>;
    const out: Record<string, unknown[]> = {};
    for (const c of collections) out[c] = [...(this.platform[c] ?? []), ...(src[c] ?? [])];
    return out;
  }
  /** Every MCP call the runner made itself (the validation probe), with the key it sent. */
  toolCalls: Array<{ apiKey: string; tool: string; args: Record<string, unknown> }> = [];
  /** A broken app: its write door stores the invalid write instead of refusing it. */
  storesInvalidWrites = false;
  async callTool(apiKey: string, tool: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    this.toolCalls.push({ apiKey, tool, args });
    if (!this.storesInvalidWrites) return { output: JSON.stringify({ error: { code: 'VALIDATION_FAILED', status: 400 } }, null, 2), isError: true };
    const { objectName, recordId, data } = args as { objectName: string; recordId?: string; data: Record<string, unknown> };
    const rows = (this.rows[objectName] ??= []);
    if (recordId !== undefined) Object.assign(rows.find((r) => r.id === recordId)!, data);
    else rows.push({ id: `probe-${rows.length}`, ...data });
    return { output: JSON.stringify({ id: recordId ?? `probe-${rows.length - 1}` }), isError: false };
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
    /** The agent catches a validation operation's bad value itself and writes nothing (#30883 item 2). */
    private readonly preValidates = false,
  ) {
    this.scenario = namespacedScenario(scenario);
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
      app.installed = { ...app.installed!, objects: [...objects, ...artifact({ iterated: true }).objects.slice(2)] };
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
    if (this.preValidates && op.outcome.kind === 'refused' && op.outcome.code === 'VALIDATION_FAILED') {
      return turn(`"${String(op.values?.email)}" is not a valid email address, so I have not saved the contact. Could you give me the full address?`);
    }
    if (op.outcome.kind === 'refused') {
      return turn('That was refused.', [{ name: `${op.kind}_record`, rawName: 'x', input: { objectName: op.object }, output: JSON.stringify({ error: { code: op.outcome.code } }), isError: true }]);
    }
    return turn('This cannot be undone — do you want me to delete it? Please confirm.');
  }
}

function setup<A extends FakeApp = FakeApp>(
  opts: { degradedBuild?: boolean; leak?: { question: string; persona: string }; bareItems?: boolean; declares?: string; app?: () => A; preValidates?: boolean } = {},
) {
  const scenario = load();
  const fresh = opts.app ?? (() => new FakeApp() as A);
  let current = fresh();
  const apps: A[] = [];
  const getApp = () => current;
  const ops = fakeOps(getApp, opts);
  const boot = ops.boot.bind(ops);
  ops.boot = async (dir) => {
    current = fresh();
    apps.push(current);
    return boot(dir);
  };
  const driver = new ScriptedDriver(scenario, ops, getApp, opts.leak, opts.preValidates);
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
    expect(scratch!.first.ask).toEqual({ passed: 9, total: 9, leaks: 0, notMeasured: 0 });
    expect(scratch!.first.operations).toEqual({ passed: 5, total: 5, notMeasured: 0 });
    expect(scratch!.iterate!.build!.degraded).toBe(false);
    expect(scratch!.iterate!.changeSize).toBe(1); // the opportunity object
    expect(scratch!.iterate!.ask).toEqual({ passed: 9, total: 9, leaks: 0, notMeasured: 0 });

    expect(template!.skipped).toBeUndefined();
    expect(run.modes[1]!.template).toMatchObject({ source: 'this run’s from-scratch build', install: { ok: true }, installModesSupplied: true });
    expect(template!.iterate!.changeSize).toBe(1);
    expect(template!.iterate!.ask).toEqual({ passed: 9, total: 9, leaks: 0, notMeasured: 0 });
    expect(template!.iterate!.operations).toEqual({ passed: 5, total: 5, notMeasured: 0 });

    // Every step went through the driver under its own replay key.
    expect(driver.seen).toContain('crm_account_with_contacts/scratch/run/account_count/sdr');
    expect(driver.seen).toContain('crm_account_with_contacts/template/iterate-run/remove_ben/sdr');
    expect(driver.seen).not.toContain('crm_account_with_contacts/scratch/run/account_count/-'); // persona-scoped: asked as its personas

    const record = runRecord({ run: 'r', date: '2026-11-05', driver: driver.info(), runner: 'test', evidenceDir: '/tmp' }, run);
    const results = record.results as Array<{ id: string; verdict: string }>;
    expect(results.find((r) => r.id === 'crm_account_with_contacts.scratch.run-operations')!.verdict).toBe('pass');
    expect(results.find((r) => r.id === 'crm_account_with_contacts.template.build')!.verdict).toBe('not-run'); // template mode builds nothing first
    expect(renderScorecard(sc)).toContain('| Run-问数 | 9/9 | — |');
    expect(renderScorecard(sc)).toContain('| Seed | 8/8 | — |'); // every row loaded: no warning
  });

  it('seeds ownership from the persona handles: Acme and Bitworks are owned by the sdr user, Shopwell by the admin', async () => {
    const { scenario, ops, driver, apps } = setup();
    await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const accounts = apps[0]!.rows.democrm_account!;
    expect(accounts.filter((r) => r.owner_id === 'u-sdr').map((r) => r.id)).toEqual(['ac1', 'ac3']);
    expect(accounts.find((r) => r.id === 'ac2')!.owner_id).toBe('u-admin');
  });
});

/**
 * The data door of a faithful build: `account.owner` is a user lookup and
 * `contact.account` a lookup to account, and the door refuses a value naming
 * no such record, as the first live run's app did (`VALIDATION_FAILED ·
 * Account Owner: no sys_user record has id "u_sam"`). Built from the card in
 * the repo, not from that run's recording, which this container does not hold.
 */
class UserLookupApp extends FakeApp {
  readonly users = new Set(['u-admin']);
  override async createPersona(persona: string, permissionSet: string): Promise<PersonaAccount> {
    const acct = await super.createPersona(persona, permissionSet);
    this.users.add(acct.userId);
    return acct;
  }
  override async insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    const refuse = (message: string): HttpAnswer => ({ ok: false, status: 400, body: { error: message, code: 'VALIDATION_FAILED' }, code: 'VALIDATION_FAILED', message });
    for (const userField of ['owner', 'owner_id']) {
      const v = row[userField];
      if (object === 'democrm_account' && v !== undefined && !this.users.has(String(v))) return refuse(`Account Owner: no sys_user record has id "${String(v)}"`);
    }
    if (object === 'democrm_contact' && row.account !== null && !(this.rows.democrm_account ?? []).some((a) => a.id === row.account)) {
      return refuse(`Account: no democrm_account record has id "${String(row.account)}"`);
    }
    return super.insertRow(object, row);
  }
}

describe('runCard — the seed against a build whose owner field is a user lookup', () => {
  it('the double refuses the handle the old seed sent, so it can fail', async () => {
    const app = new UserLookupApp();
    expect(await app.insertRow('democrm_account', { id: 'ac1', name: 'Acme', industry: 'tech', owner: 'u_sam', owner_id: 'u-admin' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await app.insertRow('democrm_contact', { id: 'ct1', account: 'ac1' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('loads all 8 rows: the owner field carries the persona user id, and a handle no persona holds is the admin', async () => {
    const { scenario, ops, driver, apps } = setup({ app: () => new UserLookupApp() });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const seed = run.modes[0]!.run!.seed;
    expect(seed).toEqual({ inserted: 8, refused: [], handlesAsAdmin: ['u_tia'] });
    const owners = Object.fromEntries(apps[0]!.rows.democrm_account!.map((r) => [r.id, [r.owner, r.owner_id]]));
    expect(owners).toEqual({ ac1: ['u-sdr', 'u-sdr'], ac2: ['u-admin', 'u-admin'], ac3: ['u-sdr', 'u-sdr'] });
    expect(apps[0]!.rows.democrm_contact!.map((r) => r.id)).toEqual(['ct1', 'ct2', 'ct3', 'ct4', 'ct5', 'new-add_contact']); // the five seeded, then the sdr's add
    expect(apps[0]!.rows.democrm_contact!.find((r) => r.id === 'ct1')!.owner_id).toBeUndefined(); // a path scope (`account.owner`) owns nothing
    expect(cardScorecard(run).modes[0]!.first.operations).toEqual({ passed: 5, total: 5, notMeasured: 0 }); // every write found its seeded target
  });
});

describe('runCard — the card’s own namespace, demo + code', () => {
  it('scaffolds the project as democrm and reads the card relative to it; the template host is hostcrm', async () => {
    const { scenario, ops, driver, apps } = setup();
    const run = await runCard(scenario, driver, ops, { modes: ['scratch', 'template'], admin: ADMIN, iterateRun: false });
    const sc = cardScorecard(run);
    expect(ops.scaffolded).toEqual(['crm-account-with-contacts-scratch/democrm', 'crm-account-with-contacts-template/hostcrm']);
    expect(Object.keys(apps[0]!.rows).sort()).toEqual(['democrm_account', 'democrm_contact']);
    expect(apps[0]!.grants).toEqual(['democrm_sdr', 'democrm_partner_user']);
    expect(run.modes[0]!.run!.personas.map((p) => p.permissionSet.name)).toEqual(['democrm_sdr', 'democrm_partner_user']);
    expect(sc.modes[0]!.first.build!.degraded).toBe(false);
    expect(run.modes[0]!.build!.score!.naming).toEqual([]);
    expect(sc.modes[0]!.first.ask).toEqual({ passed: 9, total: 9, leaks: 0, notMeasured: 0 });
    expect(sc.modes[0]!.first.operations).toEqual({ passed: 5, total: 5, notMeasured: 0 });
    // The installed copy keeps `democrm`; the environment's own unprefixed items (`setup`, `admin_full_access`) are not the app's.
    expect(apps[1]!.installed!.namespace).toBe('democrm');
    expect(sc.modes[1]!.iterate!.build!.degraded).toBe(false);
    expect(run.modes[1]!.iterate!.build.score!.naming).toEqual([]);
  });

  it('a project whose scaffold declares another namespace is skipped, never read against it', async () => {
    const { scenario, ops, driver } = setup({ declares: 'crm_account_w' });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN });
    expect(run.modes[0]!.skipped).toMatch(/declares namespace `crm_account_w`, not the card's `democrm`/);
    expect(driver.seen).toEqual([]);
  });

  it('a supplied template declaring another namespace is skipped, never installed', async () => {
    const { scenario, ops, driver } = setup();
    const run = await runCard(scenario, driver, ops, { modes: ['template'], admin: ADMIN, templateArtifact: artifact({ ns: 'crm' }) });
    expect(run.modes[0]!.skipped).toMatch(/template declares namespace `crm`, not the card's `democrm`/);
    expect(ops.scaffolded).toEqual([]);
  });

  it('a build naming a non-object item bare fails its Build half: one finding per item, and it is never verified', async () => {
    const { scenario, ops, driver } = setup({ bareItems: true });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch', 'template'], admin: ADMIN, iterateRun: false });
    const sc = cardScorecard(run);
    expect(run.modes[0]!.build!.score!.expect.checks.every((c) => c.pass)).toBe(true); // every expected name is there…
    expect(run.modes[0]!.build!.score!.naming.map((c) => c.check)).toEqual(['bare-name:dashboard:overview', 'bare-name:view:all_accounts']);
    expect(sc.modes[0]!.first.build!.degraded).toBe(true); // …and the build still fails
    expect(sc.modes[1]!.skipped).toMatch(/no verified build/);
    expect(sc.modes[0]!.findings).toEqual([
      expect.stringMatching(/^build: bare item name dashboard overview \(.*`democrm_<short>`/),
      expect.stringMatching(/^build: bare item name view all_accounts /),
      expect.stringMatching(/^iterate build: bare item name dashboard overview /),
      expect.stringMatching(/^iterate build: bare item name view all_accounts /),
    ]);
    expect(renderScorecard(sc)).toContain('- scratch finding: build: bare item name view all_accounts');
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
    expect(sc.modes[0]!.first.ask).toEqual({ passed: 8, total: 9, leaks: 1, notMeasured: 0 });
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

describe('runCard — the validation operation is probed by the runner itself (#30883 item 2, ruled B)', () => {
  const badEmail = (run: Awaited<ReturnType<typeof runCard>>) => run.modes[0]!.run!.operations.find((o) => o.operation === 'contact_bad_email')!;
  const failing = (o: { grade?: { checks: Array<{ check: string; pass: boolean }> } }) => o.grade!.checks.filter((c) => !c.pass).map((c) => c.check);

  it('sends the declared write once, after the turn, as the acting persona through its MCP door; a validating app passes it', async () => {
    const { scenario, ops, driver, apps } = setup();
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    expect(apps[0]!.toolCalls).toEqual([
      { apiKey: 'key-partner_user', tool: 'create_record', args: { objectName: 'democrm_contact', data: { full_name: 'Gil Ray', email: 'gil at acme' } } },
    ]);
    const op = badEmail(run);
    expect(op.observation!.probe).toEqual({ answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0 });
    expect([op.grade!.pass, op.error]).toEqual([true, undefined]);
    expect(cardScorecard(run).modes[0]!.first.operations).toEqual({ passed: 5, total: 5, notMeasured: 0 });
  });

  it('an agent that catches the bad value and asks for a correction passes; an app that stores the probe fails on the platform half alone', async () => {
    const good = setup({ preValidates: true });
    const op = badEmail(await runCard(good.scenario, good.driver, good.ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false }));
    expect([op.observation!.answer, op.observation!.writes, op.observation!.withheld, op.grade!.pass]).toEqual([{ kind: 'refused', code: '(no write attempted)' }, 0, true, true]);

    const broken = setup({ preValidates: true, app: () => Object.assign(new FakeApp(), { storesInvalidWrites: true }) });
    const run = await runCard(broken.scenario, broken.driver, broken.ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    expect(failing(badEmail(run))).toEqual(['platform:refused:VALIDATION_FAILED', 'platform:no-write']);
    expect(broken.apps[0]!.rows.democrm_contact!.filter((r) => r.email === 'gil at acme')).toHaveLength(1); // the probe's own row
    expect(cardScorecard(run).modes[0]!.first.operations).toEqual({ passed: 4, total: 5, notMeasured: 0 });
  });

  it('a probe the door never answered leaves the platform half not observed, and the operation says why', async () => {
    class DownApp extends FakeApp {
      override async callTool(): Promise<ToolAnswer> {
        throw new Error('tools/call create_record: 502');
      }
    }
    const { scenario, ops, driver } = setup({ app: () => new DownApp() });
    const op = badEmail(await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false }));
    expect(op.error).toBe('probe: tools/call create_record: 502');
    expect(failing(op)).toEqual(['platform:refused:VALIDATION_FAILED', 'platform:no-write']);
    expect(op.grade!.checks.find((c) => c.check === 'platform:no-write')).toEqual({ check: 'platform:no-write', pass: false, detail: 'not observed' });
  });
});

/** A data door that refuses the seed rows it is told to, as a build whose validation rejects them would. */
class RefusingApp extends FakeApp {
  constructor(private readonly refuse: ReadonlySet<string>) {
    super();
  }
  override async insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    if (this.refuse.has(`${object}/${String(row.id)}`)) {
      return { ok: false, status: 400, body: {}, code: 'VALIDATION_FAILED', message: `${object} ${String(row.id)} refused` };
    }
    return super.insertRow(object, row);
  }
}

class ThrowingApp extends RefusingApp {
  constructor(private readonly throwAt: string) {
    super(new Set(['democrm_account/ac2']));
  }
  override async insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    if (`${object}/${String(row.id)}` === this.throwAt) throw new Error('connection reset while seeding');
    return super.insertRow(object, row);
  }
}

describe('runCard — a seed insert that throws keeps the partial tally in the record', () => {
  it('ac1 and ac3 inserted, ac2 refused, then ct1 throws: the half records exactly that next to its error', async () => {
    const { scenario, ops, driver } = setup({ app: () => new ThrowingApp('democrm_contact/ct1') });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const half = run.modes[0]!.run!;
    expect(half.error).toContain('connection reset while seeding');
    expect(half.seed).toEqual({ inserted: 2, refused: [{ object: 'democrm_account', id: 'ac2', code: 'VALIDATION_FAILED', message: 'democrm_account ac2 refused' }], handlesAsAdmin: ['u_tia'] });
    expect(half.questions).toEqual([]);
    expect(cardScorecard(run).modes[0]!.first.seed).toEqual({ inserted: 2, total: 3, refused: 1 }); // total counts the rows the tally reached
  });
});

describe('runCard — a refused seed row makes what reads it not measured, never a fail', () => {
  it('shows ⚠ seed: 1 refused, leaves the questions on that object unasked and unscored, and grades the rest as usual', async () => {
    const { scenario, ops, driver } = setup({ app: () => new RefusingApp(new Set(['democrm_contact/ct4'])) });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const half = run.modes[0]!.run!;
    expect(half.seed).toMatchObject({ inserted: 7, refused: [{ object: 'democrm_contact', id: 'ct4', code: 'VALIDATION_FAILED' }] });

    // Every contact question is out (its object lost ct4); the account questions are asked and graded.
    const out = half.questions.filter((q) => q.notMeasured).map((q) => `${q.question}/${q.persona ?? '-'}`);
    expect(out).toEqual(['contacts_per_account/sdr', 'unattached_contacts/-', 'best_covered_account/-', 'tech_contacts/-', 'contacts_by_industry/-']);
    expect(half.questions.find((q) => q.notMeasured)!.notMeasured).toBe('seed: needs democrm_contact ct4, which the app refused');
    expect(half.questions.filter((q) => q.notMeasured).every((q) => q.grade === undefined && q.turn === undefined)).toBe(true);
    expect(driver.seen).not.toContain('crm_account_with_contacts/scratch/run/tech_contacts/-');
    expect(half.operations.filter((o) => o.notMeasured)).toEqual([]); // no operation names ct4

    const sc = cardScorecard(run);
    expect(sc.modes[0]!.first.seed).toEqual({ inserted: 7, total: 8, refused: 1 });
    expect(sc.modes[0]!.first.ask).toEqual({ passed: 4, total: 4, leaks: 0, notMeasured: 5 });
    expect(sc.modes[0]!.first.operations).toEqual({ passed: 5, total: 5, notMeasured: 0 });
    const table = renderScorecard(sc);
    expect(table).toContain('| Seed | 7/8 ⚠ seed: 1 refused |');
    expect(table).toContain('| Run-问数 | 4/4 · 5 not measured |');
    const record = runRecord({ run: 'r', date: '2026-11-06', driver: driver.info(), runner: 'test', evidenceDir: '/tmp' }, run);
    const ask = (record.results as Array<{ id: string; verdict: string; notes: string }>).find((r) => r.id === 'crm_account_with_contacts.scratch.run-ask')!;
    expect(ask).toMatchObject({ verdict: 'pass', notes: '4/4 · 5 not measured' });
  });

  it('an operation whose target hangs off a refused row is not run; a half with nothing measured is not-run, not fail', async () => {
    const { scenario, ops, driver } = setup({ app: () => new RefusingApp(new Set(['democrm_account/ac1', 'democrm_account/ac2', 'democrm_account/ac3'])) });
    const run = await runCard(scenario, driver, ops, { modes: ['scratch'], admin: ADMIN, iterateRun: false });
    const half = run.modes[0]!.run!;
    expect(half.seed.inserted).toBe(5); // the double does not cascade; the runner still takes the contacts out
    expect(half.operations.filter((o) => !o.notMeasured).map((o) => o.operation)).toEqual(['contact_bad_email']);
    expect(half.questions.every((q) => q.notMeasured)).toBe(true);
    const sc = cardScorecard(run);
    expect(sc.modes[0]!.first.ask).toEqual({ passed: 0, total: 0, leaks: 0, notMeasured: 9 });
    expect(renderScorecard(sc)).toContain('| Seed | 5/8 ⚠ seed: 3 refused |');
    const record = runRecord({ run: 'r', date: '2026-11-06', driver: driver.info(), runner: 'test', evidenceDir: '/tmp' }, run);
    const verdict = (id: string) => (record.results as Array<{ id: string; verdict: string }>).find((r) => r.id === id)!.verdict;
    expect(verdict('crm_account_with_contacts.scratch.run-ask')).toBe('not-run');
    expect(verdict('crm_account_with_contacts.scratch.run-operations')).toBe('pass');
  });
});
