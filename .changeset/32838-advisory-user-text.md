---
'@objectstack/lint': patch
---

Clause-②: no
Metadata-protocol: none

The data-model advisories the save door returns now carry a user-facing sentence in all 11 platform locales, for the save door's `userMessage` (the pattern the security-posture advisories already follow). Five advisory rule ids gain one: the autonumber-format rule's `autonumber-unrecognized-token` and `autonumber-references-optional-field` (object writes), `sort-field-unprovisioned` and `searchable-field-unprovisioned` on an external object's list view or searchable fields (object and view writes), and `object-reference-unregistered-platform` on a dataset's base object (dataset writes). Their findings carry the names the sentence interpolates as `userTextParams`, and `findingUserMessage` renders the sentence in the request's locale, else the workspace default, else English.

Rule ids, `message` and `hint` are unchanged, so `os validate`, `os lint` and every save response read exactly as before. The other data-model advisories have no sentence because the publish door never returns them: `unique/double-declaration`, `unique/legacy-organization-composite` and `title-unresolvable` run only on the CLI, and `field/select-missing-options`, `relationship/master-detail-required` and `relationship/association-inline-edit` belong to the `os lint` best-practice sweep. They stay on the English `message`.
