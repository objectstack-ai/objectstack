// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runner's project lifecycle, as a user meets it: scaffold a project with
 * `create-objectstack` (`npm create objectstack`; under `--packages workspace`
 * the workspace's packed one, `packages.ts`), run the project's own
 * `objectstack` CLI (`validate`, `build`, `verify`), boot it with
 * `objectstack dev --fresh`, read `dist/objectstack.json`.
 *
 * Every child is spawned without the API-billing variables
 * ({@link subscriptionOnlyEnv}); nothing here talks to a model.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { namespaceOfConfig } from './namespace.js';

import { subscriptionOnlyEnv } from './driver.js';

export interface CommandResult {
  command: string;
  exit: number | null;
  /** The output's last lines — enough to read a refusal, never the whole log. */
  tail: string;
  ms: number;
}

/** Run a command to completion; output is kept as a bounded tail. `env` adds to the child's environment. */
export function runCommand(cmd: string, args: readonly string[], cwd: string, timeoutMs = 10 * 60_000, env: Readonly<Record<string, string>> = {}): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...subscriptionOnlyEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (d: Buffer) => {
      out = (out + d.toString()).slice(-16_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (exit) => {
      clearTimeout(timer);
      resolve({ command: [cmd, ...args].join(' '), exit, tail: out.split('\n').slice(-40).join('\n'), ms: Date.now() - started });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ command: [cmd, ...args].join(' '), exit: null, tail: String(e), ms: Date.now() - started });
    });
  });
}

export interface ProjectOptions {
  /** The scaffolder: `npx -y create-objectstack@<version>` unless overridden. */
  createCommand?: readonly string[];
  /** The `create-objectstack` version; default `latest`. */
  version?: string;
  /** Added to the scaffolder's environment (`--packages workspace` points its install at the packed workspace). */
  env?: Readonly<Record<string, string>>;
}

/** `npm create objectstack <name>` in `parent`; answers the project directory. */
export async function scaffold(parent: string, name: string, opts: ProjectOptions = {}): Promise<{ dir: string; result: CommandResult }> {
  const cmd = opts.createCommand ?? ['npx', '-y', `create-objectstack@${opts.version ?? 'latest'}`];
  const result = await runCommand(cmd[0]!, [...cmd.slice(1), name], parent, undefined, opts.env);
  return { dir: join(parent, name), result };
}

/** The project's own CLI: `npx objectstack <args>`. */
export function os(dir: string, args: readonly string[], timeoutMs?: number): Promise<CommandResult> {
  return runCommand('npx', ['objectstack', ...args], dir, timeoutMs);
}

/** The `namespace` the project's `objectstack.config.ts` declares. */
export function readNamespace(dir: string): string | undefined {
  const p = join(dir, 'objectstack.config.ts');
  return existsSync(p) ? namespaceOfConfig(readFileSync(p, 'utf8')) : undefined;
}

export function readArtifact(dir: string): unknown | undefined {
  const p = join(dir, 'dist', 'objectstack.json');
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

/** A free TCP port on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

export interface DevServer {
  url: string;
  port: number;
  pid: number | undefined;
  /** The server's last log lines (boot refusals land here). */
  log(): string;
  stop(): Promise<void>;
}

/**
 * Boot `objectstack dev --fresh --no-watch -p <port>` and wait for
 * `/api/v1/health`. `--fresh` gives an ephemeral home and seeds the dev admin
 * (`admin@objectos.ai` / `admin123`), which the runner signs in as.
 */
export async function bootDev(dir: string, timeoutMs = 180_000): Promise<DevServer> {
  const port = await freePort();
  const child: ChildProcess = spawn('npx', ['objectstack', 'dev', '--fresh', '--no-watch', '-p', String(port)], {
    cwd: dir,
    env: subscriptionOnlyEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  const keep = (d: Buffer) => {
    log = (log + d.toString()).slice(-20_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited = false;
  child.on('close', () => (exited = true));

  const url = `http://localhost:${port}`;
  const stop = async () => {
    if (exited || child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGTERM'); // the whole group: npx → node → server
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 50 && !exited; i++) await new Promise((r) => setTimeout(r, 100));
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`objectstack dev exited before it was ready:\n${log.split('\n').slice(-30).join('\n')}`);
    try {
      const r = await fetch(`${url}/api/v1/health`);
      if (r.ok) return { url, port, pid: child.pid, log: () => log, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stop();
  throw new Error(`objectstack dev was not ready within ${timeoutMs} ms:\n${log.split('\n').slice(-30).join('\n')}`);
}
