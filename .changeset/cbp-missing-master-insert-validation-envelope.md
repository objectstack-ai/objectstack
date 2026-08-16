---
"@objectstack/plugin-security": minor
---

fix(plugin-security)!: an insert that omits a required master-detail parent answers `400 VALIDATION_FAILED` with `fields[]`, not a `[Security]`-prefixed `422` (#8688)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves.
No spec property, object or field is renamed, retired or tombstoned — the change
is confined to which HTTP error envelope one runtime condition answers with
(`assertControlledByParentWrite`'s insert leg), and both envelopes already exist
in ADR-0112's closed vocabulary. There is no metadata an upgrader could migrate:
an app's declarations are byte-identical before and after, and the only consumer
action is branching on `VALIDATION_FAILED` instead of `MISSING_REQUIRED_FIELD`
for this one condition, which is prose in this changeset rather than a
prescription `objectstack migrate meta` could carry out. -->

**BREAKING (error contract).** On an `insert` into a `controlled_by_parent`
detail whose master reference is absent, the platform used to answer:

```
HTTP 422
code  : MISSING_REQUIRED_FIELD
error : [Security] Missing master reference: insert on 'crm_contact' did not
        supply 'crm_account'. …
fields: (absent)
```

It now answers the same envelope every other missing-required-field case
answers — `400 VALIDATION_FAILED`, carrying `fields[]` with
`{ field, code: 'required' }` — wherever required-field validation provably
refuses that omission. A client branching on `code === 'MISSING_REQUIRED_FIELD'`
for this condition must branch on `VALIDATION_FAILED` instead; a client already
handling the platform's ordinary missing-field envelope needs no change and
gains the field it could not previously highlight.

**What was wrong.** `assertControlledByParentWrite` runs in the security
middleware chain, *outside* the executor that calls `validateRecord`, so on an
insert it short-circuited required-field validation on the one field they
share. One user-visible condition therefore had two answers on adjacent
branches of the same field: absent → `422` with no `fields[]`, present but
unresolvable → `400 VALIDATION_FAILED` with `fields[]`. A form could highlight
the offending input in the second case and not the first, and any surface
rendering the message string showed a missing required field as a security
refusal. Measured live on 17.0.0 GA over REST.

The two harms could not be separated: both transport doors emit `fields[]` only
for the `VALIDATION_FAILED` duck-type and each overwrites `code` when it
matches, so "add `fields[]` while keeping `MISSING_REQUIRED_FIELD`" is not a
reachable throw shape.

**The stand-down is CONDITIONAL, and the residue is deliberate.** It applies
only where `validateRecord` really does refuse the omission: a `master_detail`
declared `required: true` and not `readonly`/`system`. For three other
declarable shapes — a `master_detail` with no `required`; `required` +
`readonly`; `required` + `system` — the validator skips the field before its
required check ever runs (`if (def.system || def.readonly) continue;`), so the
master gate is the only thing refusing the insert. There it keeps answering
`422 MISSING_REQUIRED_FIELD` exactly as before. A flat hand-over was measured to
mint a detail row with a null master FK, which the `controlled_by_parent` read
filter (`fk IN (readable masters)`) can never match — readable by nobody, and
answering `422` on every later by-id write.

**So the envelope asymmetry is not gone, it is confined** — to precisely those
three declarations, and no further. But confined is not unreachable: #8772
*proposes* a publish-time lint that would refuse them, and that issue is open
and unruled, so nothing refuses them at publish today. A `master_detail` with
no `required` draws only a non-blocking `warning`; `required` + `readonly` and
`required` + `system` draw nothing at all. An app can therefore newly declare
any of the three, publish cleanly, and still see the old
`422 MISSING_REQUIRED_FIELD` with no `fields[]` — so treat these shapes as a
live surface to avoid authoring into, not as a legacy tail that is already
closing. One further residual, narrower still: a
`controlled_by_parent` object whose relation resolves through the required-*lookup*
fallback also keeps the `422` — validation would cover it, but the ruling covers
`master_detail`, and widening a ruling is not the implementer's call.

**Unchanged, and pinned as unchanged:** a master that is *present but not
writable* by the caller still answers `403 PERMISSION_DENIED — requires edit
access to its master record`. The stand-down is keyed on the FK being absent;
every access leg still runs when one is supplied. The stored-row shape (a by-id
write whose persisted FK is null) also keeps its `422`: the caller sent no such
field, so a `fields[]` naming it would name a field that was never in the
request, and no payload the caller could send would fix it.

**One pin was rewritten deliberately**, not adjusted to match new behaviour: the
`[#7474]` six-envelope truth table's **insert** leg in
`controlled-by-parent-sharing.test.ts`. Its successor asserts both sides of the
condition — the covered shape hands over (the executor is reached, and the real
`validateRecord` refuses with `VALIDATION_FAILED` + `fields[]`), and each
uncovered shape still gets the `422` (with the real validator raising nothing on
the same payload, which is why the gate must stay). The truth table's other
legs are update-path and are untouched.

This supersedes the 2026-08-11 envelope choice on #7474, on that ruling's own
rationale: if a detail without its master is "precisely a required value that is
absent", the platform's contract for a required value that is absent is
`400 VALIDATION_FAILED` with `fields[]`.
