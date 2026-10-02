// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#21325), end to end — for EVERY generator on the roster, a fresh
 * `npm create objectstack` project plus `os g <kind>` passes `os validate`,
 * `os build` and `os lint` with ZERO findings, warnings included.
 *
 * ## The defect, measured through these commands
 *
 * On a fresh starter (namespace `tasks_app`) after `os g object project` and
 * `os g object task`, on `origin/main` 97239c3c8a:
 *
 *   os g flow task_done        exit 0; `os validate` warned the flow targets
 *                              `tasks_app_task_done` (its own name, prefixed)
 *                              and is `draft`
 *   os g view task             `os lint` exit 1, `required/label` at
 *                              views[0].list.label; `name` / `label` dead
 *   os g action complete_task  exit 1, object and flow derived from its name
 *   os g app tasks             exit 1, object derived from its name
 *
 * and every generated object's `description` was a `field-no-consumers`
 * warning once anything else was generated. The per-PR, in-process half of
 * this pin is `generate-scaffold-validates.test.ts`; this file runs the real
 * commands on the real starter, where only a real project can disagree.
 *
 * ## One leg per generator, built from the roster
 *
 * Each leg is its own fresh project: the on-ramp's `bin/` scaffolds it, then
 * every prerequisite the generator `binds` is generated first — the object it
 * binds (`os g object`), the flow an action runs (`os g flow`) — and handed
 * over by flag, exactly as an author would type it. The target is deliberately
 * NOT named like the item (`gate_target` vs `gate_probe`): a scaffold that
 * derived its binding from its own name fails here. A generator added to the
 * roster gets a leg with no edit to this file.
 *
 * A CONTROL leg runs the three commands on the bare starter: zero findings,
 * which is what makes a finding in any other leg one that `os g` caused.
 *
 * ## The one exemption, and why it is a ledger and not a filter
 *
 * The bare starter is clean, but not because it has nothing to report: its
 * own `note` object declares a `body` field that nothing reads, and
 * `field-no-consumers` stays silent only while the stack has no consumer root
 * at all (a stack of objects is judged to be another stack's object library).
 * The first view, flow, action, app, dashboard or skill in the project — any
 * of them, generated or hand-written — wakes that finding on the STARTER's
 * object. It is the starter template's to fix (`os g` cannot give someone
 * else's field a consumer), so it is recorded below, ⛔ never filtered by rule
 * or by path pattern. The ledger is SHRINK-ONLY and holds itself honest:
 *
 *   - an entry must name a finding on an object the bare starter declares,
 *     so it can never cover what a scaffold wrote;
 *   - an entry must still fire in at least one leg, so the PR that fixes the
 *     starter turns this file red and deletes it.
 *
 * Nightly (`.e2e`): about forty oclif + tsx cold starts. Projects live under
 * this package's `node_modules`, so the starter's imports — `@objectstack/spec`
 * and the three connector packages, this package's devDependencies for that
 * reason — resolve to workspace copies without an install. The on-ramp's
 * `bin/` and the starter's tree are declared cross-package inputs of this
 * package (scripts/cross-package-test-inputs.mjs).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

// One `resolve(HERE, …)` call per line: `check:cross-package-test-inputs`
// reconstructs this read by SOURCE SCAN.
const ON_RAMP_BIN = resolve(HERE, '../../..', 'packages/create-objectstack/bin/create-objectstack.js');

/** Nine scaffolds and about forty cold starts, sequential. */
const RUN_TIMEOUT_MS = 1_200_000;

const PROJECT = 'tasks-app';
const NS = 'tasks_app';
/** The name each generator is invoked with. */
const ITEM = 'gate_probe';
/** The stems prerequisites are generated under: deliberately not `ITEM`. */
const PREREQUISITE_STEM: Record<string, string> = { object: 'gate_target', flow: 'gate_target_changed' };

/**
 * Findings the bare starter carries latently, by `rule@path`. SHRINK-ONLY —
 * see the header: each must sit on an object the starter declares, and each
 * must still fire somewhere, or this file is red.
 */
const STARTER_LATENT_FINDINGS: Record<string, string> = {
  'field-no-consumers@objects[0].fields.body':
    "The starter's own `note` object declares `body` and nothing in the starter reads it. "
    + 'Silent while the stack has no consumer root; the first view, flow, action, app, '
    + 'dashboard or skill wakes it. The starter template owns the fix.',
};

const GATES = ['validate', 'build', 'lint'] as const;
type Gate = (typeof GATES)[number];

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

const target = (type: string) => {
  const t = GENERATOR_SCAFFOLD_TARGETS.find((g) => g.type === type);
  if (!t) throw new Error(`no '${type}' generator in the roster`);
  return t;
};

/**
 * The `os g` invocations one leg runs: every prerequisite `binds` names, then
 * the generator itself, each once. A view is named after its object; every
 * other binding is handed over by its flag.
 */
function chainFor(type: string, name: string, steps: string[][] = [], seen = new Set<string>()): string[][] {
  const t = target(type);
  const args = ['g', type, t.binds.object === 'name' ? PREREQUISITE_STEM.object : name];
  for (const key of Object.keys(t.binds)) {
    const stem = PREREQUISITE_STEM[key];
    if (stem === undefined) throw new Error(`\`os g ${type}\` binds a '${key}': give it a prerequisite stem here`);
    chainFor(key, stem, steps, seen);
    if (t.binds[key as keyof typeof t.binds] === 'flag') {
      args.push(`--${key}`, key === 'object' ? stem : target(key).itemName(stem, NS));
    }
  }
  const id = args.join(' ');
  if (!seen.has(id)) {
    seen.add(id);
    steps.push(args);
  }
  return steps;
}

interface Leg {
  dir: string;
  steps: { args: string[]; run: Run }[];
  gates: Record<Gate, { run: Run; findings: string[] | null }>;
}

/** `rule@path` for every finding a gate's `--json` reports, any severity; `null` when it printed no JSON. */
function findingsOf(gate: Gate, stdout: string): string[] | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
  const lists = gate === 'lint' ? [body.issues] : [body.errors, body.warnings];
  return lists
    .flatMap((l) => (Array.isArray(l) ? l : []))
    .map((f) => `${(f as { rule?: unknown }).rule}@${(f as { path?: unknown }).path}`);
}

let root: string;
const legs: Record<string, Leg> = {};
const LEG_NAMES = ['(bare starter)', ...GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type)];

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-scaffold-gates-'));
  // Sequential on purpose: cold starts in a container several agents share.
  for (const leg of LEG_NAMES) {
    const legRoot = mkdtempSync(join(root, 'leg-'));
    const scaffold = await run(process.execPath, [ON_RAMP_BIN, PROJECT, '--skip-install', '--skip-skills'], legRoot);
    if (scaffold.code !== 0) throw new Error(`the on-ramp failed for leg ${leg}: ${out(scaffold)}`);
    const dir = join(legRoot, PROJECT);
    const steps: Leg['steps'] = [];
    for (const args of leg === '(bare starter)' ? [] : chainFor(leg, ITEM)) {
      steps.push({ args, run: await os(args, dir) });
    }
    const gates = {} as Leg['gates'];
    for (const gate of GATES) {
      const r = await os([gate, '--json'], dir);
      gates[gate] = { run: r, findings: findingsOf(gate, r.stdout) };
    }
    legs[leg] = { dir, steps, gates };
  }
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#21325] CONTROL — the bare starter passes all three gates with zero findings', () => {
  it.each(GATES)('`os %s` exits 0 and reports nothing', (gate) => {
    const { run: r, findings } = legs['(bare starter)'].gates[gate];
    expect(r.code, out(r)).toBe(0);
    expect(findings, `os ${gate} --json printed no JSON:\n${out(r)}`).not.toBeNull();
    expect(findings).toEqual([]);
  });
});

describe('[#21325] every generator: fresh starter + `os g <kind>` → zero findings at every gate', () => {
  const kinds = GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type);

  it('measures every generator on the roster', () => {
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) expect(legs[kind], kind).toBeDefined();
  });

  it.each(kinds)('`os g %s` and its prerequisites exit 0', (kind) => {
    for (const { args, run: r } of legs[kind].steps) {
      expect(r.code, `os ${args.join(' ')}\n${out(r)}`).toBe(0);
    }
  });

  it.each(kinds.flatMap((kind) => GATES.map((gate) => [kind, gate] as const)))(
    '`os g %s`, then `os %s`: exit 0 and no finding beyond the starter ledger',
    (kind, gate) => {
      const { run: r, findings } = legs[kind].gates[gate];
      expect(r.code, out(r)).toBe(0);
      expect(findings, `os ${gate} --json printed no JSON:\n${out(r)}`).not.toBeNull();
      expect(findings!.filter((f) => !(f in STARTER_LATENT_FINDINGS))).toEqual([]);
    },
  );
});

describe('[#21325] the starter ledger cannot outlive its defect or cover a scaffold', () => {
  const fired = (key: string) =>
    Object.entries(legs).flatMap(([leg, l]) =>
      GATES.filter((gate) => l.gates[gate].findings?.includes(key)).map((gate) => ({ leg, gate })));

  it.each(Object.keys(STARTER_LATENT_FINDINGS))('`%s` still fires — delete it when the starter is fixed', (key) => {
    expect(fired(key), `${key} no longer fires anywhere: delete its STARTER_LATENT_FINDINGS entry`).not.toEqual([]);
  });

  it.each(Object.keys(STARTER_LATENT_FINDINGS))('`%s` sits on an object the bare starter declares', (key) => {
    const index = /^[^@]+@objects\[(\d+)\]/.exec(key)?.[1];
    expect(index, `${key} must be located on an object`).toBeDefined();
    const objectsOf = (dir: string) =>
      ((JSON.parse(readFileSync(join(dir, 'dist', 'objectstack.json'), 'utf-8')) as { objects?: { name?: string }[] })
        .objects ?? []).map((o) => o.name);
    const starterObjects = objectsOf(legs['(bare starter)'].dir);
    for (const { leg } of fired(key)) {
      expect(starterObjects, `${key} in leg ${leg}`).toContain(objectsOf(legs[leg].dir)[Number(index)]);
    }
  });
});
