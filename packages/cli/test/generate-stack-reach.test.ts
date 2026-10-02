// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20215) — after writing, `os generate` says whether the scaffold
 * reached the stack, and never leaves a config that loaded unable to load.
 *
 * `os g` loads the project's config once more with the scaffold in place and
 * asks the stack it evaluates to (`utils/scaffold-wiring.ts`). Four answers,
 * each held here through the real command:
 *
 *   reached         a project `os init` shaped: the barrel is wired, nothing
 *                   to add — the wiring lines are NOT printed.
 *   not wired       a config that imports `./src/objects` alone (every
 *                   `os init` project before this change) or no config at all:
 *                   exit 0, the config byte-identical, and the exact import and
 *                   key lines that wire it printed.
 *   cannot run      reached, but the stack's `requires` lacks a token the
 *                   scaffold runs on: the WHOLE requires list printed. No
 *                   scaffold reaches it through this command since #20332:
 *                   the flow scaffold's only tokens are the pair, and
 *                   `defineStack` refuses a record-change flow in a stack that
 *                   lacks EITHER one, so that stack is `refused` below.
 *   refused         a config that loaded before the write and does not load
 *                   after it — a flow in a stack without `triggers`, a flow in
 *                   a stack with `triggers` but not `automation`: exit 1, and
 *                   the project tree byte-identical, because the write is
 *                   taken back out.
 *
 * Since #21325 a scaffold that BINDS metadata (`view`, `action`, `flow`,
 * `app`) is refused one step earlier when what it binds is not declared —
 * before anything is written, so there is nothing to take back out — and
 * outside a project, where there is no stack to bind in. Every branch of that
 * resolution is pinned in-process (`generate-binds-from-stack.test.ts`); the
 * spawned half is here: exit 1 and a byte-identical tree.
 *
 * A control keeps the refusal from being a command that refuses everything:
 * in the same project, once the object and a flow exist, the same action
 * generates — taking the stack's only flow, said out loud.
 *
 * Prose is not pinned. What is asserted is the exit status, the bytes on
 * disk, the named subject, and the lines an author pastes (the wiring lines
 * are code, consumed verbatim).
 *
 * ## Why a child process, and why this file is NOT named `.e2e`
 *
 * An exit status and bytes on disk are the contract, `process.exit` inside a
 * vitest worker is not an exit status, and `printError` writes to stdout.
 * Spawning puts the file in the `integration` project; the name keeps it in
 * the per-PR run. The whole `os init` → `os g` every type → `os validate`
 * chain is `generate-scaffolds-reach-stack.e2e.test.ts`, nightly.
 *
 * Projects are written through the `os init` template's own emitters and live
 * under this package's `node_modules`, so a config's `@objectstack/spec`
 * import resolves to the workspace copy without an install.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, sanitizeNamespace, writeTemplateSrcFiles } from '../src/commands/init.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold starts, eleven of them, sequential. */
const RUN_TIMEOUT_MS = 360_000;

const PROJECT = 'my-app';
const NS = sanitizeNamespace(PROJECT);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
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

/** Every file under `dir`, path → sha1, so "nothing was written" is a byte fact. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha1').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const CONFIG = 'objectstack.config.ts';

/** An `os init -t app` project, optionally with its config rewritten. */
function initProject(dir: string, rewrite?: (config: string) => string): void {
  mkdirSync(dir, { recursive: true });
  const config = TEMPLATES.app.configContent(PROJECT, NS);
  const next = rewrite ? rewrite(config) : config;
  if (rewrite && next === config) throw new Error(`fixture rewrite matched nothing for ${dir}`);
  writeFileSync(join(dir, CONFIG), next);
  writeTemplateSrcFiles(TEMPLATES.app.srcFiles, dir, PROJECT, NS);
}

/** The config every `os init` project had before this change: objects only. */
const PRE_FIX_CONFIG = `import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.my-app',
    namespace: '${NS}',
    version: '0.1.0',
    type: 'app',
    name: 'My App',
  },
  objects: Object.values(objects),
});
`;

let root: string;
const dirs = { wired: '', noRequires: '', triggersOnly: '', preFix: '', bare: '' };
const before: Record<string, Record<string, string>> = {};
const runs: Record<string, Run> = {};
let wiredAfterRefusal: Record<string, string>;
let actionFileAfterRefusal: boolean;
let noRequiresAfterRefusal: Record<string, string>;
let triggersOnlyAfterRefusal: Record<string, string>;

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-stack-reach-'));
  dirs.wired = join(root, 'wired');
  dirs.noRequires = join(root, 'no-requires');
  dirs.triggersOnly = join(root, 'triggers-only');
  dirs.preFix = join(root, 'pre-fix');
  dirs.bare = join(root, 'bare');

  initProject(dirs.wired);
  initProject(dirs.noRequires, (c) => c.replace(/^ {2}requires: \[.*\],\n/m, ''));
  initProject(dirs.triggersOnly, (c) => c.replace(/^ {2}requires: \[.*\],$/m, "  requires: ['triggers'],"));
  initProject(dirs.preFix);
  writeFileSync(join(dirs.preFix, CONFIG), PRE_FIX_CONFIG);
  mkdirSync(dirs.bare, { recursive: true });

  before.wired = tree(dirs.wired);
  before.noRequires = tree(dirs.noRequires);
  before.triggersOnly = tree(dirs.triggersOnly);
  before.preFixConfig = { [CONFIG]: readFileSync(join(dirs.preFix, CONFIG), 'utf-8') };

  // Sequential on purpose: cold tsx starts in a container several agents share.
  // Each refusal runs BEFORE its project's control, so the snapshots above are
  // what each refusal was measured against.
  // [#21325] `--object approve`: an object this stack does not declare. The
  // action used to bind `${NS}_approve` because the ACTION was called that.
  runs.actionNoObject = await runCli(['g', 'action', 'approve', '--object', 'approve'], dirs.wired);
  wiredAfterRefusal = tree(dirs.wired);
  actionFileAfterRefusal = existsSync(join(dirs.wired, 'src', 'actions', 'approve.action.ts'));
  runs.flowNoRequires = await runCli(['g', 'flow', 'order_line'], dirs.noRequires);
  noRequiresAfterRefusal = tree(dirs.noRequires);

  runs.objectControl = await runCli(['g', 'object', 'approve'], dirs.wired);
  runs.flowControl = await runCli(['g', 'flow', 'approval_changed', '--object', 'approve'], dirs.wired);
  runs.actionControl = await runCli(['g', 'action', 'approve', '--object', 'approve'], dirs.wired);

  // `port` is inside the `export {};` of the empty barrel `os init` writes:
  // the substring test this replaced read it as already exported.
  runs.dashboardPort = await runCli(['g', 'dashboard', 'port'], dirs.wired);

  runs.flowTriggersOnly = await runCli(['g', 'flow', 'order_line'], dirs.triggersOnly);
  triggersOnlyAfterRefusal = tree(dirs.triggersOnly);
  // `item` names the template's own object, `${NS}_item`: a view is named
  // after the object it binds, and the stack has to declare it (#21325).
  runs.viewPreFix = await runCli(['g', 'view', 'item'], dirs.preFix);
  // No config: a scaffold that binds nothing is still written and reported
  // not wired; one that binds an object has no stack to bind in (#21325).
  runs.dashboardBare = await runCli(['g', 'dashboard', 'sales'], dirs.bare);
  runs.viewBare = await runCli(['g', 'view', 'order_line'], dirs.bare);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const out = (r: Run) => r.stdout + r.stderr;

describe('[#21325] refused before writing: what a scaffold binds, the stack does not declare', () => {
  it('an action bound to an object nobody declared: exit 1, the tree byte-identical', () => {
    expect(runs.actionNoObject.code, out(runs.actionNoObject)).toBe(1);
    expect(wiredAfterRefusal).toEqual(before.wired);
    expect(actionFileAfterRefusal).toBe(false);
    // The subjects are named: the value passed, and the objects the stack
    // does declare, for the author to pick from.
    expect(runs.actionNoObject.stdout).toContain('--object approve');
    expect(runs.actionNoObject.stdout).toContain(`'${NS}_item'`);
    expect(runs.actionNoObject.stdout).not.toContain('Created');
  });

  it('a view outside any project: exit 1, nothing written', () => {
    expect(runs.viewBare.code, out(runs.viewBare)).toBe(1);
    expect(existsSync(join(dirs.bare, 'src', 'views'))).toBe(false);
    expect(runs.viewBare.stdout).toContain('objectstack.config');
  });
});

describe('[#20215] refused: the write would stop a loading config from loading', () => {

  it('a flow in a stack whose `requires` lacks `triggers`: exit 1, the tree byte-identical', () => {
    expect(runs.flowNoRequires.code, out(runs.flowNoRequires)).toBe(1);
    expect(noRequiresAfterRefusal).toEqual(before.noRequires);
    expect(runs.flowNoRequires.stdout).toContain("requires: ['automation', 'triggers']");
  });

  // [#20332] This stack was the `cannot run` answer — the config loaded and the
  // server never ran the flow. `defineStack` now refuses `triggers` without
  // `automation`, so the write stops the config from loading and is refused.
  it('a flow in a stack that requires `triggers` but not `automation`: exit 1, the tree byte-identical', () => {
    expect(runs.flowTriggersOnly.code, out(runs.flowTriggersOnly)).toBe(1);
    expect(triggersOnlyAfterRefusal).toEqual(before.triggersOnly);
    expect(existsSync(join(dirs.triggersOnly, 'src', 'flows', 'order_line.flow.ts'))).toBe(false);
    // The subject is named: the token the stack lacks, in the stack's own reason.
    expect(runs.flowTriggersOnly.stdout).toContain("does not include 'automation'");
    // The line an author pastes: the whole pair.
    expect(runs.flowTriggersOnly.stdout).toContain("requires: ['automation', 'triggers']");
    expect(runs.flowTriggersOnly.stdout).not.toContain('Created');
  });

  it('CONTROL: in the same project, once the object and a flow exist, the same action generates and reaches', () => {
    expect(runs.objectControl.code, out(runs.objectControl)).toBe(0);
    expect(runs.flowControl.code, out(runs.flowControl)).toBe(0);
    expect(runs.actionControl.code, out(runs.actionControl)).toBe(0);
    expect(readFileSync(join(dirs.wired, 'src', 'actions', 'index.ts'), 'utf-8'))
      .toContain("export { default as approve } from './approve.action';");
    expect(runs.actionControl.stdout).toContain("'approve'");
    // The bindings, named: the object passed, and the stack's only flow.
    const action = readFileSync(join(dirs.wired, 'src', 'actions', 'approve.action.ts'), 'utf-8');
    expect(action).toContain(`objectName: '${NS}_approve'`);
    expect(action).toContain("target: 'approval_changed_flow'");
    expect(runs.actionControl.stdout).toContain('approval_changed_flow');
    // Reached: no wiring lines to add.
    expect(runs.actionControl.stdout).not.toContain('import * as actions');
  });
});

describe('[#20215] the barrel step asks which names the barrel exports, not what its text contains', () => {
  it('`os g dashboard port` into the empty `export {};` barrel exports `port`, and reaches', () => {
    expect(runs.dashboardPort.code, out(runs.dashboardPort)).toBe(0);
    expect(readFileSync(join(dirs.wired, 'src', 'dashboards', 'index.ts'), 'utf-8'))
      .toContain("export { default as port } from './port.dashboard';");
    expect(runs.dashboardPort.stdout).not.toContain('import * as dashboards');
  });
});

describe('[#20215] not wired: exit 0, the config untouched, and the lines that wire it', () => {
  it('a config that wires `./src/objects` alone', () => {
    expect(runs.viewPreFix.code, out(runs.viewPreFix)).toBe(0);
    expect(existsSync(join(dirs.preFix, 'src', 'views', 'item.view.ts'))).toBe(true);
    expect(readFileSync(join(dirs.preFix, CONFIG), 'utf-8')).toBe(before.preFixConfig[CONFIG]);
    expect(runs.viewPreFix.stdout).toContain("import * as views from './src/views';");
    expect(runs.viewPreFix.stdout).toContain('views: Object.values(views),');
    expect(runs.viewPreFix.stdout).toContain(`'${NS}_item'`);
  });

  it('a directory with no config', () => {
    expect(runs.dashboardBare.code, out(runs.dashboardBare)).toBe(0);
    expect(existsSync(join(dirs.bare, 'src', 'dashboards', 'sales.dashboard.ts'))).toBe(true);
    expect(runs.dashboardBare.stdout).toContain("import * as dashboards from './src/dashboards';");
  });
});

