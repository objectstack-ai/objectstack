---
"@objectstack/plugin-security": patch
---

fix(plugin-security): propagate engine faults from permission pre-image probes instead of reading them as absent rows (#7505)

`SecurityPlugin`'s shared by-id probe, `readRowById`, answered `null` for three
different facts — the row does not exist, the engine threw (driver down, table
missing, timeout), and no engine is wired — and every gate that probes with it
read all three as "no such row". Its own contract note claimed a `null` "always
DENIES downstream". That was true of one caller and false of the rest, in two
opposite directions:

- **`assertControlledByParentWrite`** reported a store outage as **`404
  RECORD_NOT_FOUND`**. After #7474 split that leg out, the answer was precisely
  wrong in a way an SDK acts on: 404 is terminal, so a client drops the record
  id and stops retrying at exactly the moment the truthful answer was "come back
  in a minute".
- **The two admin-door provenance gates** (`sys_permission_set`'s ADR-0086
  two-doors gate and `sys_position` / `sys_capability`'s ADR-0066
  asset-ownership gate) read `null` as "this row is not package/platform-managed"
  and let the write **through**. For the duration of a store fault, both
  boundaries silently stood down — fail-**open**.
- **The owner-anchor echo** caught the throw and answered `403 changing record
  ownership`: fail-closed, but with a sentence accusing the caller of an
  ownership grab they never attempted, on an envelope a client will not retry.

Per the maintainer ruling of 2026-08-11 the posture is **fail-closed**, and an
outage is never reported as a missing record. An engine fault now propagates out
of the probe and out of the gate, so the write is refused (nothing reaches the
driver) and the caller is told what actually happened. The error is re-thrown as
the engine threw it rather than re-badged: objectql's `DatasourceUnavailableError`
keeps its `ERR_DATASOURCE_UNAVAILABLE` code and reaches the wire as **503**,
which is the answer a client can back off on. Wrapping it in a security code
would have relabelled a dependency outage as an authorization event.

`null` from the probe now means one thing: the row is genuinely absent.

**Steady-state behaviour is unchanged at every call site** — an absent detail
row still answers `404 RECORD_NOT_FOUND`, a package-managed row is still refused
403, an unchanged-owner form echo is still tolerated, and a pre-image the caller
cannot read still denies exactly like one that is not there (the
owner-enumeration oracle is untouched). Only the fault path moved.

Deliberately unchanged: the master-visibility probe inside the same
controlled-by-parent gate still treats a throw as "not visible" and answers 403.
The two probes ask different questions — "does this row exist", which an outage
leaves unanswered and which must not be answered "no", versus "is this master
visible to you under your own write policy", whose fail-closed default genuinely
is "not visible".

You may now see `503 ERR_DATASOURCE_UNAVAILABLE` from a write that previously
returned `404`, `403`, or — at the two provenance gates — succeeded, but only
while the datasource behind the probed object is unavailable.
