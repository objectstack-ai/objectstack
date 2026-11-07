// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reader of a target environment's restriction profile
 * (`restriction-profile.ts`): one refusal per profile dimension, the three
 * reader rules, the version drift warning, and an invalid profile refused.
 * `test/validate-target-restriction-profile.test.ts` holds the command's door.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLOW_BUILTIN_NODE_TYPES } from '@objectstack/spec/automation';

import {
  judgeRestrictionProfile,
  loadRestrictionProfile,
  restrictionProfileVersionDrift,
  type ParsedRestrictionProfile,
} from './restriction-profile.js';

/** Everything on: every built-in node type listed, code and schedules allowed. */
const OPEN: ParsedRestrictionProfile = {
  allowCode: true,
  allowScheduledAutomation: true,
  allowedFlowNodeTypes: [...FLOW_BUILTIN_NODE_TYPES] as ParsedRestrictionProfile['allowedFlowNodeTypes'],
  versions: { spec: '18.4.0', skills: '18.4.0' },
};
const profile = (patch: Partial<ParsedRestrictionProfile>): ParsedRestrictionProfile => ({ ...OPEN, ...patch });

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: id, ...extra });
const flow = (name: string, nodes: unknown[], extra: Record<string, unknown> = {}) => ({
  name, label: name, type: 'autolaunched', nodes, edges: [], ...extra,
});

/** One item per dimension, plus the reader-rule cases. */
const STACK = {
  manifest: { id: 'com.example.rp', namespace: 'rp', version: '1.0.0', name: 'Rp', type: 'app' },
  hooks: [{ name: 'rp_audit', object: 'rp_doc', events: ['beforeInsert'], handler: 'rp_audit_fn' }],
  functions: { rp_audit_fn: 'rp_audit_fn', rp_calc: 'rp_calc' },
  plugins: ['@acme/rp-plugin'],
  jobs: [{ name: 'rp_sweep', schedule: { type: 'interval', intervalMs: 60_000 }, handler: 'rp_calc' }],
  flows: [
    flow('rp_nightly', [node('start', 'start'), node('end', 'end')], { type: 'schedule' }),
    flow('rp_route', [
      node('start', 'start'),
      node('fetch', 'get_record'),
      node('call', 'http'),
      node('calc', 'script', { config: { function: 'rp_calc' } }),
      node('ok', 'approval'),
      node('end', 'end'),
    ]),
  ],
};

const rowsOf = (p: ParsedRestrictionProfile, stack: Record<string, unknown> = STACK) =>
  judgeRestrictionProfile(stack, p).map(({ rule, where, path }) => ({ rule, where, path }));

describe('judgeRestrictionProfile — one refusal per dimension', () => {
  it('CONTROL: a profile that allows everything refuses nothing', () => {
    expect(rowsOf(OPEN)).toEqual([]);
  });

  it('allowCode: false refuses each hook, each function and each plugin — every row naming allowCode', () => {
    const rows = rowsOf(profile({ allowCode: false }));
    expect(rows).toEqual([
      { rule: 'allowCode', where: "hook 'rp_audit'", path: 'hooks[0]' },
      { rule: 'allowCode', where: "function 'rp_audit_fn'", path: 'functions.rp_audit_fn' },
      { rule: 'allowCode', where: "function 'rp_calc'", path: 'functions.rp_calc' },
      { rule: 'allowCode', where: "plugin '@acme/rp-plugin'", path: 'plugins[0]' },
      { rule: 'allowCode', where: "flow 'rp_route' › node 'calc' (script)", path: 'flows[1].nodes[3]' },
      { rule: 'allowCode', where: "flow 'rp_route' › node 'ok' (approval)", path: 'flows[1].nodes[4]' },
    ]);
  });

  it('allowCode: false — an empty code key carries nothing and refuses nothing', () => {
    const stack = { manifest: STACK.manifest, functions: {}, plugins: [] };
    expect(rowsOf(profile({ allowCode: false }), stack)).toEqual([]);
  });

  it('allowCode: false — `devPlugins` never reaches a target, so it refuses nothing; `plugins` beside it still does', () => {
    const stack = { manifest: STACK.manifest, plugins: ['@acme/rp-plugin'], devPlugins: ['@acme/rp-dev-only-plugin'] };
    expect(rowsOf(profile({ allowCode: false }), stack)).toEqual([
      { rule: 'allowCode', where: "plugin '@acme/rp-plugin'", path: 'plugins[0]' },
    ]);
  });

  it('allowCode: false — a code key on the manifest is refused under its manifest path', () => {
    const stack = { manifest: { ...STACK.manifest, main: 'dist/index.mjs' } };
    expect(rowsOf(profile({ allowCode: false }), stack)).toEqual([
      { rule: 'allowCode', where: '`main`', path: 'manifest.main' },
    ]);
  });

  it('allowScheduledAutomation: false refuses the scheduled flow and the job, naming that rule', () => {
    expect(rowsOf(profile({ allowScheduledAutomation: false }))).toEqual([
      { rule: 'allowScheduledAutomation', where: "job 'rp_sweep'", path: 'jobs[0]' },
      { rule: 'allowScheduledAutomation', where: "flow 'rp_nightly'", path: 'flows[0]' },
    ]);
  });

  it('allowedFlowNodeTypes refuses each node whose built-in type is not listed', () => {
    const rows = rowsOf(profile({ allowedFlowNodeTypes: ['get_record', 'script'] }));
    expect(rows).toEqual([
      { rule: 'allowedFlowNodeTypes', where: "flow 'rp_route' › node 'call' (http)", path: 'flows[1].nodes[2]' },
    ]);
  });

  it('allowedFlowNodeTypes reaches a node inside a region, at its region path', () => {
    const stack = {
      manifest: STACK.manifest,
      flows: [flow('rp_deep', [
        node('start', 'start'),
        node('each', 'loop', { config: { body: { nodes: [node('send', 'notify')], edges: [] } } }),
        node('end', 'end'),
      ])],
    };
    expect(rowsOf(profile({ allowedFlowNodeTypes: ['loop'] }), stack)).toEqual([
      { rule: 'allowedFlowNodeTypes', where: "flow 'rp_deep' › loop 'each' body › node 'send' (notify)", path: 'flows[0].nodes[1].config.body.nodes[0]' },
    ]);
  });

  it('walks each packages[] entry of an assembled artifact, at that entry\'s path', () => {
    const stack = {
      manifest: STACK.manifest,
      packages: [
        { manifest: { id: 'com.example.rp', name: 'Rp', hooks: [] } },
        { manifest: { id: 'com.example.rp.ops', name: 'Ops', hooks: STACK.hooks, jobs: STACK.jobs } },
      ],
    };
    expect(rowsOf(profile({ allowCode: false, allowScheduledAutomation: false }), stack)).toEqual([
      { rule: 'allowCode', where: "hook 'rp_audit'", path: 'packages[1].manifest.hooks[0]' },
      { rule: 'allowScheduledAutomation', where: "job 'rp_sweep'", path: 'packages[1].manifest.jobs[0]' },
    ]);
  });
});

describe('judgeRestrictionProfile — the reader rules', () => {
  it('start / end are always allowed, even by a profile that lists no node type', () => {
    const stack = { manifest: STACK.manifest, flows: [flow('rp_bare', [node('start', 'start'), node('end', 'end')])] };
    expect(rowsOf(profile({ allowedFlowNodeTypes: [] }), stack)).toEqual([]);
  });

  it('a type outside FlowNodeAction is governed by allowCode: refused naming allowCode when it is false', () => {
    const rows = judgeRestrictionProfile(STACK, profile({ allowCode: false })).filter((r) => r.where.includes('(approval)'));
    expect(rows.map((r) => r.rule)).toEqual(['allowCode']);
    expect(rows[0]!.message).toContain('allowedFlowNodeTypes` cannot name it');
  });

  it('a type outside FlowNodeAction is allowed when allowCode is true, whatever allowedFlowNodeTypes lists', () => {
    const rows = rowsOf(profile({ allowedFlowNodeTypes: ['get_record', 'http', 'script'] }));
    expect(rows.filter((r) => r.where.includes('(approval)'))).toEqual([]);
  });

  it('a script node under allowCode: false is refused naming ONE rule, also when allowedFlowNodeTypes omits it', () => {
    const rows = rowsOf(profile({ allowCode: false, allowedFlowNodeTypes: ['get_record', 'http'] }));
    expect(rows.filter((r) => r.where.includes('(script)'))).toEqual([
      { rule: 'allowCode', where: "flow 'rp_route' › node 'calc' (script)", path: 'flows[1].nodes[3]' },
    ]);
  });

  it('a script node under allowCode: true is judged by allowedFlowNodeTypes', () => {
    const rows = rowsOf(profile({ allowedFlowNodeTypes: ['get_record', 'http'] }));
    expect(rows).toEqual([
      { rule: 'allowedFlowNodeTypes', where: "flow 'rp_route' › node 'calc' (script)", path: 'flows[1].nodes[3]' },
    ]);
  });
});

describe('loadRestrictionProfile', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-restriction-profile-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('parses a valid profile file with the spec schema', () => {
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(OPEN));
    expect(loadRestrictionProfile('ok.json', dir).profile).toEqual(OPEN);
  });

  it('refuses an invalid profile, naming the schema issue', () => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...OPEN, allowedFlowNodeTypes: ['approval'] }));
    expect(() => loadRestrictionProfile('bad.json', dir)).toThrow(/not a valid restriction profile.*allowedFlowNodeTypes\.0/);
  });

  it('refuses {} — an absent dimension is not "no restriction"', () => {
    writeFileSync(join(dir, 'empty.json'), '{}');
    expect(() => loadRestrictionProfile('empty.json', dir)).toThrow(/allowCode/);
  });

  it('refuses a file that is not JSON, and a missing file', () => {
    writeFileSync(join(dir, 'garbled.json'), 'allowCode: false');
    expect(() => loadRestrictionProfile('garbled.json', dir)).toThrow(/is not JSON/);
    expect(() => loadRestrictionProfile('missing.json', dir)).toThrow(/no restriction profile file/);
  });

  it('refuses a URL rather than fetching from a guessed route', () => {
    expect(() => loadRestrictionProfile('https://env.example.com', dir)).toThrow(/does not publish its restriction profile at a defined/);
  });
});

describe('restrictionProfileVersionDrift', () => {
  let dir = '';
  const install = (name: string, version: string) => {
    const at = join(dir, 'node_modules', ...name.split('/'));
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, version }));
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-restriction-versions-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'rp-app', private: true }));
    install('@objectstack/spec', '18.4.0');
    install('@objectstack/skills', '18.4.0');
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: no warning when both local versions are the target\'s', () => {
    expect(restrictionProfileVersionDrift(OPEN, dir)).toEqual([]);
  });

  it('warns — one entry per package that differs, local and target named', () => {
    const drift = restrictionProfileVersionDrift(profile({ versions: { spec: '18.5.0', skills: '18.4.0' } }), dir);
    expect(drift.map(({ package: name, local, target }) => ({ name, local, target }))).toEqual([
      { name: '@objectstack/spec', local: '18.4.0', target: '18.5.0' },
    ]);
  });

  it('warns when the project does not install @objectstack/skills at all', () => {
    rmSync(join(dir, 'node_modules', '@objectstack', 'skills'), { recursive: true, force: true });
    const drift = restrictionProfileVersionDrift(OPEN, dir);
    expect(drift.map(({ package: name, local }) => ({ name, local }))).toEqual([{ name: '@objectstack/skills', local: null }]);
  });
});
