---
'@objectstack/service-messaging': patch
---

feat(service-messaging): the notification preference's `quiet_hours` declares the `quiet-hours` widget

Clause-②: no
Metadata-protocol: none

`sys_notification_preference.quiet_hours` now carries `widget: 'quiet-hours'`, so the console draws its quiet-hours control (a time-zone picker and two times) instead of the JSON editor, as `topic` and `channel` already name their pick-or-type inputs. The field stays `json` with the same stored shape, `{ tz?, start: 'HH:MM', end: 'HH:MM' }`, and nothing new is refused. `field-types.mdx` documents the three notification preference widgets.
