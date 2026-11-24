---
'@objectstack/objectql': patch
---

fix(objectql): a roll-up `count`/`sum` that arrives with a restart now says at boot that its stored rows hold NULL, and names `os migrate summary-nulls`

Clause-②: no
Metadata-protocol: none

A roll-up `summary` field added by an install in a running process is computed on the rows already stored. One that arrives with a restart (a code-defined app's new version that boots with the field, a marketplace install loaded at the next boot, a ledger entry rehydrated at boot) is not: the boot treats every roll-up it serves as already computed, so those rows kept reading NULL until one of their child rows was written, with nothing in the log.

At `kernel:bootstrapped` the ObjectQL plugin now reads the first 100 rows of each object that owns a `count` or `sum` roll-up (one read per such object, `id` and the roll-up columns only) and, when a sampled row holds NULL there, logs one warning naming each roll-up, how many sampled rows hold NULL, and the commands that fill them: `os migrate summary-nulls --object <object>` (dry run), then the same with `--apply`. A `min`/`max`/`avg` roll-up is not named: NULL there is its reading of "no child rows". The boot writes nothing and never fails over this check.
