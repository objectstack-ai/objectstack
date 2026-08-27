---
'@objectstack/spec': minor
'@objectstack/plugin-security': patch
---

feat(spec): `ActionParamSchema.carryOver` — the declared carry-over param: seeded from the row, rendered as a non-editable summary, submitted verbatim (#11753 ruling, spec half; #11992)

<!-- adr-0087: not-required (accept-set expansion) One new CLOSED optional key
on an existing shape; nothing authorable is renamed, retired or tombstoned, so
there is no conversion to register. Previously-refused spellings stay refused —
`readonly` and `disabled` now carry alias guidance pointing at the new key. -->

The maintainer's 2026-08-25 ruling on #11753 (recommendation A) declares ONE
carry-over contract instead of a rendering convention: a param may state, in
metadata, that its value is carried through the action dialog rather than
collected from the user.

- `carryOver: true` — seed from the current row (`defaultFromRow: true` is
  required alongside, enforced at parse time), render as a NON-EDITABLE
  summary, submit VERBATIM. Unlike `visible: false` — the measured non-answer,
  which omits the param from the submission entirely — a carry-over param is
  always sent.
- Aliases: `readonly` / `disabled` are refused with guidance naming
  `carryOver` (a field's `readonly` means write-path strip, which is exactly
  the wrong half here).
- Exemplar (`@objectstack/plugin-security`): the five `clone_permission_set`
  JSON facet params (`object_permissions`, `field_permissions`,
  `system_permissions`, `row_level_security`, `tab_permissions`) declare it,
  so the sanctioned clone path stops offering five prefilled raw-JSON
  textareas an admin could hand-mangle into a clone that grants MORE than its
  base. `description` stays an ordinary editable param. The send-side contract
  is unchanged (#11703 pin 6 stays green).

The objectui renderer leg (honouring the declaration in `ActionParamDialog`)
is the downstream card tracked on #11753.
