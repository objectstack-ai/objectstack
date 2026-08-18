---
"@objectstack/objectql": patch
---

fix(engine): `deleteBehavior: 'set_null'` on a `multiple: true` reference field removes the deleted MEMBER from the stored array instead of nulling the whole slot, and the temporary 409 hold shipped with #9437 is removed (#9438)

On a set-valued foreign key, "set null" now means what it has to mean: the
reference to the deleted record is filtered out of the stored array and the
remaining members are written back untouched. Before the interim hold, this
limb wrote `null` over the WHOLE array — a row holding `["acc_a","acc_b"]`
re-read as `null` after `acc_a` was deleted, silently dropping the live
reference to `acc_b`.

**The residual shape is the ruled one, consumed rather than decided here.**
When the last member is removed, the field is written as **`[]`, never
`null`** — the representation `FieldSchema` pins as verbatim contract
(`packages/spec/src/data/field.zod.ts`, the `multiple` and `required` doc
blocks; #9447, maintainer ruling 2026-08-18, binding for every writer). The
open question that kept this limb held back was exactly that shape; it is
now answered at the spec, and this write consumes the answer.

**The temporary holding position is removed in the same stroke — it was
built to be removed.** #9437 shipped an explicit interim: any delete that
would take the `set_null` limb on a multi-value reference was refused
`DELETE_RESTRICTED` / 409, with a `developerMessage` naming the refusal
TEMPORARY and citing the tracking issue literally. Those deletes now
succeed and remove the member. The refusal envelope for a genuinely
configured `restrict` is unchanged, and the interim's extra sentence is gone
with the interim.

Removal compares whole members (`String(v) !== String(id)`), the same
reading the dependents narrowing already applies — the probe's `$contains`
pushdown is a substring superset, so an id that is a prefix of another
neither loses its own member nor takes its neighbor's. Every other
disposition is untouched: `cascade` still deletes dependents, a
single-valued `set_null` still clears its foreign key to `null`, an
explicit `restrict` still refuses with its own sentence, and the required-FK
escalation stays exactly as it was.

Pinned against the driver double that models the JSON TEXT column and
against a real `SqlDriver` on better-sqlite3 through the real data-plane
delete: member removal with a surviving sibling that still resolves, the
emptying case asserted literally as `[]` and not `null` on a re-read of the
database, and the controls beside them.

Note: `required` on a multi-value lookup now *documents* non-empty-array
semantics (same ruling), but the validator does not yet enforce it — that
enforcement gap is tracked separately in #9476 and is not changed here.
