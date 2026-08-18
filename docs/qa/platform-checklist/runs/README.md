# Run records — format contract (results are NOT committed)

A **run record** is one execution of the checklist against one build: per-clause
verdicts + evidence pointers. It is **output, not source** — a transient assertion
about a specific build, not part of the version-controlled contract. Run records and
their evidence (screenshots, network traces) are therefore **git-ignored** and never
land in the repo (`.gitignore` here tracks only this README). The durable source is
the checklist itself under `../areas/`; a run is a snapshot that goes stale the moment
the build moves.

**Where results go instead — every completed run files one `qa-run` GitHub issue** as its
durable, **text-only** report (pass or fail alike):

- the issue **body** hosts the per-clause verdict table (pass / partial / fail / blocked)
  and the scope — the selector that chose the items + the `revision` each ran against;
  [../RUNNER.md](../RUNNER.md) carries the body contract in full, and this line
  summarises only part of it;
- **every `fail` carries a reproduction rule** in that same issue — ordered steps / API
  calls (method · path · body) / the ref-targeted selector path + expected-vs-actual;
  the run issue itself stays `qa-run`-only (protocol carrier, excluded from the triage
  sweep) — at close-out each product defect is extracted into its own standalone card
  (RUNNER.md, extraction obligation), and that card is what triages;
  - **one exception — authentication and authorization findings.** Their reproduction is
    **never published on GitHub**: not in this record, not in the extracted card, not in
    a comment. Such a `fail` is still a completed verdict, and what it carries instead is
    [../RUNNER.md](../RUNNER.md) rule 2's carve-out — read it there before you write the
    record. This line is the flag that you are in that case; the rule itself is stated in
    one place only;
- **screenshots are never part of the report** — they are live judgment aids that die
  with the run environment, described in one line of text, never attached or linked.

For a release sweep, the per-run issues roll up under the sweep's `[sweep] vN release test
sweep` tracking issue (successor to the #3358 model) so a sweep is never lost. The machine
run-record JSON (shape below) is optional scratch in the executing environment (the
runner's workspace or a CI artifact) and is git-ignored — **do not commit it.** What NEVER
lands in the repo is the record itself; only the durable ledger under `../areas/`
accumulates here, through each item's `revision`/`history`, and a verdict is interpretable
only next to the `revision` it names.

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
      "clauses": [ { "clause": 0, "verdict": "pass", "evidence": "…text: what the oracle returned — no image links…" } ],
      "issues": [],
      "notes": "…"
    }
  ]
}
```
