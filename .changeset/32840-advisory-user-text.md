---
'@objectstack/lint': patch
---

Clause-②: no
Metadata-protocol: none

The form layout, visibility and page-sort advisories now carry a user-facing sentence in all 11 platform locales, for the save door's `userMessage` (the pattern the security-posture and dashboard advisories already follow). Four advisory rule ids gain one: the form-layout rule's `form-field-unknown` and `form-section-group-unknown` on a view write, `visibility-root-mislayered` on a view or page write, and `page-field-unprovisioned` where a page's sort names an injected column an external object does not store. Their findings carry the names the sentence interpolates as `userTextParams`, and `findingUserMessage` renders the sentence in the request's locale, else the workspace default, else English.

Rule ids, `message` and `hint` are unchanged, so `os validate`, `os lint` and every save response read exactly as before. The page, navigation and translation advisories of the same rules (`react-page-source-unparseable`, `react-prop-deprecated`, `react-prop-typo`, `react-chart-aggregate-invalid`, `react-chart-field-unprovisioned`, `nav-object-ungranted`, `nav-target-unresolved`, `page-field-unknown` and `page-section-group-unknown` at their advisory grade, `page-field-unprovisioned` on a page component's field binding, `translation-option-key-unknown`, `translation-section-name-missing`) have no sentence: the publish door never returns them, because those rules run there only on a flow write, whose snapshot carries no pages, apps or translations. They stay on the English `message`.
