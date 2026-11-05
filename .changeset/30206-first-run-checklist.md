---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): an administrator's first-run checklist on Home replaces the currency and time zone dialog, and a country typed by name is saved as its code (#30206)

Clause-②: yes (widening) — new console i18n keys `console.firstRunChecklist.*` and `console.settingsView.invalidFormat` / `.invalidFormatHelp` / `.invalidFormatPick` (all ten packs); the retired `console.workspaceTimezonePrompt.*` keys had no reader outside the removed dialog
Metadata-protocol: none

The dialog that asked for the system timezone and default currency opened over the first page an administrator visited, before anything needed a currency, and once covered the toast that said how to share an invitation. It is gone. The same questions, and the other things a new workspace needs, are now rows of a checklist at the top of Home (`/home`):

1. **Organization name**: done once the organization no longer carries the name the platform gave it ("Default Organization"). Links to Setup → Organization.
2. **Default language and country**, 3. **System timezone**, 4. **Default currency**: done once the setting is set (for language, country and timezone, set by someone rather than left at the platform default; for the currency, which has no default, holding any value). Each opens in place with the Settings page's own fields, pre-filled from the browser: language, country and currency from the browser's first language (so `zh-CN` offers 中文, China and CNY together), the timezone from the browser's zone. Nothing is written until the row's Confirm, which saves through the Settings page's own `PUT /api/settings/localization`.
5. **Email delivery**: done once mail can deliver (a provider other than `log`, a From address, and a host for SMTP). Shown only to a session that may write mail. Links to Setup → Mail Delivery.
6. **Invite colleagues**: done once there is a second member or a pending invitation. Links to Setup → Users.

Each row's state is read from the real setting every time, never from a click. The checklist is shown only to a session that may write `localization`; a member sees nothing, and a member's Home sends no settings namespace read. It draws nothing once every row is done, and its close button hides it for that administrator in that workspace on that device, writing nothing to the server. The rules the dialog was built on still hold: the browser's zone and currency are never written without the administrator's Confirm, and an unset currency stays on the list until it is set.

Typing a country's name into a country picker now saves its code: 「中国」 typed into 默认国家, whose option reads 「中国 (CN)」, saves `CN` instead of being refused by the server's two-letter format check. Only a name exactly one option carries counts; any other text is sent as typed, as before. When the server does refuse a value for its format (`invalid_format`), the Settings page and the checklist now say so in the reader's language, naming the setting by its label: "Choose a value for Default country from the list." for a picker, and "Gateway model is not in a valid format. Use provider/model." (with the field's own help line) for a typed field. Every other refusal keeps the server's sentence.
