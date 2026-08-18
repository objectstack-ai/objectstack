---
"@objectstack/console": patch
---

fix(devx): the vendored Console SPA bundles THIS tree's `@objectstack/spec`, so a newly declared authorable key is reachable in the Studio designer on the day it lands (#8134)

`scripts/build-console.sh` injected only `OBJECTSTACK_CLIENT_DIST`. The console's
`@objectstack/spec` therefore always came from objectui's own lockfile, resolved
under `pnpm install --frozen-lockfile` — which means the **published** spec, never
this workspace's.

That made a whole class of change silently unreachable: an authorable key added to
`packages/spec` after the last spec publish is accepted and round-tripped by the
server, while the Studio designer — bundled against the published spec — rejects it
as an unrecognized key and refuses to auto-save. The framework-side card closes
green the whole time, because `packages/spec`'s own pins pass. Reaching the key took
three ordered cross-repo steps: spec publishes, objectui refreshes its lockfile, the
console pin moves.

The skew was not hypothetical at the time of this change: **102** schema description
strings declared in this tree's `packages/spec` were absent from the
`@objectstack/spec@17.0.0` the pinned objectui lockfile installs.

`build-console.sh` now exports `OBJECTSTACK_SPEC_DIST` alongside the client
injection, mirroring it including its preflight:

- a **hook-presence guard** that refuses the build, naming the pin, when the pinned
  objectui predates the `OBJECTSTACK_SPEC_DIST` hook — an unguarded injection would
  quietly rebuild the exact silent skew this change exists to end;
- a **build guard** that builds `packages/spec` when it is not built, keyed on both
  `dist/index.mjs` and `json-schema/openapi.json`, because the spec's exports map
  has one entry (`./openapi.json`) that a different generator produces;
- a **bundle assertion** that proves the injection actually landed.

The assertion is deliberately not a frozen literal like the client's canary. It
derives a witness on every run — a description string this tree's spec has and the
vendored one lacks — and pairs it with a control string both carry, so an absent
witness is told apart from an unbundled entry. A frozen literal would be carried by
the published spec within one release and pass forever while proving nothing, which
is the same silent-pass failure this change removes.

Consumers see no API change; the shipped console simply matches the framework
release it is published with.
