// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';

import { extractDocument, type CpuBudget } from './file-content.js';
import type { ExtractionWorkerMessage, ExtractionWorkerRequest } from './file-extraction-pool.js';

/**
 * [#31828] The `read_file` extraction worker: one job at a time, a PDF's or a
 * Word document's text, read by the same extractors the in-process path runs
 * (`extractDocument`), so a worker's answer is the in-process answer.
 *
 *  - Each page (PDF) or each 64 paragraphs (Word) is sent back as it is read,
 *    so a worker the pool terminates at its wall-clock ceiling still answers
 *    what it had read.
 *  - The CPU budget is this THREAD's CPU time. `process.cpuUsage()` inside a
 *    worker counts the whole process (every other worker and the request
 *    thread), so it is `process.threadCpuUsage()` where this Node has it (the
 *    Node 22 line this was measured on does), and otherwise the worker's
 *    event-loop active time
 *    (`performance.eventLoopUtilization()`), which a worker that does nothing
 *    else spends only on this job.
 *  - An extractor that throws answers `failed` and the worker stays usable;
 *    `read_file` answers its could-not-read sentence, as in-process.
 *  - `unpdf` stays a dynamic import inside the extractor: the first PDF a
 *    worker reads loads it.
 */

/** This thread's CPU time, in milliseconds. */
const threadCpuMs: () => number =
  typeof process.threadCpuUsage === 'function'
    ? () => {
        const used = process.threadCpuUsage();
        return (used.user + used.system) / 1000;
      }
    : () => performance.eventLoopUtilization().active;

function startThreadCpuBudget(budgetMs: number): CpuBudget {
  const start = threadCpuMs();
  return {
    budgetMs,
    spent: () => threadCpuMs() - start >= budgetMs,
  };
}

const port = parentPort;
if (port) {
  const send = (message: ExtractionWorkerMessage) => port.postMessage(message);
  port.on('message', (job: ExtractionWorkerRequest) => {
    void (async () => {
      try {
        const result = await extractDocument(job.kind, job.bytes, startThreadCpuBudget(job.cpuBudgetMs), (progress) =>
          send({ type: 'progress', progress }),
        );
        send({ type: 'done', result });
      } catch (err) {
        send({ type: 'failed', message: (err as Error)?.message ?? String(err) });
      }
    })();
  });
  send({ type: 'ready' });
}
