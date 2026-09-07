---
"@objectstack/cli": patch
---

`os i18n extract --check --dry-run` now compares the bundles and reports what it found, instead of exiting 0 having compared nothing.

`--check` and `--dry-run` are both "write nothing" modes, so the pair reads as the safest spelling to put in CI — and it was the one spelling that measured nothing. The `--dry-run` branch returned before the `--check` block was reached, so the same tree that failed `--check` with `Translation bundles have drifted from the schema` reported success as soon as `--dry-run` was added to the command line. A check that cannot fail is indistinguishable from a check that finds nothing: the pipeline went green and nobody learned the bundles had drifted.

⚠️ **A pipeline running `--check --dry-run` against drifted bundles starts failing on this release, and that is the repair working.** The failure is not new — the drift it names was already there and the old exit code was wrong about it. The fix is the one `--check` has always printed: regenerate the bundles and commit them. Nothing else about the pair changes, and a tree that is in sync still exits 0, now with the `bundle(s) are in sync with the schema` line it never printed under `--dry-run` before.

- **What each flag contributes is unchanged.** `--dry-run` still prints the rendered modules to stdout, `--check` still compares them against what is committed in `--out`, and neither writes a file — on any path, including a bundle that is present but out of date, which keeps its bytes.
- **The `--out` advice no longer contradicts the command line it is printed on.** `Dry run — no files written (pass --out=<dir> to write)` was printed even to runs that had just passed `--out`, which reads as "your directory was ignored" when it had not been. A run with an `--out` now names the directory it did not write to; a run without one still gets the advice.
