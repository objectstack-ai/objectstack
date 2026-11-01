---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/types': patch
'@objectstack/cli': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(console): an action's param dialog names its own submit verb — `submitText` is drawn on the submit button in place of "Confirm"

Clause-②: yes (widening) — `@object-ui/types` `UIActionSchema` and `@object-ui/core` `ActionDef` gain the optional member `submitText`, typed by derivation from the spec's `ActionSchema`; `@object-ui/i18n` `useObjectLabel()` gains the resolver `actionSubmitText`. Nothing is narrowed.
Metadata-protocol: none

- **The console.** The dialog an action opens to collect its `params` draws the action's `submitText` on its submit button ("Send", "Log Call"). Both param-collection handlers resolve it the way they resolve `description`: the translation bundle's `objects.OBJECT._actions.ACTION.submitText` (`globalActions.ACTION.submitText` for an object-less action) first, then the authored inline locale map collapsed to the active language, then the authored string. An action that names no verb keeps "Confirm", and the button still says "Uploading…" while a file param uploads. `action:button`, `action:icon`, `action:group` and `action:menu` forward the key to the runner.
- **Studio.** The action form offers the key ("Submit button label"), translated in every shipped locale.
- **`os i18n extract`.** Scaffolds `objects.OBJECT._actions.ACTION.submitText` (or `globalActions.ACTION.submitText`) for an action with a non-empty `params` — the only action `translateAction` overlays it onto — and no slot for any other action.
- **Spec.** The liveness ledger row for `ActionSchema.submitText` is `live`, with its author warning dropped; the key's description no longer says no renderer shows it.
