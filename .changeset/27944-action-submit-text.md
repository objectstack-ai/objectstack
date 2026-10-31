---
'@objectstack/spec': minor
---

feat(spec): an action's param dialog can name its own submit verb — `submitText`

Clause-②: yes (widening)
Metadata-protocol: added

`ActionSchema` gains one optional key, `submitText`: the label of the submit button in the dialog an action opens to collect its `params`. The button says "Confirm" today for every such action. With the key, a send-email action can say "Send" and a log-call action "Log Call". An action that does not declare it parses exactly as before.

```ts
defineAction({
  name: 'log_call',
  label: 'Log Call',
  objectName: 'crm_contact',
  target: 'logCall',
  submitText: 'Log Call',
  params: [{ name: 'subject', label: 'Subject', type: 'text', required: true }],
});
```

- **An `I18nLabel`.** A plain string or an inline locale map (`{ en, 'zh-CN' }`). A blank string is refused at parse: `''` or whitespace only. Omit the key to keep "Confirm". `submitLabel` and `confirmLabel` (the same button's spelling on a view's `bulkActionDefs`) are refused with a rename to `submitText`, on the action and in a translation bundle.
- **Actions with `params` only.** The param dialog opens only for a non-empty `params`, so `submitText` on any other registered action is refused at parse, naming the key. It is not `confirmText`, the message of the confirm dialog a param-less action opens.
- **Translated like `description`.** The slot is `objects.OBJECT._actions.ACTION.submitText` (`globalActions.ACTION.submitText` for an action with no `objectName`). `translateAction` overlays it for an action that declares `params`, and never gives a button to an action without them.
- **The name.** `submitText` is the protocol's existing word for a submit button's copy: the `object-form` component's `submitText`, beside its `cancelText`.

Nothing draws the key yet. The console's param dialog reads it in a follow-up change. Until then the liveness ledger marks it `planned` with `authorWarn`, so `os validate` warns an author who declares it that the button still says "Confirm".
