---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a refused organization delete lists what the organization still holds, by object label, in the user's language

Clause-②: yes (widening)
Metadata-protocol: none

`@object-ui/i18n` gains two keys in every shipped locale pack, so the published `en` export and `TranslationKeys` (`typeof en`) widen: `organization.settings.deleteRestricted` (the refusal's frame sentence) and `organization.settings.deleteRestrictedOther` (the "Other records" line). No key is removed or renamed; `organization.settings.deleteDescription` and `organization.settings.deleteConfirmDescription` keep their keys and change their text.

The organization delete is refused with 409 `DELETE_RESTRICTED` while the organization still owns records, and the answer lists them as `dependents: [{ object, count }]`. The console showed that refusal as the server's English sentence, with internal table names such as `sys_billing_invoice_line`, in every language. Now the confirm dialog stays open and lists the remaining records itself: each object under its label from the loaded translation bundle, with its count, and every object no label resolves for counted on one "Other records" line. No API name and no server English is shown.

The danger-zone and confirm copy no longer promise that all data is permanently deleted. In every shipped locale they say what the delete does: it removes the organization with its members and invitations, and it is refused, removing nothing, while the organization still holds records.

`@object-ui/auth`: an auth-client rejection now carries the body's `dependents` (entries without an `object` dropped, a withheld count left out) and a producer-marked `userMessage`, beside `code` and `message`. Nothing else about the thrown error changes.
