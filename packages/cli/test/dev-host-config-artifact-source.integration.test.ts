// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 65 — five real boots in one beforeAll (two `os dev` legs on a host config, three CONTROL boots) plus one compile; slowest local reading 50.80 s (shared box, under the verify lock) x 1.25, rounded up

/**
 * #31761 — on `os dev` over a HOST config, the boot serves ONE copy of the
 * stack: the compiled artifact the dev artifact door reads.
 *
 * ## The defect, measured at the public doors before the fix
 *
 * A host config (its `plugins[]` holds an object with `init`, as the blank
 * scaffold's connector plugins do) never reaches `createStandaloneStack`. Under
 * `os dev` it composed two writers over one stack: the dev artifact door, over
 * `dist/objectstack.json`, and an `AppPlugin` wrap over the config MODULE, which
 * registered last and won the cold boot for the types it registers. Measured on
 * `examples/app-crm` with an inline host marker, artifact compiled from one
 * source and the source then edited, `os dev --no-compile`:
 *
 *   | reader                         | before                 | after              |
 *   |--------------------------------|------------------------|--------------------|
 *   | `GET /api/v1/forms/SLUG`       | 200 (edited source)    | 404 (artifact)     |
 *   | `/meta/view` list label        | edited source          | artifact           |
 *   | `/meta/object` field           | artifact               | artifact           |
 *   | ready banner row               | `Config:`              | `Artifact:`        |
 *
 * while the supervisor printed "this boot serves the STALE build" over a boot
 * that served a mix. The wrap now carries the door's file, and the module adds
 * only the members a JSON artifact cannot carry (`onEnable`, `functions`),
 * grafted — the composition `createStandaloneStack` already gives a non-host
 * config.
 *
 * ## What this pins
 *
 * One fixture project, two copies of every probed item: the artifact compiled
 * from the ART source (form closed, list label `Leads ART`, `name.maxLength`
 * 201), then the SRC source written over it (form open, `Leads SRC`, 202).
 *
 *   1. host, `os dev --no-compile`: the artifact for forms, views AND objects;
 *      the STALE warning, word for word; the banner names the artifact; and the
 *      module's `onEnable` still runs (the artifact carries none, so only the
 *      graft can have run it).
 *   2. host, `os dev` (compiles at boot): the edited source for all three, the
 *      hook the source declares fires on insert, `onEnable` runs.
 *   3. CONTROLS, unchanged by the fix: `os start` on the host config (no dev
 *      door: the module wrap is the only copy, so SRC), a NON-host copy of the
 *      fixture under `os dev --no-compile` (the standalone stack: ART), and an
 *      artifact-only directory under `os start` (ART).
 *
 * Spawn shape as `dev-connector-env-parity.integration.test.ts`: the shipped
 * `bin/run.js`, `NODE_ENV` unset, its own process group — on a KERNEL-ASSIGNED
 * port read back from the banner (no number of this file's is the subject).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_AUTH_SECRET,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  probeThroughChild,
  readKernelAssignedPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

const OBJECT = 'hx_lead';
const SLUG = 'hx-intake';
/** The file the module's `onEnable` writes into the project directory (the child's cwd). */
const ON_ENABLE_MARKER = 'on-enable.ran';
/** The `os dev` supervisor's staleness line, as `dev.ts` prints it. */
const STALE_LINE = 'dist/objectstack.json is OLDER than your sources — this boot serves the STALE build.';

type Copy = 'ART' | 'SRC';
const copyOf = (copy: Copy) => ({
  formOpen: copy === 'SRC',
  label: `Leads ${copy}`,
  maxLength: copy === 'SRC' ? 202 : 201,
});

/** The fixture config module for one copy; `host` adds a plugin instance. */
function configSource(copy: Copy, host: boolean): string {
  const c = copyOf(copy);
  return `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineStack } from '@objectstack/spec';

export const onEnable = async (): Promise<void> => {
  writeFileSync(join(process.cwd(), '${ON_ENABLE_MARKER}'), 'ran');
};

export default defineStack({
  manifest: { id: 'com.example.hx', namespace: 'hx', version: '1.0.0', type: 'app', name: 'Hx' },
  objects: [{
    name: '${OBJECT}',
    label: 'Lead',
    pluralLabel: 'Leads',
    sharingModel: 'public_read_write',
    fields: {
      name: { type: 'text', label: 'Name', maxLength: ${c.maxLength} },
      score: { type: 'number', label: 'Score' },
    },
  }],
  views: [{
    list: {
      label: '${c.label}',
      type: 'grid',
      data: { provider: 'object', object: '${OBJECT}' },
      columns: [{ field: 'name' }, { field: 'score' }],
    },
    form: {
      type: 'simple',
      data: { provider: 'object', object: '${OBJECT}' },
      sections: [{ name: 'intake', label: 'Intake', columns: 1, fields: [{ field: 'name', required: true }] }],
      sharing: { enabled: ${c.formOpen}, allowAnonymous: true, publicLink: '/forms/${SLUG}' },
    },
  }],
  hooks: [{
    name: 'hx_lead_score',
    object: '${OBJECT}',
    events: ['beforeInsert'],
    handler: async (ctx: any) => { ctx.input.score = 42; },
  }],
${host ? "  plugins: [{ name: 'com.example.hx.host-marker', version: '1.0.0', init: async () => {} }],\n" : ''}} as any);
`;
}

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

interface Reading {
  output: string;
  formStatus: number;
  viewLabels?: string[];
  maxLength?: unknown;
  hookScore?: unknown;
  onEnableRan: boolean;
  error?: Error;
}

const groups: ChildProcess[] = [];
const dirs: string[] = [];
const readings: Record<string, Reading | { error: Error }> = {};

function boot(what: string, cwd: string, args: string[], env: Record<string, string | undefined>): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_LOG_LEVEL: 'warn',
        OS_DATABASE_URL: undefined,
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_MODE: undefined,
        OS_PORT: undefined,
        PORT: undefined,
        ...env,
        // Last, so no leg's `env` can put the child in development/test: the
        // shipped entry in production posture is the CONTROL legs' subject.
        NODE_ENV: undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    groups.push(child);
    let out = '';
    let settled = false;
    const settle = (verdict: Error | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (verdict instanceof Error) rejectBoot(verdict);
      else resolveBoot({ child, base: `http://localhost:${verdict}`, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (READY.test(out)) settle(readKernelAssignedPort(out, what));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
    );
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

/** One exchange, attributed to the child if the transport fails. ⛔ No assertion inside it. */
function http(live: Live, method: string, path: string, token = '', body?: unknown) {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'dev-host-config-artifact-source',
      what: `${method} ${path}`,
    },
    async () => {
      const r = await fetch(`${live.base}${path}`, {
        method,
        headers: {
          origin: live.base,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, body: parsed };
    },
  );
}

const listOf = (body: any): any[] => {
  const v = body?.data?.items ?? body?.items ?? body?.data ?? body;
  return Array.isArray(v) ? v : [];
};

/**
 * A fixture project: the ART copy compiled into `dist/objectstack.json`, then the
 * SRC copy written over the config with an mtime past the artifact's, as an
 * edit made after the last build. `host` decides the config's shape.
 */
function project(prefix: string, host: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'hx-fixture', private: true }), 'utf8');
  linkSpec(dir);
  const config = join(dir, 'objectstack.config.ts');
  writeFileSync(config, configSource('ART', host), 'utf8');
  const compiled = spawnSync(process.execPath, [CLI, 'compile', '--output', join(dir, 'dist', 'objectstack.json')], {
    cwd: dir,
    env: childEnv({ NO_COLOR: '1', NODE_ENV: undefined, OS_CLOUD_URL: 'off' }),
    encoding: 'utf8',
  });
  if (compiled.status !== 0) {
    throw new Error(`compile of the ART copy exited ${String(compiled.status)}\n${compiled.stdout}\n${compiled.stderr}`);
  }
  writeFileSync(config, configSource('SRC', host), 'utf8');
  const artifactAt = statSync(join(dir, 'dist', 'objectstack.json')).mtime;
  const later = new Date(artifactAt.getTime() + 60_000);
  utimesSync(config, later, later);
  return dir;
}

/** Boot, read every probe, stop. A failure is recorded against the leg, never thrown out of `beforeAll`. */
async function leg(
  name: string,
  cwd: string,
  args: string[],
  env: Record<string, string | undefined>,
  opts: { signIn: boolean },
): Promise<void> {
  rmSync(join(cwd, ON_ENABLE_MARKER), { force: true });
  let live: Live | undefined;
  try {
    live = await boot(name, cwd, args, env);
    const form = await http(live, 'GET', `/api/v1/forms/${SLUG}`);
    const reading: Reading = {
      output: live.output(),
      formStatus: form.status,
      onEnableRan: false,
    };
    if (opts.signIn) {
      const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
      const token = signIn.body?.token;
      if (signIn.status !== 200 || typeof token !== 'string') {
        throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
      }
      const views = await http(live, 'GET', '/api/v1/meta/view', token);
      reading.viewLabels = listOf(views.body)
        .map((v: any) => v?.list?.label ?? v?.label)
        .filter((l: unknown): l is string => typeof l === 'string' && l.startsWith('Leads '));
      const object = await http(live, 'GET', `/api/v1/meta/object/${OBJECT}`, token);
      const item = object.body?.data?.item ?? object.body?.item ?? object.body?.data ?? object.body;
      reading.maxLength = item?.fields?.name?.maxLength;
      const insert = await http(live, 'POST', `/api/v1/data/${OBJECT}`, token, { name: 'probe', score: 1 });
      const record = insert.body?.data ?? insert.body?.record ?? insert.body;
      reading.hookScore = insert.status === 200 || insert.status === 201
        ? record?.score
        : `insert answered ${insert.status}: ${JSON.stringify(insert.body)}`;
    }
    reading.onEnableRan = existsSync(join(cwd, ON_ENABLE_MARKER));
    readings[name] = reading;
  } catch (error) {
    readings[name] = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
  }
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  const hostDir = project('os-31761-host-', true);
  const plainDir = project('os-31761-plain-', false);
  // An artifact-only directory: the host project's compiled ART copy, no config.
  const artifactDir = mkdtempSync(join(tmpdir(), 'os-31761-artifact-'));
  dirs.push(artifactDir);
  mkdirSync(join(artifactDir, 'dist'), { recursive: true });
  copyFileSync(join(hostDir, 'dist', 'objectstack.json'), join(artifactDir, 'dist', 'objectstack.json'));
  linkSpec(artifactDir);

  const dev = (flags: string[], db: string) =>
    ['dev', ...flags, '--no-watch', '--no-restart', '-d', `file:${db}`, '-p', KERNEL_ASSIGNED_PORT];
  const start = ['start', '-p', KERNEL_ASSIGNED_PORT];
  const prod = (db: string) => ({ OS_AUTH_SECRET: E2E_AUTH_SECRET, OS_DATABASE_URL: `file:${db}`, OS_HOME: undefined });

  await leg('host --no-compile', hostDir, dev(['--no-compile'], 'nc.db'), {}, { signIn: true });
  await leg('control: non-host --no-compile', plainDir, dev(['--no-compile'], 'nc.db'), {}, { signIn: true });
  await leg('control: host os start', hostDir, start, prod('start.db'), { signIn: false });
  await leg('control: artifact-only os start', artifactDir, start, prod('start.db'), { signIn: false });
  // Last: it compiles the SRC copy into `dist/`, which the legs above read stale.
  await leg('host compile', hostDir, dev([], 'c.db'), {}, { signIn: true });
}, 5 * BOOT_TIMEOUT_MS + 120_000);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}, 60_000);

function recorded(name: string): Reading {
  const r = readings[name];
  if (!r) throw new Error(`leg '${name}' recorded nothing`);
  if ('error' in r && r.error) throw r.error;
  return r as Reading;
}

/** The ready banner's app row: `Artifact:` or `Config:`, as `resolveBannerConfigRow` chose. */
const bannerRow = (output: string) => {
  const ready = output.slice(output.search(/Server is ready/));
  return /^\s*Artifact:\s+dist\/objectstack\.json\s*$/m.test(ready)
    ? 'artifact'
    : /^\s*Config:\s+objectstack\.config\.ts\s*$/m.test(ready) ? 'config' : 'none';
};

describe('#31761 — `os dev --no-compile` on a HOST config serves the artifact, as its warning says', () => {
  it('prints the STALE warning, word for word', () => {
    expect(recorded('host --no-compile').output).toContain(STALE_LINE);
  });

  it('the public form door answers the artifact (form closed there), not the edited source', () => {
    expect(recorded('host --no-compile').formStatus).toBe(404);
  });

  it('/meta/view serves the artifact\'s list label', () => {
    expect(recorded('host --no-compile').viewLabels).toEqual([copyOf('ART').label]);
  });

  it('/meta/object serves the artifact\'s field', () => {
    expect(recorded('host --no-compile').maxLength).toBe(copyOf('ART').maxLength);
  });

  it('the ready banner names the artifact', () => {
    expect(bannerRow(recorded('host --no-compile').output)).toBe('artifact');
  });

  it('the module\'s onEnable still runs — grafted onto the artifact wrap, which carries none', () => {
    expect(recorded('host --no-compile').onEnableRan).toBe(true);
  });
});

describe('#31761 — `os dev` (compile at boot) on a HOST config serves the edited source', () => {
  it('no STALE warning: the boot compiled first', () => {
    expect(recorded('host compile').output).not.toContain(STALE_LINE);
  });

  it('forms, views and objects answer the SRC copy', () => {
    const r = recorded('host compile');
    expect(r.formStatus).toBe(200);
    expect(r.viewLabels).toEqual([copyOf('SRC').label]);
    expect(r.maxLength).toBe(copyOf('SRC').maxLength);
  });

  it('the hook the source declares fires on insert (behavioural parity with the module wrap)', () => {
    expect(recorded('host compile').hookScore).toBe(42);
  });

  it('onEnable runs', () => {
    expect(recorded('host compile').onEnableRan).toBe(true);
  });
});

describe('#31761 CONTROLS — boots without the dev artifact door are unchanged', () => {
  it('host config under `os start` (no dev door): the module is the only copy, so SRC, banner `Config:`', () => {
    const r = recorded('control: host os start');
    expect(r.formStatus).toBe(200);
    expect(bannerRow(r.output)).toBe('config');
    expect(r.onEnableRan).toBe(true);
  });

  it('non-host config under `os dev --no-compile`: the standalone stack serves the artifact', () => {
    const r = recorded('control: non-host --no-compile');
    expect(r.output).toContain(STALE_LINE);
    expect(r.formStatus).toBe(404);
    expect(r.viewLabels).toEqual([copyOf('ART').label]);
    expect(r.maxLength).toBe(copyOf('ART').maxLength);
    expect(bannerRow(r.output)).toBe('artifact');
  });

  it('artifact-only directory under `os start`: the artifact', () => {
    expect(recorded('control: artifact-only os start').formStatus).toBe(404);
  });
});
