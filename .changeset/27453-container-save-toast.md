---
'@object-ui/i18n': patch
'@object-ui/plugin-form': patch
---

Clause-②: yes (widening: @object-ui/i18n gains the public export recordSaveMessage; no accept set moves)
Metadata-protocol: none

A record saved from an `object-form` block's drawer or modal (`formType: 'drawer' | 'modal'`, including `<ObjectForm formType="drawer">` on a React page) now gets the record-named success toast the console's record dialogs give, such as `Task "Fix login" updated` or `Task "Write release notes" created`. A record with nothing nameable keeps the object-label toast, and a declared `successMessage` is used as written. The toast comes before the author's `onSuccess`, so a page whose `onSuccess` only closes the overlay and reloads its list needs no change. A host that mounts `DrawerForm` / `ModalForm` itself, and a form with a `submitHandler`, keeps owning its feedback and is not toasted twice. `@object-ui/i18n` adds `recordSaveMessage(t, { label, objectDef, saved, mode })`, the one builder of that message, which the console's record dialog and record page now share.
