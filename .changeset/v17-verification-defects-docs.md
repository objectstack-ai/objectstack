---
---

docs+test: v17 verification defects — ReDoS assertion load-insensitivity, doc drift (#4485, #4476, #4486, #4452)

Release-nothing: touches only `.md`/`.mdx` prose and one `.test.ts` file. No
package source, no public export, no protocol change — so no package needs a
version bump.

- **#4485** `protocol-handshake.test.ts` — the ReDoS guard bounded the
  pathological scan with an absolute 50ms wall clock, which measures machine
  load rather than the parser: under the full-repo run (~130 parallel turbo
  tasks) it exceeded 50ms on a healthy tree and reddened PRs that never touched
  `@objectstack/metadata-core`. The behavioural assertions are kept; the
  wall-clock proxy is replaced by a scaling check (same adversarial shapes at 1x
  and 8x length), so load largely cancels out of the ratio.
- **#4476** Seventeen passages dated the v17 query-surface removals to
  `@objectstack/spec` 18. They ship in 17; `spec-changes.json` gives
  `toMajor: 17`.
- **#4486** The `IDataEngine` doc block dropped the trailing
  `options?: BaseEngineOptions` from all four read methods — the very parameter
  #4251 added, against a failure mode that raises no error.
- **#4452** `service-automation`'s README taught a flow DSL that never existed
  (node type names, interpolation dialect, and nested `steps` all wrong);
  rewritten from the schemas and executors. README only — no package code.
