---
'@objectstack/plugin-email': patch
---

feat(plugin-email): `GET /api/settings/mail` states the provider in use as `live.provider`

Clause-②: yes (widening)
Metadata-protocol: none

The mail page's live status now carries the provider in use, served as the page's `live.provider` in the shape the `ai` namespace's runtime already uses: `{ value, source }`, `value` one of the `provider` options. New served keys: `live`, `live.provider`, `live.provider.value`, `live.provider.source`.

- `{ value: null, source: 'none' }` while the live transport is the development log (no mail leaves the machine).
- `{ value: 'smtp' | 'resend' | 'postmark', source: 'settings' }` when the transport was built from the `mail` settings namespace (saved, or `OS_MAIL_*`-locked).
- `{ value: 'smtp' | 'resend' | 'postmark', source: 'environment' }` when the boot built it (the stack's `email` block, `OS_EMAIL_*`) or the host handed over a stock transport.
- Not stated (no `live` key) when the host's own transport class is live, which no `provider` option names; when something other than this plugin swapped in a delivering transport; or when a save could not build what the namespace now resolves and an earlier save's transport stays live. That is unknown, which a reader tells from `none`; a live development log reads `none` whoever installed it.

The banner the page already shows (`label`, `bannerSeverity`, `bannerText`) is unchanged. A reader such as the console's first-run checklist can now read mail as configured from what is live rather than from what is saved.
