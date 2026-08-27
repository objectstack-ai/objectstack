---
"@objectstack/spec": patch
---

build(spec): bound the DTS pass's heap ceiling to something the build container actually has (#12677)

The DTS pass ran under `NODE_OPTIONS="--max-old-space-size=12288"`. A heap
ceiling is a promise to V8 that the memory exists: below it, V8 defers major GCs
and lets the resident set grow. A ceiling **above** the container's memory does
not permit a bigger build — it converts a recoverable JS heap error into a
kernel SIGKILL, because the process meets the container limit long before V8
considers the ceiling reached, and `exit 137` carries no diagnostic.

That is what took the docs site down: every `objectstack.ai` production deploy
since 2026-08-25 died with `@objectstack/spec:build` exit 137. Vercel builds the
docs app with `turbo run build --filter=@objectstack/docs` inside one
fixed-memory container, and this package is that app's only workspace
dependency — so this pass met the container limit alone.

The ceiling is now `6144`. Measured on this package's DTS pass inside a cgroup
capped at 8192 MB, as peak anonymous RSS of the whole process tree:

| ceiling | result | peak RSS | wall |
|---|---|---|---|
| 12288 (before) | ok, ~0.9 GB spare | 7290 MB | 132s |
| 6144 (after) | ok, ~2.3 GB spare | 5794 MB | 134s |
| 5120 | ok | 5328 MB | 148s |
| 4096 | `ERR_WORKER_OUT_OF_MEMORY` | — | 113s |

No output change: every completing ceiling emitted a byte-identical declaration
tree (122 files, compared as one sha256 over all of them). The number buys
headroom and costs GC time, not build time.

Should the live type graph ever outgrow `6144`, the pass now fails **loud**
with `ERR_WORKER_OUT_OF_MEMORY` instead of being killed silently. Raising the
number past what the build container has would trade that diagnostic back for
`exit 137`.
