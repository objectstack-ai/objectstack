---
'@objectstack/service-messaging': patch
---

Clause-②: no
Metadata-protocol: none

`MessagingService.emit` reads the recipients' notification preferences in the emitting organization, the same one a `role:` audience resolves in: the organization the producer names, else the one stored on the notification's event row. A producer that named no organization used to read the preference rows with no organization term, under the system opt-in, so a row stored under another organization could mute a recipient or override their opt-out. With no organization from either the producer or the event row, the read is unchanged.

Who moves: an emit whose producer names no organization, on an install where the engine stamps the event row (`single`, one organization) and preference rows are stored under another organization. Every emit that names its organization is unchanged.

Also: when `role:` and the other selectors resolve in different organizations, an audience entry that is itself a list is skipped, as it already was when they agree; it was expanded before. No typed audience is affected.
