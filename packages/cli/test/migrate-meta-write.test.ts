// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --write` — the codemod that writes the chain's MECHANICAL
 * edits into the authored sources (#9591).
 *
 * ## What is pinned
 *
 *  1. Exactness: over a project whose artifacts live in per-module `define*`
 *     calls, a `.create` factory, a barrel read through `Object.values(ns)` and
 *     an imported array, `--write` rewrites exactly the attributed sites —
 *     each written file equals its old bytes with only those sites edited, and
 *     every file it did not touch keeps its bytes. Both conversion shapes are
 *     covered: a key STRIPPED, a value REWRITTEN (and a key RENAMED).
 *  2. Idempotence: a second run over the written sources applies nothing and
 *     writes nothing.
 *  3. The semantic TODOs are never written, and stay listed exactly as the dry
 *     run lists them; the partial `compareTo` case writes its covered arm and
 *     leaves `{ offset: '7d' }` — which the conversion declines — untouched.
 *  4. Controls: without `--write` no source changes and the `--json` payload
 *     carries no `write` key; `--out` still writes its snapshot.
 *  5. Every refusal kind: the real-project kinds through the command, the
 *     kinds no live conversion can produce through the planner itself; each
 *     refused site keeps its bytes while its neighbours are written.
 *  6. The surface: `--write` is exclusive with `--stored` and refused there;
 *     the module names no conversion, so it stays generic over the chain.
 *
 * In-process over the real command (`MigrateMeta.run`), against temp projects
 * that link the real `@objectstack/spec`: no process is spawned and no kernel
 * is booted, so this file sits in the `unit` tier.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { MIGRATIONS_BY_MAJOR, MIGRATION_MAJORS, type MigrationApplication } from '@objectstack/spec/migrations';
import MigrateMeta from '../src/commands/migrate/meta.js';
import {
  planAuthoredSourceWrite,
  verifyAuthoredSourceWrite,
  type AuthoredSourceWritePlan,
  type CodemodRefusalKind,
} from '../src/utils/authored-source-codemod.js';

/**
 * A seam between planning and writing, for the two failure exits: the command
 * runs the real planner, and a test may act on the plan before the write.
 */
const hooks = vi.hoisted(() => ({ afterPlan: undefined as undefined | ((plan: AuthoredSourceWritePlan) => void) }));
vi.mock('../src/utils/authored-source-codemod.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/utils/authored-source-codemod.js')>();
  return {
    ...actual,
    planAuthoredSourceWrite: async (input: Parameters<typeof actual.planAuthoredSourceWrite>[0]) => {
      const plan = await actual.planAuthoredSourceWrite(input);
      hooks.afterPlan?.(plan);
      return plan;
    },
  };
});

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const CODEMOD_SOURCE = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'utils', 'authored-source-codemod.ts');
const RUN_TIMEOUT = 120_000;

/** `packages/cli` depends on `@objectstack/spec`; resolved as a package, not a source path. */
const requireFromCli = createRequire(import.meta.url);
const SPEC_PACKAGE_ROOT = dirname(requireFromCli.resolve('@objectstack/spec/package.json'));

let root: string;
let specLink: string;
let caseSeq = 0;

/** Write a fresh project (relative path → text) under the temp root; returns its directory. */
function writeProject(files: Record<string, string>): string {
  const dir = join(root, `case-${++caseSeq}`);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

/** Every file under a project (node_modules excluded), relative path → bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules') continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** `text` with `from` replaced by `to` — and `from` must occur exactly once, so an edit can never be a no-op. */
function edit(text: string, from: string, to: string): string {
  const parts = text.split(from);
  expect(parts.length, `expected exactly one occurrence of ${JSON.stringify(from)}`).toBe(2);
  return parts.join(to);
}

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

/** Run the real command in-process, capturing both streams and any exit. */
async function runMeta(dir: string, flags: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const priorExitCode = process.exitCode;
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    out.push(String(chunk));
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    done?.();
    return true;
  }) as never);
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  let exitCode: number | undefined;
  try {
    await MigrateMeta.run([join(dir, 'objectstack.config.ts'), '--from', '16', ...flags], { root: CLI_ROOT });
  } catch (e: any) {
    if (typeof e?.oclif?.exit !== 'number') throw e;
    exitCode = e.oclif.exit;
  } finally {
    write.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (exitCode === undefined && typeof process.exitCode === 'number' && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }
    process.exitCode = priorExitCode;
  }
  return {
    stdout: stripVTControlCharacters(out.join('\n')),
    stderr: stripVTControlCharacters(err.join('\n')),
    exitCode,
  };
}

function json(run: Run): any {
  return JSON.parse(run.stdout);
}

const sites = (list: Array<{ conversionId: string; path: string }>) =>
  list.map((a) => `${a.path} (${a.conversionId})`).sort();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-write-'));
  mkdirSync(join(root, 'node_modules', '@objectstack'), { recursive: true });
  specLink = join(root, 'node_modules', '@objectstack', 'spec');
  symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');
  // A package the refusal fixture imports a view from: `node_modules` is never written.
  mkdirSync(join(root, 'node_modules', 'fake-kit'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'fake-kit', 'package.json'), JSON.stringify({ name: 'fake-kit', main: 'index.js' }));
  writeFileSync(
    join(root, 'node_modules', 'fake-kit', 'index.js'),
    "exports.KitView = { object: 'rf_ticket', list: { type: 'grid', columns: ['title'], striped: true } };\n",
  );
});

afterAll(() => {
  // Unlinked BEFORE the recursive remove, and named explicitly: this symlink
  // points at the real `packages/spec`, and a cleanup must never follow it.
  try { unlinkSync(specLink); } catch { /* already gone */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── 1–4: the per-artifact project ───────────────────────────────────────────

const PROJECT: Record<string, string> = {
  'objectstack.config.ts': `import { defineStack } from '@objectstack/spec';
import * as dashboards from './src/dashboards/index.js';
import * as views from './src/views/index.js';
import { TicketObject } from './src/objects/ticket.object.js';
import { SupportAgent } from './src/agents/support.agent.js';
import { allFlows } from './src/flows/index.js';

export default defineStack({
  manifest: { id: 'com.example.write', name: 'Write fixture', version: '1.0.0', type: 'app' },
  objects: [TicketObject],
  // The document store, spelled the old way.
  datasources: [{ name: 'docs', label: 'Docs', driver: 'mongo', config: {} }],
  dashboards: Object.values(dashboards),
  views: Object.values(views),
  agents: [SupportAgent],
  flows: allFlows,
});
`,
  'src/dashboards/index.ts': `export * from './ops.dashboard.js';
export * from './kpi.dashboard.js';
`,
  'src/dashboards/ops.dashboard.ts': `import { Dashboard } from '@objectstack/spec/ui';

export const OpsDashboard = Dashboard.create({
  name: 'ops',
  label: 'Ops',
  widgets: [],
  refreshInterval: 300, // seconds
});
`,
  'src/dashboards/kpi.dashboard.ts': `import { Dashboard } from '@objectstack/spec/ui';

export const KpiDashboard = Dashboard.create({
  name: 'kpi',
  label: 'KPI',
  widgets: [
    { id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: 'previousPeriod' },
    { id: 'w2', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: { offset: '1y' } },
    { id: 'w3', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: { offset: '7d' } },
  ],
});
`,
  'src/views/index.ts': `export * from './ticket.view.js';
`,
  'src/views/ticket.view.ts': `import { defineView } from '@objectstack/spec';

export const TicketView = defineView({
  object: 'wr_ticket',
  list: {
    type: 'grid',
    columns: ['title'],
    // Zebra rows.
    striped: true,
    bordered: false, // no borders
  },
});
`,
  'src/agents/support.agent.ts': `import { defineAgent } from '@objectstack/spec';

export const SupportAgent = defineAgent({
  name: 'support_agent',
  label: 'Support',
  role: 'Support assistant',
  instructions: 'Help customers.',
  knowledge: {
    sources: ['faq'],
    indexes: ['docs'],
  },
});
`,
  'src/flows/index.ts': `import { EscalateFlow } from './escalate.flow.js';

export const allFlows = [EscalateFlow];
`,
  'src/flows/escalate.flow.ts': `import { defineFlow } from '@objectstack/spec';

export const EscalateFlow = defineFlow({
  name: 'escalate',
  label: 'Escalate',
  type: 'autolaunched',
  active: false,
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'done', type: 'end', label: 'Done' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'done' }],
});
`,
  'src/objects/ticket.object.ts': `import { ObjectSchema } from '@objectstack/spec/data';

export const TicketObject = ObjectSchema.create({
  name: 'wr_ticket',
  label: 'Ticket',
  fields: { title: { type: 'text', label: 'Title' } },
  tenancy: { enabled: true, organizationField: 'organization_id' },
});
`,
};

/** PROJECT after `--write`: each written file is its old bytes with ONLY the attributed sites edited. */
function expectedAfterWrite(): Record<string, string> {
  const p = PROJECT;
  return {
    ...p,
    'objectstack.config.ts': edit(p['objectstack.config.ts']!, "driver: 'mongo'", "driver: 'mongodb'"),
    'src/dashboards/ops.dashboard.ts': edit(p['src/dashboards/ops.dashboard.ts']!, 'refreshInterval: 300,', 'refreshIntervalSeconds: 300,'),
    'src/dashboards/kpi.dashboard.ts': edit(
      edit(p['src/dashboards/kpi.dashboard.ts']!, "compareTo: 'previousPeriod'", "compareTo: { kind: 'previousPeriod' }"),
      "compareTo: { offset: '1y' }",
      "compareTo: { kind: 'previousYear' }",
    ),
    'src/views/ticket.view.ts': edit(
      edit(p['src/views/ticket.view.ts']!, '    striped: true,\n', ''),
      '    bordered: false, // no borders\n',
      '',
    ),
    'src/agents/support.agent.ts': edit(
      p['src/agents/support.agent.ts']!,
      "  knowledge: {\n    sources: ['faq'],\n    indexes: ['docs'],\n  },\n",
      '',
    ),
    'src/flows/escalate.flow.ts': edit(p['src/flows/escalate.flow.ts']!, '  active: false,\n', ''),
    'src/objects/ticket.object.ts': edit(
      p['src/objects/ticket.object.ts']!,
      "tenancy: { enabled: true, organizationField: 'organization_id' }",
      'tenancy: { enabled: true }',
    ),
  };
}

const EXPECTED_SITES = [
  'agents[0].knowledge (agent-knowledge-removed)',
  'dashboards[0].widgets[0].compareTo (dashboard-widget-compareto-converged)',
  'dashboards[0].widgets[1].compareTo (dashboard-widget-compareto-converged)',
  'dashboards[1].refreshIntervalSeconds (dashboard-refresh-interval-to-refresh-interval-seconds)',
  'datasources[0].driver (datasource-driver-mongo-to-mongodb)',
  'flows[0].active (flow-inert-keys-removed)',
  'objects[0].tenancy.organizationField (object-tenancy-organization-field-removed)',
  'views[0].list.bordered (view-list-passthrough-keys-removed)',
  'views[0].list.striped (view-list-passthrough-keys-removed)',
];

describe('os migrate meta --write over per-artifact modules', () => {
  let dir: string;
  let dry: any;
  let first: Run;
  let firstJson: any;

  beforeAll(async () => {
    dir = writeProject(PROJECT);
    dry = json(await runMeta(dir, ['--json']));
    first = await runMeta(dir, ['--write', '--json']);
    firstJson = json(first);
  }, RUN_TIMEOUT * 2);

  it('the dry run lists the sites and writes no source (control)', () => {
    expect(sites(dry.applied)).toEqual(EXPECTED_SITES);
    expect(dry).not.toHaveProperty('write');
  });

  it('writes every attributed site, and only those bytes change', () => {
    expect(first.exitCode, first.stderr).toBeUndefined();
    expect(firstJson.write.status).toBe('written');
    expect(sites(firstJson.write.written)).toEqual(EXPECTED_SITES);
    expect(firstJson.write.manual).toEqual([]);
    expect(firstJson.write.unexplained).toEqual([]);
    expect(firstJson.write.verification).toEqual({ ok: true, stillApplied: [], vanished: [] });
    // Byte-for-byte, every file: the barrels and `index.ts` files included.
    expect(snapshot(dir)).toEqual(expectedAfterWrite());
    expect(firstJson.write.files.map((f: any) => f.file).sort()).toEqual([
      'objectstack.config.ts',
      'src/agents/support.agent.ts',
      'src/dashboards/kpi.dashboard.ts',
      'src/dashboards/ops.dashboard.ts',
      'src/flows/escalate.flow.ts',
      'src/objects/ticket.object.ts',
      'src/views/ticket.view.ts',
    ]);
  });

  it('reports each written site at its file and line as read', () => {
    const at = Object.fromEntries(firstJson.write.written.map((w: any) => [w.path, `${w.file}:${w.line}`]));
    expect(at['datasources[0].driver']).toBe('objectstack.config.ts:12');
    expect(at['dashboards[1].refreshIntervalSeconds']).toBe('src/dashboards/ops.dashboard.ts:7');
    expect(at['views[0].list.striped']).toBe('src/views/ticket.view.ts:9');
    expect(at['views[0].list.bordered']).toBe('src/views/ticket.view.ts:10');
  });

  it('writes the applied set and nothing else: every site it reports is an applied entry', () => {
    // What `--write` writes or leaves is exactly the chain's `applied` set —
    // never a semantic TODO, which the planner is not even handed.
    expect(sites([...firstJson.write.written, ...firstJson.write.manual])).toEqual(sites(firstJson.applied));
  });

  it('never writes a semantic TODO, and lists them as the dry run does', () => {
    // Relative to the dry run of the same build, not a pinned listing: which
    // notices the default list carries is the chain's business, not --write's.
    expect(firstJson.todos.map((t: any) => t.id)).toEqual(dry.todos.map((t: any) => t.id));
    // The `compareTo` arm the conversion declines has no mechanical change, so
    // its bytes stay — and the schema still refuses it, as before the write.
    expect(readFileSync(join(dir, 'src/dashboards/kpi.dashboard.ts'), 'utf8')).toContain("compareTo: { offset: '7d' }");
    expect(firstJson.schemaValid).toBe(false);
  });

  it('is idempotent: a second run applies nothing and writes nothing', async () => {
    const before = snapshot(dir);
    const second = json(await runMeta(dir, ['--write', '--json']));
    expect(second.applied).toEqual([]);
    expect(second.write.status).toBe('written');
    expect(second.write.files).toEqual([]);
    expect(second.write.written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  }, RUN_TIMEOUT);
});

describe('os migrate meta without --write (controls)', () => {
  it('writes no source file, and --out still writes its snapshot', async () => {
    const dir = writeProject(PROJECT);
    const before = snapshot(dir);
    const out = join(root, `snapshot-${caseSeq}.json`);
    const run = await runMeta(dir, ['--json', '--out', out]);
    expect(run.exitCode, run.stderr).toBeUndefined();
    expect(snapshot(dir)).toEqual(before);
    expect(JSON.parse(readFileSync(out, 'utf8')).datasources[0].driver).toBe('mongodb');
  }, RUN_TIMEOUT);

  it('prints the human report with --write, naming no capability it lacks', async () => {
    const dir = writeProject(PROJECT);
    const run = await runMeta(dir, ['--write']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    const group = run.stdout.slice(run.stdout.indexOf('Wrote '));
    expect(group).toMatch(/^Wrote 9 of 9 mechanical change\(s\) into 7 file\(s\):/);
    expect(group).toContain('Re-ran the chain over the written sources: no mechanical change remains.');
    // The group's own words; the spec's notices above it are the spec's.
    expect(group).not.toMatch(/automatic/i);
  }, RUN_TIMEOUT);
});

// ── 1 (cont.): the third shape — a conversion that ADDS a key ───────────────

const ADD_PROJECT: Record<string, string> = {
  'objectstack.config.ts': `import { defineStack } from '@objectstack/spec';
import { VerdictFlow } from './src/verdict.flow.js';

export default defineStack({
  manifest: { id: 'com.example.add', name: 'Add fixture', version: '1.0.0', type: 'app' },
  flows: [VerdictFlow],
});
`,
  'src/verdict.flow.ts': `import { defineFlow } from '@objectstack/spec';

export const VerdictFlow = defineFlow({
  name: 'lead_verdict',
  label: 'Lead verdict',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'verdict',
      type: 'decision',
      label: 'Verdict?' // the last key, with no comma after it
    },
    { id: 'gate', type: 'decision', label: 'Gate' },
    { id: 'refuse', type: 'end', label: 'Refuse' },
    { id: 'convert', type: 'end', label: 'Convert' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'verdict' },
    { id: 'e2', source: 'verdict', target: 'refuse', condition: "lead.status != 'suspected'" },
    { id: 'e3', source: 'verdict', target: 'convert', condition: "lead.status == 'confirmed'" },
    { id: 'e4', source: 'gate', target: 'refuse', condition: 'x > 1' },
    { id: 'e5', source: 'gate', target: 'convert', condition: 'x > 2' },
  ],
});
`,
};

describe('os migrate meta --write adds a key where the conversion adds one', () => {
  it('appends it after the last key — on its own line, or inline — and touches nothing else', async () => {
    const dir = writeProject(ADD_PROJECT);
    const run = await runMeta(dir, ['--write', '--json']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    const payload = json(run);
    expect(payload.write.manual).toEqual([]);
    expect(payload.write.written.map((w: any) => w.conversionId)).toEqual([
      'flow-decision-mode-inclusive-explicit',
      'flow-decision-mode-inclusive-explicit',
    ]);
    const flow = ADD_PROJECT['src/verdict.flow.ts']!;
    expect(snapshot(dir)).toEqual({
      ...ADD_PROJECT,
      'src/verdict.flow.ts': edit(
        edit(
          flow,
          "      label: 'Verdict?' // the last key, with no comma after it\n",
          "      label: 'Verdict?', // the last key, with no comma after it\n      config: { mode: 'inclusive' }\n",
        ),
        "{ id: 'gate', type: 'decision', label: 'Gate' }",
        "{ id: 'gate', type: 'decision', label: 'Gate', config: { mode: 'inclusive' } }",
      ),
    });
    expect(payload.write.verification.ok).toBe(true);
  }, RUN_TIMEOUT);
});

// ── the two failure exits: nothing is left half-written ─────────────────────

describe('os migrate meta --write fails closed', () => {
  it('writes nothing, and exits 1, when a file changed after it was read', async () => {
    const dir = writeProject(PROJECT);
    let touched = '';
    hooks.afterPlan = (plan) => {
      touched = plan.rewrites[0]!.path;
      writeFileSync(touched, `${readFileSync(touched, 'utf8')}// edited meanwhile\n`);
    };
    let run: Run;
    try {
      run = await runMeta(dir, ['--write', '--json']);
    } finally {
      hooks.afterPlan = undefined;
    }
    expect(run.exitCode).toBe(1);
    const payload = json(run);
    expect(payload.write.status).toBe('unwritten');
    expect(payload.write.error).toMatch(/changed on disk/);
    const rel = relative(realpathSync(dir), touched).split('\\').join('/');
    expect(snapshot(dir)).toEqual({ ...PROJECT, [rel]: `${PROJECT[rel]}// edited meanwhile\n` });
  }, RUN_TIMEOUT);

  it('restores every file, and exits 1, when the re-run disagrees with its report', async () => {
    const dir = writeProject(PROJECT);
    // A report claiming one more site left by hand than the chain will find.
    hooks.afterPlan = (plan) => {
      plan.manual.push({ application: applied('nowhere.at.all', 'probe-phantom'), refusal: { kind: 'computed', reason: 'r' } });
    };
    let run: Run;
    try {
      run = await runMeta(dir, ['--write']);
    } finally {
      hooks.afterPlan = undefined;
    }
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('every one was restored to its previous bytes');
    expect(run.stdout).toContain('no longer converted: nowhere.at.all (probe-phantom)');
    expect(snapshot(dir)).toEqual(PROJECT);
  }, RUN_TIMEOUT);
});

// ── 5: the refusals a real project produces ─────────────────────────────────

const REFUSALS: Record<string, string> = {
  'objectstack.config.ts': `import { defineStack } from '@objectstack/spec';
import { KitView } from 'fake-kit';

const MONGO = 'mongo';
const sharedList = { type: 'grid', columns: ['title'], striped: true };
const listBase = { bordered: true };
function makeAgent(name: string) {
  return { name, label: name, role: 'r', instructions: 'i', knowledge: { sources: ['faq'] } };
}

export default defineStack({
  manifest: { id: 'com.example.refusals', name: 'Refusals', version: '1.0.0', type: 'app' },
  objects: [{ name: 'rf_ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } }],
  datasources: [{ name: 'docs', label: 'Docs', driver: MONGO, config: {} }],
  views: [
    { object: 'rf_ticket', list: sharedList },
    { object: 'rf_ticket', list: sharedList },
    { object: 'rf_ticket', list: { ...listBase, type: 'grid', columns: ['title'] } },
    {
      object: 'rf_ticket',
      list: {
        type: 'grid', virtualScroll: true,
        columns: ['title'],
      },
    },
    KitView,
  ],
  agents: [makeAgent('helper_agent')],
  flows: [{ name: 'plain', label: 'Plain', type: 'autolaunched', active: true, nodes: [], edges: [] }],
});
`,
};

describe('os migrate meta --write refuses what it cannot prove, and says why', () => {
  let dir: string;
  let payload: any;

  beforeAll(async () => {
    dir = writeProject(REFUSALS);
    const run = await runMeta(dir, ['--write', '--json']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    payload = json(run);
  }, RUN_TIMEOUT * 2);

  const kindOf = (path: string): CodemodRefusalKind | undefined =>
    payload.write.manual.find((m: any) => m.path === path)?.kind;

  it('names the refusal kind of every site it leaves', () => {
    expect(kindOf('datasources[0].driver')).toBe('computed');
    expect(kindOf('views[0].list.striped')).toBe('shared');
    expect(kindOf('views[1].list.striped')).toBe('shared');
    expect(kindOf('views[2].list.bordered')).toBe('spread');
    expect(kindOf('views[3].list.virtualScroll')).toBe('layout');
    expect(kindOf('views[4].list.striped')).toBe('outside-project');
    expect(kindOf('agents[0].knowledge')).toBe('helper');
    expect(payload.write.manual).toHaveLength(7);
    for (const m of payload.write.manual) expect(m.reason.length).toBeGreaterThan(0);
  });

  it('still writes the site it can prove, beside them — and nothing else', () => {
    expect(sites(payload.write.written)).toEqual(['flows[0].active (flow-inert-keys-removed)']);
    expect(snapshot(dir)).toEqual({
      'objectstack.config.ts': edit(REFUSALS['objectstack.config.ts']!, ' active: true,', ''),
    });
    expect(payload.write.verification.ok).toBe(true);
  });

  it('lists each refused site for the author, with its kind, in the human report', async () => {
    const run = await runMeta(writeProject(REFUSALS), ['--write']);
    expect(run.exitCode, run.stderr).toBeUndefined();
    expect(run.stdout).toContain('Wrote 1 of 8 mechanical change(s) into 1 file(s):');
    expect(run.stdout).toContain('7 mechanical change(s) left for you to apply by hand:');
    for (const kind of ['computed', 'shared', 'spread', 'layout', 'outside-project', 'helper']) {
      expect(run.stdout).toContain(`not written [${kind}]:`);
    }
    expect(run.stdout).toContain('Re-ran the chain over the written sources: only the 7 change(s) left above remain.');
  }, RUN_TIMEOUT);
});

// ── 5 (cont.): the planner's own refusals, which no live conversion reaches ──

/** A single-file project for the planner. */
function plannerProject(source: string): string {
  return join(writeProject({ 'objectstack.config.ts': source }), 'objectstack.config.ts');
}

function applied(path: string, conversionId = 'probe'): MigrationApplication {
  return { toMajor: 18, conversionId, surface: 'probe', from: 'a', to: 'b', path };
}

describe('planAuthoredSourceWrite — the refusal kinds the planner owns', () => {
  it('mismatch: the loaded value disagrees with the literal', async () => {
    const configPath = plannerProject("export default { datasources: [{ name: 'docs', label: 'A', driver: 'mongo' }] };\n");
    const loaded = { datasources: [{ name: 'docs', label: 'B', driver: 'mongo' }] };
    const plan = await planAuthoredSourceWrite({
      configPath,
      config: loaded,
      namedExports: [],
      normalized: loaded,
      migrated: { datasources: [{ name: 'docs', label: 'B', driver: 'mongodb' }] },
      applied: [applied('datasources[0].driver')],
    });
    expect(plan.manual.map((m) => m.refusal.kind)).toEqual(['mismatch']);
    expect(plan.rewrites).toEqual([]);
  });

  it('injected: a map-form collection\'s `name` is the loader\'s; the key beside it is written', async () => {
    const source = "export default { objects: { t: { label: 'T' } } };\n";
    const configPath = plannerProject(source);
    const loaded = { objects: { t: { label: 'T' } } };
    const plan = await planAuthoredSourceWrite({
      configPath,
      config: loaded,
      namedExports: [],
      normalized: { objects: [{ label: 'T', name: 't' }] },
      migrated: { objects: [{ label: 'Ticket', name: 'u' }] },
      applied: [applied('objects[0].name', 'probe-name'), applied('objects[0].label', 'probe-label')],
    });
    expect(plan.manual.map((m) => [m.application.conversionId, m.refusal.kind])).toEqual([['probe-name', 'injected']]);
    expect(plan.written.map((w) => w.application.conversionId)).toEqual(['probe-label']);
    expect(plan.rewrites[0]!.after).toBe(edit(source, "label: 'T'", "label: 'Ticket'"));
  });

  it('unspellable: a converted value no literal can spell', async () => {
    const configPath = plannerProject("export default { datasources: [{ name: 'docs', driver: 'mongo' }] };\n");
    const loaded = { datasources: [{ name: 'docs', driver: 'mongo' }] };
    const plan = await planAuthoredSourceWrite({
      configPath,
      config: loaded,
      namedExports: [],
      normalized: loaded,
      migrated: { datasources: [{ name: 'docs', driver: () => 'mongodb' }] },
      applied: [applied('datasources[0].driver')],
    });
    expect(plan.manual.map((m) => m.refusal.kind)).toEqual(['unspellable']);
  });

  it('entangled: an entry is never half-written beside a refused edit it shares', async () => {
    const source = 'const N = 1;\nexport default { obj: { k: N, k2: 2 } };\n';
    const configPath = plannerProject(source);
    const loaded = { obj: { k: 1, k2: 2 } };
    const plan = await planAuthoredSourceWrite({
      configPath,
      config: loaded,
      namedExports: [],
      normalized: loaded,
      // `obj` explains both edits, `obj.k2` only its own: one component.
      migrated: { obj: { k: 3 } },
      applied: [applied('obj', 'probe-whole'), applied('obj.k2', 'probe-k2')],
    });
    expect(Object.fromEntries(plan.manual.map((m) => [m.application.conversionId, m.refusal.kind])))
      .toEqual({ 'probe-whole': 'computed', 'probe-k2': 'entangled' });
    expect(plan.rewrites).toEqual([]);
  });

  it('unattributed: an entry no edit can be tied to; an edit no entry names is never written', async () => {
    const configPath = plannerProject("export default { a: { x: 1 }, b: { y: 1 } };\n");
    const loaded = { a: { x: 1 }, b: { y: 1 } };
    const plan = await planAuthoredSourceWrite({
      configPath,
      config: loaded,
      namedExports: [],
      normalized: loaded,
      migrated: { a: { x: 1 }, b: { y: 2 } },
      applied: [applied('a.x')],
    });
    expect(plan.manual.map((m) => m.refusal.kind)).toEqual(['unattributed']);
    expect(plan.unexplained).toEqual(['b.y']);
    expect(plan.rewrites).toEqual([]);
  });
});

describe('verifyAuthoredSourceWrite — the re-run must match the report', () => {
  it('fails on a written site the re-run still converts, and on a manual one it no longer does', () => {
    const plan = {
      projectRoot: '/p',
      rewrites: [],
      written: [{ application: applied('a.x', 'w'), file: 'c.ts', line: 1 }],
      manual: [{ application: applied('b.y', 'm'), refusal: { kind: 'computed' as const, reason: 'r' } }],
      unexplained: [],
    };
    expect(verifyAuthoredSourceWrite(plan, [applied('b.y', 'm')]).ok).toBe(true);
    expect(verifyAuthoredSourceWrite(plan, [applied('b.y', 'm'), applied('a.x', 'w')]))
      .toEqual({ ok: false, stillApplied: ['a.x (w)'], vanished: [] });
    expect(verifyAuthoredSourceWrite(plan, [])).toEqual({ ok: false, stillApplied: [], vanished: ['b.y (m)'] });
  });
});

// ── 6: the surface ──────────────────────────────────────────────────────────

describe('the --write surface', () => {
  it('is exclusive with --stored, and refused there', async () => {
    const flags = MigrateMeta.flags as Record<string, any>;
    expect(flags.write.exclusive).toContain('stored');
    await expect(MigrateMeta.run(['--stored', '--write'], { root: CLI_ROOT })).rejects.toThrow(/--write.*--stored|--stored.*--write/);
  });

  it('says what it writes and what it leaves, and claims no "automatic" rewrite', () => {
    const description = (MigrateMeta.flags as Record<string, any>).write.description as string;
    expect(description).toMatch(/in place/);
    expect(description).toMatch(/Never writes the manual/);
    expect(description).not.toMatch(/automatic/i);
  });

  it('names no conversion: it is generic over the chain', () => {
    const source = readFileSync(CODEMOD_SOURCE, 'utf8');
    const ids = MIGRATION_MAJORS.flatMap((m) => MIGRATIONS_BY_MAJOR[m]!.conversionIds);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => source.includes(`'${id}'`) || source.includes(`"${id}"`))).toEqual([]);
  });
});
