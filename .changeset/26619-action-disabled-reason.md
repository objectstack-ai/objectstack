---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/platform-objects': minor
---

feat(spec): a greyed action says why — `disabledReason` beside `disabled`

Clause-②: yes (widening)
Metadata-protocol: added

`ActionSchema` gains one optional key, `disabledReason`: the sentence a greyed action shows to say why it is unavailable, beside the `disabled` predicate that greys it. An action that does not declare it parses exactly as before, and the console keeps its default reason, "Not available for this record".

```ts
defineAction({
  name: 'submit_for_approval',
  label: 'Submit for approval',
  objectName: 'clm_contract',
  disabled: "record.legal_review_status != 'approved'",
  disabledReason: 'An approved legal review is required before the contract enters approval.',
});
```

- **An `I18nLabel`.** A plain string or an inline locale map (`{ en, 'zh-CN' }`). A blank string is refused at parse: `''` or whitespace only. Omit the key to keep the default. The locale-map arm is the `InlineLocaleMapSchema` every `I18nLabel` takes, so a map is not checked for blank values. `disabledMessage`, `disabledTooltip`, `disabledHint` and `disabledText` are renamed onto it.
- **Translated with the copy keys.** The slot is `objects.OBJECT._actions.ACTION.disabledReason` (`globalActions.ACTION.disabledReason` for an action with no `objectName`), beside `confirmText` and `successMessage`. `translateAction` overlays it, and `os i18n extract` (`@objectstack/cli`) scaffolds it for an action that declares one and seeds nothing for one that does not.
- **Display only.** It does not change what `disabled` evaluates to and is never read as a condition: `os validate` checks `disabled`, not `disabledReason`. It is not access control either. A call that reaches the server anyway is refused by the action's own rules (its body or hook, `requiredPermissions`), never by this text.
- **Studio.** The action editor's Placement section gains a "Disabled Reason" row under "Disabled", translated in `@objectstack/platform-objects` for zh-CN, ja-JP and es-ES.

Nothing renders the key yet. The console's greyed-action surfaces (the record header, the record section bar, the declared actions bar and the four `action:*` renderers) read it in the follow-up change. Until then the liveness ledger marks it `planned` with `authorWarn`, so `os validate` warns an author who declares it that nothing shows it yet.
