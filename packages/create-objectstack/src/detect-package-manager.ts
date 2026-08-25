// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The package-manager probe, lifted out of index.ts so it can be tested
// without importing that module (which calls `program.parse()` at import
// time) and without spawning anything — the same reason pkg-utils.ts,
// rewrite-identity.ts and created-summary.ts live outside index.ts.
//
// WHY THE OUTCOME IS A RECORD AND NOT A BARE STRING
//
// The probe used to be `try { execSync('pnpm --version') } catch { return
// 'npm' }`, which collapses every failure mode into one answer. `npm` in the
// output then meant *the probe threw*, not *the code chose npm*, and nothing
// downstream — no log line, no assertion message — could tell the two apart.
//
// That is not only a diagnostics problem. `pnpm --version` resolves through
// Corepack, so it depends on the cwd it runs in: measured on one machine, one
// binary, two directories, `pnpm --version` answered 10.31.0 inside this repo
// (the pinned `packageManager`) and 10.33.0 outside it, where Corepack has to
// resolve — and may have to FETCH — a version nothing pinned. A user who has
// pnpm installed, on a slow or offline network, was silently told to run npm.
//
// So the decision and the reason are now separate values. The DECISION is
// byte-for-byte the old one — `pnpm` if the probe succeeds, `npm` otherwise —
// because which package manager actually runs is not a thing this change is
// entitled to move. Only the REASON is new, and it distinguishes the two
// cases that were collapsed:
//
//   probe: 'ok'      the probe succeeded            -> pnpm
//   probe: 'absent'  no pnpm on PATH at all         -> npm, a real choice
//   probe: 'failed'  pnpm IS on PATH, probe threw   -> npm, a FALLBACK
//
// Only 'failed' is new information, and only 'failed' prints anything extra:
// on every path that was already correct the output is unchanged.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export type PackageManagerDetection =
  | { pm: 'pnpm'; probe: 'ok' }
  | { pm: 'npm'; probe: 'absent' }
  | { pm: 'npm'; probe: 'failed'; detail: string };

/** The two ambient reads this module makes, injectable so tests can be hermetic. */
export interface DetectDeps {
  /** Runs the version probe. Returns normally on success, throws on any failure. */
  probe: () => void;
  /** Whether a `pnpm` executable is resolvable on PATH at all. */
  pnpmOnPath: () => boolean;
}

/**
 * Resolve an executable on PATH without spawning anything.
 *
 * Deliberately NOT a second subprocess: this runs only after the probe has
 * already failed, and a machine whose probe just failed is the last place to
 * spend another spawn. It also cannot change which package manager is chosen
 * — it feeds the reason field only — so a miss here degrades a warning's
 * wording and never the tool's behaviour.
 */
export function resolveOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PATH ?? '';
  if (!raw) return null;
  // PATHEXT is Windows' list of what counts as executable; pnpm ships there as
  // `pnpm.cmd`, so a bare-name check would miss it. Elsewhere the name is the
  // whole story.
  const exts = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Unreadable or missing entry — just not a hit.
      }
    }
  }
  return null;
}

/**
 * A one-line, log-safe description of why the probe threw.
 *
 * Order matters: a killed child reports its signal and no useful stderr, and a
 * child that never launched reports a libuv code and no status — so the most
 * specific evidence available is taken first and everything is flattened to a
 * single bounded line, because this ends up inside a console warning.
 */
export function probeFailureDetail(err: unknown): string {
  const e = (err ?? {}) as {
    signal?: string | null;
    status?: number | null;
    code?: string | number | null;
    stderr?: Buffer | string | null;
    message?: string;
  };
  if (e.signal) return `killed by ${e.signal}`;
  const stderr = e.stderr == null ? '' : String(e.stderr);
  const firstLine = stderr.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine) return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
  if (typeof e.code === 'string') return e.code;
  if (typeof e.status === 'number') return `exited ${e.status}`;
  const msg = (e.message ?? '').split('\n')[0]?.trim();
  return msg || 'unknown error';
}

/** The real probe: a read-only `pnpm --version`, silent on success and on failure. */
function defaultProbe(): void {
  // stdin/stdout ignored, stderr CAPTURED rather than ignored: execSync
  // attaches it to the thrown error, which is the only way the warning can
  // name what actually went wrong. An explicit triple keeps the child's
  // stderr off this process's stderr, so a run that succeeds — or one that
  // fails — still prints nothing except what this module chooses to print.
  execSync('pnpm --version', { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Decide which package manager this run should name, and why.
 *
 * The `pm` field is exactly the old function's return value. `probe` is the
 * new part, and is the only thing callers should branch on when deciding
 * whether to explain themselves to the user.
 */
export function detectPackageManager(deps: Partial<DetectDeps> = {}): PackageManagerDetection {
  const probe = deps.probe ?? defaultProbe;
  const pnpmOnPath = deps.pnpmOnPath ?? (() => resolveOnPath('pnpm') !== null);
  try {
    probe();
    return { pm: 'pnpm', probe: 'ok' };
  } catch (err) {
    // The decision is already made at this point and does not depend on
    // anything below: the probe threw, so it is npm either way. What follows
    // only chooses which of the two npm cases to report.
    if (!pnpmOnPath()) return { pm: 'npm', probe: 'absent' };
    return { pm: 'npm', probe: 'failed', detail: probeFailureDetail(err) };
  }
}
