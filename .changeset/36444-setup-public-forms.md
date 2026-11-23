---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/platform-objects': patch
---

feat(setup): Setup → Configuration → Public forms lists every public form of the environment and switches it on or off

Clause-②: yes (widening) — a new Setup navigation id `nav_public_forms`, a new component id `forms:public-forms`, and new language-pack keys (the `publicFormsSetup` block and the nav label) in every shipped locale
Metadata-protocol: none

A system administrator (`manage_platform_settings`, the capability the Setup entry asks) now has one page for the operations side of public forms. It lists every public form of the environment: its name, the object a submission creates a record of, its address, and whether it is on. Per row: switch it on or off, copy its address, or open it in a new tab. A form is designed (created, deleted, its fields and title changed) in Studio, not here.

- **Which forms are listed.** A form view whose `sharing` opens it to anonymous intake once switched on (`allowAnonymous: true` and a `publicLink`), read by the same rule the anonymous form routes use (`anonymousFormIntakeCandidates`). A switched-off form stays listed and can be switched back on. A form with no public address or no anonymous access is an internal form and is not listed. The list is the effective one (`GET /meta/view`), so an installed app's form switched off in this environment lists as off.
- **Where a switch is saved.** The switch is the form's `sharing.enabled`, saved and published at once. A form of a writable package is saved in that package. A form of an installed (read-only) app is saved as this environment's customization, an override in the app's `.custom` package (ADR-0146), never an edit of the app's own package, so the app upgrades as before. Switching such a form back on removes the override when it held nothing but the switch, so the app's own form is served again; an override that also carries design changes keeps them, with the switch on.
- A switch over a draft already pending where it would save writes nothing and says so: that draft is its saver's and is never published on their behalf.
- A switched-off form keeps answering as it does today: `404 FORM_NOT_FOUND` at its address. No route, error code or stored key is added.

New Setup navigation entry `nav_public_forms` in `group_configuration` (label "Public Forms", in every shipped locale) opening the component `forms:public-forms`; the Setup navigation now carries 35 entries. New locale block `publicFormsSetup` in every console locale. Not shown: when a form last took a submission, since a submission is an ordinary record of the form's object and records no form.
