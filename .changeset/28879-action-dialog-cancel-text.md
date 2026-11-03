---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/react': patch
'@object-ui/types': patch
'@objectstack/cli': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(console): an action's confirm and param dialogs name their dismiss button — `cancelText` is drawn in place of "Cancel"

Clause-②: yes (widening)
Metadata-protocol: none

`@object-ui/types` `UIActionSchema` and `@object-ui/core` `ActionDef` gain the optional member `cancelText`, typed by derivation from the spec's `ActionSchema`; `@object-ui/i18n` `useObjectLabel()` gains the resolver `actionCancelText`. Nothing is narrowed.

- **The console.** The dismiss button of the dialog an action opens before it runs draws the action's `cancelText`: on the confirm dialog of an action with `confirmText`, and on the param dialog of an action with `params`. Both paths resolve it the same way: the translation bundle's `objects.OBJECT._actions.ACTION.cancelText` (`globalActions.ACTION.cancelText` for an object-less action) first, then the authored inline locale map collapsed to the active language, then the authored string. An action that names no label keeps "Cancel". `action:button`, `action:icon`, `action:group` and `action:menu` forward the key to the runner, which hands it to the confirm dialog.
- **Setup → Invitations.** **Cancel Invitation** now asks with **Keep invitation** beside its confirm button, translated in every shipped locale.
- **Studio.** The action form offers the key ("Cancel button label"), translated in every shipped locale.
- **`os i18n extract`.** Scaffolds `objects.OBJECT._actions.ACTION.cancelText` (or `globalActions.ACTION.cancelText`) for an action that declares `confirmText` or a non-empty `params`, the actions `translateAction` overlays it onto, and no slot for any other action.
- **Spec.** The liveness ledger row for `ActionSchema.cancelText` is `live`, with its author warning dropped; the key's and the translation slot's descriptions no longer say no renderer shows it.
