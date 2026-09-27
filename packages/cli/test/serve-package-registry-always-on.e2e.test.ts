// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19387 — the always-on `package-registry` capability must MOUNT something.
 *
 * `package-registry` is on the spec's always-on slate (#17676 ruling A' item
 * 1), so `serve` force-appends it to every app's `requires`. Until this card
 * `Serve.CAPABILITY_PROVIDERS` did not key it, the resolver's no-provider
 * branch stayed silent for a force-appended vocabulary token, and a stock app
 * got no `package` service: `POST /api/v1/packages` answered `201`, logged
 * `no 'package' service — … registered in-memory only`, and the package was
 * gone after a restart (`GET /api/v1/packages/:id` → `404`). Measured on
 * `origin/main` 2c1011b0 with this file's own fixture before the fix.
 *
 * WHAT THIS FILE ASSERTS, and why it spawns the real command. The mount table
 * entry is pinned in-process by `serve-capability-vocabulary.test.ts`; that
 * pin stays green on a build where the provider fails to start, or where the
 * service it registers is never reached by the install primitive. So the
 * first block boots `os serve` twice on ONE database file and asks the
 * question the card asks — does an API-created package survive a restart?
 *
 * The second block is the declarer direction. `marketplace` and
 * `package-registry` resolve to the SAME provider (the spec's provider map
 * says so today), and the resolver's app-supplied check reads only the app's
 * own `plugins[]`. Keying the new token alone therefore made an app that
 * declares `marketplace` mount PackageServicePlugin twice — `kernel.use`
 * answered with `Plugin superseded: 'package-service'` — which is measured, not
 * inferred: that was the boot log with the table entry and without the
 * resolver's `resolverMounted` list. The second block pins that the declarer
 * boots exactly as it did before this card: one PackageServicePlugin.
 *
 * ⚠️ What this does NOT prove: #17676 ruling A' item 5 — three probes (Studio's
 * writable list, a data read, a published-object read) agreeing across a
 * restart. That is #17676's acceptance and stays there; this file reads the
 * package door alone.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI,
  E2E_SECRET_KEY,
  TSX,
  childEnv,
  portContentionError,
  portDriftError,
  probeThroughChild,
  randomPort,
  runServe,
} from './helpers/serve-process.js';

/** The banner's tail — every row above it, the plugin list included, has printed. */
const READY = /Press Ctrl\+C to stop/;

/** The id the install probe creates and the restart probe reads back. */
const SURVIVOR_ID = 'com.example.survivor';

/** The in-memory-only warning `protocol.installPackage` prints when it finds no `package` service. */
const IN_MEMORY_ONLY = /no 'package' service/;

/**
 * A fixture app shaped like `examples/app-crm` in the one way that matters: it
 * declares neither `marketplace` nor `package-registry`.
 */
function appConfig(id: string, requires: readonly string[] | undefined): string {
  return `
export default {
  manifest: {
    id: 'com.example.${id}',
    namespace: '${id}',
    version: '1.0.0',
    type: 'app',
    name: '${id} probe',
  },
${requires ? `  requires: ${JSON.stringify(requires)},\n` : ''}  objects: [{
    name: '${id}_task',
    label: 'Task',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;
}

function fixture(prefix: string, config: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `${prefix}fixture`, private: true, type: 'module' }, null, 2),
    'utf8',
  );
  return dir;
}

/**
 * How many times the ready banner's plugin row names `plugin`. The row is the
 * line after `Plugins: N loaded` (`printServerReady` in `src/utils/format.ts`);
 * `-1` when the banner has no such row, so a missing banner can never read as
 * "listed zero times".
 */
function bannerMentions(output: string, plugin: string): number {
  const lines = output.split('\n');
  const at = lines.findIndex((line) => /Plugins: \d+ loaded/.test(line));
  if (at === -1 || at + 1 >= lines.length) return -1;
  return lines[at + 1]!.split(',').filter((name) => name.trim() === plugin).length;
}

interface LiveServe {
  child: ChildProcessWithoutNullStreams;
  /** Everything the child has printed so far, both streams. */
  output: () => string;
}

const children: ChildProcessWithoutNullStreams[] = [];
const dirs: string[] = [];

/**
 * Boot `os serve --dev` on `db` and keep it running. `--dev` seeds the admin
 * the install probe signs in as; on the second boot the admin already exists
 * in the database and the seed leaves it alone.
 */
function bootServe(dir: string, port: string, db: string): Promise<LiveServe> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '-p', port, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `childEnv`, never a bare `...process.env` — see its header (#11267).
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: db,
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    }) as ChildProcessWithoutNullStreams;
    children.push(child);

    const what = `os serve --dev on ${db}`;
    let out = '';
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) rejectBoot(err);
      else resolveBoot({ child, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      150_000,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound (#12525).
      if (READY.test(out)) settle(portDriftError(out, what, port));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) =>
      settle(
        portContentionError(out, what, port)
          ?? new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`),
      ),
    );
  });
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(give);
      done();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

/**
 * One HTTP exchange against `serve`, attributed to the child if the transport
 * fails (#15653). ⛔ No assertion goes inside `request`.
 */
function probe<T>(serve: LiveServe, what: string, request: () => Promise<T>): Promise<T> {
  return probeThroughChild(
    {
      child: serve.child,
      transcript: () => `\n--- child output ---\n${serve.output().slice(-4000)}`,
      label: 'serve-package-registry-always-on',
      what,
    },
    request,
  );
}

async function signIn(serve: LiveServe, base: string): Promise<string> {
  const res = await probe(serve, 'the sign-in probe', async () => {
    const r = await fetch(`${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* non-JSON error body */ }
    return { status: r.status, body };
  });
  expect(res.status, 'the --dev admin must be able to sign in').toBe(200);
  const token = (res.body as { token?: string } | null)?.token;
  expect(token, 'sign-in answered 200 without a bearer token').toBeTruthy();
  return String(token);
}

afterAll(async () => {
  for (const child of children) await stop(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#19387: a stock app gets the package service — an API-created package survives a restart', () => {
  let firstBoot = '';
  let installStatus = 0;
  let restartRead: { status: number; body: string } = { status: 0, body: '' };

  beforeAll(async () => {
    const dir = fixture('pkg-registry-stock-', appConfig('stockboot', undefined));
    dirs.push(dir);
    const db = join(dir, 'probe.db');
    const port = randomPort();
    const base = `http://localhost:${port}/api/v1`;

    const first = await bootServe(dir, port, db);
    const token = await signIn(first, base);
    installStatus = await probe(first, 'the install probe', async () => {
      const r = await fetch(`${base}/packages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          manifest: { id: SURVIVOR_ID, name: 'Survivor', version: '1.0.0', type: 'app' },
        }),
      });
      await r.text();
      return r.status;
    });
    // The install's persistence warning (or its absence) lands on the child's
    // stderr during the request, so the transcript is read after it returns.
    firstBoot = first.output();
    await stop(first.child);

    const second = await bootServe(dir, port, db);
    const token2 = await signIn(second, base);
    restartRead = await probe(second, 'the post-restart read probe', async () => {
      const r = await fetch(`${base}/packages/${SURVIVOR_ID}`, {
        headers: { authorization: `Bearer ${token2}` },
      });
      return { status: r.status, body: await r.text() };
    });
    await stop(second.child);
  }, 420_000);

  it('the boot mounted PackageServicePlugin although the app declares neither token', () => {
    expect(
      bannerMentions(firstBoot, 'PackageServicePlugin'),
      `the ready banner's plugin row must list PackageServicePlugin once:\n${firstBoot.slice(-3000)}`,
    ).toBe(1);
  });

  it('the install found the package service — no in-memory-only fallback', () => {
    expect(installStatus, 'POST /api/v1/packages').toBe(201);
    expect(
      firstBoot,
      'protocol.installPackage fell back to its in-memory-only branch: the stock boot composed no `package` service',
    ).not.toMatch(IN_MEMORY_ONLY);
  });

  it('the package is still there after a restart on the same database', () => {
    expect(
      restartRead.status,
      `GET /api/v1/packages/${SURVIVOR_ID} after a restart — 404 means the install lived in memory only`,
    ).toBe(200);
    expect(restartRead.body).toContain(SURVIVOR_ID);
  });
});

describe('#19387: an app that declares `marketplace` still mounts exactly one PackageServicePlugin', () => {
  let output = '';

  beforeAll(async () => {
    const dir = fixture('pkg-registry-declarer-', appConfig('declarer', ['marketplace']));
    dirs.push(dir);
    const run = await runServe(dir, ['-p', randomPort()], {
      waitFor: READY,
      env: { OS_DATABASE_URL: join(dir, 'probe.db') },
    });
    output = run.stdout + run.stderr;
  }, 240_000);

  it('the boot reached its ready banner', () => {
    expect(output).toMatch(READY);
  });

  it('`marketplace` and the always-on `package-registry` share one provider instance', () => {
    expect(
      output,
      'the always-on token mounted a SECOND PackageServicePlugin over the declared one — the resolver did not ' +
        'recognise the provider it had itself just mounted',
    ).not.toMatch(/Plugin superseded: 'package-service'/);
    expect(bannerMentions(output, 'PackageServicePlugin')).toBe(1);
  });
});
