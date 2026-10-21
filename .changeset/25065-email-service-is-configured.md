---
'@objectstack/spec': patch
'@objectstack/plugin-email': patch
---

feat(spec, plugin-email): `IEmailService.isConfigured()` answers whether mail sent through the service is actually delivered

Clause-②: yes (widening: an optional member on `IEmailService`)
Metadata-protocol: none

- **The contract.** `IEmailService` (`@objectstack/spec/contracts`) gains one optional member, `isConfigured?(): boolean`, with the same name and shape as `ISmsService.isConfigured()`. `true` means the active transport hands mail to a real delivery provider. `false` means no mail leaves the process: sends still resolve and still write their audit row. A `log` transport is never delivering, in any environment. The answer is read at call time and follows a transport swapped in at runtime.
- **Absent means unknown.** The member is optional, so every existing implementation stays valid. A consumer must never read an absent member as delivering: a flow whose success depends on a mail reaching someone treats absent the same as `false` and keeps its explicit refusal, so a service that is merely wired is never mistaken for one that delivers.
- **The implementation.** `@objectstack/plugin-email`'s `EmailService.isConfigured()` answers `false` while its transport is the `LogTransport` (the default when no mail transport is configured) and `true` for any other transport. It follows the transport the plugin rebuilds from the `mail` settings, so saving an SMTP or API-provider configuration turns it `true` without a restart.
- **Unchanged.** Sending, templates, persistence and the boot warning for the `log` transport behave as before. No consumer reads the member yet.
