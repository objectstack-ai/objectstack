---
"@objectstack/cli": patch
---

fix(cli): `os doctor` no longer prints `✓ Unique scope` when it could not read the installed-package ledger (#5412)

`readInstalledPackageEntries()` wrapped two unrelated facts in one un-bound
`catch` and returned an empty entry list for both:

- **`@objectstack/cloud-connection` does not resolve** — the optional package is
  not installed. Silence is correct here and stays: `os doctor` must run to
  completion in a checkout that never had it.
- **The ledger directory exists and could not be read** — `fs.existsSync()` had
  already confirmed the directory is there, and producing its entry list threw
  (the path is occupied by a file, the filesystem refused, the read failed).

The second was handled as the first. It reached the ADR-0120 D5e unique-scope
advisory as "no installed packages", the advisory found nothing to report, and
the run printed:

```
  ✓ Unique scope          No unconfirmed installation-wide uniques for this 'isolated' environment
```

So an environment **with** installed packages, whose ledger doctor could not
read, got a clean bill of health for the one constraint the `isolated` posture
makes dangerous. That is worse than a missing check: a false PASS is what stops
an operator looking further.

The two are now separate. The `import()` failure keeps its own silent `catch`;
a ledger read failure comes back as a cause the caller can report, and the
success line is withheld — it is a claim about **both** halves of the advisory
(this project's metadata, and the manifests of installed packages), so it may
only be printed when both halves ran. In its place doctor prints an ordinary
`HealthCheckResult` through the same renderer every other check uses:

```
  ⚠ Unique scope          Could not read the installed-package ledger (installed packages NOT
                          checked for installation-wide uniques) — ENOTDIR: not a directory, …
```

**Warning, not error**, and the exit code is unchanged: the environment still
runs; what broke is doctor's ability to see part of it. The cause is quoted from
the thrower rather than paraphrased, and `--verbose` expands the untruncated
original plus which half of the check did not run — both free from reusing
`renderHealthCheckResult()`.

Findings from the half that **did** run are still reported: a ledger failure
does not swallow the uniques this project's own metadata declares.

**Not covered by this change**: a single *corrupt entry* inside an otherwise
readable ledger. `LocalManifestSource.list()` skips unparseable files in its own
per-file `catch`, so a truncated manifest is dropped inside the producer and the
call succeeds with a short list that no consumer can distinguish from a complete
one. Fixing that is a change to `@objectstack/cloud-connection`'s own contract
and is tracked separately; the boundary is pinned by a test so it is not
mistaken for covered.
