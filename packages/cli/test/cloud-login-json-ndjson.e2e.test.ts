// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os cloud login --json` is NDJSON, and the URL comes FIRST (#6730).
 *
 * ## The defect this pins shut
 *
 * This command passed `silent: flags.json` into the shared device flow and
 * nothing else. Formally that was impeccable: stdout carried one JSON document
 * and `JSON.parse` read it. Measured on `origin/main` against a live RFC 8628
 * endpoint, `os cloud login --json --no-browser` produced exactly this, and
 * nothing else — on stdout or stderr:
 *
 * ```
 * {
 *   "success": true,
 *   "email": "device@example.com",
 *   "userId": "usr_6730",
 *   "url": "http://127.0.0.1:<port>"
 * }
 * ```
 *
 * The verification URL never reached a consumer. `silent` suppressed the
 * human-readable print and put nothing in its place, so the single thing device
 * flow exists to give a script — the URL, while there is still time to act on
 * it — was withheld from the only caller that cannot ask a human for it. That
 * is the defect: not a malformed document, an absent event.
 *
 * The maintainer ruled (2026-08-08, #6730, extending #6531) that both login
 * commands carry one contract: a **stream**, every line parseable on its own,
 * verification-URL record before authorization.
 *
 * ## Why the ordering assertion is TEMPORAL, not an array index
 *
 * The ruling picked NDJSON over "buffer both halves and emit one document at
 * the end" for exactly one reason: an automation consumer needs the
 * verification URL *while it can still act on it*. Asserting `records[0]` is
 * the device record would not catch a regression to the buffered shape at all,
 * because a trailing merged emit also puts the URL fields first.
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
 * `cloud/login.ts` takes the device flow only when `process.stdin.isTTY` — a
 * child with a piped stdin falls through to the email/password prompt and never
 * reaches the emission points at all. A plain `execFile` therefore cannot reach
 * the defect. `script(1)` allocates the pty; the command it runs redirects
 * stdout and stderr to files, so fd 0 is a TTY while fd 1 and fd 2 stay
 * separate, capturable and non-TTY — which is also the shape a real user gets
 * when they pipe an interactive `os cloud login --json` into a consumer.
 *
 * If `script(1)` is missing this file FAILS rather than skips. A contract test
 * that quietly opts out on the machine that runs it is the same green-for-the-
 * wrong-reason hazard the fixtures in #5046 were replaced for; every CI runner
 * in this repo is `ubuntu-latest`, where `script(1)` is part of the base image.
 */

import { describe, it, expect, beforeAll } from 'vitest';
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
const CLOUD_LOGIN_SRC = resolve(HERE, '../src/commands/cloud/login.ts');
const REPO_ROOT = resolve(HERE, '../../..');
const CLI_DOCS = resolve(REPO_ROOT, 'content/docs/deployment/cli.mdx');
const DEPLOY_DOCS = resolve(REPO_ROOT, 'content/docs/deployment/index.mdx');

/**
 * How long the endpoint waits for the device record to appear before releasing
 * anyway. Only reached when the record never arrives early — i.e. when the
 * contract is broken — and exists so that failure is an assertion rather than a
 * suite that hangs until the runner kills it.
 */
const RELEASE_DEADLINE_MS = 20_000;

/** Poll interval for watching the child's stdout file. */
const WATCH_MS = 25;

interface DeviceRun {
  code: number;
  stdout: string;
  stderr: string;
  /** When the verification URL was first readable on stdout. */
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

  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const { pathname } = new URL(req.url ?? '/', 'http://placeholder');

      if (pathname === '/api/v1/auth/device/code') {
        return send(200, {
          device_code: 'DEV-CODE-6730',
          user_code: 'WXYZ-6730',
          verification_uri: 'http://127.0.0.1:9/activate',
          verification_uri_complete: 'http://127.0.0.1:9/activate?user_code=WXYZ-6730',
          expires_in: 600,
          // 1s: the CLI floors anything falsy back to 5s (`interval || 5`).
          interval: 1,
        });
      }

      if (pathname === '/api/v1/auth/device/token') {
        if (!released) return send(400, { error: 'authorization_pending' });
        authorizedAt ??= Date.now();
        return outcome === 'token'
          ? send(200, { access_token: 'ACCESS-TOKEN-6730', token_type: 'Bearer' })
          : send(400, { error: 'access_denied' });
      }

      if (pathname === '/api/v1/auth/get-session') {
        return send(200, { user: { id: 'usr_6730', email: 'device@example.com' } });
      }

      return send(404, { error: 'not_found' });
    });
  });

  return {
    server,
    release: () => {
      released = true;
    },
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
 * Drive one full cloud device-flow login through a real child process on a PTY.
 *
 * `sawUrl` is what the watcher waits for before letting the endpoint authorize;
 * it differs between the `--json` runs (a parseable record) and the human run
 * (printed prose), which is the whole point — the human path must keep printing
 * the URL it always printed.
 */
async function runCloudDeviceLogin(opts: {
  outcome: 'token' | 'access_denied';
  json: boolean;
  sawUrl?: (stdout: string) => boolean;
}): Promise<DeviceRun> {
  const sawUrl = opts.sawUrl ?? ((text: string) => findDeviceRecord(text) !== null);
  const dir = mkdtempSync(join(tmpdir(), 'os-cloud-login-ndjson-'));
  const outFile = join(dir, 'stdout.txt');
  const errFile = join(dir, 'stderr.txt');
  // HOME is the credentials root (`cloud-config.ts` builds every path from
  // `os.homedir()`), so pointing it at the temp dir keeps the run from reading
  // — or overwriting — the developer's real ~/.objectstack/cloud.json.
  const home = join(dir, 'home');

  const endpoint = startDeviceEndpoint(opts.outcome);
  const port = await endpoint.listen();

  let urlSeenAt: number | null = null;
  let releasedByDeadline = false;

  const watcher = setInterval(() => {
    if (urlSeenAt !== null) return;
    if (!existsSync(outFile)) return;
    if (sawUrl(readFileSync(outFile, 'utf-8'))) {
      urlSeenAt = Date.now();
      endpoint.release();
    }
  }, WATCH_MS);

  const deadline = setTimeout(() => {
    if (urlSeenAt === null) {
      releasedByDeadline = true;
      endpoint.release();
    }
  }, RELEASE_DEADLINE_MS);

  const shell = [
    `'${TSX}' '${CLI}' cloud login${opts.json ? ' --json' : ''} --no-browser`,
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

describe('os cloud login --json — the declared NDJSON stream (#6730)', () => {
  let ok: DeviceRun;
  let denied: DeviceRun;
  let human: DeviceRun;

  beforeAll(async () => {
    try {
      execFileSync('script', ['--version'], { stdio: 'ignore' });
    } catch {
      throw new Error(
        'script(1) is required to drive the TTY-gated device flow — see this file’s header for why this fails instead of skipping.',
      );
    }
    // Sequential: each run owns a port, a HOME and a poll clock, and running
    // them together would interleave three children's timing for no benefit.
    ok = await runCloudDeviceLogin({ outcome: 'token', json: true });
    denied = await runCloudDeviceLogin({ outcome: 'access_denied', json: true });
    human = await runCloudDeviceLogin({
      outcome: 'token',
      json: false,
      sawUrl: (text) => text.includes('/activate?user_code=WXYZ-6730'),
    });
  }, 240_000);

  describe('the successful flow', () => {
    it('emits stdout every line of which parses on its own — the NDJSON contract', () => {
      const all = lines(ok.stdout);
      expect(all.length).toBeGreaterThan(0);
      for (const [i, line] of all.entries()) {
        // Named per line so a regression says WHICH record broke, rather than
        // only that some parse failed.
        expect(() => JSON.parse(line), `stdout line ${i + 1}: ${JSON.stringify(line)}`).not.toThrow();
      }
    });

    it('hands the verification URL to the consumer at all — the #6730 defect itself', () => {
      // On origin/main this was the whole bug: a single valid document, and the
      // URL nowhere on stdout or stderr. Asserted before any ordering claim,
      // because "absent" and "late" are different failures and this names the
      // first one.
      expect(ok.stdout).toContain('verification_uri');
      expect(ok.stdout).toContain('http://127.0.0.1:9/activate?user_code=WXYZ-6730');
    });

    it('is exactly two records — device authorization, then the result', () => {
      const records = lines(ok.stdout).map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(records).toHaveLength(2);
      // Field-identical to what `os login --json` emits (#6531): a consumer
      // written against the documented stream must not have to ask which of the
      // two sibling commands produced the record.
      expect(records[0]).toMatchObject({
        device_code: 'DEV-CODE-6730',
        user_code: 'WXYZ-6730',
        verification_uri: 'http://127.0.0.1:9/activate',
        verification_uri_complete: 'http://127.0.0.1:9/activate?user_code=WXYZ-6730',
        expires_in: 600,
      });
      expect(records[1]).toMatchObject({
        success: true,
        email: 'device@example.com',
        userId: 'usr_6730',
      });
      // `url` is this command's own field — it records WHICH control plane the
      // credential now belongs to, which a cloud consumer needs and the runtime
      // login has no equivalent of.
      expect(String(records[1].url)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(ok.code).toBe(0);
    });

    it('hands over the verification URL BEFORE authorization — the reason this route was chosen', () => {
      // The endpoint only authorized because the watcher had already read the
      // record off stdout, so these two facts are the run's own history.
      expect(ok.releasedByDeadline, 'the device record never reached stdout early').toBe(false);
      expect(ok.urlSeenAt).not.toBeNull();
      expect(ok.authorizedAt).not.toBeNull();
      expect(ok.urlSeenAt!).toBeLessThanOrEqual(ok.authorizedAt!);
    });

    it('lets nothing but the payload onto stdout — no banner, no spinner, no prompt', () => {
      // Two records, two lines: any human-mode output would raise the count, so
      // this subsumes "nothing else was written" rather than listing banners a
      // future edit could add to.
      expect(lines(ok.stdout)).toHaveLength(2);
      expect(ok.stdout).not.toContain('ObjectStack Cloud Login');
      expect(ok.stdout).not.toContain('To authorize this CLI');
      expect(ok.stdout).not.toContain('Waiting for browser approval');
      expect(ok.stdout).not.toContain('Credentials stored in');
      // The spinner's carriage returns and its erase sequence would corrupt a
      // line-oriented reader even though they carry no visible text. Both are
      // written here as escape TEXT, never as the bytes themselves.
      expect(ok.stdout).not.toMatch(/[\r\u001b]/);
    });
  });

  describe('the failure that arrives AFTER the first record', () => {
    it('keeps every line parseable when the poll is denied', () => {
      // The path the card never named: device record already written, then an
      // indented error payload — a two-document stream on the run a consumer
      // can least afford to misread.
      const all = lines(denied.stdout);
      for (const [i, line] of all.entries()) {
        expect(() => JSON.parse(line), `stdout line ${i + 1}: ${JSON.stringify(line)}`).not.toThrow();
      }
      const records = all.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ user_code: 'WXYZ-6730' });
      expect(records[1]).toEqual({ success: false, error: 'Login denied by user.' });
    });

    it('reports the refusal through the exit code as well as the record', () => {
      expect(denied.code).toBe(1);
    });
  });

  describe('human mode is untouched', () => {
    it('still prints the verification URL as prose, and no JSON record', () => {
      // The emitter is wired only under `--json`; without it the shared flow
      // keeps its own printer. Pinned because the obvious wrong fix — always
      // passing `onDeviceCode` — would silently replace the human UX with a
      // machine record.
      expect(human.stdout).toContain('To authorize this CLI');
      expect(human.stdout).toContain('http://127.0.0.1:9/activate?user_code=WXYZ-6730');
      expect(human.stdout).toContain('User code: WXYZ-6730');
      expect(human.stdout).not.toContain('"device_code"');
      expect(human.code).toBe(0);
    });
  });
});

describe('the exception stays declared, not just implemented (#6730 ruling)', () => {
  const cloudLoginSrc = () => readFileSync(CLOUD_LOGIN_SRC, 'utf-8');

  it('routes every --json write through the single compact emitter', () => {
    // The contract is "one document per line" for the WHOLE command, so a new
    // write that called `emitJson` directly could reintroduce a multi-line
    // record on a path the e2e above does not drive. One emitter is what makes
    // that structurally impossible; this is the guard on the emitter.
    const src = cloudLoginSrc();
    const direct = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\bemitJson\s*\(/.test(line))
      .filter(({ line }) => !/^\s*await emitJson\(payload, exitCode, \{ compact: true \}\);$/.test(line));
    expect(
      direct.map(({ n, line }) => `${n}: ${line.trim()}`),
      'every --json write in cloud/login.ts must go through emitRecord()',
    ).toEqual([]);
    expect(/async function emitRecord\(/.test(src)).toBe(true);
  });

  it('declares NDJSON in the --json flag help text', () => {
    // `--help` is where a consumer looks first, and the ruling made the
    // declaration a condition of the fix: an undocumented exception harms the
    // same audience as the bug.
    const src = cloudLoginSrc();
    const flag = /json:\s*Flags\.boolean\(\{[\s\S]*?\}\)/.exec(src)?.[0] ?? '';
    expect(flag).toMatch(/NDJSON/);
    expect(flag).toMatch(/per line/i);
  });

  // Prose in .mdx is hard-wrapped, so these patterns treat any run of
  // whitespace as a word gap. A pin that broke when a sentence rewrapped would
  // train the next editor to delete it rather than to keep the declaration.
  it('documents the exception on the CLI reference page', () => {
    const doc = readFileSync(CLI_DOCS, 'utf-8');
    expect(doc).toMatch(/`os\s+cloud\s+login\s+--json`\s+is\s+NDJSON/);
    expect(doc).toMatch(/one\s+compact\s+JSON\s+document\s+per\s+line/i);
    expect(doc).toMatch(/parse\s+it\s+line\s+by\s+line/i);
  });

  it('documents the exception where the cloud login step is prescribed', () => {
    // The deployment page is where a script author meets `os cloud login` in
    // the first place — the publish flow — so the declaration has to be
    // reachable from there and not only from the CLI reference.
    const doc = readFileSync(DEPLOY_DOCS, 'utf-8');
    expect(doc).toMatch(/NDJSON/);
    expect(doc).toMatch(/one\s+per\s+line/i);
    expect(doc).toMatch(/\/docs\/deployment\/cli#os-cloud-login/);
  });
});
