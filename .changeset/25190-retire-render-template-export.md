---
'@objectstack/plugin-email': patch
---

fix(plugin-email)!: retire `renderTemplate`, the render export that takes an email template body with no save moment

The hole-placement rule for mail templates is judged where a template is authored or published: `os validate`, `os build`, `os lint` and the runtime publish gate. The `renderTemplate` function on the package entry took a template body inline and rendered its html face at once, with no save moment, so the rule could not see it. It leaves the published entry of `@objectstack/plugin-email`. Nothing in this repository imported it from that entry. The renderer stays inside the package: `services.email` still renders every stored `email_template` through it, unchanged.

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/plugin-email#renderTemplate) One runtime function leaves a published package entry; no key of any metadata schema, no object definition and no stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. A TypeScript consumer meets the break at its own import, and the line below names the door to use instead. -->

**BREAKING** (a runtime export is removed). It ships as `patch` because the metadata protocol does not move. There is no staged window.

- FROM `renderTemplate` TO an `email_template` item for the name and locale, rendered by `services.email` through `renderTemplate({ template, data, locale })` (render only) or `sendTemplate` (render and send).

Unchanged: `IEmailService.renderTemplate` (the render-by-name method of the same name), `requireVars`, `htmlToText` and the template loader; and how every stored template renders.
