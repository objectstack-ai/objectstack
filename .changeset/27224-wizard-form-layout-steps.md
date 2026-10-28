---
'@object-ui/plugin-form': patch
'@object-ui/console': patch
---

fix(ui): a wizard form keeps `layout: 'horizontal'`, and the form page draws `type: 'wizard'` as steps (#27224)

Clause-②: no
Metadata-protocol: none

A wizard form view (`type: 'wizard'`) dropped two things it declares:

- **A wizard form** now keeps an authored `layout: 'horizontal'` on every step, drawing each label beside its field from the `sm` breakpoint up, as simple and tabbed forms already do. It used to draw its fields `vertical` whatever the form view said. `vertical`, and a form view with no `layout`, draw exactly as before.
- **The form page** (`/forms/:name`, and the public `/f/:slug`) now draws a `type: 'wizard'` form view as one step per section, the way the app's wizard form does: a step indicator (hidden by `showStepIndicator: false`), **Next** checks the current step's required fields before the next step opens, **Back** is always free, a later step opens from the indicator once completed or under `allowSkip`, and the last step's **Submit** carries every step's fields. A submit refused for a missing field opens the step that holds it and marks it in the indicator. A wizard form view with a single section draws it stacked, as before. Before, the page drew every section stacked on one page with no steps.
