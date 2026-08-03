---
---

ci(deps): lift the `brace-expansion` pin to 5.0.9 so `Validate Package Dependencies` stops failing on every PR (#4945)

`GHSA-rgw5-rvv9-x895` (7.5 high) affects `brace-expansion` 5.0.8 — which is
exactly the version the previous pin (`brace-expansion@>=5.0.0 <5.0.8: ^5.0.8`,
added for `GHSA-mh99-v99m-4gvg`) had settled on. The OSV-Scanner step in
`.github/workflows/validate-deps.yml` reads `pnpm-lock.yaml` directly and exits
non-zero on any match, so the job was red on `main` itself and attached that red
to every PR that touched a manifest or the lockfile, whatever the PR contained
(observed on #4944, which never touched `pnpm-lock.yaml`).

The `pnpm-workspace.yaml` override bound moves to `<5.0.9` / `^5.0.9`. It stays a
transitive-only pin — nothing declares `brace-expansion` directly; it arrives via
`minimatch` (ts-morph, eslint, `@typescript-eslint`, glob, `@vscode/vsce`,
archiver), so no published manifest changes and `check-override-consistency`
still has nothing to reconcile. 5.0.8 disappears from the lockfile entirely; the
three `minimatch` snapshots that referenced it now resolve 5.0.9.

The reason to fix this on its own rather than let it ride along with the next
dependency PR is the one the issue names: a permanently red required check
trains everyone to scroll past it, and the next real advisory will look exactly
like this one in the PR list.

Lockfile and override metadata only; releases nothing.
