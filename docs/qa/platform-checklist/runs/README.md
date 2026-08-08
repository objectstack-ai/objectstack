# Run records — format contract (results are NOT committed)

A **run record** is one execution of the checklist against one build: per-clause
verdicts + evidence pointers. It is **output, not source** — a transient assertion
about a specific build, not part of the version-controlled contract. Run records and
their evidence (screenshots, network traces) are therefore **git-ignored** and never
land in the repo (`.gitignore` here tracks only this README). The durable source is
the checklist itself under `../areas/`; a run is a snapshot that goes stale the moment
the build moves.

**Where results go instead — the canonical home is one tracking issue per release
sweep** (a `[sweep] vN release test sweep` issue, successor to the #3358 model):

- the issue **body** hosts the human-readable summary — the per-item verdict table
  (pass / partial / fail / blocked) and the filter that selected them (`since:vN` ∪ all
  `P0` ∪ items whose `source` cites a release PR);
- the machine **run-record JSON(s)** (shape below) attach to that issue — pasted in a
  comment or linked as a CI artifact from the sweep job;
- every `fail` becomes its **own linked issue** (RUNNER.md makes a filed issue part of a
  completed `fail` verdict), cross-referenced from the sweep issue.

A raw CI artifact or an external QA store is a fine substitute where one exists, but the
per-release tracking issue is the default so a sweep is never lost. What NEVER lands in
the repo is the record itself — only the durable ledger under `../areas/` accumulates
here, through each item's `revision`/`history`. A verdict is interpretable only next to
the `revision` it names, so the run record stays with its build's artifacts, not in git.

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
