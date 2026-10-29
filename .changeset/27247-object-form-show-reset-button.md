---
'@object-ui/plugin-form': patch
'@object-ui/components': patch
'@object-ui/types': patch
---

fix(plugin-form): an ObjectForm block's `showReset` draws the Reset button it declares, instead of clearing the form after every save

Clause-②: yes (widening)

Metadata-protocol: none (the `object-form` block's `showReset` key and its spec text, "Show the reset button", are unchanged; the renderer now does what that text says. The two new keys are on `@object-ui/types`' `FormSchema`, the renderer-internal `form` node that `@objectstack/spec` does not declare)

`showReset` on the `object-form` block is declared "Show the reset button", but the renderer passed it to the form's clear-after-save flag. So `showReset: true` drew no button and emptied the form after each successful save, and `showReset: false` did nothing.

- **FROM → TO.** `showReset: true` now draws a Reset button beside Cancel and Save. Pressing it puts the form back to the values it opened with (the record being edited, or the create defaults) and saves nothing. A save no longer clears the form because of `showReset`. A form that should clear after a save declares `submitBehavior: { kind: 'continue' }`, or `resetOnSuccess: true` on a create form.
- **Where the button is drawn.** The simple form (flat or sectioned), the tabbed form, and the drawer and modal footers. The wizard and the master-detail form have their own action bars and draw no Reset button yet.
- **`@object-ui/types`.** `FormSchema` (the `form` node) gains two optional keys: `showReset`, which draws the button in the form's action bar, and `resetLabel`, its label (default: the session language's "Reset"). The `form` node also restores its opening values on a `reset` event, so a footer outside the form can reach it with a `type="reset"` button that names the form's `id`.
