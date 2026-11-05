---
'@objectstack/spec': patch
---

docs(spec)!: the screen-field contract names `number`, `currency` and `percent` as the numeric value domain the resume enforces (#30178)

Clause-②: yes (narrowing) — the resume door refuses a string under a `type: 'currency'` or `type: 'percent'` screen field (`@objectstack/service-automation`); this package's `ScreenFieldSpec` and `ScreenFieldConfigSchema` text now states that rule. No schema shape changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) Only TSDoc and one describe string change: ScreenFieldConfigSchema and ScreenFieldSpec keep every key and type, so nothing an author wrote is refused at parse time and nothing at rest moves. The narrowing they describe is the resume door's, on a submitted value, which no migration can rewrite. -->

**BREAKING** (described here, enforced in `@objectstack/service-automation`): a `currency` or `percent` screen field takes a finite JSON number on resume, as a `number` field does; a numeric string is refused with `invalid_type`, never coerced. `ScreenFieldSpec.type` / `.min` / `.max` and `ScreenFieldConfigSchema.type` / `.min` / `.max` say so, and the `type` describe text names the three kinds.

**FROM → TO.** A resume bag `{ "discount": "60" }` for a `percent` or `currency` field → `{ "discount": 60 }`.
