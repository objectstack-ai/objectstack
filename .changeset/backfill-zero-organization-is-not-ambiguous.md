---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the seed-tenancy backfill stops reporting a duplicate-minting hazard on a zero-organization first boot (#12395)

The `#8686` split diagnostic guarded on `organizationIds.length !== 1`, which folded
two opposite conditions into one loud warning. With **several** organizations the
owner of an untenanted row is genuinely underdetermined and the warning is right.
With **none** there is no second partition at all: every object runs exactly one
`__global__` counter, so the line's claim that the named objects "run two autonumber
counters and can mint the same `unique` identifier twice" was false precisely when a
fresh install read it. (The `organizationLastValue: 0` it reported alongside is the
split probe's `LEFT JOIN` finding no second row, not a second counter at zero.)

Zero organizations is now its own state — `no-organization-yet`, named after and
matching the 0 / 1 / several line `objectql`'s `resolveSystemWriteOrganization`
already draws — logged at `info` rather than `warn`. It is not silenced: the split
is still reported, because the observation is real even though the hazard is not.
It self-heals at the first sign-up, when the `sys_organization`-insert handoff runs
the same repair against a settled database.

Two things this deliberately does not change. An organization probe that **failed**
still takes the loud path and now says so — an unreadable probe returns the same
empty array as a genuine zero, and reading it as "no organizations yet" is the
confusion `objectql` fixed in `#9261`. And the repair threshold is untouched: data
is still modified on exactly `organizationIds.length === 1` and nothing else.

The affected-object list is also now described as what it is — a snapshot taken when
the probe ran. The probe runs at `kernel:ready`, which a boot can reach while an
over-budget inline seed is still writing in the background, so a first boot can name
fewer objects than the settled database holds.
