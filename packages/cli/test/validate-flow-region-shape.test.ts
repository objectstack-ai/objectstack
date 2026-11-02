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
 *
 * [#29049] The verdict moved into the authoring-rule table
 * (`flow-region-shape-invalid`, `@objectstack/lint`), so `os lint` gives it
 * too: each fixture below is run through all three commands. A refusal is now
 * a rule finding (`rule`, `where`, `path`, `message`, `hint`) in the rule
 * table's failure envelope (`errors` under `os validate --json`, `issues` under
 * `os build --json`), not a separate gate's `VALIDATION_ERROR` row.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Compile from '../src/commands/compile';
import Lint from '../src/commands/lint';
import Validate from '../src/commands/validate';
import { undeclaredFlowCycleMessage } from '@objectstack/metadata-core';
import { FLOW_CYCLE_CORPUS } from '@objectstack/metadata-core/testing';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

interface Run { code: number; stdout: string }

async function run(command: typeof Compile | typeof Validate | typeof Lint, argv: string[]): Promise<Run> {
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
    await command.run(argv, { root: CLI_ROOT });
    // `os lint --json` reports its verdict through `process.exitCode`
    // (`emitJson`), not an oclif exit.
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

/**
 * [#29059] An assembled artifact (ADR-0130 D4): two `packages[]` entries, the
 * malformed flow in the SECOND, so the row's `path` has to carry the entry's
 * own index (`packages[1].manifest.flows[0]`) and a walk that read only
 * `packages[0]`, or the stack's empty top level, would pass it.
 */
const assembledWith = (good: unknown, bad: unknown) => ({
  manifest: { id: 'com.example.rgn', namespace: 'rgn', version: '1.0.0', name: 'Rgn', type: 'app', engines: { protocol: '^18' } },
  packages: [
    {
      manifest: {
        id: 'com.example.rgn', namespace: 'rgn', version: '1.0.0', name: 'Rgn', type: 'app',
        objects: [{ name: OBJECT, label: 'Visa', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
        flows: [good],
      },
    },
    { manifest: { id: 'com.example.rgn.ops', namespace: 'rgn', version: '1.0.0', name: 'Ops', type: 'module', flows: [bad] } },
  ],
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
  assembled: {
    stack: assembledWith(flow('rgn_ok', guard(fanOut(true))), flow('rgn_ops_lead_time', guard(fanOut(false)))),
    refusal: "try_catch 'guard' catch: region must be single-exit but has 3: x, y, z",
  },
  // [#29051] The flow-cycle judge's whole corpus in one stack, and the cases it
  // must pass on their own.
  cycles: { stack: stackWith(FLOW_CYCLE_CORPUS.map((c) => c.flow)) },
  cyclesDeclared: { stack: stackWith(FLOW_CYCLE_CORPUS.filter((c) => c.cycle === null).map((c) => c.flow)) },
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
const lint = (label: string) => run(Lint, [fixtures[label].config, '--json', '--skip-i18n']);

const RULE = 'flow-region-shape-invalid';

describe('[#28893] validate, build and lint refuse a flow region the engine refuses, with its message', () => {
  for (const label of ['duly', 'nested', 'singleBranch'] as const) {
    it(`${label}: validate exits 1 naming the flow and the engine's refusal; build refuses the same and writes nothing; lint refuses it`, async () => {
      const { refusal } = CASES[label];
      const flowName = (CASES[label].stack.flows as Array<{ name: string }>)[0]!.name;
      const validated = await validate(label, '--json');
      expect(validated.code, validated.stdout).toBe(1);
      const errors = json(validated, `validate ${label}`).errors as Array<Record<string, unknown>>;
      const row = errors.find((r) => String(r.message).includes(refusal!));
      expect(row, JSON.stringify(errors, null, 2)).toBeDefined();
      expect(row!.rule).toBe(RULE);
      expect(String(row!.message)).toContain(flowName);
      // [#29049] Reported once: the retired CLI-only walk does not echo it.
      expect(errors.filter((r) => String(r.message).includes(refusal!))).toHaveLength(1);

      const built = await build(label, '--json');
      expect(built.code).toBe(1);
      const payload = json(built, `build ${label}`);
      expect(payload.success).toBe(false);
      const builtRows = (payload.issues as Array<Record<string, unknown>>).filter((r) => String(r.message).includes(refusal!));
      expect(builtRows.map((r) => r.rule)).toEqual([RULE]);
      expect(existsSync(fixtures[label].dist)).toBe(false);

      // [#29049] `os lint`, blind to it before: exit 1, the same rule and message.
      const linted = await lint(label);
      expect(linted.code, linted.stdout).toBe(1);
      const lintReport = json(linted, `lint ${label}`);
      const lintRows = (lintReport.issues as Array<Record<string, unknown>>).filter((i) => i.rule === RULE);
      expect(lintRows.map((i) => i.severity), JSON.stringify(lintReport.issues, null, 2)).toEqual(['error']);
      expect(String(lintRows[0]!.message)).toContain(refusal!);
      expect(String(lintRows[0]!.message)).toContain(flowName);
    }, 60_000);
  }

  // [#29049] Forced edit: the CLI-only walk located the row in its own entry
  // (`packages[1].manifest.flows[0]`, `code`, `flow`). The rule table judges
  // the artifact's union of flows first, as it judges every other collection,
  // so the finding sits at the union path and names the flow in `where`.
  it('[#29059] an assembled artifact: the refused flow in the second packages[] entry is refused once, and build writes nothing', async () => {
    const { refusal } = CASES.assembled;
    const expected = { rule: RULE, where: "flow 'rgn_ops_lead_time'", path: 'flows[1]' };

    const validated = await validate('assembled', '--json');
    expect(validated.code, validated.stdout).toBe(1);
    const errors = json(validated, 'validate assembled').errors as Array<Record<string, unknown>>;
    const rows = errors.filter((r) => String(r.message).includes(refusal!));
    expect(rows.map(({ rule, where, path }) => ({ rule, where, path })), JSON.stringify(errors, null, 2)).toEqual([expected]);

    const built = await build('assembled', '--json');
    expect(built.code, built.stdout).toBe(1);
    const payload = json(built, 'build assembled');
    expect(payload.success).toBe(false);
    const builtRows = (payload.issues as Array<Record<string, unknown>>).filter((r) => String(r.message).includes(refusal!));
    expect(builtRows.map(({ rule, where, path }) => ({ rule, where, path }))).toEqual([expected]);
    expect(existsSync(fixtures.assembled.dist)).toBe(false);

    const linted = await lint('assembled');
    expect(linted.code, linted.stdout).toBe(1);
    const lintRows = (json(linted, 'lint assembled').issues as Array<Record<string, unknown>>).filter((i) => i.rule === RULE);
    expect(lintRows.map(({ path }) => path)).toEqual(['flows[1]']);
  }, 60_000);

  it('CONTROL: the same flow with the join restored validates and builds', async () => {
    const validated = await validate('joined', '--json');
    expect(validated.code, validated.stdout).toBe(0);
    const built = await build('joined', '--json');
    expect(json(built, 'build joined').success, built.stdout).toBe(true);
    expect(built.code).toBe(0);
    const linted = await lint('joined');
    const issues = json(linted, 'lint joined').issues as Array<Record<string, unknown>>;
    expect(issues.filter((i) => i.rule === RULE)).toEqual([]);
  }, 60_000);
});

/**
 * [#29051] A flow whose TOP-LEVEL graph closes a cycle with no `type: 'back'`
 * edge (ADR-0044). The engine refuses it at registration with
 * `findUndeclaredFlowCycle` (`@objectstack/metadata-core`); before this,
 * `os validate` and `os build` passed it with exit 0 and the flow never ran.
 * Driven from the judge's own corpus, so the doors refuse exactly the cases
 * the engine and the publish gate refuse, each at its own flow, in the
 * engine's sentence.
 */
describe('[#29051] validate and build refuse an undeclared top-level flow cycle, with the engine\'s sentence', () => {
  const refused = FLOW_CYCLE_CORPUS
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.cycle !== null)
    .map(({ c, i }) => ({ path: `flows[${i}]`, code: 'VALIDATION_ERROR', flow: c.flow.name, cycle: undeclaredFlowCycleMessage(c.cycle!) }));
  const rowsOf = (errors: Array<Record<string, unknown>>) =>
    errors.filter((r) => String(r.message).includes('Flow contains a cycle'));
  const expectRefused = (errors: Array<Record<string, unknown>>) => {
    const rows = rowsOf(errors);
    expect(rows.map(({ path, code, flow }) => ({ path, code, flow })), JSON.stringify(errors, null, 2))
      .toEqual(refused.map(({ path, code, flow }) => ({ path, code, flow })));
    rows.forEach((row, k) => expect(String(row.message)).toContain(refused[k]!.cycle));
  };

  it('validate exits 1 with one row per refused corpus flow; build refuses the same and writes nothing', async () => {
    const validated = await validate('cycles', '--json');
    expect(validated.code, validated.stdout).toBe(1);
    expectRefused(json(validated, 'validate cycles').errors as Array<Record<string, unknown>>);

    const built = await build('cycles', '--json');
    expect(built.code, built.stdout).toBe(1);
    const payload = json(built, 'build cycles');
    expect(payload.success).toBe(false);
    expectRefused(payload.errors as Array<Record<string, unknown>>);
    expect(existsSync(fixtures.cycles.dist)).toBe(false);
  }, 60_000);

  it('CONTROL: the corpus flows whose loops are declared back (and the acyclic ones) validate and build', async () => {
    const validated = await validate('cyclesDeclared', '--json');
    expect(validated.code, validated.stdout).toBe(0);
    const built = await build('cyclesDeclared', '--json');
    expect(json(built, 'build cyclesDeclared').success, built.stdout).toBe(true);
    expect(built.code).toBe(0);
  }, 60_000);
});
