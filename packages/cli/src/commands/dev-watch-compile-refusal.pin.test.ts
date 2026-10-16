// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#23820) — when a watched save makes `compile` refuse, `os dev`'s watcher
 * prints WHY, without `--verbose`.
 *
 * Measured before the fix on a fresh `os init my-app -t app` scaffold (namespace
 * `my_app`), saving an object named `task`: the refused compile exited 2 with
 * 10 lines on stdout — the refusal among them — and 0 bytes on stderr, while the
 * watcher spawned it with stdout ignored and printed stderr only:
 *
 * ```
 *   ↻ recompiling (2 files)...
 *   ✗ compile failed (3782ms)
 * ```
 *
 * `compile` writes its text face, refusals included, to stdout (`printError`;
 * `utils/format.ts` states that convention for a command rendering its own text
 * face), so the fix is on the watcher's side: it captures both streams and
 * prints them on a non-zero exit.
 *
 * ## The instrument
 *
 * The REAL `compileAndPing` runs: `startWatchRecompile` is driven with only
 * chokidar faked (a watcher whose handlers the test fires), so the spawn, its
 * stdio and the printed lines are the shipped code's. `binPath` names a fixture
 * script in place of the CLI entry, so each case controls exactly what "the
 * compile" writes and to which stream — the refusal lives in the fixture, and
 * ⛔ no sentence of the CLI's own refusal prose is pinned here.
 *
 * Every fixture records `fstat` of its fd 1 and fd 2 before writing anything.
 * That is how the `--verbose` control is OBSERVED rather than read off the
 * spawn options: an inherited stream is the test process's own (same device and
 * inode), a captured one is a fresh pipe.
 *
 * A spawned fixture blocks this process until it exits, and `compileAndPing`
 * prints synchronously after `spawnSync` returns — so once the fixture's record
 * exists on disk, every line this recompile prints has been printed.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

type Handler = (filePath: string) => void;
interface FakeWatcher {
  handlers: Map<string, Handler>;
  on(event: string, cb: Handler): FakeWatcher;
  close(): Promise<void>;
}

const fake = vi.hoisted(() => ({ watchers: [] as FakeWatcher[] }));

vi.mock('chokidar', () => ({
  default: {
    watch: () => {
      const w: FakeWatcher = {
        handlers: new Map(),
        on(event, cb) {
          w.handlers.set(event, cb);
          return w;
        },
        close: async () => {},
      };
      fake.watchers.push(w);
      return w;
    },
  },
}));

import Dev from './dev.js';

interface WatchOpts {
  cwd: string;
  configPath: string;
  artifactPath: string;
  binPath: string;
  verbose?: boolean;
  autoRestart: boolean;
  onRebuildLanded?: (label: string) => void;
}

// The private method is the unit under test; its body never reads `this`.
const startWatchRecompile = (opts: WatchOpts): void =>
  (Dev.prototype as unknown as { startWatchRecompile(o: WatchOpts): void }).startWatchRecompile(opts);

/** What a refused compile writes, in the shape the measured one did: header, progress, refusal. */
const REFUSAL = "FIXTURE-REFUSAL: Object 'task' is missing the package namespace prefix (fixture text)";
const REFUSED_STDOUT = [
  '',
  '◆ Compile',
  '─'.repeat(40),
  '  → Loading configuration...',
  '',
  `  ✗ ${REFUSAL}`,
  '',
  'FIXTURE-REFUSAL-TAIL: a second paragraph of the same refusal',
  '',
].join('\n');
const STDERR_LINE = '  ⚠ FIXTURE-STDERR: a line the compile wrote to stderr';
const PROGRESS = '  → FIXTURE-PROGRESS: Writing artifact...';

/**
 * A stand-in for `bin/run.js`, invoked as `node <fixture> compile --output <artifact>`.
 * It writes `<artifact>.stdio.json` first (fd 1 / fd 2 identity), then performs `mode`.
 */
function fixtureSource(mode: 'refuse-stdout' | 'refuse-both' | 'succeed'): string {
  return `
import { fstatSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const out = process.argv[process.argv.indexOf('--output') + 1];
mkdirSync(dirname(out), { recursive: true });
const id = (fd) => { const s = fstatSync(fd); return { dev: s.dev, ino: s.ino }; };
writeFileSync(out + '.stdio.json', JSON.stringify({ argv: process.argv.slice(2), fd1: id(1), fd2: id(2) }));
const mode = ${JSON.stringify(mode)};
if (mode === 'succeed') {
  process.stdout.write(${JSON.stringify(PROGRESS + '\n')});
  writeFileSync(out, '{}');
  process.exit(0);
}
process.stdout.write(${JSON.stringify(REFUSED_STDOUT)});
if (mode === 'refuse-both') {
  process.stderr.write(${JSON.stringify(STDERR_LINE + '\n')});
  process.exit(1);
}
process.exit(2);
`;
}

let root: string;
const fixtures: Record<string, string> = {};
let caseNo = 0;
let sigintBaseline: unknown[] = [];
let sigtermBaseline: unknown[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-dev-watch-refusal-'));
  for (const mode of ['refuse-stdout', 'refuse-both', 'succeed'] as const) {
    fixtures[mode] = join(root, `${mode}.mjs`);
    writeFileSync(fixtures[mode], fixtureSource(mode));
  }
  sigintBaseline = process.listeners('SIGINT');
  sigtermBaseline = process.listeners('SIGTERM');
});

afterEach(() => {
  vi.restoreAllMocks();
  // `startWatchRecompile` registers SIGINT/SIGTERM handlers to close its watcher.
  for (const l of process.listeners('SIGINT')) {
    if (!sigintBaseline.includes(l)) process.removeListener('SIGINT', l);
  }
  for (const l of process.listeners('SIGTERM')) {
    if (!sigtermBaseline.includes(l)) process.removeListener('SIGTERM', l);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface StdioRecord {
  argv: string[];
  fd1: { dev: number; ino: number };
  fd2: { dev: number; ino: number };
}

/** One save, one recompile: everything the watcher printed for it, plus the fixture's record. */
async function recompileOnce(
  mode: keyof typeof fixtures,
  { verbose = false }: { verbose?: boolean } = {},
): Promise<{ printed: string[]; landed: string[]; stdio: StdioRecord }> {
  const cwd = join(root, `case-${++caseNo}`);
  mkdirSync(join(cwd, 'src', 'objects'), { recursive: true });
  const configPath = join(cwd, 'objectstack.config.ts');
  writeFileSync(configPath, 'export default {};\n');
  const artifactPath = join(cwd, 'dist', 'objectstack.json');

  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(stripVTControlCharacters(args.map(String).join(' ')));
  });
  const landed: string[] = [];

  const before = fake.watchers.length;
  startWatchRecompile({
    cwd,
    configPath,
    artifactPath,
    binPath: fixtures[mode],
    verbose,
    autoRestart: true,
    onRebuildLanded: (label) => landed.push(label),
  });
  await vi.waitFor(() => expect(fake.watchers[before]?.handlers.has('change')).toBe(true));
  fake.watchers[before].handlers.get('change')!(join(cwd, 'src', 'objects', 'task.object.ts'));

  const record = `${artifactPath}.stdio.json`;
  await vi.waitFor(() => expect(existsSync(record), `fixture ${mode} never ran`).toBe(true), {
    timeout: 20_000,
    interval: 50,
  });
  return { printed, landed, stdio: JSON.parse(readFileSync(record, 'utf8')) as StdioRecord };
}

const own = (fd: number) => {
  const s = fstatSync(fd);
  return { dev: s.dev, ino: s.ino };
};

/** The fixture's stdout as the watcher relays it: leading blank lines and trailing whitespace dropped. */
const relayed = (text: string) => text.replace(/^\s*\n/, '').trimEnd();

describe('os dev watcher: a refused recompile shows the refusal (#23820)', () => {
  it('relays a refusal the compile wrote to STDOUT, on the failure line, without --verbose', async () => {
    const { printed, landed, stdio } = await recompileOnce('refuse-stdout');
    const told = printed.join('\n---\n');

    // The fixture really was invoked the way the CLI entry is.
    expect(stdio.argv.slice(0, 2)).toEqual(['compile', '--output']);
    // Captured, not inherited: the child's stdout was a pipe of its own.
    expect(stdio.fd1, told).not.toEqual(own(1));

    // Two lines for one recompile — "recompiling", then the failure line — and
    // the failure line carries the compile's whole stdout, in order.
    expect(printed, told).toHaveLength(2);
    expect(printed[1], told).toContain(REFUSAL);
    expect(printed[1].endsWith(relayed(REFUSED_STDOUT)), told).toBe(true);
    // A refused compile lands nothing: no restart is requested.
    expect(landed).toEqual([]);
  });

  it('relays stderr too — stdout first, then stderr — on a non-zero exit', async () => {
    const { printed, landed } = await recompileOnce('refuse-both');
    const told = printed.join('\n---\n');

    expect(printed, told).toHaveLength(2);
    const failure = printed[1];
    expect(failure, told).toContain(REFUSAL);
    expect(failure, told).toContain(STDERR_LINE.trim());
    expect(failure.indexOf(REFUSAL), told).toBeLessThan(failure.indexOf(STDERR_LINE.trim()));
    expect(landed).toEqual([]);
  });

  it('CONTROL: a successful recompile prints exactly what it printed before — the compile output stays discarded', async () => {
    const { printed, landed } = await recompileOnce('succeed');
    const told = printed.join('\n---\n');

    // "recompiling" and the success line, nothing else; the compile's own
    // progress output is not printed on success.
    expect(printed, told).toHaveLength(2);
    expect(told).not.toContain('FIXTURE-PROGRESS');
    expect(landed).toEqual(['src/objects/task.object.ts']);
  });

  it('CONTROL: --verbose still inherits both streams, and the failure line does not repeat what is already on screen', async () => {
    const { printed, landed, stdio } = await recompileOnce('refuse-both', { verbose: true });
    const told = printed.join('\n---\n');

    // Inherited: the child's fd 1 and fd 2 ARE this process's.
    expect(stdio.fd1, told).toEqual(own(1));
    expect(stdio.fd2, told).toEqual(own(2));

    expect(printed, told).toHaveLength(2);
    expect(printed[1], told).not.toContain(REFUSAL);
    expect(printed[1], told).not.toContain('FIXTURE-STDERR');
    expect(landed).toEqual([]);
  });
});
