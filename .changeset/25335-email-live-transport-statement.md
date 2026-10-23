---
'@objectstack/service-settings': patch
'@objectstack/plugin-email': patch
---

feat: Setup → Email states which mail transport is live, and says so when no mail leaves this machine

Clause-②: no
Metadata-protocol: none

The Email page showed what is stored, not what is in use. Out of the box the `mail` namespace stores provider `smtp` with an empty host, so the form read as SMTP while every message went to the development log and was recorded in `sys_email` as sent.

- **`@objectstack/service-settings`:** `SettingsService.registerLiveStatus(namespace, provider)` lets the package that owns a live object state it on that namespace's page. `GET /api/settings/:namespace` asks the provider on every read and puts its answer first in the manifest's specifiers, as an `info_banner` with the reserved id `live_status` (`SETTINGS_LIVE_STATUS_BANNER_ID`). The registered manifest and in-process `getNamespace()` are unchanged. If the provider throws, the page says the live status could not be read; the statement is never silently dropped. New exports: `SettingsLiveStatus`, `SettingsLiveStatusProvider`, `SETTINGS_LIVE_STATUS_BANNER_ID`.
- **`@objectstack/plugin-email`:** registers the `mail` statement from `EmailService.isConfigured()`. When it answers `false` (the log transport), the banner reads "No mail leaves this machine". When it answers `true`, the banner names the live transport, for example "Mail is delivered through SMTP (smtp.example.com:587)". The statement waits for any settings re-apply still running, so a read made just after a save names the transport that save built.
