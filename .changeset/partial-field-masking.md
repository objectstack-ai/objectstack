---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
---

Partial field masking (#8993): `FieldSchema` declares `maskingRule` — a closed
preset enum (`phone`, `id_card`, `bank_account`, `email`, `name`) plus a
`{ keepHead, keepTail }` escape hatch — and plugin-security's `FieldMasker`
enforces it in the same PR (ADR-0049 declare = enforce; the key re-enters the
schema only with its runtime consumer attached, honouring the 2026-06 prune in
spirit).

A field declaring a rule is served masked-but-recognisable (`138****5678`) to
every non-system caller; the field's `requiredPermissions` (ADR-0066 D3) is the
unmask gate — holders of all listed capabilities read the full value. A
permission set that marks the field non-readable still deletes it entirely.
Masking rides the single runtime channel, so API callers, browser users, the
CSV/XLSX export route and the AI-context interceptor all see the same
deterministic, length-preserving masked value. Masked callers cannot filter,
sort, group or aggregate on the field (403, the FLS predicate-oracle guard),
and a write that round-trips a masked placeholder is refused with
`400 VALIDATION_ERROR` instead of silently overwriting the stored value.
New exports: `FieldMaskingRuleSchema`, `FieldMaskingKeepSchema`,
`FIELD_MASKING_PRESETS`, `maskFieldValue`, `MASK_CHAR`.
