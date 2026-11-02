---
'@objectstack/cli': patch
---

fix(cli): `os migrate organization-ownership --apply` carries an organization's public-form withdrawal onto a read-only package's view into that package's `.custom` pair, declared, instead of stopping

Clause-②: no
Metadata-protocol: none

The ceremony carries every organization-layer public-form withdrawal onto the environment (`metadata-promotion`). On a view a read-only package ships, that save named the package itself, which the metadata door now refuses (ADR-0146 D1, D11: the read-only base takes no customization), so the ceremony stopped with a blocker and the operator had to save the withdrawal into the pair by hand.

- **Read-only package.** The carry now ensures the package's `.custom` pair through the ensure door (the in-process `POST /packages/:id/ensure-customization`), then saves the withdrawn view into the pair declaring `overrides: { package: <base>, basedOn: <the installed base's version> }`. Every read of the base's name serves that override, so the form stays withdrawn. It counts in `withdrawalsCarried`, and the progress line names the pair. The manual step in the changeset that closed the write naming the base (save the withdrawal into the pair, then re-run) is no longer needed when the pair can be ensured.
- **Writable package.** Its view is still saved in place, as before.
- **Pair not available.** When the pair cannot be ensured, or the door refuses the declared save into it, the carry makes the save naming the package as before: where the door admits it, that save carries the withdrawal; where it refuses, the step blocks as before, and the blocker now also names the pair's refusal.
- A re-run carries nothing more: the served view already has the form withdrawn.

No door, no accepted request shape and no error code changes.
