---
'@objectstack/mcp': patch
---

feat(mcp): `read_file` bounds PDF and Word text extraction with a per-file CPU-time budget and a process-wide concurrency cap, both set by the host (#31826)

Clause-②: yes — `read_file` gains a new truncated answer (out of CPU budget) and a new retryable refusal (over the concurrency cap) on a door that used to answer every file within its caps in full. Not `(narrowing)`: no input it accepted is now refused for good; the refusal is transient and retryable, the truncated answer is the shape the door already serves at its length and page caps, and under the defaults every file within those caps reads as before.
Metadata-protocol: none

PDF and Word extraction runs on the request thread, so while one runs every other request in the process waits: a 9 MiB, 200-page PDF dense in drawing operators measured about 300 to 650 ms of CPU, during which a 1 ms timer never fired once. Two host settings now bound it:

- **`OS_MCP_READ_FILE_CPU_BUDGET_MS`** (default `2000`): the CPU time one extraction may use, read as process CPU time (`process.cpuUsage()` deltas, as ADR-0102 D1 meters sandboxed scripts). It is checked between PDF pages and between Word paragraphs (every 64), never mid-page; the Word body's one inflate stays bounded by its existing 32 MiB cap. Out of budget, the answer is the text read so far, `truncated: true`, and a `note` naming the budget and the page or paragraph it stopped after, pointing at the download link the answer already carries.
- **`OS_MCP_READ_FILE_MAX_CONCURRENT`** (default `4`): how many PDF and Word extractions may run at once in the process. One more is refused at once, never queued, as a coded tool error: `SERVICE_UNAVAILABLE` (503), "try again in about N seconds", with `details.retryAfterSeconds`. Text files and images are not counted.

Both are read once when the MCP plugin initialises; a value that is not a positive integer fails the boot with a message naming the variable. Unset, the defaults apply. Moving extraction off the request thread is a separate change.
