---
"@object-ui/plugin-calendar": patch
---

Clause-②: no
Metadata-protocol: none

Fix calendar events reading `[object Object]` when `calendar.titleField` names a lookup field. `ObjectCalendar` now passes the author's `titleField` to the unified record display-name resolver instead of stringifying the value itself, so an expanded lookup shows the referenced record's display name, a raw id string still shows as it did, and an expanded reference with no usable name falls through to the object-level title ladder.
