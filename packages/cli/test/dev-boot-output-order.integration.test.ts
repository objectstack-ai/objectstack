// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22410 — the first screen of `os dev` prints in ONE fixed order, each block
 * whole: the `serve` child's ready banner (credentials and boot diagnostics
 * included), and only then the parent's MCP connect block.
 *
 * ## The defect, measured at the public door before the fix
 *
 * `os dev` is two processes writing one terminal. The parent prints the MCP
 * connect block (`🤖 MCP server — connect a coding agent:` and its Endpoint /
 * Skill / Connect / Disable rows) to its stdout when the child's
 * `objectstack:listening` IPC message arrives, and the child used to send that
 * message BEFORE it printed its ready banner to stderr. So both printed at
 * once: under a pty, on the tutorial project, the block's rows came out
 * interleaved line by line with the banner's — the `➜ API / Console / MCP`
 * rows, `Tenancy`, `Plugins: 41 loaded`, and on some boots the
 * `🔑 Dev admin: … / admin123` credential line, landing between `Connect` and
 * `Disable`. The PR that closes this card carries the measured before/after
 * tables.
 *
 * ## Why the order is now causal, and what this file pins
 *
 * `publishBoundPort` drives the banner BEFORE the IPC message. The banner is
 * written synchronously — a terminal is a synchronous stdio on POSIX, and
 * `keepStderrNonBlocking` deliberately leaves a TTY alone — so every banner
 * byte is in the terminal before `objectstack:listening` is even sent, and the
 * parent prints only on receipt. No timer orders anything.
 *
 * The SEQUENCE is pinned deterministically, in-process, by
 * `serve-bound-port-publish-order.test.ts`. This file pins what a person sees:
 * the real `os dev`, under a real pty (`script(1)` — the same tool
 * `login-json-ndjson.e2e.test.ts` drives a TTY with, and it fails rather than
 * skips without it), across several boots, because against the old order the
 * damage was a race that a single boot can miss. For every boot:
 *
 * - the block's five rows are contiguous — nothing printed between them;
 * - the `🔑 Dev admin` credential line is outside the block;
 * - the block starts after the banner's last row (`Press Ctrl+C to stop`), so
 *   no parent row sits inside the banner either.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset — the shipped entry, resolving commands
 * from `dist/` (`requireBuiltCli`). `--no-watch` keeps the watcher's own lines
 * out of the reading; each boot gets a fresh database file so the dev admin is
 * seeded, and its credential line printed, on every boot. A boot ends with a
 * real Ctrl+C typed into the pty. Every boot runs in `beforeAll` and every `it`
 * reads what it recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  randomPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** How many boots. Against the old order the damage was a race, so one boot proves little. */
const BOOTS = 5;
const BOOT_TIMEOUT_MS = 180_000;
/** After the banner, how long the parent's block may take to arrive. */
const BLOCK_GRACE_MS = 30_000;
/** After both have printed, how long to keep reading — late lines would land here. */
const LINGER_MS = 2_000;
const ALL_BOOTS_TIMEOUT_MS = BOOTS * (BOOT_TIMEOUT_MS + BLOCK_GRACE_MS + 30_000);

const SCAFFOLD = {
  manifest: { id: 'com.example.order', namespace: 'order', version: '1.0.0', type: 'app', name: 'order' },
  objects: [{ name: 'order_item', label: 'Item', fields: { title: { type: 'text', label: 'Title' } } }],
};

const ESC = String.fromCharCode(27);
/** SGR colour codes and other CSI sequences a terminal session carries. */
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');
/** The ETX byte a terminal sends for Ctrl+C. */
const CTRL_C = String.fromCharCode(3);

const BLOCK_HEADER = 'MCP server — connect a coding agent:';
/** The four rows under the header, in the order `printMcpConnectHint` prints them. */
const BLOCK_ROWS = [/^\s+Endpoint\s/, /^\s+Skill\s/, /^\s+Connect\s/, /^\s+Disable\s+OS_MCP_SERVER_ENABLED=false/];
const BANNER_TAIL = 'Press Ctrl+C to stop';
const CREDENTIAL = 'Dev admin:';

interface BootReading {
  boot: number;
  /** The pty transcript, CSI sequences removed, split on line ends. */
  lines: string[];
}

const readings: Array<BootReading | Error> = [];
const groups: ChildProcess[] = [];
let dir: string;

function screenLines(raw: string): string[] {
  return raw.replace(CSI, '').split(/\r?\n/).map((line) => line.replace(/\r/g, ''));
}

/** Boot `os dev` under a pty until the banner and the block have both printed, then Ctrl+C it. */
function bootUnderPty(boot: number): Promise<string> {
  const port = randomPort();
  const command = [
    `exec '${process.execPath}' '${CLI}' dev --no-watch`,
    `-d 'file:boot${boot}.db' -p ${port}`,
  ].join(' ');
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn('script', ['-qfec', command, '/dev/null'], {
      cwd: dir,
      // `childEnv`, never a bare `...process.env` — see its header. `NODE_ENV`
      // unset, so the built entry resolves its commands from `dist/`. Every
      // variable that moves the block's origin is unset, so the block prints.
      env: childEnv({
        OS_HOME: join(dir, 'home'),
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_DATABASE_URL: undefined,
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_MCP_SERVER_ENABLED: undefined,
        OS_AUTH_URL: undefined,
        BETTER_AUTH_URL: undefined,
        OS_BASE_URL: undefined,
        OS_MODE: undefined,
        NODE_ENV: undefined,
        NO_COLOR: undefined,
        FORCE_COLOR: undefined,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group: `script` owns the pty, whose session holds `dev` and its `serve` child.
      detached: true,
    });
    groups.push(child);
    let raw = '';
    let bannerSeen = false;
    let stopping = false;
    let failure: Error | null = null;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const stop = (err: Error | null) => {
      if (stopping) return;
      stopping = true;
      failure = err;
      // Keep reading for a moment: a line that would land late lands here.
      timers.push(setTimeout(() => { try { child.stdin?.write(CTRL_C); } catch { /* pty gone */ } }, LINGER_MS));
      timers.push(setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, LINGER_MS + 15_000));
    };
    timers.push(setTimeout(
      () => stop(new Error(`boot ${boot}: os dev never printed its banner\n--- output ---\n${raw.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    ));
    const onData = (d: Buffer) => {
      raw += d.toString('utf8');
      const text = raw.replace(CSI, '');
      if (!bannerSeen && text.includes(BANNER_TAIL)) {
        bannerSeen = true;
        timers.push(setTimeout(
          () => stop(new Error(`boot ${boot}: the MCP block never printed\n--- output ---\n${raw.slice(-4000)}`)),
          BLOCK_GRACE_MS,
        ));
      }
      if (bannerSeen && screenLines(raw).some((l) => BLOCK_ROWS[3].test(l))) stop(null);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', () => {
      for (const t of timers) clearTimeout(t);
      if (failure) rejectBoot(failure);
      else if (!stopping) rejectBoot(new Error(`boot ${boot}: os dev exited before its banner\n--- output ---\n${raw.slice(-4000)}`));
      else resolveBoot(raw);
    });
  });
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  try {
    execFileSync('script', ['--version'], { stdio: 'ignore', env: childEnv() });
  } catch {
    throw new Error('script(1) from util-linux is required to put `os dev` on a real terminal — this file fails instead of skipping without one.');
  }
  dir = mkdtempSync(join(tmpdir(), 'os-22410-dev-order-'));
  writeDefineStackConfig(dir, SCAFFOLD);
  // Sequential: each boot owns a port and a database, and two at once would race each other.
  for (let boot = 1; boot <= BOOTS; boot++) {
    try {
      readings.push({ boot, lines: screenLines(await bootUnderPty(boot)) });
    } catch (error) {
      readings.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
}, ALL_BOOTS_TIMEOUT_MS);

afterAll(() => {
  for (const child of groups) {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
    }
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function recorded(): BootReading[] {
  expect(readings, 'not every boot was run').toHaveLength(BOOTS);
  for (const r of readings) if (r instanceof Error) throw r;
  return readings as BootReading[];
}

/** Where the block's header is, and what printed in the four lines under it. */
function blockOf(r: BootReading): { header: number; under: string[] } {
  const header = r.lines.findIndex((l) => l.includes(BLOCK_HEADER));
  expect(header, `boot ${r.boot}: no MCP connect block on the screen`).toBeGreaterThan(-1);
  return { header, under: r.lines.slice(header + 1, header + 1 + BLOCK_ROWS.length) };
}

describe('#22410 — `os dev` prints the banner, then the MCP block, each block whole', () => {
  it('the MCP block\'s rows are contiguous on every boot', () => {
    for (const r of recorded()) {
      const { under } = blockOf(r);
      under.forEach((line, i) => {
        expect(line, `boot ${r.boot}: row ${i + 1} under the block header is not the block's own`).toMatch(BLOCK_ROWS[i]);
      });
    }
  });

  it('the dev admin credential line sits outside the block on every boot', () => {
    for (const r of recorded()) {
      const { header } = blockOf(r);
      const credential = r.lines.findIndex((l) => l.includes(CREDENTIAL));
      // Present, so "outside" is a reading and not an absence.
      expect(credential, `boot ${r.boot}: no credential line — the boot did not seed its dev admin`).toBeGreaterThan(-1);
      const inside = credential > header && credential <= header + BLOCK_ROWS.length;
      expect(inside, `boot ${r.boot}: the credential line printed inside the MCP block`).toBe(false);
    }
  });

  it('the block comes after the whole banner on every boot — one fixed order', () => {
    for (const r of recorded()) {
      const { header } = blockOf(r);
      const tail = r.lines.findIndex((l) => l.includes(BANNER_TAIL));
      expect(tail, `boot ${r.boot}: no banner tail`).toBeGreaterThan(-1);
      expect(header, `boot ${r.boot}: the MCP block started before the banner finished`).toBeGreaterThan(tail);
    }
  });
});
