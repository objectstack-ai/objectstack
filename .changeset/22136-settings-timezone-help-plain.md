---
"@objectstack/service-settings": patch
---

fix(service-settings): the Default timezone help speaks to administrators, not in formula-function names

Clause-②: no

The help under Settings → Localization → Default timezone (also shown in the first-run "set the workspace timezone" prompt) read "IANA zone for today()/daysFromNow, analytics date buckets, and rendered datetimes." It now says what the setting does: "Decides what "today" means in formulas, how reports group dates, and how dates and times are shown. Accepts any IANA time zone name (e.g. Europe/Paris)." The same meaning ships in every built-in locale (en, zh-CN, ja-JP, es-ES) and in the manifest's own `description`, which `GET /api/settings/localization` serves and the console falls back to.

Wording only: the `timezone` key, its default (`UTC`), its accepted values (any IANA zone) and what it drives are unchanged.
