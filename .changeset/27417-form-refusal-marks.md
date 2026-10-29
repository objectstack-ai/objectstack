---
'@object-ui/console': patch
'@object-ui/fields': patch
---

fix(console): a refused form submit marks the fields it names; the markdown editor's placeholder takes the sans stack

Clause-②: no
Metadata-protocol: none

- **`@object-ui/console`**: the form page (`/f/:slug`, `/forms/:name` and `/apps/:appName/forms/:name`) used to answer every refusal with one banner and one toast and nothing on the inputs. Each refused field is now marked: `aria-invalid` on its control, and the reason under the control, which the control names in `aria-describedby`. The client required check marks each empty required field ("Name is required"). The server's field-level refusals (`400 VALIDATION_FAILED` with `fields[]`, flat or in the wrapped envelope, and `409 UNIQUE_VIOLATION` naming its `field`) mark the fields the form draws, read with `extractFieldErrors` from `@object-ui/react`, the reader the record dialog uses. A faulted `visibleWhen` marks its field and points it at the banner, which already names the field and the rule. A refusal that names no field, or only fields the form does not draw, marks nothing. On a tabbed or wizard form view the first marked field's tab or step opens. Editing a marked field clears its mark. The banner and the toast are unchanged.
- **`@object-ui/fields`**: the markdown, html and richtext editor (`RichTextField`) keeps `font-mono` for the source a person types, and its placeholder now uses the sans stack (`placeholder:font-sans`), so a form's "Describe your request" no longer reads as code. This applies on every host.
