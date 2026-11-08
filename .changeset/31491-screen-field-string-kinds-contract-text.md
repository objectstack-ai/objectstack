---
'@objectstack/spec': patch
---

docs(spec)!: the screen-field contract names `text`, `textarea`, `email`, `url` and `phone` as the string value domain the resume enforces (#31491)

Clause-②: no (narrowing) — the resume door refuses a non-string under a `type: 'text'`, `'textarea'`, `'email'`, `'url'` or `'phone'` screen field (`@objectstack/service-automation`); this package's `ScreenFieldSpec` and `ScreenFieldConfigSchema` text now states that rule. No schema shape changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) Only TSDoc and one describe string change: ScreenFieldConfigSchema and ScreenFieldSpec keep every key and type, so nothing an author wrote is refused at parse time and nothing at rest moves. The narrowing they describe is the resume door's, on a submitted value, which no migration can rewrite. -->

**BREAKING** (described here, enforced in `@objectstack/service-automation`): a `text`, `textarea`, `email`, `url` or `phone` screen field takes a JSON string on resume; an object, number, boolean or array is refused with `invalid_type`, never coerced, and the run stays paused. Only the shape is checked, not the format. `ScreenFieldSpec.type` and `ScreenFieldConfigSchema.type` say so, and the `type` describe text names the five kinds.
