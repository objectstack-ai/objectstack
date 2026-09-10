---
"@objectstack/plugin-email": patch
"@objectstack/plugin-hono-server": patch
---

Take the fix for the fifteen OSV advisories that turned `Validate Package Dependencies` red on every PR.

The advisory database moved; the lockfile did not. `origin/main`'s `pnpm-lock.yaml` is byte-identical to the tree that scanned GREEN the day before and RED the day after, so this is a repo-wide condition rather than any PR's regression, and every one of the fifteen names a published fix version — the take-the-fix path `osv-scanner.toml`'s header describes, not the exemption path. That ledger keeps its zero entries and is untouched here, as is `.github/workflows/validate-deps.yml`.

Two published packages change what a downstream install resolves, which is what this changeset grades:

- **`@objectstack/plugin-email`** declares `nodemailer` `^9.1.1` (was `^9.0.5`), clearing GHSA-2x7j-588g-ccc2 (7.5), GHSA-cc9r-2j5m-2m83 (6.5), GHSA-wmmp-3585-3rmp (6.5) — all fixed in 9.1.0 — and GHSA-8m3c-c648-2xjj (5.9), fixed in 9.1.1. The range takes the higher of the two fix lines so one floor covers all four. The 10.x major is deliberately not taken.
- **`@objectstack/plugin-hono-server`** declares `hono` `^4.13.5` (was `^4.13.2`), clearing GHSA-crvj-82cr-hjcx (5.9), GHSA-g6gw-c38x-mqfc (5.3) and GHSA-gqvv-2mrq-wpjv (6.5).

No exported symbol, payload key or accept/reject behaviour of ours moves — the published surface is unchanged and both grade `patch`.

The rest of the sweep releases nothing and is named here only so the set is readable in one place: the `sharp` override target lifts to `^0.35.4` (GHSA-rgj7-g3m4-5g8c, 8.9) and the `hono` override target to `^4.13.5`, both target-only lifts whose selectors already sit at the compatibility boundary; the private docs app takes `next` 16.3.3 (GHSA-2xp9-vwfh-vxw4 9.5 and GHSA-p293-qw3h-jr36 9.0, the two Criticals); and the `vitest` devDependency line takes 4.1.11 across the workspace, with `@vitest/coverage-v8` moved in lockstep because its peer on `vitest` is exact (GHSA-82fw-gwwq-j7x9, 5.9, which flagged both `vitest` and `@vitest/mocker`).

`hono` was flagged at TWO resolved versions and both are gone: the override lift is what collapses them. The transitive copy `@modelcontextprotocol/sdk` pulled sat exactly on the old `^4.12.34` floor and so was never re-resolved, while our own three declarations floated up to 4.13.2; `^4.13.5` excludes the floor, both edges re-resolve, and the tree now holds one `hono`. A bump that moved only our declarations would have left the transitive copy flagged and the gate red.
