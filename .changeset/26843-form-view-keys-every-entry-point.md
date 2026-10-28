---
'@object-ui/plugin-form': minor
'@object-ui/console': minor
---

fix(console): every console form entry point renders the form view's `buttons`, `layout` and `defaults`, and a tabbed form with subforms opens on its `defaultTab` (#26843)

Clause-②: no
Metadata-protocol: semantic

A form view's `buttons`, `layout` and `defaults` saved and published, but the console set its own values over them, depending on which entry point opened the form:

- **The full-page record form** (`/new`, `/record/:id/edit`) and **the New / Edit dialog** set `showSubmit: true`, their own submit and cancel labels and `layout: 'vertical'`, so an authored `buttons.submit.label`, `buttons.*.show: false` or `layout: 'horizontal'` did nothing. Both now read them from the form view the flow selects. An authored label may be a per-locale map. The New dialog also ignored `defaults`; a create there now opens with them.
- **`defaults` and the host's own opening values merge per field.** A URL prefill, a parent pre-link or a seeded calendar day still wins for the fields it names, and the form view's `defaults` fill the rest. Before, a create carrying any prefill dropped `defaults` entirely. An edit never reads `defaults`.
- **The form page** (`/forms/:name`, and the public `/f/:slug`) never read `buttons` or `defaults`. An authored submit or cancel label now shows, `show: false` removes the button (the public form still draws no Cancel), and a create opens with `defaults`, over the object's own field defaults and under a `?prefill_` param.
- **A tabbed form with subforms** opened on its first tab with the strip on top. `ObjectForm` now hands `defaultTab` / `tabPosition` (and `layout`) through `MasterDetailForm` to the header form. The modal's tabbed layout reads both keys, and its subforms arm now renders the header tabbed instead of stacked.
- **A hidden Cancel on a master-detail form** (`showCancel: false`, or `buttons.cancel.show: false`) is no longer drawn: the action bar draws Cancel only when it is handed `onCancel`, and both form arms now hand none.

`buttons.reset` and the drawer keys (`drawerSide` / `drawerWidth`) are not covered: no console entry point draws a reset button or opens a form view as a drawer.
