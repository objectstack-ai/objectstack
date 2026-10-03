// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21501 — an explicitly named artifact is the stack that is SERVED, even from
 * a project directory: `--artifact` outranks `OS_ARTIFACT_URL`, which outranks
 * `OS_ARTIFACT_PATH`, which outranks `<cwd>/dist/objectstack.json`, which
 * outranks a cwd `objectstack.config.ts` (`utils/artifact-precedence.ts`).
 *
 * ## The defect, measured at the public door before the fix
 *
 * Two artifacts that differ in ONE served value — the label of object
 * `fx_widget` — read back through `GET /api/v1/meta/object/fx_widget`:
 *
 *   | boot                                                        | served       |
 *   |-------------------------------------------------------------|--------------|
 *   | `os dev -a ALPHA`, beside a config whose `dist/` holds BRAVO | Widget BRAVO |
 *   | `os start --artifact ALPHA`, same directory                 | Widget BRAVO |
 *   | `os start --artifact ALPHA`, beside a config with no `dist/` | Widget CONFIG |
 *   | `os start --artifact ALPHA`, NO config (the control)         | Widget ALPHA |
 *   | `os start --artifact ALPHA`, beside a HOST config            | Widget CONFIG |
 *   | `OS_ARTIFACT_URL=…BRAVO os dev -a ALPHA`                    | Widget BRAVO |
 *   | `OS_ARTIFACT_PATH=ALPHA os start --artifact ./dist/…` (BRAVO) | Widget ALPHA |
 *
 * Every one of them printed `Artifact: …ALPHA.json`. The `serve` child read the
 * supervisor's answer only when the cwd held no config, and `dev` had no
 * `OS_ARTIFACT_URL` rung, so the reference stayed in the child env and the
 * child read it first.
 *
 * ## What each case pins
 *
 * - leg 1 — `dev -a` beside a config: served == the named artifact.
 * - leg 2 — `start --artifact` beside a config (with and without a `dist/`),
 *   with its no-config control: all three serve the named artifact, so the
 *   config's presence changes nothing.
 * - a HOST config (its `plugins` hold an instance) composes its own app, so
 *   only the child declining to load the config at all serves the named
 *   artifact there — the case that holds `cwdConfigJoinsBoot` itself.
 * - flag over env — `dev -a` under an `OS_ARTIFACT_URL` naming the other one.
 * - the documented first-project path — `start --artifact
 *   ./dist/objectstack.json` beside its config — is the one boot a config
 *   still joins (that file is the config's OWN compiled output), and it serves
 *   that file even under an exported `OS_ARTIFACT_PATH` naming another: the
 *   config boot is handed the supervisor's answer instead of re-deriving it.
 *
 * Each case also checks the supervisor's `Artifact:` row named the file that
 * was served: the card's rule is never to print one artifact and serve another.
 *
 * ## Spawn shape
 *
 * The tsx source entry, one process group per boot (`dev` and `start` each
 * supervise a `serve` grandchild), the same harness the other boot-level files
 * here use. Every boot runs in `beforeAll` and every `it` only reads what it
 * recorded: clocked cases measure behaviour, never loading. A boot that fails
 * is recorded against its own case, so one bad leg cannot hide the others.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLI,
  childEnv,
  E2E_SECRET_KEY,
  portContentionError,
  portDriftError,
  probeThroughChild,
  randomPort,
  TSX,
} from './helpers/serve-process.js';
import { defineStackSourceFromLiteral, linkSpec, writeDefineStackConfig } from './helpers/define-stack-fixture.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
/** Seven boots, one after another, each well under its own budget when healthy. */
const ALL_BOOTS_TIMEOUT_MS = 7 * (BOOT_TIMEOUT_MS + 30_000);

/** The development dev-admin seed — the operator on every boot here. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';
const OBJECT = 'fx_widget';

/** One stack per tag; the tag is the ONE served value that differs. */
function stack(tag: string) {
  return {
    manifest: { id: 'com.example.fx', namespace: 'fx', version: '1.0.0', type: 'app', name: `Fx ${tag}` },
    objects: [{
      name: OBJECT,
      label: `Widget ${tag}`,
      pluralLabel: 'Widgets',
      sharingModel: 'public_read_write',
      fields: { title: { type: 'text', label: 'Title' } },
    }],
  };
}

const groups: ChildProcess[] = [];
const dirs: string[] = [];

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function boot(argv: string[], cwd: string, port: string, env: Record<string, string | undefined>): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, ...argv], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header. Neither
      // artifact variable leaks in from the runner: each case states its own.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_LOG_LEVEL: 'warn',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        ...env,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: the supervisor runs a `serve` grandchild.
      detached: true,
    });
    groups.push(child);
    let out = '';
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) rejectBoot(err);
      else resolveBoot({ child, base: `http://localhost:${port}`, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`${argv[0]} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (READY.test(out)) settle(portDriftError(out, `os ${argv[0]}`, port));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(portContentionError(out, `os ${argv[0]}`, port)
        ?? new Error(`os ${argv[0]} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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
function http(live: Live, method: string, path: string, token: string, body?: unknown) {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'artifact-flag-precedence',
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

/** The `Widget …` label anywhere in the object answer, whichever envelope it came in. */
function widgetLabel(body: unknown, depth = 0): string | undefined {
  if (!body || typeof body !== 'object' || depth > 6) return undefined;
  const label = (body as { label?: unknown }).label;
  if (typeof label === 'string' && label.startsWith('Widget ')) return label;
  for (const value of Object.values(body)) {
    const found = widgetLabel(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The supervisor's own `Artifact:` row (the parent prints it before it spawns). */
function artifactRow(output: string): string | undefined {
  return /^.*\bArtifact: [^\n]*$/m.exec(output)?.[0];
}

interface Reading {
  served?: string;
  status?: number;
  artifactRow?: string;
  error?: Error;
}

async function measure(argv: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<Reading> {
  const port = randomPort();
  let live: Live | undefined;
  try {
    live = await boot([...argv.slice(0, 1), '-p', port, ...argv.slice(1)], cwd, port, env);
    const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
    const token = signIn.body?.token;
    if (signIn.status !== 200 || typeof token !== 'string') {
      throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
    }
    const meta = await http(live, 'GET', `/api/v1/meta/object/${OBJECT}`, token);
    return { served: widgetLabel(meta.body), status: meta.status, artifactRow: artifactRow(live.output()) };
  } catch (err) {
    return { error: err as Error };
  } finally {
    if (live) await stopGroup(live.child);
  }
}

const readings: Record<string, Reading> = {};

/** A recorded boot failure is that case's failure, quoted in full. */
function reading(name: string): Reading {
  const r = readings[name];
  if (!r) throw new Error(`no reading recorded for ${name} — the beforeAll never reached it`);
  if (r.error) throw r.error;
  return r;
}

let alpha = '';

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-flag-precedence-'));
  dirs.push(root);

  const artifacts = join(root, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  alpha = join(artifacts, 'ALPHA.json');
  const bravo = join(artifacts, 'BRAVO.json');
  writeFileSync(alpha, JSON.stringify(stack('ALPHA'), null, 2), 'utf8');
  writeFileSync(bravo, JSON.stringify(stack('BRAVO'), null, 2), 'utf8');

  const project = (name: string, opts: { config: boolean | 'host'; dist: boolean }) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `fx-${name}`, private: true }), 'utf8');
    if (opts.config === 'host') {
      // A host config: a plugin INSTANCE in `plugins` (`isHostConfig`), so the
      // config boot composes this module's own app instead of a standalone
      // stack over `dist/` — no artifact path handed to it can reach it.
      const literal = JSON.stringify(stack('CONFIG'), null, 2).replace(/\n}$/, `,
  "plugins": [{ name: 'com.example.fx.host-marker', version: '1.0.0', init: async () => {}, start: async () => {} }]
}`);
      // The splice must have landed, or this fixture silently stops being a host.
      if (!literal.includes('host-marker')) throw new Error(`host-config fixture lost its plugin:\n${literal}`);
      writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSourceFromLiteral(literal));
      linkSpec(dir);
    } else if (opts.config) {
      writeDefineStackConfig(dir, stack('CONFIG'));
    }
    if (opts.dist) {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(stack('BRAVO'), null, 2), 'utf8');
    }
    return dir;
  };
  // A project whose config's compiled output holds a DIFFERENT stack (BRAVO)
  // from the one named on the command line (ALPHA) — the card's reproduction.
  const withConfig = project('with-config', { config: true, dist: true });
  const configOnly = project('config-only', { config: true, dist: false });
  const hostConfig = project('host-config', { config: 'host', dist: true });
  const noConfig = project('no-config', { config: false, dist: true });
  const bare = project('bare', { config: false, dist: false });

  const devArgs = ['dev', '--fresh', '--no-watch'];
  const startArgs = (home: string) => ['start', '--home', home, '--auth-secret', E2E_SECRET_KEY, '--no-ui'];

  readings.leg1 = await measure([...devArgs, '-a', alpha], withConfig);
  readings.leg2 = await measure([...startArgs(join(root, 'h-leg2')), '--artifact', alpha], withConfig);
  readings.leg2NoDist = await measure([...startArgs(join(root, 'h-leg2-nodist')), '--artifact', alpha], configOnly);
  readings.leg2Control = await measure([...startArgs(join(root, 'h-leg2-ctl')), '--artifact', alpha], noConfig);
  readings.hostConfig = await measure([...startArgs(join(root, 'h-host')), '--artifact', alpha], hostConfig);
  readings.flagOverEnv = await measure([...devArgs, '-a', alpha], bare, {
    OS_ARTIFACT_URL: pathToFileURL(bravo).href,
  });
  readings.ownDist = await measure(
    [...startArgs(join(root, 'h-own-dist')), '--artifact', './dist/objectstack.json'],
    withConfig,
    { OS_ARTIFACT_PATH: alpha },
  );
}, ALL_BOOTS_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}, 60_000);

describe('#21501 — the named artifact is the served stack, beside a config or not', () => {
  it('leg 1: `os dev -a ALPHA` beside a config whose dist/ holds BRAVO serves ALPHA', () => {
    const r = reading('leg1');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget ALPHA');
    expect(r.artifactRow).toContain('ALPHA.json');
  });

  it('leg 2: `os start --artifact ALPHA` beside a config whose dist/ holds BRAVO serves ALPHA', () => {
    const r = reading('leg2');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget ALPHA');
    expect(r.artifactRow).toContain('ALPHA.json');
  });

  it('leg 2: `os start --artifact ALPHA` beside a config with no dist/ serves ALPHA, not the config', () => {
    const r = reading('leg2NoDist');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget ALPHA');
    expect(r.artifactRow).toContain('ALPHA.json');
  });

  it('leg 2 control: the same command with NO config serves ALPHA — the config changes nothing', () => {
    const r = reading('leg2Control');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget ALPHA');
    expect(r.served).toBe(reading('leg2').served);
    expect(r.served).toBe(reading('leg2NoDist').served);
  });

  it('a HOST config: `os start --artifact ALPHA` beside one serves ALPHA, not the config\'s own app', () => {
    const r = reading('hostConfig');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget ALPHA');
    expect(r.artifactRow).toContain('ALPHA.json');
  });

  it('flag over env: `os dev -a ALPHA` under OS_ARTIFACT_URL naming BRAVO serves ALPHA', () => {
    const r = reading('flagOverEnv');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget ALPHA');
    expect(r.artifactRow).toContain('ALPHA.json');
  });

  it('the documented path: `os start --artifact ./dist/objectstack.json` beside its config serves that dist/, even under OS_ARTIFACT_PATH naming ALPHA', () => {
    const r = reading('ownDist');
    expect(r.status).toBe(200);
    expect(r.served).toBe('Widget BRAVO');
    expect(r.artifactRow).toContain('dist/objectstack.json');
  });
});
