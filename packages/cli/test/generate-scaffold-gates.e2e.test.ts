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
 * ## Two legs meet the starter's app (#32393)
 *
 * The starter ships one app, `src/apps/main.app.ts`, whose navigation lists
 * the starter's own object. Two generators meet it, and each of their legs
 * pins what the starter really does instead of a zero it cannot give:
 *
 *   os g app          REFUSED. A package whose manifest type is 'app' holds at
 *                     most one app (ADR-0019 D3), and the starter's is that
 *                     one. The leg asserts the refusal names both apps and the
 *                     decision and that nothing was written; its gate legs then
 *                     hold the project the refusal left to zero findings.
 *   os g permission   writes the stack's FIRST permission set, and a stack
 *                     that declares one has its navigation judged by
 *                     `nav-object-ungranted` (a stack with none is not): the
 *                     starter's entry lists an object the new set does not
 *                     grant. That finding is true, and it is the author's to
 *                     answer — the same generator grants the object when asked
 *                     to — so it is neither the scaffold's nor the template's,
 *                     and ⛔ not a ledger line. The leg pins that it fires on
 *                     the starter app's entries and nowhere else, then grants
 *                     each listed object with `os g permission`, as an author
 *                     would, before the three gates run.
 *
 * Both expectations are read off the bare starter's own build, and each must
 * still hold there — so the PR that changes the starter turns this file red.
 *
 * ## The starter ledger — EMPTY since #21370, and shrink-only
 *
 * A bare starter can be clean without being clean: `field-no-consumers` stays
 * silent while the stack has no consumer root at all (a stack of objects is
 * judged to be another stack's object library), so a starter field nothing
 * reads stays latent until the first view, flow, action, app, dashboard or
 * skill in the project, generated or hand-written, wakes it on the STARTER's
 * object. `os g` cannot give someone else's field a consumer, so such a
 * finding is the starter template's to fix, and this file recorded the one it
 * met in a ledger below, ⛔ never in a filter by rule or by path pattern. That
 * entry was the starter note's `body`. #21370 placed every starter field in a
 * keyed field group (`fieldGroups` + `group`), which the rule credits as
 * displayed, and deleted it; `starter-field-consumers.test.ts` and its `.e2e`
 * sibling hold every starter to that.
 *
 * The ledger is SHRINK-ONLY, so EMPTY is where it stays: a starter finding a
 * leg meets is a template to fix, ⛔ never a line to add. Its floor is pinned
 * below. The two checks that held each entry honest stay with it, in case a
 * maintainer ever lifts that floor:
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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');

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
 * must still fire somewhere, or this file is red. EMPTY since #21370; keep it
 * that way.
 */
const STARTER_LATENT_FINDINGS: Record<string, string> = {};

/**
 * [#32393] The generator the bare starter refuses: the starter ships the one
 * app a package of manifest type 'app' may hold (ADR-0019 D3). See the header.
 */
const REFUSED_ON_STARTER = 'app';

/**
 * [#32393] The stack collection `nav-object-ungranted` judges an app's
 * navigation against. A leg whose generator writes into it gives the starter
 * its first permission set, and the rule wakes on the starter app's entries.
 */
const NAV_ACCESS_COLLECTION = 'permissions';

const GATES = ['validate', 'build', 'lint'] as const;
type Gate = (typeof GATES)[number];

type AnyRec = Record<string, unknown>;

/** What a project's `os build` compiled, `dist/objectstack.json`. */
function builtStack(dir: string): AnyRec {
  const file = join(dir, 'dist', 'objectstack.json');
  if (!existsSync(file)) throw new Error(`no ${file}: the project's \`os build\` wrote no artifact`);
  return JSON.parse(readFileSync(file, 'utf-8')) as AnyRec;
}

/** A stack collection's items, whether it compiled to an array or a map. */
const itemsOf = (v: unknown): AnyRec[] =>
  (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [])
    .filter((x): x is AnyRec => !!x && typeof x === 'object');

/**
 * [#32393] Every object a stack's app navigation lists that the stack itself
 * declares, once each, at the path `nav-object-ungranted` reports it: the
 * first `type: 'object'` entry naming it, walking each app's `navigation`
 * (nested `children` included) and then each area's.
 */
function navListedObjects(stack: AnyRec): { objectName: string; path: string }[] {
  const declared = new Set(itemsOf(stack.objects).map((o) => o.name));
  const out: { objectName: string; path: string }[] = [];
  const walk = (items: unknown, base: string) => {
    if (!Array.isArray(items)) return;
    items.forEach((nav: unknown, i) => {
      if (!nav || typeof nav !== 'object') return;
      const { type, objectName, children } = nav as AnyRec;
      if (type === 'object' && typeof objectName === 'string' && declared.has(objectName)
        && !out.some((o) => o.objectName === objectName)) {
        out.push({ objectName, path: `${base}[${i}].objectName` });
      }
      walk(children, `${base}[${i}].children`);
    });
  };
  itemsOf(stack.apps).forEach((app, a) => {
    walk(app.navigation, `apps[${a}].navigation`);
    if (Array.isArray(app.areas)) {
      app.areas.forEach((area: unknown, r) => walk((area as AnyRec | null)?.navigation, `apps[${a}].areas[${r}].navigation`));
    }
  });
  return out;
}

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

const os = (args: string[], cwd: string) => run(process.execPath, [CLI, ...args], cwd);
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
  /**
   * [#32393] For a leg whose generator writes a permission set: `os validate`
   * after the chain and BEFORE the starter's listed objects are granted.
   */
  wake?: { run: Run; findings: string[] | null };
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
const BARE = '(bare starter)';
const LEG_NAMES = [BARE, ...GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type)];
/** [#32393] What the bare starter's app navigation lists, read off its build (the CONTROL leg runs first). */
let starterListed: { objectName: string; path: string }[] = [];

/**
 * [#32393] The `os g permission` that grants an object the starter's app
 * lists, as an author answering `nav-object-ungranted` would run it.
 */
const grantFor = (objectName: string) => [
  'g', 'permission', `${objectName.startsWith(`${NS}_`) ? objectName.slice(NS.length + 1) : objectName}_access`,
  '--object', objectName,
];

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-scaffold-gates-'));
  // Sequential on purpose: cold starts in a container several agents share.
  for (const leg of LEG_NAMES) {
    const legRoot = mkdtempSync(join(root, 'leg-'));
    const scaffold = await run(process.execPath, [ON_RAMP_BIN, PROJECT, '--skip-install', '--skip-skills'], legRoot);
    if (scaffold.code !== 0) throw new Error(`the on-ramp failed for leg ${leg}: ${out(scaffold)}`);
    const dir = join(legRoot, PROJECT);
    const steps: Leg['steps'] = [];
    for (const args of leg === BARE ? [] : chainFor(leg, ITEM)) {
      steps.push({ args, run: await os(args, dir) });
    }
    let wake: Leg['wake'];
    if (leg !== BARE && target(leg).stackKey === NAV_ACCESS_COLLECTION) {
      const r = await os(['validate', '--json'], dir);
      wake = { run: r, findings: findingsOf('validate', r.stdout) };
      for (const { objectName } of starterListed) {
        const args = grantFor(objectName);
        steps.push({ args, run: await os(args, dir) });
      }
    }
    const gates = {} as Leg['gates'];
    for (const gate of GATES) {
      const r = await os([gate, '--json'], dir);
      gates[gate] = { run: r, findings: findingsOf(gate, r.stdout) };
    }
    legs[leg] = { dir, steps, ...(wake ? { wake } : {}), gates };
    if (leg === BARE) starterListed = navListedObjects(builtStack(dir));
  }
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#21325] CONTROL — the bare starter passes all three gates with zero findings', () => {
  it.each(GATES)('`os %s` exits 0 and reports nothing', (gate) => {
    const { run: r, findings } = legs[BARE].gates[gate];
    expect(r.code, out(r)).toBe(0);
    expect(findings, `os ${gate} --json printed no JSON:\n${out(r)}`).not.toBeNull();
    expect(findings).toEqual([]);
  });
});

describe('[#32393] the starter\'s app, which `os g app` and `os g permission` meet', () => {
  const navAccessKinds = GENERATOR_SCAFFOLD_TARGETS.filter((t) => t.stackKey === NAV_ACCESS_COLLECTION).map((t) => t.type);

  it('the bare starter ships the one app its manifest type allows, listing an object it declares', () => {
    const stack = builtStack(legs[BARE].dir);
    expect((stack.manifest as AnyRec | undefined)?.type).toBe('app');
    expect(itemsOf(stack.apps).map((a) => a.name)).toHaveLength(1);
    expect(
      starterListed,
      'the starter app lists no object it declares, so no leg has anything to grant: drop the grant half',
    ).not.toEqual([]);
    expect(navAccessKinds, `no generator writes into \`${NAV_ACCESS_COLLECTION}\``).not.toEqual([]);
  });

  it(`\`os g ${REFUSED_ON_STARTER}\` is refused, one app per app package (ADR-0019 D3), and nothing is written`, () => {
    const leg = legs[REFUSED_ON_STARTER];
    const refused = leg.steps[leg.steps.length - 1];
    expect(refused.args.slice(0, 2)).toEqual(['g', REFUSED_ON_STARTER]);
    for (const { args, run: r } of leg.steps.slice(0, -1)) {
      expect(r.code, `os ${args.join(' ')}\n${out(r)}`).toBe(0);
    }
    const said = out(refused.run);
    expect(refused.run.code, said).toBe(1);
    expect(said).toContain('Refusing to generate');
    // The decision, and both apps it counts: the starter's and the scaffold's.
    expect(said).toMatch(/ADR-0019\b.*\bD3\b/);
    expect(said).toContain(String(itemsOf(builtStack(legs[BARE].dir).apps)[0]?.name));
    expect(said).toContain(target(REFUSED_ON_STARTER).itemName(ITEM, NS));
    const apps = (dir: string) => readdirSync(join(dir, 'src', 'apps')).sort();
    expect(apps(leg.dir)).toEqual(apps(legs[BARE].dir));
    expect(readFileSync(join(leg.dir, 'src', 'apps', 'index.ts'), 'utf-8'))
      .toBe(readFileSync(join(legs[BARE].dir, 'src', 'apps', 'index.ts'), 'utf-8'));
  });

  it.each(navAccessKinds)(
    '`os g %s` gives the starter its first permission set: `nav-object-ungranted` wakes on the starter app\'s entries, nowhere else',
    (kind) => {
      const { wake } = legs[kind];
      expect(wake, `leg ${kind} ran no \`os validate\` before granting`).toBeDefined();
      expect(wake!.run.code, out(wake!.run)).toBe(0);
      expect(wake!.findings, `os validate --json printed no JSON:\n${out(wake!.run)}`).not.toBeNull();
      expect([...wake!.findings!].sort()).toEqual(
        starterListed.map(({ path }) => `nav-object-ungranted@${path}`).sort(),
      );
    },
  );
});

describe('[#21325] every generator: fresh starter + `os g <kind>` → zero findings at every gate', () => {
  const kinds = GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type);

  it('measures every generator on the roster', () => {
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) expect(legs[kind], kind).toBeDefined();
  });

  // The refused one is pinned above: its prerequisites exit 0, it exits 1.
  it.each(kinds.filter((kind) => kind !== REFUSED_ON_STARTER))('`os g %s` and its prerequisites exit 0', (kind) => {
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
  it('[#21370] is at its floor: EMPTY — a starter finding is a template to fix, never a line to add', () => {
    expect(
      Object.keys(STARTER_LATENT_FINDINGS),
      'STARTER_LATENT_FINDINGS is shrink-only and was emptied by #21370: fix the starter template instead',
    ).toEqual([]);
  });

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
    const starterObjects = objectsOf(legs[BARE].dir);
    for (const { leg } of fired(key)) {
      expect(starterObjects, `${key} in leg ${leg}`).toContain(objectsOf(legs[leg].dir)[Number(index)]);
    }
  });
});

/**
 * PIN (#32153), end to end on a fresh `os init` project (template `app`):
 * the generator variants this card added pass `os validate`, `os build` and
 * `os lint` with ZERO findings, and the refusal it added writes nothing.
 *
 * The legs above run the `npm create objectstack` starter with each
 * generator's default invocation; these are the invocations that did not
 * exist before, on the other scaffolder's project, which carries a starter
 * app (ADR-0019 D3: at most one) and a views container for its object:
 *
 *   os g object ticket                         the starter's style (`Field.*`,
 *                                              a named export, a field group)
 *   os g view open_tickets --object ticket     a view named apart from its object
 *   os g action resolve --object ticket        no flow declared: a declarative update
 *   os g dashboard overview                    prints the entry for the ONE app
 *   os g view all_items --object item          the starter object already has a
 *                                              container: refused, nothing written
 */
describe('[#32153] a fresh `os init` project: the new generator variants pass every gate', () => {
  const INIT_PROJECT = 'gates-init';
  const INIT_NS = 'gates_init';
  const VARIANTS = [
    ['g', 'object', 'ticket'],
    ['g', 'view', 'open_tickets', '--object', 'ticket'],
    ['g', 'action', 'resolve', '--object', 'ticket'],
    ['g', 'dashboard', 'overview'],
  ] as const;
  let initRoot = '';
  let dir = '';
  const steps = new Map<string, Run>();
  const gates = {} as Record<Gate, { run: Run; findings: string[] | null }>;
  let refusal: Run;
  let viewsBeforeRefusal: string[] = [];
  let viewsAfterRefusal: string[] = [];

  beforeAll(async () => {
    initRoot = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-variants-init-'));
    const init = await os(['init', INIT_PROJECT, '-t', 'app', '--no-install'], initRoot);
    if (init.code !== 0) throw new Error(`os init failed: ${out(init)}`);
    dir = join(initRoot, INIT_PROJECT);
    for (const args of VARIANTS) steps.set(args.join(' '), await os([...args], dir));
    for (const gate of GATES) {
      const r = await os([gate, '--json'], dir);
      gates[gate] = { run: r, findings: findingsOf(gate, r.stdout) };
    }
    viewsBeforeRefusal = readdirSync(join(dir, 'src', 'views')).sort();
    refusal = await os(['g', 'view', 'all_items', '--object', 'item'], dir);
    viewsAfterRefusal = readdirSync(join(dir, 'src', 'views')).sort();
  }, RUN_TIMEOUT_MS);

  afterAll(() => {
    if (initRoot) rmSync(initRoot, { recursive: true, force: true });
  });

  const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf-8');

  it.each(VARIANTS.map((args) => args.join(' ')))('`os %s` exits 0', (id) => {
    const r = steps.get(id)!;
    expect(r.code, out(r)).toBe(0);
  });

  it.each(GATES)('then `os %s`: exit 0 and no finding at any severity', (gate) => {
    const { run: r, findings } = gates[gate];
    expect(r.code, out(r)).toBe(0);
    expect(findings, `os ${gate} --json printed no JSON:\n${out(r)}`).not.toBeNull();
    expect(findings).toEqual([]);
  });

  it('the object is written in the starter style, and its barrel line re-exports it by name', () => {
    const object = read('src', 'objects', 'ticket.object.ts');
    expect(object).toContain('export const ticket = ObjectSchema.create({');
    expect(object).toMatch(/name: Field\.text\(\{/);
    expect(object).toContain("fieldGroups: [\n    { key: 'details', label: 'Details' },");
    expect(read('src', 'objects', 'index.ts')).toContain("export { ticket } from './ticket.object';");
  });

  it('the view is a named list view of the object, and the action a declarative update', () => {
    const view = read('src', 'views', 'open_tickets.view.ts');
    expect(view).toContain(`object: '${INIT_NS}_ticket',`);
    expect(view).toMatch(/listViews: \{\n {4}open_tickets: \{/);
    const action = read('src', 'actions', 'resolve.action.ts');
    expect(action).toContain("operation: 'update',");
    // No flow binding at the action's top level (its comment may still name one).
    expect(action).not.toMatch(/^ {2}(?:type: 'flow'|target: )/m);
  });

  it('the dashboard names the navigation entry that lists it, and the one app to add it to', () => {
    const printed = out(steps.get('g dashboard overview')!);
    expect(printed).toContain(`dashboardName: '${INIT_NS}_overview_dashboard'`);
    expect(printed).toContain(`'${INIT_NS}_main_app'`);
    // `os g` edits no app: the starter app is the one `os init` wrote.
    expect(read('src', 'apps', 'main.app.ts')).not.toContain('overview');
  });

  it('a named view for an object that already has a container is refused, and nothing is written', () => {
    expect(refusal.code, out(refusal)).toBe(1);
    expect(out(refusal)).toContain('listViews');
    expect(viewsAfterRefusal).toEqual(viewsBeforeRefusal);
  });
});
