---
'@object-ui/fields': patch
'@object-ui/i18n': patch
'@object-ui/cli': patch
---

feat(fields): a notification preference's quiet hours are drawn as a time-zone picker and two times, not a JSON box

Clause-②: yes
Metadata-protocol: none

`@object-ui/fields` registers `field:quiet-hours` for a field that declares `widget: 'quiet-hours'`: a daily window when notifications are held, stored as `{ tz?, start: 'HH:MM', end: 'HH:MM' }`. The stored shape does not change. The control appears in Setup once `sys_notification_preference.quiet_hours` declares the hint; until then the field keeps the JSON editor.

- **Writes.** Exactly `{ tz?, start, end }` once both times are set, and `null` once both are cleared. One time without the other writes nothing and marks the missing time invalid, so the form does not submit. Choosing a zone alone writes nothing.
- **Reads.** A stored window is read back into the control with each part kept as stored, so a part nobody edits is written back unchanged. A window without `tz` reads as UTC and stays without `tz` until a zone is chosen. A window whose start is later than its end runs past midnight, and the control says so; a window whose start and end are the same minute holds nothing, and the control says that too.
- **Time zones.** UTC first, then every zone `Intl.supportedValuesOf('timeZone')` lists that the `iana_time_zone` value domain accepts. A stored zone outside the list stays on screen, marked "not in the list", and is written back as stored.
- **Unreadable values.** A stored value of any other shape is shown as stored with a note, and is replaced only when the person chooses to set a new range and fills both times.
- **Strings.** Ten new `fields.quietHours.*` keys in every built-in language pack (`zh-Hant` regenerated from `zh-Hans`).
- `@object-ui/cli`'s known component types gain `field:quiet-hours`.
