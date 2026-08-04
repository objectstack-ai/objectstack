---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `batchData`'s upsert fork decides update-or-insert by EXISTENCE, not caller visibility (#5099)

The fork asked `findOne` under the CALLER's context — the read RLS/sharing
narrows (#3455). An existing row outside the caller's read scope therefore
answered `null` and took the INSERT arm: on a store with a unique id constraint
the insert duplicate-keyed (an authorization/update scenario reported as a key
collision — the same misdirection class as #5088), and on a store without one
it wrote a **second row** for an id that already exists.

The fork now uses the same existence probe (`probeRecord`, system context) as
the single-record path and the update/delete bulk faces (#4620: one reading per
file). Whether the caller may WRITE the row it proves stays exactly where it
was — #1994's pre-image check inside `engine.update` — so the row's outcome is
the write policy's own answer instead of a spurious `duplicate key` error.

**Observable change under row-level visibility**: upserting an id that exists
outside your read scope no longer attempts an insert. The row now answers
whatever the by-id update path answers for that record (for a masked pre-image
check, the same 404 a direct update returns). The existence oracle is not
widened: the previous duplicate-key failure already revealed that the id
exists.

The non-atomic fallback (update threw → blind insert) is removed with it, on
both arms. With existence decided before the fork, the fallback could only
bury a real update failure under the duplicate-key error of inserting a row
just proven to exist — the same masking ADR-0119 D4 already forbade inside the
atomic arm. A row whose update fails now reports that failure.

Cost note: each by-id upsert row now performs one existence read before the
write — the same probe cost #4435 accepted for the single-record path and
#5088 accepted for the update/delete bulk faces.
