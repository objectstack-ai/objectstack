---
---

test(lint): give the lazy-deps dist probes the same cold-load timeout as their sibling (#3662)

The two dist probes in `lazy-deps.test.ts` spawn a child `node` that cold-loads
sucrase (~1.5 MB) and typescript (~9 MB) to prove neither arrives at import time.
That cold load alone exceeds vitest's default 5s timeout under a whole-repo
`pnpm test` (dozens of parallel turbo tasks), so the ESM probe was observed
failing at 5928ms on `execFileSync` — pure latency, not a contract failure. The
in-process sibling already carried an explicit 30s timeout; hoisted that rationale
into one named `COLD_LOAD_TIMEOUT_MS` shared by all three cold-loading cases.
Test-only flake fix; releases nothing.
