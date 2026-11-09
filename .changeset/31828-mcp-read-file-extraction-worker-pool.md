---
'@objectstack/mcp': patch
---

feat(mcp): `read_file` extracts PDF and Word text on a bounded worker-thread pool, so the server keeps answering other requests while a file is read (#31828)

Clause-②: no — every `read_file` answer keeps its shape byte for byte: the same text, the same truncated answer and note at the CPU budget, the same retryable over-cap refusal. No new refusal, key or setting.
Metadata-protocol: none

PDF and Word extraction used to run on the request thread: while a 9 MiB, 200-page PDF was read (about 300 ms), a 1 ms timer in the same process fired 0 times. It now runs on a pool of `worker_threads` workers, and the same timer fires about 9 times in 10 (228 to 296 ticks over 248 to 332 ms, both builds).

- **One knob.** The pool's size is `OS_MCP_READ_FILE_MAX_CONCURRENT` (default `4`). The over-cap refusal (`SERVICE_UNAVAILABLE`, 503, `details.retryAfterSeconds`) is decided on the request thread before any worker is touched, never queued, as before.
- **The CPU budget runs inside the worker** (`OS_MCP_READ_FILE_CPU_BUDGET_MS`, default `2000`), at the same checkpoints (between PDF pages, every 64 Word paragraphs), on the worker thread's own CPU time (`process.threadCpuUsage()`), so other requests' work no longer counts against a file.
- **A wall-clock backstop.** A worker that runs 5 budgets of wall time (10 s by default) without reaching a checkpoint is terminated and replaced. The answer is the pages it had already sent back, `truncated: true`, with the CPU-budget note. A worker that crashes is replaced and its call answers "The file's content could not be read".
- **Packaging.** `dist/` carries `file-extraction-worker.js` and `.cjs` beside `index`. A host that bundles `@objectstack/mcp` into one file, so the worker is not beside it, extracts in-process under the same budget and cap, and says so once at `warn` with the reason.
