---
"@objectstack/driver-sql": patch
---

fix(driver-sql): an unkeyable TEXT column whose field ALREADY declares a bound now names the real remedy (#12999)

One message served two causes and was true of only one of them.

`explainUnkeyableTextColumn` turns MySQL's `ER_BLOB_KEY_WITHOUT_LENGTH` /
`ER_TOO_LONG_KEY` index refusal into operator-readable advice. It rendered
every such refusal as *"the field declares no `maxLength` … declare
`maxLength` on the field(s)"*. That is correct at CREATE time. On the UPGRADE
path both halves are false: the additive sync adds columns and indexes and
deliberately never rewrites a column's type (#3728), so once a release adds a
bound to a previously unbounded keyed field (#12978 did exactly that for five
`sys_notification_*` objects), the field declares a perfectly usable
`maxLength` while the physical column is still TEXT. The index is refused
again on every boot and the message tells the operator to do the thing they
already did — in production, once per boot, which reads as the release that
shipped the fix being broken.

**What changed.** A second branch, selected per column on a criterion that
needs both halves: the physical column is TEXT *and* `keyableTextLength` says
a fresh create would have emitted `varchar(n)` for the field's declared bound.
Both inputs were already in hand on the failure path — the `columnInfo()` read
this method already performs, and the driver's `managedObjectFields`
registration. That message names the column, the bound it already declares,
that re-declaring changes nothing, and the remedy that does apply: convert the
column to `varchar(n)` **by hand, with a backup taken first**, restating the
FULL column definition on MySQL — `MODIFY` does not repeat a `NOT NULL` and
silently drops a `DEFAULT` it does not restate — after which the next boot
creates the index. A composite key that mixes a stale column with a genuinely
unbounded one names both dispositions rather than sending the operator down
one route for both.

**What deliberately did not change.**

- The CREATE-path message is **byte-identical**, and is what a field that
  really declares no usable bound still gets. A declared bound *wider* than a
  utf8mb4 key part can hold (768 characters) is not a stale column either — a
  fresh create emits TEXT for it too — so it keeps the CREATE message, whose
  768-character ceiling is the fact that operator needs.
- The refusal stays **loud and stays a failure**. The index genuinely was not
  created and a declared uniqueness is genuinely unenforced; naming a better
  remedy is not a reason to downgrade or silence that.
- The additive sync still does **not** rewrite the column itself. A widening
  `ALTER … MODIFY` takes an exclusive metadata lock on the table, which makes
  it a destructive, hard-to-roll-back action and a deliberate manual floor
  rather than something a boot may decide to do.

Diagnostic text only: no schema, DDL, wire or API surface moves.
