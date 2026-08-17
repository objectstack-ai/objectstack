---
"@objectstack/plugin-security": minor
---

fix(security): security explain reports partial masking — the field-mask layer gains the third state instead of calling gated fields hidden and gate-less rule fields readable (#9127)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable
changes. No `packages/spec` property is added, renamed, retired or tombstoned:
`field.maskingRule` was minted by #8993 and is untouched here, and the explain
report's own schema (`ExplainLayerSchema`) keeps its exact shape — the fix
lands entirely in what the `fls` layer's existing `verdict` and `detail` say.
There is no stored data to migrate and no author-facing spelling to convert. -->

#8993 landed partial masking on the enforcement channel: a field declaring
`maskingRule` is no longer deleted from a masked caller's response, its value
is **replaced** (`13812345678` → `138****5678`), with the field's
`requiredPermissions` acting as the unmask gate. The access-explanation
engine's field-mask layer predates that and read only the binary mask, so on
the one surface whose whole job is to describe enforcement it stated two
things that were not true:

- a field with `maskingRule` **and** a `requiredPermissions` gate the caller
  does not hold was listed under *"N field(s) masked from responses"* — an
  admin reading the report concluded the key was absent, while the caller was
  in fact receiving the partially masked value;
- a field with `maskingRule` and **no** gate was reported under *"No
  field-level masking applies"* — invisible in the report, and masked for
  every non-system caller in reality.

Both directions matter, and they fail opposite ways: the first overstates the
protection in place, the second hides that any applies at all.

The `fls` layer now reports the three states the enforcement path actually
produces — **hidden** (key deleted), **partially masked** (key served, value
replaced, the applicable rule named) and **readable** — and answers `narrows`
whenever either dimension bites, where a gate-less rule previously produced
`not_applicable`.

**Mirrored, not re-derived.** The composition deciding which rules apply to a
caller — `computePartialMaskRules` AND the explicit-deny exclusion that a
permission-set `readable: false` still wins outright — is lifted into one
method on the plugin (`computeReadPartialMaskRules`) that the result-masking
middleware, the readable-field projection and now explain all call. The
hidden/partial split in the report is `FieldMasker.maskResults`' own rule
(`!(field in rules)`), so the report cannot disagree with the masking it
describes. A second, independent derivation inside the explain engine is
exactly how this drift opened in the first place; `security-service.ts`'s
module contract claims explain *"matches enforcement by construction"*, and
this restores that for the partial-mask dimension.

**Breaking for direct embedders of the engine** (hence `minor`, not `patch`):
`ExplainEngineDeps` gains a **required** `getPartialMaskRules`. It is required
rather than optional on purpose — the field-mask decision has three outcomes
and the existing binary `getFieldMask` can express only two, so an engine
wired without it would silently reproduce both misreports above. A compile
error is the correct way for that omission to surface. Callers going through
`SecurityPlugin` / the `security` service's `explain()` — every consumer in
this repo — need no change.
