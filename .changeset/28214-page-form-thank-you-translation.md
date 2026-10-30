---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/lint': minor
---

feat(spec): a page `object-form`'s thank-you panel is translated through `pages.PAGE.components.ID.submitBehavior.title` / `.message`

Clause-②: yes
Metadata-protocol: added

A page that embeds an `object-form` with `submitBehavior: { kind: 'thank-you', title, message }` used to confirm a create in the authoring language only: the strict `pages.PAGE.components.ID` translation entry declared no key for the panel, and `translatePage` never read `properties.submitBehavior`. A form view's own panel already had its key (`objects.OBJECT._views.VIEW.submitBehavior`); the page form, which takes the same member by reference, had none.

- **The key.** `pages.PAGE.components.ID.submitBehavior` takes `title` and `message`, under the form component's own `id`, beside its `title` and `description`. It is the page's copy, so two pages binding the same object can word their panels differently. The node is the form view's panel node, built by one factory, so a `thankYou` key is refused naming `submitBehavior`, and `url` / `kind` are refused with a prescription. An `object-form` without an `id` has no key: give it one.
- **The overlay.** `translatePage` overlays the two strings onto the component's `properties.submitBehavior` through the same function `translateView` uses for a form view's panel: only a `kind: 'thank-you'` panel is translated, only copy the form authors (a key cannot invent a `message`), and a missing key keeps the authored string. A form nested in a container is reached by the id route, as every other component copy is.
- **Extraction and coverage.** `os i18n extract` scaffolds `pages.PAGE.components.ID.submitBehavior.title` / `.message` for every `object-form` the page addresses, and the coverage report counts an authored panel a supported locale leaves untranslated.
- **Lint.** `os lint` refuses a `submitBehavior` key under a component that is not an `object-form`, and under a component id the page does not declare, offering the nearest form id.
