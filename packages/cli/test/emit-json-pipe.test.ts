// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * `emitJson` exists because a `--json` payload written with `console.log` and
 * followed by an exit is silently CUT OFF at one 64 KiB pipe buffer.
 *
 * The bug is invisible in every interactive run: stdout to a TTY is written
 * synchronously, so an author sees perfect output while every scripted
 * consumer — the only audience `--json` has — gets invalid JSON. It is also
 * not limited to an explicit `process.exit`: oclif ends failing commands with
 * `handle()` → `Exit.exit()` → `process.exit()` and flushes nothing on that
 * path, so a plain `this.exit(1)` truncates identically.
 *
 * So this spawns a REAL child process with stdout on a PIPE (the condition
 * that triggers it) and asserts both directions — the fix holds, and the
 * pattern it replaced genuinely fails. A gate that cannot go red is a comment.
 */

const REPO_CLI = resolve(__dirname, '..');
const FORMAT_MODULE = resolve(REPO_CLI, 'src/utils/format.ts');
const TSX = resolve(REPO_CLI, '../../node_modules/.bin/tsx');

/** Comfortably past one 64 KiB pipe buffer, and past two, so a partial drain still fails. */
const PAYLOAD_BYTES = 300_000;

let dir: string;
let expectedLength: number;

function harness(body: string): string {
  // `.mts`, not `.ts`: the temp dir has no package.json, so tsx would treat a
  // bare `.ts` as CJS and reject the top-level await these harnesses need.
  const file = join(dir, `harness-${Math.abs(hash(body))}.mts`);
  writeFileSync(
    file,
    `import { emitJson } from ${JSON.stringify(FORMAT_MODULE)};\n` +
      `const payload = { blob: 'x'.repeat(${PAYLOAD_BYTES}) };\n` +
      body +
      '\n',
  );
  return file;
}

// Deterministic file naming without Date.now()/Math.random().
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Run a harness with stdout on a pipe; return stdout even when the exit code is non-zero. */
async function runPiped(file: string): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileP(TSX, [file], { maxBuffer: 64 * 1024 * 1024 });
    return { stdout, code: 0 };
  } catch (err: any) {
    return { stdout: String(err.stdout ?? ''), code: err.code ?? 1 };
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-emitjson-'));
  expectedLength = JSON.stringify({ blob: 'x'.repeat(PAYLOAD_BYTES) }, null, 2).length + 1;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('emitJson over a pipe', () => {
  it('delivers the whole payload when the process exits non-zero right after writing', async () => {
    const file = harness("await emitJson(payload); process.exit(1);");
    const { stdout, code } = await runPiped(file);

    expect(code).toBe(1);
    expect(stdout.length).toBe(expectedLength);
    expect(stdout.length).toBeGreaterThan(65_536);
    // The assertion that actually matters to a consumer.
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(JSON.parse(stdout).blob).toHaveLength(PAYLOAD_BYTES);
  }, 60_000);

  it('records the exit code without tearing down the write', async () => {
    const file = harness('await emitJson(payload, 1);');
    const { stdout, code } = await runPiped(file);

    expect(code).toBe(1);
    expect(JSON.parse(stdout).blob).toHaveLength(PAYLOAD_BYTES);
  }, 60_000);

  it('survives a thrown error after the write — oclif turns those into process.exit too', async () => {
    const file = harness("await emitJson(payload); throw new Error('boom');");
    const { stdout } = await runPiped(file);

    expect(JSON.parse(stdout).blob).toHaveLength(PAYLOAD_BYTES);
  }, 60_000);

  it('compact mode is a formatting choice, not a truncation escape hatch', async () => {
    const file = harness('await emitJson(payload, 0, { compact: true }); process.exit(1);');
    const { stdout } = await runPiped(file);

    expect(stdout).not.toContain('\n  ');
    expect(JSON.parse(stdout).blob).toHaveLength(PAYLOAD_BYTES);
  }, 60_000);

  it('CONTROL: the console.log pattern it replaced really does truncate', async () => {
    // Pins that the assertions above are testing something real.
    //
    // Whether a given run truncates is a RACE between the writer's exit and the
    // reader's drain, so this must not be written the obvious way. A first
    // version used the same 300 KB payload and `execFileP` (which reads
    // continuously): it truncated at 65536 locally and delivered all 300017
    // bytes on a CI runner whose reader kept up — a gate that goes red by
    // machine speed, which is no better than one that cannot go red at all.
    //
    // Removing the race: never read the pipe until the child has exited. The
    // kernel buffer then caps at its capacity (64 KiB by default) and
    // everything still queued in userspace dies with `process.exit`. The
    // payload is 4 MB so the margin over any plausible capacity — even a
    // 1 MiB `pipe-max-size` — is ~50x, and the exact byte count is allowed to
    // vary because only the shortfall is the claim.
    //
    // This technique is valid ONLY for the broken pattern. Pointing it at
    // `emitJson` would hang forever, because awaiting the write callback is
    // precisely what the fix does: with no reader, the write never completes.
    // That deadlock IS the fix working.
    const CONTROL_BYTES = 4_000_000;
    const file = join(dir, 'control.mts');
    writeFileSync(
      file,
      `const payload = { blob: 'x'.repeat(${CONTROL_BYTES}) };\n` +
        'console.log(JSON.stringify(payload, null, 2));\n' +
        'process.exit(1);\n',
    );

    const child = spawn(TSX, [file], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.pause();
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const chunks: Buffer[] = [];
    for await (const c of child.stdout) chunks.push(c as Buffer);
    const delivered = Buffer.concat(chunks).toString('utf8');

    const whole = JSON.stringify({ blob: 'x'.repeat(CONTROL_BYTES) }, null, 2).length + 1;
    expect(delivered.length).toBeLessThan(whole);
    expect(() => JSON.parse(delivered)).toThrow();
  }, 60_000);
});

/**
 * The end-to-end shape both fixes exist for: a real command, a real pipe, a
 * failing config big enough to cross several 64 KiB buffers.
 *
 * Before, piping this gave 131072 bytes — exactly two buffers, cut mid-string.
 * Draining the write fixed the size and exposed the second defect underneath:
 * `this.exit(1)` THROWS, so the inner report unwound into the outer catch and
 * the command printed a SECOND JSON document. Truncation had been hiding it.
 * Both have to hold for `--json` to mean anything.
 */
describe('os validate --json over a pipe', () => {
  const CONFIG_OBJECTS = 900;
  let configDir: string;

  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'os-validate-'));
    const objects: Record<string, unknown> = {};
    for (let i = 0; i < CONFIG_OBJECTS; i++) {
      // `type` must be a string — each object contributes a schema issue, and
      // 900 of them put the payload comfortably past several pipe buffers.
      objects[`obj_${i}`] = { name: `obj_${i}`, fields: { f: { type: 12345 } } };
    }
    writeFileSync(
      join(configDir, 'objectstack.config.ts'),
      // #8687: no stray top-level `name` — it would add a 901st (unrecognized_keys)
      // error and break the exact-count assertion below.
      `export default ${JSON.stringify({ objects }, null, 2)};\n`,
    );
  });

  afterAll(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('delivers exactly one parseable document, whole', async () => {
    const { stdout, code } = await (async () => {
      try {
        const { stdout } = await execFileP(
          TSX,
          [resolve(REPO_CLI, 'bin/run-dev.js'), 'validate', join(configDir, 'objectstack.config.ts'), '--json'],
          { maxBuffer: 64 * 1024 * 1024, cwd: REPO_CLI },
        );
        return { stdout, code: 0 };
      } catch (err: any) {
        return { stdout: String(err.stdout ?? ''), code: err.code ?? 1 };
      }
    })();

    expect(code).toBe(1);
    expect(stdout.length).toBeGreaterThan(131_072); // was capped here by two pipe buffers
    // One document — not two concatenated, which is neither valid JSON nor JSONL.
    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toHaveLength(CONFIG_OBJECTS);
  }, 120_000);
});

describe('isExitSignal', () => {
  it('recognises what this.exit() throws, and nothing else', async () => {
    const { isExitSignal } = await import('../src/utils/format.js');
    expect(isExitSignal({ code: 'EEXIT', oclif: { exit: 1 } })).toBe(true);
    expect(isExitSignal({ oclif: { exit: 0 } })).toBe(true);
    expect(isExitSignal(new Error('a real failure'))).toBe(false);
    expect(isExitSignal({ code: 'ENOENT' })).toBe(false);
    expect(isExitSignal(undefined)).toBe(false);
    expect(isExitSignal(null)).toBe(false);
  });
});

