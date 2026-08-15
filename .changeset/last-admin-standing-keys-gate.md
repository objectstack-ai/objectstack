---
"@objectstack/core": minor
"@objectstack/plugin-auth": minor
---

feat(security): bind the break-glass standing-key lists to what the authz resolver actually reads — the correspondence stops being prose (#8734)

`plugin-auth`'s last-administrator guard (ADR-0024 D5.2) decides whether a
pending write can empty the administrator population by testing the payload
against three standing-key lists (`MEMBER_STANDING_KEYS`,
`GRANT_STANDING_KEYS`, `PERMISSION_SET_STANDING_KEYS`). A payload touching none
of them is skipped without any reads — so a column `resolveAuthzContext` starts
reading that a list omits is a write class the guard **silently stops judging**,
on the one path whose failure mode is an installation-wide administrator lockout
with no in-product recovery.

Nothing bound the two together. The correspondence lived in a comment, and it
had already gone false once: #6084 wrote — naming `active` explicitly — that
everything a permission-set write touches other than `name` is invisible to "who
is an administrator". That was true when written; #8613 made `active` a
resolution-time predicate and the sentence became false. Nothing mechanical
would have caught it, because the guard's own tests stay green precisely when
the guard is never consulted.

**The mechanism is two links, and the first one is a measurement.**

- `@objectstack/core` now exports `ADMIN_STANDING_SURFACE` — declared beside the
  resolver, listing every table the administrator-derivation path reads, each
  classified `derives` or `reads-only` with its reason, and for the deriving
  tables every column read. It is asserted **equal** to what the real
  `resolveAuthzContext` reads, observed at runtime through a recording engine
  that records every property access and every `where` key per table. Observation
  rather than source extraction because the reads that matter have moved into
  helpers: `active` is read by `isRowActive(row)` and the ADR-0091 window bounds
  by `isGrantActive(row, now)`, neither named at the resolver's own call site —
  the exact shape #8613 had.

- `@objectstack/plugin-auth` now exports its standing-key lists plus
  `STANDING_KEYS_BY_TABLE` and `STANDING_KEY_EXCLUSIONS`, and a gate requires
  every column of that measured surface to have an answer: it is standing-bearing
  (in a list) or it is excluded with the reason it cannot empty the administrator
  population. There is no third state — the third state is what `active` was
  between #6084 and #8613.

So a resolver change that starts reading a new column fails at the first link
until the declaration is updated, and at the second until the guard has an
explicit answer for it. Landing #8613 green would have required writing down that
deactivating `admin_full_access` cannot empty the administrator population —
which is false, and which is what the old comment asserted by accident.

**No guard behaviour changes.** Every list keeps exactly the values it had; the
gate is one-directional by construction (it can only ever demand that the guard
judges *more*), because the other direction would put pressure on a break-glass
guard to fire less often.

The table-level half is covered too: a resolver that started deriving
administrator standing from a **new** table is invisible to any column-set
comparison, since the table is absent from both sides — so the surface enumerates
every table the path reads, and an unclassified one fails.
