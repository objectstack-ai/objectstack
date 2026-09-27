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
 *                   scaffold runs on: the WHOLE requires list printed.
 *   refused         a config that loaded before the write and does not load
 *                   after it — an action bound to an object nobody declared, a
 *                   flow in a stack without `triggers`: exit 1, and the project
 *                   tree byte-identical, because the write is taken back out.
 *
 * A control keeps the refusal from being a command that refuses everything:
 * in the same project, once the object exists, the same action generates.
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

/** oclif + tsx cold starts, nine of them, sequential. */
const RUN_TIMEOUT_MS = 300_000;

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
  before.preFixConfig = { [CONFIG]: readFileSync(join(dirs.preFix, CONFIG), 'utf-8') };

  // Sequential on purpose: cold tsx starts in a container several agents share.
  // Each refusal runs BEFORE its project's control, so the snapshots above are
  // what each refusal was measured against.
  runs.actionNoObject = await runCli(['g', 'action', 'approve'], dirs.wired);
  wiredAfterRefusal = tree(dirs.wired);
  actionFileAfterRefusal = existsSync(join(dirs.wired, 'src', 'actions', 'approve.action.ts'));
  runs.flowNoRequires = await runCli(['g', 'flow', 'order_line'], dirs.noRequires);
  noRequiresAfterRefusal = tree(dirs.noRequires);

  runs.objectControl = await runCli(['g', 'object', 'approve'], dirs.wired);
  runs.actionControl = await runCli(['g', 'action', 'approve'], dirs.wired);

  // `port` is inside the `export {};` of the empty barrel `os init` writes:
  // the substring test this replaced read it as already exported.
  runs.dashboardPort = await runCli(['g', 'dashboard', 'port'], dirs.wired);

  runs.flowTriggersOnly = await runCli(['g', 'flow', 'order_line'], dirs.triggersOnly);
  runs.viewPreFix = await runCli(['g', 'view', 'order_line'], dirs.preFix);
  runs.viewBare = await runCli(['g', 'view', 'order_line'], dirs.bare);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const out = (r: Run) => r.stdout + r.stderr;

describe('[#20215] refused: the write would stop a loading config from loading', () => {
  it('an action bound to an object nobody declared: exit 1, the tree byte-identical', () => {
    expect(runs.actionNoObject.code, out(runs.actionNoObject)).toBe(1);
    expect(wiredAfterRefusal).toEqual(before.wired);
    expect(actionFileAfterRefusal).toBe(false);
    // The subject is named: the object the action binds to.
    expect(runs.actionNoObject.stdout).toContain(`${NS}_approve`);
    expect(runs.actionNoObject.stdout).not.toContain('Created');
  });

  it('a flow in a stack whose `requires` lacks `triggers`: exit 1, the tree byte-identical', () => {
    expect(runs.flowNoRequires.code, out(runs.flowNoRequires)).toBe(1);
    expect(noRequiresAfterRefusal).toEqual(before.noRequires);
    expect(runs.flowNoRequires.stdout).toContain("requires: ['automation', 'triggers']");
  });

  it('CONTROL: in the same project, once the object exists, the same action generates and reaches', () => {
    expect(runs.objectControl.code, out(runs.objectControl)).toBe(0);
    expect(runs.actionControl.code, out(runs.actionControl)).toBe(0);
    expect(readFileSync(join(dirs.wired, 'src', 'actions', 'index.ts'), 'utf-8'))
      .toContain("export { default as approve } from './approve.action';");
    expect(runs.actionControl.stdout).toContain("'approve'");
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
    expect(existsSync(join(dirs.preFix, 'src', 'views', 'order_line.view.ts'))).toBe(true);
    expect(readFileSync(join(dirs.preFix, CONFIG), 'utf-8')).toBe(before.preFixConfig[CONFIG]);
    expect(runs.viewPreFix.stdout).toContain("import * as views from './src/views';");
    expect(runs.viewPreFix.stdout).toContain('views: Object.values(views),');
    expect(runs.viewPreFix.stdout).toContain(`'${NS}_order_line'`);
  });

  it('a directory with no config', () => {
    expect(runs.viewBare.code, out(runs.viewBare)).toBe(0);
    expect(existsSync(join(dirs.bare, 'src', 'views', 'order_line.view.ts'))).toBe(true);
    expect(runs.viewBare.stdout).toContain("import * as views from './src/views';");
  });
});

describe('[#20215] cannot run: reached, and a capability it runs on is missing', () => {
  it('a flow in a stack that requires `triggers` but not `automation`', () => {
    expect(runs.flowTriggersOnly.code, out(runs.flowTriggersOnly)).toBe(0);
    expect(runs.flowTriggersOnly.stdout).toContain("'order_line_flow'");
    // The whole list, never a second `requires` key beside the first.
    expect(runs.flowTriggersOnly.stdout).toContain("requires: ['triggers', 'automation'],");
    expect(runs.flowTriggersOnly.stdout).not.toContain('import * as flows');
  });
});
