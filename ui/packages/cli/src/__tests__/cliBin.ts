/**
 * The harness shared by the two files that drive the built `dist/cli.js`:
 * `cli-bin.surface.test.ts` (commands, flags and help text) and
 * `cli-bin.test.ts` (commands that write, refuse or validate).
 *
 * The files were one until objectstack#25911 split them so the 48 serial CLI
 * spawns run on two workers. Both still need the same build, so
 * `ensureCliBuilt` takes one lock before it builds. The second file to arrive
 * waits for the first build and then finds `dist/` present, instead of
 * building again into the same directory at the same time.
 *
 * ⚠️ The build spawns themselves stay in the test files, and so does each
 * file's `BUILD_ENV`. `scripts/__tests__/spawned-build-vitest-env-8598.test.ts`
 * finds build spawns only in test files, and resolves `env:` only within the
 * file that spawns. A spawn moved here would leave that gate's population
 * without either member.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CLI_BIN = resolve(__dirname, '../../dist/cli.js');
export const PKG_PATH = resolve(__dirname, '../../package.json');
/** This package's root: the cwd of its own `pnpm run build`. */
export const PKG_ROOT = resolve(__dirname, '../..');
/** The ui workspace root: the cwd of `pnpm --filter @object-ui/types run build`. */
export const REPO_ROOT = resolve(__dirname, '../../../..');
const TYPES_ZOD = resolve(__dirname, '../../../types/dist/zod/index.zod.js');

export function run(args: string[], opts: { cwd?: string } = {}) {
  const res = spawnSync('node', [CLI_BIN, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    encoding: 'utf-8',
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/** Every path under `dir`, `/`-separated and sorted: what a run wrote there. */
export function tree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => p.split(sep).join('/'))
    .sort();
}

/**
 * The two builds a cold tree needs. Each test file supplies them with its own
 * `BUILD_ENV`, for the gate reason in this file's header.
 */
export interface CliBuildSpawns {
  readonly types: () => SpawnSyncReturns<string>;
  readonly cli: () => SpawnSyncReturns<string>;
}

/**
 * The lock is a directory, because `mkdirSync` creates one atomically or
 * throws `EEXIST`. It lives under the OS temp directory and is keyed by this
 * package's path, so it never shows in the working tree and two checkouts
 * never share one. The holder writes its pid into it.
 */
const LOCK_DIR = join(
  tmpdir(),
  `objectui-cli-bin-build-${createHash('sha1').update(PKG_ROOT).digest('hex').slice(0, 12)}.lock`,
);
const LOCK_PID_FILE = 'pid';
/** Under the 180 s hook timeout, so a wait that runs out reports why. */
const LOCK_WAIT_MS = 170_000;
/**
 * The fallback for a lock whose pid cannot be read (its holder died between
 * the mkdir and the write): older than any build means nobody holds it.
 */
const LOCK_STALE_MS = 10 * 60_000;

/** Where the lock is and how long to wait for it. The tests drive both. */
export interface BuildLockOptions {
  readonly lockDir?: string;
  readonly waitMs?: number;
}

/** `kill(pid, 0)` sends nothing: ESRCH means no such process, EPERM one we may not signal. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The pid the holder wrote, or null when the file is missing or unreadable. */
function holderPid(lockDir: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(join(lockDir, LOCK_PID_FILE), 'utf-8'), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * A run killed while it held the lock (Ctrl-C, an OOM-killed worker) never
 * reaches the `finally` that removes it. A dead holder pid frees the lock at
 * once. Without a pid, only age does.
 */
function isAbandoned(lockDir: string): boolean {
  const pid = holderPid(lockDir);
  if (pid !== null) return !isAlive(pid);
  return Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS;
}

function withBuildLock(body: () => void, options: BuildLockOptions): void {
  const lockDir = options.lockDir ?? LOCK_DIR;
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, LOCK_PID_FILE), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try {
      if (isAbandoned(lockDir)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
    } catch {
      // Released between the mkdir and the stat: try again at once.
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${waitMs} ms waiting for the cli-bin build lock at ${lockDir}, held by ` +
          `pid ${holderPid(lockDir) ?? '(unreadable)'}. Another test file is building ` +
          '@object-ui/types or @object-ui/cli.',
      );
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  try {
    body();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/**
 * The CLI bin imports @object-ui/types/zod at runtime (validate command), so
 * both the CLI bundle AND the types package must be built before we invoke
 * `dist/cli.js` as a child process. `pnpm test:coverage` (root vitest) does
 * NOT trigger turbo's `^build` deps, so we self-build here to keep the tests
 * runnable from any entry point (CI coverage, CI turbo, local watch, fresh
 * clone).
 *
 * The presence checks run inside the lock, so a file that waited reads the
 * finished build rather than a `dist/` another file is still writing.
 */
export function ensureCliBuilt(spawns: CliBuildSpawns, options: BuildLockOptions = {}): void {
  withBuildLock(() => {
    if (!existsSync(TYPES_ZOD)) {
      const result = spawns.types();
      if (result.status !== 0 || !existsSync(TYPES_ZOD)) {
        throw new Error(
          `Failed to build @object-ui/types for tests.\n` +
            `Looked at: ${TYPES_ZOD}\n` +
            `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      }
    }

    if (!existsSync(CLI_BIN)) {
      const result = spawns.cli();
      if (result.status !== 0 || !existsSync(CLI_BIN)) {
        throw new Error(
          `Failed to build @object-ui/cli for tests.\n` +
            `Looked at: ${CLI_BIN}\n` +
            `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      }
    }
  }, options);
}
