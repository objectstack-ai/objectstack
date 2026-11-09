// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One agent process per turn, shared by every live driver (`claude`, `codex`,
 * `external:`): the input written to its stdin, its stdout kept whole, the end
 * of its stderr, how it ended. Internal to the runner: `runner/index.ts` does
 * not re-export it.
 */

import { spawn } from 'node:child_process';

import type { TurnProcess } from '../transcript.js';

export interface TurnProcessRun {
  stdout: string;
  process: TurnProcess;
}

const STDERR_TAIL = 2000;

/**
 * One process, `input` written to its stdin. A prompt never travels on argv:
 * a build prompt carries the card's whole seed, and on Linux one argument
 * longer than 128 KiB (`MAX_ARG_STRLEN`) makes `spawn` throw `E2BIG` before
 * the process starts — the two largest cards' build prompts are past it.
 *
 * Never rejects: a process that could not start, was killed by the timeout or
 * exited without a result is answered with what was seen of it, so the turn
 * it belongs to is recorded rather than lost.
 */
export function runTurnProcess(bin: string, args: readonly string[], opts: { cwd: string; input: string; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<TurnProcessRun> {
  const { cwd, input, timeoutMs, env } = opts;
  return new Promise((resolvePromise) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let error: string | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (exit: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const tail = stderr.trim().slice(-STDERR_TAIL);
      resolvePromise({
        stdout,
        process: {
          elapsedMs: Date.now() - started,
          exit,
          ...(signal ? { signal } : {}),
          timedOut,
          timeoutMs,
          ...(tail ? { stderrTail: tail } : {}),
          ...(error ? { error } : {}),
        },
      });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e); // `spawn E2BIG` and its kin throw here
      settle(null, null);
      return;
    }
    child.stdout!.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => {
      error ??= e.message; // `spawn ENOENT`: no `close` may follow
      if (child.pid === undefined) settle(null, null);
    });
    child.stdin!.on('error', (e) => (error ??= e.message)); // EPIPE: the process exited before reading its input
    child.stdin!.end(input);
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (exit, signal) => settle(exit, signal));
  });
}

/**
 * `no-result(exit 143)`, `no-result(signal SIGTERM)`, `no-result(spawn E2BIG)`:
 * a turn that printed no result, by how its process ended — or, when no
 * process ever ran, why.
 */
export const noResult = (p: TurnProcess): string =>
  `no-result(${p.exit !== null ? `exit ${p.exit}` : p.signal ? `signal ${p.signal}` : (p.error ?? 'no exit code, no signal')})`;

/** A tool result's content as the text the model was given: text blocks joined, anything else as it came. */
export function contentText(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && !Array.isArray(c))
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
    if (texts.length === content.length) return texts.join('\n');
    return content;
  }
  return content;
}
