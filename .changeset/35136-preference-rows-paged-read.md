---
'@objectstack/service-messaging': patch
---

fix(messaging): the preference filter reads every preference row of a topic, not an unordered first 10,000

Clause-②: no
Metadata-protocol: none

When a notification is sent, the preference filter reads the organization's preference rows for the event's topic and for the `*` topic. Each was one read capped at 10,000 rows with no order, so in an organization holding more rows than that for one topic, an undefined subset was left out, and a recipient whose own opt-out, digest or quiet hours fell in it was notified as though the row did not exist. Each topic is now read to the end in pages of 1,000 rows ordered by `id`, each page starting after the last `id` of the one before, and only the recipients' rows and the organization's default are kept. A read that cannot move past a full page is refused rather than used, and the filter then delivers on every channel and logs a warning, as it already did for any failed preference read.

No exported type, option or signature changes.
