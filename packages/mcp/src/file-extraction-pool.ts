// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { DocumentKind, ExtractedContent, ExtractionProgress } from './file-content.js';

/**
 * [#31828] The bounded `worker_threads` pool `read_file` extracts PDF and Word
 * text on, so the request thread keeps serving while a file is read (the
 * #31100 ruling, phase 2; ADR-0102 D1).
 *
 *  - **Size.** At most `poolSize` workers, which is the host's cap on
 *    extractions in flight (`OS_MCP_READ_FILE_MAX_CONCURRENT`): one knob. The
 *    cap itself is enforced by the caller, on the request thread, before a job
 *    reaches this module, so a job here always has a worker to run on.
 *    Workers start on demand and stay idle (unreferenced, so an idle pool
 *    never holds the process open) for the next job.
 *  - **Budget and ceiling.** The worker enforces the CPU budget at the
 *    extractor's checkpoints with its own thread's clock. This side holds a
 *    wall-clock ceiling per job: a worker past it is terminated and dropped,
 *    and the job answers `overrun` with the progress the worker had sent
 *    back, from which the caller answers the pages already read.
 *  - **Replacement.** A worker that overran, crashed or exited is never handed
 *    another job; the next job starts a fresh one. A crash fails only its own
 *    job (the promise rejects; `read_file` answers its could-not-read
 *    sentence).
 *  - **Unavailable.** When the worker entry cannot start (it is not beside
 *    this module, as in a host that bundled the package into one file, or it
 *    fails before it says it is ready), every job answers `unavailable` and
 *    the caller extracts in-process; said once at `warn`, with the reason.
 */

/** A job: one document's bytes, and its CPU budget in milliseconds. */
export interface ExtractionJob {
  kind: DocumentKind;
  bytes: Uint8Array;
  cpuBudgetMs: number;
}

/** What a job came to: the extractor's answer, the progress of a worker stopped at the ceiling, or no worker at all. */
export type ExtractionOutcome =
  | { status: 'done'; result: ExtractedContent }
  | { status: 'overrun'; progress: ExtractionProgress[] }
  | { status: 'unavailable'; reason: string };

/** The bounds a job runs under. */
export interface ExtractionPoolBounds {
  /** The most workers the pool keeps. */
  poolSize: number;
  /** Wall-clock milliseconds a job may run before its worker is terminated. */
  ceilingMs: number;
}

/** The worker entry to start, and the `execArgv` it starts with. */
export interface ExtractionWorkerEntry {
  url: URL;
  execArgv?: string[];
}

/** The messages a worker sends. */
export type ExtractionWorkerMessage =
  | { type: 'ready' }
  | { type: 'progress'; progress: ExtractionProgress }
  | { type: 'done'; result: ExtractedContent }
  | { type: 'failed'; message: string };

/** The message a worker receives. */
export type ExtractionWorkerRequest = ExtractionJob;

/**
 * The built worker entry beside this module: `file-extraction-worker.js`
 * beside `index.js`, `.cjs` beside `index.cjs` (the CJS build's
 * `import.meta.url` is tsup's `shims` rewrite). Anything else (the TypeScript
 * source under a test runner, a bundle with no `import.meta`) names why
 * there is none.
 */
function builtWorkerEntry(): ExtractionWorkerEntry | string {
  let here: string;
  try {
    here = import.meta.url;
  } catch {
    return 'this module has no import.meta.url to find the worker entry from';
  }
  if (typeof here !== 'string' || here === '') return 'this module has no import.meta.url to find the worker entry from';
  const ext = /\.(c?js|mjs)$/.exec(new URL(here).pathname)?.[0];
  if (!ext) return `this module runs from ${new URL(here).pathname}, not a built .js or .cjs file, so there is no built worker entry beside it`;
  const url = new URL(`./file-extraction-worker${ext}`, here);
  if (url.protocol === 'file:' && !existsSync(fileURLToPath(url))) {
    return `the worker entry ${fileURLToPath(url)} is not there (was @objectstack/mcp bundled into one file?)`;
  }
  return { url };
}

/**
 * How long a new worker may take to say it is ready: 10 s. Startup is not
 * charged to any job's budget (a built worker is ready in tens of
 * milliseconds); past this the entry counts as one that cannot start.
 */
const WORKER_START_TIMEOUT_MS = 10_000;

let entryOverride: ExtractionWorkerEntry | undefined;
let unavailableReason: string | undefined;
const idle: Worker[] = [];
let started = 0;

/**
 * Point the pool at another worker entry (or back at the built one), and
 * start it over: idle workers are terminated and a recorded "cannot start" is
 * forgotten. For tests, which run the TypeScript source through a loader.
 */
export function configureExtractionWorkerEntry(entry: ExtractionWorkerEntry | undefined): void {
  entryOverride = entry;
  resetExtractionWorkerPool();
}

/** Terminate the idle workers and forget a recorded "cannot start". */
export function resetExtractionWorkerPool(): void {
  for (const worker of idle.splice(0)) void worker.terminate();
  unavailableReason = undefined;
}

/** How many workers the pool has started, and how many sit idle. */
export function extractionWorkerPoolStats(): { started: number; idle: number } {
  return { started, idle: idle.length };
}

function markUnavailable(reason: string): ExtractionOutcome {
  if (unavailableReason === undefined) {
    unavailableReason = reason;
    console.warn(
      `[MCP] read_file extracts PDF and Word text on the request thread, not on a worker: ${reason}. `
      + 'The CPU budget and the cap on extractions in flight still apply.',
    );
  }
  return { status: 'unavailable', reason: unavailableReason };
}

/** A worker started and ready for a job, or the reason it could not start. */
function startWorker(): Promise<Worker | string> {
  const entry = entryOverride ?? builtWorkerEntry();
  if (typeof entry === 'string') return Promise.resolve(entry);
  let worker: Worker;
  try {
    // Anything a worker prints is a diagnostic: stdout is the protocol stream
    // on a stdio transport, so its stdout goes to stderr.
    worker = new Worker(entry.url, { execArgv: entry.execArgv, stdout: true });
  } catch (err) {
    return Promise.resolve(`the worker entry could not start: ${(err as Error)?.message ?? String(err)}`);
  }
  started++;
  worker.stdout.pipe(process.stderr, { end: false });
  // Between jobs nobody else listens: an idle worker's failure must not be an
  // unhandled 'error' event, and a worker that ended leaves the idle list.
  worker.on('error', () => {});
  worker.on('exit', () => {
    const at = idle.indexOf(worker);
    if (at >= 0) idle.splice(at, 1);
  });
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => finish(`the worker entry did not start within ${WORKER_START_TIMEOUT_MS} ms`),
      WORKER_START_TIMEOUT_MS,
    );
    const finish = (outcome: Worker | string) => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      if (typeof outcome === 'string') void worker.terminate();
      resolve(outcome);
    };
    const onMessage = (message: ExtractionWorkerMessage) => {
      if (message?.type === 'ready') finish(worker);
    };
    const onError = (err: Error) => finish(`the worker entry failed to start: ${err?.message ?? String(err)}`);
    const onExit = (code: number) => finish(`the worker entry exited (code ${code}) before it was ready`);
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
}

/** Hand a worker back to the pool, or end it when the pool is already full. */
function release(worker: Worker, poolSize: number): void {
  if (idle.length < poolSize) {
    worker.unref();
    idle.push(worker);
  } else {
    void worker.terminate();
  }
}

/** End a worker that overran or failed: it is never handed another job. */
function discard(worker: Worker): void {
  void worker.terminate();
}

/**
 * Run one extraction job on a pool worker. Resolves `done` with the
 * extractor's answer, `overrun` with the worker's progress when the ceiling
 * ended it, or `unavailable` when no worker can start here; rejects when the
 * worker crashed or its extractor threw.
 */
export async function runExtractionInWorker(job: ExtractionJob, bounds: ExtractionPoolBounds): Promise<ExtractionOutcome> {
  if (unavailableReason !== undefined) return { status: 'unavailable', reason: unavailableReason };
  let worker = idle.pop();
  if (!worker) {
    const startedWorker = await startWorker();
    if (typeof startedWorker === 'string') return markUnavailable(startedWorker);
    worker = startedWorker;
  }
  return runOn(worker, job, bounds);
}

function runOn(worker: Worker, job: ExtractionJob, bounds: ExtractionPoolBounds): Promise<ExtractionOutcome> {
  worker.ref();
  const progress: ExtractionProgress[] = [];
  return new Promise<ExtractionOutcome>((resolve, reject) => {
    const settle = (keep: boolean, outcome: () => void) => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      if (keep) release(worker, bounds.poolSize);
      else discard(worker);
      outcome();
    };
    const timer = setTimeout(() => {
      settle(false, () => resolve({ status: 'overrun', progress }));
    }, bounds.ceilingMs);
    const onMessage = (message: ExtractionWorkerMessage) => {
      if (message?.type === 'progress') progress.push(message.progress);
      else if (message?.type === 'done') settle(true, () => resolve({ status: 'done', result: message.result }));
      else if (message?.type === 'failed') settle(true, () => reject(new Error(`read_file extraction failed: ${message.message}`)));
    };
    const onError = (err: Error) => settle(false, () => reject(err));
    const onExit = (code: number) => settle(false, () => reject(new Error(`read_file extraction worker exited (code ${code})`)));
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    // The worker gets its own copy: the caller's bytes stay usable, and the
    // copy's buffer moves to the worker instead of being cloned again.
    const bytes = job.bytes.slice();
    const request: ExtractionWorkerRequest = { kind: job.kind, bytes, cpuBudgetMs: job.cpuBudgetMs };
    worker.postMessage(request, [bytes.buffer]);
  });
}
