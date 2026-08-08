# Run records — format contract (results are NOT committed)

A **run record** is one execution of the checklist against one build: per-clause
verdicts + evidence pointers. It is **output, not source** — a transient assertion
about a specific build, not part of the version-controlled contract. Run records and
their evidence (screenshots, network traces) are therefore **git-ignored** and never
land in the repo (`.gitignore` here tracks only this README). The durable source is
the checklist itself under `../areas/`; a run is a snapshot that goes stale the moment
the build moves.

**Where results go instead:** the executing environment — a CI artifact, the runner's
own workspace, the sweep's tracking issue, or an external QA store. Keep them there;
do not commit them.

## Record shape (write to `YYYY-MM-DD-<slug>.json`, kept out of git)

The shape and the verdict rules are defined in [../RUNNER.md](../RUNNER.md); verdicts
are only meaningful next to the item `revision` they ran against.

```jsonc
{
  "run": "2026-08-07-v17-release-sweep",
  "date": "2026-08-07",
  "scope": "since:v17 + P0",            // the filter that selected items
  "app": "showcase",
  "env": { "framework": "<sha>", "objectuiPin": "<sha>", "port": 3456, "db": "file:/tmp/<run>/data.db" },
  "runner": "<agent/session identifier>",
  "evidenceDir": "<local path — not committed>",
  "results": [
    {
      "id": "approvals.per-group-signoff",
      "revision": 1,                     // ← the revision this verdict is valid for
      "verdict": "pass",                 // derived: pass | partial | fail | blocked | not-run
      "clauses": [ { "clause": 0, "verdict": "pass", "evidence": "…what was captured, where…" } ],
      "issues": [],
      "notes": "…"
    }
  ]
}
```
