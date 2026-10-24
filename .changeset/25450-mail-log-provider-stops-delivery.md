---
'@objectstack/plugin-email': patch
---

fix(plugin-email): saving mail provider "None (log only — no real delivery)" stops delivery

Clause-②: no
Metadata-protocol: none

Setup → Email offers the provider `log` as "None (log only — no real delivery)". Saving it used to leave the live transport in place, so after a boot with SMTP (saved on the page, or built from `OS_EMAIL_SMTP_*` / `providerOptions`) every message kept going out over SMTP while the page label and the info log both said nothing was delivered. A saved `log` now installs the `LogTransport`, replacing whatever was live, as a saved SMTP host or API key already replaces it. The live-status banner, the re-apply's log line (which names the transport it replaced) and "Send test email" all report that no mail leaves the machine.

If a deployment saved `log` on the settings page while relying on SMTP from `OS_EMAIL_SMTP_*` or on a transport the host supplies, mail now stops at boot. To deliver again, select SMTP (or Resend / Postmark) in Setup → Email and save. Alternatively, pin the provider with `OS_MAIL_PROVIDER`.
