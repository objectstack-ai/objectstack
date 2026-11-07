---
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

feat(fields): Setup's notification topic and channel fields offer the served list and still take any typed value

Clause-②: no
Metadata-protocol: none

A notification preference's `topic` and `channel`, and a notification template's `topic`, already declare `widget: 'notification-topic'` / `'notification-channel'`. The record form now resolves both: `@object-ui/fields` registers `field:notification-topic` and `field:notification-channel`, a fillable arm of the registry-name picker (`RegistryRefField`).

- **The list.** Read from `GET /api/v1/messaging/preference-options` through the host's authenticated fetch (`SchemaRendererContext.apiFetch`), once per page for every field that draws from it, and listed in the order the server sends: `*` first, shown as "All topics (*)" / "All channels (*)".
- **A typed value.** Typing in the picker's search box offers a row that commits the text exactly as typed. A stored value the list does not hold stays on screen as its own option, marked "not in the list". Nothing is refused or rewritten; the server stores what it is given, as before.
- **A channel that is not configured** is listed, labelled "(not configured)", and can be picked.
- **No list.** When the request fails, or answers an empty list, the field is the plain text box it was before, with no notice.
- **Strings.** Five new `fields.preferenceOption.*` keys in every built-in language pack (`zh-Hant` regenerated from `zh-Hans`).

The template's `channel` field declares no widget and stays a text box.
