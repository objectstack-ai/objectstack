---
'@objectstack/cli': minor
'@objectstack/core': minor
'@objectstack/spec': patch
---

`os test` reports the suite and scenario names an author writes, and selects scenarios with `--tags` (#20289)

Clause-②: no

A Quality Protocol suite's `name`, each scenario's `name` and `description`, and scenario `tags` were parsed at load and then read by nothing: the report headed each suite with its file's basename, printed every scenario by its `id`, and `os test --tags critical` failed with `Nonexistent flag: --tags`.

- **Names in the report.** The suite heading is now the suite's `name` followed by its file — `📄 Running suite: Accounts smoke (accounts.test.json)` — and each scenario line is its `name` with the `id` in brackets — `✅ Scenario: An account can be created [acct-create] (12ms)` (the id alone when the two are equal). A failed scenario's `description` is printed under its line, before the error. A suite whose file fails to load is still headed by the file alone, since no name was parsed.
- **`--tags TAG[,TAG...]`** runs only the scenarios carrying AT LEAST ONE of the listed tags (any-of, exact, case-sensitive) — the comma-list reading of Odoo's `--test-tags` and the everyday use of Playwright's `--grep @a|@b`. With the flag, an untagged scenario is left out. Left-out scenarios are **deselected**: not run, counted on the summary (`--tags smoke selected 1 of 4 scenarios; 3 deselected (not run, not counted as passed).`), never counted as passed. A requested tag that no loaded scenario carries is named on the summary. An empty entry (`--tags smoke,`) is refused before anything runs. Without the flag nothing changes: every scenario runs.
- **Exit status.** A selection that matches no scenario takes the posture an empty pattern already has: exit `0` with `No scenario matched --tags …`, and exit `1` under `--fail-on-empty`, whose description now covers both cases. The `Found N test suites.` line and the `SUCCESS: All N scenarios passed.` / `FAILED: …` summary lines keep their spelling.
- **`@objectstack/core`:** `QA.TestResult` gains `scenarioName` and `description` on every result, and `suiteName` on every result `runSuite` produces (absent only from a lone `runScenario` call, which has no suite).
- **`@objectstack/spec`:** the liveness ledger (`liveness/qa.json`) moves the four keys above to `live`, citing their readers. `TestScenario.requires`, the family's fifth key, is checked in this same release and has its own note: an unmet `params` or `services` entry skips the scenario with its reason, and `requires.plugins` is retired into `requires.services`.
