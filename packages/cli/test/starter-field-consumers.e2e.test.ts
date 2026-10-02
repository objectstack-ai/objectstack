// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#21370), end to end — every starter a fresh project can begin from,
 * followed by `os g dashboard`, `os g view` and `os g flow`, reports ZERO
 * `field-no-consumers` findings under both `os validate` and `os lint`. With
 * the starter's `group` placements stripped, the same commands report the
 * finding again: that is the control.
 *
 * ## The defect, measured through these commands
 *
 * On `origin/main` 69a12a0952, each starter followed by ONE of
 * `os g dashboard probe`, `os g object gate_target` + `os g view gate_target`,
 * or `os g object gate_target` + `os g flow gate_probe --object gate_target`:
 *
 *   npm create objectstack   `os validate` and `os lint` exit 0 with one
 *                            `field-no-consumers` warning: the starter note's
 *                            `body`
 *   os init -t app           the same, with two: the item's `description` and
 *                            `status`
 *   os init -t plugin        clean: its one field is the record's title
 *
 * Every bare starter reported nothing, because the rule stays silent while a
 * stack holds no consumer root. The author's first view, flow, dashboard or
 * anything else that could read a field woke a warning about a field the
 * author never wrote. The fix places each starter field in a keyed field group
 * (`fieldGroups` + `group`, ADR-0085 §5), which the rule credits as displayed.
 *
 * ## One leg per starter, all three wakers in it
 *
 * Each leg is its own fresh project: the on-ramp's `bin/` for the blank
 * starter, `os init -t <template>` for every `TEMPLATES` entry that renders an
 * object (read off the map, so a template added later gets a leg). Then the
 * three generators the triage ruling names, as an author types them. The view
 * and the flow bind an object generated beside the starter's
 * (`os g object gate_target`), never the starter's own: a view of the starter
 * object lists every field it declares, and would hide the very finding this
 * file measures.
 *
 * ## The control, through the same commands
 *
 * A zero alone cannot tell a placed field from a rule that never ran, or a
 * `--json` that stopped carrying warnings. So each leg whose starter places a
 * field then strips every `group` line from its `src/objects/*.object.ts` and
 * runs both commands again: each must now report `field-no-consumers`, and
 * only on fields the stripped files declare. A starter whose object sources
 * place nothing (its only field is the record's title, which the rule exempts)
 * has no control, decided from those sources when the file is collected; the
 * vacuity guard below requires the two starters the defect was measured on to
 * have one.
 *
 * The per-PR, in-process half (one control per field) is
 * `starter-field-consumers.test.ts`. Nightly (`.e2e`): about twenty-five oclif
 * + tsx cold starts. Projects live under this package's `node_modules`, so the
 * starters' imports resolve to workspace copies without an install, the way
 * `generate-scaffold-gates.e2e.test.ts` runs the same on-ramp. The on-ramp's
 * `bin/` and the blank starter's tree are declared cross-package inputs of
 * this package (scripts/cross-package-test-inputs.mjs).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../src/commands/init.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

// One `resolve(HERE, …)` call per line: `check:cross-package-test-inputs`
// reconstructs these reads by SOURCE SCAN.
const ON_RAMP_BIN = resolve(HERE, '../../..', 'packages/create-objectstack/bin/create-objectstack.js');
const BLANK_OBJECTS = resolve(HERE, '../../create-objectstack/src/templates/blank/src/objects');

/** Three scaffolds and about twenty-five cold starts, sequential. */
const RUN_TIMEOUT_MS = 900_000;

const RULE = 'field-no-consumers';
/** The object the view and the flow bind: generated beside the starter's. */
const TARGET = 'gate_target';
/** The name the dashboard and the flow are generated under. */
const WAKER = 'gate_probe';

/** The three generators the ruling names, as an author types them. */
const WAKER_STEPS: string[][] = [
  ['g', 'dashboard', WAKER],
  ['g', 'object', TARGET],
  ['g', 'view', TARGET],
  ['g', 'flow', WAKER, '--object', TARGET],
];

const GATES = ['validate', 'lint'] as const;
type Gate = (typeof GATES)[number];

/** A `group: '<key>',` line exactly as the starters write one. */
const GROUP_LINE = /^[ \t]*group: '[a-z_][a-z0-9_]*',\r?\n/gm;
/** Whether an object source places any field in a group (non-global: `test` keeps no state). */
const placesAField = (source: string): boolean => new RegExp(GROUP_LINE.source, 'm').test(source);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(file: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      file,
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; a signalled child has none and
          // is reported as 1, never as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const os = (args: string[], cwd: string) => run(TSX, [CLI, ...args], cwd);
const out = (r: Run) => r.stdout + r.stderr;

/** The `field-no-consumers` paths a gate's `--json` reports; `null` when it printed no JSON. */
function ruleFindingsOf(gate: Gate, stdout: string): string[] | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
  const lists = gate === 'lint' ? [body.issues] : [body.errors, body.warnings];
  return lists
    .flatMap((l) => (Array.isArray(l) ? l : []))
    .filter((f) => (f as { rule?: unknown }).rule === RULE)
    .map((f) => String((f as { path?: unknown }).path));
}

interface GateRun {
  run: Run;
  findings: string[] | null;
}

interface Leg {
  scaffold: Run;
  steps: { args: string[]; run: Run }[];
  gates: Record<Gate, GateRun>;
  /** The stripped object sources and what the gates said about them; `null` until it ran. */
  control: { stripped: string; gates: Record<Gate, GateRun> } | null;
}

interface Starter {
  name: string;
  /** Whether the starter's object sources place a field in a group, so it has a control. */
  placesFields: boolean;
  scaffold: (cwd: string) => Promise<{ run: Run; dir: string }>;
}

/** The starter doors: the on-ramp, then every `os init` template that renders an object. */
const STARTERS: Starter[] = [
  {
    name: 'npm create objectstack',
    placesFields: readdirSync(BLANK_OBJECTS)
      .filter((f) => f.endsWith('.object.ts'))
      .some((f) => placesAField(readFileSync(join(BLANK_OBJECTS, f), 'utf8'))),
    scaffold: async (cwd) => ({
      run: await run(process.execPath, [ON_RAMP_BIN, 'tasks-app', '--skip-install', '--skip-skills'], cwd),
      dir: join(cwd, 'tasks-app'),
    }),
  },
  ...Object.entries(TEMPLATES)
    .map(([key, t]) => ({
      key,
      objectSources: Object.entries(t.srcFiles)
        .filter(([f]) => f.endsWith('.object.ts'))
        .map(([, render]) => render('my-app', 'my_app')),
    }))
    .filter(({ objectSources }) => objectSources.length > 0)
    .map(({ key, objectSources }) => ({
      name: `os init -t ${key}`,
      placesFields: objectSources.some(placesAField),
      scaffold: async (cwd: string) => ({
        run: await os(['init', 'my-app', '-t', key, '--no-install'], cwd),
        dir: join(cwd, 'my-app'),
      }),
    })),
];
const CONTROLLED = STARTERS.filter((s) => s.placesFields);

async function gatesIn(dir: string): Promise<Record<Gate, GateRun>> {
  const gates = {} as Record<Gate, GateRun>;
  for (const gate of GATES) {
    const r = await os([gate, '--json'], dir);
    gates[gate] = { run: r, findings: ruleFindingsOf(gate, r.stdout) };
  }
  return gates;
}

let root: string;
const legs: Record<string, Leg> = {};

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.starter-field-consumers-e2e-'));
  // Sequential on purpose: cold starts in a container several agents share.
  for (const starter of STARTERS) {
    const legRoot = mkdtempSync(join(root, 'leg-'));
    const { run: scaffold, dir } = await starter.scaffold(legRoot);
    const steps: Leg['steps'] = [];
    const leg: Leg = { scaffold, steps, gates: {} as Leg['gates'], control: null };
    legs[starter.name] = leg;
    if (scaffold.code !== 0) continue;
    for (const args of WAKER_STEPS) steps.push({ args, run: await os(args, dir) });
    leg.gates = await gatesIn(dir);

    if (!starter.placesFields) continue;
    // The control: strip every `group` placement the starter wrote, then ask again.
    const objectsDir = join(dir, 'src', 'objects');
    let stripped = '';
    for (const file of readdirSync(objectsDir).filter((f) => f.endsWith('.object.ts'))) {
      const path = join(objectsDir, file);
      const before = readFileSync(path, 'utf8');
      const after = before.replace(GROUP_LINE, '');
      if (after === before) continue;
      writeFileSync(path, after);
      stripped += after;
    }
    leg.control = { stripped, gates: await gatesIn(dir) };
  }
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#21370] the starters are the real ones', () => {
  it('measures the on-ramp and every object-bearing `os init` template', () => {
    expect(STARTERS.map((s) => s.name)).toEqual(
      expect.arrayContaining(['npm create objectstack', 'os init -t app']),
    );
  });

  it.each(STARTERS.map((s) => s.name))('%s scaffolds, and `os g dashboard | object | view | flow` exit 0', (name) => {
    const leg = legs[name];
    expect(leg.scaffold.code, out(leg.scaffold)).toBe(0);
    expect(leg.steps.map((s) => s.args.join(' '))).toEqual(WAKER_STEPS.map((a) => a.join(' ')));
    for (const { args, run: r } of leg.steps) expect(r.code, `os ${args.join(' ')}\n${out(r)}`).toBe(0);
  });
});

describe('[#21370] every starter, then `os g dashboard`, `os g view`, `os g flow`: zero `field-no-consumers`', () => {
  it.each(STARTERS.flatMap((s) => GATES.map((gate) => [s.name, gate] as const)))(
    '%s, then `os %s`: exit 0 and no `field-no-consumers`',
    (name, gate) => {
      const { run: r, findings } = legs[name].gates[gate];
      expect(r.code, out(r)).toBe(0);
      expect(findings, `os ${gate} --json printed no JSON:\n${out(r)}`).not.toBeNull();
      expect(findings).toEqual([]);
    },
  );
});

describe('[#21370] CONTROL — the starter with its `group` placements stripped warns again', () => {
  it('the starters the defect was measured on have a control', () => {
    expect(CONTROLLED.map((s) => s.name)).toEqual(expect.arrayContaining(['npm create objectstack', 'os init -t app']));
  });

  it.each(CONTROLLED.flatMap((s) => GATES.map((gate) => [s.name, gate] as const)))(
    '%s, `group` stripped, then `os %s`: `field-no-consumers` on the stripped fields only',
    (name, gate) => {
      const control = legs[name].control;
      expect(control, `${name}: the scaffolded project carried no \`group\` line to strip`).not.toBeNull();
      expect(control!.stripped, `${name}: the scaffolded project carried no \`group\` line to strip`).not.toBe('');
      const { run: r, findings } = control!.gates[gate];
      expect(r.code, out(r)).toBe(0);
      expect(findings, `os ${gate} --json printed no JSON:\n${out(r)}`).not.toBeNull();
      expect(findings!.length, `os ${gate} reports nothing once the groups are gone:\n${out(r)}`).toBeGreaterThan(0);
      for (const path of findings!) {
        const field = /^objects\[\d+\]\.fields\.([a-z_][a-z0-9_]*)$/.exec(path)?.[1];
        expect(field, `${path} is a field of an object`).toBeDefined();
        expect(control!.stripped, `${path} is declared in the stripped starter files`).toMatch(
          new RegExp(`^\\s+${field}: `, 'm'),
        );
      }
    },
  );
});
