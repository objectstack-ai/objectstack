---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
---

feat(console): entering an app loads its metadata bundle once, and a record open reads no metadata

Clause-②: no
Metadata-protocol: none

Entering an app now loads that app's metadata bundle (`GET /api/v1/meta/app/{appId}/bundle`) in one request, through the new `ObjectStackAdapter.loadAppBundle(appId)`. The bundle holds the app, the objects its navigation reaches together with the objects that reference them, and their views, pages and dashboards. Re-entering the app sends `If-None-Match`, and a `304` keeps the bundle the console already holds.

- **Reads of bundled items.** A by-name metadata read of an item the bundle holds is answered from the bundle, as that item's own envelope, and never goes to its by-name route. This covers `getObjectSchema`, `getView`, `getPage`, `getApp`, `getItems`, and every caller of the client's `meta.getItem(type, name)`, including app-shell's `MetadataProvider`. A record open in a warm session therefore sends its page request and no metadata request. A cold open adds at most the one bundle request, sent alongside the page request.
- **Reads of everything else.** Items outside the app (Studio's reads, a lookup to `sys_user`, an item the caller may not read) keep their by-name routes. A read with options does too. An item withheld from the caller is absent from the bundle and carries no name there, so its by-name read gives that item's own refusal.
- **Staying current.** A metadata write through any of the client's write doors, or a host invalidation that names a bundled item, makes the next bundled read revalidate the bundle first. An answer older than the adapter cache's lifetime is revalidated the same way. A cache clear, which happens on an organization, session or locale switch, downloads the bundle again with no validator.
- **No bundle.** If the bundle is refused, the app is unknown, or the server has no such route, every read goes to its by-name route as before.
