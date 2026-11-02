---
'@objectstack/spec': minor
---

feat(spec): an action's confirm and param dialogs can name their dismiss button — `cancelText`

Clause-②: yes (widening)
Metadata-protocol: added

`ActionSchema` gains one optional key, `cancelText`: the label of the dismiss button on the dialog an action opens before it runs. The button says "Cancel" today for every action. That reads badly when the action's own verb is "Cancel …" or "Close …": a "Cancel Invitation" confirm whose two buttons read "Cancel" and "Cancel Invitation" leaves the user unable to tell which one keeps the invitation. With the key, the action names what dismissing keeps. An action that does not declare it parses exactly as before.

```ts
defineAction({
  name: 'cancel_invitation',
  label: 'Cancel Invitation',
  objectName: 'sys_invitation',
  type: 'api',
  target: '/api/v1/auth/organization/cancel-invitation',
  confirmText: 'Cancel this invitation? The recipient will no longer be able to accept it.',
  cancelText: 'Keep invitation',
});
```

- **An `I18nLabel`.** A plain string or an inline locale map (`{ en, 'zh-CN' }`). A blank string is refused at parse: `''` or whitespace only. Omit the key to keep "Cancel". `cancelLabel` (the same button's spelling on the console's `form` and `alert-dialog` renderers) is refused with a rename to `cancelText`, on the action and in a translation bundle.
- **Either pre-run dialog.** It labels the dismiss button of the confirm dialog a param-less action with `confirmText` opens, and of the param dialog an action with a non-empty `params` opens, beside that dialog's `submitText`. An action that declares neither opens no dialog, so `cancelText` there is refused at parse, naming the key.
- **Translated like `submitText`.** The slot is `objects.OBJECT._actions.ACTION.cancelText` (`globalActions.ACTION.cancelText` for an action with no `objectName`). `translateAction` overlays it for an action that opens either dialog, and never gives a button to an action that opens none.
- **The name.** `cancelText` is the protocol's existing word for a dismiss button's copy: the `object-form` component's `cancelText`, beside its `submitText`.

Nothing draws the key yet. The console's confirm and param dialogs read it in a follow-up change. Until then the liveness ledger marks it `planned` with `authorWarn`, so `os validate` warns an author who declares it that the button still says "Cancel".
