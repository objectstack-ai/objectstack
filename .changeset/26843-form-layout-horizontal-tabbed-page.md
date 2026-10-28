---
'@object-ui/components': minor
'@object-ui/plugin-form': minor
'@object-ui/console': minor
---

fix(ui): a form view's `layout: 'horizontal'` draws each label beside its field, a tabbed form keeps it, and the form page draws `type: 'tabbed'` as tabs (#26843)

Clause-②: no
Metadata-protocol: semantic

A form view's `layout: 'horizontal'` reached every console form but drew nothing different, and the form page ignored `type: 'tabbed'`:

- **`layout: 'horizontal'`** now places each field's label in a fixed column beside its control from the `sm` breakpoint up; below `sm` (a phone) the field stays stacked, label above control, as `vertical` draws it. The description and validation message stay under the control. `vertical`, and a form view with no `layout`, draw exactly as before. Before, the form renderer read the key only to align its action row.
- **A tabbed form** (`type: 'tabbed'`) now keeps an authored `layout: 'horizontal'` on every tab. It used to draw its fields `vertical` whatever the form view said.
- **The form page** (`/forms/:name`, and the public `/f/:slug`) now draws a `type: 'tabbed'` form view as one tab per section: `defaultTab` opens first, `tabPosition` places the strip, and a section hidden by its `visibleWhen` draws no tab. A submit carries every section's fields, the closed tabs' included, and a submit refused for a missing field opens the tab that holds it. A tabbed form view with a single section draws it stacked, as before. The page also draws `layout: 'horizontal'` rows. Before, it drew every section stacked and every label above its field.
