---
"@objectstack/cli": patch
---

fix(cli): `os doctor` no longer treats a broken `@objectstack/cloud-connection` install as "not installed" (#5644)

`readInstalledPackageEntries()` reached the installed-package ledger through a
dynamic `import('@objectstack/cloud-connection')` whose `catch` meant "the
optional package is not installed". That is right for one of the two things it
caught:

- **The specifier does not resolve** — the optional package really is not
  there. Silence is correct and unchanged: `os doctor` must run to completion in
  a checkout that never had it.
- **The package is installed and will not load** — a pruned or unbuilt `dist/`,
  an interrupted install, an artefact that throws while it evaluates, a
  transitive dependency missing under it. It threw too, so it was answered with
  the same silence.

The ADR-0120 D5e unique-scope advisory then saw "no installed packages", found
nothing to report, and the run printed:

```
  ✓ Unique scope          No unconfirmed installation-wide uniques for this 'isolated' environment
```

Measured: with the package present-but-unloadable and a ledger declaring an
installation-wide `unique`, that line was printed and the finding appeared
nowhere, `--verbose` included. It is the same false PASS #5412 removed at the
`readdir` boundary and #5413 at the entry boundary, one boundary further up —
and `os serve`, loading the same package in the same directory, has always named
the failure out loud.

The two states are now separated by **resolution**, not by the `import()` having
thrown (`isModuleNotFoundError()` first — an error that is not a module-not-found
error came from the package itself, so it is present by definition; then
`import.meta.resolve()`, which answers "is the package there" without stating its
entry file, unlike `createRequire().resolve()`). Only the genuinely-absent half
is silent. The other prints an ordinary `HealthCheckResult` through the same
renderer every other check uses:

```
  ⚠ Unique scope          Could not load the installed-package ledger reader (installed packages
                          NOT checked for installation-wide uniques) — Cannot find module …
```

**Warning, not error**, and the exit code is unchanged, matching its two
siblings: the environment still runs; what broke is doctor's ability to see part
of it. The cause is quoted from the thrower, and `--verbose` expands it together
with the remedy — reinstall, or build the package in a monorepo checkout.

The row is **not** conditional on `.objectstack/installed-packages/` existing.
Doctor cannot honestly say a ledger is absent when the constant naming the
ledger's location is an export of the package that would not load.

One consequence worth stating: in a monorepo checkout where
`packages/cloud-connection` has not been built, `os doctor` under the `isolated`
posture now prints this warning instead of a clean bill. That state is exactly
what sent #5612 chasing a report face that had never regressed.
