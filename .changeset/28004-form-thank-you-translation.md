---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/lint': minor
---

feat(spec): a form view's thank-you panel is translated through `objects.OBJECT._views.VIEW.submitBehavior.title` / `.message`

Clause-②: yes
Metadata-protocol: added

A form whose `submitBehavior` is `{ kind: 'thank-you', title, message }` used to confirm a submit in the authoring language only: the strict `_views` translation entry declared no key for the panel, and `translateView` never read `config.submitBehavior`. A public form read in another language showed a translated heading and field labels, then a source-language confirmation.

- **The key.** `objects.OBJECT._views.VIEW.submitBehavior` takes `title` and `message`, nested the way the authored copy is nested, so the panel's heading never shares a key with the form's own `title`. A `thankYou` key is refused naming `submitBehavior`, and `url` / `kind` are refused with a prescription, since neither is display copy.
- **The overlay.** `translateView` overlays the two strings onto the served form's `config.submitBehavior`, on the same locale chain and under the same rule as the form's `title`: only a `kind: 'thank-you'` panel is translated, only copy the form authors (a key cannot invent a `message` the form left to the console's default), a missing key keeps the authored string, and a string edited on top of the packaged view keeps the edit (ADR-0029 D9.2a, judged per string). The anonymous `GET /api/v1/forms/SLUG` already serves the translated view config under `Accept-Language`, so a public form's visitor now reads the panel in their language with no client change.
- **Extraction and coverage.** `os i18n extract` scaffolds `_views.VIEW.submitBehavior.title` / `.message` for every form a view container serves and for a `viewKind: 'form'` item, keyed by its runtime identity, and the coverage report counts an authored panel a supported locale leaves untranslated.
- **Lint.** `os lint` accepts a `submitBehavior` key on exactly the views a `title` key is legal on (a named form view, the default form, a form item) and refuses one over a list view.
