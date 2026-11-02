// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28893] `os validate` and `os build` refuse a flow the automation engine
 * refuses at registration for its ADR-0031 region shape (`validateControlFlow`:
 * a region that is not single-entry / single-exit or is cyclic, or a parallel
 * with fewer than 2 branches), at every region depth, with the engine's own
 * message and the flow's name.
 *
 * ## The defect, measured on `origin/main` (`ff881050`) before this file
 *
 * The duly shape — a `try_catch` whose catch region is a decision fanning out
 * to three nodes with no join — exited 0 from `os validate --json` and built.
 * The engine then refused it at `registerFlow` ("region must be single-exit"),
 * logged at WARN, and the boot went on without the flow, so its trigger never
 * fired. Both commands run in-process (`Command.run`), not as spawned CLIs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Compile from '../src/commands/compile';
import Validate from '../src/commands/validate';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

interface Run { code: number; stdout: string }

async function run(command: typeof Compile | typeof Validate, argv: string[]): Promise<Run> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as never);
  const exitCodeBefore = process.exitCode;
  let code = 0;
  try {
    await command.run(argv, { root: CLI_ROOT });
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

const json = (r: Run, label: string): Record<string, any> => {
  try {
    return JSON.parse(r.stdout) as Record<string, any>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${r.code})\n${r.stdout}`);
  }
};

const OBJECT = 'rgn_visa';
const n = (id: string, type = 'assignment', extra: Record<string, unknown> = {}) => ({ id, type, label: id, ...extra });
const e = (id: string, source: string, target: string) => ({ id, source, target, type: 'default' });

/** d → x, y, z: one entry, three exits — the duly catch region. With `join`, x, y, z → j closes it. */
const fanOut = (join: boolean) => ({
  nodes: [n('d'), n('x'), n('y'), n('z'), ...(join ? [n('j')] : [])],
  edges: [
    e('r1', 'd', 'x'), e('r2', 'd', 'y'), e('r3', 'd', 'z'),
    ...(join ? [e('r4', 'x', 'j'), e('r5', 'y', 'j'), e('r6', 'z', 'j')] : []),
  ],
});

/** A record-change flow: start → <middle> → end. */
const flow = (name: string, middle: Record<string, unknown>) => ({
  name, label: name, type: 'record_change', runAs: 'system', status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    middle,
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [e('e1', 'start', String(middle.id)), e('e2', String(middle.id), 'end')],
});

const guard = (catchRegion: Record<string, unknown>) =>
  n('guard', 'try_catch', { config: { try: { nodes: [n('work')], edges: [] }, catch: catchRegion } });

const stackWith = (flows: unknown[]) => ({
  manifest: { id: 'com.example.rgn', namespace: 'rgn', version: '1.0.0', name: 'Rgn', type: 'app', engines: { protocol: '^18' } },
  objects: [{ name: OBJECT, label: 'Visa', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  flows,
});

const CASES: Record<string, { stack: Record<string, unknown>; refusal?: string }> = {
  duly: {
    stack: stackWith([flow('rgn_lead_time', guard(fanOut(false)))]),
    refusal: "try_catch 'guard' catch: region must be single-exit but has 3: x, y, z",
  },
  nested: {
    stack: stackWith([flow('rgn_nested', n('outer', 'try_catch', {
      config: {
        try: {
          nodes: [n('sweep', 'loop', { config: { collection: { dialect: 'cel', source: 'record.items' }, iteratorVariable: 'item', body: fanOut(false) } })],
          edges: [],
        },
      },
    }))]),
    refusal: "try_catch 'outer' try → loop 'sweep' body: region must be single-exit but has 3: x, y, z",
  },
  singleBranch: {
    stack: stackWith([flow('rgn_fan', n('fan', 'parallel', { config: { branches: [{ nodes: [n('only')], edges: [] }] } }))]),
    refusal: "parallel 'fan': a parallel block needs at least 2 branches",
  },
  joined: { stack: stackWith([flow('rgn_lead_time', guard(fanOut(true)))]) },
};

let root = '';
const fixtures: Record<string, { config: string; dist: string; artifact: string }> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-flow-region-'));
  for (const [label, c] of Object.entries(CASES)) {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(c.stack, { strict: false }));
    linkSpec(dir);
    fixtures[label] = { config: join(dir, 'objectstack.config.ts'), dist: join(dir, 'dist'), artifact: join(dir, 'dist', 'objectstack.json') };
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const validate = (label: string, ...flags: string[]) => run(Validate, [fixtures[label].config, ...flags]);
const build = (label: string, ...flags: string[]) =>
  run(Compile, [fixtures[label].config, '--output', fixtures[label].artifact, ...flags]);

describe('[#28893] validate and build refuse a flow region the engine refuses, with its message', () => {
  for (const label of ['duly', 'nested', 'singleBranch'] as const) {
    it(`${label}: validate exits 1 naming the flow and the engine's refusal; build refuses the same and writes nothing`, async () => {
      const { refusal } = CASES[label];
      const flowName = (CASES[label].stack.flows as Array<{ name: string }>)[0]!.name;
      const validated = await validate(label, '--json');
      expect(validated.code, validated.stdout).toBe(1);
      const errors = json(validated, `validate ${label}`).errors as Array<Record<string, unknown>>;
      const row = errors.find((r) => String(r.message).includes(refusal!));
      expect(row, JSON.stringify(errors, null, 2)).toBeDefined();
      expect(String(row!.message)).toContain(flowName);

      const built = await build(label, '--json');
      expect(built.code).toBe(1);
      const payload = json(built, `build ${label}`);
      expect(payload.success).toBe(false);
      expect((payload.errors as Array<Record<string, unknown>>).some((r) => String(r.message).includes(refusal!))).toBe(true);
      expect(existsSync(fixtures[label].dist)).toBe(false);
    }, 60_000);
  }

  it('CONTROL: the same flow with the join restored validates and builds', async () => {
    const validated = await validate('joined', '--json');
    expect(validated.code, validated.stdout).toBe(0);
    const built = await build('joined', '--json');
    expect(json(built, 'build joined').success, built.stdout).toBe(true);
    expect(built.code).toBe(0);
  }, 60_000);
});
