---
'@objectstack/spec': patch
'@objectstack/service-messaging': patch
'@objectstack/plugin-approvals': patch
---

fix(i18n): an approval step label and an approval notification's object label read as the metadata translators serve them

Clause-②: yes (widening)
Metadata-protocol: none

In a deployment whose `i18n.sourceLocale` differs from its `i18n.defaultLocale` (an app authored in English that defaults its users to Chinese), an English reader was shown the Chinese approval step name, and an English approval-notification recipient read the Chinese object name inside an English sentence. Both labels were read through `II18nService.t()`, which falls back to the `defaultLocale` row; `/meta` serves the authored text. Both now resolve the way the metadata route resolves a label: the reader's negotiated locale, the declared fallback chain, and the authored language (the declared `sourceLocale`, else `defaultLocale`).

- **`@objectstack/spec`** adds `resolveFlowApprovalStepLabel(bundle, flowName, nodeId, literal?, opts?)` (`@objectstack/spec/system`), the one reading of `flows.<flow>.approvals.<node_id>.label`: the requested locale, then the declared fallback chain (skipped for the authored locale), then `literal`. It takes the flow's name and the node's id, so a reader holding only an approval request row needs no flow document.
- **`@objectstack/service-messaging`** accepts a new `NotificationTextKeys.params` value, `{ objectLabel: '<object>', fallback }` (`NotificationObjectLabelParam`): the label of that object in the recipient's language, resolved as `GET /meta/object/:name` serves it, by `translateObject` over the object's served definition and its packaged base, so a renamed packaged object is named by its rename. It renders the same way on the inline fan-out, the dispatcher (digests included) and the inbox reader. `fallback` is delivered when nothing resolves. The `{ key, fallback }` value is still accepted and still renders through `t()`, so stored deliveries and inbox rows render as before.
- **`@objectstack/plugin-approvals`** names a notification's object with that typed param, and reads the approval step label through `resolveFlowApprovalStepLabel`, so `t()` carries catalog sentences only.

Upgrade `@objectstack/plugin-approvals` and `@objectstack/service-messaging` together: an older messaging service refuses the typed param at `emit()`.
