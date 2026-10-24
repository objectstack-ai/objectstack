---
'@objectstack/plugin-email': patch
---

fix(plugin-email): "Send test email" with "None (log only)" picked but not saved no longer delivers over the live transport

Clause-②: no
Metadata-protocol: none

Setup → Email's "Send test email" tests what the form says, saved or not: an SMTP host on the form gets a one-shot SMTP connection, a Resend / Postmark key a one-shot client. With "None (log only — no real delivery)" picked and not saved, the test used to go through the live service instead, so with SMTP live a real message was delivered and the answer was "Sent test email to …". The test now goes through a one-shot `LogTransport` (recorded in `sys_email` like any other test send) and answers with a warning that nothing was delivered and no mail left the machine, naming the live transport it did not use. Once `log` is saved the answer is the existing warning that no delivery transport is active. The other providers are unchanged.
