---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: the record an anonymous public-form submit echoes back passes the result masker, so a field whose masking rule applies is echoed masked (#21062)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author wrote is rewritten or changes meaning: every maskingRule already declared that it applies to every non-system caller who does not hold all of the field's requiredPermissions, and an anonymous form submitter is such a caller. The runtime now honours that declaration on the one door that skipped the masker. No stored metadata, schema key or published type moves. -->

**BREAKING for the anonymous public-form submit's response.**

**What changed.** A public form's submission is authorized by the ADR-0056
declaration-derived grant, which admits the create and the read-back on the
form's declared object and passes before any permission set is resolved. The
grant handed the operation to the engine and returned before the result masker
ran, so the record echoed in the `201` body carried every field whose
`maskingRule` applies as stored: the field the form collects, and a field
filled from its `defaultValue` that the form never shows.

The grant now hands what it returns to the same result masker the data plane
uses, for the caller it stands in for: the permission sets resolved for the
grant's context (the deployment's guest set when it registers one, otherwise
none) and the object posture those sets read. A field whose masking rule
applies is echoed masked. A field the caller's sets mark unreadable, or whose
`requiredPermissions` they do not hold, is masked the way the data plane masks
it for that caller. The read-backs the grant admits are masked the same way.

**What did not change.** The grant admits exactly what it admitted: the create
and the read-back on the form's declared object, and nothing else. The
server-managed fields are still stripped from the submitted row. The stored row
is unchanged; only the echo is masked.

**One more refusal, by the same rule.** If the caller's permission sets or the
object's security posture cannot be read, the submission is now refused with
`403 PERMISSION_DENIED` before anything is written, as every other caller's
request already is. The masking rules come from that posture, so the echo
cannot be masked without it.

**What to do.** Nothing, unless a client reads a masked field's stored value
back out of the submit response. The response now carries the masked value, as
every other non-system read does. A field's `requiredPermissions` are the gate
that lifts its mask, so a deployment whose guest set holds all of them is
echoed the stored value; otherwise drop the `maskingRule`.
