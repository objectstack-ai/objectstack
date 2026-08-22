---
"@objectstack/metadata-protocol": minor
"@objectstack/cli": minor
---

`os migrate duplicates` now reports the rows blocking the three `kernel:ready`
NULL-safe index tightenings, and the three migrations' conflict messages point
there instead of at `os migrate plan` (#8725).

**The gap.** Three migrations replace a declared UNIQUE index with the NULL-safe
— and sometimes active-rows-only — form it was always meant to have, at
`kernel:ready` on a serving boot:

| table | index(es) | migration |
| --- | --- | --- |
| `sys_metadata` | overlay `active` + `draft` | `ensureMetadataOverlayIndexes` |
| `sys_view_definition` | `idx_sys_view_def_active` | `ensureViewDefinitionActiveIndex` |
| `sys_setting` | the declared row identity | `ensureSysSettingIdentityIndex` |

Each is a tightening, so rows an installation already holds can block it. The
migration then refuses — previous index kept, no row touched, boot continues —
and reports at `error` on the boot channel. That channel was the only one:
these indexes are invisible to `os migrate plan` **by construction**, twice
over. After the tightening, `isRuntimeManagedIndex` excludes the index (without
that exclusion a boot would propose rebuilding away the guarantee it had just
created); before it, each migration deliberately reuses the *declared* index's
name, so the reconciler's name-matched slot reads as filled whichever physical
form is really there. Measured with a matched control — one database carrying
the same duplicate damage under a declared index and under
`sys_view_definition`'s runtime one — `plan` named the declared one in full and
said nothing whatsoever about the runtime one.

**What is new.** The report gains a `runtimeIndexPreflight` section, one entry
per index, each `blocked` (with every colliding key group and its row count),
`clear`, `table-absent` (`sys_setting` arrives with the optional settings
service) or `unreadable` (with the driver's own message), plus
`summary.runtimeIndexesBlocked` and `summary.runtimeIndexBlockingRows`.
`reportVersion` moves `1` → `2`. Every `1` field keeps its name, shape and
meaning; the bump says there is more in the document, for consumers that
validate it strictly.

The probes are the migrations' own duplicate-listing statements —
`@objectstack/metadata-protocol` exports `collectRuntimeIndexPreflight` and
`runtimeIndexProbes`, which read those builders rather than restating the keys,
so the pre-flight and the boot report cannot describe different duplicates. On
MySQL the `sys_setting` probe uses the migration's MySQL spelling, where the
bare form is `ERROR 1064` on the reserved word `key`.

**The referral, repointed rather than deleted** (maintainer ruling, 2026-08-22).
All three conflict messages told the operator to "run `os migrate plan`" as an
alternative way to list the blocking rows, and that instruction was false: they
now name `os migrate duplicates`, which answers it. The six doc comments that
state the same referral as part of the ADR-0120 D4 disposition are updated with
them.

**Nothing about a migration's behaviour changes.** No tightening is armed,
deferred or altered, and `os migrate plan`'s drift contract is untouched. The
pre-flight only makes the refusal's evidence readable one command before the
restart — from a command that boots read-only and writes nothing, which is
pinned logically (schema plus every row, ordered) rather than by a file hash: a
raw hash over a SQLite file moves on any read-write open and would accuse this
command of mutating the install it exists to describe.
