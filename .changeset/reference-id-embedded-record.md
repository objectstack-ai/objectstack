---
"@objectstack/spec": patch
---

A stored reference value that is an embedded record is no longer a valid id
(#4455).

`os migrate value-shapes` is the evidence half of the ADR-0104 D1 per-deployment
gate, and its own header names the case it exists for: "a `location` stored as
`{latitude, longitude}` **or a `lookup` holding an expanded record object**". The
second case was not detected. `ReferenceIdValueSchema` was
`z.string().min(1)`, and in a SQL deployment a legacy embedded reference reaches
storage as JSON *text* in a TEXT column — a non-empty string. So a deployment
carrying exactly the values the gate exists to find ran the scan, was told it was
clean, and closed the gate with `--apply`; because the scan deliberately imports
the write-path predicate, the write path was equally blind and the value survived
future writes too.

`ReferenceIdValueSchema` now rejects a value whose first non-space character is
`{` or `[`, in both the stored and the expanded form (`$expand` produces an
object, never its serialization).

The rejection is deliberately narrower than the issue's first suggestion. Its
file sibling `FileReferenceIdValueSchema` can bound its charset because a
`sys_file` id is minted by the platform and by nothing else; a reference id is
whatever the target object's primary key holds, including an external key an
ADR-0015 federated datasource supplies. So this rejects the shape that is
provably not an id (`{"id":"acc_1","name":"embedded"}`) and leaves the id
alphabet to the object that owns it — `CB0-2026-0001`, `SFDC:001xx…` and
`ops/eu-west/tenant-7` all remain valid. Widening it further needs evidence about
real external keys, not a guess.

Reaches authors through the ADR-0104 warn-first path (a `[value-shape]` log line)
until a deployment opts into strict, so nothing starts rejecting writes on
upgrade — but the scan now counts these values, and a deployment holding them can
no longer close the gate.
