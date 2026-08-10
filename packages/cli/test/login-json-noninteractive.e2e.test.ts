// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os login --json` refuses in a non-interactive shell — it does not prompt,
 * and it does not exit 13 (#6728).
 *
 * ## The defect these pin shut
 *
 * Under the device flow that #6531 fixed sat a second path with the same
 * stdout-purity harm and a different cause. With no TTY and one or both of
 * `--email`/`--password` missing — what a CI runner produces when a secret
 * fails to interpolate — `login.ts` fell through to `readline`, whose prompt
 * goes to the `output` stream the interface was built on: `process.stdout`,
 * unconditionally, `--json` or not. Measured on unmodified `origin/main`
 * @ `73bff86`:
 *
 * ```
 * $ os login --json --url http://127.0.0.1:1 < /dev/null > out.txt 2> err.txt
 * exit=13
 * $ cat -A out.txt
 * Email:
 * ```
 *
 * — the ENTIRE stdout of a run under a declared machine-readable flag, with no
 * trailing newline. The same run with `--password` supplied wrote `Email: `;
 * with `--email` supplied it wrote `Password: `. All three exited 13.
 *
 * ## Why the exit code is asserted, and asserted as a MEMBER of a set
 *
 * 13 is Node's `Unsettled Top-Level Await` teardown: `readline` gets EOF, the
 * question promise is abandoned rather than rejected, nothing throws, and the
 * `await execute(...)` in `bin/run.js` never settles. It is not a code this CLI
 * chose — `CliExitCode` (`src/utils/format.ts`) admits **0 and 1 only**, and
 * that narrowness is the contract a CI step judging success by exit status
 * depends on.
 *
 * So "non-zero" is not the assertion. A bare `expect(code).not.toBe(0)` stays
 * **green against the defect itself**, since 13 is as non-zero as 1 is. Each
 * case therefore asserts membership in {@link DEFINED_EXIT_CODES} *and* the
 * specific value, and the membership assertion is the one that names 13.
 *
 * ## Why no PTY here, unlike the device-flow sibling
 *
 * `login-json-ndjson.e2e.test.ts` needs `script(1)` because the device flow is
 * gated on `process.stdin.isTTY`. This path is the opposite: it is reachable
 * precisely *because* stdin is a pipe, which is what a plain `spawn` already
 * gives the child. Measured both ways before this file was written — the
 * repro above is a shell redirect, no pty involved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const LOGIN_SRC = resolve(HERE, '../src/commands/login.ts');
const CLI_DOCS = resolve(HERE, '../../..', 'content/docs/deployment/cli.mdx');

/**
 * Every exit code `CliExitCode` admits (`src/utils/format.ts`). Kept as a list
 * rather than a `toBe(1)` alone so a regression to Node's exit 13 fails on
 * "not a code this CLI defines", which is the actual defect, instead of on a
 * value mismatch that reads like a flake.
 */
const DEFINED_EXIT_CODES = [0, 1];

/** The refusal the maintainer ruled on (2026-08-09), verbatim. */
const REFUSAL = 'email and password are required in a non-interactive shell';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * One `os login` run in a real child process with a **piped** stdin — the
 * non-TTY shape the defect lives in.
 *
 * `answer` drives the prompts the way an interactive consumer would: each entry
 * waits for its pattern to appear on stdout before writing its line, so a run
 * that never prompts simply never gets fed (and ends on its own). With no
 * entries stdin is closed immediately, which is the `< /dev/null` repro.
 */
function runLogin(args: string[], answer: Array<{ when: RegExp; send: string }> = []): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), 'os-login-6728-'));
  // HOME is the credentials root (`auth-config.ts` builds every path from
  // `os.homedir()`), so a temp one keeps the run from reading — or
  // overwriting — the developer's real ~/.objectstack/credentials.json.
  const home = join(dir, 'home');

  return new Promise<Run>((done) => {
    const child = spawn(TSX, [CLI, 'login', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: home, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    const pending = [...answer];

    const feed = () => {
      while (pending.length > 0 && pending[0]!.when.test(stdout)) {
        child.stdin.write(pending.shift()!.send);
      }
      if (pending.length === 0 && child.stdin.writable) child.stdin.end();
    };

    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString();
      feed();
    });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });

    // No answers to give: EOF straight away, the `< /dev/null` shape.
    if (pending.length === 0) child.stdin.end();

    child.on('close', (code) => {
      rmSync(dir, { recursive: true, force: true });
      done({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Every non-empty line of a captured stdout. */
function lines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => l.length > 0);
}

/**
 * Carriage return (13) and ESC (27) — the invisible bytes that corrupt a
 * line-oriented reader even where they carry no visible text.
 *
 * Built from code points on purpose: a literal class would put the very bytes
 * this asserts against into the source file, which is the accident AGENTS.md's
 * byte discipline and `scripts/check-nul-bytes.mjs` exist to prevent.
 */
const CONTROL_NOISE = new RegExp(`[${String.fromCharCode(13)}${String.fromCharCode(27)}]`);

/**
 * A minimal better-auth `sign-in/email` endpoint — enough for the CLI's
 * `client.auth.login()` to succeed, so the paths that must KEEP working can be
 * asserted as successes rather than as "a different failure".
 */
function startAuthEndpoint() {
  const seen: Array<{ email?: string; password?: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { pathname } = new URL(req.url ?? '/', 'http://placeholder');
      if (pathname === '/api/v1/auth/sign-in/email') {
        seen.push(JSON.parse(body || '{}') as { email?: string; password?: string });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          token: 'TOKEN-6728',
          user: { id: 'usr_6728', email: 'ci@example.com' },
        }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });
  });
  return {
    seen,
    listen: () => new Promise<number>((r) => {
      server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port));
    }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** The URL flag every case passes — a port nothing listens on unless said so. */
const DEAD_URL = 'http://127.0.0.1:1';

describe('os login --json refuses rather than prompting (#6728 ruling: shape 1)', () => {
  // The three ways a run can arrive here with something still to ask for. The
  // partial-flag pair matters on its own: a CI step that interpolated one
  // secret and lost the other is the likeliest real shape, and it prompts for
  // the OTHER field — `Password: ` on stdout where `--email` was supplied.
  const cases: Array<{ name: string; args: string[] }> = [
    { name: 'neither credential supplied', args: ['--json', '--url', DEAD_URL] },
    { name: 'only --password supplied', args: ['--json', '--url', DEAD_URL, '--password', 'secret'] },
    { name: 'only --email supplied', args: ['--json', '--url', DEAD_URL, '--email', 'ci@example.com'] },
  ];

  const runs = new Map<string, Run>();

  beforeAll(async () => {
    // Sequential: each child owns a HOME and a startup budget, and overlapping
    // them buys nothing but interleaved timing.
    for (const c of cases) runs.set(c.name, await runLogin(c.args));
  }, 300_000);

  for (const c of cases) {
    describe(c.name, () => {
      it('emits the ruled refusal record and nothing else', () => {
        const run = runs.get(c.name)!;
        const all = lines(run.stdout);
        // One record, so this subsumes "no prompt, no banner" rather than
        // enumerating strings a future edit could add to.
        expect(all, `stdout was: ${JSON.stringify(run.stdout)}`).toHaveLength(1);
        expect(JSON.parse(all[0]!)).toEqual({ success: false, error: REFUSAL });
      });

      it('exits with a code this CLI defines — the half that is not about the payload', () => {
        const run = runs.get(c.name)!;
        expect(
          DEFINED_EXIT_CODES,
          `exit ${run.code} is not a CliExitCode. 13 is Node's unsettled-top-level-await ` +
            'teardown, which is exactly what this path used to produce.',
        ).toContain(run.code);
        expect(run.code).toBe(1);
      });

      it('lets no prompt onto stdout, and leaves no partial line behind', () => {
        const run = runs.get(c.name)!;
        expect(run.stdout).not.toContain('Email:');
        expect(run.stdout).not.toContain('Password:');
        expect(run.stdout).not.toContain('ObjectStack Login');
        expect(run.stdout).not.toMatch(CONTROL_NOISE);
        // The record is a whole line: `Email: ` had no trailing newline at all.
        expect(run.stdout.endsWith('\n')).toBe(true);
      });

      it('is parseable NDJSON on every line', () => {
        const run = runs.get(c.name)!;
        for (const [i, line] of lines(run.stdout).entries()) {
          expect(() => JSON.parse(line), `stdout line ${i + 1}: ${JSON.stringify(line)}`).not.toThrow();
        }
      });
    });
  }
});

describe('EOF on stdin ends in a defined CliExitCode, not Node exit 13 (#6728)', () => {
  // Without `--json` the prompts stay — the ruling changed the machine-readable
  // contract, not the human one — so these runs still print `Email: `. What is
  // asserted is the ENDING: a question that outlives its input now rejects,
  // which puts the failure back on the path that ends in `this.exit(1)`.
  let both: Run;
  let passwordOnly: Run;

  beforeAll(async () => {
    both = await runLogin(['--url', DEAD_URL]);
    passwordOnly = await runLogin(['--url', DEAD_URL, '--email', 'ci@example.com']);
  }, 300_000);

  it('fails at the email prompt with a defined exit code', () => {
    expect(
      DEFINED_EXIT_CODES,
      `exit ${both.code} is not a CliExitCode — 13 means the process was torn down ` +
        'by an unsettled top-level await instead of deciding anything.',
    ).toContain(both.code);
    expect(both.code).toBe(1);
  });

  it('fails at the password prompt with a defined exit code', () => {
    expect(DEFINED_EXIT_CODES).toContain(passwordOnly.code);
    expect(passwordOnly.code).toBe(1);
  });

  it('names the cause and the remedy instead of dying silently', () => {
    // On the defect the only diagnostic anywhere was Node's own
    // `Warning: Detected unsettled top-level await`, which names the runtime
    // artefact rather than the operator's mistake.
    const said = both.stdout + both.stderr;
    expect(said).toContain('stdin reached end of input');
    expect(said).toContain('--email');
    expect(said).toContain('--password');
    expect(both.stderr).not.toContain('unsettled top-level await');
  });
});

describe('the paths that must keep working (#6728 did not narrow them)', () => {
  const endpoint = startAuthEndpoint();
  let port: number;

  beforeAll(async () => { port = await endpoint.listen(); }, 30_000);
  afterAll(async () => { await endpoint.close(); });

  it('logs in with both flags under --json — one record, exit 0', async () => {
    const run = await runLogin(['--json', '--url', `http://127.0.0.1:${port}`, '--email', 'ci@example.com', '--password', 'secret']);
    const all = lines(run.stdout);
    expect(all, `stdout was: ${JSON.stringify(run.stdout)}`).toHaveLength(1);
    expect(JSON.parse(all[0]!)).toEqual({ success: true, email: 'ci@example.com', userId: 'usr_6728' });
    expect(DEFINED_EXIT_CODES).toContain(run.code);
    expect(run.code).toBe(0);
  }, 300_000);

  it('still prompts, and still succeeds, for a consumer that answers', async () => {
    // The refusal is keyed on `--json`, not on "stdin is a pipe": a driver that
    // reads the prompt and writes the line is served exactly as before. This is
    // also the run that proves the single shared readline interface still hands
    // BOTH answers over — the email prompt and the password prompt.
    const run = await runLogin(
      ['--url', `http://127.0.0.1:${port}`],
      [
        { when: /Email: $/m, send: 'ci@example.com\n' },
        { when: /Password: $/m, send: 'secret\n' },
      ],
    );
    expect(run.stdout).toContain('Authentication successful');
    expect(DEFINED_EXIT_CODES).toContain(run.code);
    expect(run.code).toBe(0);
    expect(endpoint.seen.at(-1)).toMatchObject({ email: 'ci@example.com', password: 'secret' });
  }, 300_000);
});

describe('the refusal stays structural, not one call site (#6728)', () => {
  const loginSrc = () => readFileSync(LOGIN_SRC, 'utf-8');

  it('asks no question that can outlive its input', () => {
    // `rl.question(...)` without the abort signal is the unsettleable form —
    // the whole of exit 13. One helper owns it so a future prompt cannot
    // reintroduce the hang by simply forgetting; this is the guard on that
    // helper, in the same shape as the `emitRecord` guard in the NDJSON suite.
    const src = loginSrc();
    const raw = src
      .split('\n')
      .map((line, n) => ({ line, n: n + 1 }))
      .filter(({ line }) => /\brl\.question\s*\(/.test(line))
      .filter(({ line }) => !/\{\s*signal\s*\}/.test(line));
    expect(
      raw.map(({ n, line }) => `${n}: ${line.trim()}`),
      'every readline question in login.ts must carry the EOF abort signal (askOrFailAtEof)',
    ).toEqual([]);
    expect(/async function askOrFailAtEof\(/.test(src)).toBe(true);
  });

  it('declares the non-interactive implication in the --json flag help', () => {
    // `--help` is where a CI author looks when the record says the credentials
    // were required; an undocumented refusal reads as a bug in the CLI.
    const flag = /json:\s*Flags\.boolean\(\{[\s\S]*?\}\)/.exec(loginSrc())?.[0] ?? '';
    expect(flag).toMatch(/non-interactive/i);
    expect(flag).toMatch(/refuses/i);
  });

  it('documents the refusal on the CLI reference page', () => {
    // Prose in .mdx is hard-wrapped, so any run of whitespace is treated as a
    // word gap: a pin that broke when a sentence rewrapped would train the next
    // editor to delete it rather than to keep the declaration.
    const doc = readFileSync(CLI_DOCS, 'utf-8');
    expect(doc).toMatch(/refuses\s+rather\s+than\s+prompting/i);
    expect(doc).toContain(REFUSAL);
  });
});
