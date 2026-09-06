---
'@objectstack/platform-objects': patch
---

`attestFreshDatastore` looks its `os migrate` remedy up instead of defaulting it

When a fresh datastore's own boot has already admitted a value that contradicts a
migration's contract, that id is not attested and the operator is told what closes
the gate on real evidence. The sentence used to be built from a two-way branch: the
file-references id got `files-to-references`, and **every other id** got
`value-shapes` by default.

`CREATION_ATTESTED_MIGRATION_IDS` has three members. For the third —
`adr-0030-notification-event` — that default is a wrong prescription: `os migrate
value-shapes --apply` neither attests nor clears it, and there is no `os migrate
notification-event` sub-command to send an operator to at all (that cut-over is an
operator call with no self-check).

The branch is now an explicit id-to-remedy register, total over the ids a
value-shape tally can contradict. The loop asks it rather than falling into an arm,
so an id with no value-shape contract is never-contradictable by that evidence and
is attested on the birth observation as before. A new member therefore inherits no
remedy: adding a third arm that happened to be right today would only have moved the
same defect onto the fourth member.

No behaviour changes for the two ADR-0104 ids, which is where every reachable path
runs today: the shipped engine keys its admitted-violation tally from a closed
`'media' | 'value-shape'` union, so it cannot name a third id.
