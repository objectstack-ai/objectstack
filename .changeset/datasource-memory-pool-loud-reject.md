---
"@objectstack/service-datasource": patch
---

fix(service-datasource): a `pool` block on a `memory` datasource is rejected, not dropped in silence (#5931)

#5714 made a `pool` block the driver cannot honour a loud authoring error, but
its ruling was scoped to the two sqlite arms — `memory` kept dropping it. The
`memory` arm hands `InMemoryDriver` nothing but `buildMemoryConfig(spec)`, which
reads `spec.config` and never `spec.pool`, so a sized pool reached nothing and
said nothing. Measured through the real factory:

```text
memory   + pool{min:3,max:9}   driver config {"persistence":false}   pool undefined
sqlite   + pool{min:3,max:9}   rejected (since #5714)
postgres + pool{min:3,max:9}   knex config.pool {"min":3,"max":9}    live {min:3,max:9}
```

`memory` now joins `POOL_UNSUPPORTED_DRIVER_IDS`, so the same three doors that
already rejected sqlite reject it: the Setup wizard's create/update, the
boot-time auto-connect pre-pass, and the driver factory itself.

**Behaviour change.** A datasource declaring `driver: 'memory'` (or `inmemory` /
`in-memory` / `mingo`) together with a non-empty `pool` block used to load and
run; it now throws at whichever door it arrives through. The fix is the one edit
the message names — delete the `pool` block. Nothing is lost by deleting it: it
configured nothing before. An absent or empty `pool` is unchanged, and every
`memory` datasource without one builds exactly as it did. No declaration in this
repo, the example apps included, carried the combination.

**Its own explanation, not SQLite's.** SQLite is rejected because a second
connection to `:memory:` opens a separate, empty database, so sizing the pool
would split one datasource across several stores. That reasoning is false for
`memory`: there is no connection at all — the store is a plain data structure in
this process — so the message says that instead. Telling an author their driver
picked a connection strategy for them would send them looking for a knob that
does not exist. Reasons are now keyed by driver id, which makes an arm joining
the set without writing one a type error.

Maintainer ruling 2026-08-07, which also set the default for the next sister
arm: when a declared key is silently dropped on one arm and an earlier ruling
already made it a loud authoring error on a sibling, the new arm joins the
existing rejection set rather than queueing for a ruling of its own — unless the
original rationale was measured to be arm-specific.

No API surface is added — `POOL_UNSUPPORTED_DRIVER_IDS`,
`driverReadsDeclaredPool`, `unsupportedPoolIssue`, `unsupportedPoolMessage` and
`assertDatasourcePoolSupported` keep the signatures #5714 published, and the
sqlite arms' rejection text is byte-for-byte unchanged.
