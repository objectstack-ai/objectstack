---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): email delivery is an optional row on the first-run checklist, and Home's deployment notice no longer says that no email service is set up

Clause-②: yes (widening)
Metadata-protocol: none

The first-run checklist on Home stayed until every row was done, so an administrator whose applications send no mail, and every hosted tenant, kept it for good because of the Email delivery row. That row is now marked Optional and is not counted: the progress line counts the other rows, and the checklist disappears once they are done, whether mail is set up or not. A mail setup that delivers still reads done, and the row still links to Setup → Mail Delivery.

The deployment notice no longer draws the server's `email_not_configured` finding ("No email service is set up…"), on Home or on System Overview. The notice should speak about mail only when something needs mail and cannot send it, and the server does not state that today. A production deployment whose only finding is the unset email service now shows no notice. Hiding the notice still sends the fingerprint the server served.

`@object-ui/i18n` adds one locale key in every pack: `console.firstRunChecklist.optional`.
