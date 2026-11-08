// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate --target <profile file>` — the command's door onto a target
 * environment's restriction profile (`RestrictionProfileSchema`,
 * `@objectstack/spec/system`). The dimensions and reader rules are pinned on
 * the reader itself (`src/utils/restriction-profile.test.ts`); this file pins
 * what the command does with them, run in-process (`Command.run`):
 *
 *  - CONTROL: without `--target` the same stack validates exactly as before,
 *    and an all-open profile refuses nothing;
 *  - each dimension refuses through the command, one `errors` row per item,
 *    each naming its `rule`;
 *  - a Team-shaped profile (`allowCode: false`, `allowSandboxedJs: true`, the
 *    approval pair listed) passes a stack with an approval flow and a
 *    sandboxed hook, and `allowSandboxedJs: false` refuses that hook;
 *  - version drift is a warning on the payload, never a refusal, and not
 *    gated by `--strict`;
 *  - an invalid profile and a URL target are refused before the stack is read.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RestrictionProfileNodeType } from '@objectstack/spec/system';
// Clocked windows measure behaviour, never loading: the command reaches both
// of these through a dynamic import, so their first load is paid here, during
// collection (`pnpm check:test-source-alias`).
import '@objectstack/objectql/core';
import '@objectstack/plugin-security';
import Validate from '../src/commands/validate';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SPEC_VERSION = (createRequire(import.meta.url)('@objectstack/spec/package.json') as { version: string }).version;

interface Run { code: number; stdout: string }

async function run(argv: string[]): Promise<Run> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as never);
  const exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
  let code = 0;
  try {
    await Validate.run(argv, { root: CLI_ROOT });
    code = Number(process.exitCode ?? 0);
  } catch (error) {
    const exit = (error as { oclif?: { exit?: unknown } }).oclif?.exit;
    if (typeof exit !== 'number') throw error;
    code = exit;
  } finally {
    spy.mockRestore();
    process.exitCode = exitCodeBefore;
  }
  // eslint-disable-next-line no-control-regex
  return { code, stdout: chunks.join('').replace(/\u001b\[[0-9;]*m/g, '') };
}

const json = (r: Run): Record<string, any> => {
  try {
    return JSON.parse(r.stdout) as Record<string, any>;
  } catch {
    throw new Error(`stdout was not one JSON document (exit ${r.code})\n${r.stdout}`);
  }
};

/**
 * One item per dimension: a hook and its function, a scheduled flow, and a
 * record flow with a script node. Plus a dev-only plugin, which `os build`
 * leaves out of the artifact, so no target runs it and `allowCode` reads none.
 */
const STACK = `{
  manifest: { id: 'com.example.rpt', namespace: 'rpt', version: '1.0.0', name: 'Rpt', type: 'app', engines: { protocol: '^18' } },
  requires: ['automation', 'triggers'],
  objects: [{ name: 'rpt_doc', label: 'Doc', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  hooks: [{ name: 'rpt_audit', object: 'rpt_doc', events: ['beforeInsert'], handler: 'rpt_audit_fn' }],
  functions: { rpt_audit_fn: async () => {}, rpt_calc: () => 1 },
  devPlugins: ['@acme/rpt-dev-only-plugin'],
  flows: [
    {
      name: 'rpt_nightly', label: 'Nightly', type: 'schedule', status: 'active',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'interval', intervalMs: 60000 } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    },
    {
      name: 'rpt_route', label: 'Route', type: 'record_change', runAs: 'system', status: 'active',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'rpt_doc', triggerType: 'record-after-create' } },
        { id: 'calc', type: 'script', label: 'Calc', config: { function: 'rpt_calc' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'calc' }, { id: 'e2', source: 'calc', target: 'end' }],
    },
  ],
}`;

/**
 * A Team-shaped stack: an approval flow (the approval node is a plugin node
 * type the spec declares a contract for, not a `FlowNodeAction` id) and an
 * object lifecycle hook whose body is sandboxed JavaScript.
 */
const TEAM_STACK = `{
  manifest: { id: 'com.example.rptt', namespace: 'rptt', version: '1.0.0', name: 'Rptt', type: 'app', engines: { protocol: '^18' } },
  requires: ['automation', 'triggers'],
  objects: [{ name: 'rptt_doc', label: 'Doc', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  hooks: [{ name: 'rptt_stamp', object: 'rptt_doc', events: ['beforeInsert'], body: { language: 'js', source: 'return;' } }],
  flows: [
    {
      name: 'rptt_signoff', label: 'Sign-off', type: 'record_change', status: 'active',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'rptt_doc', triggerType: 'record-after-create' } },
        { id: 'ask', type: 'approval', label: 'Ask', config: { approvers: [{ type: 'manager' }], behavior: 'first_response' } },
        { id: 'approved', type: 'end', label: 'Approved' },
        { id: 'rejected', type: 'end', label: 'Rejected' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask' },
        { id: 'e2', source: 'ask', target: 'approved', label: 'approve' },
        { id: 'e3', source: 'ask', target: 'rejected', label: 'reject' },
      ],
    },
  ],
}`;

const OPEN = {
  allowCode: true,
  allowSandboxedJs: true,
  allowScheduledAutomation: true,
  allowedFlowNodeTypes: [...RestrictionProfileNodeType.options],
  versions: { spec: SPEC_VERSION, skills: '18.4.0' },
};

let root = '';
let config = '';
let teamConfig = '';
const profileFile = (name: string, value: unknown): string => {
  const file = join(root, `${name}.json`);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-target-'));
  config = join(root, 'objectstack.config.ts');
  writeFileSync(config, defineStackSourceFromLiteral(STACK));
  mkdirSync(join(root, 'team'), { recursive: true });
  teamConfig = join(root, 'team', 'objectstack.config.ts');
  writeFileSync(teamConfig, defineStackSourceFromLiteral(TEAM_STACK));
  linkSpec(root);
  // The project installs the skills catalog at a known version, so the drift
  // reading below does not depend on what else the resolver can reach.
  const skills = join(root, 'node_modules', '@objectstack', 'skills');
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, 'package.json'), JSON.stringify({ name: '@objectstack/skills', version: '18.4.0' }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const errorRows = (r: Run) =>
  (json(r).errors as Array<Record<string, unknown>>).map(({ rule, where, path }) => ({ rule, where, path }));

describe('os validate --target <restriction profile file>', () => {
  it('CONTROL: without --target the stack validates, and no target warning rides the payload', async () => {
    const r = await run([config, '--json']);
    expect(r.code, r.stdout).toBe(0);
    const payload = json(r);
    expect(payload.valid).toBe(true);
    expect((payload.warnings as Array<Record<string, unknown>>).filter((w) => 'package' in Object(w))).toEqual([]);
  }, 60_000);

  it('CONTROL: an all-open profile refuses nothing', async () => {
    const r = await run([config, '--json', '--target', profileFile('open', OPEN)]);
    expect(r.code, r.stdout).toBe(0);
    expect(json(r).valid).toBe(true);
  }, 60_000);

  it('allowCode: false refuses the hook, both functions and the script node — each row naming allowCode once; the dev-only plugin is not refused', async () => {
    const r = await run([config, '--json', '--target', profileFile('no-code', { ...OPEN, allowCode: false })]);
    expect(r.code, r.stdout).toBe(1);
    expect(json(r).valid).toBe(false);
    expect(errorRows(r)).toEqual([
      { rule: 'allowCode', where: "hook 'rpt_audit'", path: 'hooks[0]' },
      { rule: 'allowCode', where: "function 'rpt_audit_fn'", path: 'functions.rpt_audit_fn' },
      { rule: 'allowCode', where: "function 'rpt_calc'", path: 'functions.rpt_calc' },
      { rule: 'allowCode', where: "flow 'rpt_route' › node 'calc' (script)", path: 'flows[1].nodes[1]' },
    ]);
  }, 60_000);

  it('allowScheduledAutomation: false refuses the scheduled flow, naming that rule', async () => {
    const r = await run([config, '--json', '--target', profileFile('no-schedule', { ...OPEN, allowScheduledAutomation: false })]);
    expect(r.code, r.stdout).toBe(1);
    expect(errorRows(r)).toEqual([
      { rule: 'allowScheduledAutomation', where: "flow 'rpt_nightly'", path: 'flows[0]' },
    ]);
  }, 60_000);

  it('allowedFlowNodeTypes refuses the node whose type is not listed; start / end need no listing', async () => {
    const r = await run([config, '--json', '--target', profileFile('no-script', { ...OPEN, allowedFlowNodeTypes: [] })]);
    expect(r.code, r.stdout).toBe(1);
    expect(errorRows(r)).toEqual([
      { rule: 'allowedFlowNodeTypes', where: "flow 'rpt_route' › node 'calc' (script)", path: 'flows[1].nodes[1]' },
    ]);
  }, 60_000);

  it('the text face names each refused item and its rule, and exits 1', async () => {
    const r = await run([config, '--target', profileFile('no-schedule-text', { ...OPEN, allowScheduledAutomation: false })]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("The target environment's restriction profile refuses this stack (1 item)");
    expect(r.stdout).toContain("[allowScheduledAutomation] flow 'rpt_nightly'");
  }, 60_000);

  it('version drift warns on the payload — never refuses, and --strict does not gate it', async () => {
    const drifted = profileFile('drift', { ...OPEN, versions: { spec: '0.0.1', skills: '0.0.1' } });
    const r = await run([config, '--json', '--target', drifted]);
    expect(r.code, r.stdout).toBe(0);
    const payload = json(r);
    expect(payload.valid).toBe(true);
    // `--strict` reads the same exit status with the drifted target as without
    // any target: the drift is not in the list it gates on.
    const strictBare = await run([config, '--json', '--strict']);
    const strictDrifted = await run([config, '--json', '--strict', '--target', drifted]);
    expect(strictDrifted.code, strictDrifted.stdout).toBe(strictBare.code);
    const drift = (payload.warnings as Array<Record<string, unknown>>)
      .filter((w) => 'package' in Object(w))
      .map(({ package: name, local, target }) => ({ name, local, target }));
    expect(drift).toEqual([
      { name: '@objectstack/spec', local: SPEC_VERSION, target: '0.0.1' },
      { name: '@objectstack/skills', local: '18.4.0', target: '0.0.1' },
    ]);
  }, 60_000);

  /** What a hosted Team kernel runs: no in-process code or schedules, sandboxed bodies and the approval pair. */
  const TEAM = {
    ...OPEN,
    allowCode: false,
    allowScheduledAutomation: false,
    allowedFlowNodeTypes: ['approval', 'approval_revise', 'update_record'],
  };

  it('CONTROL: the Team-shaped stack validates without --target', async () => {
    const r = await run([teamConfig, '--json']);
    expect(r.code, r.stdout).toBe(0);
    expect(json(r).valid).toBe(true);
  }, 60_000);

  it('a Team-shaped profile passes an approval flow and a sandboxed hook under allowCode: false', async () => {
    const r = await run([teamConfig, '--json', '--target', profileFile('team', TEAM)]);
    expect(r.code, r.stdout).toBe(0);
    expect(json(r).valid).toBe(true);
  }, 60_000);

  it('allowSandboxedJs: false refuses the sandboxed hook; a profile omitting approval refuses that node by allowedFlowNodeTypes', async () => {
    const r = await run([teamConfig, '--json', '--target', profileFile('team-strict', {
      ...TEAM,
      allowSandboxedJs: false,
      allowedFlowNodeTypes: ['update_record'],
    })]);
    expect(r.code, r.stdout).toBe(1);
    expect(errorRows(r)).toEqual([
      { rule: 'allowSandboxedJs', where: "hook 'rptt_stamp'", path: 'hooks[0]' },
      { rule: 'allowedFlowNodeTypes', where: "flow 'rptt_signoff' › node 'ask' (approval)", path: 'flows[0].nodes[1]' },
    ]);
  }, 60_000);

  it('an invalid profile is refused naming the schema issue, before the stack is judged', async () => {
    const r = await run([config, '--json', '--target', profileFile('invalid', { ...OPEN, allowCode: 'no' })]);
    expect(r.code, r.stdout).toBe(1);
    const payload = json(r);
    expect(payload.valid).toBe(false);
    expect(String(payload.error)).toMatch(/not a valid restriction profile .*allowCode/);
  }, 60_000);

  it('a URL target is refused, naming the file form as the remedy', async () => {
    const r = await run([config, '--json', '--target', 'https://env.example.com']);
    expect(r.code, r.stdout).toBe(1);
    expect(String(json(r).error)).toContain('os validate --target ./restriction-profile.json');
  }, 60_000);
});
