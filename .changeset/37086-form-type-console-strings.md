---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the console reads the new `form` type — Studio's translation preview, the pending-changes count and the served `forms` translation group

Clause-②: no
Metadata-protocol: none

ADR-0159 card ② (#37086) makes `form` a metadata type of its own with a `forms` translation group. The Studio translation preview now draws a Forms card (en "Forms", zh 表单), the pending-changes summary counts a drafted form as "1 form" / "2 forms" in every bundled locale, and the console's language loader recognises a served document that carries only `forms`. Studio's directory and left menu do not list the `form` type yet: card ③ (#37087) brings its designer and its menu placement.
