---
"@objectstack/plugin-email": minor
"@objectstack/plugin-security": minor
---

`SweepLogger` and `ProjectionLogger` now declare `warn` as a REQUIRED channel, so a sink handed to the boot outbox sweep or to permission-set reconciliation can no longer be one that prints nothing (#9754)

Both interfaces declared every member optional — `info?`, `warn?`, `error?` — which made `{ info }` a legal sink. Against such a sink both durability reports evaporated: each reaches for `error`, finds none, falls back to `warn`, and finds none of that either. For the sweep that is mail the platform accepted and never delivered, summarised to nobody; for reconciliation it is a permission set that will not survive a re-provision, with the `info` "reconciled" line skipped as well, so the sink heard neither the failure nor the reassurance.

#9657 and #9748 repaired the call-site spellings. This is the other half, and the half that cannot regress: an optional `error` with no guaranteed alternative is a contract that permits silence, so an author reading the interface can write a report that never prints and be right about the type. Requiring `warn` makes that unrepresentable at the point of authoring rather than catchable one gate-run later.

`error` deliberately stays optional on both types — hosts do inject reduced sinks, and requiring `error` would foreclose the `{ warn }`-only host the drivers were written for.

If you pass a logger of your own and it declares no `warn`, add one; the kernel `Logger`, `ctx.logger` and `console` all satisfy the tightened shape unchanged. Consumers reach these types through `@objectstack/plugin-security`'s exported `ProjectionDeps`; `SweepLogger` is internal to `@objectstack/plugin-email`.

The rule now has a checker of its own: `pnpm check:optional-error-sink` scans every sink type in `packages/**`, reports the population as a census on every run, and carries a shrink-only ledger of the 15 sinks that still permit silence.
