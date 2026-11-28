---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): every human editor in Studio saves live; an item's unpublished AI changes can be dropped on its page

Clause-②: no
Metadata-protocol: none

Every editor a person uses in Studio's object, automation and access pages now saves with the top bar's Save and Cancel, and a Save is live at once: an object's fields, field layout, validation rules, actions, settings and hooks, flows, and now permission sets and the Access pillar's record-sharing overview, which no longer has a Save of its own. A permission set no longer autosaves a draft 1.5 s after each edit, and the access banners say that Save makes a change live. Creating an object, a flow or a permission set makes it live at once too, so those create dialogs say Create instead of Save as draft; apps, pages, dashboards, reports and datasets are still created as drafts.

Changes and Publish are left for the AI assistant's drafts. When an object or a flow holds an unpublished draft the assistant wrote, its page says that saving makes those changes live too and offers to discard them: that one item's draft is dropped, the page goes back to the live version, and Changes counts one item fewer. Unsaved edits on the page go with the discard, after a confirm.
