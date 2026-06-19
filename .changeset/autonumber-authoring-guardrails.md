---
"@objectstack/cli": minor
---

feat(cli): warn on unrecognized autonumber format tokens

`objectstack compile` now flags `autonumber` formats whose `{...}` token is not a
counter (`{0000}`), date (`{YYYY}`/`{MM}`/…) or `{field}` token — an unrecognized
group (wrong case, spaces, punctuation, or a second sequence slot) renders
LITERALLY into the record number, which is a silent footgun for AI-authored
templates. Emitted as an advisory warning (`autonumber-unrecognized-token`),
alongside the existing `{field}`-reference checks. The `objectstack-data` skill's
`field-types` rules were also expanded to document the date/`{field}`/per-scope
tokens and the authoring rules (required interpolated fields, delimited adjacent
tokens, pad width is a minimum, date tokens are exact).
