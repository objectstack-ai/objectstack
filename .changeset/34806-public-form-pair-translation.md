---
'@objectstack/rest': patch
---

fix(rest): a public form whose view a `.custom` pair overrides reads the pair's own translation, as `/meta` does

Clause-②: no
Metadata-protocol: none

`GET /forms/:slug` now translates the public form's view in the same label order the `/meta/view` reads already use for a `.custom` pair's declared override (ADR-0146 D2): a translation the pair ships, then the override's own text, then the base's translation. Before, an anonymous visitor read the override's text as written in every locale (the form's `title`, its section headings, and the top-level `label` when the view authors one), while a signed-in reader of the same view got the pair's translation. A form view no pair overrides, or whose pair ships no translation for the request's locale, is served exactly as before. The form's field labels (the object half) do not change: an object is extended, never replaced, so it has no pair rank on any read. No metadata key, value or default changes.
