---
'@objectstack/rest': patch
---

fix(rest): `GET /forms/:slug` serves a public form's section headings in the visitor's language, beside the field labels it already translated

Clause-②: no

An anonymous visitor of a published form cannot load the translation bundle in the browser, so the server is the only place its section titles can be translated. The route translated `objectSchema` (the field labels) under `Accept-Language` and returned each form section as authored, so a zh-CN visitor read English section titles over Chinese field labels. It now localizes each section's `label` and `description` through the same `objects.OBJECT._sections.NAME` keys the signed-in console reads, with the request's locale, the deployment's fallback chain and default locale, and the packaged view as the override base.

With `Accept-Language: zh-CN` over a form whose section `about` is labelled `Tell us about yourself`, and a zh-CN bundle carrying `objects.crm_lead._sections.about.label: 介绍一下你自己`:

- FROM: `form.sections[0].label` is `Tell us about yourself`, and `objectSchema.fields.first_name.label` is `名`.
- TO: `form.sections[0].label` is `介绍一下你自己`; the field label is unchanged (`名`). A section `description` follows the same key's `description`.

What does not change: a section whose key the bundle lacks keeps its authored text; a section with no `name` is served as authored; a section that authors no heading is not given one; a heading edited on top of the packaged view keeps the edit. The response shape (`slug`, `object`, `label`, `form`, `objectSchema`), its top-level `label`, `Vary: Accept-Language`, the declared-field narrowing, the lookup / master-detail / user strip and `POST /forms/:slug/submit` are unchanged.
