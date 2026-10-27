---
'@objectstack/spec': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
'@object-ui/react': patch
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(console): a greyed action says the reason its author declared

Clause-②: no
Metadata-protocol: none

An action greyed out by its `disabled` predicate now shows its declared `disabledReason` as the button's hover title and accessible description, and as a menu item's second line. The console used to show "Not available for this record" for every such action. That sentence stays the default when the action declares no reason, or a blank one.

```ts
defineAction({
  name: 'submit_for_approval',
  label: 'Submit for approval',
  objectName: 'clm_contract',
  disabled: "record.legal_review_status != 'approved'",
  disabledReason: 'An approved legal review is required before the contract enters approval.',
});
```

- **Where it shows.** The record header (inline and in the ⋯ overflow), the record section bar, the declared actions bar, and the four `action:*` renderers (`action:button`, `action:icon`, `action:group`, `action:menu`). On every one, only the declared `disabled` predicate evaluated true earns a reason. A button greyed while its own action runs, or by the host, still gives none.
- **Translated like the other action copy.** `useActionTextLocalizer` (`@object-ui/react`) resolves the key when the action declares it, through the new `actionDisabledReason` resolver on `useObjectLabel` (`@object-ui/i18n`). The bundle's sentence at `objects.OBJECT._actions.ACTION.disabledReason` (`globalActions.ACTION.disabledReason` for an action with no `objectName`) comes first. After it comes the authored inline locale map, collapsed to the active language, then the authored string. A bundle entry never gives a reason to an action whose author wrote none. The four `action:*` renderers read the action as authored, so for them the inline locale map is the translation.
- **Typed.** `UIActionSchema` (`@object-ui/types`) declares `disabledReason`, derived from the spec's `ActionSchema`.
- **Liveness.** `disabledReason` is now `live` in `@objectstack/spec`'s ledger, with the console readers as evidence. The planned-property warning an author got for declaring it is gone. The key's description no longer says that nothing shows it.
