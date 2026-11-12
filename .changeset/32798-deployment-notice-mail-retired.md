---
'@objectstack/service-settings': patch
---

fix(service-settings): the deployment notice no longer reports an unset mail transport

Clause-②: no
Metadata-protocol: none

`GET /api/settings/deployment/notice` used to add an `email_not_configured` finding whenever the email service did not report a configured transport. Mail is an optional setting, and the notice should speak about mail only when something needs mail and cannot send it; nothing states that today, and the flows that send mail, such as invitations and password reset, already read the transport themselves. The finding is gone: a production deployment without mail gets no mail line, and the notice's `fingerprint` no longer names it.

Configuring mail therefore no longer changes the fingerprint, so a notice an administrator hid stays hidden when mail is set up later. One-time effect of the upgrade: a hide recorded against a fingerprint that still named `email_not_configured` no longer matches, so that notice shows once more on its remaining findings until it is hidden again. The Console stopped drawing this finding in an earlier change; no other platform reader names it.
