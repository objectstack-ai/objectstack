---
"@objectstack/plugin-auth": patch
---

deps(auth): move the whole better-auth family 1.7.1 → 1.7.2 in step, and return `@better-auth/scim` to the family's `^` range (#13715)

`@objectstack/plugin-auth` declared `@better-auth/scim` at an EXACT `1.7.1`
while the rest of the family sat on `^1.7.1`, and `pnpm-workspace.yaml`
forced the same exact resolution. That hold was deliberate and dated (#3653
ruling, 2026-08-27): at the time `^1.7.1` resolved scim to 1.7.2, whose
`better-auth` / `@better-auth/core` peers are `^1.7.2`, while the installed
family was still 1.7.1 — and the workspace overrides would have rewritten
those peer ranges down and *silenced* the mismatch rather than satisfy it.
That ruling named the remedy: float to 1.7.2+ "with the family moved in
step, never a side effect of a lockfile refresh". This is that move.

All eleven family members go to `^1.7.2` together — `better-auth`,
`@better-auth/core`, `@better-auth/scim`, `@better-auth/oauth-provider`,
`@better-auth/sso`, the five adapters and `@better-auth/telemetry` — in the
workspace overrides and in `@objectstack/plugin-auth`'s own declared
dependencies, which are what a downstream `npx create-objectstack` install
actually resolves (the overrides do not ship). Measured after the move: npm
`latest` is 1.7.2 for all eleven, the install resolves exactly one copy of
each at 1.7.2, and `@better-auth/scim@1.7.2` keeps its `^1.7.2` peers on
disk — satisfied by the installed pair rather than rewritten down.

scim rejoins the family's `^` shape rather than taking a fresh exact pin: its
two sibling standalone plugins (`oauth-provider`, `sso`) peer the family
identically and carry `^`, and this entry is also the GHSA-j8v8-g9cx-5qf4
floor, which has to be able to take the next patch. The two shapes were
measured against each other and resolve identically today, so the choice is a
durability one, not a resolution one.

No source change: `better-call@1.4.0` and `@better-auth/utils@0.4.2` are
still peered exactly as they were at 1.7.1, and `better-auth`'s stale
optional `better-sqlite3@^12.0.0` peer is unchanged, so the scaffold's
`peerDependencyRules` are untouched.
