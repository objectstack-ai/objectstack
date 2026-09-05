// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--json` ⇒ nothing unparseable on stdout when the CONFIG FILE IS MISSING,
 * for the whole `resolveConfigPath` family (#15547).
 *
 * ## The blind spot this exists to close
 *
 * `json-stdout-purity.e2e.test.ts` already pins "stdout is exactly one JSON
 * document" — but it DISCOVERS its family as the commands that call
 * `bootSchemaStack`. The commands here fail at `resolveConfigPath()`, which
 * runs **before** any kernel boots, so that pin structurally cannot see this
 * path and stayed green through the whole defect.
 *
 * What it was green through: `resolveConfigPath()` printed its refusal through
 * `printError` and `console.log` — both stdout — and then called
 * `process.exit(1)` directly. Ten published `--json` faces therefore answered a
 * missing config with human text on the machine's channel, an EMPTY stderr, and
 * no payload; and because nothing was thrown, every command's catch-all
 * `--json` error exit — all of which sit downstream of a throw — never ran.
 *
 * ⇒ The instrument was as broken as the code. A fix that repaired the helper
 * without widening the discovery would leave the next pre-boot stdout leak just
 * as invisible, which is why this file exists rather than a fixture edit.
 *
 * ## Why the whole family, from one expectation
 *
 * Same discipline as the sibling pin: the family is READ OFF THE SOURCE, not
 * remembered, and reconciled against {@link FAMILY}. Add a command that offers
 * `--json` and reaches the config helper and this file goes red until it is
 * listed here and passes; drop one and it goes red until it is removed.
 *
 * The discovery has two halves because the reach has two shapes:
 *
 *   • DIRECT — the module declares `json: Flags.boolean(` and imports from
 *     `utils/config.js`.
 *   • ALIAS — the module's default export `extends` a command in the direct
 *     set, so it inherits both the flag and the reach without naming either.
 *     `os build` is exactly this (`class Build extends Compile`), and a
 *     one-half discovery would have missed it: the original card's static
 *     reading listed nine modules, and `build` is the tenth face.
 *
 * ## What is asserted — and what is deliberately NOT
 *
 * ⛔ This file does NOT pin an error-payload shape. Whether `--json` should
 * emit an envelope on this path is an open question touching ten published
 * faces at once, entangled with #15549 (`os lint --eval --json`'s bare
 * `{ error }` with no `code` and no `httpStatus`), and settling it is above
 * this pin's authority.
 *
 * So the assertion is the half that needs no ruling: **stdout carries nothing a
 * machine cannot read.** Empty passes, one JSON document passes, prose fails.
 * That holds under the shape shipped today AND under any future envelope, so
 * whoever settles the question changes the payload without touching this file.
 *
 * The other two halves are the ones a "just silence it" regression would break:
 * the diagnostic must still reach the operator, on **stderr**, and the exit
 * status must still be 1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const COMMANDS_DIR = resolve(HERE, '../src/commands');

/** A path that cannot exist, driving the EXPLICIT-PATH branch of the helper. */
const MISSING = './nope-does-not-exist.ts';

/**
 * The family, and the argv each member needs to reach `resolveConfigPath()`.
 *
 * `autoDetect: false` marks the one member with no auto-detect branch to drive:
 * `os diff` requires two config paths, so there is no bare form that reaches
 * the helper without one.
 */
interface Member {
  /** argv that reaches the helper with an EXPLICIT missing path. */
  explicit: string[];
  /** argv that reaches the helper with NO path, or `null` when there is none. */
  auto: string[] | null;
}

const FAMILY: Record<string, Member> = {
  // `build` is `class Build extends Compile` — the alias half of the discovery.
  build: { explicit: [MISSING], auto: [] },
  compile: { explicit: [MISSING], auto: [] },
  diff: { explicit: [MISSING, MISSING], auto: null },
  'i18n check': { explicit: [MISSING], auto: [] },
  'i18n extract': { explicit: [MISSING], auto: [] },
  info: { explicit: [MISSING], auto: [] },
  lint: { explicit: [MISSING], auto: [] },
  // `--from` because `--stored` is its only other way past the flag parser, and
  // `--stored` boots a kernel — a different family, already pinned elsewhere.
  'migrate meta': { explicit: [MISSING, '--from', '4'], auto: ['--from', '4'] },
  validate: { explicit: [MISSING], auto: [] },
  // The config path is a FLAG here, not a positional.
  verify: { explicit: ['--app', MISSING], auto: [] },
};

/** The refusal text, one line per branch — what must be on stderr, never stdout. */
const REFUSAL = {
  explicit: 'Config file not found',
  auto: 'No objectstack.config.{ts,js,mjs} found in current directory',
} as const;

/** Every `.ts` under `src/commands`, excluding tests. */
function commandFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...commandFiles(abs));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(abs);
  }
  return out;
}

/** `src/commands/i18n/check.ts` → `i18n check`, the id oclif dispatches on. */
function commandId(abs: string): string {
  const rel = relative(COMMANDS_DIR, abs).replace(/\.ts$/, '');
  return rel.split(sep).filter((p) => p !== 'index').join(' ');
}

/**
 * The family, read off the source rather than remembered: a command belongs iff
 * it offers a machine-readable mode AND reaches the config helper — directly,
 * or by extending a command that does.
 */
function discoverFamily(): string[] {
  const files = commandFiles(COMMANDS_DIR);
  const sources = new Map(files.map((abs) => [abs, readFileSync(abs, 'utf-8')]));

  const direct = new Set<string>();
  for (const [abs, src] of sources) {
    if (!/\bjson:\s*Flags\.boolean\(/.test(src)) continue;
    if (!/from '(?:\.\.\/)+utils\/config\.js'/.test(src)) continue;
    direct.add(abs);
  }

  // An alias inherits the flag and the reach from the class it extends, and
  // names neither itself. Resolve `extends <Ident>` back to the module the
  // identifier was imported from, and take the member if that module is in the
  // direct set. One level is enough for the aliases in this tree and a deeper
  // chain would show up as a discovery mismatch rather than pass silently.
  const alias = new Set<string>();
  for (const [abs, src] of sources) {
    const ext = /export default class \w+ extends (\w+)\b/.exec(src);
    if (!ext) continue;
    const imported = new RegExp(`import ${ext[1]} from '(\\.[^']+)\\.js'`).exec(src);
    if (!imported) continue;
    const target = resolve(abs, '..', `${imported[1]}.ts`);
    if (direct.has(target)) alias.add(abs);
  }

  return [...direct, ...alias].map(commandId).sort();
}

interface Run {
  key: string;
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[], cwd: string): Promise<Omit<Run, 'key'>> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...argv],
      { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err
            ? (typeof (err as { code?: unknown }).code === 'number'
                ? (err as unknown as { code: number }).code
                : 1)
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/**
 * Whether stdout is something a program can read: nothing at all, or exactly
 * one JSON document. Prose is the failure — see the header for why the choice
 * between the two passing shapes is deliberately left open.
 */
function stdoutIsMachineReadable(stdout: string): boolean {
  if (stdout.trim() === '') return true;
  try {
    JSON.parse(stdout);
    return true;
  } catch {
    return false;
  }
}

/** `[key, argv]` for every branch of every member — 19 runs across 10 faces. */
function cases(): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const [id, member] of Object.entries(FAMILY)) {
    const argv = id.split(' ');
    out.push([`${id} (explicit path)`, [...argv, ...member.explicit, '--json']]);
    if (member.auto) out.push([`${id} (auto-detect)`, [...argv, ...member.auto, '--json']]);
  }
  return out;
}

let dir: string;
let runs: Run[];

beforeAll(async () => {
  // Deliberately EMPTY — no `objectstack.config.*` here, so the auto-detect
  // branch misses and the explicit branch resolves against a real cwd.
  dir = mkdtempSync(join(tmpdir(), 'os-config-miss-e2e-'));

  // Sequential: nineteen `tsx` starts at once is the kind of load that makes a
  // shared box report timeouts instead of verdicts.
  runs = [];
  for (const [key, argv] of cases()) {
    const { code, stdout, stderr } = await runCli(argv, dir);
    runs.push({ key, code, stdout, stderr });
  }
}, 900_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('the family this contract has to hold across', () => {
  it('is exactly the set listed here — a new member goes red until it is driven too', () => {
    expect(discoverFamily()).toEqual(Object.keys(FAMILY).sort());
  });

  it('includes the alias face, which declares neither the flag nor the import', () => {
    // Guards the alias half specifically: a discovery that regressed to
    // "grep the module" would still pass the reconciliation above only by
    // ALSO dropping `build` from FAMILY, and this makes that a second red.
    expect(discoverFamily()).toContain('build');
  });
});

describe.each(cases())('os %s --json, config missing', (key) => {
  const runOf = () => {
    const run = runs.find((r) => r.key === key);
    if (!run) throw new Error(`no run captured for '${key}'`);
    return run;
  };

  it('leaves nothing on stdout that a machine cannot read', () => {
    const run = runOf();
    // Under the defect this was 206 bytes of `  ✗ Config file not found: …`
    // plus two hint lines — on the one stream `--json` reserves for the
    // machine, with stderr completely empty.
    expect(stdoutIsMachineReadable(run.stdout)).toBe(true);
  });

  it('keeps the human refusal off stdout entirely', () => {
    const run = runOf();
    // Asserted separately from the parse so a regression names its cause
    // rather than only `Unexpected token`.
    expect(run.stdout).not.toContain(REFUSAL.explicit);
    expect(run.stdout).not.toContain(REFUSAL.auto);
    expect(run.stdout).not.toContain('Hint:');
  });

  it('still shows the operator the refusal — on stderr', () => {
    const run = runOf();
    // Diagnostics are MOVED, never destroyed: a regression toward silencing
    // this path goes red here.
    const expected = key.endsWith('(auto-detect)') ? REFUSAL.auto : REFUSAL.explicit;
    expect(run.stderr).toContain(expected);
    expect(run.stderr).toContain('Hint:');
  });

  it('still exits 1', () => {
    expect(runOf().code).toBe(1);
  });
});
