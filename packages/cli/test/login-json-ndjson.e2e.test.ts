// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os login --json` is NDJSON — every line parses, and the URL comes FIRST
 * (#6531).
 *
 * ## The defect this pins shut
 *
 * The device-flow path wrote its RFC 8628 device-authorization payload compact
 * and, after the token poll resolved, the result payload 2-space indented.
 * Measured against a live device endpoint on `origin/main`, stdout was:
 *
 * ```
 * {"device_code":"DEV-CODE-6531","user_code":"WXYZ-6531",…,"expires_in":600}
 * {
 *   "success": true,
 *   "email": "device@example.com",
 *   "userId": "usr_6531"
 * }
 * ```
 *
 * `JSON.parse(stdout)` → `Unexpected non-whitespace character after JSON at
 * position 200`; read as NDJSON, 5 of the 6 lines fail their own parse. There
 * was no shape in which a consumer could read it. The maintainer ruled
 * (2026-08-08) that this command is a **stream**, so what has to hold is:
 * every line parses on its own, and the records arrive in the right order.
 *
 * ## Why the ordering assertion is TEMPORAL, not an array index
 *
 * The ruling picked NDJSON over "buffer both halves and emit one document at
 * the end" for exactly one reason: an automation consumer needs the
 * verification URL *while it can still act on it* — before the user authorizes.
 * Asserting `records[0]` is the device record would not catch a regression to
 * the buffered shape at all, because a trailing merged emit also puts the URL
 * fields first.
 *
 * So the fake endpoint here withholds the token until THIS TEST has seen the
 * device record land on the child's stdout. The release is driven by the
 * observation, which makes "URL before authorization" a fact about the run
 * rather than a property of the array afterwards. A buffered implementation
 * never gets released by the watcher, falls through to the escape-hatch timer
 * ({@link RELEASE_DEADLINE_MS}, so the suite fails instead of hanging), and
 * lands with `urlSeenAt === null` — red, naming the actual cause.
 *
 * ## Why a PTY, and why not a silent skip
 *
 * `login.ts` takes the device flow only when `process.stdin.isTTY` — a child
 * with a piped stdin falls through to the email/password prompt and never
 * reaches either emission point. A plain `execFile` therefore cannot reach the
 * defect. `script(1)` allocates the pty; the command it runs redirects stdout
 * and stderr to files, so fd 0 is a TTY while fd 1 and fd 2 stay separate,
 * capturable, and non-TTY — which is also the shape a real user gets when they
 * pipe an interactive `os login --json` into a consumer.
 *
 * If `script(1)` is missing this file FAILS rather than skips. A contract test
 * that quietly opts out on the machine that runs it is the same green-for-the-
 * wrong-reason hazard the fixtures in #5046 were replaced for; every CI runner
 * in this repo is `ubuntu-latest`, where `script(1)` is part of the base image.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const LOGIN_SRC = resolve(HERE, '../src/commands/login.ts');
const REPO_ROOT = resolve(HERE, '../../..');
const CLI_DOCS = resolve(REPO_ROOT, 'content/docs/deployment/cli.mdx');
const AUTH_DOCS = resolve(REPO_ROOT, 'content/docs/permissions/authentication.mdx');

/**
 * How long the endpoint waits for the device record to appear before releasing
 * anyway. Only reached when the record never arrives early — i.e. when the
 * contract is broken — and exists so that failure is an assertion rather than a
 * suite that hangs until the runner kills it.
 *
 * ## The clock starts at device-code issuance, not at spawn (#6872, shape from #6855)
 *
 * This budget is armed when the endpoint hands the CLI its device code, because
 * that is the first instant at which the contract is even measurable: from
 * there the CLI holds the verification URL and owes it to stdout. Everything
 * before it — `script(1)`, the `tsx` transform of the whole oclif command tree,
 * module loading — is process startup, about which #6531 says nothing.
 *
 * Armed at spawn instead, this budget policed startup rather than the contract.
 * Measured on this file (5 runs, probe replicating {@link runDeviceLogin}), of
 * the latency from spawn to the record being readable:
 *
 * | segment                                               | measured     |
 * |-------------------------------------------------------|--------------|
 * | spawn → device-code request (startup)                 | 6844–8841 ms |
 * | device-code response → record readable (the contract) | 13–39 ms     |
 *
 * So ~99.7% of the old budget was spent on work the contract does not govern,
 * leaving startup needing only a ~2.3x slowdown to exhaust 20 s — ordinary on a
 * box running four concurrent worktree builds, or on a merge-queue runner. Its
 * cloud sibling, on the identical harness, duly ejected two unrelated PRs
 * (#6847 spec-only, #6835 docs-only) before #6855 re-anchored it. Anchored
 * here, the budget covers a ~20 ms window with ~500x headroom, and the number
 * itself is unchanged: this is a re-anchoring, NOT a widened timeout.
 */
const RELEASE_DEADLINE_MS = 20_000;

/** Poll interval for watching the child's stdout file. */
const WATCH_MS = 25;

interface DeviceRun {
  code: number;
  stdout: string;
  stderr: string;
  /** When the device-authorization record was first readable on stdout. */
  urlSeenAt: number | null;
  /** When the endpoint first answered the poll with something other than pending. */
  authorizedAt: number | null;
  /** Whether the endpoint had to fall back to the deadline instead of the watcher. */
  releasedByDeadline: boolean;
}

/**
 * A minimal RFC 8628 endpoint whose token poll stays `authorization_pending`
 * until {@link release} is called — see the header for why the test, not the
 * clock, decides when authorization happens.
 */
function startDeviceEndpoint(outcome: 'token' | 'access_denied') {
  let released = false;
  let authorizedAt: number | null = null;

  // Resolved the moment the CLI has been handed its device code — the instant
  // the emission contract starts running, and so the anchor for the release
  // deadline. Definite-assignment: the Promise executor runs synchronously.
  let markDeviceCodeIssued!: () => void;
  const deviceCodeIssued = new Promise<void>((res) => {
    markDeviceCodeIssued = res;
  });

  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const { pathname } = new URL(req.url ?? '/', 'http://placeholder');

      if (pathname === '/api/v1/auth/device/code') {
        markDeviceCodeIssued();
        return send(200, {
          device_code: 'DEV-CODE-6531',
          user_code: 'WXYZ-6531',
          verification_uri: 'http://127.0.0.1:9/activate',
          verification_uri_complete: 'http://127.0.0.1:9/activate?user_code=WXYZ-6531',
          expires_in: 600,
          // 1s: the CLI floors anything falsy back to 5s (`interval || 5`).
          interval: 1,
        });
      }

      if (pathname === '/api/v1/auth/device/token') {
        if (!released) return send(400, { error: 'authorization_pending' });
        authorizedAt ??= Date.now();
        return outcome === 'token'
          ? send(200, { access_token: 'ACCESS-TOKEN-6531', token_type: 'Bearer' })
          : send(400, { error: 'access_denied' });
      }

      if (pathname === '/api/v1/auth/get-session') {
        return send(200, { user: { id: 'usr_6531', email: 'device@example.com' } });
      }

      return send(404, { error: 'not_found' });
    });
  });

  return {
    server,
    release: () => { released = true; },
    deviceCodeIssued,
    authorizedAt: () => authorizedAt,
    listen: () =>
      new Promise<number>((res) => {
        server.listen(0, '127.0.0.1', () => res((server.address() as AddressInfo).port));
      }),
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

/** Every non-empty line of a captured stdout. */
function lines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => l.length > 0);
}

/** The device-authorization record, if one is already readable on stdout. */
function findDeviceRecord(text: string): Record<string, unknown> | null {
  for (const line of lines(text)) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec && typeof rec === 'object' && 'verification_uri' in rec) return rec;
    } catch {
      // A partially-flushed line is not a failure here — the contract
      // assertions below judge the finished stream.
    }
  }
  return null;
}

/**
 * Drive one full device-flow login through a real child process on a PTY.
 */
async function runDeviceLogin(outcome: 'token' | 'access_denied'): Promise<DeviceRun> {
  const dir = mkdtempSync(join(tmpdir(), 'os-login-ndjson-'));
  const outFile = join(dir, 'stdout.txt');
  const errFile = join(dir, 'stderr.txt');
  // HOME is the credentials root (`auth-config.ts` builds every path from
  // `os.homedir()`), so pointing it at the temp dir keeps the run from reading
  // — or overwriting — the developer's real ~/.objectstack/credentials.json.
  const home = join(dir, 'home');

  const endpoint = startDeviceEndpoint(outcome);
  const port = await endpoint.listen();

  let urlSeenAt: number | null = null;
  let releasedByDeadline = false;

  const watcher = setInterval(() => {
    if (urlSeenAt !== null) return;
    if (!existsSync(outFile)) return;
    if (findDeviceRecord(readFileSync(outFile, 'utf-8'))) {
      urlSeenAt = Date.now();
      endpoint.release();
    }
  }, WATCH_MS);

  // Armed on device-code issuance rather than here, so the budget covers the
  // window the contract governs and not the child's startup — see
  // {@link RELEASE_DEADLINE_MS} for the measurements behind that (#6872).
  // Stays unarmed if the CLI never reaches the device flow at all; that run
  // ends when the child exits, and the assertions below name the absence.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  void endpoint.deviceCodeIssued.then(() => {
    deadline = setTimeout(() => {
      if (urlSeenAt === null) {
        releasedByDeadline = true;
        endpoint.release();
      }
    }, RELEASE_DEADLINE_MS);
  });

  const shell = [
    `'${TSX}' '${CLI}' login --json --no-browser`,
    `--url 'http://127.0.0.1:${port}'`,
    `> '${outFile}' 2> '${errFile}'`,
  ].join(' ');

  const code = await new Promise<number>((res) => {
    execFile(
      'script',
      // -q quiet, -e propagate the child's exit status, -c the command.
      ['-qec', shell, '/dev/null'],
      { env: { ...process.env, HOME: home, NO_COLOR: '1' }, maxBuffer: 32 * 1024 * 1024 },
      (err) => res(err ? Number((err as { code?: unknown }).code ?? 1) : 0),
    );
  });

  clearInterval(watcher);
  clearTimeout(deadline);
  await endpoint.close();

  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf-8') : '');
  const run: DeviceRun = {
    code,
    stdout: read(outFile),
    stderr: read(errFile),
    urlSeenAt,
    authorizedAt: endpoint.authorizedAt(),
    releasedByDeadline,
  };
  rmSync(dir, { recursive: true, force: true });
  return run;
}

describe('os login --json — the declared NDJSON stream (#6531)', () => {
  let ok: DeviceRun;
  let denied: DeviceRun;

  beforeAll(async () => {
    try {
      execFileSync('script', ['--version'], { stdio: 'ignore' });
    } catch {
      throw new Error(
        'script(1) is required to drive the TTY-gated device flow — see this file’s header for why this fails instead of skipping.',
      );
    }
    // Sequential: each run owns a port, a HOME and a poll clock, and running
    // them together would interleave two children's timing for no benefit.
    ok = await runDeviceLogin('token');
    denied = await runDeviceLogin('access_denied');
  }, 180_000);

  describe('the successful flow', () => {
    it('emits stdout every line of which parses on its own — the NDJSON contract', () => {
      const all = lines(ok.stdout);
      expect(all.length).toBeGreaterThan(0);
      for (const [i, line] of all.entries()) {
        // Named per line so a regression says WHICH record broke, rather than
        // only that some parse failed. Under the defect, lines 2-6 were the
        // fragments of one pretty-printed document.
        expect(() => JSON.parse(line), `stdout line ${i + 1}: ${JSON.stringify(line)}`).not.toThrow();
      }
    });

    it('is exactly two records — device authorization, then the result', () => {
      const records = lines(ok.stdout).map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        device_code: 'DEV-CODE-6531',
        user_code: 'WXYZ-6531',
        verification_uri: 'http://127.0.0.1:9/activate',
        verification_uri_complete: 'http://127.0.0.1:9/activate?user_code=WXYZ-6531',
        expires_in: 600,
      });
      expect(records[1]).toEqual({ success: true, email: 'device@example.com', userId: 'usr_6531' });
      expect(ok.code).toBe(0);
    });

    it('hands over the verification URL BEFORE authorization — the reason this route was chosen', () => {
      // The endpoint only authorized because the watcher had already read the
      // record off stdout, so these two facts are the run's own history.
      expect(
        ok.releasedByDeadline,
        `the device record did not reach stdout within ${RELEASE_DEADLINE_MS}ms of the CLI ` +
          'receiving its device code — the buffered-emit regression this route was chosen to ' +
          'prevent. This window excludes process startup (#6872), so a slow runner is not a ' +
          'cause: at the moment it opens the CLI already holds the verification URL.',
      ).toBe(false);
      expect(ok.urlSeenAt).not.toBeNull();
      expect(ok.authorizedAt).not.toBeNull();
      expect(ok.urlSeenAt!).toBeLessThanOrEqual(ok.authorizedAt!);
    });

    it('lets nothing but the payload onto stdout — no banner, no spinner, no prompt', () => {
      // Two records, two lines: any human-mode output would raise the count,
      // so this subsumes "nothing else was written" rather than listing
      // banners that a future edit could add to.
      expect(lines(ok.stdout)).toHaveLength(2);
      expect(ok.stdout).not.toContain('To authorize this CLI');
      expect(ok.stdout).not.toContain('Waiting for browser approval');
      expect(ok.stdout).not.toContain('ObjectStack Login');
      // The spinner's carriage returns and the `\x1b[K` erase would corrupt a
      // line-oriented reader even though they carry no visible text.
      expect(ok.stdout).not.toMatch(/[\r\u001b]/);
    });
  });

  describe('the failure that arrives AFTER the first record', () => {
    it('keeps every line parseable when the poll is denied', () => {
      // The path the issue never named: device record already written, then an
      // indented error payload — the same unreadable two-document stream, on
      // the run a consumer can least afford to misread.
      const all = lines(denied.stdout);
      for (const [i, line] of all.entries()) {
        expect(() => JSON.parse(line), `stdout line ${i + 1}: ${JSON.stringify(line)}`).not.toThrow();
      }
      const records = all.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ user_code: 'WXYZ-6531' });
      expect(records[1]).toEqual({ success: false, error: 'Login denied by user.' });
    });

    it('reports the refusal through the exit code as well as the record', () => {
      expect(denied.code).toBe(1);
    });
  });
});

describe('the exception stays declared, not just implemented (#6531 ruling)', () => {
  const loginSrc = () => readFileSync(LOGIN_SRC, 'utf-8');

  it('routes every --json write through the single compact emitter', () => {
    // The contract is "one document per line" for the WHOLE command, so a new
    // write that called `emitJson` directly could reintroduce a multi-line
    // record on a path the e2e above does not drive. One emitter is what makes
    // that structurally impossible; this is the guard on the emitter.
    const src = loginSrc();
    const direct = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\bemitJson\s*\(/.test(line))
      .filter(({ line }) => !/^\s*await emitJson\(payload, exitCode, \{ compact: true \}\);$/.test(line));
    expect(
      direct.map(({ n, line }) => `${n}: ${line.trim()}`),
      'every --json write in login.ts must go through emitRecord()',
    ).toEqual([]);
    expect(/async function emitRecord\(/.test(src)).toBe(true);
  });

  it('declares NDJSON in the --json flag help text', () => {
    // `--help` is where a consumer looks first, and the ruling made the
    // declaration a condition of the fix: an undocumented exception harms the
    // same audience as the bug.
    const src = loginSrc();
    const flag = /json:\s*Flags\.boolean\(\{[\s\S]*?\}\)/.exec(src)?.[0] ?? '';
    expect(flag).toMatch(/NDJSON/);
    expect(flag).toMatch(/per line/i);
  });

  // Prose in .mdx is hard-wrapped, so these patterns treat any run of
  // whitespace as a word gap. A pin that broke when a sentence rewrapped would
  // train the next editor to delete it rather than to keep the declaration.
  it('documents the exception on the CLI reference page', () => {
    const doc = readFileSync(CLI_DOCS, 'utf-8');
    expect(doc).toMatch(/`os\s+login\s+--json`\s+is\s+NDJSON/);
    expect(doc).toMatch(/one\s+compact\s+JSON\s+document\s+per\s+line/i);
    expect(doc).toMatch(/parse\s+it\s+line\s+by\s+line/i);
  });

  it('documents the exception where the device flow itself is described', () => {
    const doc = readFileSync(AUTH_DOCS, 'utf-8');
    expect(doc).toMatch(/NDJSON/);
    expect(doc).toMatch(/line\s+by\s+line/i);
  });
});

afterAll(() => { /* every run cleans up its own temp dir */ });
